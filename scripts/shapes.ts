/**
 * What is actually going wrong.
 *
 *   npm run shapes
 *   npm run shapes source=USER
 *   npm run shapes since=2026-09-17
 *
 * Slice 5 of docs/PLAN.md. Turns "27 runs failed" into "27 failures in 6
 * shapes, and here is which cases each one hit".
 *
 * Signatures are derived deterministically, so they are stable across runs
 * by construction — the same failure produces the same shape today and in
 * six months. That is what makes "shape 3 is getting worse" a question with
 * an answer.
 */

import { prisma } from "../src/lib/db";
import { isMarkedFault } from "../src/lib/faults";
import { classify, tally, UNCLASSIFIED } from "../src/lib/taxonomy";

const bare = (token: string) => token.replace(/^-+/, "");

const parseArgs = () => {
  const tokens = process.argv.slice(2).map(bare);
  const get = (name: string) =>
    tokens.find((t) => t.startsWith(`${name}=`))?.slice(name.length + 1);

  const since = get("since");

  return {
    source: (get("source") as "USER" | "EVAL") ?? "EVAL",
    since: since ? new Date(since) : undefined,
    /**
     * Restrict to one configuration. Without this, shapes from different
     * targets pile into one tally — and after a template change the whole
     * point is to ask which shapes the change removed.
     */
    version: get("version"),
  };
};

const main = async () => {
  const args = parseArgs();

  const runs = await prisma.run.findMany({
    where: {
      source: args.source,
      ...(args.version ? { configVersion: args.version } : {}),
      ...(args.since ? { startedAt: { gte: args.since } } : {}),
      OR: [
        { typecheckSucceeded: false },
        { buildSucceeded: false },
        { status: "FAILED" },
      ],
    },
    orderBy: { startedAt: "desc" },
  });

  if (runs.length === 0) {
    console.log("No failures to classify.");
    return;
  }

  /**
   * Infrastructure faults are dropped here, not classified.
   *
   * They are real events, but they are not shapes of *generated code*
   * failing, and mixing them in would put "rate limit" at the top of a
   * taxonomy that is supposed to say what the agent gets wrong.
   */
  const codeFailures = runs.filter(
    (run) =>
      !isMarkedFault(run.errorMessage) &&
      !isMarkedFault(run.typecheckStderr) &&
      !isMarkedFault(run.buildStderr),
  );

  const infra = runs.length - codeFailures.length;

  /** The most specific evidence available, in order of usefulness. */
  const textFor = (run: (typeof runs)[number]): string | null =>
    (run.typecheckSucceeded === false ? run.typecheckStderr : null) ??
    (run.buildSucceeded === false ? run.buildStderr : null) ??
    run.errorMessage;

  const shapes = tally(
    codeFailures.map((run) => ({ id: run.id, text: textFor(run) })),
  );

  console.log(`\nFAILURE SHAPES — ${args.source}`);
  console.log(
    `${codeFailures.length} code failure(s) in ${shapes.length} shape(s)` +
      (infra > 0 ? `, ${infra} infrastructure fault(s) excluded` : ""),
  );
  console.log("");

  const caseFor = new Map(runs.map((run) => [run.id, run.caseId ?? "?"]));

  for (const [index, group] of shapes.entries()) {
    const cases = [...new Set(group.runIds.map((id) => caseFor.get(id)))]
      .filter((c) => c !== "?")
      .sort();

    console.log(`  ${String(index + 1).padStart(2)}. ${group.shape.signature}`);
    console.log(
      `      ${group.count} run(s) · ${group.shape.source}` +
        (cases.length > 0 ? ` · ${cases.join(", ")}` : ""),
    );
    console.log(`      e.g. ${group.shape.evidence.slice(0, 120)}`);
    console.log("");
  }

  const unclassified = shapes.find((g) => g.shape.signature === UNCLASSIFIED);
  if (unclassified) {
    console.log(
      `  ${unclassified.count} failure(s) unclassified. These are the ones\n` +
        "  nobody has looked at yet — worth reading before adding a pattern,\n" +
        "  because a bucket that absorbs everything reports a tidy taxonomy\n" +
        "  and hides the interesting cases.\n",
    );
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
