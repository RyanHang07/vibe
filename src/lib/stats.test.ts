import { describe, expect, it } from "vitest";

import {
  formatInterval,
  overlaps,
  trialsForWidth,
  wilsonInterval,
} from "./stats";

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

    const width = (i: { lower: number; upper: number }) => i.upper - i.lower;
    expect(width(large)).toBeLessThan(width(small) / 2);
  });

  it("does not collapse to zero width at 0 successes", () => {
    // The whole reason for Wilson over Wald. Wald gives 0% ± 0 here —
    // certainty that the true rate is exactly zero, from twenty runs. The
    // adversarial tier is built to score 0, so this is the common case.
    const interval = wilsonInterval(0, 20);
    expect(interval.point).toBe(0);
    expect(interval.lower).toBe(0);
    expect(interval.upper).toBeGreaterThan(0.1);
  });

  it("does not collapse to zero width at 100%", () => {
    const interval = wilsonInterval(20, 20);
    expect(interval.upper).toBe(1);
    expect(interval.lower).toBeLessThan(0.9);
  });

  it("never runs outside [0, 1]", () => {
    for (let n = 1; n <= 40; n += 1) {
      for (let s = 0; s <= n; s += 1) {
        const interval = wilsonInterval(s, n);
        expect(interval.lower).toBeGreaterThanOrEqual(0);
        expect(interval.upper).toBeLessThanOrEqual(1);
        expect(interval.lower).toBeLessThanOrEqual(interval.upper);
      }
    }
  });

  it("reports no estimate for zero trials rather than 0%", () => {
    // 0% would read as a catastrophic result instead of an absence of data.
    const interval = wilsonInterval(0, 0);
    expect(Number.isNaN(interval.point)).toBe(true);
    expect(formatInterval(interval)).toBe("no data");
  });

  it("rejects impossible counts instead of returning a number", () => {
    expect(() => wilsonInterval(21, 20)).toThrow();
    expect(() => wilsonInterval(-1, 20)).toThrow();
    expect(() => wilsonInterval(1.5, 20)).toThrow();
  });

  it("rejects a confidence level it has no z for", () => {
    expect(() => wilsonInterval(12, 20, 0.9137)).toThrow(/Unsupported/);
  });

  it("widens with a higher confidence level", () => {
    const ninety = wilsonInterval(12, 20, 0.9);
    const ninetyNine = wilsonInterval(12, 20, 0.99);
    expect(ninetyNine.upper - ninetyNine.lower).toBeGreaterThan(
      ninety.upper - ninety.lower,
    );
  });
});

describe("overlaps", () => {
  it("sees overlap between 60% and 70% at n=20", () => {
    // The headline case: these look different and are not distinguishable.
    expect(overlaps(wilsonInterval(12, 20), wilsonInterval(14, 20))).toBe(true);
  });

  it("separates results that are genuinely far apart", () => {
    expect(overlaps(wilsonInterval(2, 20), wilsonInterval(18, 20))).toBe(false);
  });

  it("treats an empty batch as not comparable", () => {
    expect(overlaps(wilsonInterval(0, 0), wilsonInterval(12, 20))).toBe(false);
  });
});

describe("trialsForWidth", () => {
  it("says 97 runs for a plus-or-minus-10-point interval", () => {
    // ceil(1.96² × 0.25 / 0.1²) = ceil(96.04) = 97.
    //
    // The number usually quoted is 96, from rounding 96.04 to nearest. But
    // the question is "how many runs do I need", which rounds up — 96 runs
    // leaves the interval fractionally wider than asked for.
    expect(trialsForWidth(0.2)).toBe(97);
  });

  it("shows the cost of precision rising sharply", () => {
    // Halving the width costs four times the runs.
    expect(trialsForWidth(0.1)).toBeGreaterThan(trialsForWidth(0.2) * 3.5);
  });
});
