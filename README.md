# Vibe

An AI code-generation app, and a harness that measures whether its output is any good.

The generator takes a natural-language prompt and produces a working Next.js
app in a sandbox. That part is ordinary. The part worth reading is everything
around it: **every generation is recorded, type-checked, built, classified,
and compared against previous configurations.**

Most work on coding agents reports demos. This reports rates, with intervals
around them, and refuses to publish a number it cannot defend.

---

## The measurement layer

### Two signals, kept apart

| Check | Command | Catches |
|---|---|---|
| typecheck | `tsc --noEmit` | wrong props, missing imports, invented APIs |
| bundle | `next build` | syntax, client/server boundary violations, unresolvable imports |

`"62% of generations build"` says less than `"88% typecheck, 71% bundle"`,
because the second says where to intervene.

### Outcomes that are not failures

Every check returns one of three things, never two:

- **pass** — the code works
- **fail** — the code does not work
- **unknown** — the check could not decide

A timeout, a dead sandbox, a rate limit, a filesystem permission error and a
provider outage all produce `unknown`. They are excluded from every rate
rather than counted against the agent.

This is load-bearing. On one batch, eighteen runs failed on a `tar`
permissions error inside the sandbox image. Scored as failures, that batch
would have reported roughly 10% build success — a plausible, publishable,
entirely false result about a Docker whiteout file.

### Rates with honest intervals

```
  typecheck      10/10  = 100.0%  [72.2%, 100.0%]
  bundle         12/13  =  92.3%  [66.7%, 98.6%]

  interval width  31.9 points
  a ±10 point interval needs about 97 runs; this batch has 13.
```

Wilson score intervals, not the textbook `p ± z·√(p(1-p)/n)` — which returns
`0% ± 0` at zero successes, claiming certainty from twenty observations. The
adversarial tier is built to score zero, so that is the common case here.

The report also states what the sample **cannot** resolve, which is usually
more useful than the number itself.

### Failure shapes, derived deterministically

```
 1. TS2322: Type <name> is not assignable to type <name>
    7 run(s) · typecheck · complex-02, moderate-04, simple-03
 2. Module not found: Can't resolve <name>
    4 run(s) · bundle · moderate-01, moderate-04
```

No embeddings, no clustering. Compiler output is structured, so a signature
can be extracted by normalising away paths, line numbers, quoted identifiers
and hashes — and then **the signature is the identity.** The usual hard
problem of clustering, keeping shape IDs stable as clusters split and merge
across runs, is designed out rather than solved.

Unclassified failures are never absorbed into a catch-all. A bucket that
swallows what it does not understand reports a tidy taxonomy and hides the
failures nobody has looked at.

### Interventions as versioned objects

Every run records the agent configuration that produced it. Changes are
versioned, one at a time, with the expected effect written down **before**
the run — predicting afterwards is how a null result becomes a success story.

```
npm run baseline version=v2-truncate-tool-output
```

Mixing configurations in one average produces a number describing nothing
that ever ran, so the report refuses to do it quietly.

---

## Commands

```
npm run eval smoke          # 4 cases, ~6 min — while developing
npm run eval                # 24 cases — a real baseline
npm run eval case=trivial-01

npm run report              # run table, failures, timings
npm run report sweep        # close abandoned runs
npm run report prune        # drop rows that are not evidence

npm run baseline            # rates with confidence intervals
npm run shapes              # failure taxonomy
npm run check:model         # provider bisect + API key provenance

npm run verify              # typecheck, lint, test
```

---

## The golden set

24 cases across five difficulty bands, with permanent ids. Five are
**expected to fail** — vague requests, contradictory requirements, a prompt
injection attempt — because a set everything passes cannot detect a
regression.

Ids never change or get reused. Without that you can say "the average
moved", never "case `simple-04` regressed", and the second is the one that
tells you what broke.

---

## Stack

**App:** Next.js 16, TypeScript, tRPC, Prisma, Postgres, Clerk, Tailwind

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

`.env` needs `DATABASE_URL`, `E2B_API_KEY`, `ANTHROPIC_API_KEY` or
`OPENAI_API_KEY`, and Clerk keys. For local eval runs, `INNGEST_DEV=1` with
`npm run inngest` alongside `npm run dev`.

**Note:** `.env` does not override an environment variable that is already
set — not in Next.js, not in Node's `--env-file`. A stale `ANTHROPIC_API_KEY`
in your shell or system environment wins silently. `npm run check:model`
reports which source actually won.

---

## Documentation

- [`docs/PLAN.md`](docs/PLAN.md) — where this is going, and why each piece exists
- [`docs/STATUS.md`](docs/STATUS.md) — what is built, what is pending
- [`docs/AUDIT.md`](docs/AUDIT.md) — what was wrong, and what is still open
- [`docs/UPGRADE.md`](docs/UPGRADE.md) — dependency state and the order that mattered

---

## Licence

MIT — see [LICENSE](LICENSE).
