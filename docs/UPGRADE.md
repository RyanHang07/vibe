# Package upgrade plan

Versions checked against the npm registry on 11 Sept 2026.

---

## Status — 12 Sept 2026

**Done. `npm run verify` is green and `npm audit` reports 0 vulnerabilities.**

| Package | Was | Now | State |
|---|---|---|---|
| `react` / `react-dom` | 19.1.0 | 19.3.0 | done — **prerequisite for the Clerk patch** |
| `next` | 15.4.1 | 16.3.5 | done |
| `eslint-config-next` | 15.4.1 | 16.3.5 | done — native flat config, `FlatCompat` removed |
| `@clerk/nextjs` | 6.28.1 | 6.39.6 | **critical auth bypass closed**; the 7.x major is still outstanding |
| `zod` | 3.25.67 | 4.6.2 | done |
| `@inngest/agent-kit` | 0.8.3 | 0.13.2 | done — collapsed ~50 findings |
| `@types/node` | ^20 | ^24 | done — required by vitest 5 |
| `prisma` / `@prisma/client` | 6.12 | 6.12 | **outstanding** — target 7.10.0, pinned |
| `@e2b/code-interpreter` | 1.5.1 | 1.5.1 | **outstanding** — target 2.6.1 |

**Removed:** `@eslint/eslintrc` (only `FlatCompat` used it), `embla-carousel-react` (carousel was dead code).

**Added:** `vitest`, an `overrides` entry pinning `qs`.

**Config changes:** both `ignoreBuildErrors` and `ignoreDuringBuilds` deleted from `next.config.ts`; `lint` script moved from `next lint` to `eslint .`.

### Order that turned out to matter

Each of these blocked the next, and none was obvious until the resolver said so:

1. **React 19.1.0 → 19.3.0** — Clerk 6.39.6 peers on `~19.1.4 || ~19.2.3 || ~19.3.0-0`, deliberately excluding React patches it considers broken. Without this, `npm audit fix` could not run at all.
2. **zod 4 + AgentKit 0.13.2 together** — AgentKit peers on `zod >=4 <5`. Installing either alone fails.
3. **`@types/node` ^24** — vitest 5 peers on `^22 || >=24`.
4. Once `@inngest/agent-kit@^0.13.2` was written into the manifest, *every* npm command failed on the unsatisfiable zod pair. **Fixing the manifest by hand and running one `npm install` was the way out**, not more incremental installs.

---

## Original assessment

Verified against the npm registry, 11 Sept 2026.

| Package | Current | Target | Jump |
|---|---|---|---|
| `react` / `react-dom` | 19.1.0 | **19.3.0** | minor |
| `next` | 15.4.1 | **16.3.5** | **major** |
| `@clerk/nextjs` | 6.28.1 | **7.9.2** | **major** |
| `prisma` / `@prisma/client` | 6.12 | **7.10.0** | **major** |
| `zod` | 3.25.67 | **4.6.2** | **major** |
| `@inngest/agent-kit` | 0.8.3 | **0.13.2** | **0.x — breaking by convention** |
| `@e2b/code-interpreter` | 1.5.1 | **2.6.1** | **major** |
| `prismjs` | 1.30.0 | 1.30.0 | already current |

Six breaking changes. Zero tests before Stage 0. That combination is the actual risk, not any individual upgrade.

---

## Phantom dependency: `e2b`

`src/inngest/functions.ts` and `src/inngest/utils.ts` both do:

```ts
import { Sandbox } from "e2b";
```

**`e2b` is not in `package.json`.** It resolves today only because `@e2b/code-interpreter` depends on it (`"e2b": "^2.28.0"`) and npm hoists it into the top level of `node_modules`.

Three ways this bites:

- Upgrading `@e2b/code-interpreter` can change its `e2b` range, silently moving a package you import directly and never declared.
- pnpm and Yarn PnP refuse phantom resolution outright. The app would not build.
- `npm ci` on a fresh machine can hoist differently.

**Fix before any of the stages below:**

```
npm install e2b@2.49.1
```

Declare what you import. It costs nothing and removes a whole class of "works on my machine".

---

## Audit triage — 71 findings, 3 root causes

Run 11 Sept 2026: **71 vulnerabilities (46 moderate, 21 high, 4 critical).**

Nearly all of it collapses into three fixes.

### Root cause 1 — Clerk. Do this first.

`@clerk/nextjs` 6.28.1 is inside the vulnerable range for:

- **GHSA-vqx2-fgx2-5wq9 — middleware-based route protection bypass (critical)**
- GHSA-w24r-5266-9c3c — authorization bypass combining organization, billing, or reverification checks (high)

`src/middleware.ts` is exactly the mechanism the first advisory defeats, and this app is deployed. **This is the only finding in the list that is both critical and plainly reachable in normal operation.** Everything else needs an attacker to reach something you don't expose.

The fix is a patch inside `^6`, so it does not require the Clerk 7 migration. Take it now, migrate to 7 later on the schedule below.

Also clears: `@clerk/backend`, `@clerk/clerk-react`, `@clerk/shared`, `js-cookie`.

### Root cause 2 — Next.js 15.4.1

Thirty-odd advisories, including unauthenticated RCE on Windows-hosted servers and RCE in the Image Optimization API via AVIF, plus a family of middleware/proxy bypasses, SSRF, and cache poisoning.

The advisory range ends at `16.3.0-preview.10`. **The planned target, 16.3.5, is outside it.**

Do not run `npm audit fix --force` here. It offers `next@15.5.25`, which stays on the old major and undoes the plan. Upgrade deliberately at stage 2.

Also clears: `sharp`, `postcss` (both Next transitives).

### Root cause 3 — Inngest's OpenTelemetry tree

Roughly **fifty of the seventy-one** findings are a single dependency chain:

```
@inngest/agent-kit 0.8.3
  └─ inngest 3.x
      └─ @opentelemetry/auto-instrumentations-node
          └─ ~40 @opentelemetry/* packages
              └─ @grpc/grpc-js, protobufjs, express, body-parser, qs, ajv
```

Instrumentation for amqplib, hapi, restify, mongoose, mysql2, Alibaba Cloud and Azure resource detection — none of which this app uses. It is transitive weight, not attack surface, which is why the count is so misleading.

npm's own suggested fix is `@inngest/agent-kit@0.13.2`, which is already stage 5.

### Not reachable

- **tRPC prototype pollution (GHSA-43p4-m455-4f4j)** is in `experimental_nextAppDirCaller`. Grepped: this codebase does not use it. Patch it anyway — the fix is non-breaking — but it was never exploitable here.

- **`qs` (moderate, 3 advisories)** survived every fix, for a structural reason worth recording.

  Three copies exist. Two are already on 6.16.0 and safe. The third is `node_modules/qs@6.14.2`, pulled by `express@4.22.1`, which declares `qs@"~6.14.0"` — a range of `>=6.14.0 <6.15.0`. The advisories cover everything through 6.15.3, so **no patched version exists inside express 4's declared range.** `npm audit fix` is not broken; there is genuinely nothing it can legally do.

  ```
  @inngest/agent-kit@0.13.2 → express@^4.21.1 → qs@~6.14.0
  ```

  That Express instance is AgentKit's serve adapter. Vibe serves Inngest through `src/app/api/inngest/route.ts`, a Next route handler, so the Express app is never instantiated and its query parser never sees input. Unreachable.

  Resolved with an `overrides` entry pinning `qs` to `^6.16.0`, which the tree already proves works. **Remove the override when AgentKit moves to express 5** — leaving a stale override is how you end up silently holding a package back years later.

  Note the distinction from the Clerk and AgentKit conflicts earlier: `qs` is a *regular transitive dependency*, so an override patches a version. Those were *peer* conflicts, where forcing past them would have overruled a vendor stating the combination is broken. Overrides are right here and were wrong there.

### React is a prerequisite, not a warm-up

`npm audit fix` fails with `ERESOLVE` on a clean tree. Clerk 6.39.6 declares:

```
peer react@"^18.0.0 || ~19.0.3 || ~19.1.4 || ~19.2.3 || ~19.3.0-0"
```

React 19.1.0 is below the `~19.1.4` floor. Those tilde clauses are Clerk pinning *away* from React patch versions it considers broken, so the gaps are deliberate.

**Do not pass `--force` or `--legacy-peer-deps`**, which npm suggests. That installs a combination the vendor has excluded, in order to patch an auth bypass — the worst possible trade.

React 19.3.0 satisfies both Clerk's `~19.3.0-0` clause and Next 15.4.1's `^19.0.0`. Fallback if Next 15 misbehaves: `react@19.1.4`, the minimum that clears the floor.

### The commands

```powershell
# 0. Unblocks everything below
npm install react@19.3.0 react-dom@19.3.0

# 1. Everything non-breaking, including the Clerk critical
npm audit fix

# 2. The Next.js block, deliberately, at stage 2
npm install next@16.3.5 eslint-config-next@16.3.5

# 3. The OpenTelemetry forest, at stage 5
npm install @inngest/agent-kit@0.13.2
```

Re-run `npm audit --omit=dev --audit-level=high` after each. Anything still standing after step 3 is a genuine finding and earns a line here saying what it is and why it is or isn't reachable.

---

## On `npm audit` generally

Treat the number as a starting point, not a work queue. `npm audit` counts every path through the dependency graph, so one flaw in a deep transitive package can report as a dozen findings, and dev-only tooling is counted the same as code that ships to users.

Triage in this order:

```powershell
# What actually ships to users, at severity that matters
npm audit --omit=dev --audit-level=high

# Everything, for the record
npm audit --json > audit-before.json
```

The first number is the one worth acting on. Expect it to be a small fraction of 80, and expect most of the remainder to disappear on their own once `next`, `eslint-config-next`, and `@clerk/nextjs` move, since those three drag the largest transitive trees in this project.

Re-run and diff after each stage:

```powershell
npm audit --omit=dev --audit-level=high
```

Anything still reported after stage 5 is a real finding and deserves a line in this document saying what it is and why it is or isn't reachable.

---

## Two traps to avoid

**1. `npm install prisma@latest` gives you a release candidate.**

Prisma's `latest` dist-tag currently points at `8.0.0-rc.13`. The newest stable is on the `prev` tag at `7.10.0`. Pin it explicitly:

```
npm install prisma@7.10.0 @prisma/client@7.10.0
```

**2. Zod and AgentKit have to move together.**

Zod types flow straight into AgentKit tool parameters (`createTool({ parameters: z.object(...) })`). Upgrading zod to 4 while AgentKit is still on 0.8.3 risks a type mismatch at exactly the layer that defines the agent's tools. Check AgentKit 0.13's peer range on zod before starting, and do both in one stage.

---

## Stage 0 — build a safety net first

**Do not start the migration without this.** With no tests, a broken migration is invisible until you click through the app by hand, and five majors at once means you won't know which one broke it.

The minimum that's worth having:

- `vitest` installed, with two or three unit tests — the `PRO_POINTS > FREE_POINTS` invariant, `looksLikeKey`, and `parseAgentOutput`
- a GitHub Actions workflow running `tsc --noEmit`, `eslint`, `vitest`, and `next build`
- one end-to-end smoke check: sign in, create a project, confirm a sandbox URL comes back

That last one is manual for now. Automating it is step 4 of `PLAN.md` and the same work as the eval harness, so nothing here is throwaway.

This also closes `AUDIT.md` S9.

---

## Stage order

One commit per stage. Build and click through between each. If something breaks you know exactly what did it.

| Stage | Change | Why here |
|---|---|---|
| **0** | Safety net above | Nothing else is verifiable without it |
| **1** | `react` 19.3, plus low-risk minors | Small, proves the pipeline works |
| **2** | `next` 16.3.5 | Biggest surface, but you've already migrated solarity-ui to 16.3.5, so the work is familiar |
| **3** | `@clerk/nextjs` 7 | Touches `middleware.ts`, `auth()` in `lib/usage.ts`, and `trpc/init.ts`. Read Clerk's v7 migration guide first. |
| **4** | `prisma` 7.10.0 pinned | Regenerate the client, re-run migrations against a scratch DB before touching the real one |
| **5** | `zod` 4 **+** `@inngest/agent-kit` 0.13.2 together | The agent's tool definitions live at this seam |
| **6** | Prune unused Radix packages | ~25 installed, the app uses far fewer. Cosmetic, do it last. |

Stage 5 is the one that can actually break the product rather than the build. Leave it until everything under it is stable.

---

## Environment note: npm blocks install scripts

npm on this machine enforces an `allowScripts` policy, so postinstall scripts don't run unless the package is explicitly approved. It has caused three confusing failures already, and it will cause more, because **the packages it affects are the ones that download platform-native binaries** — and none of them fail at install time. They fail later, with an error that doesn't mention scripts.

| Package | What its postinstall does |
|---|---|
| `@prisma/engines`, `prisma` | Prisma query engine binaries |
| `@tailwindcss/oxide` | native Tailwind binary |
| `esbuild` | native esbuild binary |
| `unrs-resolver` | napi native binding |
| `inngest-cli` | the Inngest dev server binary |

Approve as needed:

```powershell
npm install-scripts ls
npm install-scripts approve <package>
npm rebuild <package>
```

**Approving is a judgement, not a formality.** A postinstall script runs arbitrary code on your machine at install time, which is why the policy exists. Approve packages you recognise and whose postinstall has an obvious job; leave the rest blocked until something actually breaks.

`@clerk/shared` and `protobufjs` remain blocked deliberately — nothing has complained.

**Watch out for the npx cache.** `npx <tool>` caches a copy; if the binary download was blocked, re-running npx happily reuses the broken copy forever. Installing the tool as a devDependency avoids the cache entirely, which is why `inngest-cli` is now in `devDependencies` rather than invoked through npx.

This is the same family as the entry in solarity's `patterns.md`: *"`--no-save` protects `package.json`, not `node_modules`… the failure appears days later as a tool that will not start."*

---

## On replacing Inngest with LangGraph

**Not yet. And probably not as a replacement.**

### They are not the same kind of thing

| | Inngest | LangGraph |
|---|---|---|
| Triggering from the web app | yes (`inngest.send`) | **no** |
| Durable steps across crashes and cold starts | yes (`step.run` memoisation) | partial (checkpointers) |
| Infrastructure-level retries | yes | node-level only |
| Agent graph, cycles, conditional routing | via AgentKit, limited | **yes, this is the point** |
| Human-in-the-loop interrupts | no | **yes** |
| Time-travel and replay of a run | no | **yes** |

Dropping Inngest doesn't just swap the agent layer. It also removes the queue, the durability, and the retry semantics, which you would then have to rebuild with pg-boss, BullMQ, or LangGraph Platform.

### They compose, and that's the better first move

Keep Inngest as the durable trigger. Run the LangGraph graph *inside* a step. You get the thing you actually want — LangGraph state, cycles, checkpointing, interrupts — without re-architecting delivery. If the graph later outgrows that boundary, move it then, with evidence.

`@langchain/langgraph` is at **1.4.13** and stable, so the TypeScript path is real.

### But the timing objection is the one that matters

From `PLAN.md`:

> **Gate: do not start until the single-agent baseline is measured.**

Replacing the orchestration layer before the baseline exists means changing the agent and the thing that measures the agent in the same move. Every subsequent number is unattributable. Was build success rate up because LangGraph routes better, or because the model changed, or because the prompt moved, or because nothing changed and it's run-to-run variance?

That is precisely the failure the whole project is designed to expose in other people's work. Doing it here first would be the most expensive possible irony.

**Order:** baseline → measure → then swap orchestration as a versioned intervention, and report what it did.

### One more consideration

LangGraph.js keeps everything in TypeScript. That is easier, and it also forfeits the stated reason for Phase 2 being a Python service — Python is the language AI engineering hiring runs on, and the GitHub is TypeScript top to bottom. Worth deciding deliberately rather than by convenience.

---

## Do these while you're in there

Not upgrades, but they live in the same files and the plan depends on them.

**Models into config.** Currently hardcoded at three call sites in `inngest/functions.ts` (`gpt-4.1` at line 70, `gpt-4o` at 203 and 213), one of them carrying the comment `// Updated to use a valid model`. Model routing is a named intervention in `PLAN.md`, and it's much harder while the model IDs are scattered.

Something like `src/lib/models.ts`:

```ts
export const MODELS = {
  coder:   process.env.VIBE_MODEL_CODER   ?? "...",
  titler:  process.env.VIBE_MODEL_TITLER  ?? "...",
  responder: process.env.VIBE_MODEL_RESPONDER ?? "...",
} as const;
```

Environment-overridable matters: it's how you A/B a model without a deploy.

**Kill the test template name.** `Sandbox.create("vibe-nextjs-ryan-test-2")` at `functions.ts:26`. Move it to config alongside the models.

**Parallelise the helper agents.** `functions.ts:218-219` awaits the title generator and the response generator in sequence. They're independent; `Promise.all` halves that latency. Small, and it's a number you can put in the README afterwards.
