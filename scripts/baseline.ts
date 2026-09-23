/**
 * The baseline.
 *
 *   npm run baseline
 *   npm run baseline source=USER
 *   npm run baseline level=0.99
 *
 * Slice 4 of docs/PLAN.md. Prints build success rate with the honest range
 * around it, overall and per difficulty tier.
 *
 * Every number here is deliberately reported as `s/n = p% [low, high]`
 * rather than as a bare percentage. The bracket is the part that stops a
 * later batch scoring ten points higher from being mistaken for progress.
 */

import { EVAL_CASES, type Difficulty } from "../evals/cases";
import { prisma } from "../src/lib/db";
import { infrastructureFault, isMarkedFault } from "../src/lib/faults";
import { formatInterval, trialsForWidth, wilsonInterval } from "../src/lib/stats";

const TIERS: Difficulty[] = [
  "trivial",
  "simple",
  "moderate",
  "complex",
  "adversarial",
];

const bare = (token: string) => token.replace(/^-+/, "");

const parseArgs = () => {
  const tokens = process.argv.slice(2).map(bare);
  const get = (name: string) =>
    tokens.find((t) => t.startsWith(`${name}=`))?.slice(name.length + 1);

  const level = Number.parseFloat(get("level") ?? "0.95");

  return {
    source: (get("source") as "USER" | "EVAL") ?? "EVAL",
    level: Number.isFinite(level) ? level : 0.95,
    /** Restrict to one agent configuration. `npm run baseline version=v2-...` */
    version: get("version"),
  };
};

const difficultyOf = (caseId: string | null): Difficulty | null =>
  EVAL_CASES.find((c) => c.id === caseId)?.difficulty ?? null;

const main = async () => {
  const args = parseArgs();

  /**
   * Only runs with a definite build verdict count.
   *
   * `buildSucceeded: null` means the check could not decide — a timeout, a
   * dead sandbox, or a filesystem fault in the template. Those are not
   * failures, and letting them into the denominator would quietly deflate
   * every rate on this page.
   */
  const runs = await prisma.run.findMany({
    where: {
      source: args.source,
      buildSucceeded: { not: null },
      ...(args.version ? { configVersion: args.version } : {}),
    },
    orderBy: { startedAt: "desc" },
  });

  /**
   * Mixed configurations are not a baseline.
   *
   * Runs from different agent configs answer different questions, and
   * averaging them produces a number that describes nothing that ever
   * existed. Slice 6 exists to compare them deliberately, not by accident.
   */
  const versions = new Set(runs.map((run) => run.configVersion ?? "(unversioned)"));

  /**
   * Excluded runs, broken down by reason.
   *
   * A single "25 excluded" number is not diagnosable. Runs stuck RUNNING,
   * builds that could not be judged, and generations that produced nothing
   * are three different problems with three different fixes, and rolling
   * them into one count hides which one you have.
   */
  const [stillRunning, unjudged, nothingProduced, missingCaseId] =
    await Promise.all([
      prisma.run.count({ where: { source: args.source, status: "RUNNING" } }),
      prisma.run.findMany({
        where: {
          source: args.source,
          buildAttempted: true,
          buildSucceeded: null,
        },
        select: { buildStderr: true },
      }),
      prisma.run.count({
        where: {
          source: args.source,
          status: "FAILED",
          buildAttempted: false,
        },
      }),
      prisma.run.count({ where: { source: args.source, caseId: null } }),
    ]);

  const excluded = stillRunning + unjudged.length + nothingProduced;

  if (runs.length === 0) {
    console.log(`No ${args.source} runs with a build result yet.`);
    console.log("Run `npm run eval` first.");
    return;
  }

  const succeeded = runs.filter((run) => run.buildSucceeded).length;
  const overall = wilsonInterval(succeeded, runs.length, args.level);

  console.log(`\nGENERATION QUALITY — ${args.source}`);
  console.log(
    `${Math.round(args.level * 100)}% confidence` +
      (args.version ? ` · config ${args.version}` : ""),
  );

  if (!args.version && versions.size > 1) {
    console.log(
      `\n  ⚠ ${versions.size} agent configurations mixed into these numbers:\n` +
        `    ${[...versions].join(", ")}\n` +
        "    They answer different questions, so the averages below describe\n" +
        "    nothing that ever ran. Use version=<name> to pick one.",
    );
  }

  console.log("");

  /* ---- two signals, separately ---- */

  const typechecked = runs.filter((run) => run.typecheckSucceeded !== null);
  const typecheckOk = typechecked.filter((run) => run.typecheckSucceeded).length;

  console.log(
    `  typecheck      ${formatInterval(
      wilsonInterval(typecheckOk, typechecked.length, args.level),
    )}`,
  );
  console.log(`  bundle         ${formatInterval(overall)}`);

  // Where the two disagree is the interesting part. Code that bundles but
  // does not typecheck is the shape most likely to reach a user looking
  // fine and break later.
  const bundlesNotTypes = runs.filter(
    (run) => run.buildSucceeded === true && run.typecheckSucceeded === false,
  ).length;
  const typesNotBundle = runs.filter(
    (run) => run.typecheckSucceeded === true && run.buildSucceeded === false,
  ).length;

  if (bundlesNotTypes > 0 || typesNotBundle > 0) {
    console.log("\n  where they disagree");
    console.log(`    bundles, fails typecheck   ${bundlesNotTypes}`);
    console.log(`    typechecks, fails bundle   ${typesNotBundle}`);
  }

  console.log("");

  /* ---- per difficulty ---- */

  console.log("  by difficulty");
  for (const tier of TIERS) {
    const tierRuns = runs.filter((run) => difficultyOf(run.caseId) === tier);
    if (tierRuns.length === 0) {
      console.log(`    ${tier.padEnd(13)} no data`);
      continue;
    }

    const tierOk = tierRuns.filter((run) => run.buildSucceeded).length;
    console.log(
      `    ${tier.padEnd(13)}${formatInterval(
        wilsonInterval(tierOk, tierRuns.length, args.level),
      )}`,
    );
  }

  /* ---- what the old heuristic would have claimed ---- */

  const claimedSuccess = runs.filter((run) => run.hasSummary).length;
  const falsePass = runs.filter((run) => run.hasSummary && !run.buildSucceeded);

  console.log(`\n  the old signal said ${claimedSuccess}/${runs.length} succeeded`);
  console.log(
    `  of those, ${falsePass.length} did not compile ${formatInterval(
      wilsonInterval(falsePass.length, claimedSuccess, args.level),
    )}`,
  );
  console.log(
    "\n  ^ how often the app told a user it worked on code that does not build.",
  );

  /* ---- cost, where a proportion has run out of room ---- */

  /**
   * Latency, not tokens.
   *
   * AgentKit exposes token usage only on its streaming `run.completed`
   * event, which `network.run()` does not emit — so there are no token
   * counts to report without moving the agent onto the streaming API.
   *
   * `durationMs` has been recorded on every run since slice 1 and is
   * continuous, which is the property that matters here: it compares
   * distributions rather than counting successes, so a difference between
   * configs is visible with far fewer samples than a pass rate needs.
   *
   * A proxy for cost, not a price. Said plainly rather than dressed up.
   */
  /**
   * AGENT TIME, NOT WALL TIME. This distinction is the whole metric.
   *
   * `durationMs` is the full run: sandbox creation, the agent loop, then
   * `tsc --noEmit` and `next build`. The checks alone have been measured
   * between 11 and 60 seconds — the same order of magnitude as any effect
   * an intervention could plausibly have.
   *
   * So comparing raw `durationMs` across configs would compare the harness
   * as much as the agent, and a slower typecheck on a batch with more files
   * would read as "the intervention made generation slower". Subtracting
   * the check time is not a refinement; without it the number is measuring
   * something other than what it is labelled.
   *
   * Runs missing a check duration are dropped rather than treated as zero.
   * A missing duration is not a duration of nothing.
   */
  const agentTimes = runs
    .filter(
      (run) =>
        run.typecheckSucceeded &&
        typeof run.durationMs === "number" &&
        typeof run.typecheckDurationMs === "number" &&
        typeof run.buildDurationMs === "number",
    )
    .map((run) => ({
      total: run.durationMs as number,
      agent:
        (run.durationMs as number) -
        (run.typecheckDurationMs as number) -
        (run.buildDurationMs as number),
    }))
    .filter((row) => row.agent > 0)
    .sort((a, b) => a.agent - b.agent);

  const droppedForTiming =
    runs.filter((run) => run.typecheckSucceeded).length - agentTimes.length;

  if (agentTimes.length >= 3) {
    const at = (fraction: number) =>
      agentTimes[
        Math.min(agentTimes.length - 1, Math.floor(agentTimes.length * fraction))
      ].agent;

    const mean =
      agentTimes.reduce((sum, row) => sum + row.agent, 0) / agentTimes.length;
    const meanTotal =
      agentTimes.reduce((sum, row) => sum + row.total, 0) / agentTimes.length;
    const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

    console.log("\n  agent time to a passing generation");
    console.log("  (wall time minus typecheck and bundle)");
    console.log(`    median   ${seconds(at(0.5))}`);
    console.log(`    p10-p90  ${seconds(at(0.1))} – ${seconds(at(0.9))}`);
    console.log(`    mean     ${seconds(mean)}   over ${agentTimes.length} run(s)`);
    console.log(
      `    checks   ${seconds(meanTotal - mean)} mean, excluded from the above`,
    );

    if (droppedForTiming > 0) {
      console.log(
        `\n    ${droppedForTiming} passing run(s) excluded — no check duration\n` +
          "    recorded, so agent time cannot be separated from wall time.",
      );
    }

    console.log(
      "\n    Continuous, so a change here is detectable at this sample size\n" +
        "    where a change in the pass rate is not. With typecheck near 90%\n" +
        "    and a 100% ceiling, the largest possible gain is smaller than\n" +
        "    the noise floor — comparisons have to live here instead.\n" +
        "\n    Latency is a proxy for cost. Token counts would be better and\n" +
        "    are not available: AgentKit reports usage only on its streaming\n" +
        "    interface, which this agent does not use.",
    );
  } else {
    console.log(
      "\n  Not enough runs carry both a wall time and check durations to\n" +
        "  separate agent time from harness time. Raw wall time is not\n" +
        "  reported instead: it would compare the checks as much as the\n" +
        "  agent, and look like a result.",
    );
  }

  /* ---- honesty about what this sample can resolve ---- */

  const needed = trialsForWidth(0.2, args.level);
  const width = overall.upper - overall.lower;

  console.log(`\n  interval width  ${(width * 100).toFixed(1)} points`);
  console.log(
    `  a ±10 point interval needs about ${needed} runs; this batch has ${runs.length}.`,
  );

  if (runs.length < needed) {
    console.log(
      `\n  So: differences smaller than roughly ${Math.round(width * 100)} points\n` +
        "  cannot be distinguished from noise at this sample size. Treat a\n" +
        "  later batch scoring higher as unproven until it clears the bracket.",
    );
  }

  if (excluded > 0) {
    console.log(`\n  ${excluded} run(s) excluded — absences of data, not failures:`);
    console.log(`    ${stillRunning} still RUNNING (never finished)`);
    console.log(`    ${unjudged.length} build ran but could not be judged`);
    console.log(`    ${nothingProduced} produced nothing to build`);

    // Which faults, so the cause is nameable rather than guessable.
    if (unjudged.length > 0) {
      const kinds = new Map<string, number>();
      for (const run of unjudged) {
        const kind = infrastructureFault(run.buildStderr) ?? "unclassified";
        kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
      }
      console.log("\n    unjudged builds by cause:");
      for (const [kind, count] of [...kinds].sort((a, b) => b[1] - a[1])) {
        console.log(`      ${kind.padEnd(24)} ${count}`);
      }
    }

    if (excluded > runs.length) {
      console.log(
        `\n  More runs were excluded (${excluded}) than counted (${runs.length}).\n` +
          "  The rates above rest on whatever survived, which is not a random\n" +
          "  sample of the golden set. Fix the exclusions before reading them\n" +
          "  as a baseline.",
      );
    }
  }

  if (missingCaseId > 0) {
    console.log(
      `\n  ${missingCaseId} run(s) have no caseId, so they cannot be grouped by\n` +
        "  difficulty or compared case-to-case. Runs dispatched before caseId\n" +
        "  was added will never have one; new runs missing it is a bug.",
    );
  }

  /* ---- runs that never reached a build, split by cause ---- */

  const preBuild = await prisma.run.findMany({
    where: { source: args.source, status: "FAILED", buildAttempted: false },
    select: { errorMessage: true },
  });

  if (preBuild.length > 0) {
    const faults = preBuild.filter((run) => isMarkedFault(run.errorMessage));
    const agent = preBuild.length - faults.length;

    console.log(`\n  ${preBuild.length} run(s) failed before a build was possible:`);
    console.log(`    ${agent} agent failure(s) — produced nothing usable`);
    console.log(`    ${faults.length} infrastructure fault(s) — rate limits, outages, sandbox`);

    if (faults.length > 0) {
      console.log(
        "\n  Infrastructure faults say nothing about the agent. If that count\n" +
          "  is high, the batch was throttled and the rates above are drawn\n" +
          "  from whichever runs happened to get through — which is not a\n" +
          "  random sample. Re-run at lower concurrency before trusting it.",
      );
    }
  }

  /* ---- per-case, for the ones that failed ---- */

  const failures = runs.filter((run) => !run.buildSucceeded);
  if (failures.length > 0) {
    console.log(`\n  failing cases (${failures.length}):`);
    const byCase = new Map<string, number>();
    for (const run of failures) {
      const key = run.caseId ?? "(no case id)";
      byCase.set(key, (byCase.get(key) ?? 0) + 1);
    }
    for (const [caseId, count] of [...byCase].sort()) {
      console.log(`    ${caseId.padEnd(18)} ${count}`);
    }
  }

  console.log("");
};

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
