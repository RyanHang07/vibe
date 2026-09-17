import { getSandbox } from "./utils";
import { infrastructureFault, markFault } from "@/lib/faults";
import {
  BUILD_CHECK_ENABLED,
  BUILD_CHECK_USER_SAMPLE_RATE,
  BUILD_STDERR_LIMIT,
  BUNDLE_COMMAND,
  BUNDLE_TIMEOUT_MS,
  CHECK_PREPARE_COMMAND,
  PREPARE_TIMEOUT_MS,
  TYPECHECK_COMMAND,
  TYPECHECK_TIMEOUT_MS,
} from "@/lib/config";

/**
 * Does the generated code hold up?
 *
 * Slice 2 of docs/PLAN.md, now answering two questions instead of one:
 *
 *   - **typecheck** — `tsc --noEmit`. Wrong props, missing imports, a
 *     hallucinated API. The most common way generated code is wrong.
 *   - **bundle** — `next build --no-lint`. Syntax the compiler rejects, a
 *     client/server boundary violation, an unresolvable import.
 *
 * Kept apart deliberately. "62% of generations build" says less than
 * "88% typecheck, 71% bundle", because the second tells you where to
 * intervene. Averaging things that fail for different reasons is the same
 * mistake as letting `null` collapse into `false`.
 *
 * Both run against a copy in /tmp, never against /home/user: `.next` there
 * belongs to the dev server serving the user's live preview.
 */

export type CheckOutcome = {
  attempted: boolean;
  /** null means "could not be judged" — never the same as failure. */
  succeeded: boolean | null;
  exitCode: number | null;
  output: string | null;
  durationMs: number | null;
};

export type CheckResults = {
  typecheck: CheckOutcome;
  bundle: CheckOutcome;
};

const NOT_ATTEMPTED: CheckOutcome = {
  attempted: false,
  succeeded: null,
  exitCode: null,
  output: null,
  durationMs: null,
};

const NOTHING_RUN: CheckResults = {
  typecheck: NOT_ATTEMPTED,
  bundle: NOT_ATTEMPTED,
};

/**
 * Keep the tail, not the head. Build tools print progress first and the
 * failure summary last, so truncating from the front reliably discards the
 * only lines worth having.
 */
const tail = (value: string, limit = BUILD_STDERR_LIMIT): string =>
  value.length <= limit
    ? value
    : `…truncated ${value.length - limit} chars…\n${value.slice(-limit)}`;

/**
 * BOTH STREAMS. This was `stderr || stdout`, which is wrong in a way that
 * cost several rounds of debugging.
 *
 * `next build` writes progress to stdout and warnings to stderr, so a
 * single line on stderr — `⚠ Linting is disabled.` — discarded the entire
 * build log. Every bundle timeout reported that one warning and nothing
 * else, which made it look as though the build had produced no output at
 * all rather than plenty that was being thrown away.
 *
 * A capture that silently drops the useful half is worse than no capture,
 * because it looks like evidence.
 */
const combine = (stdout: string, stderr: string): string => {
  const parts: string[] = [];
  if (stdout.trim()) parts.push(`--- stdout ---\n${stdout.trim()}`);
  if (stderr.trim()) parts.push(`--- stderr ---\n${stderr.trim()}`);
  return parts.join("\n\n");
};

const exitCodeFrom = (error: unknown): number | null => {
  if (typeof error === "object" && error !== null && "exitCode" in error) {
    const code = (error as { exitCode: unknown }).exitCode;
    if (typeof code === "number") return code;
  }
  return null;
};

const messageFrom = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** e2b attaches the command's output to the thrown error. */
const streamsFrom = (error: unknown): string => {
  if (typeof error !== "object" || error === null) return "";
  const record = error as Record<string, unknown>;
  return [record.stderr, record.stdout]
    .filter((value): value is string => typeof value === "string")
    .join("\n");
};

type Sandbox = Awaited<ReturnType<typeof getSandbox>>;

/** Run one command and turn its result into an outcome. */
const runCommand = async (
  sandbox: Sandbox,
  command: string,
  timeoutMs: number,
): Promise<CheckOutcome> => {
  const startedAt = Date.now();

  // Declared outside the try so the catch can see them. They lived inside
  // it once, and the catch — the path that matters — fell back to e2b's
  // error message, which is the string "exit status 1".
  let stdout = "";
  let stderr = "";

  try {
    const result = await sandbox.commands.run(command, {
      timeoutMs,
      onStdout: (data: string) => {
        stdout += data;
      },
      onStderr: (data: string) => {
        stderr += data;
      },
    });

    return {
      attempted: true,
      succeeded: result.exitCode === 0,
      exitCode: result.exitCode,
      output: tail(combine(stdout, stderr)),
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    const exitCode = exitCodeFrom(error);

    const streamed = combine(stdout, stderr);
    const fromError = streamsFrom(error);

    const captured =
      [streamed, fromError].find((t) => t.trim().length > 0) ??
      messageFrom(error);

    const durationMs = Date.now() - startedAt;
    const fault = infrastructureFault(captured);

    // A timeout leaves no exit code and no error text worth reading, so say
    // so plainly. "It stopped" and "it failed" look identical in a log
    // otherwise, and only one of them is about the code.
    const timedOut = durationMs >= timeoutMs - 1_000;
    const annotated = timedOut
      ? `[timed out after ${Math.round(durationMs / 1000)}s]\n${captured}`
      : captured;

    return {
      attempted: true,
      // A non-zero exit is a real failure *unless* the output names an
      // infrastructure fault, in which case the run says nothing about the
      // code and must stay unknown.
      succeeded: fault !== null || exitCode === null ? null : false,
      exitCode,
      output: fault ? tail(markFault(fault, annotated)) : tail(annotated),
      durationMs,
    };
  }
};

/**
 * Eval runs are always checked. User runs only at the configured sample
 * rate, default zero: the checks occupy the sandbox serving their preview.
 */
export const shouldBuildCheck = (
  source: "USER" | "EVAL",
  sampleRate: number = BUILD_CHECK_USER_SAMPLE_RATE,
  roll: number = Math.random(),
): boolean => {
  if (!BUILD_CHECK_ENABLED) return false;
  if (source === "EVAL") return true;
  return Number.isFinite(sampleRate) && sampleRate > 0 && roll < sampleRate;
};

export const runBuildCheck = async (
  sandboxId: string,
  fileCount: number,
  source: "USER" | "EVAL" = "EVAL",
): Promise<CheckResults> => {
  if (!shouldBuildCheck(source)) return NOTHING_RUN;

  // Nothing was written, so there is nothing to check. Recording this as a
  // failure would conflate "produced nothing" with "produced code that does
  // not work" — different problems.
  if (fileCount === 0) return NOTHING_RUN;

  const sandbox = await getSandbox(sandboxId);

  // One copy, both checks. If the copy fails, neither check ran, and
  // neither is evidence about the code.
  const prepared = await runCommand(
    sandbox,
    CHECK_PREPARE_COMMAND,
    PREPARE_TIMEOUT_MS,
  );

  if (prepared.succeeded !== true) {
    const unavailable: CheckOutcome = {
      attempted: false,
      succeeded: null,
      exitCode: prepared.exitCode,
      output: tail(`copy failed before any check ran\n${prepared.output ?? ""}`),
      durationMs: prepared.durationMs,
    };
    return { typecheck: unavailable, bundle: unavailable };
  }

  // Typecheck first. It is the more common failure and the more
  // informative one, so if a timeout is going to eat the budget, better it
  // eats the second check than the first.
  const typecheck = await runCommand(
    sandbox,
    TYPECHECK_COMMAND,
    TYPECHECK_TIMEOUT_MS,
  );

  const bundle = await runCommand(sandbox, BUNDLE_COMMAND, BUNDLE_TIMEOUT_MS);

  return { typecheck, bundle };
};
