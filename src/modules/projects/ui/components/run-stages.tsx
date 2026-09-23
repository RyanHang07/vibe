"use client";

/**
 * D4: what the harness is doing, while it does it.
 *
 * WHAT THIS REPLACES
 *
 * A list of strings on a two-second timer — "Thinking… / Analyzing… /
 * Optimizing… / Almost ready…" — with no connection to the run. It was
 * invented motion. Nothing was being optimized and nothing was almost
 * ready; the words were chosen to feel busy while the user waited.
 *
 * WHY IT IS WORTH BUILDING RATHER THAN JUST DELETING
 *
 * This product's claim is that generated code is checked before it is
 * called finished. That claim is invisible: the checking happens in a
 * background job and the user sees a spinner. Showing the stages turns the
 * central argument into something that happens on screen.
 *
 * THE RULE IT MUST NOT BREAK
 *
 * A stage that has not been reached is `pending`, not `failed`, and a check
 * that has not returned is `unknown`, not `pass`. The same three-state
 * discipline as the rest of the project — the temptation in a progress UI
 * is to show a tick as soon as the step is passed, which would report
 * "typechecked" for a run whose typecheck verdict has not been written yet.
 */

import { useQuery } from "@tanstack/react-query";
import { CheckIcon, Loader2Icon, MinusIcon, XIcon } from "lucide-react";

import { useTRPC } from "@/trpc/client";
import { cn } from "@/lib/utils";
import { RUN_STAGES, STAGE_LABELS, type RunStage } from "@/lib/runs";

type StageState = "pending" | "active" | "pass" | "fail" | "unknown";

const StageIcon = ({ state }: { state: StageState }) => {
  switch (state) {
    case "active":
      return <Loader2Icon className="size-3.5 animate-spin text-primary" />;
    case "pass":
      return <CheckIcon className="size-3.5 text-verdict-pass" />;
    case "fail":
      return <XIcon className="size-3.5 text-verdict-fail" />;
    case "unknown":
      return <MinusIcon className="size-3.5 text-verdict-unknown" />;
    default:
      return (
        <span className="block size-1.5 rounded-full bg-muted-foreground/30" />
      );
  }
};

/** Everything except the terminal `done`, which is not a step to show. */
const VISIBLE_STAGES = RUN_STAGES.filter(
  (stage): stage is Exclude<RunStage, "done"> => stage !== "done",
);

interface Props {
  projectId: string;
}

export const RunStages = ({ projectId }: Props) => {
  const trpc = useTRPC();
  const { data: run } = useQuery({
    ...trpc.runs.active.queryOptions({ projectId }),
    /**
     * Two seconds. Fast enough that a stage change feels immediate, slow
     * enough that a four-minute run costs ~120 cheap indexed queries rather
     * than a websocket's worth of infrastructure.
     */
    refetchInterval: 2_000,
  });

  // Before the first stage is written there is nothing truthful to show
  // beyond "it started", which the parent's own copy already covers.
  const reached = run?.stage
    ? RUN_STAGES.indexOf(run.stage as RunStage)
    : -1;

  return (
    <ol className="space-y-2">
      {VISIBLE_STAGES.map((stage, index) => {
        let state: StageState = "pending";

        if (reached > index) {
          /*
            Passed stages show their verdict where one exists, and a plain
            tick where the stage has no verdict to give. `sandbox` and
            `generating` either happened or the run failed, so a tick is
            the honest mark; `typecheck` has a real three-state answer and
            must show it rather than a tick.
          */
          if (stage === "typecheck") {
            state =
              run?.typecheck === "pass"
                ? "pass"
                : run?.typecheck === "fail"
                  ? "fail"
                  : "unknown";
          } else {
            state = "pass";
          }
        } else if (reached === index) {
          state = "active";
        }

        return (
          <li
            key={stage}
            className={cn(
              "flex items-center gap-x-2.5 text-sm",
              state === "pending" && "text-muted-foreground/50",
              state === "active" && "text-foreground",
              (state === "pass" || state === "fail" || state === "unknown") &&
                "text-muted-foreground",
            )}
          >
            <span className="flex size-3.5 shrink-0 items-center justify-center">
              <StageIcon state={state} />
            </span>
            {STAGE_LABELS[stage]}
          </li>
        );
      })}

      {/*
        Named, rather than implied by an absent row. A run recorded before
        this column existed reports no stage at all, and a list of five grey
        dots would read as a run that has stalled.
      */}
      {reached === -1 && (
        <li className="pt-1 text-xs text-muted-foreground/60">
          Waiting for the run to report.
        </li>
      )}
    </ol>
  );
};
