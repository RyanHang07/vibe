import { describe, expect, it } from "vitest";

import { FREE_POINTS, OutOfCreditsError, PRO_POINTS } from "./usage";

describe("plan allowances", () => {
  /**
   * S2: these shipped inverted — FREE at 10000 against PRO at 100, so free
   * accounts had a hundred times the paid allowance, with a comment
   * claiming 100 while the code said 10000.
   *
   * `usage.ts` throws at import if the invariant breaks, so this test
   * passing at all proves the module loaded. Asserting it again here means
   * the failure is reported as a named test rather than as an unrelated
   * suite failing to import.
   */
  it("gives the paid plan more than the free one", () => {
    expect(PRO_POINTS).toBeGreaterThan(FREE_POINTS);
  });

  it("gives the free plan something", () => {
    expect(FREE_POINTS).toBeGreaterThan(0);
  });
});

describe("OutOfCreditsError", () => {
  /**
   * S7: the call sites used to distinguish "out of credits" from "broken"
   * by `error instanceof Error` — which worked only because
   * `rate-limiter-flexible` rejects with a plain object for the rate-limit
   * case. A named error makes the distinction something the code states.
   */
  it("is an Error, so `instanceof Error` no longer identifies anything", () => {
    const error = new OutOfCreditsError(1_000);

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(OutOfCreditsError);
  });

  it("carries how long until the window resets", () => {
    expect(new OutOfCreditsError(42_000).msBeforeNext).toBe(42_000);
  });

  it("is distinguishable from an ordinary failure", () => {
    const broken: unknown = new Error("database is down");

    expect(broken instanceof OutOfCreditsError).toBe(false);
  });
});
