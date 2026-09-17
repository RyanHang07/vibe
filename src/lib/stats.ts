/**
 * Turning counts into claims you can defend.
 *
 * Slice 4 of docs/PLAN.md.
 *
 * WHY A BARE PERCENTAGE IS NOT AN ANSWER
 *
 * "12 of 20 built, so 60%" describes those twenty runs exactly. It says
 * almost nothing about the twenty-first. The honest range around 12/20 runs
 * from roughly 39% to 78% — so a later batch scoring 70% is not an
 * improvement, it is the same claim wearing a different number.
 *
 * Reporting 60% and 70% as though the second beat the first is the single
 * most common way an eval suite produces confident nonsense. Everything in
 * this file exists to make that mistake hard.
 */

/** A proportion, with the honest range around it. */
export type Interval = {
  successes: number;
  trials: number;
  /** Point estimate. Real, and on its own, misleading. */
  point: number;
  lower: number;
  upper: number;
  /** Confidence level, e.g. 0.95. */
  level: number;
};

/**
 * z for a two-sided normal interval.
 *
 * Only the handful of levels anyone actually uses. Interpolating an
 * arbitrary level would invite passing 0.9137 and believing the result.
 */
const Z: Record<string, number> = {
  "0.8": 1.2815515655446004,
  "0.9": 1.6448536269514722,
  "0.95": 1.959963984540054,
  "0.99": 2.5758293035489004,
};

const zFor = (level: number): number => {
  const z = Z[String(level)];
  if (z === undefined) {
    throw new Error(
      `Unsupported confidence level ${level}. Use one of: ${Object.keys(Z).join(", ")}.`,
    );
  }
  return z;
};

/**
 * Wilson score interval.
 *
 * WHY WILSON AND NOT THE OBVIOUS ONE
 *
 * The textbook interval is `p ± z·sqrt(p(1-p)/n)` — the Wald interval. It
 * is easier to write and wrong exactly where this project needs it:
 *
 *   - At 0/20 it gives 0% ± 0. A zero-width interval, claiming certainty
 *     that the true rate is exactly zero, from twenty observations. The
 *     adversarial tier is deliberately full of cases expected to score 0,
 *     so this is not an edge case here, it is the common case.
 *   - At 20/20 it does the same in reverse.
 *   - For small n it is too narrow generally, so differences look real
 *     when they are not.
 *
 * Wilson never collapses to zero width, never runs past 0 or 1, and behaves
 * at small samples. It is the right default for exactly this shape of
 * problem: a proportion, from few trials, where the extremes matter.
 */
export const wilsonInterval = (
  successes: number,
  trials: number,
  level = 0.95,
): Interval => {
  if (!Number.isInteger(successes) || !Number.isInteger(trials)) {
    throw new Error("successes and trials must be integers");
  }
  if (trials < 0 || successes < 0 || successes > trials) {
    throw new Error(`Invalid counts: ${successes} of ${trials}`);
  }

  // No trials means no estimate. Returning 0 here would let an empty run
  // report a 0% success rate, which reads as a catastrophic result rather
  // than as an absence of data.
  if (trials === 0) {
    return { successes, trials, point: Number.NaN, lower: 0, upper: 1, level };
  }

  const z = zFor(level);
  const p = successes / trials;
  const z2 = z * z;

  const denominator = 1 + z2 / trials;
  const center = (p + z2 / (2 * trials)) / denominator;
  const spread =
    (z / denominator) *
    Math.sqrt((p * (1 - p)) / trials + z2 / (4 * trials * trials));

  return {
    successes,
    trials,
    point: p,
    lower: Math.max(0, center - spread),
    upper: Math.min(1, center + spread),
    level,
  };
};

const percent = (value: number): string =>
  Number.isNaN(value) ? "—" : `${(value * 100).toFixed(1)}%`;

/** `9/20 = 45.0%  [25.8%, 65.8%]` */
export const formatInterval = (interval: Interval): string => {
  if (interval.trials === 0) return "no data";

  return [
    `${interval.successes}/${interval.trials}`,
    `= ${percent(interval.point).padStart(6)}`,
    `[${percent(interval.lower)}, ${percent(interval.upper)}]`,
  ].join("  ");
};

/**
 * Could these two results plausibly come from the same underlying rate?
 *
 * Overlapping intervals mean the difference is not established — which is
 * weaker than proving they are the same, and is the honest thing to say
 * from two batches. A proper paired test on matched cases comes with the
 * interventions work in slice 6.
 *
 * Non-overlap is the conservative direction: it is decent evidence of a
 * real difference. Overlap simply means "not shown", not "no effect".
 */
export const overlaps = (a: Interval, b: Interval): boolean =>
  a.trials > 0 && b.trials > 0 && a.lower <= b.upper && b.lower <= a.upper;

/**
 * How many trials before an interval is narrower than `width`?
 *
 * Worth knowing before spending twenty minutes on a batch. At 50% — the
 * widest case — reaching ±10% takes 97 runs, four times the current golden
 * set. The 24-case set cannot resolve differences smaller than roughly 20
 * points, and pretending otherwise is the failure this whole file guards
 * against.
 *
 * Rounds up. The commonly quoted figure for ±10% is 96, which is 96.04
 * rounded to nearest — but 96 runs leaves the interval fractionally wider
 * than the one that was asked for.
 */
export const trialsForWidth = (width: number, level = 0.95): number => {
  const z = zFor(level);
  // Worst case p = 0.5, where the interval is widest.
  return Math.ceil((z * z * 0.25) / ((width / 2) * (width / 2)));
};
