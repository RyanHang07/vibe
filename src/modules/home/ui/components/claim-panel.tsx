"use client";

/**
 * The left half of the split hero: the claim, at display size.
 *
 * The number is the headline, not a caption under one. That is the whole
 * positioning decision — this product's distinguishing feature is not that
 * it generates code, it is that the failure rate is measured and published.
 *
 * Read live from the run table rather than written into the page. A figure
 * someone typed is a marketing claim; a figure that can move on its own,
 * and can get worse, is a report.
 *
 * COLOURS HERE ARE FIXED, NOT THEMED.
 *
 * This panel is always cream, in light mode and dark. So its text cannot
 * use `text-foreground` or `text-muted-foreground`, which invert with the
 * theme — in dark mode that rendered cream type on a cream field and the
 * headline disappeared entirely.
 *
 * THREE STATES, NOT TWO.
 *
 * Loading, measured, and no-data are different facts. An earlier version
 * had only the last two, so for the frame before the query resolved the
 * page asserted "No generations measured yet" — which is not a loading
 * state, it is a false claim about the data, rendered at display size.
 *
 * That is the same error this entire project is about, committed on its own
 * front page: recording "we do not know yet" as "there is nothing". The
 * loading state now says nothing at all and holds the space.
 */

import { oneIn, percent, useClaim } from "../use-claim";

/**
 * Fade in once the number is known.
 *
 * `motion-safe:` so it is skipped entirely under `prefers-reduced-motion`,
 * where the content simply appears. Animation is the enhancement; the
 * content arriving is the requirement.
 */
const REVEAL = "motion-safe:animate-in motion-safe:fade-in motion-safe:duration-500";

const Skeleton = () => (
  <div aria-hidden className="motion-safe:animate-pulse">
    <div className="display-figure-skeleton rounded-sm bg-ink/10" />
    <div className="mt-8 h-4 w-64 max-w-full rounded-sm bg-ink/10" />
    <div className="mt-3 h-4 w-48 max-w-full rounded-sm bg-ink/10" />
  </div>
);

export const ClaimPanel = () => {
  const { data, isPending } = useClaim();

  const fs = data?.falseSuccess;
  const measured = !!data && data.judged > 0 && !!fs && fs.trials > 0;

  return (
    // No `container-type` here. It belongs on the grid track that wraps
    // this panel, which has a definite width; declaring it on the panel
    // made its size depend on its own content and collapsed every line to
    // one word. See the comment in (home)/page.tsx.
    //
    // `min-w-0` because this sits inside a grid track: grid items default
    // to `min-width: auto`, which refuses to shrink below the content's
    // minimum and is the usual cause of a column overflowing its track.
    <div
      className="flex min-h-dvh w-full min-w-0 flex-col justify-center gap-y-12 px-8 pt-24 pb-12 lg:px-14 text-ink"
      aria-busy={isPending}
    >
      <div>
        {isPending ? (
          <Skeleton />
        ) : measured ? (
          <div className={REVEAL}>
            {/*
              `text-nowrap`: "1 in 12" is a single unit of meaning and must
              never break across lines. `text-wrap: balance` from the base
              layer would happily split it into three.
            */}
            <p className="display-figure font-mono font-bold text-nowrap text-ink">
              {oneIn(fs.point) ?? percent(fs.point)}
            </p>
            <p className="display-lead mt-6 max-w-md text-ink">
              runs where this app told a user it worked
              <span className="text-ink/55">
                {" "}
                on code that does not compile.
              </span>
            </p>
            <p className="mt-6 font-mono text-xs text-ink/55">
              {fs.successes}/{fs.trials} · {percent(fs.point)} · 95% CI [
              {percent(fs.lower)}, {percent(fs.upper)}]
            </p>
          </div>
        ) : (
          <div className={REVEAL}>
            {/*
              Reached only once the query has resolved. No data is rendered
              as no data — not a zero, and not a hidden section.
            */}
            <p className="display-figure font-mono font-bold text-ink/25">
              —
            </p>
            <p className="display-lead mt-6 max-w-md text-ink">
              No generations measured yet.
            </p>
          </div>
        )}
      </div>

      <div className="space-y-2 border-t border-ink/15 pt-6">
        {isPending ? (
          <div aria-hidden className="motion-safe:animate-pulse space-y-2">
            <div className="h-3 w-72 max-w-full rounded-sm bg-ink/10" />
            <div className="h-3 w-56 max-w-full rounded-sm bg-ink/10" />
          </div>
        ) : (
          <div className={REVEAL}>
            <p className="max-w-md text-sm text-ink/70">
              Every generation is type-checked and bundled in a sandbox
              before it claims to work.
              {data?.typecheck
                ? ` Currently ${percent(data.typecheck.point)} typecheck.`
                : ""}
            </p>
            <p className="mt-2 font-mono text-[11px] leading-relaxed text-ink/45">
              {data?.judged ?? 0} judged runs · {data?.configs.length ?? 0}{" "}
              agent configurations · runs that could not be judged are
              excluded, not counted as failures
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
