"use client";

/**
 * The claim, condensed to one line, for the phone.
 *
 * The left panel is hidden below `md`, which would otherwise mean the
 * product's entire argument is desktop-only — and a portfolio link is more
 * often opened on a phone first than on a desktop. This is the smallest
 * thing that keeps the figure present without competing with the input.
 *
 * Same data as `ClaimPanel`, same query, so React Query serves it from
 * cache and there is no second request.
 */

import { oneIn, percent, useClaim } from "../use-claim";

export const MobileClaim = () => {
  const { data, isPending } = useClaim();
  const fs = data?.falseSuccess;

  /**
   * While loading, hold the space rather than collapsing it. Rendering
   * nothing and then inserting two lines of text shoves the headline and
   * the input down the moment the query resolves.
   */
  if (isPending) {
    return (
      <div
        aria-hidden
        className="motion-safe:animate-pulse border-l-2 border-cream/15 pl-4"
      >
        <div className="h-3 w-48 max-w-full rounded-sm bg-cream/15" />
        <div className="mt-2 h-3 w-36 max-w-full rounded-sm bg-cream/15" />
      </div>
    );
  }

  if (!data || data.judged === 0 || !fs || fs.trials === 0) return null;

  return (
    <p className="motion-safe:animate-in motion-safe:fade-in motion-safe:duration-500 border-l-2 border-cream/25 pl-4 font-mono text-xs leading-relaxed text-cream/70">
      <span className="text-cream font-bold">
        {oneIn(fs.point) ?? percent(fs.point)}
      </span>{" "}
      runs reported success on code that does not compile ·{" "}
      {fs.successes}/{fs.trials} · 95% CI [{percent(fs.lower)},{" "}
      {percent(fs.upper)}]
    </p>
  );
};
