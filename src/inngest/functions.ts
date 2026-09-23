import { inngest } from "./client";
import { createAgent, createTool, createNetwork, type Tool, type Message, createState } from "@inngest/agent-kit";
import { Sandbox } from "e2b";
import {
  FALLBACK_FRAGMENT_TITLE,
  getSandbox,
  lastAssistantTextMessageContent,
  parseAgentOutput,
} from "./utils";
import { z } from "zod";
import { PROMPT, FRAGMENT_TITLE_PROMPT, RESPONSE_PROMPT } from "@/prompt";
import { prisma } from "@/lib/db";
import { getModelId, getProvider, modelFor, providerForKey } from "@/lib/models";
import { finishRun, startRun } from "@/lib/runs";
import { runBuildCheck } from "./build-check";
import { infrastructureFault, markFault } from "@/lib/faults";
import { CONFIG_VERSION, truncateForModel } from "@/lib/interventions";
import {
  KILL_SANDBOX_AFTER_EVAL,
  MAX_AGENT_ITERATIONS,
  MESSAGE_HISTORY_DEPTH,
  SANDBOX_TEMPLATE,
  SANDBOX_TIMEOUT_MS,
} from "@/lib/config";

interface AgentState {
  summary: string;
  files: {[path: string]: string};
  /**
   * Whatever the agent said last, captured on every response.
   *
   * Recorded here rather than reconstructed afterwards because this is the
   * only place the correct shape is available: the lifecycle hook receives
   * an AgentResult, while `network.run` returns a NetworkRun with no
   * `.output` at all.
   */
  lastMessage?: string;
}

export const codeAgentFunction = inngest.createFunction(
  { id: "code-agent" },
  { event: "code-agent/run" },
  async ({ event, step }) => {
    // A user-supplied key, when present, overrides the environment for this run.
    // modelFor() throws with a readable message when neither is available.
    const apiKey: string | undefined = event.data.apiKey;

    // A user-supplied key decides its own provider. The configured default
    // is Anthropic, so without this a pasted OpenAI key would be sent to
    // Anthropic and fail with a 401 that never mentions providers.
    // Explicit event data still wins, for deliberate overrides.
    const provider =
      event.data.provider
        ? getProvider(event.data.provider)
        : (apiKey && providerForKey(apiKey)) || getProvider();

    // Opened before any work starts, so a run that dies mid-flight still
    // leaves a row behind. Inside step.run so an Inngest retry reuses the
    // same id instead of opening a second run for the same request.
    const runSource: "USER" | "EVAL" =
      event.data.source === "EVAL" ? "EVAL" : "USER";

    const runId = await step.run("record-run-start", async () =>
      startRun({
        projectId: event.data.projectId,
        prompt: event.data.value,
        provider,
        model: getModelId("coder", provider),
        source: runSource,
        caseId: typeof event.data.caseId === "string" ? event.data.caseId : undefined,
        configVersion: CONFIG_VERSION,
        sandboxTemplate: SANDBOX_TEMPLATE,
      }),
    );

    const sandboxId = await step.run("get-sandbox-id", async () => {
      const sandbox = await Sandbox.create(SANDBOX_TEMPLATE);
      await sandbox.setTimeout(SANDBOX_TIMEOUT_MS);
      return sandbox.sandboxId;
    })

    const previousMessages = await step.run("get-previous-messages", async () => {
      const formattedMessages: Message[] = [];

      const messages = await prisma.message.findMany({
        where: {
          projectId: event.data.projectId,
        },
        orderBy: {
          createdAt: "desc",
        },
        take: MESSAGE_HISTORY_DEPTH,
      });

      for (let i = 0; i < messages.length; i++) {
        formattedMessages.push({
          type: "text",
          role: messages[i].role === "ASSISTANT" ? "assistant" : "user",
          content: `${i + 1} message: ${messages[i].content}`,
        })
      }

      return formattedMessages.reverse();
    });

    const state = createState<AgentState>(
      {
        summary: "",
        files: {},
        lastMessage: undefined,
      },
      {
        messages: previousMessages
      }
    );

    const codeAgent = createAgent<AgentState>({
      name: "code-agent",
      description: "An expert coding agent",
      system: PROMPT,
      model: modelFor({ role: "coder", apiKey, provider }),
      tools: [
        createTool({
          name: "terminal",
          description: "Use the terminal to run commands",
          parameters: z.object({
            command: z.string(),
          }),
          handler: async ({ command }, { step }) => {
            return await step?.run("terminal", async () => {
              const buffers = {stdout: "", stderr: ""};

              try {
                const sandbox = await getSandbox(sandboxId);
                const result = await sandbox.commands.run(command, {
                  onStdout: (data: string) => {
                    buffers.stdout += data;
                  },
                  onStderr: (data: string) => {
                    buffers.stderr += data;
                  }
                });
                // Truncated: full stdout from something like `npm install`
                // is tens of kilobytes, and it stays in the conversation
                // for every remaining iteration. See lib/interventions.ts.
                return truncateForModel(result.stdout);
              } catch (e) {
                console.error(
                  `Command failed: ${e} \nstdout: ${buffers.stdout} \nstderr: ${buffers.stderr}`
                );
                return truncateForModel(
                  `Command failed: ${e} \nstdout: ${buffers.stdout} \nstderr: ${buffers.stderr}`,
                )
              }
            });
          },
        }),
        createTool({
          name:"createOrUpdateFiles",
          description: "Create or update files in the sandbox",
          parameters: z.object({
            files: z.array(
              z.object({
                path: z.string(),
                content: z.string(),
              }),
            ),
          }),
          /**
           * This handler previously reported a write failure by returning
           * the string `"Error " + e`, then checked `typeof === "object"`
           * before updating state. So a failed write silently left the file
           * map empty, and the handler returned undefined either way — the
           * model got no tool result at all and carried on as if it had
           * worked.
           *
           * That produced the exact observed failure: the agent writes a
           * confident `<task_summary>` describing files it believes it
           * created, while `fileCount` is zero and nothing says why.
           *
           * Errors are now returned to the model as text, so it can react,
           * and state is only updated on an actual success.
           */
          handler: async (
            { files },
            { step, network }: Tool.Options<AgentState>
          ) => {
            const outcome = await step?.run("createOrUpdateFiles", async () => {
              try {
                const updatedFiles = { ...(network.state.data.files ?? {}) };
                const sandbox = await getSandbox(sandboxId);

                for (const file of files) {
                  await sandbox.files.write(file.path, file.content);
                  updatedFiles[file.path] = file.content;
                }

                return { ok: true as const, files: updatedFiles };
              } catch (e) {
                return {
                  ok: false as const,
                  error: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
                };
              }
            });

            // `step` is optional in the tool signature. If it is ever
            // absent the write never happened, and saying so beats
            // returning undefined and looking like success.
            if (!outcome) {
              return "No step context available; nothing was written.";
            }

            if (!outcome.ok) {
              return `Failed to write files: ${outcome.error}`;
            }

            network.state.data.files = outcome.files;

            const written = Object.keys(outcome.files).length;
            return `Wrote ${files.length} file(s). ${written} file(s) now in the project.`;
          }
        }),
        createTool({
          name:"readFiles",
          description: "Read files from the sandbox",
          parameters: z.object({
            files: z.array(z.string()),
          }),
          handler: async ({ files }, { step }) => {
            return await step?.run("readFiles", async () => {
              try {
                const sandbox = await getSandbox(sandboxId);
                const contents = [];
                for (const file of files) {
                  const content = await sandbox.files.read(file);
                  contents.push({ path: file, content });
                }
                // Every requested file's full contents used to go back to
                // the model and stay in context for the rest of the run.
                return truncateForModel(JSON.stringify(contents));
              } catch (e) {
                return "Error " + e;
              }
            })
          }
        })
      ],
      lifecycle: {
        onResponse: async ({result, network}) => {
          const lastAssistantTextMessage = lastAssistantTextMessageContent(result);

          if (lastAssistantTextMessage && network) {
            // Kept on every response, not only on success. When a run ends
            // with no files, this is the only record of why.
            network.state.data.lastMessage = lastAssistantTextMessage;

            if (lastAssistantTextMessage.includes("<task_summary>")) {
              network.state.data.summary = lastAssistantTextMessage;
            }
          }

          return result;
        },
      },
    });

    const network = createNetwork<AgentState>({
      name: "coding-agent-network",
      agents: [codeAgent],
      maxIter: MAX_AGENT_ITERATIONS,
      defaultState: state,
      router: async ({ network }) => {
        const summary = network.state.data.summary;
        if (summary) {
          return;
        }

        return codeAgent;
      },
    })

    /**
     * A failed generation used to leave nothing behind but a file count of
     * zero. `network.run` was unguarded, tool errors were swallowed into
     * strings, and the only record was "FAILED, 0 files" — which cannot
     * distinguish a model that refused, a tool that threw, and an
     * iteration cap reached in silence.
     *
     * Observe is stage one of the loop in docs/PLAN.md. A failure that
     * records no reason is the instrumentation not doing its job.
     */
    let result: Awaited<ReturnType<typeof network.run>> | null = null;
    let runError: string | null = null;

    try {
      result = await network.run(event.data.value, { state });
    } catch (error) {
      /**
       * Serialise everything the error carries, not just name and message.
       *
       * Twenty-five runs failed with `AIGatewayError: unsuccessful status
       * code: 400` and that string was the entire record. It names the
       * status and nothing about the cause — context length, a malformed
       * request, a quota, a rejected tool schema all look identical.
       *
       * Providers put the reason in the response body. Errors carry it on
       * non-enumerable properties that `${error}` drops silently, which is
       * why three rounds of diagnosis have had nothing to work with.
       */
      const describe = (value: unknown): string => {
        if (!(value instanceof Error)) return String(value);

        const extras: Record<string, unknown> = {};
        for (const key of Object.getOwnPropertyNames(value)) {
          if (key === "stack") continue;
          const property = (value as unknown as Record<string, unknown>)[key];
          if (typeof property === "function") continue;
          extras[key] = property;
        }

        // `cause` is where SDKs usually hang the underlying HTTP error.
        const cause = (value as { cause?: unknown }).cause;
        if (cause) extras.cause = describe(cause);

        let serialised: string;
        try {
          serialised = JSON.stringify(extras).slice(0, 4_000);
        } catch {
          serialised = "(error properties not serialisable)";
        }

        return `${value.name}: ${value.message}\n${serialised}`;
      };

      const detail = describe(error);

      // A 429 is not the agent writing bad code. Without this it lands in
      // the Run table looking identical to a genuine failure, and a
      // rate-limited batch reads as a collapse in quality.
      const fault = infrastructureFault(detail);
      runError = fault ? markFault(fault, detail) : detail;
    }

    // Captured by the lifecycle hook during the run, where the shape is
    // right. An earlier version called lastAssistantTextMessageContent on
    // the network result here, which has no `.output` — a TypeError inside
    // the very code meant to explain failures.
    const lastAgentMessage = result?.state?.data?.lastMessage ?? null;

    if (!result) {
      // Release the sandbox on the failure path too.
      //
      // This branch used to return without it, so every failed run leaked a
      // sandbox for the full thirty-minute timeout. A batch where all 24
      // cases failed therefore held 24 sandboxes against E2B's ~20
      // concurrent cap — which then rate-limited the *next* batch, making a
      // four-case smoke run fail for reasons created an hour earlier.
      //
      // Cleanup that only runs on the happy path is the one shape that
      // guarantees the mess accumulates exactly when things are going
      // badly.
      if (runSource === "EVAL" && KILL_SANDBOX_AFTER_EVAL) {
        await step.run("release-sandbox-after-error", async () => {
          try {
            const sandbox = await getSandbox(sandboxId);
            await sandbox.kill();
            return { killed: true };
          } catch (killError) {
            return { killed: false, error: String(killError) };
          }
        });
      }

      await step.run("record-run-error", async () =>
        finishRun({
          runId,
          status: "FAILED",
          fileCount: 0,
          hasSummary: false,
          errorMessage: runError ?? "network.run returned nothing",
        }),
      );

      await step.run("save-error-message", async () =>
        prisma.message.create({
          data: {
            projectId: event.data.projectId,
            content: "Something went wrong. Please try again.",
            role: "ASSISTANT",
            type: "ERROR",
          },
        }),
      );

      return { error: runError };
    }

    // Helper agents reuse the run's provider and key.
    const fragmentTitleGenerator = createAgent({
      name: "fragment-title-generator",
      description: "A fragment title generator for code fragment",
      system: FRAGMENT_TITLE_PROMPT,
      model: modelFor({ role: "titler", apiKey, provider }),
    })

    const responseGenerator = createAgent({
      name: "response-generator",
      description: "A response generator",
      system: RESPONSE_PROMPT,
      model: modelFor({ role: "responder", apiKey, provider }),
    })

    /**
     * Do not call the helpers with an empty summary.
     *
     * THIS IS THE 400.
     *
     * `agent.run("")` produces a request with an empty messages array, and
     * the provider rejects it:
     *
     *   {"type":"invalid_request_error",
     *    "message":"messages: at least one message is required"}
     *
     * AgentKit surfaces that as `AIGatewayError: unsuccessful status code:
     * 400` with no body, which is why two weeks of diagnosis got no further
     * than a status code. It was diagnosed as context exhaustion — a
     * reading that never explained why `trivial-01` also failed.
     *
     * The `isError` check below would have caught the missing summary. It
     * just ran after these calls rather than before, so a run that had
     * already failed made one more request that could only fail.
     *
     * A failed generation should not be able to cause a second, different
     * failure on the way out.
     */
    const summary = result.state.data.summary?.trim() ?? "";

    const [fragmentTitleOutput, responseOutput] = summary
      ? await Promise.all([
          // Independent of each other — sequential runs doubled the
          // user-visible wait for no reason.
          fragmentTitleGenerator.run(summary).then((r) => r.output),
          responseGenerator.run(summary).then((r) => r.output),
        ])
      : [null, null];

    const fileCount = Object.keys(result.state.data.files || {}).length;
    const hasSummary = Boolean(result.state.data.summary);

    /**
     * Token usage, summed across every agent turn.
     *
     * WHY THIS MATTERS MORE THAN IT LOOKS.
     *
     * The baseline sits at 88.6% typecheck with ±19 points of resolution at
     * 44 runs. The ceiling is 100%, so the most any intervention could gain
     * is 11.4 points — inside the noise floor. **No change to the agent can
     * be shown to improve the pass rate at any sample size this project
     * will realistically run.**
     *
     * Continuous measures do not have that problem. A difference in tokens
     * or latency compares distributions rather than counting successes, and
     * is visible with a fraction of the samples.
     *
     * So cost per successful generation becomes the metric that can actually
     * answer the interesting questions — does Sonnet earn its price, does
     * truncation reduce context, is a lower `maxIter` cheaper without
     * costing quality. The columns have existed since slice 1 and were
     * never filled.
     *
     * Defensive: AgentKit's usage shape is not guaranteed, and a missing
     * token count must stay null rather than become zero. Zero would be
     * recorded as "free", which is a lie that averages badly.
     */
    /**
     * TOKEN COUNTS ARE NOT AVAILABLE THROUGH THIS API.
     *
     * `AgentResult` carries `output`, `toolCalls`, `createdAt` and `prompt`
     * — no usage. Token counts appear only on AgentKit's streaming
     * `run.completed` event, which `network.run()` never emits. Capturing
     * them means moving the agent onto the streaming interface, which is a
     * real change and not one to make mid-baseline.
     *
     * An earlier version of this code searched `result.state.results` for a
     * `tokens` field, found nothing, and silently recorded undefined — dead
     * code that looked like working instrumentation. That is the same shape
     * as every other failure in this project: a mechanism that appears
     * present and does nothing.
     *
     * `durationMs` is already recorded on every run and is continuous, so
     * cost comparisons use latency for now. It is a proxy rather than a
     * price, and the reports say so.
     */
    const usage = { input: undefined, output: undefined };

    // The existing success heuristic: "the agent said something and wrote a
    // file". Slice 2 replaces this with an actual build result. It is kept
    // on the Run row so the two can be compared — how often this said
    // success while the code did not compile is itself a finding.
    const isError = !hasSummary || fileCount === 0;

    const sandboxUrl = await step.run("get-sandbox-url", async () => {
      const sandbox = await getSandbox(sandboxId);
      const host = sandbox.getHost(3000);
      return `https://${host}`
    })

    await step.run("save-result", async () => {
      if (isError) {
        return await prisma.message.create({
          data: {
            projectId: event.data.projectId,
            content: "Something went wrong. Please try again.",
            role: "ASSISTANT",
            type: "ERROR",
          },
        })
      }
      return await prisma.message.create({
        data: {
          projectId: event.data.projectId,
          content: responseOutput
            ? parseAgentOutput(responseOutput)
            : "Generated, but the agent did not describe what it built.",
          role: "ASSISTANT",
          type: "RESULT",
          fragment: {
            create: {
              sandboxUrl: sandboxUrl,
              title: fragmentTitleOutput
                ? parseAgentOutput(fragmentTitleOutput)
                : FALLBACK_FRAGMENT_TITLE,
              files: result.state.data.files,
            }
          }
        },
      })
    })

    // Deliberately after save-result. The user already has their fragment by
    // now, so the build check costs them nothing — it runs on the sandbox
    // while they read the output. Measurement should not make the product
    // slower, or it will eventually be switched off.
    const checks = await step.run("build-check", async () =>
      runBuildCheck(sandboxId, fileCount, runSource),
    );

    // Eval sandboxes are released as soon as they have been measured.
    // Nobody is looking at an eval preview, and E2B caps concurrent
    // sandboxes at about 20 — a batch that leaves them alive for the full
    // thirty-minute timeout starves itself before it finishes.
    if (runSource === "EVAL" && KILL_SANDBOX_AFTER_EVAL) {
      await step.run("release-sandbox", async () => {
        try {
          const sandbox = await getSandbox(sandboxId);
          await sandbox.kill();
          return { killed: true };
        } catch (error) {
          // Never fail a run over cleanup. A sandbox that outlives its
          // welcome costs quota; a thrown error here costs the measurement.
          return { killed: false, error: String(error) };
        }
      });
    }

    await step.run("record-run-finish", async () =>
      finishRun({
        runId,
        status: isError ? "FAILED" : "COMPLETED",
        fileCount,
        hasSummary,
        // On failure, keep what the agent actually said. "0 files" is a
        // symptom; the last message is usually the cause.
        errorMessage: isError
          ? [
              `summary: ${hasSummary}, files: ${fileCount}`,
              lastAgentMessage ? `last message: ${lastAgentMessage.slice(0, 2000)}` : null,
            ]
              .filter(Boolean)
              .join("\n")
          : undefined,
        inputTokens: usage.input,
        outputTokens: usage.output,
        checks,
      }),
    );

    return {
      url: sandboxUrl,
      title: "Fragment",
      files: result.state.data.files,
      summary: result.state.data.summary,
    };
  },
);