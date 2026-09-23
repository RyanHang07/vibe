/**
 * Read the Run table back.
 *
 *   npm run report              # last 20 runs, both sources
 *   npm run report source=EVAL
 *   npm run report limit=50
 *
 * Front half of slice 4 in docs/PLAN.md. Deliberately prints counts and not
 * rates: a percentage over a handful of runs invites a conclusion the sample
 * cannot support. The confidence interval arrives once there is a real
 * baseline to put one around.
 */

import { markFault } from "../src/lib/faults";
import { prisma } from "../src/lib/db";

const bare = (token: string) => token.replace(/^-+/, "");

const parseArgs = (argv: string[]) => {
  const tokens = argv.map(bare);
  const get = (name: string) => {
    const pair = tokens.find((t) => t.startsWith(`${name}=`));
    return pair?.slice(name.length + 1);
  };

  const limit = Number.parseInt(get("limit") ?? "20", 10);

  return {
    source: get("source") as "USER" | "EVAL" | undefined,
    limit: Number.isFinite(limit) && limit > 0 ? limit : 20,
  };
};

/** `null` and `false` must stay visually distinct — they mean different things. */
const buildCell = (
  attempted: boolean,
  succeeded: boolean | null,
): string => {
  if (!attempted) return "not run";
  if (succeeded === null) return "UNKNOWN";
  return succeeded ? "pass" : "FAIL";
};

const seconds = (ms: number | null) =>
  ms === null ? "—" : `${(ms / 1000).toFixed(1)}s`;

/**
 * Remove rows that are not evidence.
 *
 *   npm run report prune
 *
 * Two kinds qualify, and only two:
 *
 *   - Runs stuck in RUNNING past the threshold. They never finished, so
 *     they say nothing either way, and leaving them in tempts a future
 *     count into treating them as failures.
 *   - Build failures caused by the sandbox rather than the code. The
 *     template shipped a prebuilt `.next` owned by another user, so builds
 *     died with EACCES before compiling anything. Recorded as FAIL before
 *     the environment-fault guard existed.
 *
 * Nothing else is ever deleted. A real build failure is data, however
 * unflattering.
 */
const prune = async (stuckAfterMs = 60 * 60 * 1000) => {
  const stuck = await prisma.run.deleteMany({
    where: {
      status: "RUNNING",
      startedAt: { lt: new Date(Date.now() - stuckAfterMs) },
    },
  });

  // Pre-guard rows: scored false, but the output names an environment
  // fault. Rows recorded after the fix are already UNKNOWN and are left
  // alone, because an honest unknown is worth keeping.
  const environmental = await prisma.run.deleteMany({
    where: {
      buildSucceeded: false,
      OR: [
        { buildStderr: { contains: "EACCES" } },
        { buildStderr: { contains: "ENOSPC" } },
        { buildStderr: { contains: "ENOMEM" } },
      ],
    },
  });

  /**
   * Unjudged builds. These were missing, and they were the bulk of it.
   *
   * `buildSucceeded: null` with `buildAttempted: true` means the check ran
   * and could not decide — the tar whiteout, the permission faults, the
   * timeouts. Every baseline since has reported them as "52 excluded", and
   * prune removed none of them because the old rules only matched
   * `buildSucceeded: false`.
   */
  const unjudged = await prisma.run.deleteMany({
    where: { buildAttempted: true, buildSucceeded: null },
  });

  /**
   * Type failures caused by the harness rather than the code. These carry
   * a real non-zero exit from a real `tsc` diagnostic, so nothing else
   * filters them.
   */
  const harnessTypeErrors = await prisma.run.deleteMany({
    where: {
      typecheckSucceeded: false,
      OR: [
        { typecheckStderr: { contains: "Cannot find name 'LayoutProps'" } },
        { typecheckStderr: { contains: "Cannot find module 'lucide-react'" } },
        { typecheckStderr: { contains: "class-variance-authority" } },
      ],
    },
  });

  /** Runs that never got a case id and so can never be grouped or compared. */
  const unlabelled = await prisma.run.deleteMany({
    where: { source: "EVAL", caseId: null },
  });

  console.log(`pruned ${stuck.count} stuck run(s)`);
  console.log(`pruned ${environmental.count} environment-fault run(s)`);
  console.log(`pruned ${unjudged.count} unjudged build(s)`);
  console.log(`pruned ${harnessTypeErrors.count} harness type failure(s)`);
  console.log(`pruned ${unlabelled.count} run(s) with no caseId`);
  console.log("\nReal failures are never pruned.");
};

/**
 * Delete every run from a configuration other than the current one.
 *
 *   npm run report prune-old
 *
 * Separate from `prune`, and deliberately blunt. Runs from an earlier
 * agent config answer a different question, so they cannot be averaged with
 * current ones — but they are still real results, and deleting them is a
 * choice rather than housekeeping.
 */
const pruneOldConfigs = async () => {
  const { CONFIG_VERSION } = await import("../src/lib/interventions");

  const { count } = await prisma.run.deleteMany({
    where: { source: "EVAL", NOT: { configVersion: CONFIG_VERSION } },
  });

  console.log(`pruned ${count} run(s) from configs other than ${CONFIG_VERSION}`);
};

/**
 * Close out runs that were abandoned rather than finished.
 *
 *   npm run report sweep
 *
 * A run opens as RUNNING before any work starts, so anything that kills the
 * process mid-flight — Ctrl+C, a dev server restart, a crashed function —
 * leaves the row open forever. Nothing resolved them, so they accumulated.
 *
 * They are marked rather than deleted, and marked as an infrastructure
 * fault rather than an agent failure, because that is what they are: the
 * run was interrupted, and it says nothing about the code. Deleting would
 * hide how often batches are being abandoned, which is worth knowing.
 */
const sweep = async (staleAfterMs = 15 * 60 * 1000) => {
  const cutoff = new Date(Date.now() - staleAfterMs);

  const stale = await prisma.run.findMany({
    where: { status: "RUNNING", startedAt: { lt: cutoff } },
    select: { id: true, startedAt: true },
  });

  if (stale.length === 0) {
    console.log("No abandoned runs.");
    return;
  }

  const finishedAt = new Date();

  for (const run of stale) {
    await prisma.run.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        finishedAt,
        durationMs: finishedAt.getTime() - run.startedAt.getTime(),
        errorMessage: markFault(
          "sandbox gone",
          "Run abandoned: never reported a result. Process killed, dev server restarted, or function crashed.",
        ),
      },
    });
  }

  console.log(`swept ${stale.length} abandoned run(s)`);
  console.log("Marked as infrastructure faults, not agent failures.");
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const commands = process.argv.slice(2).map(bare);

  if (commands.includes("prune")) {
    await prune();
    return;
  }

  if (commands.includes("sweep")) {
    await sweep();
    return;
  }

  if (commands.includes("prune-old")) {
    await pruneOldConfigs();
    return;
  }

  const runs = await prisma.run.findMany({
    where: args.source ? { source: args.source } : undefined,
    orderBy: { startedAt: "desc" },
    take: args.limit,
  });

  if (runs.length === 0) {
    console.log("No runs recorded yet.");
    return;
  }

  console.log(
    ["started", "src", "status", "files", "types", "bundle", "t+b", "total"]
      .map((h, i) => h.padEnd([21, 5, 10, 6, 8, 8, 9, 8][i]))
      .join(""),
  );
  console.log("-".repeat(75));

  for (const run of runs) {
    const checkTime =
      (run.typecheckDurationMs ?? 0) + (run.buildDurationMs ?? 0);

    console.log(
      [
        run.startedAt.toISOString().slice(0, 19).replace("T", " ").padEnd(21),
        run.source.padEnd(5),
        run.status.padEnd(10),
        String(run.fileCount ?? "—").padEnd(6),
        buildCell(run.typecheckAttempted, run.typecheckSucceeded).padEnd(8),
        buildCell(run.buildAttempted, run.buildSucceeded).padEnd(8),
        seconds(checkTime || null).padEnd(9),
        seconds(run.durationMs).padEnd(8),
      ].join(""),
    );
  }

  /* ---- where the old signal and the real one disagree ---- */

  const checked = runs.filter((run) => run.buildSucceeded !== null);
  const agreedPass = checked.filter((r) => r.hasSummary && r.buildSucceeded);
  const falsePass = checked.filter((r) => r.hasSummary && !r.buildSucceeded);
  const unknown = runs.filter(
    (run) => run.buildAttempted && run.buildSucceeded === null,
  );
  const stuck = runs.filter((run) => run.status === "RUNNING");

  console.log(`\n${runs.length} run(s), ${checked.length} with a build result\n`);
  console.log(`  reported success, and built   ${agreedPass.length}`);
  console.log(`  reported success, did NOT build ${falsePass.length}`);

  if (falsePass.length > 0) {
    // The app told these users it worked. This is the gap the old heuristic
    // was hiding, and the first real finding the instrumentation produces.
    console.log(
      "\n  ^ the app reported success to the user on runs whose code does not compile.",
    );
  }

  if (unknown.length > 0) {
    console.log(
      `\n  ${unknown.length} build(s) ran but could not be judged — timeout or dead sandbox.`,
    );
    for (const run of unknown) {
      console.log(`    ${run.id}: ${(run.buildStderr ?? "").slice(0, 160)}`);
    }
  }

  if (stuck.length > 0) {
    // Excluded from every count above, on purpose: a run that never
    // finished is not evidence of failure.
    console.log(`\n  ${stuck.length} run(s) still RUNNING — excluded from counts.`);
    console.log("  `npm run report sweep` closes abandoned ones.");
  }

  const failures = checked.filter((r) => r.buildSucceeded === false);
  if (failures.length > 0) {
    console.log("\nmost recent build failure:\n");
    console.log((failures[0].buildStderr ?? "(no output captured)").slice(-1200));
  }

  // Runs that failed before a build was even possible. These are agent
  // failures, not code failures, and they need the agent's own words.
  const noOutput = runs.filter(
    (run) => run.status === "FAILED" && !run.buildAttempted && run.errorMessage,
  );

  if (noOutput.length > 0) {
    console.log(`\n${noOutput.length} run(s) failed before producing anything:\n`);
    for (const run of noOutput.slice(0, 3)) {
      console.log(`  ${run.startedAt.toISOString().slice(0, 19)}`);
      console.log(
        `${(run.errorMessage ?? "").split("\n").map((line) => `    ${line}`).join("\n")}\n`,
      );
    }
  }
};

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
