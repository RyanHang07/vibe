import { inngest } from "./client";
import { createAgent, createTool, createNetwork, type Tool, type Message, createState } from "@inngest/agent-kit";
import { Sandbox } from "e2b";
import { getSandbox, lastAssistantTextMessageContent, parseAgentOutput } from "./utils";
import { z } from "zod";
import { PROMPT, FRAGMENT_TITLE_PROMPT, RESPONSE_PROMPT } from "@/prompt";
import { prisma } from "@/lib/db";
import { getProvider, modelFor } from "@/lib/models";
import {
  MAX_AGENT_ITERATIONS,
  MESSAGE_HISTORY_DEPTH,
  SANDBOX_TEMPLATE,
  SANDBOX_TIMEOUT_MS,
} from "@/lib/config";

interface AgentState {
  summary: string;
  files: {[path: string]: string};
}

export const codeAgentFunction = inngest.createFunction(
  { id: "code-agent" },
  { event: "code-agent/run" },
  async ({ event, step }) => {
    // A user-supplied key, when present, overrides the environment for this run.
    // modelFor() throws with a readable message when neither is available.
    const apiKey: string | undefined = event.data.apiKey;
    const provider = getProvider(event.data.provider);

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
                return result.stdout;
              } catch (e) {
                console.error(
                  `Command failed: ${e} \nstdout: ${buffers.stdout} \nstderr: ${buffers.stderr}`
                );
                return `Command failed: ${e} \nstdout: ${buffers.stdout} \nstderr: ${buffers.stderr}`
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
          handler: async (
            { files }, 
            { step, network }: Tool.Options<AgentState>
          ) => {
            const newFiles = await step?.run("createOrUpdateFiles", async () => {
              try {
                const updatedFiles = network.state.data.files || {};
                const sandbox = await getSandbox(sandboxId);
                for (const file of files) {
                  await sandbox.files.write(file.path, file.content);
                  updatedFiles[file.path] = file.content;
                }

                return updatedFiles;
              } catch (e) {
                return "Error " + e;
              }
            });

            if (typeof newFiles === "object") {
              network.state.data.files = newFiles;
            }
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
                return JSON.stringify(contents);
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

    const result = await network.run(event.data.value, { state });

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

    // Independent of each other — running them in sequence doubled the
    // user-visible wait for no reason.
    const [{ output: fragmentTitleOutput }, { output: responseOutput }] =
      await Promise.all([
        fragmentTitleGenerator.run(result.state.data.summary),
        responseGenerator.run(result.state.data.summary),
      ]);

    const isError = !result.state.data.summary ||
    Object.keys(result.state.data.files || {}).length === 0;

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
          content: parseAgentOutput(responseOutput),
          role: "ASSISTANT",
          type: "RESULT",
          fragment: {
            create: {
              sandboxUrl: sandboxUrl,
              title: parseAgentOutput(fragmentTitleOutput),
              files: result.state.data.files,
            }
          }
        },
      })
    })

    return { 
      url: sandboxUrl,
      title: "Fragment",
      files: result.state.data.files,
      summary: result.state.data.summary, 
    };
  },
);