import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/db";
import { consumeCredits, OutOfCreditsError } from "@/lib/usage";
import { hasServerKey } from "@/lib/models";
import { protectedProcedure, createTRPCRouter } from "@/trpc/init";
import { TRPCError } from "@trpc/server";
import z from "zod";

export const messagesRouter = createTRPCRouter({
    getMany: protectedProcedure
        .input(
            z.object({
                projectId: z.string().min(1, { message: "Project ID is required" }),
            })
        )
        .query(async ({ input, ctx }) => {
            const messages = await prisma.message.findMany({
                where: {
                    projectId: input.projectId,
                    project: {
                        userId: ctx.auth.userId
                    },
                },
                include: {
                    fragment: true,
                },
                orderBy: {
                    updatedAt: "asc",
                },
            });
            return messages;
        }),
    create: protectedProcedure
        .input(
            z.object({
                value: z.string()
                    .min(1, { message: "Message is required" })
                    .max(10000, { message: "Value is too long" }),
                projectId: z.string().min(1, { message: "Project ID is required" }),
                apiKey: z.string().optional(), // Add API key input
            })
        )
        .mutation(async ({ input, ctx }) => {
            const existingProject = await prisma.project.findUnique({
                where: {
                    id: input.projectId,
                    userId: ctx.auth.userId,
                },
            })

            if (!existingProject) {
                throw new TRPCError({
                    code: "NOT_FOUND",
                    message: "Project not found",
                })
            }
            
            // Same gate as project creation. See the comment there: a form
            // is a convenience, a mutation is the contract.
            if (!input.apiKey && !hasServerKey()) {
                throw new TRPCError({
                    code: "BAD_REQUEST",
                    message:
                        "This deployment has no provider key of its own, so generations run on yours. Add an API key and try again.",
                });
            }

            // Same shape as project creation. See the S7 note in lib/usage.ts.
            try {
                await consumeCredits();
            } catch (error) {
                if (error instanceof OutOfCreditsError) {
                    throw new TRPCError({
                        code: "TOO_MANY_REQUESTS",
                        message: "You have run out of credits",
                    });
                }

                throw new TRPCError({
                    code: "INTERNAL_SERVER_ERROR",
                    message: "Could not check your remaining credits",
                    cause: error,
                });
            }

            const createdMessage = await prisma.message.create({
                data: {
                    content: input.value,
                    role: "USER",
                    type: "RESULT",
                    projectId: input.projectId
                },
            });

            await inngest.send({
                    name:"code-agent/run",
                    data: {
                      value: input.value,
                      projectId: input.projectId,
                      apiKey: input.apiKey, // Pass the API key to Inngest
                    }
            })

            return createdMessage;
        }),
});
