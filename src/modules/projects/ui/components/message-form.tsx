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
import { Usage } from "./usage";
import ApiKeyInput from "@/components/api-key-form"; // Import your API key component

interface Props {
    projectId: string;
};

const formSchema = z.object({
    value: z.string()
        .min(1, { message: "Message is required" })
        .max(10000, { message: "Value is too long" }),
})

export const MessageForm = ({ projectId }: Props) => {
    const trpc = useTRPC();
    const queryClient = useQueryClient();
    const router = useRouter();
    
    // Add API key state
    const [validApiKey, setValidApiKey] = useState(null);

    const { data: usage } = useQuery(trpc.usage.status.queryOptions());

    const form = useForm<z.infer<typeof formSchema>>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            value: "",
        },
    });

    const createMessage = useMutation(trpc.messages.create.mutationOptions({
        onSuccess: (date) => {
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
        if (!validApiKey) {
            toast.error("Please enter a valid OpenAI API key");
            return;
        }
        
        await createMessage.mutateAsync({
            value: values.value,
            projectId: projectId,
            // Pass API key to your mutation
            apiKey: validApiKey,
        })
    }

    const [isFocused, setIsFocused] = useState(false);
    const isPending = createMessage.isPending;
    // Update button disabled state to include API key check
    const isButtonDisabled = isPending || !form.formState.isValid || !validApiKey;
    const showUsage = !!usage;

    return (
        <div className="space-y-4">
            {/* Add API key input */}
            <ApiKeyInput 
                onApiKeyChange={setValidApiKey}
                placeholder="OpenAI API key Required"
            />
            
            <Form {...form}>
                {/* {showUsage && (
                    <Usage
                        points={usage.remainingPoints}
                        msBeforeNext={usage.msBeforeNext}
                    />
                )} */}
                <form 
                    onSubmit={form.handleSubmit(onSubmit)}
                    className={cn(
                        "relative border p-4 pt-1 rounded-xl bg-sidebar dark:bg-sidebar transition-all",
                        isFocused && "shadow-xs",
                        showUsage && "rounded-t-none",
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
                                placeholder={validApiKey ? "What would you like to build?" : "Enter API key first..."}
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
            </Form>
        </div>
    )
}