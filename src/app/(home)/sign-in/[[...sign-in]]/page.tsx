"use client"

import { SignIn } from "@clerk/nextjs";
import { dark } from "@clerk/themes";
import { useCurrentTheme } from "@/hooks/use-current-theme";

/**
 * Sign in.
 *
 * Split like the hero: the claim on cream, the form on indigo. An auth page
 * is where a visitor decides whether the thing is worth an account, and the
 * default centred card says nothing while they decide.
 *
 * Clerk's card is themed through `appearance` rather than className, since
 * its internals are not ours to style. Squared to match the layout
 * language; the controls inside it keep their own radius.
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
                    Generated code,
                    <br />
                    actually checked.
                </h1>
                <p className="display-lead mt-6 max-w-md text-ink/70">
                    Every generation is type-checked and bundled in a sandbox
                    before it claims to work, and the failure rate is measured
                    rather than assumed.
                </p>
            </div>

            <div className="flex min-h-dvh items-center justify-center bg-indigo px-6 py-24">
                <SignIn
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
