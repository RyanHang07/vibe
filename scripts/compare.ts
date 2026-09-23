/**
 * Compare two configurations, paired on the case.
 *
 *   npm run compare a=v3-nextjs16-truncate b=v4-truncate-1000
 *
 * The verify step of observe → diagnose → act → verify, and the only part
 * of the loop that had never run.
 *
 * Paired, because `npm run power` showed the unpaired design cannot resolve
 * anything worth having: between-case spread is 65s against a within-case
 * 9s, so pooling the arms asks the intervention to beat the difference
 * between a trivial case and an adversarial one. Differencing each case
 * against itself cancels that term and buys roughly five times the
 * resolution for the same money.
 */

import { prisma } from "../src/lib/db";
import {
  formatInterval,
  pairedDifference,
  wilsonInterval,
} from "../src/lib/stats";

const bare = (token: string) => token.replace(/^-+/, "");

const parseArgs = () => {
  const tokens = process.argv.slice(2).map(bare);
  const get = (name: string) =>
    tokens.find((t) => t.startsWith(`${name}=`))?.slice(name.length + 1);

  const level = Number.parseFloat(get("level") ?? "0.95");

  return {
    a: get("a"),
    b: get("b"),
    source: (get("source") as "USER" | "EVAL") ?? "EVAL",
    level: Number.isFinite(level) ? level : 0.95,
  };
};

const seconds = (ms: number) =>
  Number.isFinite(ms) ? `${(ms / 1000).toFixed(1)}s` : "—";

const signed = (ms: number) =>
  Number.isFinite(ms) ? `${ms >= 0 ? "+" : ""}${(ms / 1000).toFixed(1)}s` : "—";

/** Agent time per case: wall time minus the harness's own checks. */
const agentTimesByCase = async (
  version: string,
  source: "USER" | "EVAL",
): Promise<{ times: Map<string, number[]>; passed: number; total: number }> => {
  const runs = await prisma.run.findMany({
    where: { source, configVersion: version, buildSucceeded: { not: null } },
    select: {
      caseId: true,
      durationMs: true,
      typecheckDurationMs: true,
      buildDurationMs: true,
      typecheckSucceeded: true,
    },
  });

  const times = new Map<string, number[]>();

  for (const run of runs) {
    if (
      !run.caseId ||
      !run.typecheckSucceeded ||
      run.durationMs === null ||
      run.typecheckDurationMs === null ||
      run.buildDurationMs === null
    ) {
      continue;
    }

    const agent =
      run.durationMs - run.typecheckDurationMs - run.buildDurationMs;
    if (agent <= 0) continue;

    times.set(run.caseId, [...(times.get(run.caseId) ?? []), agent]);
  }

  return {
    times,
    passed: runs.filter((r) => r.typecheckSucceeded).length,
    total: runs.length,
  };
};

const main = async () => {
  const args = parseArgs();

  if (!args.a || !args.b) {
    console.log("Usage: npm run compare a=<config> b=<config>");
    console.log("\nConfigs recorded so far:");
    const versions = await prisma.run.groupBy({
      by: ["configVersion"],
      _count: { _all: true },
    });
    for (const v of versions) {
      console.log(`  ${v.configVersion ?? "(unversioned)"}  ${v._count._all} run(s)`);
    }
    return;
  }

  const [left, right] = await Promise.all([
    agentTimesByCase(args.a, args.source),
    agentTimesByCase(args.b, args.source),
  ]);

  console.log(`\nA · ${args.a}`);
  console.log(`B · ${args.b}`);
  console.log(`${Math.round(args.level * 100)}% confidence, paired on caseId\n`);

  /* ---- quality first, because a faster wrong answer is worse ---- */

  const aRate = wilsonInterval(left.passed, left.total, args.level);
  const bRate = wilsonInterval(right.passed, right.total, args.level);

  console.log("  typecheck rate");
  console.log(`    A  ${formatInterval(aRate)}`);
  console.log(`    B  ${formatInterval(bRate)}`);
  console.log(
    "\n    Checked first on purpose. An intervention that speeds the agent\n" +
      "    up by degrading what it produces is a regression wearing a win,\n" +
      "    and the latency figure below would not show it.",
  );

  /* ---- the paired comparison ---- */

  const result = pairedDifference(left.times, right.times, args.level);

  if (result.pairs < 2) {
    console.log(
      `\n  Only ${result.pairs} case(s) passed under both configs. Nothing to\n` +
        "  compare. Cases are dropped rather than filled in: substituting a\n" +
        "  value for a missing arm assumes the thing being measured.",
    );
    return;
  }

  console.log(`\n  agent time, A minus B, over ${result.pairs} paired case(s)`);
  console.log(`    mean difference  ${signed(result.meanDifference)}`);
  console.log(
    `    interval         [${signed(result.lower)}, ${signed(result.upper)}]`,
  );

  if (result.resolved) {
    const faster = result.meanDifference > 0 ? "B" : "A";
    console.log(
      `\n  RESOLVED. ${faster} is faster, and the interval excludes zero.\n` +
        "  Check the typecheck rates above before calling it an improvement.",
    );
  } else {
    console.log(
      "\n  NOT RESOLVED. The interval includes zero, so the sign of the\n" +
        "  effect is unknown — B may be faster, slower, or identical.\n" +
        "\n  This is not the same as 'no effect', and must not be written up\n" +
        `  as one. What it says is: any effect smaller than about\n` +
        `  ${seconds(Math.max(Math.abs(result.lower), Math.abs(result.upper)))} is invisible to this design.`,
    );
  }

  /* ---- per case, because the mean can hide the shape ---- */

  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const shared = [...left.times.keys()]
    .filter((id) => right.times.has(id))
    .sort();

  console.log("\n  by case");
  console.log(`    ${"case".padEnd(18)}${"A".padStart(8)}${"B".padStart(9)}${"Δ".padStart(9)}`);
  for (const id of shared) {
    const a = mean(left.times.get(id)!);
    const b = mean(right.times.get(id)!);
    console.log(
      `    ${id.padEnd(18)}${seconds(a).padStart(8)}${seconds(b).padStart(9)}${signed(a - b).padStart(9)}`,
    );
  }

  /* ---- the pre-registered split ---- */

  /**
   * Long cases against short ones.
   *
   * WHY THIS IS NOT FISHING
   *
   * Prediction 2 in `interventions.ts`, written before v6 ran, says:
   * "the p10-p90 spread narrows more than the median moves. The long runs
   * are the ones carrying large tool output; the short ones never hit the
   * cap and cannot change."
   *
   * That is a mechanism claim, and it implies a subgroup. Testing it is
   * confirmatory because it was written down first. Carving the same split
   * out of the results afterwards, because the long cases happened to look
   * good, would be the opposite — and from the outside the two are
   * indistinguishable, which is exactly why the prediction has to predate
   * the data.
   *
   * THE SPLIT RULE IS FIXED BY ARM A, NOT BY THE DIFFERENCES.
   *
   * Cases are ranked by their v5 (baseline) duration and cut at the median.
   * Ranking by the difference, or by the pooled time, would let the outcome
   * choose its own grouping, which manufactures an effect from noise every
   * time.
   */
  const ranked = shared
    .map((id) => ({ id, baseline: mean(left.times.get(id) ?? []) }))
    .sort((a, b) => b.baseline - a.baseline);

  const half = Math.floor(ranked.length / 2);
  const strata: Array<{ label: string; ids: string[] }> = [
    { label: "longer half", ids: ranked.slice(0, half).map((r) => r.id) },
    { label: "shorter half", ids: ranked.slice(ranked.length - half).map((r) => r.id) },
  ];

  if (half >= 2) {
    console.log("\n  pre-registered split, ranked by A's duration");

    for (const stratum of strata) {
      // The tuple annotation is load-bearing: without it TypeScript infers
      // `(string | number[])[]` from the array literal rather than a
      // [key, value] pair, and the Map constructor rejects it.
      const subset = (source: Map<string, number[]>) =>
        new Map(
          stratum.ids.map((id): [string, number[]] => [id, source.get(id) ?? []]),
        );

      const inner = pairedDifference(
        subset(left.times),
        subset(right.times),
        args.level,
      );

      console.log(
        `    ${stratum.label.padEnd(14)}${signed(inner.meanDifference).padStart(8)}  ` +
          `[${signed(inner.lower)}, ${signed(inner.upper)}]  ` +
          `${inner.pairs} pair(s)  ${inner.resolved ? "RESOLVED" : "not resolved"}`,
      );
    }

    console.log(
      "\n    Split on A's duration, never on the differences — letting the\n" +
        "    outcome pick its own grouping manufactures an effect from noise.\n" +
        "    Each half has half the pairs, so each interval is wider than the\n" +
        "    aggregate one. A split that resolves what the whole did not is\n" +
        "    suggestive, not conclusive, and needs its own confirming run.",
    );
  }

  if (result.dropped.length > 0) {
    console.log(
      `\n  ${result.dropped.length} case(s) dropped — passed under one config only:`,
    );
    console.log(`    ${result.dropped.join(", ")}`);
    console.log(
      "\n  These are a result about the pass rate, not a data point about\n" +
        "  latency. If many dropped, the arms are not comparable and the\n" +
        "  paired figure above rests on the cases that happened to survive.",
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
