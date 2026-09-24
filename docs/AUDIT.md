# DATUM: audit before the rebuild

Read of `main` as of 11 Sept 2026. Ordered by severity, not by effort.

---

## Status

| | Finding | State |
|---|---|---|
| **S1** | False API key security claim | **resolved** — copy fixed, and the key is now encrypted in transit through Inngest. See below. |
| **S2** | Free tier at 100× Pro | **fixed** + invariant test |
| **S3** | BYO-key inconsistent across paths, users pay twice | **resolved** — opposite to the fix this audit assumed. See below. |
| **S4** | Nothing verifies the generated app works | **fixed** — typecheck + bundle on every run, recorded per run |
| **S5** | Dev artifacts, stale models, magic numbers | **fixed** — `lib/config.ts`, `lib/models.ts` |
| **S6** | `api-key-form.tsx` untyped and off-system | **fixed** |
| **S7** | Credit error branch correct only by accident | **fixed** — named `OutOfCreditsError`, matched by shape. See below. |
| **S8** | README claims features that don't exist | **fixed** — rewritten around the writeup, LICENSE added |
| **S9** | No tests, no CI | **fixed** — vitest + GitHub Actions |
| **S9a** | Build configured to ignore its own errors | **fixed** |

> ### S1 and S3, resolved 23 Sept
>
> **What changed upstream of both:** the deployment carries no provider key
> of its own. Every user supplies theirs. That turned BYO-key from a
> convenience into the credential the product runs on, and made both issues
> urgent rather than tidy-up.
>
> **S1.** `@inngest/middleware-encryption` on the client, with
> `eventEncryptionField: "apiKey"`. Step data and function output are
> encrypted by default; naming the field covers the event payload without
> restructuring every send and read. The client **throws at import** when
> `INNGEST_ENCRYPTION_KEY` is absent rather than quietly sending plaintext,
> because a security property that depends on an unchecked deploy step
> fails in a way indistinguishable from success. Required the Inngest SDK
> v3 → v4 upgrade that the middleware's v2 depends on.
>
> **S3.** Resolved opposite to this audit's assumption. The bug was not
> that the message path failed to skip credits — it was that the project
> path skipped at all.
>
> A user's key pays for model calls. Every run also creates an E2B sandbox
> (4 GB, 4 CPUs, one per generation), which is ours whoever's key ran the
> model, and is the larger per-run cost. So credits were never payment for
> tokens. They are a rate limit on sandbox usage, they apply to everyone,
> and there is no bypass.
>
> Worth recording as a case of the audit being right about the symptom and
> wrong about the cause: "make BYO-key consistent" would have been
> satisfied by skipping credits on both paths, which is the change that
> loses money on every run.

> ### S7, resolved 23 Sept
>
> The branch worked for a reason nobody wrote down: `rate-limiter-flexible`
> rejects with a plain `RateLimiterRes` when the limit is hit and a real
> `Error` when something breaks, so `!(error instanceof Error)` happened to
> mean "rate limited".
>
> `consumeCredits` now identifies the rejection by its shape
> (`msBeforeNext` + `remainingPoints`) and throws a named
> `OutOfCreditsError`. Anything else is rethrown as itself and becomes an
> `INTERNAL_SERVER_ERROR` with the cause attached, so a broken database no
> longer tells the user they are out of credits.

### Also found and fixed during the upgrade

Things nothing was checking, surfaced by the first `tsc --noEmit` and `eslint` runs this repo has ever had:

- `projects.create` received `apiKey: null` against a `z.string().optional()` input, which rejects null — **every keyless project creation failed validation**
- `app/error.tsx` declared a component and never exported it, so **the error boundary never registered and that page never rendered**
- `parseAgentOutput` read `value[0]` unguarded; an empty output threw inside the Inngest step and aborted before `save-result`, so **the user saw nothing at all, not even the error message**
- `getSandbox` reset the timeout to 10 minutes on every reconnect, **silently cutting the 30-minute lifetime to a third**
- `Message` was used as a type in `utils.ts` and never imported
- `useState(null)` in `message-form.tsx` typed the setter as `null`, so nothing there was checked
- `usage.tsx` read the clock during render — a hydration mismatch, and unnecessary, since `msBeforeNext` is already a duration
- `SidebarMenuSkeleton` picked its width with `Math.random()` during render, so the server and client disagreed on every skeleton row

**71 npm vulnerabilities → 0**, including a critical Clerk middleware route-protection bypass.

---

---

## S1 — The app makes a false security promise

`src/components/api-key-form.tsx:112`

```
Your API key is secure
Your API key is stored temporarily in your browser's memory and never
sent to our servers. It will be cleared when you refresh or close the page.
```

That is not true. The key's actual path:

| Step | Where the key goes | File |
|---|---|---|
| 1 | Typed into the form | `api-key-form.tsx` |
| 2 | Sent to the server as a tRPC input | `projects/server/procedures.ts:48` |
| 3 | Put inside an Inngest **event payload** | `procedures.ts:93`, `messages/…:87` |
| 4 | Persisted and rendered in Inngest's dashboard | third party |
| 5 | Read back out of event data | `inngest/functions.ts:19` |

So a user's OpenAI secret is sent to the server, written into a third-party event log in plaintext, retained there, and displayed in a dashboard — while the UI promises none of that happens.

**This is the worst thing in the repo.** Not because the mechanism is exotic, but because the interface makes a security claim the code contradicts, at the exact moment a user decides whether to trust it with a credential.

### It's a bug shape you already documented

From `solarity/docs/patterns.md`:

> **A promise with no mechanism behind it** — both policy pages said a change that matters "will be shown in the app before it takes effect". There is no acceptance record, no banner, and the app sends no email, so the sentence described machinery nobody had built. **Prose is the part of a system with no type checker.**

Same shape, higher stakes. The discipline exists; it just was never pointed at this repo.

### Fix

Two honest options:

1. **Make the promise true.** Keep the key client-side, call OpenAI from the browser, never send it to the server. Constrains the architecture and loses the Inngest orchestration for BYO-key runs.
2. **Change the promise.** Say plainly where the key goes, stop putting it in event payloads, hold it in a server-side secret store keyed by session, pass a reference through the event instead of the value.

Option 2 is the real one. Either way the copy changes **first** — it takes a minute and it's currently the only untrue thing a user is shown.

---

## S2 — Free tier gets 100× more than Pro

`src/lib/usage.ts:6`

```ts
const FREE_POINTS = 10000; //updated to 100 temporarily to support self-provided openai usages
const PRO_POINTS = 100;
```

The comment says 100. The code says 10000. Free users get **one hundred times** the allowance of paying users.

Same family as S1: prose and code disagree, and the prose is the part nothing checks.

**Fix:** decide the real numbers, delete the comment, and add a test that asserts `PRO_POINTS > FREE_POINTS`. That assertion is one line and it can never silently invert again.

---

## S3 — BYO-key works on one path and not the other

| Path | Skips credit charge when user supplies a key? |
|---|---|
| `projects.create` | yes — `if (!input.apiKey)` guard |
| `messages.create` | **no** — `consumeCredits()` runs unconditionally |

So bringing your own key makes the first message free and every following one billed. The feature half-landed.

**It is worse than that.** `message-form.tsx` refuses to submit without a key at all:

```ts
if (!validApiKey) {
  toast.error("Please enter a valid OpenAI API key");
  return;
}
```

So on a project page you *must* supply your own key, and `messages.create` then charges a credit anyway. **BYO-key users pay twice: their own OpenAI spend and a credit.** Meanwhile the project-creation path treats supplying a key as a reason not to charge. The two paths disagree about what the feature is for.

Decide which it is, then make both paths agree.

---

## S4 — Nothing verifies the generated app works

`inngest/functions.ts:221`

```ts
const isError = !result.state.data.summary ||
  Object.keys(result.state.data.files || {}).length === 0;
```

Success is defined as *"the agent said something and wrote at least one file."* Not that it compiles. Not that it runs. Not that it did what was asked.

This is the gap the whole plan turns on: **there is currently no signal to measure.** Every improvement to the agent is unfalsifiable until this exists.

**Related:** `maxIter: 15` has no handler. Hitting the cap produces no summary, which sets `isError`, which shows the user *"Something went wrong. Please try again."* — indistinguishable from a sandbox failure, a model error, or a bad prompt. Retrying cannot help, and the copy says to retry.

---

## S5 — Dev artifacts and stale models in main

| Line | Issue |
|---|---|
| `functions.ts:26` | `Sandbox.create("vibe-nextjs-ryan-test-2")` — a personal test template name, hardcoded, shipped |
| `functions.ts:70` | `model: "gpt-4.1"` with the comment `// Updated to use a valid model` |
| `functions.ts:203,213` | helper agents on `gpt-4o` |
| `functions.ts:27` | `setTimeout(3 * 10 * 60_000)` — thirty minutes, written as a puzzle |
| `functions.ts:41` | `take: 5` message history, no stated reason |

No model is read from config. Changing models means editing three call sites, which makes the routing intervention in the plan harder than it needs to be.

---

## S6 — `api-key-form.tsx` is untyped and off-system

Every other component is typed and uses shadcn tokens. This one:

- has **implicit `any` props** in a `.tsx` file: `({ onApiKeyChange, placeholder = "..." })`
- hardcodes `bg-blue-50`, `text-blue-800`, `border-gray-300` instead of design tokens, so it ignores `next-themes` and breaks in dark mode
- uses `default export` where the codebase uses named exports
- exports `ApiKeyInput` from a file called `api-key-form.tsx`
- uses an `AlertCircle` icon for the **clear** button

It reads as pasted in from somewhere else, and it happens to be the file making the false security claim.

---

## S7 — Fragile by accident

`procedures.ts:57`

```ts
} catch (error) {
    if (error instanceof Error) { /* "Something went wrong" */ }
    else { /* "You have run out of credits" */ }
}
```

This is correct only because `rate-limiter-flexible` rejects with a `RateLimiterRes`, which is not an `Error`. Nothing says so. If the library ever wraps its rejection in an `Error`, every rate-limited user silently starts seeing "Something went wrong" instead of the real reason, and no test would catch it.

Branch on the type explicitly, and leave a comment saying why.

---

## S8 — Claims in the README that aren't in the repo

| Claim | Reality |
|---|---|
| "Collaboration: invite team members to collaborate on projects and work together in real-time" | No such feature exists |
| "licensed under the MIT License. See LICENSE" | There is no `LICENSE` file |
| `git clone https://github.com/your-repo/vibe.git` | Placeholder never edited |
| Tools list: Next.js, tRPC, React Query, TypeScript, Clerk, Inngest | Omits **E2B**, **AgentKit**, and **Prisma** — the entire AI stack |

---

## S9a — The build was configured to ignore its own errors

`next.config.ts` carried both:

```ts
eslint:     { ignoreDuringBuilds: true }
typescript: { ignoreBuildErrors: true }
```

**Every `next build` passed regardless of type errors or lint failures.** That is the reason the rest of this document exists in the form it does: nothing was checking, so nothing was found.

The first `tsc --noEmit` ever run on this repo found three errors in three files, including a live bug where `apiKey: null` was sent to a `z.string().optional()` input — which rejects null — failing validation on every keyless project creation.

Both suppressions are now removed, and typecheck, lint and test gate CI.

---

## S9 — No tests, no CI

No test runner in `package.json`. No `.github/`.

In isolation this is ordinary. Against the rest of the portfolio it isn't:

| Repo | Testing |
|---|---|
| ResumEase | Vitest + CI |
| Solarity | Playwright e2e, 49 documented bug shapes, standing checks |
| Vibe | none |

---

## What's actually good

Worth stating, because the list above is one-sided:

- `.env*` is gitignored. **No committed secrets.**
- `messages.getMany` scopes through the relation (`project: { userId }`) rather than trusting the `projectId` input. That's the correct pattern and it's easy to get wrong.
- Tool errors are returned to the model as text rather than thrown, so the agent can self-correct. That's a deliberate and sensible choice.
- Rate limiting exists at all.
- The module layout (`modules/<domain>/{server,ui}`) is clean and scales.

---

## Order of work

1. **S1 copy + S2 constants.** Minutes. These are the only untrue things shipping.
2. **S1 architecture.** Get the key out of event payloads.
3. **S3.** Make BYO-key consistent.
4. **S5.** Models to config, kill the test template name.
5. **S4.** Build verification — this unlocks everything in `PLAN.md`.
6. Then instrument, then measure, then rebrand.

Rebranding before step 5 would be painting a car with no engine.
