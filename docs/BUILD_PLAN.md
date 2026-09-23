# Build plan — the remainder

> **Decided 23 Sept, after the first baseline.** Three phases, in order:
> finish the loop, write it up, port the analysis layer to Python.
> Everything else — trace visualisation, 3D terrain, multi-agent — is
> deferred. They add polish to a claim that is not yet complete.

---

## Phase A — finish the loop (~1 hour of compute)

The loop is observe → diagnose → act → **verify**, and verify has never run.
Intervention v2 is written, its prediction is on record, and every batch
that tried it failed at the provider. Until one intervention is measured
end to end, this is a measurement harness rather than a demonstrated loop.

1. `npm run report sweep` — close the 2 abandoned runs
2. `npm run eval` — full 24 on `v3`, for a tighter baseline than ±30 points
3. Flip `VIBE_TOOL_OUTPUT_LIMIT`, bump `CONFIG_VERSION` to `v4-…`
4. `npm run eval` again
5. `npm run baseline version=v3-…` and `version=v4-…`, compare

**Write the prediction before step 3.** The rule is already in
`interventions.ts` and it is the whole discipline: predicting afterwards is
how a null result becomes a success story.

**Expect "no effect".** 24 runs resolves ±20 points at best, and truncation
plausibly moves nothing now the 400 is understood — it was never context
exhaustion. A null result, reported honestly, is a better demonstration of
the loop than a win, because it is the outcome most projects quietly bury.

**Compare on latency, not on the pass rate.** The rate is at ~90% against a
100% ceiling with ±16 points of resolution, so the largest gain it could
possibly show is smaller than its own noise floor. Truncation is a change
to how much text goes back into the model, which is a latency intervention
before it is a quality one. `npm run baseline` now prints median, p10-p90
and mean time to a passing generation for exactly this comparison.

Tokens would be the better measure and are unavailable: AgentKit reports
usage only on its streaming interface. Latency is a proxy for cost, the
reports say so, and the dead token extractor was deleted rather than left
looking like instrumentation.

### Also worth fixing in this phase

- 15 infrastructure faults in the last batch — sandbox exhaustion under
  `cheap`'s pacing. 23 excluded against 53 counted. The surviving runs are
  not a random sample until this is down.
- ~~`adversarial-01` passes, so the tier is not discriminating.~~ **Stale.**
  At 53 runs it fails twice and the tier sits at 6/8 = 75%, the lowest of
  the five. Keep the underlying caution — a confident invention compiles,
  and the compiler cannot tell invention from correctness — but the claim
  that the tier does nothing is no longer supported.

### Pair on the case, or measure nothing

`npm run power` (free, reads existing runs) reports where the spread in
agent time comes from. Almost all of it is *between* cases: a trivial case
finishes in seconds, an adversarial one takes over a minute.

Bucketing all v3 runs against all v4 runs puts that term in the noise, so
the intervention has to beat the difference between `trivial-01` and
`complex-03` before it can be seen at all. It never had to. Both arms run
the same 24 cases, so **the comparison is per case, paired, and the
between-case term cancels.**

**Measured, 48 runs across 21 cases:**

```
  between cases   65.3s     sd of case means
  within a case    9.4s     sd of repeats, from 9 cases
  ignoring cases  46.6s

  smallest detectable change, 24 runs per arm
    unpaired    37.7s   90% of the mean
    paired       7.6s   18% of the mean
```

**Pairing is worth 5x.** Unpaired, the bar is 90% of the mean — truncation
was never going to clear that, so the batch would have returned "no effect"
from a design incapable of showing one, and the null result would have been
about the experiment rather than the intervention.

Paired, the bar is 7.6s. That is a real experiment.

Repeats are not worth it. Two per case doubles the spend (96 generations)
and buys 7.6s → 5.4s, because resolution goes as √n. Run one per case.

### The pair-survival tax

Pairing needs the case to pass in **both** arms. At ~90% typecheck that is
0.9 × 0.9 ≈ 0.81, so roughly 19 of 24 survive before infrastructure faults
take their share. At 16 surviving pairs the bar widens from 7.6s to about
9.3s, ~22% of the mean.

This is the real argument for reducing the 15 faults per batch, and it is a
stronger one than "the sample is not random": faults cost *pairs*, and a
pair lost to a fault in either arm is lost from both.

---

## Phase B — the writeup

**The material is the near-misses, not the baseline.**

| Incident | What it would have reported |
|---|---|
| Docker whiteout kills `tar` | 10% build success across 18 runs |
| `.next/types` missing from the copy | 0% typecheck across 16 runs |
| `agent.run("")` → provider 400 | "the agent cannot handle hard prompts" |
| `stderr \|\| stdout` | four rounds diagnosing a hang with the log discarded |
| Symlinked `node_modules` | "the agent imports packages that do not exist" |
| Turbopack OOM at 976 MB | a silent, unexplained bundle failure rate |

Six chances to publish a plausible false finding. Every one was caught by a
distinction that felt like pedantry when it was written: `null` is not
`false`, an infrastructure fault is not a code failure, a shape is not a
rate.

Working title: *"Your eval score moved. That tells you almost nothing."*

The baseline is the setup. The argument is that **a number can be clean,
tightly bracketed, consistent across difficulty tiers, and entirely about a
missing directory.**

`doctor` is the transferable idea: separate "is the instrument correct"
from "is the thing good", because only one of them costs money.

---

## Phase C — the Python analysis layer

A separate package reading the same Postgres. Not a rewrite: the layer
Python is genuinely better at.

```
analysis/
  pyproject.toml
  vibe_analysis/
    db.py          # read-only access to the Run table
    stats.py       # Wilson intervals, paired comparison
    taxonomy.py    # failure signatures — port of the TS version
    report.py      # baseline and shapes as CLI commands
  tests/           # pytest, including the fixtures from evals/fixtures
```

**Why this is justified rather than box-ticking:** the harness writes data
and the analysis reads it. They are different jobs with different
constraints, and statistical work in Python is ordinary where in TypeScript
it is unusual. Splitting on that seam is a defensible architecture, not a
language exercise.

It also closes the plan's one explicit rule, broken silently on day one:
*project 01 is Python.* The GitHub is TypeScript top to bottom and AI
engineering hiring runs on Python.

**Port, then delete the TypeScript.** Two implementations of the same
statistics is two places to be wrong, and the one nobody runs drifts.

---

Written 22 Sept 2026, after a batch in which every failure was the harness
and none was the agent.

---

## The problem this plan fixes

**Harness correctness and agent quality are currently entangled, and only
one of them costs money.**

Every harness bug so far was found by running an eval batch: 24 generations,
~30 minutes, real tokens. But look at what the bugs actually were:

| Bug | Needed a model call? |
|---|---|
| `--no-lint` invalid in Next 16 | no |
| `eslint` key invalid in next.config | no |
| `LayoutProps` missing from the copy | no |
| `tar` tripping on a Docker whiteout | no |
| Template files root-owned | no |
| `stderr \|\| stdout` discarding logs | no |
| `${error}` discarding response bodies | no |
| Sandbox leaked on the failure path | no |
| npm swallowing `--dry-run` | no |

**Nine of nine.** Every one is a property of the check commands or the
template, and every one was paid for at eval prices.

The commands live as strings in `src/lib/config.ts`, are shipped to a
sandbox, and have never been executed against a known-good project or
asserted on in any test.

---

## Four layers, cheapest first

Nothing moves to the next layer until the current one is green.

| Layer | Cost | Answers |
|---|---|---|
| **1 · Unit + contract tests** | free, seconds | Are the commands and parsers right? |
| **2 · `npm run doctor`** | 1 sandbox, **0 tokens** | Do the checks work on a pristine template? |
| **3 · `npm run eval smoke`** | 4 generations | Does the agent path work end to end? |
| **4 · `npm run eval`** | 24 generations | What is the rate? |

### Layer 2 is the missing piece

`npm run doctor` creates one sandbox from the configured template, runs the
prepare, typecheck and bundle commands against the **untouched** project,
and asserts each exits 0.

**A freshly scaffolded Next app must typecheck and build.** If it does not,
the harness is broken — no generation involved, no ambiguity, no tokens
spent.

That single check would have caught every template and command bug in the
table above, for the price of one sandbox.

It also answers a question nothing currently answers: *is a failure the
agent's fault or ours?* Right now that takes a batch and a taxonomy to work
out. Doctor answers it in a minute.

---

## Regression tests to write

One per bug that has already happened. The list is the bug history.

### Command contracts — `src/lib/config.test.ts`

Assertions about the command strings themselves. Free, instant, and they
encode what each fix was for.

- [ ] bundle command contains no `--no-lint` — removed in Next 16
- [ ] generated `next.config` sets no `eslint` key — invalid in Next 16
- [ ] generated `next.config` does set `typescript.ignoreBuildErrors` — types are measured separately
- [ ] prepare runs `next typegen` — Next 16 types live in `.next`, which the copy excludes
- [ ] prepare excludes `.wh.*` — Docker whiteouts are root-owned and unreadable
- [ ] prepare excludes `node_modules` and `.next`, and symlinks `node_modules`
- [ ] prepare uses two `tar` calls, not a pipeline — a pipeline reports only the last command's status
- [ ] all commands run against `/tmp/vibe-build`, never `/home/user` — that is the live preview
- [ ] every binary is invoked by path, never through `npx` — npx falls back to the network

### Behaviour — existing files

- [ ] sandbox released on the **failure** path, not only on success
- [ ] output capture keeps stdout **and** stderr
- [ ] error serialisation includes own properties and `cause`
- [ ] a 401 is not retried — auth failures are permanent
- [ ] `HARNESS:` shapes never enter a rate

### Fixtures — `evals/fixtures/`

Real captured output, kept verbatim, so parsers are tested against what
actually happened rather than what I imagined:

- `tsc-ts2304-layoutprops.txt`
- `tsc-ts2307-module.txt`
- `next-build-unknown-option.txt`
- `tar-whiteout-permission.txt`
- `eacces-next-trace.txt`
- `provider-400.json`, `provider-401.json`

Every future parser change runs against these. A signature that stops
matching a real failure is a silent regression — the taxonomy would just
report fewer shapes.

---

## Working order from here

1. **Write the contract tests.** They fail immediately on anything still wrong.
2. **Build `npm run doctor`.** One sandbox, no tokens.
3. **Run doctor until green.** Every iteration is a minute and costs nothing but sandbox time.
4. **`npm run eval smoke`** — 4 cases. Confirms the agent path.
5. **`npm run eval`** — the baseline. **Only once 1-4 are green.**
6. Re-test intervention v2.

`npm run verify` after every change. It already runs typecheck, lint and
tests; the contract tests join it.

---

## Open questions the baseline will answer

- `lucide-react` — a harness gap, or the agent assuming a package the
  template lacks? Genuinely ambiguous, and the distinction matters. Doctor
  settles it: if a pristine template typechecks, the import is the agent's.
- Is the 29-component list too narrow? `Module not found` in `shapes` is
  the tell.
- Does truncation (v2) help? Untested — the batch that tried it failed at
  the provider on every case.

---

## Remaining slices

| Slice | State |
|---|---|
| 1-6 (record → interventions) | built |
| Clean baseline | **blocked on layers 1-3** |
| 2D trace view | not started |
| 3D aggregate terrain | not started |
| Writeup | not started |

Still open from `AUDIT.md`: S1 (key in event payloads), S3 (BYO-key billing),
S7 (credit branch correct by accident).

---

## The rule this plan encodes

**Never let an expensive test answer a cheap question.**

A model call should only ever be asked "is this generation good". Anything
it is asked beyond that — does the command parse, does the template build,
does the parser match — is a question that had a free answer and was paid
for anyway.
