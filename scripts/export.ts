/**
 * Snapshot the Run table to a file.
 *
 *   npm run export
 *   npm run export version=v7-utils-truncate-1000
 *   npm run export out=data/v7.json
 *
 * WHY THIS EXISTS
 *
 * Every run in the database cost a sandbox and a few thousand tokens. The
 * table is the only copy, it lives in a hosted Postgres, and `npm run
 * report prune` deletes rows by design. One careless invocation destroys
 * data that cannot be regenerated without spending the money again.
 *
 * It also makes the analysis reproducible. Numbers quoted in the writeup
 * currently depend on whatever the database contains when someone runs the
 * command — including rows added later, or pruned since. A committed
 * snapshot means the figures in `docs/WRITEUP.md` can be recomputed by
 * anyone, forever, without database access and without a provider key.
 *
 * WHAT IS DELIBERATELY NOT EXPORTED
 *
 * `prompt` is included — it is the golden set, already in the repo.
 * Nothing here carries an API key: keys were never written to this table,
 * only to Inngest event payloads, and those are encrypted now. But this
 * file is the kind that gets committed, so the export names its columns
 * explicitly rather than spreading the row. A `select: *` would quietly
 * start exporting whatever column someone adds next.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { prisma } from "../src/lib/db";

const bare = (token: string) => token.replace(/^-+/, "");

const parseArgs = () => {
  const tokens = process.argv.slice(2).map(bare);
  const get = (name: string) =>
    tokens.find((t) => t.startsWith(`${name}=`))?.slice(name.length + 1);

  return {
    version: get("version"),
    source: (get("source") as "USER" | "EVAL") ?? "EVAL",
    out: get("out") ?? "data/runs.json",
  };
};

const main = async () => {
  const args = parseArgs();

  const runs = await prisma.run.findMany({
    where: {
      source: args.source,
      ...(args.version ? { configVersion: args.version } : {}),
    },
    orderBy: { startedAt: "asc" },
    /**
     * Named columns, not a spread.
     *
     * An export that selects everything starts exporting whatever column is
     * added next, without anyone deciding that it should. This list is a
     * decision; `select: *` is a default.
     */
    select: {
      id: true,
      source: true,
      status: true,
      stage: true,
      caseId: true,
      configVersion: true,
      sandboxTemplate: true,
      provider: true,
      model: true,
      prompt: true,

      startedAt: true,
      finishedAt: true,
      durationMs: true,

      fileCount: true,
      hasSummary: true,
      errorMessage: true,

      typecheckAttempted: true,
      typecheckSucceeded: true,
      typecheckExitCode: true,
      typecheckStderr: true,
      typecheckDurationMs: true,

      buildAttempted: true,
      buildSucceeded: true,
      buildExitCode: true,
      buildStderr: true,
      buildDurationMs: true,
    },
  });

  const snapshot = {
    /**
     * Provenance travels with the data.
     *
     * A bare array of rows answers "what were the numbers" and not "of
     * what, measured when" — and this project's whole argument is that the
     * second question is the one that decides whether the first means
     * anything.
     */
    exportedAt: new Date().toISOString(),
    filter: { source: args.source, version: args.version ?? "(all)" },
    count: runs.length,
    configVersions: [
      ...new Set(runs.map((r) => r.configVersion ?? "(unversioned)")),
    ],
    sandboxTemplates: [
      ...new Set(runs.map((r) => r.sandboxTemplate ?? "(unrecorded)")),
    ],
    runs,
  };

  mkdirSync(dirname(args.out), { recursive: true });
  writeFileSync(args.out, JSON.stringify(snapshot, null, 2));

  console.log(`\nExported ${runs.length} run(s) → ${args.out}`);
  console.log(`  configs   ${snapshot.configVersions.join(", ")}`);
  console.log(`  templates ${snapshot.sandboxTemplates.join(", ")}`);
  console.log(
    "\n  Commit this. Every row cost a sandbox and real tokens, the\n" +
      "  database is the only other copy, and `report prune` deletes rows\n" +
      "  by design.\n",
  );
};

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
