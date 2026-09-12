import { AgentResult, TextMessage, type Message } from "@inngest/agent-kit";
import { Sandbox } from "e2b";

import { SANDBOX_TIMEOUT_MS } from "@/lib/config";

export async function getSandbox(sandboxId: string) {
    const sandbox = await Sandbox.connect(sandboxId);
    // Was a hardcoded 10 minutes, which silently shortened the 30-minute
    // lifetime set at creation every time the sandbox was reconnected.
    await sandbox.setTimeout(SANDBOX_TIMEOUT_MS);
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

/** Shown to the user when the agent produced nothing usable to parse. */
export const FALLBACK_FRAGMENT_TITLE = "Fragment";

/**
 * Pull display text out of an agent's output.
 *
 * Two fixes over the original:
 *
 *   - `Message` was used as a type but never imported.
 *   - `value[0]` was read with no length check. An empty output array threw
 *     a TypeError inside the Inngest step, which aborted the function before
 *     `save-result` ran — so the user got no message at all, not even the
 *     error one. Failing to a title is strictly better than failing to
 *     silence.
 */
export const parseAgentOutput = (value: Message[]) => {
    const output = value?.[0];

    if (!output || output.type !== "text") {
        return FALLBACK_FRAGMENT_TITLE;
    }

    if (Array.isArray(output.content)) {
        return output.content.map((txt) => txt.text).join("");
    }

    return output.content;
};
