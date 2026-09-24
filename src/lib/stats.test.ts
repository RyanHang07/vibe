import { describe, expect, it } from "vitest";

import { wilsonInterval } from "./stats";

/**
 * Trimmed alongside `stats.ts`.
 *
 * The variance split, minimum detectable effect and paired comparison moved
 * to `analysis/datum_analysis/stats.py`, and their tests moved with them.
 * What is left covers the one function the application still runs at
 * request time.
 *
 * These assertions are mirrored line for line in
 * `analysis/tests/test_stats.py`. That is deliberate: one function is
 * duplicated across two languages, and the only thing stopping the copies
 * drifting is that both suites check the same behaviour — including the
 * edge cases that would otherwise be the first to diverge.
 */
describe("wilsonInterval", () => {
  it("brackets the point estimate", () => {
    const interval = wilsonInterval(12, 20);
    expect(interval.point).toBeCloseTo(0.6, 10);
    expect(interval.lower).toBeLessThan(0.6);
    expect(interval.upper).toBeGreaterThan(0.6);
  });

  it("is wide at n=20, which is the point", () => {
    // Roughly 39% to 78%. A later batch at 70% has not beaten this one.
    const interval = wilsonInterval(12, 20);
    expect(interval.lower).toBeGreaterThan(0.36);
    expect(interval.lower).toBeLessThan(0.42);
    expect(interval.upper).toBeGreaterThan(0.75);
    expect(interval.upper).toBeLessThan(0.81);
  });

  it("narrows as trials increase", () => {
    const small = wilsonInterval(12, 20);
    const large = wilsonInterval(120, 200);
    expect(large.upper - large.lower).toBeLessThan(small.upper - small.lower);
  });

  /**
   * The reason this is not the Wald interval.
   *
   * Wald gives 0% ± 0 here: certainty about the true rate, from twenty
   * observations. The adversarial tier is built to score zero, so this is
   * the common case rather than an edge one.
   */
  it("never collapses to zero width at zero successes", () => {
    const interval = wilsonInterval(0, 20);
    expect(interval.point).toBe(0);
    expect(interval.upper).toBeGreaterThan(0);
    expect(interval.lower).toBe(0);
  });

  it("never collapses at full marks either", () => {
    const interval = wilsonInterval(20, 20);
    expect(interval.point).toBe(1);
    expect(interval.lower).toBeLessThan(1);
    expect(interval.upper).toBe(1);
  });

  it("reports no trials as no estimate, not as zero percent", () => {
    const interval = wilsonInterval(0, 0);
    expect(Number.isNaN(interval.point)).toBe(true);
  });

  it("rejects impossible counts", () => {
    expect(() => wilsonInterval(21, 20)).toThrow();
    expect(() => wilsonInterval(-1, 20)).toThrow();
  });

  it("rejects an unsupported confidence level", () => {
    expect(() => wilsonInterval(1, 2, 0.9137)).toThrow();
  });
});
