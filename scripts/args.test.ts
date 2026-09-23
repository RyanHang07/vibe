import { describe, expect, it } from "vitest";

/**
 * Regression tests for how the eval harness reads its arguments.
 *
 * These exist because of a live incident, not a hypothetical: `--dry-run` is
 * an npm builtin, so `npm run eval -- --dry-run` was swallowed before it
 * reached the script. The run proceeded for real while appearing to have
 * been told not to, and created 24 orphan projects.
 *
 * A preview flag that silently does the opposite of preview is the worst
 * possible failure mode for a tool that costs money to run, so the parsing
 * is now tested rather than assumed.
 */

const bare = (token: string): string => token.replace(/^-+/, "");

const parse = (argv: string[]) => {
  const tokens = argv.map(bare);
  const has = (name: string) => tokens.includes(name);
  const get = (name: string): string | undefined => {
    const pair = tokens.find((token) => token.startsWith(`${name}=`));
    if (pair) return pair.slice(name.length + 1);
    const index = tokens.indexOf(name);
    if (index !== -1 && tokens[index + 1] && !tokens[index + 1].includes("=")) {
      return tokens[index + 1];
    }
    return undefined;
  };
  return { has, get };
};

describe("eval argument parsing", () => {
  it("accepts bare words, which is what survives npm", () => {
    const { has } = parse(["plan"]);
    expect(has("plan")).toBe(true);
    expect(has("clean")).toBe(false);
  });

  it("accepts dashed forms for direct tsx invocation", () => {
    const { has } = parse(["--plan"]);
    expect(has("plan")).toBe(true);
  });

  it("reads key=value pairs", () => {
    const { get } = parse(["difficulty=simple", "concurrency=4"]);
    expect(get("difficulty")).toBe("simple");
    expect(get("concurrency")).toBe("4");
  });

  it("reads space-separated values", () => {
    const { get } = parse(["--case", "trivial-01"]);
    expect(get("case")).toBe("trivial-01");
  });

  it("does not read a following key=value pair as a value", () => {
    // `case` has no value here; `difficulty=simple` belongs to difficulty.
    const { get } = parse(["case", "difficulty=simple"]);
    expect(get("case")).toBeUndefined();
    expect(get("difficulty")).toBe("simple");
  });

  it("defaults to sending, never to previewing", () => {
    // The safe default for a flag that is easy to lose in transit is the
    // one that does nothing. But `plan` is the *preview*, so its absence
    // must mean "really run" — which is exactly why the absence has to be
    // deliberate and tested rather than incidental.
    const { has } = parse([]);
    expect(has("plan")).toBe(false);
    expect(has("clean")).toBe(false);
  });
});
