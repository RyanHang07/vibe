import { RateLimiterPrisma } from "rate-limiter-flexible";
import { prisma } from "./db";
import { auth } from "@clerk/nextjs/server";


/**
 * Generations included per billing window, by plan.
 *
 * These shipped inverted: FREE was 10000 against a PRO of 100, so free
 * accounts had a hundred times the paid allowance. A comment claimed the
 * value was 100 while the code said 10000. See docs/AUDIT.md S2.
 *
 * Pick the real numbers deliberately. The invariant below makes the
 * inversion impossible to reintroduce silently.
 */
export const FREE_POINTS = 5;
export const PRO_POINTS = 100;

/** 30 days, in seconds. */
const DURATION = 30 * 24 * 60 * 60;

const GENERATION_COST = 1;

if (PRO_POINTS <= FREE_POINTS) {
  throw new Error(
    `Plan allowances are inverted: PRO_POINTS (${PRO_POINTS}) must exceed FREE_POINTS (${FREE_POINTS}).`,
  );
}

export async function getUsageTracker() {

    const { has } = await auth();
    const hasProAccess = has({plan: "pro"});

    const usageTracker = new RateLimiterPrisma({
        storeClient: prisma,
        tableName: "Usage",
        points: hasProAccess ? PRO_POINTS : FREE_POINTS,
        duration: DURATION,
    });

    return usageTracker;
};

export async function consumeCredits() {
    const { userId } = await auth();

    if (!userId) {
        throw new Error("User is not authenticated")
    }

    const usageTracker = await getUsageTracker();
    const result = await usageTracker.consume(userId, GENERATION_COST);

    return result;
};

export async function getUsageStatus() {
    const { userId } = await auth();

    if (!userId) {
        throw new Error("User is not authenticated")
    }

    const usageTracker = await getUsageTracker();
    const result = await usageTracker.get(userId);

    return result;
};