/**
 * Can this experiment detect anything?
 *
 *   npm run power
 *   npm run power version=v3-nextjs16-truncate
 *
 * Free. Reads runs already recorded and answers the question that should be
 * asked before spending on a batch, not after: **is the effect we are
 * looking for larger than the noise this design faces?**
 *
 * The pass rate already failed this test. At ~90% against a 100% ceiling
 * with ±16 points of resolution, the largest gain arithmetically available
 * is smaller than the bracket around it, so no intervention can be shown to
 * improve it. Latency was adopted as the replacement on the grounds that a
 * continuous measure resolves more per sample. That grounds is an
 * assumption, and this script is where it gets checked.
 */

import { EVAL_CASES } from "../evals/cases";
import { prisma } from "../src/lib/db";
import {
  minimumDetectableEffect,
  varianceSplit,
} from "../src/lib/stats";

const bare = (token: string) => token.replace(/^-+/, "");

const parseArgs = () => {
  const tokens = process.argv.slice(2).map(bare);
  const get = (name: string) =>
    tokens.find((t) => t.startsWith(`${name}=`))?.slice(name.length + 1);

  const level = Number.parseFloat(get("level") ?? "0.95");

  return {
    source: (get("source") as "USER" | "EVAL") ?? "EVAL",
    version: get("version"),
    level: Number.isFinite(level) ? level : 0.95,
  };
};

const seconds = (ms: number) =>
  Number.isFinite(ms) ? `${(ms / 1000).toFixed(1)}s` : "—";

const main = async () => {
  const args = parseArgs();

  const runs = await prisma.run.findMany({
    where: {
      source: args.source,
      typecheckSucceeded: true,
      ...(args.version ? { configVersion: args.version } : {}),
    },
    select: {
      caseId: true,
      durationMs: true,
      typecheckDurationMs: true,
      buildDurationMs: true,
    },
  });

  /**
   * Agent time, not wall time. Same subtraction as `baseline`, same reason:
   * wall time includes typecheck and bundle, which are the harness rather
   * than the thing under test, and are the same order of magnitude as any
   * effect worth looking for.
   */
  const byCase = new Map<string, number[]>();

  for (const run of runs) {
    if (
      !run.caseId ||
      run.durationMs === null ||
      run.typecheckDurationMs === null ||
      run.buildDurationMs === null
    ) {
      continue;
    }

    const agent =
      run.durationMs - run.typecheckDurationMs - run.buildDurationMs;
    if (agent <= 0) continue;

    byCase.set(run.caseId, [...(byCase.get(run.caseId) ?? []), agent]);
  }

  const split = varianceSplit(byCase);

  console.log(`\nCAN THIS EXPERIMENT RESOLVE ANYTHING — agent time`);
  console.log(
    `${Math.round(args.level * 100)}% confidence, 80% power` +
      (args.version ? ` · config ${args.version}` : ""),
  );

  if (split.observations < 4) {
    console.log("\n  Not enough runs with agent time recorded. Run an eval first.");
    return;
  }

  console.log(
    `\n  ${split.observations} run(s) across ${split.groups} case(s)`,
  );
  console.log(`  mean agent time            ${seconds(split.grandMean)}`);

  console.log("\n  where the spread comes from");
  console.log(`    between cases   ${seconds(split.betweenSd)}  sd of case means`);
  console.log(
    `    within a case   ${seconds(split.withinSd)}  sd of repeats, from ` +
      `${split.groupsWithRepeats} case(s) run more than once`,
  );
  console.log(`    ignoring cases  ${seconds(split.totalSd)}  sd of everything`);

  /**
   * The comparison that matters.
   *
   * Unpaired throws every run into one of two buckets, so between-case
   * spread lands in the noise term even though both arms ran the same
   * cases. Paired differences the same case against itself, and that term
   * cancels.
   */
  const perArm = EVAL_CASES.length;
  const unpaired = minimumDetectableEffect(split.totalSd, perArm, args.level);
  const paired = minimumDetectableEffect(split.withinSd, perArm, args.level);

  console.log(`\n  smallest detectable change, ${perArm} runs per arm`);
  console.log(
    `    unpaired  ${seconds(unpaired).padStart(7)}  ` +
      `${((unpaired / split.grandMean) * 100).toFixed(0)}% of the mean`,
  );

  if (Number.isFinite(paired)) {
    console.log(
      `    paired    ${seconds(paired).padStart(7)}  ` +
        `${((paired / split.grandMean) * 100).toFixed(0)}% of the mean`,
    );
  } else {
    console.log(
      "    paired    —        no case has been run twice under one config,\n" +
        "                       so within-case noise is unmeasured",
    );
  }

  console.log(
    "\n  Unpaired asks the intervention to beat the difference between a\n" +
      "  trivial case and an adversarial one. It never had to: both arms\n" +
      "  run the same 24 cases, so pairing on caseId cancels that term.\n" +
      "  Compare like case against like case, not bucket against bucket.",
  );

  if (Number.isFinite(paired) && paired / split.grandMean > 0.25) {
    console.log(
      `\n  ⚠ Even paired, the bar is ${((paired / split.grandMean) * 100).toFixed(0)}% of the mean.\n` +
        "  An intervention that plausibly moves agent time by less than that\n" +
        "  will report 'no effect' regardless of whether it had one, and\n" +
        "  that is a property of this design rather than a finding about\n" +
        "  the intervention. Say so in the writeup, or run repeats per case.",
    );
  }

  /* ---- what repeats would buy ---- */

  if (Number.isFinite(paired)) {
    for (const repeats of [2, 3]) {
      const withRepeats = minimumDetectableEffect(
        split.withinSd,
        perArm * repeats,
        args.level,
      );
      console.log(
        `  ${repeats} run(s) per case per arm (${perArm * repeats * 2} generations total): ` +
          `${seconds(withRepeats)}, ${((withRepeats / split.grandMean) * 100).toFixed(0)}% of the mean`,
      );
    }
  }

  /* ---- the honest caveat about where within-case noise came from ---- */

  if (split.groupsWithRepeats < 5) {
    console.log(
      `\n  Within-case spread rests on ${split.groupsWithRepeats} case(s) with repeats.\n` +
        "  That is a thin basis for a power estimate, so treat the paired\n" +
        "  figure as indicative. It is still better than assuming the\n" +
        "  unpaired one applies when it does not.",
    );
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
