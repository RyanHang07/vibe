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

## Commit convention

Title only. Phrases joined by `+`, first letter of each phrase capitalised.

```
Security+Dependency upgrade+Type safety+CI bootstrap
```

One phrase per distinct concern. If the list runs past four, that's a sign the commit should have been more than one.

---

## Tech

**Reused:** TypeScript, Next.js, Postgres, Prisma, Inngest

**New:** Python + async, clustering (HDBSCAN), embeddings, statistics (bootstrap, kappa, multiple comparisons), OpenTelemetry, Langfuse, pytest plugin authoring, Docker, Three.js on real data

**Phase 2:** LangGraph (state, checkpointing, cycles), multi-agent orchestration, a Python service behind Next.js, queues
