"use client";

import Link from "next/link";
import { SignedIn, SignedOut, SignInButton, SignUpButton } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";
import { UserControl } from "@/components/user-control";
import { BuildsMenu } from "./builds-menu";
import { useScroll } from "@/hooks/use-scroll";
import { cn } from "@/lib/utils";

/**
 * Navbar.
 *
 * WHAT WAS WRONG
 *
 * It was `fixed` with a `max-w-5xl` inner container, so on a wide screen
 * the wordmark floated somewhere near the middle of the page rather than
 * sitting in a corner, and it overlapped the hero headline — the first line
 * of "Generated code, actually checked" rendered underneath it.
 *
 * Now it spans the full width with its own gutter, matching the hero's
 * edge-to-edge panels, and the hero reserves height for it.
 *
 * The wordmark carries no logo mark. The old one was a coloured glyph from
 * the tutorial that belongs to neither this palette nor this name; a
 * wordmark set in the display face, with the terminating period, is the
 * identity until there is a real mark to use.
 */
export const Navbar = () => {
    const isScrolled = useScroll();

    return (
        <nav
            className={cn(
                "fixed top-0 left-0 right-0 z-40 h-16 flex items-center",
                "border-b border-transparent transition-colors duration-200",
                // Transparent over the hero so the split reads as one
                // surface; solid once the page moves under it.
                isScrolled && "bg-background/90 backdrop-blur border-border",
            )}
        >
            <div className="flex w-full items-center justify-between px-6 md:px-8">
                {/*
                  The wordmark sits over two different fixed-colour panels
                  depending on width: the indigo one on a phone (where the
                  cream half is hidden) and the cream one from `md` up. It
                  cannot use `text-foreground`, which follows the theme —
                  in dark mode that resolved to cream, rendering the
                  wordmark invisible against the cream panel.

                  Once scrolled, the bar has its own themed background, so
                  the theme colour is correct again.
                */}
                <Link href="/" className="flex items-center">
                    <span
                        className={cn(
                            "font-sans text-lg font-bold tracking-tight transition-colors",
                            isScrolled ? "text-foreground" : "text-cream md:text-ink",
                        )}
                    >
                        datum
                        <span
                            className={cn(
                                isScrolled
                                    ? "text-primary"
                                    : "text-cream/50 md:text-indigo",
                            )}
                        >
                            .
                        </span>
                    </span>
                </Link>

                <SignedOut>
                    <div className="flex gap-2">
                        <SignUpButton>
                            <Button variant="outline" size="sm">
                                Sign up
                            </Button>
                        </SignUpButton>
                        <SignInButton>
                            <Button size="sm">
                                Sign in
                            </Button>
                        </SignInButton>
                    </div>
                </SignedOut>
                <SignedIn>
                    <div className="flex items-center gap-x-2">
                        <BuildsMenu isScrolled={isScrolled} />
                        <UserControl showName />
                    </div>
                </SignedIn>
            </div>
        </nav>
    );
};
