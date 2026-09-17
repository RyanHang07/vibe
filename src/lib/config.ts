/**
 * App-level constants that used to be magic numbers inside
 * `src/inngest/functions.ts`. See docs/AUDIT.md S5.
 *
 * Everything here is environment-overridable so a value can be changed
 * without a deploy — which is what makes A/B-ing an intervention possible
 * (docs/PLAN.md, "What act means").
 */

const int = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

/**
 * E2B sandbox template.
 *
 * This shipped as the literal "vibe-nextjs-ryan-test-2" — a personal test
 * template, hardcoded in the run path.
 */
export const SANDBOX_TEMPLATE =
  process.env.VIBE_SANDBOX_TEMPLATE ?? "vibe-nextjs-ryan-test-2";

/** How long a sandbox stays alive. Was written as `3 * 10 * 60_000`. */
export const SANDBOX_TIMEOUT_MS = int(
  process.env.VIBE_SANDBOX_TIMEOUT_MS,
  30 * 60 * 1_000,
);

/**
 * Maximum agent iterations before the network gives up.
 *
 * Hitting this produces no summary, which currently surfaces to the user as
 * the same "Something went wrong" as a sandbox failure or a model error.
 * Distinguishing the two is tracked in docs/AUDIT.md S4.
 */
export const MAX_AGENT_ITERATIONS = int(process.env.VIBE_MAX_ITERATIONS, 15);

/** Prior messages replayed into agent state as conversation context. */
export const MESSAGE_HISTORY_DEPTH = int(process.env.VIBE_HISTORY_DEPTH, 5);

/* ---------------------------------------------------------------- *
 * Build check (docs/PLAN.md slice 2)
 * ---------------------------------------------------------------- */

/** Off switch. The check costs sandbox time, so it must be disableable. */
export const BUILD_CHECK_ENABLED =
  (process.env.VIBE_BUILD_CHECK ?? "true") !== "false";

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
export const BUILD_CHECK_USER_SAMPLE_RATE = Number.parseFloat(
  process.env.VIBE_BUILD_CHECK_USER_RATE ?? "0",
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
  process.env.VIBE_PREPARE_COMMAND ??
  [
    "rm -rf /tmp/vibe-build /tmp/vibe-src.tar",
    "mkdir -p /tmp/vibe-build",
    "cd /home/user",
    // `--exclude='.wh.*'` is load-bearing. The Dockerfile's
    // `rm -rf /home/user/nextjs-app` deletes a directory that exists in a
    // lower image layer, and OverlayFS records that as a root-owned
    // whiteout marker `.wh.nextjs-app`. `tar` cannot read it as `user`,
    // exits non-zero, and takes the copy down with it.
    "tar cf /tmp/vibe-src.tar --exclude=node_modules --exclude=.next --exclude='.wh.*' .",
    // Two separate tar invocations rather than `tar cf - . | tar xf -`.
    // A pipeline reports the exit status of its LAST command, so a failed
    // source tar still looked successful, the build ran against a partial
    // copy, and eighteen runs burned the full five-minute timeout before
    // anyone could see why.
    "tar xf /tmp/vibe-src.tar -C /tmp/vibe-build",
    "ln -s /home/user/node_modules /tmp/vibe-build/node_modules",
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
    "rm -f /tmp/vibe-build/next.config.*",
    "printf 'const c={typescript:{ignoreBuildErrors:true},eslint:{ignoreDuringBuilds:true}};export default c;\\n' > /tmp/vibe-build/next.config.mjs",
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
  process.env.VIBE_TYPECHECK_COMMAND ??
  "cd /tmp/vibe-build && ./node_modules/.bin/tsc --noEmit";

export const BUNDLE_COMMAND =
  process.env.VIBE_BUNDLE_COMMAND ??
  [
    "cd /tmp/vibe-build",
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
    "NEXT_TELEMETRY_DISABLED=1 ./node_modules/.bin/next build --no-lint",
  ].join(" && ");

/** The copy is made by the command itself, so start from the project root. */
export const BUILD_CHECK_CWD = process.env.VIBE_BUILD_CWD ?? "/home/user";

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
export const PREPARE_TIMEOUT_MS = int(process.env.VIBE_PREPARE_TIMEOUT_MS, 60_000);
/** Bundling alone is ~11s once type checking is out of the build. */
export const BUNDLE_TIMEOUT_MS = int(process.env.VIBE_BUNDLE_TIMEOUT_MS, 90_000);
export const TYPECHECK_TIMEOUT_MS = int(
  process.env.VIBE_TYPECHECK_TIMEOUT_MS,
  3 * 60_000,
);

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
export const KILL_SANDBOX_AFTER_EVAL =
  (process.env.VIBE_KILL_EVAL_SANDBOX ?? "true") !== "false";

/** How much build output to keep. Enough to diagnose, not enough to bloat a row. */
export const BUILD_STDERR_LIMIT = int(process.env.VIBE_BUILD_STDERR_LIMIT, 4_000);
