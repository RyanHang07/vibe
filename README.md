<div align="center">

# datum.

**A measurement harness that happens to be attached to a code-generation agent.**

*Generated code, actually checked.*

<br>

![Next.js](https://img.shields.io/badge/Next.js-16-000000?style=flat-square&logo=next.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript&logoColor=white)
![Python](https://img.shields.io/badge/Python-3.12-3776AB?style=flat-square&logo=python&logoColor=white)
![Tests](https://img.shields.io/badge/tests-vitest%20%2B%20pytest-6E9F18?style=flat-square)
![License](https://img.shields.io/badge/license-MIT-5A4BD1?style=flat-square)

<br>

[The writeup](docs/WRITEUP.md) &nbsp;·&nbsp;
[What was wrong at the start](docs/AUDIT.md) &nbsp;·&nbsp;
[Where it ended up](docs/STATUS.md)

</div>

<br>

---

## A clean number

Eighty runs against twenty-four graded tasks, scored by whether the
generated project typechecks and bundles.

```
typecheck      72/80  =  90.0%  [81.5%, 94.8%]
bundle         74/80  =  92.5%  [84.6%, 96.5%]

by difficulty
  trivial      14/14  = 100.0%
  simple       17/18  =  94.4%
  moderate     18/20  =  90.0%
  complex      14/15  =  93.3%
  adversarial  11/13  =  84.6%
```

Wilson intervals rather than bare percentages. A monotonic slide from
trivial to adversarial. Two independent signals agreeing within two and a
half points. Zero runs unjudged.

I would have published it.

Then the failure taxonomy over the same eighty runs found that seven of the
twenty-six code failures were `tailwind-merge` missing from the sandbox
template, and lucide brand icons removed at a version nothing recorded: an
unpinned `npm install` in a Dockerfile, sitting beneath a comment reading
*"EVERY VERSION HERE IS PINNED."*

> **Twenty-seven percent of the failure set was about the measuring
> apparatus.** The adversarial tier's 84.6%, the lowest bar on the chart and
> the one that makes the gradient look real, was substantially lucide drift.

The number was clean, tightly bracketed, consistent across difficulty tiers,
and partly about a missing package.

---

## It was the seventh time

| What happened | What it would have reported |
|:--|:--|
| Docker whiteout broke `tar` in the prepare step | 10% build success across 18 runs |
| `.next/types` excluded from the copy | 0% typecheck across 16 runs |
| `agent.run("")` on an empty summary, provider 400 | "the agent can't handle hard prompts" |
| `node_modules` symlinked, not hardlinked | "the agent imports packages that don't exist" |
| Turbopack OOM in a 976 MB sandbox | an unexplained bundle failure rate |
| `stderr \|\| stdout` discarded the build log | four rounds diagnosing a hang with the evidence thrown away |

Every one produces a *plausible* number. None of them look like
infrastructure.

**And one that was not a harness bug at all.** A figure quoted three times in
early drafts, *"roughly fifteen infrastructure faults per batch, the same
count every time"*, turned out to be an exclusion query that was never
filtered by configuration. It was constant because it was the same fifteen
rows, counted again on every run. I had already built a fix for the
mechanism I inferred from it.

> A number can be stable across batches, consistent with a plausible
> mechanism, and entirely about a missing `WHERE` clause.

[Full writeup](docs/WRITEUP.md)

---

## The idea

Not "measure an agent". **Refusing to record one thing as another.**

```
null                        is not   false
an infrastructure fault     is not   a code failure
a rate limit                is not   a bad generation
types failing               is not   bundling failing
"module not found"          is not   "export not found"
a refusal                   is not   a failure to produce
failing after a good build  is not   a bad generation
"the agent said it worked"  is not   "it works"
```

That last one is the finding the project exists to produce:

```
the old signal said 72/80 succeeded
of those, 6 did not compile   6/72 = 8.3%  [3.9%, 17.0%]
```

The app reported success on roughly one in twelve runs whose code does not
compile. Before this existed, *"did the agent emit a summary"* **was** the
success metric.

---

## Four layers, cheapest first

> **Never let an expensive test answer a cheap question.**

| Layer | Cost | Answers |
|:--|:--|:--|
| `npm run verify` | free, seconds | Do the commands and parsers hold their contracts? |
| `npm run doctor` | 1 sandbox, **0 tokens** | Do the checks work on a pristine template? |
| `npm run eval smoke` | 4 generations | Does the agent path work end to end? |
| `npm run eval` | 24 generations | What is the rate? |

Every harness bug found so far, **nine of nine**, was a property of the check
commands or the template, needed zero model calls to find, and was paid for
at eval prices anyway.

<details>
<summary><b>Why <code>doctor</code> was still not enough, twice</b></summary>

<br>

`doctor` was green while `tailwind-merge` was missing, because a pristine
scaffold never imports it. So it began asserting a named package set.

It was then green again while `lib/utils.ts` was missing, because that is a
file and not a package.

**Each version of the check was exactly as good as the failure that prompted
it.** It now asserts packages *and* files, in the source and in the copy the
build runs against, and the next gap will be something neither list
contains.

</details>

---

## Can this experiment resolve anything?

Asked before spending on a comparison, not after.

```bash
npm run power version=v7-utils-truncate-1000
```

```
where the spread comes from
  between cases   53.1s   sd of case means
  within a case   14.2s   sd of repeats
  ignoring cases  44.2s

smallest detectable change, 24 runs per arm
  unpaired   35.7s    83% of the mean
  paired     11.5s    27% of the mean
```

Almost all the variation is *between* cases. A trivial task takes fifteen
seconds; an adversarial one takes two minutes. Pooling every run of one
config against every run of the other puts that in the noise term, even
though both arms run the identical twenty-four cases.

**Pairing on the case cancels that term and buys roughly five times the
resolution for the same money.**

```bash
npm run compare v5-pinned-truncate-4000 v6-pinned-truncate-1000
```

Reports the typecheck rate **first**, because an intervention that speeds the
agent up by degrading its output is a regression wearing a win. Then the
paired difference with its interval. When that interval includes zero it
says `NOT RESOLVED` and states the size of what it could not see, because
"not resolved" is not "no effect".

---

## Architecture

The harness writes data. The analysis reads it. They meet at a committed
snapshot.

```
src/            TypeScript   the app and the harness
  inngest/                   agent orchestration, run recording
  lib/                       check commands, taxonomy, faults, interventions
scripts/        TypeScript   eval dispatch, doctor, report, export
evals/                       golden set + captured failure fixtures
data/runs.json               the snapshot every figure is computed from
analysis/       Python       baseline, shapes, power, compare
```

<details>
<summary><b>Why the analysis is Python</b></summary>

<br>

Different jobs, different constraints, and statistical work is ordinary in
Python where in TypeScript it is unusual.

That was the justification. The return was **three defects in the original**,
found by writing the same logic twice and making the two agree:

1. a taxonomy that fragmented one cause into one shape per identifier
2. failures filed under a category that did not describe them
3. the unscoped exclusion query above

None would have been found by reading it.

It reads `data/runs.json` rather than the database, so every figure in the
writeup is reproducible by anyone without credentials, and a reader poking
at the data cannot damage rows that cost real money to produce.

</details>

<details>
<summary><b>One contract, two taxonomies</b></summary>

<br>

`evals/fixtures/` holds real captured output from real failures, kept
verbatim. `expectations.json` maps each one to the signature both
implementations must produce.

A parser tested against output someone imagined matches what they imagined,
and the failures that break it are the ones nobody thought of.

A signature changing is a silent regression: nothing fails, the taxonomy
just reports fewer shapes. These tests are what make it loud.

</details>

---

## Commands

<details open>
<summary><b>Harness</b> <i>(TypeScript, writes data)</i></summary>

<br>

```bash
npm run verify              # typecheck, lint, contract tests
npm run doctor              # 1 sandbox, 0 tokens: is the harness sound?

npm run eval smoke          # 4 cases
npm run eval cheap          # 10 cases, 2 per band
npm run eval                # 24 cases, a real baseline

npm run report              # run table, failures, timings
npm run report sweep        # close abandoned runs
npm run report prune        # drop rows that are not evidence

npm run check:model         # provider bisect + API key provenance
npm run export              # snapshot the Run table to data/runs.json
```

</details>

<details open>
<summary><b>Analysis</b> <i>(Python, reads the snapshot, writes nothing)</i></summary>

<br>

```bash
npm run baseline version=…  # rates with Wilson intervals, per tier, per config
npm run shapes version=…    # deterministic failure taxonomy
npm run power version=…     # can this experiment resolve anything?
npm run compare v6 v7       # paired comparison of two configurations
```

These shell out to the `datum` CLI, so they need its environment active:

```bash
cd analysis
python -m venv .venv && .venv\Scripts\activate    # or: . .venv/bin/activate
pip install -e ".[dev]"
pytest
```

`datum baseline version=v7` works directly too. Both the dashless form and
`--version` are accepted: the dashless convention exists because npm
consumes some dashed arguments before they reach a script, which once
created twenty-four orphan projects when `--dry-run` was swallowed.

</details>

---

## The golden set

24 cases across five difficulty bands with permanent ids. Five are
**expected to fail**: vague requests, contradictory requirements, a prompt
injection attempt. A set everything passes cannot detect a regression.

Ids never change or get reused. Without that you can say "the average
moved", never "case `simple-04` regressed", and the second is the one that
tells you what broke.

---

## The app

The agent is off-the-shelf and none of it is the contribution. It takes a
prompt, builds a Next.js app in an E2B sandbox, and the result is
type-checked and bundled before the user is told it worked.

The **Evidence** tab on each project shows every run's verdict beside what
the agent claimed, with raw compiler output rather than a summary of it.

<details>
<summary><b>Bring your own key</b></summary>

<br>

This deployment has no provider key of its own, so generations run on the
user's Anthropic or OpenAI key and are billed to their account. The key is
encrypted in transit through the job queue
(`@inngest/middleware-encryption`) and never stored.

Plan credits meter **sandbox** usage, which is ours whoever's key ran the
model. They were never payment for tokens.

</details>

---

## Running it

```bash
npm install
npx prisma migrate deploy
npm run dev
```

`.env` needs `DATABASE_URL`, `E2B_API_KEY`, `INNGEST_ENCRYPTION_KEY`
(`openssl rand -base64 32`), and Clerk keys.

A provider key is optional. If `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` is
set, the app uses it and the key field is marked optional; if not, users
supply their own. **The form asks the server which is true rather than
asserting either.**

> [!NOTE]
> `.env` does not override an environment variable that is already set, not
> in Next.js and not in Node's `--env-file`. A stale `ANTHROPIC_API_KEY` in
> your shell wins silently, and billing lands on an account you did not
> expect. `npm run check:model` reports which source won.

For local eval runs: `INNGEST_DEV=1` with `npm run inngest` alongside
`npm run dev`.

---

## Documentation

| | |
|:--|:--|
| [`WRITEUP.md`](docs/WRITEUP.md) | *Your eval score moved. That tells you almost nothing.* |
| [`STATUS.md`](docs/STATUS.md) | what is built, what it cannot support |
| [`BUILD_PLAN.md`](docs/BUILD_PLAN.md) | the phases and the order they went in |
| [`AUDIT.md`](docs/AUDIT.md) | what was wrong at the start, kept unedited |
| [`PLAN.md`](docs/PLAN.md) | where this is going, and why each piece exists |
| [`UPGRADE.md`](docs/UPGRADE.md) | dependency state and the order that mattered |

---

<div align="center">

MIT, see [LICENSE](LICENSE).

</div>
