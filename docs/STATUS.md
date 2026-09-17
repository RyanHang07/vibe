# Where this project is

Written 17 Sept 2026. Companion to `PLAN.md` (the destination) and `AUDIT.md` (what was wrong at the start).

---

## What it started as

A tutorial-shaped AI app-builder with a false security claim, an inverted pricing tier, no tests, no CI, and `ignoreBuildErrors: true` switching off the compiler.

## What it is now

**A measurement harness that happens to be attached to a code-generation agent.**

That inversion is the important part. The agent is off-the-shelf — AgentKit orchestrates, E2B sandboxes, Anthropic generates. None of it is the contribution. The contribution is everything that decides whether a generation was any good, and whether a change made it better.

> **"I didn't build an agent. I built the thing that tells you whether the agent works."**

---

## Built and working

| Piece | State |
|---|---|
| `Run` table — every invocation recorded | working |
| Typecheck signal (`tsc --noEmit`) | working, ~11-60s |
| Bundle signal (`next build`) | working, ~11s once types were removed from it |
| Golden set — 24 cases, graded, stable ids | written |
| Smoke set — 4 cases for development | working |
| `npm run report` — run table, failures, prune, sweep | working |
| `npm run baseline` — Wilson intervals, per tier, per config | working |
| `npm run shapes` — deterministic failure taxonomy | working |
| `npm run check:model` — provider bisect + key provenance | working |
| Infrastructure-fault guard | working, and has saved the baseline repeatedly |
| Intervention versioning (`configVersion` on every run) | working |
| Vitest + CI (typecheck, lint, test, build) | working |

**Security and correctness fixes:** false API-key claim, inverted plan allowances, error page that never rendered, `parseAgentOutput` crashing runs into silence, sandbox lifetime cut to a third, `apiKey: null` failing every keyless creation, 71 npm vulnerabilities to 0 including a critical Clerk auth bypass.

---

## The idea the project actually turned out to be about

Not "measure an agent". **Refusing to record one thing as another.**

Every hard-won piece is an instance of it:

- `null` is not `false` — "could not be judged" is not "failed"
- an infrastructure fault is not a code failure
- a rate limit is not a bad generation
- an abandoned run is not a failure
- types failing is not bundling failing
- "the agent said it worked" is not "it works"
- an unclassified failure does not belong in a catch-all

Every single one of those distinctions has since prevented a false number. The clearest case: eighteen runs failed on a `tar` permissions error, and had they been scored as failures the batch would have reported ~10% build success — plausible, publishable, and entirely about a whiteout file.

**And the second finding, which was not planned:** the expensive part of every bug was the instrumentation gap in front of it, not the bug.

- `stderr || stdout` discarded the build log → four rounds guessing at a hang
- `${error}` discarded the response body → three rounds guessing at a 400
- no run record at all → the first week of the project

---

## Agreed sequence — 17 Sept

Decided deliberately, recorded so the order survives the next interruption.

| # | Step | Why here |
|---|---|---|
| 1 | README + LICENSE (S8) | **done.** Last untrue thing in the repo. |
| 2 | Rebuild E2B template — `chown` + Next 16 | Removes the permissions fault class, and baselines against a current target rather than a stale one |
| 3 | Verify one generation builds on the new template | A template that cannot build turns every case into an infrastructure fault |
| 4 | Resolve the 400s | Nothing can be measured until runs complete |
| 5 | Clean full batch → **baseline** | The first number worth defending |
| 6 | Re-test intervention v2 (truncation) | Already written, prediction already on record, unresolved rather than disproven |
| 7 | Further interventions | `maxIter`, model tier |
| 8 | Encryption middleware (S1) | After the baseline — it changes the event path the harness measures |
| 9 | Trace visualisation, then the writeup | |

**Two consequences of doing the template bump at step 2 rather than measuring it:**

- It is a prerequisite, not a result. The baseline describes Next 16 output, and pre-bump runs are not comparable to post-bump ones.
- If `create-next-app@16` breaks shadcn compatibility, step 3 catches it before a batch does.

---

## Pending — blocking a baseline

**1. The 400s.** Every case, including `trivial-01`, failed with `AIGatewayError: unsuccessful status code: 400`. Context exhaustion cannot explain a "Hello world" page, so the v2 diagnosis was wrong. Error capture now serialises the response body; the next failure should say what it actually is. Suspect: the API key resolving to the wrong account (see below).

**2. Key provenance.** `.env` does not override an environment variable that is already set — not in Next.js, not in Node's `--env-file`. A stale `ANTHROPIC_API_KEY` at Windows user or machine level silently wins, for the app and every script. Billing was landing on an unexpected account. `npm run check:model` now reports which source won.

**3. Sandbox leak on the failure path.** Fixed just now. The release step only ran on success, so failed runs held sandboxes for thirty minutes — a batch of 24 failures held 24 against E2B's ~20 cap, and rate-limited the *next* batch. Cleanup that only runs on the happy path guarantees the mess accumulates exactly when things go wrong.

**4. A clean full batch.** None has completed. Every attempt so far has been dominated by harness faults, not agent failures.

---

## Pending — after the baseline

**Intervention v2 is unresolved, not disproven.** Truncating tool output may well be correct; the batch that tested it failed at the provider on every case, so it measured nothing. Re-run once the 400s are understood.

**Interventions worth queueing**, each one change with a prediction written first:

- tool output truncation (v2, pending re-test)
- `maxIter` — currently 15, chosen by the tutorial
- the E2B template pinned at `create-next-app@15.3.3` while the host runs 16.3.5 — the agent targets the template, so bumping it changes what "correct" means
- model tier: Haiku is the current default with Sonnet as the documented step up, and no measurement yet says which is right

**Then:** the 2D trace view, the 3D aggregate terrain, and the writeup.

---

## Still open from `AUDIT.md`

- **S1** — API key still travels in Inngest event payloads. Copy is honest; the plumbing is not fixed. `@inngest/middleware-encryption` is the intended fix.
- **S3** — BYO-key charges credits on the message path but not the project path, so those users pay twice.
- **S7** — the credit error branch is correct only by accident of how `rate-limiter-flexible` rejects.
- **S8** — README still claims a collaboration feature that does not exist, an MIT licence with no LICENSE file, and a `your-repo` placeholder.

**S8 is the one to do next.** It costs twenty minutes and it is the only thing in the repo that is still untrue.
