/**
 * App-level constants that used to be magic numbers inside
 * `src/inngest/functions.ts`. See docs/AUDIT.md S5.
 *
 * Everything here is environment-overridable so a value can be changed
 * without a deploy — which is what makes A/B-ing an intervention possible
 * (docs/PLAN.md, "What act means").
 */

const int = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

/**
 * E2B sandbox template.
 *
 * This shipped as the literal "vibe-nextjs-ryan-test-2" — a personal test
 * template, hardcoded in the run path.
 */
export const SANDBOX_TEMPLATE =
  process.env.VIBE_SANDBOX_TEMPLATE ?? "vibe-nextjs-ryan-test-2";

/** How long a sandbox stays alive. Was written as `3 * 10 * 60_000`. */
export const SANDBOX_TIMEOUT_MS = int(
  process.env.VIBE_SANDBOX_TIMEOUT_MS,
  30 * 60 * 1_000,
);

/**
 * Maximum agent iterations before the network gives up.
 *
 * Hitting this produces no summary, which currently surfaces to the user as
 * the same "Something went wrong" as a sandbox failure or a model error.
 * Distinguishing the two is tracked in docs/AUDIT.md S4.
 */
export const MAX_AGENT_ITERATIONS = int(process.env.VIBE_MAX_ITERATIONS, 15);

/** Prior messages replayed into agent state as conversation context. */
export const MESSAGE_HISTORY_DEPTH = int(process.env.VIBE_HISTORY_DEPTH, 5);
