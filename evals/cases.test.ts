import { describe, expect, it } from "vitest";

import { EVAL_CASES, SMOKE_CASE_IDS, smokeCases, type Difficulty } from "./cases";

/**
 * These are not tests of the agent. They are tests of the measuring
 * instrument, which is the thing most likely to be wrong in a way nobody
 * notices — a broken ruler reports confident numbers.
 */

describe("the golden set", () => {
  it("has unique ids", () => {
    // Duplicate ids silently merge two cases into one in every later
    // per-case comparison, and nothing else would surface it.
    const ids = EVAL_CASES.map((testCase) => testCase.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has no empty prompts", () => {
    for (const testCase of EVAL_CASES) {
      expect(testCase.prompt.trim().length).toBeGreaterThan(0);
    }
  });

  it("says why every case exists", () => {
    // A case nobody can justify is a case nobody will maintain.
    for (const testCase of EVAL_CASES) {
      expect(testCase.probes.trim().length).toBeGreaterThan(0);
    }
  });

  it("covers every difficulty tier", () => {
    const tiers: Difficulty[] = [
      "trivial",
      "simple",
      "moderate",
      "complex",
      "adversarial",
    ];

    for (const tier of tiers) {
      const count = EVAL_CASES.filter((c) => c.difficulty === tier).length;
      expect(count, `no cases at difficulty "${tier}"`).toBeGreaterThan(0);
    }
  });

  it("includes cases expected to fail", () => {
    // A set that everything passes cannot detect a regression. The floor
    // has to stay a floor.
    const adversarial = EVAL_CASES.filter(
      (c) => c.difficulty === "adversarial",
    );
    expect(adversarial.length).toBeGreaterThanOrEqual(3);
  });

  it("has a smoke subset that actually exists", () => {
    // A smoke id that no longer matches a case would silently shrink the
    // set, and the symptom is a cheaper run rather than an error.
    expect(smokeCases().length).toBe(SMOKE_CASE_IDS.length);
  });

  it("keeps the smoke set small enough to be worth using", () => {
    expect(smokeCases().length).toBeLessThanOrEqual(5);
  });

  it("covers a range of difficulty in the smoke set", () => {
    // Four cases from one band would test one path repeatedly.
    const tiers = new Set(smokeCases().map((c) => c.difficulty));
    expect(tiers.size).toBeGreaterThanOrEqual(3);
  });

  it("keeps the expensive cases out of the smoke set", () => {
    // complex-* and the 3D-multiplayer-game case are where the time and
    // tokens go, and they prove nothing about plumbing.
    const ids = smokeCases().map((c) => c.id);
    expect(ids).not.toContain("adversarial-04");
    expect(ids.some((id) => id.startsWith("complex-"))).toBe(false);
  });

  it("is large enough for the interval to be worth printing", () => {
    // Below ~20 the confidence interval in slice 4 is so wide that almost
    // no change is distinguishable from noise.
    expect(EVAL_CASES.length).toBeGreaterThanOrEqual(20);
  });
});
