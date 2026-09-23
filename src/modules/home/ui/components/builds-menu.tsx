"use client";

/**
 * Past builds, as a navbar menu.
 *
 * WHY IT MOVED OFF THE LANDING PAGE
 *
 * It was a section below the hero, which put it in the worst of both
 * positions: too far down to be a convenient way back into work, and close
 * enough to compete with the claim for attention. A list of your own
 * projects is navigation, not marketing, and navigation belongs in the nav.
 *
 * Reachable from every page now rather than only the home route, which is
 * the actual point — you want it when you are somewhere else.
 *
 * Name and timestamp only. The verdict lives in each project's Evidence
 * tab, where there is room for the compiler output that explains it; a
 * badge here would raise the question and then have nowhere to answer it.
 */

import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import { ChevronDownIcon } from "lucide-react";
import { useUser } from "@clerk/nextjs";

import { useTRPC } from "@/trpc/client";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface Props {
  /**
   * The navbar is transparent over the hero until scrolled, so the trigger
   * cannot use theme colours.
   *
   * IT IS ALWAYS OVER THE INDIGO PANEL, AT EVERY WIDTH.
   *
   * The bar spans the full page while the hero is a two-column split, so
   * its left edge sits over the cream half and its right edge — where this
   * menu and the user control live — sits over the indigo one. On mobile
   * the cream half is hidden and the whole bar is over indigo.
   *
   * So this is cream at all widths. An earlier version mirrored the
   * wordmark's `md:text-ink`, which is correct on the left and wrong here:
   * it put dark ink on a dark purple field from `md` up.
   */
  isScrolled: boolean;
}

export const BuildsMenu = ({ isScrolled }: Props) => {
  const trpc = useTRPC();
  const { user } = useUser();
  const { data: projects } = useQuery({
    ...trpc.projects.getMany.queryOptions(),
    // Signed-out visitors have no builds and the section is hidden for
    // them, so the request is not worth making.
    enabled: !!user,
  });

  if (!user) return null;

  const count = projects?.length ?? 0;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "flex items-center gap-x-1.5 rounded-md px-2 py-1.5 text-sm transition-colors outline-none",
          "focus-visible:ring-2 focus-visible:ring-current/40",
          isScrolled
            ? "text-foreground hover:bg-accent"
            : "text-cream/75 hover:text-cream hover:bg-cream/10",
        )}
      >
        Builds
        {count > 0 && (
          <span className="font-mono text-xs opacity-60">
            {String(count).padStart(2, "0")}
          </span>
        )}
        <ChevronDownIcon className="size-3.5 opacity-60" />
      </DropdownMenuTrigger>

      {/*
        `p-1` on the content, and the row inset comes from the item's own
        padding — so the hover highlight has the same 4px of breathing room
        on all four sides.
      */}
      <DropdownMenuContent align="end" sideOffset={8} className="w-72 p-1">
        {count === 0 ? (
          <p className="px-3 py-6 text-sm text-muted-foreground">
            Nothing built yet.
          </p>
        ) : (
          /*
            Capped and scrollable. `overscroll-contain` stops a scroll that
            reaches the end of the list from chaining into the page behind
            the menu.

            NO `scrollbar-gutter: stable` HERE, deliberately.

            It reserves the scrollbar's width on the right edge whether or
            not a scrollbar exists. In a short list none does, so the gutter
            was pure asymmetry: the hover highlight met the left edge and
            stopped ~15px short of the right. It earns its place in a panel
            whose content grows while you are looking at it, which is why
            the evidence list keeps it; a transient menu is not that.
          */
          <div className="max-h-80 overflow-y-auto overscroll-contain">
            {projects?.map((project, index) => (
              <DropdownMenuItem key={project.id} asChild>
                <Link
                  href={`/projects/${project.id}`}
                  className="flex w-full cursor-pointer items-center gap-x-3 rounded-sm px-3 py-2.5"
                >
                  <span className="w-6 shrink-0 font-mono text-[11px] text-muted-foreground">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">
                      {project.name}
                    </span>
                    <span className="block font-mono text-[11px] text-muted-foreground">
                      {formatDistanceToNow(project.updatedAt, {
                        addSuffix: true,
                      })}
                    </span>
                  </span>
                </Link>
              </DropdownMenuItem>
            ))}
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
