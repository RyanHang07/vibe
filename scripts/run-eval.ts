/**
 * Run the golden set against the agent.
 *
 * Slice 3 of docs/PLAN.md.
 *
 *   npm run eval smoke                  # 4 cases — pipeline check
 *   npm run eval cheap                  # 10 cases, 2 per band — the default
 *   npm run eval case=trivial-01        # one case
 *   npm run eval limit=6                # first 6
 *   npm run eval                        # all 24 — a real baseline
 *   npm run eval plan                   # print the plan, send nothing
 *   npm run eval clean                  # delete harness projects
 *   npm run eval difficulty=simple
 *   npm run eval concurrency=4
 *
 * Default to `smoke` while working on the harness. The full set exists to
 * produce a baseline, and running it to find out whether a config change
 * compiles is paying for measurement nobody will read.
 *
 * ARGUMENTS ARE DASHLESS ON PURPOSE.
 *
 * npm 11 validates anything beginning with `-` against its own flag list and
 * rejects what it doesn't recognise, even after `--`. Two ways that bit:
 * `--clean` failed outright with EUNKNOWNCONFIG, and `--dry-run` was quietly
 * swallowed as an npm builtin — so the script ran for real while appearing
 * to have been told not to, and left 24 orphan projects behind.
 *
 * `key=value` and bare words pass through untouched. Dashed forms are still
 * accepted for direct invocation:
 *
 *   npx tsx scripts/run-eval.ts --plan
 *
 * This goes straight to Prisma and Inngest rather than through tRPC,
 * deliberately: the tRPC path requires a signed-in user and consumes
 * credits. A measurement harness should not have to pretend to be a
 * customer, and it should not bill anyone to take a reading.
 *
 * Sending the events is all this does. The agent function writes the Run
 * rows itself, so results arrive asynchronously — see docs/PLAN.md slice 4
 * for reading them back.
 */

import {
  cheapCases,
  EVAL_CASES,
  smokeCases,
  type Difficulty,
  type EvalCase,
} from "../evals/cases";
import { inngest } from "../src/inngest/client";
import { prisma } from "../src/lib/db";
import { assertConfigConsistent } from "../src/lib/interventions";

/** Marks projects created by the harness so they can be found and cleaned up. */
const EVAL_USER_ID = "eval-harness";

/**
 * Fail on missing configuration before spending anything.
 *
 * This exists because of how the first attempt failed. `tsx` does not read
 * `.env` — Prisma loads it for itself, so DATABASE_URL worked and everything
 * looked configured, while INNGEST_DEV and E2B_API_KEY were simply absent
 * from the process. The symptom was "Inngest API Error: 401 Event key not
 * found", twenty-four times, which points at Inngest credentials rather than
 * at env loading.
 *
 * The script is now run with `--env-file=.env`. This check is the backstop:
 * a missing variable should say which one, not surface as somebody else's
 * auth error.
 */
const preflight = () => {
  const problems: string[] = [];

  /**
   * Throws if CONFIG_VERSION and the tool output limit disagree. Checked
   * here because a mislabelled batch is not a recoverable error: the rows
   * are written, they look fine, and nothing downstream can tell.
   */
  assertConfigConsistent();

  if (!process.env.DATABASE_URL) {
    problems.push("DATABASE_URL is not set — no Run rows can be written.");
  }

  if (!process.env.E2B_API_KEY) {
    problems.push("E2B_API_KEY is not set — every sandbox will fail to start.");
  }

  const provider = process.env.VIBE_MODEL_PROVIDER ?? "anthropic";
  const modelKey =
    provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";
  if (!process.env[modelKey]) {
    problems.push(`${modelKey} is not set — provider is "${provider}".`);
  }

  if (!process.env.INNGEST_DEV && !process.env.INNGEST_EVENT_KEY) {
    problems.push(
      "Neither INNGEST_DEV nor INNGEST_EVENT_KEY is set. Without one, the " +
        "SDK targets Inngest Cloud and fails with a 401 that does not " +
        "mention configuration. Set INNGEST_DEV=1 for the local dev server.",
    );
  }

  if (problems.length > 0) {
    console.error("Cannot run. Fix these first:\n");
    for (const problem of problems) console.error(`  - ${problem}`);
    console.error(
      "\nValues are read from .env via --env-file. `tsx` does not load it " +
        "on its own.",
    );
    process.exit(1);
  }
};

type Args = {
  difficulty?: Difficulty;
  caseId?: string;
  concurrency: number;
  plan: boolean;
  clean: boolean;
  smoke: boolean;
  cheap: boolean;
  limit?: number;
};

/** Strips any leading dashes so `plan` and `--plan` are the same token. */
const bare = (token: string): string => token.replace(/^-+/, "");

const parseArgs = (argv: string[]): Args => {
  const tokens = argv.map(bare);

  const has = (name: string): boolean => tokens.includes(name);

  /** Accepts `name=value`, and `name value` for the dashed form. */
  const get = (name: string): string | undefined => {
    const pair = tokens.find((token) => token.startsWith(`${name}=`));
    if (pair) return pair.slice(name.length + 1);

    const index = tokens.indexOf(name);
    if (index !== -1 && tokens[index + 1] && !tokens[index + 1].includes("=")) {
      return tokens[index + 1];
    }

    return undefined;
  };

  // One by default, after meeting a rate limit at two.
  //
  // Each case is a sandbox plus an agent loop of many model calls, so
  // concurrency 2 is really a dozen or more requests in flight. Raise it
  // only after checking the provider's limits, and check the
  // infrastructure-fault count in `npm run baseline` afterwards: a throttled
  // batch reports rates drawn from whichever runs got through, which is not
  // a random sample.
  const concurrency = Number.parseInt(get("concurrency") ?? "1", 10);

  return {
    difficulty: get("difficulty") as Difficulty | undefined,
    caseId: get("case"),
    // Low by default. Each case is a real sandbox and a real model call;
    // running twenty at once is a good way to meet a rate limit and record
    // infrastructure failures as agent failures.
    concurrency: Number.isFinite(concurrency) && concurrency > 0 ? concurrency : 2,
    plan: has("plan"),
    clean: has("clean"),
    smoke: has("smoke"),
    cheap: has("cheap"),
    limit: Number.parseInt(get("limit") ?? "", 10) || undefined,
  };
};

const selectCases = (args: Args): readonly EvalCase[] => {
  if (args.caseId) {
    const found = EVAL_CASES.filter((c) => c.id === args.caseId);
    if (found.length === 0) throw new Error(`No case with id "${args.caseId}"`);
    return found;
  }

  // Four cases, one per band. For checking the pipeline works, not for
  // measuring anything — see SMOKE_CASE_IDS.
  if (args.smoke) return smokeCases();

  // Ten cases, two per band. The working default: broad enough to see
  // shapes and catch regressions, cheap enough to run repeatedly. Not a
  // baseline — see CHEAP_CASE_IDS.
  if (args.cheap) return cheapCases();

  if (args.difficulty) {
    const found = EVAL_CASES.filter((c) => c.difficulty === args.difficulty);
    if (found.length === 0) {
      throw new Error(`No cases at difficulty "${args.difficulty}"`);
    }
    return found;
  }

  const all = EVAL_CASES;
  return args.limit ? all.slice(0, args.limit) : all;
};

/** A label that ties a project back to the case and batch that produced it. */
const projectName = (testCase: EvalCase, batchId: string) =>
  `eval-${testCase.id}-${batchId}`;

/**
 * The project has to exist before the event, because the event carries its
 * id. That ordering means a failed send leaves an orphan, so the send is
 * wrapped and the project removed if it never got dispatched.
 *
 * Without this, one bad run leaves a batch of empty projects behind and the
 * next person to look at the table cannot tell them from real ones.
 */
const dispatch = async (testCase: EvalCase, batchId: string) => {
  const project = await prisma.project.create({
    data: {
      userId: EVAL_USER_ID,
      name: projectName(testCase, batchId),
      messages: {
        create: {
          content: testCase.prompt,
          role: "USER",
          type: "RESULT",
        },
      },
    },
    select: { id: true },
  });

  try {
    await inngest.send({
      name: "code-agent/run",
      data: {
        value: testCase.prompt,
        projectId: project.id,
        // Without this the runs land in the same pool as real user traffic
        // and the baseline measures both at once.
        source: "EVAL",
        // Recorded on the Run so results can be traced to a case without
        // matching prompt text.
        caseId: testCase.id,
      },
    });
  } catch (error) {
    await prisma.project
      .delete({ where: { id: project.id } })
      .catch(() => undefined);
    throw error;
  }

  return project.id;
};

/** Remove every project this harness created. Safe: scoped to EVAL_USER_ID. */
const clean = async () => {
  const { count } = await prisma.project.deleteMany({
    where: { userId: EVAL_USER_ID },
  });

  // Run rows survive on purpose — projectId is SetNull, not Cascade, so the
  // measurements outlive the scaffolding that produced them.
  console.log(`deleted ${count} harness project(s)`);
  console.log("Run rows kept: measurements outlive their projects.");
};

/** Fixed-size worker pool. Keeps sandbox count bounded. */
const runPool = async <T>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<void>,
) => {
  const queue = [...items];
  const workers = Array.from({ length: Math.max(1, limit) }, async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      await worker(next);
    }
  });
  await Promise.all(workers);
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));

  if (args.clean) {
    await clean();
    return;
  }

  const cases = selectCases(args);

  // After `plan`, so the preview works without a full environment, and
  // before anything is created or sent.
  if (!args.plan) preflight();

  const batchId = new Date().toISOString().replace(/[:.]/g, "-");

  // Observed ~65-100s per case end to end. Printed before anything is sent,
  // because the cost of a batch is easy to forget when the command is short.
  const estimateMinutes = Math.ceil((cases.length * 85) / args.concurrency / 60);

  console.log(`batch ${batchId}`);
  console.log(
    `${cases.length} case(s), concurrency ${args.concurrency}, ~${estimateMinutes} min`,
  );

  if (cases.length >= EVAL_CASES.length) {
    console.log("full set — use `smoke` while working on the harness itself");
  }

  console.log("");

  if (args.plan) {
    for (const testCase of cases) {
      console.log(`  ${testCase.id.padEnd(16)} ${testCase.difficulty.padEnd(12)} ${testCase.prompt.slice(0, 60)}`);
    }
    console.log("\nplan only — nothing sent");
    return;
  }

  let sent = 0;
  let failed = 0;

  await runPool(cases, args.concurrency, async (testCase) => {
    try {
      const projectId = await dispatch(testCase, batchId);
      sent += 1;
      console.log(`  sent  ${testCase.id.padEnd(16)} project ${projectId}`);
    } catch (error) {
      failed += 1;
      // A dispatch failure is a harness problem, not an agent result. It
      // must not end up in the Run table pretending to be a bad generation.
      console.error(`  ERROR ${testCase.id.padEnd(16)} ${String(error)}`);
    }
  });

  console.log(`\ndispatched ${sent}, failed to dispatch ${failed}`);
  console.log("Runs are written asynchronously as each generation finishes.");
};

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
