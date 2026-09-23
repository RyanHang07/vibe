/**
 * Run evidence, exposed to the UI.
 *
 * Phase D of docs/BUILD_PLAN.md. Everything the harness knows has lived in
 * CLI scripts and markdown; this is the seam that lets the product show it.
 *
 * TWO RULES CARRIED OVER FROM THE SCRIPTS, BECAUSE THE UI CAN BREAK THEM
 * JUST AS EASILY
 *
 *   1. `null` is not `false`. A check that could not decide is `unknown`,
 *      never a failure, and the types here keep all three states rather
 *      than collapsing to a boolean for the convenience of a badge.
 *   2. A rate needs its interval. `formatInterval` exists so the number and
 *      the bracket travel together and a component cannot render one
 *      without the other.
 */

import { z } from "zod";

import { createTRPCRouter, baseProcedure, protectedProcedure } from "@/trpc/init";
import { prisma } from "@/lib/db";
import { wilsonInterval } from "@/lib/stats";
import { classify } from "@/lib/taxonomy";
import { hasServerKey } from "@/lib/models";

/** pass / fail / unknown, never a boolean. */
export type Verdict = "pass" | "fail" | "unknown" | "not-run";

const verdict = (attempted: boolean, succeeded: boolean | null): Verdict => {
  if (!attempted) return "not-run";
  if (succeeded === null) return "unknown";
  return succeeded ? "pass" : "fail";
};

export const runsRouter = createTRPCRouter({
  /**
   * What the client needs to know about how this deployment is configured.
   *
   * Only booleans leave the server. The question "is a user key required"
   * has a true answer that the form should render rather than assert; the
   * key itself never travels.
   */
  config: baseProcedure.query(async () => ({
    requiresUserKey: !hasServerKey(),
  })),

  /**
   * The headline for the landing page.
   *
   * Public on purpose: it is the claim the page makes, and a claim only a
   * signed-in user can see is not a claim the page makes.
   *
   * It reports the false-success rate — how often the app told a user it
   * worked on code that does not compile. That is the finding the whole
   * project exists to produce, and it is about the application rather than
   * about any one person's project, so it is drawn from every judged run.
   */
  summary: baseProcedure.query(async () => {
    const runs = await prisma.run.findMany({
      where: { buildSucceeded: { not: null } },
      select: {
        hasSummary: true,
        buildSucceeded: true,
        typecheckSucceeded: true,
        configVersion: true,
      },
    });

    const judged = runs.length;
    const claimed = runs.filter((run) => run.hasSummary).length;
    const falsePass = runs.filter(
      (run) => run.hasSummary && !run.buildSucceeded,
    ).length;

    const typechecked = runs.filter((run) => run.typecheckSucceeded !== null);
    const typecheckOk = typechecked.filter((r) => r.typecheckSucceeded).length;

    /**
     * Returned even when it is zero-width or undefined, rather than hidden.
     * A page that shows a rate only once it looks good is not reporting.
     */
    return {
      judged,
      falseSuccess:
        claimed > 0 ? wilsonInterval(falsePass, claimed) : null,
      typecheck:
        typechecked.length > 0
          ? wilsonInterval(typecheckOk, typechecked.length)
          : null,
      /** Distinct agent configurations behind these numbers. */
      configs: [...new Set(runs.map((r) => r.configVersion ?? "unversioned"))],
    };
  }),

  /**
   * The run currently in flight for a project, if there is one.
   *
   * Returns `null` rather than an empty object when nothing is running, so
   * the caller distinguishes "no active run" from "an active run with no
   * stage yet". Those look the same through an optional chain and mean
   * different things: the second is a run that has started and not yet
   * reported, which is exactly the window the loading card covers.
   */
  active: protectedProcedure
    .input(z.object({ projectId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      const run = await prisma.run.findFirst({
        where: {
          projectId: input.projectId,
          status: "RUNNING",
          project: { userId: ctx.auth.userId },
        },
        orderBy: { startedAt: "desc" },
        select: {
          id: true,
          stage: true,
          startedAt: true,
          typecheckSucceeded: true,
          buildSucceeded: true,
        },
      });

      if (!run) return null;

      return {
        id: run.id,
        stage: run.stage,
        startedAt: run.startedAt,
        typecheck: verdict(run.typecheckSucceeded !== null, run.typecheckSucceeded),
        bundle: verdict(run.buildSucceeded !== null, run.buildSucceeded),
      };
    }),

  /**
   * Every recorded run for one project, newest first.
   *
   * Protected and ownership-checked: runs carry compiler output from a
   * user's generated code, which is theirs.
   */
  byProject: protectedProcedure
    .input(z.object({ projectId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      const project = await prisma.project.findFirst({
        where: { id: input.projectId, userId: ctx.auth.userId },
        select: { id: true },
      });

      if (!project) return [];

      const runs = await prisma.run.findMany({
        where: { projectId: input.projectId },
        orderBy: { startedAt: "desc" },
        take: 50,
      });

      return runs.map((run) => {
        const failureText = run.typecheckSucceeded === false
          ? run.typecheckStderr
          : run.buildSucceeded === false
            ? run.buildStderr
            : null;

        return {
          id: run.id,
          startedAt: run.startedAt,
          status: run.status,
          durationMs: run.durationMs,
          fileCount: run.fileCount,

          typecheck: verdict(run.typecheckAttempted, run.typecheckSucceeded),
          bundle: verdict(run.buildAttempted, run.buildSucceeded),

          /**
           * What the agent claimed, kept beside what the checks found.
           * Showing only the verdict would lose the comparison that is the
           * entire point.
           */
          agentClaimedSuccess: run.hasSummary,

          /** Raw compiler output, not a summary of it. */
          output: failureText,

          /** Same deterministic taxonomy the CLI uses. */
          shape: failureText ? classify(failureText).signature : null,

          /** A verdict is only meaningful against a known target. */
          configVersion: run.configVersion,
          sandboxTemplate: run.sandboxTemplate,
        };
      });
    }),
});
