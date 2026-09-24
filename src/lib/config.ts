/**
 * App-level constants that used to be magic numbers inside
 * `src/inngest/functions.ts`. See docs/AUDIT.md S5.
 *
 * Everything here is environment-overridable so a value can be changed
 * without a deploy — which is what makes A/B-ing an intervention possible
 * (docs/PLAN.md, "What act means").
 */

import { env, envFlag, envFloat, envInt } from "./env";

/**
 * E2B sandbox template.
 *
 * This shipped as the literal "vibe-nextjs-ryan-test-2" — a personal test
 * template, hardcoded in the run path.
 *
 * THE TEMPLATE NAME IS NOT RENAMED WITH THE REST OF THE PROJECT.
 *
 * `vibe-nextjs-16` is a published E2B image, and its id is recorded on
 * every run in the database as `sandboxTemplate`. Renaming it means
 * rebuilding and republishing, which produces a new id, which makes every
 * existing run incomparable to every future one — a change to the
 * measurement target, dressed as a cosmetic rename.
 *
 * The identifier of a thing you have already measured against is not
 * yours to tidy up.
 */
export const SANDBOX_TEMPLATE =
  env("SANDBOX_TEMPLATE") ?? "vibe-nextjs-16";

/** How long a sandbox stays alive. Was written as `3 * 10 * 60_000`. */
export const SANDBOX_TIMEOUT_MS = envInt(
  "SANDBOX_TIMEOUT_MS",
  30 * 60 * 1_000,
);

/**
 * Maximum agent iterations before the network gives up.
 *
 * Hitting this produces no summary, which currently surfaces to the user as
 * the same "Something went wrong" as a sandbox failure or a model error.
 * Distinguishing the two is tracked in docs/AUDIT.md S4.
 */
export const MAX_AGENT_ITERATIONS = envInt("MAX_ITERATIONS", 15);

/** Prior messages replayed into agent state as conversation context. */
export const MESSAGE_HISTORY_DEPTH = envInt("HISTORY_DEPTH", 5);

/* ---------------------------------------------------------------- *
 * Build check (docs/PLAN.md slice 2)
 * ---------------------------------------------------------------- */

/** Off switch. The check costs sandbox time, so it must be disableable. */
export const BUILD_CHECK_ENABLED = envFlag("BUILD_CHECK");

/**
 * Run the bundle step at all. On by default.
 *
 * THE BUNDLE STEP NEEDS A LARGER SANDBOX THAN THE E2B DEFAULT.
 *
 * Turbopack compiling Next 16 with 318 packages does not fit in the default
 * 1024 MB: `next build` is killed mid-compile with `exit -1` and no output
 * at all, on a pristine project. The silence is the signature — a process
 * that fails explains itself, and Turbopack is loud when it fails.
 *
 * Fixed at template build time, not here:
 *
 *   npx @e2b/cli template create <name> --memory-mb 4096 --cpu-count 4
 *
 * The `memory_mb` key in e2b.toml is ignored; it has to be the flag.
 *
 * This switch exists because sandbox size multiplies across a batch — one
 * per case — so if the cost is not worth it, typecheck alone remains a
 * defensible signal. `tsc --noEmit` catches wrong props, missing imports
 * and invented APIs, which is most of how generated code is wrong.
 * Bundling adds syntax errors and client/server boundary violations: real,
 * but a smaller class.
 *
 * If it is ever turned off, the limitation belongs in the writeup rather
 * than hidden. A signal that never runs is not a signal.
 */
export const BUNDLE_CHECK_ENABLED = envFlag("BUNDLE_CHECK");

/**
 * How often to build-check a real user's run. Default: never.
 *
 * Measured at 93.4s of a 103.8s run. The user's result message is written
 * before the check starts, so they are not waiting on it — but the build
 * runs inside the same sandbox serving their live preview, competing for
 * CPU for a minute and a half while they are first clicking around in it.
 *
 * Eval runs are the measurement set, so they are always checked. Real users
 * get nothing by default, and the rate is the dial if some visibility into
 * production traffic turns out to be worth the cost.
 *
 * The general rule this encodes: instrumentation that degrades the product
 * gets switched off, and then you have neither.
 */
export const BUILD_CHECK_USER_SAMPLE_RATE = envFloat(
  "BUILD_CHECK_USER_RATE",
  0,
);

/**
 * Command run inside the sandbox to decide whether a generation compiled.
 *
 * BUILDS A COPY. Do not point this at /home/user.
 *
 * Two reasons, and the second is the serious one:
 *
 *   1. The template's Dockerfile does its work as root, so `/home/user/*`
 *      is root-owned while sandbox commands run as `user`. Touching `.next`
 *      fails with `rm: cannot remove … Permission denied`, and the whole
 *      command dies in 0.3s before the build starts.
 *
 *   2. `compile_page.sh` runs `next dev --turbopack`, so `.next` belongs to
 *      the dev server that is serving the user's live preview at that
 *      moment. Deleting or overwriting it breaks the thing the user is
 *      looking at. A measurement that damages what it measures is worse
 *      than no measurement.
 *
 * So: copy the source elsewhere, symlink `node_modules` rather than copying
 * hundreds of megabytes, and build there. The dev server never notices.
 */
/**
 * Prepare an isolated copy of the project. Shared by both checks.
 *
 * Run once, then typecheck and bundle each run against the result, so the
 * copy is not paid for twice.
 */
export const CHECK_PREPARE_COMMAND =
  env("PREPARE_COMMAND") ??
  [
    "rm -rf /tmp/datum-build /tmp/datum-src.tar",
    "mkdir -p /tmp/datum-build",
    "cd /home/user",
    // `--exclude='.wh.*'` is load-bearing. The Dockerfile's
    // `rm -rf /home/user/nextjs-app` deletes a directory that exists in a
    // lower image layer, and OverlayFS records that as a root-owned
    // whiteout marker `.wh.nextjs-app`. `tar` cannot read it as `user`,
    // exits non-zero, and takes the copy down with it.
    "tar cf /tmp/datum-src.tar --exclude=node_modules --exclude=.next --exclude='.wh.*' .",
    // Two separate tar invocations rather than `tar cf - . | tar xf -`.
    // A pipeline reports the exit status of its LAST command, so a failed
    // source tar still looked successful, the build ran against a partial
    // copy, and eighteen runs burned the full five-minute timeout before
    // anyone could see why.
    "tar xf /tmp/datum-src.tar -C /tmp/datum-build",
    // Hardlink node_modules, do not symlink it.
    //
    // A symlink was the obvious choice — no data copied, hundreds of
    // megabytes saved. Turbopack rejects it outright:
    //
    //   TurbopackInternalError: Symlink [project]/node_modules is invalid,
    //   it points out of the filesystem root
    //
    // TypeScript could not resolve through it either, which produced
    // `Cannot find module 'lucide-react'` and `'class-variance-authority'`
    // across the shadcn components — failures that looked exactly like the
    // agent importing packages that were not installed.
    //
    // `cp -al` creates real directory entries pointing at the same inodes:
    // no data copied, no symlink, and the tree looks entirely ordinary to
    // anything walking it. Falls back to a real copy if /tmp and /home turn
    // out to be different filesystems, where hardlinks cannot cross.
    "(cp -al /home/user/node_modules /tmp/datum-build/node_modules || cp -r /home/user/node_modules /tmp/datum-build/node_modules)",
    // Replace the copy's Next config so the bundle step does nothing but
    // bundle.
    //
    // `--no-lint` turns off ESLint, but `next build` still type-checks, and
    // that is where the time goes: `✓ Compiled successfully in 11.0s`
    // followed by 109 seconds of "Checking validity of types" until the
    // timeout. Types are already measured separately by `tsc --noEmit`, so
    // the build was paying twice for a signal we have.
    //
    // Only the copy is touched, and only the bundle check is affected — the
    // typecheck runs against the same source with the real tsconfig. The
    // tradeoff: a generation that needs a custom next.config loses it here.
    // Rare, and it costs a bundle result rather than a type result.
    "rm -f /tmp/datum-build/next.config.*",
    // No `eslint` key: Next 16 removed the built-in lint integration, and
    // an unknown config key fails the build — which also takes `next
    // typegen` down with it, leaving the generated types missing and the
    // typecheck failing for a reason that has nothing to do with types.
    "printf 'const c={typescript:{ignoreBuildErrors:true}};export default c;\\n' > /tmp/datum-build/next.config.mjs",
    // Regenerate Next's own types in the copy.
    //
    // Next 16 writes types into `.next/types` and references them from
    // `app/layout.tsx` — `LayoutProps<"/">` and friends. The copy excludes
    // `.next` (it belongs to the dev server), so those types were absent and
    // `tsc --noEmit` failed on EVERY project with
    // `TS2304: Cannot find name 'LayoutProps'`, including "Hello world".
    //
    // That produced a 0% typecheck rate across all 16 runs — a clean,
    // plausible, completely false result about the agent. The failure was a
    // legitimate non-zero exit from a real type error, so no
    // infrastructure-fault guard could have caught it. Only the taxonomy
    // did, by showing the same TS2304 on the trivial cases.
    //
    // `|| true`: if typegen is unavailable the checks should still run and
    // report honestly, rather than the whole prepare step failing.
    // `cd` into the copy first. The chain does `cd /home/user` before the
    // tar, so typegen was running there and writing types into
    // /home/user/.next — the copy stayed exactly as empty of them as
    // before, and `TS2304: Cannot find name 'LayoutProps'` persisted
    // through a fix that looked correct in the diff.
    "cd /tmp/datum-build",
    "(./node_modules/.bin/next typegen || true)",
  ].join(" && ");

/**
 * TWO SIGNALS, NOT ONE.
 *
 * A generation can fail in two quite different ways, and merging them
 * destroys the only interesting part of the answer:
 *
 *   - **Types.** Wrong props, missing imports, a hallucinated API. The
 *     most common way generated code is wrong.
 *   - **Bundling.** Syntax the compiler rejects, a client/server boundary
 *     violation, an import that cannot resolve.
 *
 * "62% of generations build" tells you less than "88% typecheck, 71%
 * bundle" — the second says where to intervene. Same principle as keeping
 * `null` apart from `false`: do not average things that fail for different
 * reasons.
 *
 * Observed: bundling completes in ~11s. The long pole is type checking
 * roughly fifty shadcn components the agent never touched, which is a cost
 * worth knowing about rather than hiding inside one number.
 */
export const TYPECHECK_COMMAND =
  env("TYPECHECK_COMMAND") ??
  "cd /tmp/datum-build && ./node_modules/.bin/tsc --noEmit";

export const BUNDLE_COMMAND =
  env("BUNDLE_COMMAND") ??
  [
    "cd /tmp/datum-build",
    // `npx next build --no-lint`, not `npm run build`, for two reasons.
    //
    // LINT IS NOT THE SIGNAL. A run that reached the 10-minute timeout
    // showed `✓ Compiled successfully in 11.0s` followed by nine and a half
    // minutes stuck in "Linting and checking validity of types". The
    // compiler had already answered the question; ESLint then hung and took
    // the verdict with it. A generation should not be scored a failure for
    // a style rule, and it certainly should not be scored unknown because
    // one hung.
    //
    // Calling `next` directly also sidesteps npm's argument handling, which
    // has already swallowed one flag in this project (`--dry-run`).
    //
    // Telemetry stays off: it phones home on first build over an unreliable
    // sandbox network, producing the "Retrying 1/3..." loops that consumed
    // earlier timeouts before the compiler ever started.
    // Direct binary path. Not `npx`, not `npm run`.
    //
    // `npx next` resolves through node_modules/.bin, and with node_modules
    // symlinked that resolution can miss — at which point npx goes to the
    // registry to fetch `next`, over the same unreliable sandbox network
    // that produced the earlier "Retrying 1/3..." loops. The symptom was a
    // 240s timeout whose entire captured output was
    // "⚠ Linting is disabled.": it never reached the compiler at all.
    //
    // An explicit path cannot silently become a network call.
    // No `--no-lint`. Next 16 removed the flag along with the built-in lint
    // integration, and passing it fails with `unknown option '--no-lint'`
    // before the build starts.
    //
    // The flag is also unnecessary now: with no lint step in `next build`,
    // there is nothing to skip. Type checking is disabled through the
    // generated next.config above, since `tsc --noEmit` measures that
    // separately.
    "NEXT_TELEMETRY_DISABLED=1 ./node_modules/.bin/next build",
  ].join(" && ");

/** The copy is made by the command itself, so start from the project root. */
export const BUILD_CHECK_CWD = env("BUILD_CWD") ?? "/home/user";

/**
 * A hung build must not hold a sandbox open indefinitely. Kept well under
 * SANDBOX_TIMEOUT_MS so the sandbox outlives the check rather than the
 * other way round.
 */
/**
 * Separate timeouts, because the two checks have different shapes.
 *
 * Bundling is ~11s observed, so 2 minutes is generous. Type checking walks
 * every shadcn component and legitimately takes longer.
 *
 * A long timeout is expensive twice: it holds a sandbox against E2B's
 * concurrency cap, and it delays finding out something is wrong. The 5- and
 * 10-minute ceilings used earlier were sized for a hang, not for a build.
 */
export const PREPARE_TIMEOUT_MS = envInt("PREPARE_TIMEOUT_MS", 60_000);
/** Bundling alone is ~11s once type checking is out of the build. */
export const BUNDLE_TIMEOUT_MS = envInt("BUNDLE_TIMEOUT_MS", 90_000);
export const TYPECHECK_TIMEOUT_MS = envInt("TYPECHECK_TIMEOUT_MS", 3 * 60_000);

/**
 * Release the sandbox once an eval run is measured.
 *
 * E2B caps concurrent sandboxes at roughly 20. Each run creates one and
 * leaves it alive for SANDBOX_TIMEOUT_MS — thirty minutes — so a batch
 * longer than that accumulates sandboxes until `Sandbox.create` starts
 * throwing RateLimitError. Lowering dispatch concurrency does nothing,
 * because the problem is how long each sandbox *lives*, not how fast they
 * are created.
 *
 * Only eval runs. A user's sandbox is serving their live preview; killing
 * it would delete the thing they are looking at.
 */
export const KILL_SANDBOX_AFTER_EVAL = envFlag("KILL_EVAL_SANDBOX");

/**
 * How many agent runs may execute at once.
 *
 * THE LEVER THAT ACTUALLY CONTROLS SANDBOX PRESSURE.
 *
 * `npm run eval concurrency=N` throttles how fast *events are sent*. It has
 * almost nothing to do with how many sandboxes exist. The script's pool
 * awaits `inngest.send`, which resolves as soon as the event is accepted —
 * so twenty-four events go out over a few seconds regardless of the
 * setting, and Inngest then runs the functions with its own concurrency,
 * which was unset and therefore effectively unbounded.
 *
 * The batch output printed "concurrency 1", which reads as one run at a
 * time and was never true. Every batch was sending the whole golden set at
 * once and then meeting E2B's concurrent-sandbox cap, which surfaced as
 * roughly fifteen infrastructure faults — the same count every time, which
 * is what a ceiling looks like and not what contention looks like.
 *
 * THAT LAST PARAGRAPH TURNED OUT TO BE WRONG, AND IS LEFT AS WRITTEN.
 *
 * The fifteen faults were an artifact: `baseline.ts` scoped its rate query
 * by config version and counted exclusions across the whole table, so every
 * batch reported the same historical total. Constant because it was the
 * same fifteen rows, not because anything hit a ceiling.
 *
 * The cap is kept — twenty-four sandboxes at once against a cap of about
 * twenty is a real risk regardless — but it is untested, and the reasoning
 * above is preserved rather than quietly corrected so the mistake stays
 * visible next to the thing it produced.
 *
 * E2B caps concurrent sandboxes at about twenty. This sits below that with
 * headroom, because USER runs share the same quota and hold their sandboxes
 * for the full SANDBOX_TIMEOUT_MS so someone can look at the preview.
 *
 * Raising it trades batch duration for infrastructure faults. Check the
 * fault count in `npm run baseline` after any change: a throttled batch
 * reports rates drawn from whichever runs got through, which is not a
 * random sample of the golden set.
 */
export const AGENT_CONCURRENCY = envInt("AGENT_CONCURRENCY", 12);

/** How much build output to keep. Enough to diagnose, not enough to bloat a row. */
export const BUILD_STDERR_LIMIT = envInt("BUILD_STDERR_LIMIT", 4_000);
