"use client"

import { SignUp } from "@clerk/nextjs";
import { dark } from "@clerk/themes";
import { useCurrentTheme } from "@/hooks/use-current-theme";
import { FREE_POINTS } from "@/lib/plans";

/**
 * Sign up.
 *
 * Same split as sign-in, with copy that answers the two questions a new
 * account actually has: what do I get, and what will this cost me.
 *
 * The second one has an unusual answer here and is better said up front
 * than discovered at the first generation: this deployment has no provider
 * key of its own, so generations run on the user's key and are billed to
 * their provider account.
 */
const Page = () => {
    const currentTheme = useCurrentTheme();

    return (
        <div className="grid min-h-dvh grid-cols-1 md:grid-cols-2">
            <div className="@container hidden md:flex md:flex-col md:justify-center bg-cream px-10 pt-24 pb-12 lg:px-14">
                <p className="font-mono text-xs uppercase tracking-widest text-ink/50">
                    Datum
                </p>
                <h1 className="display-head mt-4 font-sans font-bold text-ink">
                    Start building.
                </h1>
                <p className="display-lead mt-6 max-w-md text-ink/70">
                    {FREE_POINTS} sandbox generations a month on the free plan,
                    each one type-checked and bundled before it reports
                    success.
                </p>
                <p className="mt-8 max-w-md border-l-2 border-ink/15 pl-4 text-sm text-ink/60">
                    You will need your own Anthropic or OpenAI API key.
                    Generations run on it and are billed to your provider
                    account; the key is encrypted in transit and never stored.
                </p>
            </div>

            <div className="flex min-h-dvh items-center justify-center bg-indigo px-6 py-24">
                <SignUp
                    appearance={{
                        baseTheme: currentTheme === "dark" ? dark : undefined,
                        elements: {
                            cardBox: "border! shadow-none! rounded-none!",
                        },
                    }}
                />
            </div>
        </div>
    )
}

export default Page
