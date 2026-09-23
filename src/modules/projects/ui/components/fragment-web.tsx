import { Fragment } from "@/generated/prisma";
import { CheckIcon, ExternalLinkIcon, RefreshCcwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { Hint } from "@/components/hint";

interface Props {
    data: Fragment;
}

export function FragmentWeb ({data}: Props) {
    const [fragmentKey, setFragmentKey] = useState(0);
    const [copied, setCopied] = useState(false);

    const onRefresh = () => {
        setFragmentKey((prev) => prev + 1);
    }

    const handleCopy = () => {
        navigator.clipboard.writeText(data.sandboxUrl);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    }

    return (
        <div className="flex h-full w-full flex-col">
            {/*
              A browser chrome, not a toolbar.

              The URL was a full-width outline button that looked like the
              primary action in the row. It is an address bar: quiet, mono,
              recessed, with the two real actions at its ends.
            */}
            <div className="flex shrink-0 items-center gap-x-2 border-b bg-sidebar p-2">
                <Hint text="Refresh" side="bottom" align="start">
                    <Button
                        size="sm"
                        variant="ghost"
                        onClick={onRefresh}
                        aria-label="Refresh preview"
                    >
                        <RefreshCcwIcon />
                    </Button>
                </Hint>

                <Hint text={copied ? "Copied" : "Copy URL"} side="bottom">
                    <button
                        type="button"
                        onClick={handleCopy}
                        disabled={!data.sandboxUrl || copied}
                        className="flex min-w-0 flex-1 items-center gap-x-2 rounded-md border bg-background px-3 py-1.5 text-start transition-colors hover:border-primary/40 disabled:opacity-100"
                    >
                        <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
                            {data.sandboxUrl}
                        </span>
                        {/*
                          Confirmation in place. The old version disabled the
                          button for two seconds with no visible change, so
                          the only feedback for a successful copy was the
                          button quietly refusing to be pressed again.
                        */}
                        {copied && (
                            <CheckIcon className="size-3.5 shrink-0 text-verdict-pass" />
                        )}
                    </button>
                </Hint>

                <Hint text="Open in new tab" side="bottom" align="end">
                    <Button
                        size="sm"
                        variant="ghost"
                        disabled={!data.sandboxUrl}
                        aria-label="Open preview in a new tab"
                        onClick={() => {
                            if (!data.sandboxUrl) return;
                            window.open(data.sandboxUrl, "_blank", "noopener,noreferrer");
                        }}
                    >
                        <ExternalLinkIcon />
                    </Button>
                </Hint>
            </div>

            {/*
              `bg-white` under the iframe, deliberately not `bg-background`.

              The generated app is a separate document with its own styling
              and no knowledge of this theme. While it loads, or if it fails
              to, a cream or near-black backdrop would read as part of the
              preview — the user would be judging our colour as their
              output's.
            */}
            <div className="min-h-0 flex-1 bg-white">
                <iframe
                    key={fragmentKey}
                    className="h-full w-full border-0"
                    sandbox="allow-forms allow-scripts allow-same-origin"
                    loading="lazy"
                    title="Generated app preview"
                    src={data.sandboxUrl}
                />
            </div>
        </div>
    )
}
