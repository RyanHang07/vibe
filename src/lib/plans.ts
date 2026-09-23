/**
 * Plan allowances.
 *
 * WHY THESE LIVE ALONE RATHER THAN IN `lib/usage.ts`
 *
 * `usage.ts` imports Prisma and Clerk's server SDK, so it cannot be
 * imported by a client component — the pricing page needs the numbers and
 * would pull a database client into the browser bundle trying to get them.
 *
 * The alternative is typing the figures into the page. These constants
 * already shipped inverted once (AUDIT S2): FREE at 10000 against PRO at
 * 100, with a comment claiming 100 while the code said otherwise. A
 * marketing page quoting its own copy of the numbers is a second place for
 * that to happen, and the one nobody thinks to check.
 *
 * So: one definition, client-safe, imported by both.
 */

/** Generations included per billing window, by plan. */
export const FREE_POINTS = 5;
export const PRO_POINTS = 100;

/** 30 days, in seconds. */
export const DURATION = 30 * 24 * 60 * 60;

export const GENERATION_COST = 1;

/**
 * The invariant that makes the S2 inversion impossible to reintroduce
 * silently. Throws at import, so a bad pair fails the build rather than
 * shipping a free plan more generous than the paid one.
 */
if (PRO_POINTS <= FREE_POINTS) {
  throw new Error(
    `Plan allowances are inverted: PRO_POINTS (${PRO_POINTS}) must exceed FREE_POINTS (${FREE_POINTS}).`,
  );
}
