/**
 * Failures that are about the infrastructure, not the code.
 *
 * This started life inside `build-check.ts`, guarding one question: did the
 * build fail because the generated code is bad, or because the sandbox
 * could not write to disk? Recording the second as the first produced two
 * runs scored as generation failures on code that was never compiled.
 *
 * The same question applies to the agent loop. A 429 from the model
 * provider is not the agent writing bad code — but it arrives as an
 * exception, gets caught, and lands in the Run table looking exactly like
 * one. At which point a rate-limited batch reads as a catastrophic drop in
 * quality, and the cause is invisible.
 *
 * So the rule is one rule, applied in both places: **an outcome that says
 * nothing about the code must never be recorded as evidence about the
 * code.**
 *
 * Deliberately conservative. Every pattern must name a fault that generated
 * source cannot cause. Anything broader starts excusing real failures, and
 * a metric that forgives too much is as useless as one that blames too
 * much.
 */

export type FaultKind =
  | "rate limit"
  | "quota"
  | "filesystem permissions"
  | "disk full"
  | "out of memory"
  | "network"
  | "sandbox gone"
  | "provider outage";

const PATTERNS: ReadonlyArray<{ pattern: RegExp; kind: FaultKind }> = [
  // Rate limits. 429 is the signal; the wording varies by provider.
  { pattern: /\b429\b|rate[ _-]?limit|too many requests/i, kind: "rate limit" },
  { pattern: /quota|insufficient[ _-]?credit|billing/i, kind: "quota" },

  // Sandbox and host faults.
  { pattern: /EACCES|EPERM|permission denied/i, kind: "filesystem permissions" },
  { pattern: /ENOSPC|no space left/i, kind: "disk full" },
  { pattern: /ENOMEM|out of memory|\bKilled\b/i, kind: "out of memory" },
  { pattern: /sandbox (was )?(not found|terminated|closed)/i, kind: "sandbox gone" },

  // Transport.
  { pattern: /ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN/i, kind: "network" },
  { pattern: /\b(502|503|504)\b|overloaded|service unavailable/i, kind: "provider outage" },
];

/** The fault named by this text, or null if it looks like a genuine failure. */
export const infrastructureFault = (text: string | null | undefined): FaultKind | null => {
  if (!text) return null;
  return PATTERNS.find(({ pattern }) => pattern.test(text))?.kind ?? null;
};

/** Marker written into stored error text so reports can find these later. */
export const FAULT_PREFIX = "[infrastructure fault:";

export const markFault = (kind: FaultKind, detail: string): string =>
  `${FAULT_PREFIX} ${kind}] ${detail}`;

export const isMarkedFault = (text: string | null | undefined): boolean =>
  typeof text === "string" && text.includes(FAULT_PREFIX);
