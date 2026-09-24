/**
 * Environment variables, with the `VIBE_` → `DATUM_` rename enforced.
 *
 * WHY THIS IS NOT A FIND-AND-REPLACE
 *
 * Every setting here has a fallback. That is the point — a value can be
 * changed without a deploy, which is what makes A/B-ing an intervention
 * possible. It is also what makes renaming them dangerous: a `VIBE_`
 * variable left in a `.env` after the code stopped reading it does not
 * error. The app silently uses the default instead, and the only symptom is
 * that a configuration you believe is applied is not.
 *
 * This project has already been bitten by that exact shape twice. A stale
 * `ANTHROPIC_API_KEY` in the shell environment silently beat `.env` and
 * billed an unexpected account. `CONFIG_VERSION` and
 * `VIBE_TOOL_OUTPUT_LIMIT` disagreeing would have produced runs labelled
 * with a configuration they did not run — which is why
 * `assertConfigConsistent` exists.
 *
 * So the rename refuses to be silent. If a legacy `VIBE_` variable is set
 * and its `DATUM_` replacement is not, this throws and names both. A
 * broken start is loud; a wrong default is not.
 */

const LEGACY_PREFIX = "VIBE_";
const PREFIX = "DATUM_";

/**
 * Read `DATUM_<name>`, refusing to ignore a leftover `VIBE_<name>`.
 *
 * Takes the bare name — `env("MAX_ITERATIONS")`, not the full variable —
 * so the prefix lives in one place and a future rename is one edit rather
 * than thirty.
 */
export const env = (name: string): string | undefined => {
  const current = process.env[`${PREFIX}${name}`];
  const legacy = process.env[`${LEGACY_PREFIX}${name}`];

  if (legacy !== undefined && current === undefined) {
    throw new Error(
      `${LEGACY_PREFIX}${name} is set but the app now reads ${PREFIX}${name}.\n\n` +
        `Rename it in your .env (and in any deployment environment):\n` +
        `  ${LEGACY_PREFIX}${name}=…  ->  ${PREFIX}${name}=…\n\n` +
        "Failing rather than falling back to the default, because a " +
        "setting you believe is applied and is not is the worst of the " +
        "three possible outcomes.",
    );
  }

  return current;
};

/** `env`, parsed as an integer, with a fallback. */
export const envInt = (name: string, fallback: number): number => {
  const parsed = Number.parseInt(env(name) ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

/** `env`, parsed as a float, with a fallback. */
export const envFloat = (name: string, fallback: number): number => {
  const parsed = Number.parseFloat(env(name) ?? "");
  return Number.isFinite(parsed) ? parsed : fallback;
};

/**
 * `env`, as a boolean. Anything other than the literal `"false"` is true,
 * matching the previous `!== "false"` checks — an unset variable means the
 * feature is on.
 */
export const envFlag = (name: string, fallback = true): boolean => {
  const value = env(name);
  if (value === undefined) return fallback;
  return value !== "false";
};
