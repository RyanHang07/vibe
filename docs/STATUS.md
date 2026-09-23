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

## First baseline — 23 Sept 2026

Config `v3-nextjs16-truncate`, template `mxamtmd9qj4rtpavlkdd`,
`claude-haiku-4-5` (lightest tier). **44 runs.**

```
  typecheck      39/44  =  88.6%  [76.0%, 95.0%]
  bundle         39/44  =  88.6%  [76.0%, 95.0%]

  by difficulty
    trivial       8/8   = 100.0%
    simple        9/10  =  90.0%
    moderate     10/11  =  90.9%
    complex       7/8   =  87.5%
    adversarial   5/7   =  71.4%
```

### The measurement is stable

| | 21 runs | 44 runs |
|---|---|---|
| typecheck | 90.5% [71.1, 97.3] | 88.6% [76.0, 95.0] |
| false success | 14.3% [5.0, 34.6] | 12.2% [5.3, 25.5] |

Point estimates held; intervals roughly halved. More data narrowing the
bracket without moving the answer is what a reliable instrument looks like.

### The ceiling problem

**At 88.6% with ±19 points of resolution, no intervention can be shown to
improve the pass rate.** The ceiling is 100%, so the largest possible gain
is 11.4 points — inside the noise floor. 97 runs would give ±10, still
marginal; resolving a real improvement up there needs several hundred.

So truncation, `maxIter` and Haiku → Sonnet will all report "not
distinguishable", and not because they did nothing.

**Cost is where the comparisons live.** A continuous measure compares
distributions rather than counting successes, so a difference shows up with
a fraction of the samples a rate needs. `npm run baseline` now reports
median, p10-p90 and mean time to a passing generation.

**Latency, not tokens, and the reports say so.** `inputTokens` and
`outputTokens` have existed since slice 1 and have never been populated.
An extractor was written for them, and it was dead code: AgentKit's
`AgentResult` carries `output`, `toolCalls`, `createdAt` and `prompt` and no
usage at all. Token counts appear only on the streaming `run.completed`
event, which `network.run()` never emits. Capturing them means moving the
agent onto the streaming interface, which is not a mid-baseline change.

So the extractor was deleted rather than left in place looking like working
instrumentation. `durationMs` is recorded on every run, is continuous, and
is a proxy for cost rather than a price — which is exactly the kind of
substitution this project exists to refuse to make silently, so the comment
in `functions.ts` and the output of `baseline` both name it.

### The finding

```
  the old signal said 41/44 succeeded
  of those, 5 did not compile  5/41 = 12.2%  [5.3%, 25.5%]
```

**The app reported success to the user on roughly one in seven runs whose
code does not compile.** That is the number the project was built to
produce, and it now has an interval around it.

### Why this one counts

```
  0 build ran but could not be judged
```

Zero unjudged. Every run that produced code got a verdict. Previous
attempts reported 52 unjudged against 13 counted, and every rate drawn from
them was a statement about `tar`, file permissions, or a missing `.next`
directory.

### What it still cannot support

- **21 runs, ±30 points.** A later batch must clear that bracket to have
  moved. 97 runs would be needed for ±10.
- **13 infrastructure faults** in the same batch — rate limits and sandbox
  exhaustion. The surviving runs are therefore not a random sample of the
  golden set.
- **2 runs still RUNNING**, never swept.
- `adversarial-01` passes, which means the adversarial tier is not
  discriminating: "Make it better" produces a confident invention, and a
  confident invention compiles. The compiler cannot tell invention from
  correctness.

### The model bet

The policy pinned the **lightest** tier with heavier ones documented as
upgrades, on the argument that starting heavy hides the question. Haiku is
typechecking at 90.5%. No measurement yet says Sonnet would be better, and
now there is a baseline to test that against.

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

## The template is the least-pinned part of the measurement

Rebuilding it surfaced how much of the "target" was never fixed at all. Four things changed meaning without anything recording it:

| | |
|---|---|
| `create-next-app` | `@15.3.3` → `@16`, a deliberate bump, but `@16` still floats within the major |
| `shadcn` CLI | briefly `@latest` by accident — two builds a month apart would produce different targets |
| `-b` | repurposed from base colour to component library between 2.x and 4.x |
| `add --all` | **enumerates the live registry**, so the component set was never pinned even with a pinned CLI |

That last one broke the build outright: shadcn@2.6.3 asked the registry for `questionnaire`, a component added after 2.6.3 shipped, and could not fetch it. **A pinned client defeated by an unpinned remote.**

Now an explicit list of 29 components. Reproducible, roughly 40% smaller, and it should shorten `tsc --noEmit` — which was the slowest step in every check, spent almost entirely on components the agent never wrote.

**The general problem remains open.** The template decides the framework version, the component library, and what the agent generates against. None of that appears in a `Run` row, so two batches built against different templates are not comparable and nothing would say so. Recording the template ID alongside `configVersion` is the fix, and it belongs with the interventions work.

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
