"use client";

import { useEffect } from "react";

import { Button } from "@/components/ui/button";

/**
 * This file previously declared `ErrorPage` and never exported it.
 *
 * Next's App Router error boundary convention requires a default export, so
 * the boundary never registered and this page never rendered — every
 * unhandled client error fell through to Next's built-in error UI. Lint
 * reported it as an unused variable, which is a quiet way to describe a
 * whole error path that was never wired up.
 *
 * It also ignored the `error` and `reset` props Next passes, so there was no
 * way to retry.
 */
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Until real reporting exists, the console is the only record.
    console.error(error);
  }, [error]);

  return (
    <div className="flex h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-2xl font-bold">Something went wrong</h1>

      <p className="max-w-prose text-sm text-muted-foreground">
        The page failed to load. Trying again often works, and if it
        doesn&apos;t, the error below is worth sharing.
      </p>

      {error.digest && (
        <p className="font-mono text-xs text-muted-foreground">
          Error ID: {error.digest}
        </p>
      )}

      <Button onClick={reset} variant="outline">
        Try again
      </Button>
    </div>
  );
}
