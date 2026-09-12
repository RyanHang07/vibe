import Link from "next/link";
import  { CrownIcon } from "lucide-react";
import { formatDuration, intervalToDuration } from "date-fns";

import { Button } from "@/components/ui/button";
import { useAuth } from "@clerk/nextjs";
import { useMemo } from "react";

interface Props {
    points: number;
    msBeforeNext: number;
}

export const Usage = ({ points, msBeforeNext }: Props) => {
    const { has } = useAuth();
    const hasProAccess = has?.({plan: "pro"});

    const resetTime = useMemo(() => {
        try {
            // `msBeforeNext` is already a duration, so there is no reason to
            // read the clock at all. The previous form did
            // `intervalToDuration({ start: new Date(), end: Date.now() + ms })`,
            // which computed the same answer while making render impure:
            // the server and the client read different clocks, which is a
            // hydration mismatch, and the value changed on every re-render.
            return formatDuration(
                intervalToDuration({ start: 0, end: msBeforeNext }),
                { format: ["months", "days", "hours", "minutes"] }
            );
        } catch (error) {
            console.error("Error formatting duration", error)
            return "unknown";
        }
    }, [msBeforeNext])

    return (
        <div className="rounded-t-xl bg-background border border-b-0 p-2.5">
            <div className="flex items-center gap-x-2">
                <div>
                    <p className="text-sm">
                        {points} {hasProAccess ? "" : "free" } credits remaining
                    </p>
                    <p className="text-xs text-muted-foreground">
                        Resets in {" "}{resetTime}
                    </p>
                </div>
                {!hasProAccess &&
                    <Button
                        asChild
                        className="ml-auto"
                        variant="tertiary"
                        size="sm"
                    >
                        <Link href="/pricing">
                            <CrownIcon /> Upgrade
                        </Link>
                    </Button>
                }
            </div>
        </div>
    )
}