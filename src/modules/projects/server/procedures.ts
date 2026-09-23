import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/db";
import { consumeCredits, OutOfCreditsError } from "@/lib/usage";
import { hasServerKey } from "@/lib/models";
import { protectedProcedure, createTRPCRouter } from "@/trpc/init";
import { TRPCError } from "@trpc/server";
import { generateSlug } from "random-word-slugs"
import z from "zod";

export const projectsRouter = createTRPCRouter({
    getOne: protectedProcedure
        .input(z.object({
            id: z.string().min(1, { message: "ID is required" }),
        }))
        .query(async ({ input, ctx }) => {
            const existingProject = await prisma.project.findUnique({
                where: {
                    id: input.id,
                    userId: ctx.auth.userId,
                },
            });

            if (!existingProject) {
                throw new TRPCError({
                    code: "NOT_FOUND",
                    message: "Project not found",
                })
            }
            return existingProject;
        }),
    getMany: protectedProcedure
        .query(async ({ ctx}) => {
            const projects = await prisma.project.findMany({
                where: {
                    userId: ctx.auth.userId
                },
                orderBy: {
                    updatedAt: "desc",
                },
            });
            return projects;
        }),
    create: protectedProcedure
        .input(
            z.object({
                value: z.string()
                    .min(1, { message: "Value is required" })
                    .max(10000, { message: "Value is too long" }),
                apiKey: z.string().optional(), // Add API key as optional input
            }),
        )
        .mutation(async ({ input, ctx }) => {

            /**
             * A key has to come from somewhere.
             *
             * Enforced here as well as in the form, because a form is a
             * convenience and a mutation is the contract. Without this the
             * failure surfaces deep inside the agent function as a
             * `modelFor` throw — after a sandbox has been created and
             * billed, in a background job the user cannot see.
             */
            if (!input.apiKey && !hasServerKey()) {
                throw new TRPCError({
                    code: "BAD_REQUEST",
                    message:
                        "This deployment has no provider key of its own, so generations run on yours. Add an API key and try again.",
                });
            }

            /**
             * AUDIT S3, resolved — in the opposite direction to the one the
             * audit assumed.
             *
             * This used to skip `consumeCredits()` whenever the user
             * supplied their own API key, on the theory that a BYO-key user
             * costs us nothing. The message path never skipped, so the same
             * user was metered on every follow-up anyway: charged for a
             * conversation they were paying the provider for.
             *
             * The fix is not to skip on both paths. It is to skip on
             * neither, because the premise was wrong.
             *
             * A user's key pays for MODEL calls. Every run also creates an
             * E2B sandbox — 4 GB, 4 CPUs, one per generation — and that is
             * ours regardless of whose key ran the model. It is the larger
             * per-run cost and no user key touches it.
             *
             * So credits are not payment for tokens and never were. They are
             * a rate limit on sandbox usage, they apply to everyone, and
             * there is no bypass.
             */
            // Matched on a named error rather than on "not an Error".
            // See the S7 note in lib/usage.ts.
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

            const createdProject = await prisma.project.create({
                data: {
                    userId: ctx.auth.userId,
                    name: generateSlug(2, {
                        format: "kebab"
                    }),
                    messages: {
                        create: {
                            content: input.value,
                            role: "USER",
                            type: "RESULT",
                        }
                    }
                },
            });

            await inngest.send({
                    name:"code-agent/run",
                    data: {
                      value: input.value,
                      projectId: createdProject.id,
                      apiKey: input.apiKey, // Pass the API key to Inngest
                    }
            });

            return createdProject;
        }),
});