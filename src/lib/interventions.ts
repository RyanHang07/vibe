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

export const CONFIG_VERSION = "v2-truncate-tool-output";

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
 * Truncate tool output, keeping both ends.
 *
 * Not the tail alone, which is what the build check wants. A command's
 * opening lines say what ran and a failure summary lands at the end, so
 * both halves carry signal — and the model needs to know something was
 * removed, or it will reason about the gap as though it were empty.
 */
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
