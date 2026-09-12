import { describe, expect, it } from "vitest";

import { FREE_POINTS, PRO_POINTS } from "./usage";

/**
 * Regression test for docs/AUDIT.md S2.
 *
 * FREE_POINTS shipped at 10000 against a PRO_POINTS of 100, so free accounts
 * had a hundred times the paid allowance. A comment next to it claimed the
 * value was 100 while the code said 10000 — the comment was the only thing
 * asserting the intent, and comments are not checked.
 *
 * This is the check that is.
 */
describe("plan allowances", () => {
  it("gives Pro strictly more than Free", () => {
    expect(PRO_POINTS).toBeGreaterThan(FREE_POINTS);
  });

  it("are positive integers", () => {
    for (const points of [FREE_POINTS, PRO_POINTS]) {
      expect(Number.isInteger(points)).toBe(true);
      expect(points).toBeGreaterThan(0);
    }
  });
});
