import * as React from "react"

const MOBILE_BREAKPOINT = 768
const QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`

/**
 * The shadcn version of this hook read `window.innerWidth` and called
 * `setIsMobile` synchronously inside an effect, which
 * `react-hooks/set-state-in-effect` flags: it renders once with the wrong
 * answer, then immediately re-renders with the right one.
 *
 * `useSyncExternalStore` is what that pattern is for. It subscribes to
 * matchMedia, reads the current value during render on the client, and takes
 * an explicit server snapshot instead of guessing — so there is one render,
 * and no hydration mismatch.
 */

const subscribe = (onChange: () => void) => {
  const mql = window.matchMedia(QUERY)
  mql.addEventListener("change", onChange)
  return () => mql.removeEventListener("change", onChange)
}

const getSnapshot = () => window.matchMedia(QUERY).matches

/** There is no viewport on the server. Desktop is the safer default here. */
const getServerSnapshot = () => false

export function useIsMobile() {
  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
