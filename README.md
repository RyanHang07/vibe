# Datum

**A measurement harness that happens to be attached to a code-generation agent.**

---

## A clean number

Eighty runs against twenty-four graded tasks, scored by whether the
generated project typechecks and bundles:

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
template, and lucide brand icons removed at a version nothing recorded — an
unpinned `npm install` in a Dockerfile, sitting beneath a comment reading
*"EVERY VERSION HERE IS PINNED."*

**Twenty-seven percent of the failure set was about the measuring
apparatus.** The adversarial tier's 84.6% — the lowest bar on the chart, the
one that makes the gradient look real — was substantially lucide drift.

The number was clean, tightly bracketed, consistent across difficulty tiers,
and partly about a missing package.

**It was the seventh time.** [`docs/WRITEUP.md`](docs/WRITEUP.md) has the
other six, including the one that would have reported 0% typecheck across
sixteen runs because Next 16's generated types live in a directory the
sandbox copy excluded.

---

## The idea

Not "measure an agent". **Refusing to record one thing as another.**

- `null` is not `false` — "could not be judged" is not "failed"
- an infrastructure fault is not a code failure
- a rate limit is not a bad generation
- types failing is not bundling failing
- "module not found" is not "export not found" — one is the template's fault,
  the other is the agent inventing a name
- **"the agent said it worked" is not "it works"**

That last one is the finding the project exists to produce:

```
the old signal said 72/80 succeeded
of those, 6 did not compile   6/72 = 8.3%  [3.9%, 17.0%]
```

The app reported success to the user on roughly one in twelve runs whose
code does not compile. Before this existed, "did the agent emit a summary"
*was* the success metric.

---

## Four layers, cheapest first

**Never let an expensive test answer a cheap question.**

| Layer | Cost | Answers |
|---|---|---|
| `npm run verify` | free, seconds | Do the commands and parsers hold their contracts? |
| `npm run doctor` | 1 sandbox, **0 tokens** | Do the checks work on a pristine template? |
| `npm run eval smoke` | 4 generations | Does the agent path work end to end? |
| `npm run eval` | 24 generations | What is the rate? |

Every harness bug found so far — nine of nine — was a property of the check
commands or the template, needed zero model calls to find, and was paid for
at eval prices anyway. `doctor` exists to separate *"is the instrument
correct"* from *"is the thing good"*, because only one of them costs money.

It is still not sufficient: `doctor` was green while `tailwind-merge` was
missing, because a pristine scaffold never imports it. So it now asserts a
named package set and prints installed versions, pass or fail.

---

## Checking whether the experiment can resolve anything

Before spending on a comparison, not after:

```
npm run power version=v5-pinned-truncate-4000
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

Almost all the variation is *between* cases — a trivial task takes fifteen
seconds, an adversarial one takes two minutes. Pooling every run of one
config against every run of the other puts that in the noise term, even
though both arms run the identical twenty-four cases. The experiment then
has to beat the difference between `trivial-01` and `complex-03` before it
can see anything.

Pairing on the case cancels that term and buys roughly five times the
resolution for the same money.

```
npm run compare a=v5-pinned-truncate-4000 b=v6-pinned-truncate-1000
```

Reports the typecheck rate **first** — an intervention that speeds the agent
up by degrading its output is a regression wearing a win — then the paired
difference with its interval. When that interval includes zero it says
**NOT RESOLVED** and states the size of what it could not see, because
"not resolved" is not "no effect".

---

## Commands

The harness is TypeScript; the analysis is Python. They meet at a snapshot.

```
# harness — writes data
npm run verify              # typecheck, lint, contract tests
npm run doctor              # 1 sandbox, 0 tokens — is the harness sound?

npm run eval smoke          # 4 cases
npm run eval cheap          # 10 cases, 2 per band
npm run eval                # 24 cases — a real baseline

npm run report              # run table, failures, timings
npm run report sweep        # close abandoned runs
npm run report prune        # drop rows that are not evidence

npm run check:model         # provider bisect + API key provenance
npm run export              # snapshot the Run table to data/runs.json

# analysis — reads the snapshot, writes nothing
npm run baseline version=…  # rates with Wilson intervals, per tier, per config
npm run shapes version=…    # deterministic failure taxonomy
npm run power version=…     # can this experiment resolve anything?
npm run compare v6 v7       # paired comparison of two configurations
```

The four analysis commands shell out to the `datum` CLI in `analysis/`, so
they need its virtual environment active:

```bash
cd analysis && python -m venv .venv && . .venv/bin/activate   # or .venv\Scripts\activate
pip install -e ".[dev]"
pytest
```

`datum baseline version=v7` works directly too. Both the dashless form and
`--version` are accepted — the dashless convention exists because npm
consumes some dashed arguments before they reach a script, which once
created twenty-four orphan projects when `--dry-run` was swallowed.

### Why the analysis is Python

The harness writes data and the analysis reads it: different jobs,
different constraints, and statistical work is ordinary in Python where in
TypeScript it is unusual.

It reads `data/runs.json` rather than the database. That makes every figure
in the writeup reproducible by anyone, without credentials and without a
provider key — and means a reader poking at the data cannot damage rows
that cost real money to produce.

---

## The golden set

24 cases across five difficulty bands with permanent ids. Five are
**expected to fail** — vague requests, contradictory requirements, a prompt
injection attempt — because a set everything passes cannot detect a
regression.

Ids never change or get reused. Without that you can say "the average
moved", never "case `simple-04` regressed", and the second is the one that
tells you what broke.

---

## The app

The agent is off-the-shelf; none of it is the contribution. It takes a
prompt, builds a Next.js app in an E2B sandbox, and the result is
type-checked and bundled before the user is told it worked. The **Evidence**
tab on each project shows every run's verdict beside what the agent claimed,
with the raw compiler output rather than a summary of it.

**Bring your own key.** This deployment has no provider key of its own, so
generations run on the user's Anthropic or OpenAI key and are billed to
their account. The key is encrypted in transit through the job queue
(`@inngest/middleware-encryption`) and never stored. Plan credits meter
sandbox usage, which is ours whoever's key ran the model.

---

## Stack

**App:** Next.js 16, TypeScript, tRPC, Prisma, Postgres, Clerk, Tailwind v4

**Agent:** [Inngest AgentKit](https://agentkit.inngest.com) for orchestration,
[E2B](https://e2b.dev) for sandboxes, Anthropic or OpenAI for generation —
provider-agnostic, lightest model tier by default

**Harness:** Vitest, GitHub Actions, Wilson score intervals

---

## Running it

```bash
npm install
npx prisma migrate deploy
npm run dev
```

`.env` needs `DATABASE_URL`, `E2B_API_KEY`, `INNGEST_ENCRYPTION_KEY`
(`openssl rand -base64 32`), and Clerk keys. A provider key is optional — if
`ANTHROPIC_API_KEY` or `OPENAI_API_KEY` is set, the app uses it and the key
field is marked optional; if not, users supply their own. The form asks the
server which is true rather than asserting either.

For local eval runs: `INNGEST_DEV=1` with `npm run inngest` alongside
`npm run dev`.

> **Note:** `.env` does not override an environment variable that is already
> set — not in Next.js, not in Node's `--env-file`. A stale
> `ANTHROPIC_API_KEY` in your shell wins silently, and billing lands on an
> account you did not expect. `npm run check:model` reports which source won.

---

## Documentation

- [`docs/WRITEUP.md`](docs/WRITEUP.md) — *Your eval score moved. That tells you almost nothing.*
- [`docs/BUILD_PLAN.md`](docs/BUILD_PLAN.md) — the remaining phases and the order they go in
- [`docs/STATUS.md`](docs/STATUS.md) — what is built, what is pending
- [`docs/AUDIT.md`](docs/AUDIT.md) — what was wrong at the start, and what is still open
- [`docs/PLAN.md`](docs/PLAN.md) — where this is going, and why each piece exists
- [`docs/UPGRADE.md`](docs/UPGRADE.md) — dependency state and the order that mattered

---

## Licence

MIT — see [LICENSE](LICENSE).
