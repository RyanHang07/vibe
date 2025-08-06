"use client"

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import TextareaAutosize from "react-textarea-autosize";
import { useState } from "react";
import { z } from "zod";
import { ArrowUpIcon, Loader2Icon } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import ApiKeyInput from "@/components/api-key-form";

import { cn } from "@/lib/utils";
import { useTRPC } from "@/trpc/client";
import { Button } from "@/components/ui/button";
import { Form, FormField } from "@/components/ui/form";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { PROJECT_TEMPLATES } from "../../constants";
import { useClerk } from "@clerk/nextjs";

const formSchema = z.object({
    value: z.string()
        .min(1, { message: "Message is required" })
        .max(10000, { message: "Value is too long" }),
    apiKey: z.string().optional(), // Add API key to the form schema
})

export const ProjectForm = () => {
    const router = useRouter();
    const trpc  = useTRPC();
    const clerk = useClerk();
    const queryClient = useQueryClient();
    const [userApiKey, setUserApiKey] = useState<string | null>(null);
    
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
        // Include the API key in the submission
        await createProject.mutateAsync({
            value: values.value,
            apiKey: userApiKey, // Pass the API key to your tRPC mutation
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
    const isButtonDisabled = isPending || !form.formState.isValid;

    return (
        <Form {...form}>
            <section className="space-y-6">
                {/* API Key Input Section */}
                <div className="bg-white dark:bg-sidebar p-4 rounded-xl border">
                    <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                        OpenAI Configuration (Optional)
                    </h3>
                    <ApiKeyInput 
                        onApiKeyChange={handleApiKeyChange}
                        placeholder="Enter your OpenAI API key (optional - uses your own quota)"
                    />
                </div>

                <form 
                    onSubmit={form.handleSubmit(onSubmit)}
                    className={cn(
                        "relative border p-4 pt-1 rounded-xl bg-sidebar dark:bg-sidebar transition-all",
                        isFocused && "shadow-xs",
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
                                className="pt-4 resize-none border-none w-full outline-none bg-transparent"
                                placeholder="What would you like to build?"
                                onKeyDown={(e) => {
                                    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                                        e.preventDefault();
                                        form.handleSubmit(onSubmit)(e);
                                    }
                                }}
                            />
                        )}
                    />
                    <div className="flex gap-x-2 items-end justify-between pt-2">
                        <div className="text-[10px] text-muted-foreground font-mono">
                            <kbd className="ml-auto pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium opacity-100">
                                <span>&#8984;</span>Enter
                            </kbd>
                            &nbsp;to submit
                            {userApiKey && (
                                <span className="ml-2 text-green-600">• Using your API key</span>
                            )}
                        </div>
                        <Button 
                            disabled={isButtonDisabled}
                            className={cn(
                                "size-8 rounded-full",
                                isButtonDisabled && "bg-muted-foreground border"
                            )}>
                                {isPending ? (
                                <Loader2Icon className="size-4 animate-spin"/> 
                                ) : (
                                <ArrowUpIcon />
                                )}
                        </Button>
                    </div>
                </form>
                <div className="flex-wrap justify-center gap-2 hidden md:flex max-w-3xl">
                    {PROJECT_TEMPLATES.map((template) => (
                        <Button
                            key={template.title}
                            size="sm"
                            onClick={() => onSelect(template.prompt)}
                            variant="outline"
                            className="bg-white dark:bg-sidebar"
                        >
                            {template.emoji} {template.title}
                        </Button>
                    ))}
                </div>
            </section>
        </Form>
    )
}