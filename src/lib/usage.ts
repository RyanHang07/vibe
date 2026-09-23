import { RateLimiterPrisma } from "rate-limiter-flexible";
import { prisma } from "./db";
import { auth } from "@clerk/nextjs/server";


/**
 * The allowances themselves live in `lib/plans.ts`, which imports nothing
 * server-only, so the pricing page can quote them without pulling Prisma
 * and Clerk's server SDK into the browser bundle. Re-exported here so
 * existing server-side imports keep working.
 */
export {
  FREE_POINTS,
  PRO_POINTS,
  DURATION,
  GENERATION_COST,
} from "./plans";

import { DURATION, FREE_POINTS, GENERATION_COST, PRO_POINTS } from "./plans";

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

/**
 * AUDIT S7: the out-of-credits branch was correct by accident.
 *
 * Call sites did this:
 *
 *     catch (error) {
 *       if (error instanceof Error) → "Something went wrong"
 *       else                        → "You have run out of credits"
 *     }
 *
 * It worked, for a reason nobody wrote down: `rate-limiter-flexible`
 * rejects with a plain `RateLimiterRes` object when the limit is hit, and
 * with a real `Error` when something actually breaks. So "not an Error"
 * happened to mean "rate limited".
 *
 * That is a load-bearing assumption about a third-party library's rejection
 * type, inferred from behaviour and enforced nowhere. The day
 * `RateLimiterRes` gains an `Error` base — a change its authors would
 * reasonably consider an improvement — every out-of-credits response
 * silently becomes "Something went wrong", and the user is told the app is
 * broken instead of being sent to the pricing page.
 *
 * So the distinction is made explicitly, by shape, and turned into a named
 * error the call sites can match on.
 */
export class OutOfCreditsError extends Error {
    /** How long until the window resets, from the limiter. */
    readonly msBeforeNext: number;

    constructor(msBeforeNext: number) {
        super("You have run out of credits");
        this.name = "OutOfCreditsError";
        this.msBeforeNext = msBeforeNext;
    }
}

/**
 * Identified by what it carries rather than by what it is not.
 *
 * `msBeforeNext` and `remainingPoints` are the fields that make a rejection
 * a rate-limit result; an internal failure has neither. This holds whether
 * or not the library ever changes the rejection's prototype.
 */
const isRateLimitRejection = (
    value: unknown,
): value is { msBeforeNext: number } =>
    typeof value === "object" &&
    value !== null &&
    "msBeforeNext" in value &&
    "remainingPoints" in value;

export async function consumeCredits() {
    const { userId } = await auth();

    if (!userId) {
        throw new Error("User is not authenticated")
    }

    const usageTracker = await getUsageTracker();

    try {
        return await usageTracker.consume(userId, GENERATION_COST);
    } catch (error) {
        if (isRateLimitRejection(error)) {
            throw new OutOfCreditsError(error.msBeforeNext);
        }

        // A genuine failure — database down, table missing. Rethrown as
        // itself rather than flattened into the credits case, so the call
        // site can tell a broken app from a spent allowance.
        throw error;
    }
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