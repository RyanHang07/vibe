import { inngest } from "./client";
import { openai, createAgent, createTool, createNetwork, type Tool, type Message, createState } from "@inngest/agent-kit";
import { Sandbox } from "e2b";
import { getSandbox, lastAssistantTextMessageContent, parseAgentOutput } from "./utils";
import { z } from "zod";
import { PROMPT, FRAGMENT_TITLE_PROMPT, RESPONSE_PROMPT } from "@/prompt";
import { prisma } from "@/lib/db";

interface AgentState {
  summary: string;
  files: {[path: string]: string};
}

export const codeAgentFunction = inngest.createFunction(
  { id: "code-agent" },
  { event: "code-agent/run" },
  async ({ event, step }) => {
    // Extract API key from event data, fallback to environment variable
    const apiKey = event.data.apiKey || process.env.OPENAI_API_KEY;
    
    if (!apiKey) {
      throw new Error("No OpenAI API key provided");
    }

    const sandboxId = await step.run("get-sandbox-id", async () => {
      const sandbox = await Sandbox.create("vibe-nextjs-ryan-test-2");
      await sandbox.setTimeout(3 * 10 * 60_000);
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
        take: 5,
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
      model: openai({ 
        model: "gpt-4.1", // Updated to use a valid model
        apiKey: apiKey, // Use dynamic API key
        defaultParameters: {
          temperature: 0.1,
        }
      }),
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
      maxIter: 15,
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

    // Use the same API key for the helper agents
    const fragmentTitleGenerator = createAgent({
      name: "fragment-title-generator",
      description: "A fragment title generator for code fragment",
      system: FRAGMENT_TITLE_PROMPT,
      model: openai({
        model:"gpt-4o",
        apiKey: apiKey, // Use same API key
      })
    })

    const responseGenerator = createAgent({
      name: "response-generator",
      description: "A response generator",
      system: RESPONSE_PROMPT,
      model: openai({
        model:"gpt-4o",
        apiKey: apiKey, // Use same API key
      })
    })

    const { output: fragmentTitleOutput } = await fragmentTitleGenerator.run(result.state.data.summary);
    const { output: responseOutput } = await responseGenerator.run(result.state.data.summary);

    const isError = !result.state.data.summary ||
    Object.keys(result.state.data.files || {}).length === 0;

    const sandboxUrl = await step.run("get-sandbox-url", async () => {
      const sandbox = await getSandbox(sandboxId);
      const host = sandbox.getHost(3000);
      return `http://${host}`
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