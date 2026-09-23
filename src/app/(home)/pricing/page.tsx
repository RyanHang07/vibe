"use client"

import { PricingTable } from "@clerk/nextjs"
import { dark } from "@clerk/themes"
import { useCurrentTheme } from "@/hooks/use-current-theme"
import { FREE_POINTS, PRO_POINTS } from "@/lib/plans"

/**
 * Pricing.
 *
 * WHAT THE COPY HAD TO CHANGE, NOT JUST HOW IT LOOKS
 *
 * "Choose the plan that fits your needs" describes a product where the plan
 * decides what you can do. That is no longer what these plans are.
 *
 * This deployment has no provider key of its own, so every user brings
 * theirs and pays their own provider for every token. What a plan buys is
 * sandbox runs: each generation creates an E2B sandbox at 4 GB and 4 CPUs,
 * and that cost is ours whoever's key ran the model.
 *
 * So the page says that. A pricing page that implies you are paying for
 * model access, when you are separately paying Anthropic for model access,
 * is the kind of untruth this project keeps finding in its own copy.
 *
 * The numbers are imported from `lib/usage` rather than typed here. Those
 * constants already shipped inverted once — FREE at 10000 against PRO at
 * 100, with a comment claiming otherwise (AUDIT S2). A marketing page
 * quoting its own hardcoded figures is a second place for that to go wrong,
 * and the one nobody thinks to check.
 */
const Page = () => {
    const currentTheme = useCurrentTheme();

    return (
        <div className="min-h-dvh bg-cream">
            <div className="@container mx-auto w-full max-w-4xl px-6 pt-32 pb-20 md:px-10">
                <p className="font-mono text-xs uppercase tracking-widest text-ink/50">
                    Plans
                </p>

                <h1 className="display-head mt-4 font-sans font-bold text-ink">
                    You bring the key.
                    <br />
                    We run the sandboxes.
                </h1>

                <p className="display-lead mt-6 max-w-xl text-ink/70">
                    Generations run on your own provider key and are billed to
                    your account. A plan covers the sandbox each generation
                    builds and is checked in — {FREE_POINTS} a month on the
                    free plan, {PRO_POINTS} on pro.
                </p>

                <div className="mt-14">
                    <PricingTable
                        appearance={{
                            baseTheme: currentTheme === "dark" ? dark : undefined,
                            elements: {
                                // Square, matching the layout language.
                                // Controls keep their radius; surfaces do not.
                                pricingTableCard:
                                    "border! shadow-none! rounded-none!",
                            },
                        }}
                    />
                </div>

                {/*
                  The second sentence used to read "Runs that fail to produce
                  anything are not counted against your plan." It is not true:
                  `consumeCredits()` runs before the generation is dispatched,
                  so a run that fails still spends its credit.

                  Writing the reassuring version would have been the easiest
                  false claim on the site to get away with — nobody audits a
                  pricing footnote. Saying what the code does instead.
                */}
                <p className="mt-10 max-w-xl text-sm text-ink/55">
                    Every generation is type-checked and bundled in its sandbox
                    before it reports success. A run spends its credit when it
                    starts, so a generation that fails still counts — the
                    sandbox was created either way.
                </p>
            </div>
        </div>
    )
}

export default Page;
