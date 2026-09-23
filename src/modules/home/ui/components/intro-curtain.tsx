"use client";

/**
 * The held intro.
 *
 * A full-bleed indigo curtain with the wordmark, which lifts after a beat
 * and reveals the page. Modelled on the reference site, which holds a logo
 * animation before any content appears.
 *
 * THE COST, STATED HONESTLY
 *
 * An intro animation is a tax paid on every visit, and this app is a tool
 * people return to rather than a brochure they see once. Three things keep
 * that from being a mistake:
 *
 *   1. It runs ONCE per session. `sessionStorage` remembers, so coming back
 *      from a project does not replay it.
 *   2. It never blocks. The page renders underneath; the curtain is an
 *      overlay that leaves. A failed timer or a JS error means the user
 *      sees the page, not a stuck splash.
 *   3. It respects `prefers-reduced-motion`, which skips it entirely.
 *
 * WHY THIS DRIVES THE DOM DIRECTLY INSTEAD OF USING STATE
 *
 * The obvious version calls `setVisible(true)` inside an effect, and React's
 * lint rule rejects it: setting state synchronously in an effect causes a
 * cascading render. The rule is right, and the usual escape hatch — compute
 * the initial state during render — does not work here, because the answer
 * depends on `sessionStorage` and `matchMedia`, neither of which exists on
 * the server. Rendering the curtain on the first client paint but not in the
 * server HTML is a hydration mismatch.
 *
 * So the curtain is always in the markup, starts hidden in both server and
 * client output, and the effect toggles classes on the node. That is
 * precisely what effects are for: pushing state into an external system,
 * which here is the DOM. No extra render, no mismatch, and the element is
 * an inert overlay if the effect never runs at all.
 */

import { useEffect, useRef } from "react";

const SEEN_KEY = "datum:intro-seen";

/**
 * Storage access throws in private windows and with site data blocked, so
 * both helpers swallow failure. The safe direction is different for each:
 * failing to *read* means "not seen", so the intro plays; failing to
 * *write* means it plays again. Neither breaks the page.
 */
const hasSeen = () => {
  try {
    return sessionStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return false;
  }
};

const markSeen = () => {
  try {
    sessionStorage.setItem(SEEN_KEY, "1");
  } catch {
    /* Storage unavailable. The intro replays; nothing breaks. */
  }
};

export const IntroCurtain = () => {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    if (reduced || hasSeen()) {
      markSeen();
      return;
    }

    // Reveal, then lift, then remove from the accessibility and hit-test
    // tree entirely.
    el.classList.replace("hidden", "flex");

    const lift = window.setTimeout(() => {
      el.classList.add("-translate-y-full");
    }, 1_100);

    const done = window.setTimeout(() => {
      el.classList.replace("flex", "hidden");
      markSeen();
    }, 1_900);

    return () => {
      window.clearTimeout(lift);
      window.clearTimeout(done);
    };
  }, []);

  return (
    <div
      ref={ref}
      aria-hidden
      className={[
        // `hidden` by default, in the server HTML and the first client
        // paint alike. The effect swaps it for `flex` and back.
        //
        // Exactly one display utility is ever present. Shipping `hidden`
        // and `flex` together would leave the outcome to whichever rule
        // Tailwind happens to emit last, which is not something to rely on.
        "hidden fixed inset-0 z-50 items-center justify-center bg-indigo",
        "transition-transform duration-700 ease-[cubic-bezier(0.76,0,0.24,1)]",
      ].join(" ")}
    >
      <span className="font-sans text-5xl md:text-7xl font-bold tracking-tight text-cream">
        datum<span className="text-indigo-bright">.</span>
      </span>
    </div>
  );
};
