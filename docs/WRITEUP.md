# Your eval score moved. That tells you almost nothing.

---

## A clean number

Eighty runs against a fixed set of twenty-four code-generation tasks, graded
by whether the generated project typechecks and bundles:

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

This is a good-looking result. Wilson intervals rather than bare
percentages. A monotonic slide from trivial to adversarial, which is what a
difficulty gradient is supposed to look like. Two independent signals
agreeing to within two and a half points. Zero runs unjudged.

I would have published it.

Then I ran the failure taxonomy over the same eighty runs. Seven of the
twenty-six code failures were:

- `TS2307: Cannot find module 'tailwind-merge'` — four runs
- `TS2305: Module 'lucide-react' has no exported member 'Github'` — three runs

Neither is about the agent.

`tailwind-merge` is half of shadcn's `cn` helper. Every real shadcn project
has it. The sandbox template did not, because the pinned CLI version didn't
install it and `create-next-app` doesn't either. The agent was writing what
a shadcn project normally contains. The template was the anomaly.

`Github` is a lucide icon that existed for most of lucide's history and is
therefore abundant in training data. lucide deprecated its brand icons and
later removed them. The template installed lucide with **no version pin**,
on a line sitting directly beneath a comment reading *"EVERY VERSION HERE IS
PINNED, AND MUST STAY PINNED."* So whether that generation was wrong
depended on which version `npm install` happened to resolve the day the
image was built, and nothing anywhere recorded which one that was.

Twenty-seven percent of the failure set was about the measuring apparatus.
The adversarial tier's 84.6% — the lowest bar on the chart, the one that
makes the gradient look real — was substantially lucide drift.

**The number was clean, tightly bracketed, consistent across difficulty
tiers, and partly about an unpinned `npm install`.**

---

## This was the seventh time

It was not a bad day. It was the seventh instance of the same thing, and the
first six were worse.

| What happened | What it would have reported |
|---|---|
| Docker whiteout file broke `tar` in the prepare step | 10% build success across 18 runs |
| `.next/types` excluded from the copy, so Next 16's generated types were absent | 0% typecheck across 16 runs |
| `agent.run("")` on an empty summary → provider 400 | "the agent can't handle hard prompts" |
| `node_modules` symlinked instead of hardlinked; Turbopack rejects symlinks out of the filesystem root | "the agent imports packages that don't exist" |
| Turbopack OOM in a 976 MB sandbox, killed with no output | an unexplained bundle failure rate |
| `stderr \|\| stdout` discarded the build log | four rounds diagnosing a hang with the evidence thrown away |

Every one of these produces a *plausible* number. Zero percent typecheck
across sixteen runs is not an obviously broken result — it reads as a model
that cannot write TypeScript. Ten percent build success reads as a weak
agent on hard tasks. None of them look like infrastructure.

And every one was caught by a distinction that felt like pedantry when it
was written down.

---

## The principle: refuse to record one thing as another

Each of those failures is the same mistake wearing different clothes.

- `null` is not `false`. "Could not be judged" is not "failed."
- An infrastructure fault is not a code failure.
- A rate limit is not a bad generation.
- An abandoned run is not a failure.
- Types failing is not bundling failing.
- "Module not found" is not "export not found." One is the template's fault;
  the other is the agent inventing a name, or the installed version dropping
  one that used to exist. They look nearly identical in a log and they send
  an investigation to opposite places.
- "The agent said it worked" is not "it works."

That last one is the finding the project was built to produce:

```
the old signal said 72/80 succeeded
of those, 6 did not compile   6/72 = 8.3%  [3.9%, 17.0%]
```

The application reported success to the user on roughly one in twelve runs
whose code does not compile. Before any of this existed, "did the agent emit
a summary" *was* the success metric.

---

## `doctor`: separate the instrument from the subject

Every harness bug above was found by running an eval batch — twenty-four
generations, half an hour, real tokens. But look at what the bugs were:

| Bug | Needed a model call? |
|---|---|
| `--no-lint` invalid in Next 16 | no |
| `eslint` key invalid in generated config | no |
| generated types missing from the copy | no |
| `tar` tripping on a Docker whiteout | no |
| template files root-owned | no |
| `stderr \|\| stdout` discarding logs | no |
| sandbox leaked on the failure path | no |
| `tailwind-merge` missing from the template | no |
| lucide installed unpinned | no |

Nine of nine. Every one is a property of the check commands or the template,
and every one was paid for at eval prices.

So `npm run doctor` creates one sandbox from the configured template, runs
the prepare, typecheck and bundle commands against the **untouched**
scaffold, and asserts each exits zero. One sandbox, zero tokens, about a
minute.

**A freshly scaffolded Next app must typecheck and build.** If it doesn't,
the harness is broken — no generation involved, no ambiguity.

### And doctor was still not enough

Doctor was green while `tailwind-merge` was missing.

Its premise — a pristine scaffold must compile — is true and insufficient. A
pristine scaffold doesn't *import* `tailwind-merge`, so its absence cannot
make any step fail. The missing package only surfaces once an agent writes
the code that a real shadcn project would have.

So the check cannot be "does the scaffold compile." It has to be "does the
scaffold contain what the agent will assume" — and that list is a judgement
written down, not derived from anything. Doctor now asserts a named package
set and prints each installed version, unconditionally, pass or fail.

The general rule the project runs on:

> **Never let an expensive test answer a cheap question.**

A model call should only ever be asked "is this generation good." Anything
else it gets asked — does the command parse, does the template build, does
the parser match — is a question that had a free answer and was paid for
anyway.

---

## The ceiling, and what replaced it

At 90% typecheck with ±12 points of resolution, the arithmetic is unkind:
the ceiling is 100%, so the largest possible improvement is 10 points, which
is inside the noise floor. **No intervention can be shown to improve the
pass rate at this sample size.** Not because interventions don't work —
because the measurement has run out of room.

Ninety-seven runs would give ±10. Several hundred would be needed to resolve
a real improvement up there.

So comparisons moved to a continuous measure, which compares distributions
instead of counting successes and resolves far more per sample. Tokens would
have been ideal. They turned out to be unavailable: the agent framework
reports usage only on its streaming interface, and the extractor I had
written for them was dead code that searched for a field which does not
exist on the returned object. It recorded `undefined` and looked like
working instrumentation.

I deleted it rather than leaving it in, and fell back to wall-clock latency
with the substitution stated out loud in both the code and the report
output. A proxy for cost, not a price.

### Then the latency measure was audited before it was used

Wall time includes the typecheck and bundle steps, which run 11-60 seconds —
the same order of magnitude as any effect worth looking for. Comparing raw
durations would have compared the harness as much as the agent. A batch that
generated more files typechecks slower, and that reads as "the intervention
made generation slower." So the reported figure is wall time minus check
time, and runs missing a check duration are dropped rather than counted as
zero. A missing duration is not a duration of nothing.

Then, before spending anything, I asked whether the experiment could resolve
its own intervention:

```
where the spread comes from
  between cases   53.1s   sd of case means
  within a case   14.2s   sd of repeats
  ignoring cases  44.2s

smallest detectable change, 24 runs per arm
  unpaired   35.7s    83% of the mean
  paired     11.5s    27% of the mean
```

Almost all the variation is *between* cases: a trivial task takes fifteen
seconds and an adversarial one takes two minutes. Pooling every run of one
config against every run of the other puts that term in the noise, even
though both arms run the identical twenty-four cases. The experiment would
then have to beat the difference between `trivial-01` and `complex-03`
before it could see anything.

It never had to. Pairing on the case cancels that term and buys roughly five
times the resolution for the same money.

**An earlier version of this estimate said 7.6s, from nine cases with
repeats. At twenty-one cases it said 11.5s.** The estimate got worse as it
got more trustworthy, and the warning printed alongside the optimistic one
— *thin basis, treat as indicative* — was doing real work.

---

## Fixing it changed the shape of failure, not the rate

The template gained `tailwind-merge` and `clsx`, and every install line got
pinned. The rebuilt target was measured fresh.

The pass rate barely moved, and moved *down*: 82.1% [64.4, 92.1] against the
old 90.0% [81.5, 94.8]. The intervals overlap so heavily that nothing has
been shown either way, and on the rate alone the honest verdict is "no
information."

The taxonomy says something the rate cannot:

```
BEFORE (80 runs)                    AFTER (28 runs)
26 failures in 6 shapes             7 failures in 6 shapes

  4 × tailwind-merge missing          1 × TS2554 wrong arity
  3 × lucide brand icon removed       1 × TS2459 type not exported
 11 × agent produced no summary       1 × TS2322 ref nullability
  5 × provider 400                    1 × TS2307 own path alias
  …                                   1 × TS2353 unknown prop
                                      2 × no summary
```

Before: **concentrated**. Two systematic shapes accounting for seven
failures, both about the template, both guaranteed to recur on every batch
forever.

After: **scattered**. Six shapes, one run each, every one a different
idiosyncratic mistake in generated TypeScript — wrong arity, a type declared
but not exported, a ref nullability mismatch, an unknown object property.

That is what removing instrument noise looks like. The systematic component
is gone and what remains is a long tail of genuine, unrelated errors. A
failure profile that collapses from "the same two things over and over" to
"seven different things once each" is a real change in what is being
measured, and **the headline rate is completely blind to it.**

The five provider 400s also disappeared, having been attributed to the
agent for two weeks.

If you only ever look at the score, the template fix looks like a slight
regression. It was the most consequential change in the project.

---

## The result

The intervention: cap tool output fed back into the model at 1000 characters
instead of 4000, on the theory that large command output replayed on every
iteration costs time.

The prediction, written before the run and preserved verbatim in the source:

> 1. Median time to a passing generation falls.
> 2. The p10-p90 spread narrows more than the median moves. The long runs
>    are the ones carrying large tool output; the short ones never hit the
>    cap and cannot change.
> 3. Typecheck and bundle rates do not move outside their intervals.
> 4. If the rates drop, truncation is removing something the agent needed.
>    That is a regression, and a faster wrong answer is worse than a slow
>    right one.

The aggregate result:

```
agent time, A minus B, over 15 paired case(s)
  mean difference  -0.4s
  interval         [-6.9s, +6.2s]

NOT RESOLVED.
```

Which was the expected outcome, stated in advance, because `power` had
already shown the design needed an 11.5s effect and truncation plausibly
moves 5-15%.

**"Not resolved" is not "no effect."** What the experiment licenses is
narrower and more useful: *any effect smaller than about seven seconds is
invisible to this design.* The bound is the finding. Reporting it as
"truncation didn't help" would be a false claim, and the gap between those
two sentences is most of what this project is about.

### The pre-registered split

Prediction 2 is a claim about mechanism: truncation can only act where tool
output exceeds the cap, which happens in long runs. Short cases never reach
it and cannot change. That implies a subgroup, so the subgroup was specified
before the data existed.

Cases were ranked by their **baseline** duration and cut at the median.
Never by the differences — letting an outcome choose its own grouping
manufactures an effect from noise every time.

```
longer half     +3.5s   [-8.6s, +15.6s]   7 pairs   not resolved
shorter half    -3.8s   [-11.1s, +3.4s]   7 pairs   not resolved
```

The direction matches the prediction on both halves. The magnitude does not
clear the noise on either, and each half has half the pairs, so each
interval is wider than the aggregate.

The per-case table is where the temptation lives:

```
adversarial-02   126.4s → 108.0s   +18.4s
complex-01        62.7s →  44.9s   +17.8s
complex-03        73.2s →  61.6s   +11.7s
complex-02        58.1s →  53.4s    +4.7s
```

The four longest cases all got faster, in the predicted direction, by
amounts that look substantial. It would be easy, and wrong, to present that
as confirmation.

Two cases in the shorter half moved further than any of them, in the
opposite direction: `simple-05` went 20.6s → 46.3s and `moderate-06` 28.8s →
57.5s, both more than doubling on tasks where truncation should barely fire.
Whatever caused those is not the intervention, and it is the same size as
the effect being claimed for the long cases.

**The correct reading is: direction consistent, magnitude unresolved, worth
one confirming run at the long end.** Not a result. A reason to run a
specific, cheaper experiment next.

---

## What it still cannot support

Named here rather than in a footnote, because an honest limitations section
is the part that makes the rest credible.

- **Seven of twenty-two cases were dropped from the pairing**, having passed
  under one configuration only. Those are a result about the pass rate, not
  a data point about latency, and the paired figure rests on whichever cases
  survived both arms.
- **Roughly fifteen infrastructure faults per batch**, the same count every
  time — which does not look like random contention. Until that's down, the
  runs that complete are not a random sample of the case set.
- **The post-fix batches are small.** Twenty-eight and twenty-three runs
  against the original eighty. The "scattered rather than concentrated"
  reading is drawn from seven failures, and seven single-instance shapes is
  also what a small sample of anything looks like. It wants a full batch
  before it is load-bearing.
- **Two unexplained doublings**, `simple-05` and `moderate-06`, on cases
  where the intervention should do nothing. Unattributed variance of that
  size in the arm being measured is a problem for any conclusion drawn from
  the per-case table.
- **The adversarial tier doesn't discriminate the way it appears to.** A
  confident invention compiles. The compiler cannot tell invention from
  correctness, and no amount of interval arithmetic fixes that.
- **Latency is a proxy for cost, not a price.**

---

## What transfers

Three things, none of which are specific to code generation.

**Audit the instrument before the subject, because only one of them costs
money.** Nine of nine harness bugs needed zero model calls to find. All nine
were found by spending model calls.

**Check whether the experiment can resolve its own intervention, before
running it.** Ten minutes of variance decomposition changed the design from
one that needed a 90%-of-mean effect to one that needed 27%, at identical
cost. The version of this project that skipped that step would have run the
batch, reported "no effect," and been wrong about why.

**Refuse to record one thing as another, especially when the substitution is
convenient.** `null` is not `false`. A fault is not a failure. A proxy is not
the thing. Every one of those distinctions felt like overhead when it was
written, and every one later prevented a number that would have been clean,
defensible, and false.

---

*Numbers throughout are from a code-generation agent evaluated on
twenty-four graded tasks. The harness, taxonomy, power analysis and paired
comparison are in this repository; `docs/AUDIT.md` records what was wrong at
the start and `docs/BUILD_PLAN.md` the order it was fixed in.*
