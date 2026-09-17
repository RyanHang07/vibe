# Vibe: where this is going

Scoped to this repo. The full two-project plan lives in `ai-project/PLAN.md`.

> Build an observe → diagnose → act → verify loop for AI agents.
> Point it at Vibe.
> Show build success rate going from X to Y, with proof it wasn't noise.

---

## The claim

Not *"I built an agent."* AgentKit orchestrates and E2B sandboxes; neither is mine.

**"I built the thing that tells you whether the agent works."**

True, defensible, and nobody else is saying it.

---

## The loop

| Stage | What it does | Who does it today |
|---|---|---|
| **Observe** | Log every run: prompt, output, build result, latency, cost | Maka, loopx, everyone |
| **See** | Make a long trace readable at a glance | Nobody well |
| **Diagnose** | Cluster failures into named, persistent shapes | Nobody |
| **Act** | Apply an intervention as a versioned object | Nobody |
| **Verify** | Re-run affected cases, separate signal from noise | Almost nobody correctly |

Everyone builds stage 1. The value is 2 through 5.

---

## Why this repo is the right subject

Code either builds or it doesn't. Hard metrics, **no LLM judge needed** for the primary signal:

- build success rate
- run success rate
- retry count
- tokens per successful generation
- time to first working preview

**None of these exist yet.** See `AUDIT.md` S4: success is currently defined as "the agent said something and wrote a file." Until that changes, every improvement is unfalsifiable.

---

## What "act" means

Small, enumerable intervention surface. Each becomes a versioned object the harness can apply and A/B:

- change a prompt (`src/prompt.ts`)
- change a tool description (`inngest/functions.ts`)
- retry with the compiler error fed back
- route to a different model
- insert a validation gate before returning
- change what context the agent sees (currently a hardcoded `take: 5`)

---

## The four hard problems

**1. Cluster identity across runs.** Clustering failures is easy. Keeping shape IDs stable when today's clustering splits or merges yesterday's is the work.

**2. Regression vs. noise.** Variance estimation, paired bootstrap, multiple-comparison correction. Testing twenty shapes is twenty hypotheses; one looks significant by chance.

**3. A judge you validated.** Only needed for the secondary signals. Hand-label a stratified sample, report Cohen's kappa with a confidence interval.

**4. Cheap evaluation.** Score cases by how well they discriminate between variants. Run the informative subset by default.

---

## The visual

**2D timeline for one run.** The workhorse.

**3D terrain for many runs.** X = step, Y = run, Z = cost or latency, colour = outcome.

- ridge across Y → every run spikes at that step
- one tall spike → a single pathological run
- rising slope → degradation over time

Build 2D first so the 3D is never decoration.

---

## Decisions made 12 Sept 2026

| Question | Answer | Why |
|---|---|---|
| What counts as success? | **`npm run build` exits 0** in the sandbox | Unambiguous, cheap, no judge needed. Code can compile and still be wrong — that's a known limit, and stronger signals layer on later. |
| Where does telemetry live? | **Postgres, via Prisma** | Already running. You own the schema, query it in SQL, and the harness reads the same store. No new vendor. |
| How do evals run? | **Live E2B sandboxes, 20-40 cases** | Real generations, so a prompt change actually shows up. Small enough to run daily. |

---

## Verification: slices 1 and 2 confirmed 15 Sept 2026

Both observed working end to end on `trivial-01`.

| Claim | Result |
|---|---|
| `startRun` / `finishRun` write rows in the Inngest step context | confirmed |
| `sandbox.commands.run` surfaces a non-zero exit as `build-check.ts` expects | confirmed — `exitCode` arrives on the thrown error |
| the build check meaningfully lengthens a run | **6.4s** against a 15.4s total |
| `npm run build` succeeds in the current E2B template | **no — it exits 1.** Under investigation. |

At 6.4s per check, the full 24-case set at concurrency 2 is roughly three minutes. Cheap enough to run daily.

### Bugs the verification found

Four, in the order they surfaced. Every one was invisible before the instrumentation existed:

1. **`createOrUpdateFiles` swallowed write failures.** Returned `"Error " + e`, then gated the state update on `typeof === "object"`, so a failed write silently left the file map empty — and the handler returned `undefined` regardless, so the model got no tool result and assumed success. Produced the signature failure: a confident `<task_summary>` describing files that do not exist, with `fileCount` zero and no recorded reason.
2. **`lastAssistantTextMessageContent` called on the network result**, which has no `.output`. A TypeError inside the code added to explain failures.
3. **`network.run` was unguarded**, so a throw killed the function before `save-result` — no user message, and a row stuck in `RUNNING` forever.
4. **The build check discarded its output on failure.** `stdout`/`stderr` were scoped inside the `try`, so the `catch` fell back to e2b's error message, which is the string `"exit status 1"`. The output is the entire reason to run the check, and it was being lost precisely when the check failed.

### The first real finding

On the first run that got far enough to be measured:

```
reported success, and built     0
reported success, did NOT build 1
```

**The app told the user it worked, on code that does not compile.** Exactly the gap the old `!summary || fileCount === 0` heuristic was hiding, and it is only visible because both signals sit on the same row.

One data point proves nothing about the rate. It proves the instrument can see it.

### Measured cost of the build check

**93.4s of a 103.8s run.**

The user's result message is written before the check starts, so nobody waits on it. But the build runs **inside the same sandbox serving their live preview**, competing for CPU for a minute and a half while they are first clicking around in it.

That is a measurement degrading the thing it measures, which is how instrumentation gets switched off — and then you have neither.

**Resolution:** eval runs are always checked; user runs never are, by default. `VIBE_BUILD_CHECK_USER_RATE` samples production traffic if that visibility is ever worth the cost. The baseline comes from the eval set regardless, so nothing is lost.

**Revised batch estimate:** ~104s per case at concurrency 2 across 24 cases is **roughly 20 minutes**, not the three minutes estimated from a build that was failing in 6s. Runnable, but not something to fire off casually.

### First full batch: 24 cases, 3 usable

Ran 15 Sept. Almost entirely wasted, for two compounding reasons worth recording.

**The whiteout file.** The Dockerfile's `WORKDIR /home/user/nextjs-app` creates that directory in one image layer; the later `rm -rf` deletes it in another. OverlayFS records the deletion as a root-owned marker, `.wh.nextjs-app`, which persists in the running sandbox and cannot be read by `user`. Anything that walks `/home/user` trips on it.

**The pipeline hid it.** `tar cf - . | (cd /tmp && tar xf -)` reports the exit status of its *last* command. The source tar failed, the destination tar succeeded on partial input, `&&` saw success, and the build ran against an incomplete copy — burning the full five-minute timeout, eighteen times.

So a shell idiom quietly converted a fast, loud failure into a slow, silent one. Two separate `tar` calls now, each checked by `&&`.

| | |
|---|---|
| dispatched | 24 |
| usable build verdicts | **3** |
| unjudged (permissions) | 18 |
| never finished | 7 |

The guard held throughout: all 18 recorded `UNKNOWN`, not `FAIL`. Had they been scored as failures the batch would have reported roughly 10% build success, and nothing in the output would have suggested the number was about `tar`.

**That is the whole thesis, demonstrated on its author.** The measurement was broken in a way that produced a plausible-looking result, and the only reason it did not become a "finding" is that the harness was built to distinguish "did not compile" from "could not be judged".

### Second batch: the rate limit was sandbox lifetime, not dispatch rate

`RateLimitError` from `_Sandbox.createSandbox`. **E2B, not the model provider**, and the cap is roughly 20 *concurrent sandboxes*.

The instinct — lower dispatch concurrency — does nothing, because the constraint is how long each sandbox **lives**, not how fast they are created. Every run opened one and left it alive for `SANDBOX_TIMEOUT_MS`, thirty minutes. A forty-minute batch therefore starves itself somewhere around run 21, regardless of pacing.

Eval runs now release their sandbox as soon as the build result is recorded. User runs never do: that sandbox is serving the live preview.

Two smaller fixes from the same batch:

- **`NEXT_TELEMETRY_DISABLED=1`.** First-build telemetry phones home over an unreliable sandbox network, producing `Retrying 1/3...` loops that consumed the timeout without reaching the compiler.
- **Build timeout 5 → 10 minutes.** A one-file generation built in 93s; these were four to eight files on a contended host.

### The bundle check was measuring types twice

Once the output capture was fixed, the cause was one line:

```
[timed out after 120s]
✓ Compiled successfully in 11.0s
  Checking validity of types…
```

**Bundling: 11 seconds. Type checking inside the build: everything else.** `--no-lint` disables ESLint only; `next build` still type-checks, and `tsc --noEmit` was already measuring exactly that in its own step.

So the bundle check was paying a second time for a signal already held, and the duplicate is what kept timing out.

Fixed by replacing the *copy's* `next.config` with one that sets `ignoreBuildErrors`. The bundle step now bundles and nothing else. Types are unaffected — they are checked against the same source with the real tsconfig, one step earlier.

Worth noticing how this was found. The four rounds spent guessing at the hang were caused by `stderr || stdout` discarding the build log, so the evidence existed the whole time and was being thrown away at capture. **The debugging cost was not the bug; it was the instrumentation gap in front of it.**

### Earlier: typecheck works; bundling hangs

`tsc --noEmit` passes in ~14s. That signal is live.

`next build --no-lint` prints `⚠ Linting is disabled.` and then stops, hitting whatever timeout it is given — 5, 10, then 2 minutes.

**Diagnosis was blocked by a bug in the capture itself.** Output was `stderr || stdout`, so a single warning on stderr discarded the whole build log. Every bundle timeout reported one line and hid everything before it, which read as "the build produced no output" rather than "the output is being thrown away".

A capture that silently drops the useful half is worse than none, because it looks like evidence. Fixed to keep both streams, labelled, plus an explicit `[timed out after Ns]` marker — "it stopped" and "it failed" are indistinguishable in a log otherwise, and only one of them is about the code.

Remaining hypotheses, in order:

1. **Static generation needs the network.** Next spawns workers to collect page data and render static pages; fonts or other fetches over the unreliable sandbox network would hang exactly here.
2. **The `node_modules` symlink confuses Next's workers.** Module resolution through a symlinked root is fine for Node, less certain for Next's build tracing.
3. **Genuinely slow** on a contended host — though 11s to compile makes a 2-minute stall unlikely to be simple slowness.

### Still open

- One row stuck in `RUNNING` from an aborted attempt. `findStuckRuns` exists; nothing consumes it yet.
- Why `npm run build` exits 1 in the sandbox. Possibly a genuine bad generation, possibly the template.

---

## Slices

Each leaves the repo green. Stop and explain after each.

**1. Record what happened.** A `Run` table. One row per agent invocation: prompt, project, provider, model, timings, token counts, outcome. No scoring yet.
*Introduces: nothing conceptually new. Purely additive, lowest risk, and nothing below is possible without it.*

**2. Ask the sandbox whether it built.** After the agent finishes, run the build inside the sandbox and store the exit code and stderr on the `Run`.
*Introduces: the success signal. This is the number everything else is measured against.*

**3. A fixed set of prompts.** 20-40 cases in a file, plus a script that runs them all and writes `Run` rows.
*Introduces: the golden set. A baseline needs the same inputs every time, or you're comparing different questions.*

**4. Report the baseline.** Read the `Run` rows, print build success rate with a confidence interval. `npm run baseline`.
*Introduces: statistics. Specifically why "62%" is not an answer without knowing how many runs produced it.*

> **Wilson, not the textbook interval.** `p ± z·sqrt(p(1-p)/n)` gives 0% ± 0 at zero successes — certainty, from twenty observations. The adversarial tier is built to score zero, so that is the common case here, not an edge case. Wilson never collapses to zero width and behaves at small n.
>
> **What 24 cases can resolve.** A ±10 point interval needs about 96 runs. At 24, differences under roughly 20 points are indistinguishable from noise. That is a property of the sample size, not a thing better analysis can fix — the honest move is to say so in the output rather than report a number that implies more precision than exists.

**5. Failure taxonomy.** Name the failure shapes, keep the names stable across runs. `npm run shapes`.
*Introduces: deterministic signatures — and the argument for not reaching for embeddings.*

> **Built without clustering, on purpose.** The plan assumed embed → cluster → label, whose hard problem is cluster identity across runs: today's clustering splits yesterday's shape, and every ID that referred to it stops meaning anything.
>
> Compiler output is structured. TypeScript carries error codes and templated messages; Next emits a small fixed set of build errors. A signature can be extracted deterministically by normalising away paths, line numbers, quoted identifiers and hashes — and then **the signature is the identity.** No drift, no rematching, no relabelling.
>
> Take that trade wherever the input has structure. Embeddings remain right for the unstructured tail — agent refusals, prose — which is what `UNCLASSIFIED` is the hook for.
>
> **Unclassified failures are never absorbed into a catch-all shape.** A bucket that swallows what it doesn't understand reports a tidy taxonomy while hiding the failures nobody has looked at, and those are the interesting ones.

**6. Interventions as versioned objects.** Change one thing, re-run, report whether it moved beyond noise. `lib/interventions.ts`.
*Introduces: the loop closing. This is the point of the project.*

> Every run records its `configVersion`. `npm run baseline version=<name>` reads one configuration; without it, the report warns when several are mixed, because averaging configurations produces a number describing nothing that ever ran.
>
> **Three rules.** One change per version. Bump the version in the same commit as the change. Write the prediction down *before* running — predicting afterwards is how a null result becomes a success story.

### v2 result: prediction wrong, and usefully so

Predicted: 400s largely disappear on moderate and complex, possibly persist on adversarial.

Observed: **400s on all 24 cases, including `trivial-01`.** "Build a page that says Hello world" cannot exhaust a context window, so the diagnosis was wrong — and the batch is worse than v1, not better.

Two things follow.

**The intervention is unproven, not disproven.** If every case fails at the provider, the batch measures the provider, not the change. Truncation may still be correct; nothing here says either way. Recording it as "v2 made things worse" would be the same error as scoring an EACCES build as a code failure.

**The real gap is diagnostic.** Twenty-five runs recorded `AIGatewayError: unsuccessful status code: 400` and nothing else. Context length, a malformed request, a quota, a rejected tool schema — all produce that identical string. Providers put the reason in the response body, and errors carry it on non-enumerable properties that `${error}` drops silently.

Three rounds of diagnosis have now run on a status code alone. Error capture now serialises every own property plus `cause`.

**The pattern, for the third time:** the expensive part was never the bug. It was the instrumentation gap sitting in front of it — `stderr || stdout` before, `${error}` here.

### Intervention v1 → v2: truncate tool output

**Observation.** `moderate-01` and four of five adversarial cases failed with `AIGatewayError: unsuccessful status code: 400` after 300-400s and zero files, concentrated in long multi-step generations.

**Cause.** `terminal` returned `result.stdout` in full; `readFiles` returned every requested file's entire contents. Both stay in the conversation for all remaining iterations, so with `maxIter` 15 a single `npm install` is replayed fifteen times. Context fills, provider rejects.

**Prediction, written before running:**

- 400s on moderate and complex cases largely disappear
- adversarial 400s may persist — those fail for lack of anything achievable, not only context
- **typecheck and bundle rates on already-completing cases unchanged**

The third is the one that matters. A change that fixes the failure and quietly degrades everything else still looks like a win in one headline number.

---

## Order

**Blocking, from `AUDIT.md`:**

0. S1 copy + S2 constants — the only untrue things currently shipping
1. S1 architecture — get the API key out of Inngest event payloads
2. S3 — make BYO-key consistent across both paths
3. S5 — models to config, remove the hardcoded test template name

**Then the plan proper:**

4. Build verification — the signal everything else depends on
5. Instrument the generation loop, establish a baseline
6. Eval harness against build success rate
7. 2D trace view
8. Failure taxonomy
9. Interventions as versioned objects
10. 3D aggregate terrain
11. Writeup

**Ship after 8.** Steps 9-11 are tempting and can wait.

Rebrand belongs after 5, not before. A new coat of paint on an app that reports "Something went wrong" for four different failures is worse than no rebrand.

---

## Phase 2: multi-agent, as a measured experiment

**Gate: do not start until the single-agent baseline exists.** Without it there is nothing to compare against.

Almost every multi-agent project *asserts* it's better. This one would **measure** it. If multi-agent loses, that's the stronger writeup.

| Agent | Job |
|---|---|
| Planner | Decompose the request into a file plan |
| Builders | Generate files, parallel where independent |
| Critic | Typecheck, run, review against the original request |
| Integrator | Resolve conflicts between parallel builders |

The genuinely agent-to-agent part: the Critic sends structured failures back to specific Builders, which revise. Needs a termination condition or it loops forever.

Multi-agent usually loses to a single well-prompted agent because of context fragmentation. It wins on: truly independent subtasks, adversarial review by a different objective, per-agent tool access, per-job model choice. **Vibe hits all four**, which is why it's defensible here.

Expected new failure shapes, worth predicting before seeing them:

- Builders disagree on a shared interface
- Critic loops forever on a subjective complaint
- Planner produces a decomposition no Builder can satisfy
- Integration conflicts nobody owns
- A Builder re-solving a problem the Planner already solved differently

---

## How this gets built

**Ship in slices, and stop after each one.**

A slice is the smallest change that leaves the repo green and does one thing. After each, stop and explain before moving on:

- what the slice does, in plain terms
- why it was done that way rather than the obvious alternative
- what it now makes possible that wasn't possible before

Assume no prior familiarity with the concept being introduced. Evals, tracing, clustering, and the statistics are all new ground; the TypeScript and Postgres are not. Explain the new thing, not the language.

The point is not documentation. It's that the writeup at the end is only possible if the reasoning was legible while it was happening.

---

## Commit convention

Title only. A type prefix, then phrases joined by ` + `, first letter of each phrase capitalised.

```
Update: Security + Dependency upgrade + Type safety + CI bootstrap
```

One phrase per distinct concern. If the list runs past four, that's a sign the commit should have been more than one.

---

## Tech

**Reused:** TypeScript, Next.js, Postgres, Prisma, Inngest

**New:** Python + async, clustering (HDBSCAN), embeddings, statistics (bootstrap, kappa, multiple comparisons), OpenTelemetry, Langfuse, pytest plugin authoring, Docker, Three.js on real data

**Phase 2:** LangGraph (state, checkpointing, cycles), multi-agent orchestration, a Python service behind Next.js, queues
