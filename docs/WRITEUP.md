# Your eval score moved. That tells you almost nothing.

*What I learned building a measurement harness for a code-generation agent,
mostly by getting the measurements wrong.*

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

A good-looking result. Wilson intervals rather than bare percentages. A
monotonic slide from trivial to adversarial, which is what a difficulty
gradient is supposed to look like. Two independent signals agreeing to
within two and a half points. Zero runs unjudged.

I would have published it.

Then the failure taxonomy over the same eighty runs: seven of the
twenty-six code failures were `Cannot find module 'tailwind-merge'` and
`Module 'lucide-react' has no exported member 'Github'`.

Neither is about the agent.

`tailwind-merge` is half of shadcn's `cn` helper — every real shadcn project
has it. The sandbox template did not, because the pinned CLI didn't install
it and `create-next-app` doesn't either. `Github` is a lucide icon that
existed for most of lucide's history and is therefore abundant in training
data; lucide later removed its brand icons. The template installed lucide
with **no version pin**, on a line sitting directly beneath a comment
reading *"EVERY VERSION HERE IS PINNED, AND MUST STAY PINNED."*

So whether that generation was wrong depended on which version `npm install`
happened to resolve the day the image was built, and nothing recorded which
one that was.

Twenty-seven percent of the failure set was about the measuring apparatus.
The adversarial tier's 84.6% — the lowest bar on the chart, the one that
makes the gradient look real — was substantially lucide drift.

**The number was clean, tightly bracketed, consistent across difficulty
tiers, and partly about an unpinned `npm install`.**

---

## It was the seventh time

Not a bad day. The seventh instance of the same thing, and the first six
were worse.

| What happened | What it would have reported |
|---|---|
| Docker whiteout file broke `tar` in the prepare step | 10% build success across 18 runs |
| `.next/types` excluded from the copy, so Next 16's generated types were absent | 0% typecheck across 16 runs |
| `agent.run("")` on an empty summary → provider 400 | "the agent can't handle hard prompts" |
| `node_modules` symlinked instead of hardlinked; Turbopack rejects symlinks out of the filesystem root | "the agent imports packages that don't exist" |
| Turbopack OOM in a 976 MB sandbox, killed with no output | an unexplained bundle failure rate |
| `stderr \|\| stdout` discarded the build log | four rounds diagnosing a hang with the evidence thrown away |

Every one produces a *plausible* number. Zero percent typecheck across
sixteen runs is not obviously broken — it reads as a model that cannot write
TypeScript. Ten percent build success reads as a weak agent on hard tasks.
None of them look like infrastructure.

And every one was caught by a distinction that felt like pedantry when it
was written down.

---

## The principle: refuse to record one thing as another

Each of those is the same mistake wearing different clothes.

- `null` is not `false`. "Could not be judged" is not "failed."
- An infrastructure fault is not a code failure.
- A rate limit is not a bad generation.
- Types failing is not bundling failing.
- **"Module not found" is not "export not found."** One is the template's
  fault; the other is the agent inventing a name, or the installed version
  dropping one that used to exist. Nearly identical in a log, and they send
  an investigation to opposite places.
- A refusal is not a failure to produce. A prompt-injection case was being
  scored as an agent failure because the agent correctly declined and
  therefore emitted nothing.
- A run that failed *after* producing a working build is not a bad
  generation.
- **"The agent said it worked" is not "it works."**

That last one is the finding the project was built to produce:

```
the old signal said 72/80 succeeded
of those, 6 did not compile   6/72 = 8.3%  [3.9%, 17.0%]
```

The application reported success on roughly one in twelve runs whose code
does not compile. Before any of this existed, *"did the agent emit a
summary"* **was** the success metric.

---

## `doctor`: separate the instrument from the subject

Every harness bug above was found by running an eval batch — twenty-four
generations, half an hour, real tokens. But look at what they were:

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

**Nine of nine.** Every one is a property of the check commands or the
template. Every one was paid for at eval prices.

So `npm run doctor` creates one sandbox from the configured template, runs
the prepare, typecheck and bundle commands against the **untouched**
scaffold, and asserts each exits zero. One sandbox, zero tokens, a minute.

A freshly scaffolded Next app must typecheck and build. If it doesn't, the
harness is broken — no generation involved, no ambiguity.

### It was still not enough, twice

Doctor was green while `tailwind-merge` was missing.

Its premise — a pristine scaffold must compile — is true and insufficient. A
pristine scaffold doesn't *import* `tailwind-merge`, so its absence can't
make any step fail. The gap only surfaces once an agent writes the code a
real shadcn project would have.

So the check can't be "does the scaffold compile." It has to be "does the
scaffold contain what the agent will assume" — a judgement written down, not
derived. Doctor began asserting a named package set.

**Then the same thing happened one level down.** With the package check
green, two more failures were still scored against the agent: `Cannot find
module '@/lib/utils'`, and a Turbopack module-not-found on the same import.

`lib/utils.ts` holds `cn`. Every shadcn component imports it, and so does
almost every generated component. It was not in the template. `shadcn init`
had clearly run — `components.json` and the `@/*` path mapping were both
there — it simply no longer creates that file.

The package check couldn't catch it, because it is not a package. So the
list became packages **and files**, checked in the source and in the copy
the build runs against:

```
lib/utils.ts      source:NO  copy:NO
components.json   source:yes copy:yes
tsconfig.json     source:yes copy:yes
```

Fourth instance in one Dockerfile of a pinned client defeated by an unpinned
remote, and the first where the missing piece was a file rather than a
package.

The lesson is not "check for files too". It is that **each version of the
check was exactly as good as the failure that prompted it**, and the next
gap will be something neither list contains.

> **Never let an expensive test answer a cheap question.**
>
> A model call should only ever be asked "is this generation good."
> Anything else — does the command parse, does the template build, does the
> parser match — had a free answer and was paid for anyway.

---

## The ceiling, and what replaced it

At 90% typecheck with ±12 points of resolution, the arithmetic is unkind:
the ceiling is 100%, so the largest possible improvement is 10 points, which
is inside the noise floor. **No intervention can be shown to improve the
pass rate at this sample size** — not because interventions don't work, but
because the measurement has run out of room.

So comparisons moved to a continuous measure, which compares distributions
instead of counting successes and resolves far more per sample.

Tokens would have been ideal. They turned out to be unavailable: the agent
framework reports usage only on its streaming interface, and the extractor
I'd written searched for a field that doesn't exist on the returned object.
It recorded `undefined` and looked like working instrumentation. I deleted
it rather than leaving it in, and fell back to wall-clock latency with the
substitution stated out loud in the code and in the report output. A proxy
for cost, not a price.

### Then the latency measure was audited before it was used

Wall time includes typecheck and bundle, which run 11-60 seconds — the same
order as any effect worth looking for. Comparing raw durations would compare
the harness as much as the agent: a batch that generates more files
typechecks slower, and that reads as *"the intervention made generation
slower."* So the reported figure is wall time minus check time, and runs
missing a check duration are dropped rather than counted as zero. **A
missing duration is not a duration of nothing.**

Then, before spending anything, the question of whether the experiment could
resolve its own intervention:

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
seconds, an adversarial one takes two minutes. Pooling every run of one
config against every run of the other puts that term in the noise, even
though both arms run the identical twenty-four cases. The experiment would
then have to beat the difference between `trivial-01` and `complex-03`
before it could see anything.

It never had to. **Pairing on the case cancels that term and buys roughly
five times the resolution for the same money.**

An earlier version of this estimate said 7.6s, from nine cases with repeats.
At twenty-one cases it said 11.5s. The estimate got worse as it got more
trustworthy, and the warning printed alongside the optimistic one — *thin
basis, treat as indicative* — was doing real work.

---

## Fixing the target changed the shape of failure, not the rate

The template gained `tailwind-merge` and `clsx`, every install line got
pinned, and the rebuilt target was measured fresh.

The pass rate barely moved, and moved *down*: 82.1% [64.4, 92.1] against the
old 90.0% [81.5, 94.8]. The intervals overlap so heavily that nothing has
been shown either way.

The taxonomy says something the rate cannot:

```
BEFORE (80 runs)                    AFTER (28 runs)
26 failures in 6 shapes             7 failures in 6 shapes

  4 x tailwind-merge missing          1 x wrong arity
  3 x lucide brand icon removed       1 x type not exported
 11 x agent produced no summary       1 x ref nullability
  5 x provider 400                    1 x own path alias
  ...                                 1 x unknown prop
                                      2 x no summary
```

Before: **concentrated**. Two systematic shapes, both about the template,
both guaranteed to recur on every batch forever.

After: **scattered**. Six shapes, one run each, every one a different
idiosyncratic mistake in generated TypeScript.

That is what removing instrument noise looks like. The systematic component
is gone and a long tail of genuine, unrelated errors remains. **The headline
rate is completely blind to it.** The five provider 400s also disappeared,
having been attributed to the agent for two weeks.

If you only look at the score, the template fix was a slight regression. It
was the most consequential change in the project.

---

## Running the loop

Observe, diagnose, act, **verify**. The last one is where most eval work
stops, so it is the one worth showing.

The intervention: cap tool output fed back into the model at 1000 characters
instead of 4000, on the theory that large command output replayed on every
iteration costs time.

The prediction, written before the run and preserved verbatim in the source:

> 1. Median time to a passing generation falls.
> 2. The p10-p90 spread narrows more than the median moves. The long runs
>    carry large tool output; the short ones never hit the cap and cannot
>    change.
> 3. Typecheck and bundle rates do not move outside their intervals.
> 4. If the rates drop, truncation is removing something the agent needed.
>    A faster wrong answer is worse than a slow right one.

The result:

```
agent time, A minus B, over 15 paired case(s)
  mean difference  -0.4s
  interval         [-6.9s, +6.2s]

NOT RESOLVED.
```

Expected, and stated in advance, because `power` had already shown the
design needed an 11.5s effect while truncation plausibly moves 5-15%.

**"Not resolved" is not "no effect."** What the experiment licenses is
narrower and more useful: *any effect smaller than about seven seconds is
invisible to this design.* The bound is the finding. Reporting it as
"truncation didn't help" would be a false claim, and the gap between those
two sentences is most of what this project is about.

### The pre-registered split

Prediction 2 is a claim about mechanism, and a mechanism implies a subgroup.
So the subgroup was specified before the data existed: cases ranked by their
**baseline** duration, cut at the median. Never by the differences — letting
an outcome choose its own grouping manufactures an effect from noise every
time.

```
longer half     +3.5s   [-8.6s, +15.6s]   7 pairs   not resolved
shorter half    -3.8s   [-11.1s, +3.4s]   7 pairs   not resolved
```

Direction matches on both halves. Magnitude clears the noise on neither.

The per-case table is where the temptation lives. The four longest cases all
got faster, in the predicted direction, by 4.7s to 18.4s. It would be easy,
and wrong, to present that as confirmation — because two cases in the
*shorter* half moved further in the opposite direction, on tasks where
truncation should barely fire. Whatever caused those is not the
intervention, and it is the same size as the effect being claimed.

**Direction consistent, magnitude unresolved, worth one confirming run at
the long end.** Not a result. A reason to run a cheaper, more specific
experiment next.

### And the target was broken anyway

Written after the fact and left in rather than quietly corrected.

Both arms of that comparison ran against the template missing
`lib/utils.ts`. At least two of the intervention arm's failures were the
target rather than the agent.

So the comparison is not wrong in its method and is not usable as a result.
It was a correctly-designed, correctly-powered, honestly-reported
measurement of a system with a hole in it — **and it was the check built
because of the previous near-miss that caught it.** The package check found
nothing new; the file check found this immediately.

The runs are kept rather than deleted. They are real results about a target
with a known gap, and erasing them would remove the evidence that the loop
ran at all.

---

## Writing it twice

The analysis layer was ported to Python: same statistics, same taxonomy,
reading the same data. Justified as an architecture — the harness writes,
the analysis reads, and statistical work is ordinary in Python where in
TypeScript it is unusual.

It found three defects in the original, none of which would have been found
by reading it.

**A taxonomy that fragmented instead of grouping.** Turbopack reports a
missing export as `The export Linkedin was not found in module`, unquoted.
The normaliser replaces *quoted* identifiers, so this one survived into the
signature and every missing export became its own shape. A tally meant to
say "this cause hit three runs" would have said "three causes hit one run
each". The `tsc` form of the same failure grouped correctly, because tsc
quotes the name — so the same failure grouped or fragmented depending on
which tool noticed it.

**Failures filed under a category that didn't describe them.** The shapes
query selected `status: "FAILED"` outright, which includes runs that
produced a working build and then failed during cleanup. Two of them were
reported as *"Agent produced no summary"* despite having compiled and
bundled.

**Exclusion counts that were never filtered by configuration.** The rate
query scoped by `configVersion`; the exclusion query did not:

```ts
prisma.run.count({ where: { source, status: "RUNNING" } })
```

So every baseline, for every config, reported the same historical total.

That is the source of a number quoted three times in earlier drafts of this
document: *"roughly fifteen infrastructure faults per batch, the same count
every time."* It was constant because it was the same fifteen rows, counted
again on every run.

I read that constancy correctly — a ceiling looks different from contention
— then drew a confident conclusion about the sandbox provider's concurrency
limit, capped the agent's concurrency, and watched the count drop. **The
count dropped because the new implementation scopes the query.** The cap may
well be right. The evidence I gave for it was an artifact.

Which is the thesis arriving at my own expense: a number can be stable
across batches, consistent with a plausible mechanism, and entirely about a
missing `WHERE` clause.

All three defects are the same shape — a category absorbing things it does
not describe — and all three were found by writing the logic twice and
making the two agree.

---

## Two wrong diagnoses

Most of the near-misses above were caught by a check. This one was caught by
a redirect, after I got it wrong twice.

A report appeared to drop rows for weeks: a failure shape's run count simply
absent, the lines around it intact. I blamed carriage returns in captured
compiler output, wrote a sanitiser, and the rows kept disappearing. Then the
Python port did the same thing on a different line, with clean ASCII strings
it had built itself.

The answer was `> out.txt`. Every line was present. The Windows console
renders `·` as `V%`, and a mangled multi-byte sequence takes the rest of its
line with it — every vanished line contained a `·`.

The thirty-second check was available from the first report. I reached for a
plausible mechanism instead, twice, in the same week I was writing an
argument about separating cheap questions from expensive ones.

**The rule is easy to state and apparently quite hard to follow.** That is
worth more as a finding than any of the clean ones.

---

## What it looks like when the instrument is finally clean

Template pinned, missing file written by hand, exclusion query scoped,
concurrency capped:

```
typecheck      24/27  =  88.9%  [71.9%, 96.1%]
bundle         26/27  =  96.3%  [81.7%, 99.3%]

the old signal said 25/27 succeeded
of those, 1 did not compile   1/25 = 4.0%  [0.7%, 19.5%]
```

Five failures in four shapes, and **every one is the agent**: a type
mismatch, a possibly-undefined, a run that produced no summary, and a
component that compiled cleanly and then crashed while Next prerendered it.
Zero unjudged. Zero stuck.

That last one is worth dwelling on. `next build` printed `Compiled
successfully` and then threw `useTheme must be used within a ThemeProvider`.
Typecheck passed. The bundle compiled. The app was broken anyway — **the
only failure class where all the cheap signals agree and are all wrong.** It
sat in `unclassified` for a day because the taxonomy refuses to guess, which
is that bucket working rather than failing.

The instrument also got sharper in a way nobody asked for. Within-case
spread fell from 14.2s to 5.0s, taking the paired resolution from 27% of the
mean to 10%. Most of the old "agent variance" was sandbox contention.
**Fixing the harness didn't just remove false failures — it removed noise
that was making every real comparison harder.**

---

## What it still cannot support

Named here rather than in a footnote, because an honest limitations section
is what makes the rest credible.

- **27 runs, ±18 points.** A later batch must clear that bracket to have
  moved anything.
- **The post-fix batches are small.** The "scattered rather than
  concentrated" reading rests on five failures, and five single-instance
  shapes is also what a small sample of anything looks like.
- **Seven of twenty-two cases were dropped from the pairing**, having passed
  under one configuration only. Those are a result about the pass rate, not
  a data point about latency.
- **Two unexplained doublings** on cases where the intervention should do
  nothing. Unattributed variance that size is a problem for any conclusion
  drawn from the per-case table.
- **The adversarial tier now passes everything.** 5/5 on a band built from
  vague requests, contradictory requirements and a prompt injection. Some of
  its old failure rate was lucide drift, and one "failure" was the agent
  correctly refusing the injection. A tier that discriminates nothing is a
  limitation of the case set, and no amount of interval arithmetic fixes it.
- **The concurrency cap is untested**, for the reason given above. It is
  probably right. Saying so is cheaper than a batch.
- **Latency is a proxy for cost, not a price.**
- **A compiler cannot tell invention from correctness.** A confident
  fabrication compiles. Both signals here are necessary and neither is
  sufficient.

---

## What transfers

Three things, none specific to code generation.

**Audit the instrument before the subject, because only one of them costs
money.** Nine of nine harness bugs needed zero model calls to find. All nine
were found by spending model calls.

**Check whether the experiment can resolve its own intervention, before
running it.** Ten minutes of variance decomposition took the design from
needing an 83%-of-mean effect to needing 27%, at identical cost. The version
of this project that skipped that step would have run the batch, reported
"no effect", and been wrong about why.

**Refuse to record one thing as another, especially when the substitution is
convenient.** `null` is not `false`. A fault is not a failure. A proxy is not
the thing. Every one of those distinctions felt like overhead when it was
written, and every one later prevented a number that would have been clean,
defensible, and false.

---

*Numbers throughout come from a code-generation agent evaluated on
twenty-four graded tasks. The harness, taxonomy, power analysis and paired
comparison are in this repository, and the run data is committed at
`data/runs.json` so every figure here can be recomputed without database
access. [`AUDIT.md`](AUDIT.md) records what was wrong at the start;
[`BUILD_PLAN.md`](BUILD_PLAN.md) the order it was fixed in;
[`STATUS.md`](STATUS.md) where it ended up.*
