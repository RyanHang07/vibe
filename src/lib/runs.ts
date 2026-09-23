import { prisma } from "@/lib/db";
import type { Provider } from "@/lib/models";

/**
 * Recording what the agent did.
 *
 * Slice 1 of docs/PLAN.md. This module only writes down what happened — it
 * makes no judgement about whether a run was good. That comes in slice 2,
 * once there is a build result to judge it by.
 *
 * Keeping the writes here rather than inline in `inngest/functions.ts` means
 * the agent code stays readable, and the recording can be tested on its own.
 */

export type StartRunInput = {
  projectId: string;
  prompt: string;
  provider: Provider;
  model: string;
  source?: "USER" | "EVAL";
  /** Golden-set case id, for EVAL runs. */
  caseId?: string;
  /** Which agent configuration this run used. */
  configVersion?: string;
  /** Which E2B template it generated against. */
  sandboxTemplate?: string;
};

/** Opens a run. Returns the id, which `finishRun` needs. */
export const startRun = async ({
  projectId,
  prompt,
  provider,
  model,
  source = "USER",
  caseId,
  configVersion,
  sandboxTemplate,
}: StartRunInput): Promise<string> => {
  const run = await prisma.run.create({
    data: {
      projectId,
      prompt,
      provider,
      model,
      source,
      caseId,
      configVersion,
      sandboxTemplate,
      status: "RUNNING",
    },
    select: { id: true },
  });

  return run.id;
};

export type FinishRunInput = {
  runId: string;
  status: "COMPLETED" | "FAILED";
  fileCount?: number;
  hasSummary?: boolean;
  errorMessage?: string;
  inputTokens?: number;
  outputTokens?: number;
  checks?: {
    typecheck: CheckOutcomeInput;
    bundle: CheckOutcomeInput;
  };
};

type CheckOutcomeInput = {
  attempted: boolean;
  succeeded: boolean | null;
  exitCode: number | null;
  output: string | null;
  durationMs: number | null;
};

/**
 * Closes a run.
 *
 * `durationMs` is computed from the row's own `startedAt` rather than passed
 * in, so the clock that measures the run is the clock that started it. A
 * caller-supplied duration would be measuring one machine against another.
 */
export const finishRun = async ({
  runId,
  status,
  fileCount,
  hasSummary,
  errorMessage,
  inputTokens,
  outputTokens,
  checks,
}: FinishRunInput): Promise<void> => {
  const existing = await prisma.run.findUnique({
    where: { id: runId },
    select: { startedAt: true },
  });

  // A missing row means something deleted it mid-run. Losing the record is
  // bad; throwing here and failing the user's generation over telemetry
  // would be worse.
  if (!existing) return;

  const finishedAt = new Date();

  await prisma.run.update({
    where: { id: runId },
    data: {
      status,
      finishedAt,
      durationMs: finishedAt.getTime() - existing.startedAt.getTime(),
      fileCount,
      hasSummary,
      errorMessage,
      inputTokens,
      outputTokens,
      buildAttempted: checks?.bundle.attempted ?? false,
      buildSucceeded: checks?.bundle.succeeded ?? null,
      buildExitCode: checks?.bundle.exitCode ?? null,
      buildStderr: checks?.bundle.output ?? null,
      buildDurationMs: checks?.bundle.durationMs ?? null,

      typecheckAttempted: checks?.typecheck.attempted ?? false,
      typecheckSucceeded: checks?.typecheck.succeeded ?? null,
      typecheckExitCode: checks?.typecheck.exitCode ?? null,
      typecheckStderr: checks?.typecheck.output ?? null,
      typecheckDurationMs: checks?.typecheck.durationMs ?? null,
    },
  });
};

/**
 * Build success rate over completed runs.
 *
 * Only rows where the build was actually attempted count. A run that was
 * never checked is not a failure, and letting nulls fall into the
 * denominator is the easiest way to publish a number that means nothing.
 *
 * Slice 4 adds a confidence interval around this. Until then, treat the
 * bare percentage as a description of these specific runs and not as an
 * estimate of anything.
 */
export const buildSuccessRate = async (source: "USER" | "EVAL" = "EVAL") => {
  const [succeeded, attempted] = await Promise.all([
    prisma.run.count({ where: { source, buildSucceeded: true } }),
    prisma.run.count({ where: { source, buildSucceeded: { not: null } } }),
  ]);

  return {
    succeeded,
    attempted,
    rate: attempted === 0 ? null : succeeded / attempted,
  };
};

/**
 * Runs that opened and never closed.
 *
 * A crash between `startRun` and `finishRun` leaves a row stuck in RUNNING.
 * That is deliberate — a stuck row is evidence, where a deleted one is
 * silence — but it means RUNNING rows must be excluded from any rate, or
 * they quietly count as failures. Slice 4 uses this.
 */
export const findStuckRuns = (olderThanMs = 60 * 60 * 1000) =>
  prisma.run.findMany({
    where: {
      status: "RUNNING",
      startedAt: { lt: new Date(Date.now() - olderThanMs) },
    },
    orderBy: { startedAt: "desc" },
  });
