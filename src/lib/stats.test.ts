import { describe, expect, it } from "vitest";

import {
  formatInterval,
  minimumDetectableEffect,
  overlaps,
  pairedDifference,
  trialsForWidth,
  varianceSplit,
  wilsonInterval,
} from "./stats";

describe("varianceSplit", () => {
  /**
   * The shape this exists to detect: groups far apart, tight within.
   * Trivial cases finish in 10s, adversarial ones in 70s, and neither
   * varies much on a repeat. Between-group spread is large and irrelevant
   * to an intervention; within-group spread is small and is the real bar.
   */
  it("separates a large between-group spread from a small within-group one", () => {
    const split = varianceSplit(
      new Map([
        ["trivial-01", [10, 11]],
        ["complex-01", [70, 71]],
      ]),
    );

    expect(split.betweenSd).toBeGreaterThan(40);
    expect(split.withinSd).toBeCloseTo(Math.sqrt(0.5), 6);
    expect(split.groupsWithRepeats).toBe(2);
  });

  it("counts single-observation groups between but not within", () => {
    const split = varianceSplit(
      new Map([
        ["a", [10, 20]],
        ["b", [50]],
      ]),
    );

    expect(split.groups).toBe(2);
    expect(split.groupsWithRepeats).toBe(1);
    // Within rests on `a` alone: deviations ±5, one degree of freedom.
    expect(split.withinSd).toBeCloseTo(Math.sqrt(50), 6);
  });

  /**
   * With no repeats anywhere, within-group spread is unmeasured. It must
   * come back NaN rather than 0 — a zero would report infinite resolution
   * and green-light an experiment that can resolve nothing.
   */
  it("reports within-group spread as unknown, never zero, without repeats", () => {
    const split = varianceSplit(new Map([["a", [10]], ["b", [20]]]));
    expect(Number.isNaN(split.withinSd)).toBe(true);
    expect(split.withinSd).not.toBe(0);
  });

  it("returns no estimate for no observations", () => {
    const split = varianceSplit(new Map());
    expect(split.observations).toBe(0);
    expect(Number.isNaN(split.grandMean)).toBe(true);
  });
});

describe("minimumDetectableEffect", () => {
  it("shrinks with the square root of the sample", () => {
    const small = minimumDetectableEffect(10, 25);
    const large = minimumDetectableEffect(10, 100);
    expect(small / large).toBeCloseTo(2, 1);
  });

  it("is proportional to the noise it faces", () => {
    expect(minimumDetectableEffect(20, 24)).toBeCloseTo(
      2 * minimumDetectableEffect(10, 24),
      6,
    );
  });

  /**
   * The number the pairing argument rests on. Agent time at 53 runs has a
   * total sd of roughly 24s; if within-case sd is a third of that, pairing
   * buys a threefold improvement in what the experiment can see.
   */
  it("shows pairing buying resolution proportional to the noise removed", () => {
    const unpaired = minimumDetectableEffect(24, 24);
    const paired = minimumDetectableEffect(8, 24);
    expect(unpaired / paired).toBeCloseTo(3, 6);
  });

  it("gives no answer for a single observation", () => {
    expect(Number.isNaN(minimumDetectableEffect(10, 1))).toBe(true);
  });

  it("propagates unmeasured noise rather than inventing a bar", () => {
    expect(Number.isNaN(minimumDetectableEffect(Number.NaN, 24))).toBe(true);
  });
});

describe("pairedDifference", () => {
  /**
   * The case pairing exists for. Huge spread between cases, a small
   * consistent shift within each. Unpaired this is invisible; paired it is
   * obvious, because every case moved the same way.
   */
  it("resolves a small consistent shift buried under a huge between-case spread", () => {
    const a = new Map([
      ["trivial-01", [10_000]],
      ["simple-01", [30_000]],
      ["moderate-01", [60_000]],
      ["complex-01", [90_000]],
    ]);
    const b = new Map([
      ["trivial-01", [8_000]],
      ["simple-01", [28_000]],
      ["moderate-01", [58_000]],
      ["complex-01", [88_000]],
    ]);

    const result = pairedDifference(a, b);

    expect(result.pairs).toBe(4);
    expect(result.meanDifference).toBeCloseTo(2_000, 6);
    expect(result.resolved).toBe(true);
    expect(result.lower).toBeGreaterThan(0);
  });

  it("does not resolve an inconsistent difference of the same mean size", () => {
    const a = new Map([
      ["a", [10_000]],
      ["b", [30_000]],
      ["c", [60_000]],
      ["d", [90_000]],
    ]);
    const b = new Map([
      ["a", [30_000]],
      ["b", [10_000]],
      ["c", [80_000]],
      ["d", [72_000]],
    ]);

    const result = pairedDifference(a, b);
    expect(result.resolved).toBe(false);
    expect(result.lower).toBeLessThan(0);
    expect(result.upper).toBeGreaterThan(0);
  });

  /**
   * A case that passed under one config and not the other says something
   * about the pass rate. Filling in the gap with the other arm's value
   * would assume the effect being measured.
   */
  it("drops and names cases present in one arm only", () => {
    const a = new Map([["shared", [10_000]], ["only-a", [50_000]], ["x", [1_000]]]);
    const b = new Map([["shared", [9_000]], ["only-b", [50_000]], ["x", [900]]]);

    const result = pairedDifference(a, b);
    expect(result.pairs).toBe(2);
    expect(result.dropped).toEqual(["only-a", "only-b"]);
  });

  it("refuses to report a difference from a single pair", () => {
    const result = pairedDifference(
      new Map([["a", [10_000]]]),
      new Map([["a", [5_000]]]),
    );
    expect(result.pairs).toBe(1);
    expect(result.resolved).toBe(false);
    expect(Number.isNaN(result.meanDifference)).toBe(true);
  });

  it("averages repeats within a case before differencing", () => {
    const result = pairedDifference(
      new Map([["a", [10_000, 20_000]], ["b", [10_000, 20_000]]]),
      new Map([["a", [5_000, 5_000]], ["b", [5_000, 5_000]]]),
    );
    expect(result.meanDifference).toBeCloseTo(10_000, 6);
  });
});

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
