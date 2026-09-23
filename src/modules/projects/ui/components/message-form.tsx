import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import TextareaAutosize from "react-textarea-autosize";
import { useState } from "react";
import { z } from "zod";
import { ArrowUpIcon, Loader2Icon } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";

import { cn } from "@/lib/utils";
import { useTRPC } from "@/trpc/client";
import { Button } from "@/components/ui/button";
import { Form, FormField } from "@/components/ui/form";
import { toast } from "sonner";
import ApiKeyInput from "@/components/api-key-form";

interface Props {
    projectId: string;
};

const formSchema = z.object({
    value: z.string()
        .min(1, { message: "Message is required" })
        .max(10000, { message: "Value is too long" }),
})

/**
 * The follow-up message form.
 *
 * A KEY WAS REQUIRED HERE AND NOWHERE ELSE.
 *
 * This form refused to submit without one — the button stayed disabled, the
 * placeholder read "Enter API key first…", and `onSubmit` returned early
 * with "Please enter a valid OpenAI API key".
 *
 * Nothing on the server asks for that. `messages.create` declares
 * `apiKey: z.string().optional()` and falls through to the deployment's own
 * credentials, exactly as `projects.create` does. So a user could start a
 * project without a key and then be unable to send a second message to it.
 *
 * The requirement was invented in the client. Removed, which makes the two
 * forms agree and makes the copy on the key field true.
 */
export const MessageForm = ({ projectId }: Props) => {
    const trpc = useTRPC();
    const queryClient = useQueryClient();
    const router = useRouter();

    // `useState(null)` infers the type as `null`, so the setter only ever
    // accepted null and this state was untyped in practice. Runtime was fine;
    // the compiler was simply not checking anything here.
    const [userApiKey, setUserApiKey] = useState<string | null>(null);

    // Same fact, same source as the project form: asked for, not assumed.
    // Defaults to `true` while loading, which shows the field to someone
    // who may not need it rather than hiding it from someone who does.
    const { data: config } = useQuery(trpc.runs.config.queryOptions());
    const requiresUserKey = config?.requiresUserKey ?? true;

    const form = useForm<z.infer<typeof formSchema>>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            value: "",
        },
    });

    const createMessage = useMutation(trpc.messages.create.mutationOptions({
        onSuccess: () => {
            form.reset();
            queryClient.invalidateQueries(
                trpc.messages.getMany.queryOptions({ projectId }),
            );
            queryClient.invalidateQueries(
                trpc.usage.status.queryOptions(),
            )
        },
        onError: (error) => {
            toast.error(error.message);
            if (error.data?.code === "TOO_MANY_REQUESTS") {
                router.push("/pricing");
            }
        },
    }));

    const onSubmit = async (values: z.infer<typeof formSchema>) => {
        await createMessage.mutateAsync({
            value: values.value,
            projectId: projectId,
            // `?? undefined` for the same reason as the project form: the
            // input is `z.string().optional()`, and zod rejects null.
            apiKey: userApiKey ?? undefined,
        })
    }

    const [isFocused, setIsFocused] = useState(false);
    const isPending = createMessage.isPending;
    const missingRequiredKey = requiresUserKey && !userApiKey;
    const isButtonDisabled =
        isPending || !form.formState.isValid || missingRequiredKey;

    return (
        <Form {...form}>
            <div className="space-y-3">
                <form
                    onSubmit={form.handleSubmit(onSubmit)}
                    className={cn(
                        "relative rounded-lg border bg-background p-4 pt-1 transition-colors",
                        isFocused && "border-primary/50",
                    )}
                >
                    <FormField
                        control={form.control}
                        name="value"
                        render={({field}) => (
                            <TextareaAutosize
                                {...field}
                                disabled={isPending}
                                onFocus={() => setIsFocused(true)}
                                onBlur={() => setIsFocused(false)}
                                minRows={2}
                                maxRows={8}
                                className="w-full resize-none border-none bg-transparent pt-4 text-sm outline-none"
                                placeholder={
                                    missingRequiredKey
                                        ? "Add an API key below to continue"
                                        : "What should change?"
                                }
                                onKeyDown={(e) => {
                                    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                                        e.preventDefault();
                                        form.handleSubmit(onSubmit)(e);
                                    }
                                }}
                            />
                        )}
                    />
                    <div className="flex items-end justify-between gap-x-2 pt-2">
                        <div className="font-mono text-[10px] text-muted-foreground">
                            <kbd className="pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium">
                                <span>&#8984;</span>Enter
                            </kbd>
                            &nbsp;to submit
                            {userApiKey && " · using your key"}
                        </div>
                        <Button
                            disabled={isButtonDisabled}
                            // 44px, matching the home form. The old size-8
                            // was below every touch-target guideline.
                            className="size-11 rounded-full">
                                {isPending ? (
                                <Loader2Icon className="size-4 animate-spin"/>
                                ) : (
                                <ArrowUpIcon />
                                )}
                        </Button>
                    </div>
                </form>

                {/*
                  Collapsed, like the home form. Configuration should not be
                  the most prominent thing above the message box you are
                  trying to type in.
                */}
                {/* Open while the key is required and missing — see the
                    project form for why a disclosure is wrong for a
                    credential the app cannot run without. */}
                <details className="group" open={missingRequiredKey}>
                    <summary className="cursor-pointer list-none font-mono text-xs text-muted-foreground transition-colors hover:text-foreground">
                        <span className="inline-block transition-transform group-open:rotate-90">
                            ›
                        </span>{" "}
                        API configuration
                        {userApiKey
                            ? " · key set"
                            : requiresUserKey && " · required"}
                    </summary>
                    <div className="mt-3">
                        <ApiKeyInput
                            onApiKeyChange={setUserApiKey}
                            placeholder="sk-..."
                            required={requiresUserKey}
                        />
                    </div>
                </details>
            </div>
        </Form>
    )
}
