/**
 * Does the harness work, independent of whether the agent is any good?
 *
 *   npm run doctor
 *   npm run doctor keep      # leave the sandbox alive to poke at
 *
 * One sandbox. **Zero model calls.** Nothing is generated.
 *
 *
 * WHY THIS EXISTS
 *
 * Every harness bug so far was found by running a 24-case eval batch: half
 * an hour and real tokens to discover a flag that no longer exists. And not
 * one of them needed a model call —
 *
 *   `--no-lint` removed in Next 16
 *   `eslint` key invalid in next.config
 *   Next 16 types missing from the copy
 *   tar tripping on a Docker whiteout
 *   template files root-owned
 *   node_modules symlink defeating npx
 *
 * — every one is a property of the commands or the template.
 *
 * The premise here is simple enough to be worth stating: **a freshly
 * scaffolded Next app must typecheck and build.** If it does not, the
 * harness is broken. No generation, no ambiguity, no tokens.
 *
 * It also answers the question that otherwise needs a batch and a taxonomy
 * to settle: when a check fails, is that the agent's fault or ours?
 */

import { Sandbox } from "e2b";

import {
  BUNDLE_COMMAND,
  BUNDLE_TIMEOUT_MS,
  CHECK_PREPARE_COMMAND,
  PREPARE_TIMEOUT_MS,
  SANDBOX_TEMPLATE,
  SANDBOX_TIMEOUT_MS,
  TYPECHECK_COMMAND,
  TYPECHECK_TIMEOUT_MS,
} from "../src/lib/config";
import { infrastructureFault } from "../src/lib/faults";

const bare = (token: string) => token.replace(/^-+/, "");
const has = (name: string) => process.argv.slice(2).map(bare).includes(name);

type StepResult = {
  name: string;
  ok: boolean;
  durationMs: number;
  exitCode: number | null;
  output: string;
};

const tail = (text: string, limit = 2_000) =>
  text.length <= limit ? text : `…\n${text.slice(-limit)}`;

const runStep = async (
  sandbox: Sandbox,
  name: string,
  command: string,
  timeoutMs: number,
): Promise<StepResult> => {
  const startedAt = Date.now();
  let stdout = "";
  let stderr = "";

  try {
    const result = await sandbox.commands.run(command, {
      timeoutMs,
      onStdout: (d: string) => {
        stdout += d;
      },
      onStderr: (d: string) => {
        stderr += d;
      },
    });

    return {
      name,
      ok: result.exitCode === 0,
      durationMs: Date.now() - startedAt,
      exitCode: result.exitCode,
      output: [stdout, stderr].filter((s) => s.trim()).join("\n"),
    };
  } catch (error) {
    const exitCode =
      typeof error === "object" && error !== null && "exitCode" in error
        ? ((error as { exitCode: unknown }).exitCode as number)
        : null;

    const captured =
      [stdout, stderr].filter((s) => s.trim()).join("\n") ||
      (error instanceof Error ? error.message : String(error));

    return {
      name,
      ok: false,
      durationMs: Date.now() - startedAt,
      exitCode,
      output: captured,
    };
  }
};

const report = (step: StepResult) => {
  const mark = step.ok ? "ok  " : "FAIL";
  const seconds = `${(step.durationMs / 1000).toFixed(1)}s`;
  console.log(`  ${mark} ${step.name.padEnd(12)} ${seconds.padStart(7)}`);

  if (!step.ok) {
    // The exit code is the discriminator when there is no error text.
    // A process that prints nothing and dies did not choose to exit:
    // 137 is SIGKILL, which in a container is almost always the OOM killer;
    // 139 is a segfault. Both look identical in the output — empty.
    const signal =
      step.exitCode === 137
        ? " (SIGKILL — out of memory, most likely)"
        : step.exitCode === 139
          ? " (SIGSEGV)"
          : step.exitCode === null
            ? " (no exit code — timeout or lost sandbox)"
            : "";

    console.log(`       exit ${step.exitCode ?? "—"}${signal}`);

    const fault = infrastructureFault(step.output);
    if (fault) console.log(`       infrastructure fault: ${fault}`);

    if (!step.output.trim()) {
      console.log("       (no output — the process died without reporting)");
    }
    console.log(
      tail(step.output)
        .split("\n")
        .map((line) => `       ${line}`)
        .join("\n"),
    );
  }
};

const main = async () => {
  if (!process.env.E2B_API_KEY) {
    console.error("E2B_API_KEY is not set. Nothing to test against.");
    process.exit(1);
  }

  console.log(`\nDOCTOR — checking the harness, not the agent`);
  console.log(`template  ${SANDBOX_TEMPLATE}`);
  console.log(`\nA pristine Next app must typecheck and build. If it does not,`);
  console.log(`the harness is broken and no eval result would mean anything.\n`);

  const sandbox = await Sandbox.create(SANDBOX_TEMPLATE);
  await sandbox.setTimeout(SANDBOX_TIMEOUT_MS);

  const steps: StepResult[] = [];

  try {
    const prepare = await runStep(
      sandbox,
      "prepare",
      CHECK_PREPARE_COMMAND,
      PREPARE_TIMEOUT_MS,
    );
    steps.push(prepare);
    report(prepare);

    // Both later steps run against the copy, so a failed copy makes them
    // meaningless rather than merely likely to fail.
    if (prepare.ok) {
      const typecheck = await runStep(
        sandbox,
        "typecheck",
        TYPECHECK_COMMAND,
        TYPECHECK_TIMEOUT_MS,
      );
      steps.push(typecheck);
      report(typecheck);

      const bundle = await runStep(
        sandbox,
        "bundle",
        BUNDLE_COMMAND,
        BUNDLE_TIMEOUT_MS,
      );
      steps.push(bundle);
      report(bundle);
    } else {
      console.log("\n  Skipped typecheck and bundle: the copy failed.");
    }
    /**
     * When something fails, collect the context before the sandbox dies.
     *
     * Three rounds have now gone: read a failure, guess a cause, rebuild,
     * discover the guess was wrong. The sandbox holds the answer the whole
     * time and gets thrown away unexamined.
     *
     * A diagnostic step costs one command on a sandbox that already exists.
     */
    if (steps.some((step) => !step.ok)) {
      const probe = await runStep(
        sandbox,
        "diagnose",
        [
          'echo "--- package counts ---"',
          'echo -n "source: "; ls /home/user/node_modules 2>/dev/null | wc -l',
          'echo -n "copy:   "; ls /tmp/vibe-build/node_modules 2>/dev/null | wc -l',
          'echo "--- packages the typecheck could not find ---"',
          'for p in lucide-react class-variance-authority tw-animate-css; do' +
            ' printf "%-28s source:%s copy:%s\\n" "$p"' +
            ' "$(test -d /home/user/node_modules/$p && echo yes || echo NO)"' +
            ' "$(test -d /tmp/vibe-build/node_modules/$p && echo yes || echo NO)";' +
            " done",
          'echo "--- memory ---"',
          "free -m 2>/dev/null | head -2 || echo '(free unavailable)'",
          "cat /sys/fs/cgroup/memory.max 2>/dev/null || cat /sys/fs/cgroup/memory/memory.limit_in_bytes 2>/dev/null || echo '(no cgroup limit visible)'",
          'echo "--- package.json deps ---"',
          "grep -A40 '\"dependencies\"' /home/user/package.json | head -50",
        ].join("; "),
        30_000,
      );

      console.log("\n  diagnostics");
      console.log(
        probe.output
          .split("\n")
          .map((line) => `       ${line}`)
          .join("\n"),
      );
    }
    /**
     * The packages a generated app will reach for. Checked ALWAYS, not only
     * when a step fails.
     *
     * WHY AN UNTOUCHED PROJECT PASSING IS NOT ENOUGH
     *
     * Doctor's premise is that a pristine scaffold must typecheck and
     * build. True, and insufficient: a pristine scaffold does not import
     * `tailwind-merge`, so its absence cannot make any doctor step fail.
     * Doctor was green while the template was missing a package that every
     * real shadcn project has.
     *
     * It surfaced instead as `TS2307: Cannot find module 'tailwind-merge'`
     * on 4 runs of an 80-run batch, scored as generated-code failures. The
     * agent was writing what a shadcn project normally contains; the
     * template was the anomaly.
     *
     * So the check cannot be "does the scaffold compile". It has to be
     * "does the scaffold contain what the agent will assume", and that list
     * is a judgement written down rather than derived. Wrong entries here
     * are cheap to argue about; a missing entry costs a quarter of a
     * failure set.
     */
    const EXPECTED_PACKAGES = [
      "lucide-react",
      "class-variance-authority",
      "tw-animate-css",
      "clsx",
      "tailwind-merge",
    ] as const;

    const presence = await runStep(
      sandbox,
      "packages",
      [
        `for p in ${EXPECTED_PACKAGES.join(" ")}; do`,
        ' v="$(node -p "require(\'/home/user/node_modules/$p/package.json\').version" 2>/dev/null || echo MISSING)";',
        ' printf "%-28s %s\\n" "$p" "$v";',
        "done",
      ].join(" "),
      30_000,
    );

    console.log("\n  packages a generated app will assume");
    console.log(
      presence.output
        .split("\n")
        .filter((line) => line.trim())
        .map((line) => `    ${line}`)
        .join("\n"),
    );

    const missing = presence.output
      .split("\n")
      .filter((line) => line.includes("MISSING"))
      .map((line) => line.trim().split(/\s+/)[0]);

    if (missing.length > 0) {
      /**
       * Built from the probe's own result, not fabricated.
       *
       * `exitCode` stays whatever the command actually returned — 0, since
       * listing versions succeeds whether or not the versions are there.
       * This step fails on its *content*, not on its status, and inventing
       * a non-zero exit code to express that would be a small lie of
       * exactly the kind this project keeps finding.
       */
      steps.push({
        ...presence,
        name: "packages",
        ok: false,
        output: `missing from the template: ${missing.join(", ")}\n\n${presence.output}`,
      });
      console.log(
        `\n    ${missing.length} missing. Generations importing these will fail\n` +
          "    with TS2307 and be scored as bad code. Pin them in\n" +
          "    sandbox-templates/nextjs/e2b.Dockerfile and rebuild.",
      );
    }

    /**
     * Versions, printed even when nothing is missing.
     *
     * `lucide-react` was installed unpinned for the life of this template.
     * lucide removed its brand icons, so `Github` and `Linkedin` — names
     * abundant in training data — stopped existing at some version nobody
     * recorded. Three runs failed on TS2305 for that reason and were
     * counted against the agent.
     *
     * Whether a generation is wrong depends on the version it was judged
     * against, so the version belongs in the output of the tool that says
     * whether the harness is sound.
     */
  } finally {
    if (has("keep")) {
      console.log(`\n  Sandbox kept: ${sandbox.sandboxId}`);
      console.log("  Remember to kill it — E2B caps concurrent sandboxes.");
    } else {
      await sandbox.kill().catch(() => undefined);
    }
  }

  const failed = steps.filter((step) => !step.ok);

  console.log("");

  if (failed.length === 0) {
    console.log("  Harness is sound. A failing eval is the agent's, not ours.");
    console.log("  Next: npm run eval smoke\n");
    return;
  }

  console.log(`  ${failed.length} step(s) failed on an untouched project.`);
  console.log("  These are harness bugs. Fix them before spending a batch:");
  console.log("  every generation in that batch would fail the same way, and");
  console.log("  the rate would look like a finding about the agent.\n");

  process.exitCode = 1;
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
