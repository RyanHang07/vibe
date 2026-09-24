/**
 * Wilson intervals, for the app.
 *
 * WHAT IS LEFT HERE AND WHY
 *
 * This file used to hold the whole statistical layer: intervals, the
 * variance split, minimum detectable effect, paired comparison. All of it
 * now lives in `analysis/datum_analysis/stats.py`, and the scripts that
 * used it have been deleted — two implementations of the same statistics is
 * two places to be wrong, and the one nobody runs drifts.
 *
 * `wilsonInterval` survived the cut because the application itself needs
 * it at request time. The landing page reports the false-success rate and
 * the evidence panel reports per-project rates, both through tRPC, and
 * neither can shell out to Python to render a number.
 *
 * SO ONE FUNCTION IS DUPLICATED, DELIBERATELY, AND IT IS WORTH NAMING.
 *
 * The seam this project split on is write-versus-read: the harness records
 * runs, the analysis interprets them. The app breaks that cleanly by doing
 * a little interpretation of its own. Rather than pretend otherwise, the
 * duplicated surface is kept as small as it can be — one function and its
 * type — and both copies keep their tests. `analysis/tests/test_stats.py`
 * is a deliberate line-for-line port of `stats.test.ts` precisely so the
 * two cannot drift without something going red.
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
 * at small samples.
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
