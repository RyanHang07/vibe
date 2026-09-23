"use client";

/**
 * The landing page's headline figure.
 *
 * Extracted here because two components need it — the desktop claim panel
 * and the condensed mobile line — and having the mobile one import a hook
 * and a formatter from its desktop sibling made a presentational component
 * a dependency of another presentational component. React Query dedupes
 * the request either way; this is about which file owns the fact.
 */

import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";

export const useClaim = () => {
  const trpc = useTRPC();
  return useQuery(trpc.runs.summary.queryOptions());
};

export const percent = (value: number) => `${(value * 100).toFixed(1)}%`;

/** "1 in 12" lands faster than "8.3%" and is the same fact. */
export const oneIn = (rate: number) =>
  rate > 0 ? `1 in ${Math.round(1 / rate)}` : null;
