/**
 * Interventions as versioned objects.
 *
 * Slice 6 of docs/PLAN.md, and the point of the whole project.
 *
 * Everything here changes how the agent behaves. Each change gets a version
 * bump, every Run records the version it ran under, and the baseline can
 * then compare like with like. Without that, a change and its effect are
 * separated by "I think I was on the old settings then", which is not
 * evidence.
 *
 * RULES
 *
 *   1. Change one thing per version. Two changes and one number tell you
 *      nothing about either.
 *   2. Bump CONFIG_VERSION in the same commit as the change. A version that
 *      lags the code labels runs with the wrong configuration, which is
 *      worse than not labelling them.
 *   3. Write down what you expected *before* running. Predicting after the
 *      fact is how a null result becomes a success story.
 */

/**
 * v3: the template changed, so the target changed.
 *
 * The rebuild moved create-next-app 15.3.3 → 16, replaced `add --all` with
 * an explicit 29-component list, and fixed ownership so the sandbox is
 * writable by the user the SDK runs as. All three change what "correct
 * output" means, which makes pre-v3 runs incomparable to post-v3 ones —
 * not worse, not better, just answering a different question.
 *
 * `sandboxTemplate` is now recorded per run as well, so the target is
 * identifiable from the data rather than from memory.
 */
// export const CONFIG_VERSION = "v3-nextjs16-truncate";
/**
 * v6: tool output capped at 1000 characters instead of 4000.
 *
 * THE INTERVENTION, AND THE ONLY ONE IN THIS VERSION
 *
 * One change from v5: `VIBE_TOOL_OUTPUT_LIMIT` 4000 → 1000. The template,
 * the model, the prompt, the iteration cap and the case set are all
 * unchanged, which is what makes the comparison mean anything.
 *
 * THE PREDICTION, WRITTEN BEFORE RUNNING — see the v4 block below, which
 * was written before any of this and is deliberately left intact rather
 * than tidied up after the fact.
 *
 * WHAT THIS EXPERIMENT CAN AND CANNOT SEE
 *
 * `npm run power` on v3 put the paired resolution at 11.5s against a 42.9s
 * mean — 27%. Truncation plausibly moves agent time by 5-15%. So the honest
 * expectation is NOT RESOLVED, and that is known in advance rather than
 * discovered afterwards.
 *
 * That is the point. A null result with its bound stated ("any effect below
 * ~11.5s is invisible to this design") is a real finding. The same null
 * reported as "truncation had no effect" would be a false one, and the
 * difference between those two sentences is most of what this project is
 * about.
 *
 * If it does resolve, check the typecheck rate before calling it a win.
 */
export const CONFIG_VERSION = "v6-pinned-truncate-1000";

/**
 * v5: the template gained the packages the agent assumes, and pinned them.
 *
 * `shapes` attributed 7 of 26 code failures in v3 to the target rather than
 * the agent: 4 × missing `tailwind-merge`, 3 × lucide brand icons removed at
 * some unrecorded version. Both are now installed and pinned.
 *
 * That changes what "correct output" means, so v5 is a prerequisite and not
 * a measured intervention — the same call made for the Next 16 bump at v3.
 *
 * TRUNCATION IS BACK AT 4000 ON PURPOSE. v4 was to be the 1000 test, and it
 * never ran. Shipping it together with a template change would move two
 * things at once and rule 1 exists to prevent exactly that: one number
 * afterwards would say nothing about either. The 1000 test becomes v6, run
 * against a v5 baseline.
 *
 * Superseded by v6 above. The comment stays: v5 rows in the database still
 * claim that version, and a note that vanishes when the version does makes
 * past runs unreadable.
 */

/**
 * v1 → v2: cap tool output fed back to the model.
 *
 * THE OBSERVATION
 *
 * Runs on `moderate-01` and four of five adversarial cases failed with
 * `AIGatewayError: unsuccessful status code: 400` after 300-400 seconds and
 * zero files. Concentrated in long, multi-step generations.
 *
 * THE CAUSE
 *
 * `terminal` returned `result.stdout` in full, and `readFiles` returned
 * every requested file's entire contents as JSON. Both land in the
 * conversation and stay there for every following iteration. With
 * `maxIter` at 15, one `npm install` — tens of kilobytes — is replayed
 * fifteen times. The context window fills and the provider rejects the
 * request.
 *
 * THE PREDICTION, WRITTEN BEFORE RUNNING
 *
 *   - 400s on moderate and complex cases should largely disappear.
 *   - Adversarial 400s may persist: those runs fail for lack of anything
 *     achievable, not only for context.
 *   - Typecheck and bundle rates on cases that already completed should be
 *     unchanged. If they move, truncation is hiding something the agent
 *     needed, and that is a regression rather than a win.
 *
 * The third prediction is the one that matters. A change that fixes the
 * failure and quietly degrades everything else still looks like a success
 * in a single headline number.
 */
export const TOOL_OUTPUT_LIMIT = Number.parseInt(
  process.env.VIBE_TOOL_OUTPUT_LIMIT ?? "4000",
  10,
);

/**
 * The version label and the setting it names must agree.
 *
 * THE FAILURE THIS PREVENTS
 *
 * The intervention lives in two places: `CONFIG_VERSION` in this file, and
 * `VIBE_TOOL_OUTPUT_LIMIT` in the environment. Moving one without the other
 * takes about two seconds and produces runs labelled `v4` that ran `v3`
 * settings, or the reverse.
 *
 * Nothing downstream could detect that. `compare` would dutifully pair the
 * arms, difference them, and report a clean interval around zero — a
 * well-formed, tightly-bracketed measurement of nothing, which is precisely
 * the failure mode this project exists to argue about. Rule 2 asks a human
 * to remember; this asks the process to refuse.
 *
 * Versions from v4 onward encode the limit in the name, so the label is
 * checkable against reality. `v3-nextjs16-truncate` predates the scheme and
 * is deliberately exempt rather than retro-labelled: rewriting what past
 * runs claim to be is the same sin from the other direction.
 *
 * WHAT THIS CHECK CANNOT DO, AND IT IS IMPORTANT
 *
 * It checks the process it runs in. `preflight()` calls it from the eval
 * script, but the agent does not run there — it runs inside the Next dev
 * server, a separate process with its own environment. The script passing
 * says nothing about what the agent used.
 *
 * So this is a convenience that catches the common mistake, not a
 * guarantee. The guarantee is `toolOutputLimit`, recorded on each Run from
 * inside the agent, which reports what was actually applied rather than
 * what a launcher believed. Trusting this assertion alone would be another
 * instance of recording one thing as another.
 */
export const assertConfigConsistent = (
  version = CONFIG_VERSION,
  limit = TOOL_OUTPUT_LIMIT,
): void => {
  if (!Number.isFinite(limit) || limit <= 0) {
    throw new Error(
      `VIBE_TOOL_OUTPUT_LIMIT is "${process.env.VIBE_TOOL_OUTPUT_LIMIT}", ` +
        "which is not a positive number. Runs would record a config that " +
        "does not describe them.",
    );
  }

  const declared = /-truncate-(\d+)$/.exec(version);
  if (!declared) return;

  const expected = Number.parseInt(declared[1], 10);
  if (expected !== limit) {
    throw new Error(
      `CONFIG_VERSION is "${version}" but VIBE_TOOL_OUTPUT_LIMIT is ${limit}.\n` +
        `The label says ${expected}. One of them was changed without the other, ` +
        "and every run from here would be recorded under a configuration it " +
        "did not run.\n" +
        "Set VIBE_TOOL_OUTPUT_LIMIT in .env to match, or fix CONFIG_VERSION.",
    );
  }
};

/**
 * v4, PENDING — written before running. Not yet active.
 *
 * `CONFIG_VERSION` is deliberately still v3. Rule 2 says the bump ships in
 * the same commit as the change, and the change is a value of
 * `VIBE_TOOL_OUTPUT_LIMIT`, set at eval time. This block exists now so the
 * prediction is on record before any number is.
 *
 * THE CHANGE
 *
 *   VIBE_TOOL_OUTPUT_LIMIT=4000  →  1000, and CONFIG_VERSION → v4.
 *
 * WHY IT IS BEING TESTED AT ALL
 *
 * v2's stated cause was wrong. The 400s were `agent.run("")` on an empty
 * summary, not context exhaustion — a "Hello world" page failed too, which
 * context exhaustion never explained. So truncation was never actually
 * measured against the problem it was written for, and it is now being
 * tested as what it plainly is: a change to how much text is replayed into
 * the model on every iteration.
 *
 * THE PREDICTION
 *
 *   1. Median time to a passing generation falls. Fewer replayed tokens
 *      per iteration is less to read, on every iteration.
 *   2. The p10-p90 spread narrows more than the median moves. The long
 *      runs are the ones carrying large tool output; the short ones never
 *      hit the cap and cannot change.
 *   3. Typecheck and bundle rates do not move outside their intervals.
 *      They cannot be shown to improve at ~90% against a 100% ceiling, so
 *      this prediction can only be falsified, not confirmed.
 *   4. If the rates drop, truncation is removing something the agent
 *      needed. That is a regression, and a faster wrong answer is worse
 *      than a slow right one.
 *
 * The honest expectation is (1) small and (3) flat, reported as "no
 * distinguishable effect on quality, a measurable one on latency". That is
 * a null result on the headline and it gets published as one.
 */

/**
 * Truncate tool output, keeping both ends.
 *
 * Not the tail alone, which is what the build check wants. A command's
 * opening lines say what ran and a failure summary lands at the end, so
 * both halves carry signal — and the model needs to know something was
 * removed, or it will reason about the gap as though it were empty.
 */
/**
 * Did the intervention fire at all?
 *
 * THE QUESTION THIS ANSWERS, AND WHY IT COMES FIRST
 *
 * Truncation only does anything when a tool returns more than the limit.
 * If tool output on this golden set is routinely under 4000 characters,
 * then v3 and v4 are the same configuration wearing different labels, and
 * comparing them measures nothing — no matter how much statistical power
 * the design has. Power answers "could we see an effect this size"; this
 * answers the prior question, "was there an intervention".
 *
 * Nothing recorded so far could distinguish "truncation had no effect" from
 * "truncation never happened", and those need completely different write-ups.
 *
 * A LOWER BOUND, DELIBERATELY
 *
 * The counter lives in memory for one function invocation and increments
 * inside `step.run` bodies. Inngest replays a function by returning memoized
 * values for steps that already completed, so those bodies do not re-execute
 * and their increments are not repeated. The count is therefore a floor, not
 * a total.
 *
 * That is stated rather than fixed because a floor answers the question
 * being asked. "Truncation fired at least 6 times" settles that the
 * intervention is live. It is used for nothing else, and specifically not
 * as a denominator.
 */
export type TruncationLedger = {
  /** Times the limit was exceeded. A floor — see above. */
  events: number;
  /** Characters removed across those events. Also a floor. */
  charactersRemoved: number;
  /**
   * Largest single tool output seen, truncated or not. Also a floor, for
   * the same replay reason, and the useful one: if this never approaches
   * the limit, truncation is inert and the experiment is comparing a
   * configuration with itself.
   */
  largestOutput: number;
  apply: (text: string) => string;
};

export const createTruncationLedger = (
  limit = TOOL_OUTPUT_LIMIT,
): TruncationLedger => {
  const ledger: TruncationLedger = {
    events: 0,
    charactersRemoved: 0,
    largestOutput: 0,
    apply: (text: string) => {
      ledger.largestOutput = Math.max(ledger.largestOutput, text.length);

      if (text.length > limit) {
        ledger.events += 1;
        ledger.charactersRemoved += text.length - limit;
      }

      return truncateForModel(text, limit);
    },
  };

  return ledger;
};

export const truncateForModel = (
  text: string,
  limit = TOOL_OUTPUT_LIMIT,
): string => {
  if (text.length <= limit) return text;

  const half = Math.floor(limit / 2);
  const removed = text.length - limit;

  return [
    text.slice(0, half),
    `\n\n… ${removed} characters omitted …\n\n`,
    text.slice(-half),
  ].join("");
};
