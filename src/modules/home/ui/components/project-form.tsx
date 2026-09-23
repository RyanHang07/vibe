"use client"

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import TextareaAutosize from "react-textarea-autosize";
import { useState } from "react";
import { z } from "zod";
import { ArrowUpIcon, Loader2Icon } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import ApiKeyInput from "@/components/api-key-form";

import { cn } from "@/lib/utils";
import { useTRPC } from "@/trpc/client";
import { Button } from "@/components/ui/button";
import { Form, FormField } from "@/components/ui/form";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { PROJECT_TEMPLATES } from "../../constants";

const formSchema = z.object({
    value: z.string()
        .min(1, { message: "Message is required" })
        .max(10000, { message: "Value is too long" }),
    apiKey: z.string().optional(),
})

/**
 * How many starter prompts to show.
 *
 * There were eight, wrapped across three rows, and together with the two
 * cards above them the hero carried more than ten interactive objects in a
 * single viewport. Suggestions are there to demonstrate the shape of a good
 * prompt, and three do that as well as eight while leaving the input as the
 * obvious thing to use.
 */
const VISIBLE_TEMPLATES = 3;

export const ProjectForm = () => {
    const router = useRouter();
    const trpc  = useTRPC();
    const queryClient = useQueryClient();
    const [userApiKey, setUserApiKey] = useState<string | null>(null);

    /**
     * Whether a user key is required is a fact about the deployment, asked
     * for rather than assumed. Defaults to `true` while loading: erring
     * toward "required" shows the field to someone who may not need it,
     * while erring the other way hides it from someone who does.
     */
    const { data: config } = useQuery(trpc.runs.config.queryOptions());
    const requiresUserKey = config?.requiresUserKey ?? true;

    const form = useForm<z.infer<typeof formSchema>>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            value: "",
            apiKey: undefined,
        },
    });

    const createProject = useMutation(trpc.projects.create.mutationOptions({
        onSuccess: (data) => {
            queryClient.invalidateQueries(
                trpc.projects.getMany.queryOptions(),
            );
            queryClient.invalidateQueries(
                trpc.usage.status.queryOptions(),
            );
            router.push(`/projects/${data.id}`);
        },
        onError: (error) => {
            toast.error(error.message);

            if (error.data?.code === "UNAUTHORIZED") {
                router.push("/sign-in");
            }

            if (error.data?.code === "TOO_MANY_REQUESTS") {
                router.push("/pricing");
            }
        },
    }));

    const onSubmit = async (values: z.infer<typeof formSchema>) => {
        await createProject.mutateAsync({
            value: values.value,
            // `?? undefined` is load-bearing. The tRPC input is
            // `z.string().optional()`, which is `string | undefined` —
            // zod rejects null. Sending `null` when no key was entered
            // failed validation on every keyless project creation.
            apiKey: userApiKey ?? undefined,
        })
    }

    const onSelect = (value: string) => {
        form.setValue("value", value, {
            shouldDirty: true,
            shouldTouch: true,
            shouldValidate: true
        });
    }

    const handleApiKeyChange = (apiKey: string | null) => {
        setUserApiKey(apiKey);
        form.setValue("apiKey", apiKey || undefined);
    }

    const [isFocused, setIsFocused] = useState(false);
    const isPending = createProject.isPending;

    /**
     * Blocked, with the reason visible.
     *
     * The server refuses a keyless generation when the deployment has no
     * key of its own, so submitting without one wastes a round trip and
     * returns an error where the user is not looking. The form knows the
     * same fact and can say so first.
     */
    const missingRequiredKey = requiresUserKey && !userApiKey;
    const isButtonDisabled =
        isPending || !form.formState.isValid || missingRequiredKey;

    return (
        <Form {...form}>
            <section className="space-y-5">
                {/*
                  The input comes FIRST now.

                  API configuration was a full-width white card above the
                  prompt box: the brightest, largest object in the hero, and
                  the first thing the eye landed on. It is optional
                  configuration, and it was outranking the product's entire
                  claim.

                  A native <details> rather than a component: it is
                  disclosure, it works before hydration, it is keyboard
                  accessible and screen-reader announced for free, and it
                  needs no state.
                */}
                <form
                    onSubmit={form.handleSubmit(onSubmit)}
                    className={cn(
                        "relative rounded-lg border border-cream/20 bg-cream/[0.07] p-4 pt-1 transition-colors",
                        isFocused && "border-cream/40 bg-cream/10",
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
                                className="w-full resize-none border-none bg-transparent pt-4 text-cream outline-none placeholder:text-cream/45"
                                placeholder={
                                    missingRequiredKey
                                        ? "Add an API key below to start building"
                                        : "What would you like to build?"
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
                        <div className="font-mono text-[10px] text-cream/50">
                            <kbd className="pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border border-cream/25 px-1.5 font-mono text-[10px] font-medium">
                                <span>&#8984;</span>Enter
                            </kbd>
                            &nbsp;to submit
                            {userApiKey && (
                                <span className="ml-2 text-cream/80">
                                    · using your key
                                </span>
                            )}
                        </div>
                        <Button
                            disabled={isButtonDisabled}
                            className={cn(
                                // 44px, not 32px. The old size-8 was below
                                // every touch-target guideline.
                                "size-11 rounded-full bg-cream text-indigo hover:bg-cream/90",
                                isButtonDisabled && "bg-cream/25 text-cream/60",
                            )}>
                                {isPending ? (
                                <Loader2Icon className="size-4 animate-spin"/>
                                ) : (
                                <ArrowUpIcon />
                                )}
                        </Button>
                    </div>
                </form>

                {/* Three, not eight, and no emoji. */}
                <div className="flex flex-wrap gap-2">
                    {PROJECT_TEMPLATES.slice(0, VISIBLE_TEMPLATES).map((template) => (
                        <button
                            key={template.title}
                            type="button"
                            onClick={() => onSelect(template.prompt)}
                            className="rounded-full border border-cream/25 px-4 py-2 text-sm text-cream/75 transition-colors hover:border-cream/50 hover:text-cream"
                        >
                            {template.title}
                        </button>
                    ))}
                </div>

                {/*
                  `open` when a key is required.

                  A disclosure is right for optional configuration and wrong
                  for a credential the app cannot run without: it hides the
                  one field the user must fill, behind a summary that reads
                  like a setting. When required, it starts open and only
                  collapses once a valid key is in.
                */}
                <details
                    className="group border-t border-cream/15 pt-4"
                    open={requiresUserKey && !userApiKey}
                >
                    <summary className="cursor-pointer list-none font-mono text-xs text-cream/55 transition-colors hover:text-cream/80">
                        <span className="inline-block transition-transform group-open:rotate-90">
                            ›
                        </span>{" "}
                        API configuration
                        {userApiKey
                            ? " · key set"
                            : requiresUserKey && " · required"}
                    </summary>
                    <div className="mt-4">
                        <ApiKeyInput
                            onApiKeyChange={handleApiKeyChange}
                            placeholder="sk-..."
                            required={requiresUserKey}
                        />
                    </div>
                </details>
            </section>
        </Form>
    )
}
