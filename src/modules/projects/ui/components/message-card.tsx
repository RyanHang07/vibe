import { MessageRole, MessageType, Fragment } from "@/generated/prisma";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { ChevronRightIcon, Code2Icon } from "lucide-react";

interface UserMessageProps {
    content: string;
}

/**
 * NOTE: `maw-w-[80%]` was here — a typo, so the class never existed and the
 * bubble was never constrained. A long prompt ran the full width of the
 * pane and stopped reading as "something you said".
 */
const UserMessage = ({ content }: UserMessageProps) => {
    return (
        <div className="flex justify-end px-3 pb-5">
            <div className="max-w-[85%] rounded-lg rounded-br-sm bg-secondary px-3.5 py-2.5 text-sm break-words">
                {content}
            </div>
        </div>
    );
};

interface FragmentCardProps {
    fragment: Fragment;
    isActiveFragment: boolean;
    onFragmentClick: (fragment: Fragment) => void;
}

const FragmentCard = ({ fragment, isActiveFragment, onFragmentClick }: FragmentCardProps) => {
    return (
        <button
            className={cn(
                "group/fragment flex w-full max-w-sm items-center gap-x-3 rounded-lg border p-3 text-start transition-colors",
                "hover:border-primary/40 hover:bg-secondary",
                isActiveFragment &&
                    "border-primary bg-primary text-primary-foreground hover:bg-primary hover:border-primary",
            )}
            onClick={() => onFragmentClick(fragment)}
        >
            <Code2Icon className="size-4 shrink-0" />
            <div className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                    {fragment.title}
                </span>
                <span
                    className={cn(
                        "block font-mono text-[11px]",
                        isActiveFragment
                            ? "text-primary-foreground/70"
                            : "text-muted-foreground",
                    )}
                >
                    open preview
                </span>
            </div>
            <ChevronRightIcon className="size-4 shrink-0 opacity-50 transition-transform group-hover/fragment:translate-x-0.5" />
        </button>
    );
};

interface AssistantMessageProps {
    content: string;
    fragment: Fragment | null;
    createdAt: Date;
    isActiveFragment: boolean;
    onFragmentClick: (fragment: Fragment) => void;
    type: MessageType;
}

const AssistantMessage = ({ content, fragment, createdAt, isActiveFragment, onFragmentClick, type }: AssistantMessageProps) => {
    const isError = type === "ERROR";

    return (
        // `flexx` was here instead of `flex` — another class that never
        // existed, so the column layout below it was never applied.
        <div className="group flex flex-col px-3 pb-6">
            <div className="mb-2 flex items-center gap-x-2">
                {/*
                  The wordmark rather than the logo image. One identity, set
                  in the display face, and one fewer network request per
                  message in a list that can run to dozens.
                */}
                <span className="font-sans text-sm font-bold tracking-tight">
                    datum<span className="text-primary">.</span>
                </span>
                {/*
                  Timestamp at low opacity rather than hidden until hover.
                  `opacity-0` with only a hover trigger means keyboard and
                  touch users never see it at all.
                */}
                <span className="font-mono text-[11px] text-muted-foreground/60 transition-opacity group-hover:text-muted-foreground">
                    {format(createdAt, "HH:mm · MMM d")}
                </span>
            </div>

            <div
                className={cn(
                    "flex flex-col gap-y-4 text-sm leading-relaxed",
                    isError && "text-destructive",
                )}
            >
                <span>{content}</span>
                {fragment && type === "RESULT" && (
                    <FragmentCard
                        fragment={fragment}
                        isActiveFragment={isActiveFragment}
                        onFragmentClick={onFragmentClick}
                    />
                )}
            </div>
        </div>
    );
};

interface MessageCardProps {
    content: string,
    role: MessageRole,
    fragment: Fragment | null,
    createdAt: Date,
    isActiveFragment: boolean,
    onFragmentClick: (fragment: Fragment) => void,
    type: MessageType;
}

export const MessageCard = ({
    content,
    role,
    fragment,
    createdAt,
    isActiveFragment,
    onFragmentClick,
    type,
}: MessageCardProps) => {
    if (role === "ASSISTANT") {
        return (
            <AssistantMessage
                content={content}
                fragment={fragment}
                createdAt={createdAt}
                isActiveFragment={isActiveFragment}
                onFragmentClick={onFragmentClick}
                type={type}
            />
        );
    }

    return <UserMessage content={content} />;
};
