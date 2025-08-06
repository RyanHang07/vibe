import { AgentResult, TextMessage } from "@inngest/agent-kit";
import { Sandbox } from "e2b";

export async function getSandbox(sandboxId: string) {
    const sandbox = await Sandbox.connect(sandboxId) ;
    await sandbox.setTimeout(10 * 60_000);
    return sandbox;
};

export function lastAssistantTextMessageContent(result: AgentResult) {
    const lastAssistantTextMessageIndex = result.output.findLastIndex(
        (message) => message.role === "assistant",
    );

    const message = result.output[lastAssistantTextMessageIndex] as
    | TextMessage
    | undefined;

    return message?.content
        ? typeof message.content === "string"
        ? message.content
        : message.content.map((c) => c.text).join("") : undefined;
};

export const parseAgentOutput = (value: Message[]) => {
    const output = value[0];
      
    if (output.type!== "text") {
        return "Fragment";
    }

    if (Array.isArray(output.content)) {
        return output.content.map((txt) => txt.text).join("");
    } else {
        return output.content;
    }
};