# Where this project is

Updated 23 Sept 2026. Companion to [`BUILD_PLAN.md`](BUILD_PLAN.md) (what
is left), [`AUDIT.md`](AUDIT.md) (what was wrong at the start) and
[`WRITEUP.md`](WRITEUP.md) (the argument).

---

## What it is

**A measurement harness that happens to be attached to a code-generation
agent.**

The agent is off-the-shelf — AgentKit orchestrates, E2B sandboxes,
Anthropic generates. None of it is the contribution. The contribution is
everything that decides whether a generation was any good, and whether a
change made it better.

> **"I didn't build an agent. I built the thing that tells you whether the
> agent works."**

---

## The baseline — v7, 23 Sept

Config `v7-utils-truncate-1000`, template `mxamtmd9qj4rtpavlkdd`,
`claude-haiku-4-5`. **27 judged runs.**

```
  typecheck      24/27  =  88.9%  [71.9%, 96.1%]
  bundle         26/27  =  96.3%  [81.7%, 99.3%]

  by difficulty
    trivial       4/4   = 100.0%
    simple        5/6   =  83.3%
    moderate      7/7   = 100.0%
    complex       5/5   = 100.0%
    adversarial   5/5   = 100.0%

  the old signal said 25/27 succeeded
  of those, 1 did not compile   1/25 = 4.0%  [0.7%, 19.5%]
```

### Why this one is different from every batch before it

**The failure set is entirely about the agent.** Five failures in four
shapes: a type mismatch, a possibly-undefined, a prerender crash, and a run
that produced no summary. No `tailwind-merge`, no lucide brand icons, no
`@/lib/utils`. Every previous baseline contained harness failures scored
against the generation.

**Nothing was excluded that should have been counted.** 0 still RUNNING, 0
unjudged. One run produced nothing to build, and two failed after producing
a build that passed — named separately rather than filed as agent failures.

### The instrument got sharper, and not because of what I thought

```
within a case   5.0s      (was 14.2s)
paired MDE      4.0s = 10% of the mean      (was 11.5s = 27%)
```

The old within-case spread was largely sandbox contention recorded as agent
variance. At 10% of the mean, the design can now resolve effects it
previously could not — truncation's plausible 5-15% sits right at the bar.

**Caveat, and it has been right twice:** 5.0s rests on 4 cases with
repeats. Thin estimates here have been optimistic both previous times.

---

## The idea

Not "measure an agent". **Refusing to record one thing as another.**

- `null` is not `false` — "could not be judged" is not "failed"
- an infrastructure fault is not a code failure
- types failing is not bundling failing
- "module not found" is not "export not found"
- a refusal is not a failure to produce
- a run that failed *after* building is not a bad generation
- **"the agent said it worked" is not "it works"**

Each distinction has since prevented a false number. The clearest: eighteen
runs failed on a `tar` permissions error, and scored as failures that batch
would have reported ~10% build success — plausible, publishable, entirely
about a Docker whiteout file.

**And the second finding, which was not planned:** the expensive part of
every bug was the instrumentation gap in front of it, not the bug.

---

## Built

| Piece | State |
|---|---|
| `Run` table — every invocation recorded, with stage | working |
| Typecheck and bundle signals, kept separate | working |
| Golden set — 24 cases, 5 tiers, stable ids | written |
| `npm run doctor` — 1 sandbox, 0 tokens, checks packages **and files** | working |
| `npm run export` — committed snapshot of the run table | working |
| Python analysis layer — baseline, shapes, power, compare | working |
| Fixture corpus — one contract, both taxonomies | working |
| Infrastructure-fault guard | working |
| Intervention versioning, with a label/setting consistency check | working |
| Live run stages in the UI | working |
| Vitest + pytest + CI | working |

**Audit closed:** S1 (key encrypted in transit), S2, S3 (credits are a
sandbox rate limit, no bypass), S4, S5, S6, S7 (named `OutOfCreditsError`),
S8, S9, S9a.

---

## What it still cannot support

- **27 runs, ±18 points.** A later batch must clear that bracket to have
  moved.
- **The adversarial tier is at 5/5.** A tier built from vague requests,
  contradictory requirements and a prompt injection now passes everything,
  so the golden set's hardest band is no longer discriminating. That is a
  limitation of the case set, not a bug.
- **The concurrency cap is untested.** The "15 infrastructure faults per
  batch" that motivated it turned out to be an unscoped query counting the
  same historical rows. The cap is probably still right; the evidence given
  for it was an artifact. Testing it costs a batch.
- **v5 and v6 ran against a template missing `lib/utils.ts`**, so the
  truncation comparison measured a system with a hole in it. Kept rather
  than deleted — they are real results about a known-broken target.
- **Latency is a proxy for cost, not a price.**

---

## Next

Evals are finished — the dataset is fixed and committed. Everything
remaining reads it.

1. Editing pass on [`WRITEUP.md`](WRITEUP.md)
2. Housekeeping: dead components, Inngest app id rename
3. Optional: 2D trace view, 3D aggregate terrain

`npm run doctor` stays available at one sandbox and zero tokens, which is
what keeps "did I break the harness" separable from "is the agent worse".
