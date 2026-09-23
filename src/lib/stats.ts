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

/* ------------------------------------------------------------------ *
 * Continuous measures: can this design resolve anything?
 * ------------------------------------------------------------------ */

export type VarianceSplit = {
  /** Number of groups (cases) with at least one observation. */
  groups: number;
  /** Number of groups with at least two, which is what within-group needs. */
  groupsWithRepeats: number;
  observations: number;
  grandMean: number;
  /** Spread of the group means around the grand mean. */
  betweenSd: number;
  /** Pooled spread of observations around their own group mean. */
  withinSd: number;
  /** Spread ignoring groups entirely. */
  totalSd: number;
};

/**
 * Split the spread of a continuous measure into between-group and
 * within-group parts.
 *
 * WHY THIS DECIDES WHETHER AN EXPERIMENT IS WORTH RUNNING
 *
 * Agent time on the golden set varies for two unrelated reasons. A trivial
 * case is fast and an adversarial case is slow — that is between-case
 * variance, and it is enormous. The same case run twice varies too — that is
 * within-case variance, and it is the only part an intervention has to beat.
 *
 * Compare two configs by throwing all runs into two buckets and the
 * between-case variance lands in the noise term, even though both configs
 * ran the same cases. The experiment then needs a vast effect to clear a
 * bar made mostly of "trivial-01 is not complex-03".
 *
 * Pair on the case and that term cancels. It is the same reasoning as a
 * before-and-after measurement on the same subject, and it is usually worth
 * several times the sample size.
 *
 * Groups with a single observation still count toward the between term.
 * They contribute nothing to the within term and are not pretended to.
 */
export const varianceSplit = (
  groups: Map<string, number[]>,
): VarianceSplit => {
  const all = [...groups.values()].flat();
  const n = all.length;

  if (n === 0) {
    return {
      groups: 0,
      groupsWithRepeats: 0,
      observations: 0,
      grandMean: Number.NaN,
      betweenSd: Number.NaN,
      withinSd: Number.NaN,
      totalSd: Number.NaN,
    };
  }

  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const grandMean = mean(all);

  const groupMeans = [...groups.values()]
    .filter((xs) => xs.length > 0)
    .map(mean);

  /**
   * Sample standard deviations, dividing by (count - 1).
   *
   * Dividing by the count understates the spread, which here would
   * understate the noise floor and make an underpowered experiment look
   * adequate. That is the direction of error this whole file exists to
   * avoid, so the conservative denominator is not optional.
   */
  const sampleSd = (xs: number[], centre: number, dof: number) =>
    dof <= 0
      ? Number.NaN
      : Math.sqrt(
          xs.reduce((s, x) => s + (x - centre) ** 2, 0) / dof,
        );

  const withRepeats = [...groups.values()].filter((xs) => xs.length >= 2);

  // Pooled within-group: every deviation from its own group mean, with one
  // degree of freedom spent per group that contributed.
  const withinDeviations = withRepeats.flatMap((xs) => {
    const m = mean(xs);
    return xs.map((x) => x - m);
  });
  const withinDof = withinDeviations.length - withRepeats.length;

  return {
    groups: groupMeans.length,
    groupsWithRepeats: withRepeats.length,
    observations: n,
    grandMean,
    betweenSd: sampleSd(groupMeans, mean(groupMeans), groupMeans.length - 1),
    withinSd: sampleSd(withinDeviations, 0, withinDof),
    totalSd: sampleSd(all, grandMean, n - 1),
  };
};

/**
 * Smallest difference in means a two-arm comparison could detect.
 *
 * Returns the effect size at which a test would reach significance roughly
 * half the time — the conventional "minimum detectable effect" at 80% power
 * uses 2.8 standard errors rather than 1.96, because an effect exactly at
 * the significance threshold is missed as often as it is caught.
 *
 * `sd` is the noise the design actually faces: total spread for an unpaired
 * comparison, within-group spread for a paired one. `n` is observations per
 * arm, or pairs.
 */
export const minimumDetectableEffect = (
  sd: number,
  n: number,
  level = 0.95,
): number => {
  if (!Number.isFinite(sd) || n <= 1) return Number.NaN;
  // z for the test plus z for 80% power (0.8416).
  return (zFor(level) + 0.8416212335729143) * sd * Math.sqrt(2 / n);
};

export type PairedResult = {
  /** Cases present in both arms. */
  pairs: number;
  /** Mean of (a - b). Negative means b is faster. */
  meanDifference: number;
  lower: number;
  upper: number;
  level: number;
  /**
   * False when the interval straddles zero. "Not shown" — which is not the
   * same as "no effect", and the difference is the whole discipline.
   */
  resolved: boolean;
  /** Cases that appeared in one arm only, and so contribute nothing. */
  dropped: string[];
};

/**
 * Compare two configurations case by case.
 *
 * WHY PAIRED AND NOT TWO BUCKETS
 *
 * Agent time on this golden set has a between-case standard deviation of
 * roughly 65s and a within-case one of roughly 9s. Pooling every run of one
 * config against every run of the other puts that 65s into the noise term,
 * even though both arms ran the identical 24 cases. The experiment then has
 * to beat the difference between `trivial-01` and `complex-03` before it
 * can see anything, and it never had to.
 *
 * Differencing each case against itself cancels the case entirely. What
 * remains is the only variation the intervention could have caused.
 *
 * A case present in one arm only is dropped and named. Substituting the
 * other arm's mean for a missing value would quietly assume the very thing
 * being measured, and a case that failed under one config and not the other
 * is a result about the pass rate, not a data point about latency.
 */
export const pairedDifference = (
  a: Map<string, number[]>,
  b: Map<string, number[]>,
  level = 0.95,
): PairedResult => {
  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;

  const keys = [...new Set([...a.keys(), ...b.keys()])].sort();
  const differences: number[] = [];
  const dropped: string[] = [];

  for (const key of keys) {
    const left = a.get(key);
    const right = b.get(key);

    if (!left?.length || !right?.length) {
      dropped.push(key);
      continue;
    }

    differences.push(mean(left) - mean(right));
  }

  const pairs = differences.length;

  if (pairs < 2) {
    return {
      pairs,
      meanDifference: Number.NaN,
      lower: Number.NaN,
      upper: Number.NaN,
      level,
      resolved: false,
      dropped,
    };
  }

  const centre = mean(differences);
  const sd = Math.sqrt(
    differences.reduce((s, d) => s + (d - centre) ** 2, 0) / (pairs - 1),
  );
  const margin = zFor(level) * (sd / Math.sqrt(pairs));

  const lower = centre - margin;
  const upper = centre + margin;

  return {
    pairs,
    meanDifference: centre,
    lower,
    upper,
    level,
    // Straddling zero means the sign of the effect is unknown. Reporting
    // the point estimate as a result at that stage is how null results
    // become success stories.
    resolved: lower > 0 || upper < 0,
    dropped,
  };
};
