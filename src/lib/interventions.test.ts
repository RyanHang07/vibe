import { describe, expect, it } from "vitest";

import {
  assertConfigConsistent,
  CONFIG_VERSION,
  TOOL_OUTPUT_LIMIT,
  truncateForModel,
} from "./interventions";

describe("assertConfigConsistent", () => {
  /**
   * The whole point. A label saying 1000 while the process runs 4000 would
   * produce a clean, tightly-bracketed measurement of nothing.
   */
  it("throws when the version name and the actual limit disagree", () => {
    expect(() => assertConfigConsistent("v4-truncate-1000", 4000)).toThrow(
      /was changed without the other/,
    );
  });

  it("passes when they agree", () => {
    expect(() => assertConfigConsistent("v4-truncate-1000", 1000)).not.toThrow();
  });

  /**
   * v3 predates the naming scheme. Exempt rather than retro-labelled:
   * rewriting what past runs claim to be is the same error in reverse.
   */
  it("exempts versions that do not encode a limit", () => {
    expect(() =>
      assertConfigConsistent("v3-nextjs16-truncate", 4000),
    ).not.toThrow();
  });

  it("rejects a limit that is not a positive number", () => {
    expect(() => assertConfigConsistent("v3-nextjs16-truncate", Number.NaN)).toThrow(
      /not a positive number/,
    );
    expect(() => assertConfigConsistent("v3-nextjs16-truncate", 0)).toThrow();
  });

  /**
   * NOT "the live config is consistent". That test was here and it was
   * wrong, in an instructive way.
   *
   * Vitest runs without `--env-file=.env`, so `TOOL_OUTPUT_LIMIT` in a test
   * process is always the 4000 default regardless of what .env says. The
   * test was therefore asserting something about the test runner's
   * environment and reporting it as a fact about the application. It failed
   * the moment .env and CONFIG_VERSION were correctly set to 1000 together
   * — the one state it was supposed to bless.
   *
   * What is checkable here is that the label is well-formed. Whether it
   * matches the environment is a property of a process, and is checked in
   * that process: `preflight()` for the launcher, and the recorded
   * `toolOutputLimit` for the agent, which is the one that actually matters.
   */
  it("declares a limit the parser can read", () => {
    const declared = /-truncate-(\d+)$/.exec(CONFIG_VERSION);

    if (declared) {
      expect(Number.parseInt(declared[1], 10)).toBeGreaterThan(0);
    } else {
      // Grandfathered names are allowed, but only the known one.
      expect(CONFIG_VERSION).toBe("v3-nextjs16-truncate");
    }
  });

  it("does not depend on ambient environment to be testable", () => {
    expect(() => assertConfigConsistent("v9-truncate-250", 250)).not.toThrow();
    expect(TOOL_OUTPUT_LIMIT).toBeGreaterThan(0);
  });
});

describe("truncateForModel", () => {
  it("leaves short text alone", () => {
    expect(truncateForModel("hello", 100)).toBe("hello");
  });

  /**
   * Both ends, not the tail. A command's opening lines say what ran and a
   * failure summary lands at the end.
   */
  it("keeps both ends and says how much went missing", () => {
    const text = `START${"x".repeat(500)}END`;
    const result = truncateForModel(text, 100);

    expect(result.startsWith("START")).toBe(true);
    expect(result.endsWith("END")).toBe(true);
    expect(result).toMatch(/characters omitted/);
  });

  /**
   * The model must know a gap exists, or it reasons about the missing
   * region as though it were empty.
   */
  it("never removes text silently", () => {
    const result = truncateForModel("y".repeat(10_000), 200);
    expect(result).toContain("omitted");
  });
});
