import { describe, expect, it } from "vitest";
import type { Message } from "@inngest/agent-kit";

import { FALLBACK_FRAGMENT_TITLE, parseAgentOutput } from "./utils";

/**
 * Regression tests for the crash path described in utils.ts.
 *
 * `parseAgentOutput` read `value[0]` with no length check. An empty output
 * array threw a TypeError inside the Inngest step, which aborted the
 * function before `save-result` ran — so the user saw no message at all,
 * not even the error one. A failure that renders as absence rather than as
 * a refusal (solarity/docs/patterns.md).
 */

// `Message` is a union in AgentKit 0.13, and `content` only exists on some
// members, so `Message["content"]` does not resolve. Build the shape we care
// about and widen at the boundary.
const textMessage = (content: string | { text: string }[]): Message =>
  ({ type: "text", role: "assistant", content }) as unknown as Message;

describe("parseAgentOutput", () => {
  it("returns a string message unchanged", () => {
    expect(parseAgentOutput([textMessage("A todo app")])).toBe("A todo app");
  });

  it("joins multi-part content", () => {
    const parts = [{ text: "A todo " }, { text: "app" }];
    expect(parseAgentOutput([textMessage(parts)])).toBe("A todo app");
  });

  it("falls back on an empty array instead of throwing", () => {
    expect(() => parseAgentOutput([])).not.toThrow();
    expect(parseAgentOutput([])).toBe(FALLBACK_FRAGMENT_TITLE);
  });

  it("falls back when the array is undefined instead of throwing", () => {
    expect(() =>
      parseAgentOutput(undefined as unknown as Message[]),
    ).not.toThrow();
  });

  it("falls back on a non-text message", () => {
    const toolCall = { type: "tool_call", role: "assistant" } as Message;
    expect(parseAgentOutput([toolCall])).toBe(FALLBACK_FRAGMENT_TITLE);
  });
});
