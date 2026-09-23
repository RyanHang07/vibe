"use client";

/**
 * D3: the evidence tab.
 *
 * Every run this project produced, with what the checks found next to what
 * the agent claimed. The comparison is the point — a verdict on its own is
 * just another assertion, and the gap between "the agent said it worked"
 * and "it compiles" is the finding this project exists to surface.
 *
 * THE ONE RULE THIS COMPONENT MUST NOT BREAK
 *
 * Four states, never three and never two: pass, fail, unknown, not run.
 * A badge that renders `null` as a red X would turn "the sandbox died" into
 * "your code is broken", which is the exact substitution the harness spent
 * weeks learning not to make. It is easier to break here than anywhere
 * else, because a boolean is so convenient in JSX.
 */

import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { Badge } from "@/components/ui/badge";

type Verdict = "pass" | "fail" | "unknown" | "not-run";

/**
 * The verdict colours come from the design tokens, not from Tailwind's
 * palette.
 *
 * They were hardcoded as `emerald` / `red` / `amber`, which meant the one
 * part of the system whose colours carry meaning was the one part not
 * using the tokens defined for it — and the tokens shift between light and
 * dark while the hardcoded values did not.
 *
 * `unknown` is neutral, not amber and certainly not red. "Could not be
 * judged" is an absence of data, and colouring it like a failure is the
 * visual form of counting it in the denominator.
 */
const VERDICT_STYLE: Record<Verdict, { label: string; className: string }> = {
  pass: {
    label: "pass",
    className: "bg-verdict-pass/12 text-verdict-pass",
  },
  fail: {
    label: "fail",
    className: "bg-verdict-fail/12 text-verdict-fail",
  },
  unknown: {
    label: "unknown",
    className: "bg-verdict-unknown/12 text-verdict-unknown",
  },
  "not-run": {
    label: "not run",
    className: "bg-muted text-muted-foreground",
  },
};

const VerdictBadge = ({ verdict }: { verdict: Verdict }) => {
  const style = VERDICT_STYLE[verdict];
  return (
    <Badge variant="secondary" className={`font-mono ${style.className}`}>
      {style.label}
    </Badge>
  );
};

const seconds = (ms: number | null) =>
  ms === null ? "—" : `${(ms / 1000).toFixed(1)}s`;

interface Props {
  projectId: string;
}

export const EvidencePanel = ({ projectId }: Props) => {
  const trpc = useTRPC();
  const { data, isLoading } = useQuery({
    ...trpc.runs.byProject.queryOptions({ projectId }),
    /**
     * Polled rather than fetched once. A run in flight writes its verdict
     * minutes after the page loads, and a panel that only reflects the
     * moment it mounted would show "not run" for work that has since
     * finished. D4 adds intermediate states to the same poll.
     */
    refetchInterval: 5_000,
  });

  if (isLoading) {
    return (
      <div className="p-6 text-sm text-muted-foreground">Loading evidence…</div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        No runs recorded for this project yet. Every generation is
        type-checked and bundled in a sandbox; the results appear here.
      </div>
    );
  }

  /**
   * The disagreement count, computed and shown even when it is zero.
   * A panel that surfaces this only when it is non-zero would make a
   * clean project look unmeasured rather than clean.
   */
  const disagreements = data.filter(
    (run) => run.agentClaimedSuccess && run.bundle === "fail",
  ).length;

  return (
    /*
      `scrollbar-gutter: stable` reserves the scrollbar's width whether or
      not it is showing, so the cards do not shift sideways the moment a
      polled run pushes the list past the fold.

      `overscroll-behavior: contain` stops a scroll that reaches the end of
      this list from chaining into the page behind it.
    */
    <div
      className="h-full overflow-y-auto overscroll-contain p-4 space-y-4"
      style={{ scrollbarGutter: "stable" }}
    >
      <div className="rounded-lg border p-4">
        <p className="text-sm">
          <span className="font-semibold">{data.length}</span> recorded run
          {data.length === 1 ? "" : "s"}.{" "}
          <span className="font-semibold">{disagreements}</span> where the
          agent reported success on code that did not build.
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Runs the checks could not judge are marked unknown, not failed.
        </p>
      </div>

      {data.map((run) => (
        <div key={run.id} className="rounded-lg border p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-mono text-muted-foreground">
              {run.startedAt.toISOString().slice(0, 19).replace("T", " ")}
            </span>
            <span className="text-xs text-muted-foreground">
              {run.fileCount ?? "—"} file{run.fileCount === 1 ? "" : "s"} ·{" "}
              {seconds(run.durationMs)}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            <span className="flex items-center gap-x-2">
              <span className="text-muted-foreground">typecheck</span>
              <VerdictBadge verdict={run.typecheck as Verdict} />
            </span>
            <span className="flex items-center gap-x-2">
              <span className="text-muted-foreground">bundle</span>
              <VerdictBadge verdict={run.bundle as Verdict} />
            </span>
            <span className="flex items-center gap-x-2">
              <span className="text-muted-foreground">agent said</span>
              <Badge variant="secondary" className="font-mono">
                {run.agentClaimedSuccess ? "success" : "no summary"}
              </Badge>
            </span>
          </div>

          {/*
            The headline of the whole project, rendered per run. When the
            agent claimed success and the bundle failed, say so plainly
            rather than leaving the reader to compare two badges.
          */}
          {run.agentClaimedSuccess && run.bundle === "fail" && (
            <p className="border-l-2 border-verdict-fail pl-3 text-sm text-verdict-fail">
              Reported success on code that does not build.
            </p>
          )}

          {run.shape && (
            <p className="text-xs">
              <span className="text-muted-foreground">failure shape: </span>
              <span className="font-mono">{run.shape}</span>
            </p>
          )}

          {/*
            Raw output, not a summary of it. Four rounds of diagnosis were
            once lost to a `stderr || stdout` that discarded the build log,
            and a UI that paraphrases compiler output repeats that mistake
            in a friendlier typeface.
          */}
          {run.output && (
            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground">
                compiler output
              </summary>
              {/*
                `overflow: auto`, not `scroll` — scrollbars appear only when
                the output actually overflows. `overscroll-contain` keeps a
                scroll inside this block from chaining out to the card list.

                Compiler output is not wrapped: a type error reads as a
                column of aligned carets and reflowing it destroys the only
                formatting it has.
              */}
              <pre className="mt-2 max-h-64 overflow-auto overscroll-contain rounded bg-muted p-3 text-[11px] leading-relaxed">
                {run.output}
              </pre>
            </details>
          )}

          {/*
            A verdict is only meaningful against a known target. Two runs
            judged against different templates are not comparable, and
            nothing but this line would say so.
          */}
          <p className="text-[11px] font-mono text-muted-foreground">
            {run.configVersion ?? "unversioned"}
            {run.sandboxTemplate ? ` · ${run.sandboxTemplate}` : ""}
          </p>
        </div>
      ))}
    </div>
  );
};
