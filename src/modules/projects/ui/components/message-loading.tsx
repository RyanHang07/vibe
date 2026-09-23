import { RunStages } from "./run-stages";

interface Props {
    projectId: string;
}

/**
 * The card shown while a generation is in flight.
 *
 * It used to cycle invented status strings on a timer. It now renders the
 * run's actual stages, read from the `Run` row the agent writes as it goes.
 *
 * The difference is not cosmetic: the old version would happily claim
 * "Adding finishing touches" for a run that had died four minutes earlier,
 * because nothing it displayed came from the run.
 */
export const MessageLoading = ({ projectId }: Props) => {
    return (
        <div className="flex flex-col px-3 pb-6">
            <div className="mb-3 flex items-center gap-x-2">
                <span className="font-sans text-sm font-bold tracking-tight">
                    datum<span className="text-primary">.</span>
                </span>
            </div>
            <div className="rounded-lg border bg-background p-4">
                <RunStages projectId={projectId} />
            </div>
        </div>
    );
};
