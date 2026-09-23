"use client"

import { MessagesContainer } from "../components/messages-container";
import { Suspense, useState } from "react";
import { Fragment } from "@/generated/prisma";
import { ProjectHeader } from "../components/project-header";
import { FragmentWeb } from "../components/fragment-web";
import {
    EyeIcon,
    CodeIcon,
    ClipboardCheckIcon,
    MessagesSquareIcon,
} from "lucide-react";
import { FileExplorer } from "@/components/file-explorer";
import { UserControl } from "@/components/user-control";
import { EvidencePanel } from "../components/evidence-panel";
import { useIsMobile } from "@/hooks/use-mobile";

import {
    Tabs,
    TabsContent,
    TabsList,
    TabsTrigger,
} from "@/components/ui/tabs";

import {
    ResizableHandle,
    ResizablePanel,
    ResizablePanelGroup,
} from "@/components/ui/resizable";
import { ErrorBoundary } from "react-error-boundary";

interface Props {
    projectId: string;
};

type Pane = "chat" | "preview" | "code" | "evidence";

/**
 * The project workspace.
 *
 * DESKTOP: a resizable two-pane split — conversation on the left, output on
 * the right behind three tabs.
 *
 * MOBILE: one column, four tabs. The horizontal split does not survive a
 * phone; at 375px each half would be under 190px, which is narrower than a
 * single line of the compiler output the evidence tab exists to show.
 *
 * WHY A JS BREAKPOINT RATHER THAN CSS
 *
 * `ResizablePanelGroup` sizes its panels with inline percentage styles, so
 * it cannot be stacked with a media query without fighting it. The obvious
 * alternative — rendering both layouts and hiding one — is worse than it
 * looks here: `FragmentWeb` is an iframe pointed at a live sandbox, and
 * mounting it twice loads the sandbox twice.
 *
 * `useIsMobile` uses `useSyncExternalStore`, so it reads the real value
 * during the first client render rather than correcting itself in an
 * effect. Its server snapshot is `false`, which means a phone briefly gets
 * the desktop shell in the server HTML — acceptable, and the alternative
 * (guessing mobile) would be wrong far more often.
 */
export const ProjectView = ({ projectId }: Props) => {
    const [activeFragment, setActiveFragment] = useState<Fragment | null>(null);
    const isMobile = useIsMobile();

    // Mobile opens on the conversation, because that is where you act.
    // Desktop opens on the preview, because the conversation is already
    // visible in the other pane.
    const [pane, setPane] = useState<Pane>("preview");
    const activePane: Pane = isMobile && pane === "chat" ? "chat" : pane;

    const conversation = (
        <ErrorBoundary fallback={<p className="p-4 text-sm">Something went wrong</p>}>
            <Suspense fallback={<div className="p-4 text-sm text-muted-foreground">Loading messages…</div>}>
                <MessagesContainer
                    projectId={projectId}
                    activeFragment={activeFragment}
                    setActiveFragment={setActiveFragment}
                />
            </Suspense>
        </ErrorBoundary>
    );

    const header = (
        <ErrorBoundary fallback={<p className="p-4 text-sm">Something went wrong</p>}>
            <Suspense fallback={<div className="p-4 text-sm text-muted-foreground">Loading project…</div>}>
                <ProjectHeader projectId={projectId} />
            </Suspense>
        </ErrorBoundary>
    );

    const outputTabs = (
        <div className="flex w-full items-center gap-x-2 border-b p-2">
            {/*
              The selected tab takes the indigo, which is the one place in
              the workspace the accent appears. Used sparingly it reads as
              a system; used everywhere it reads as decoration.
            */}
            <TabsList className="h-9 rounded-md border bg-transparent p-0 [&_[data-state=active]]:bg-primary [&_[data-state=active]]:text-primary-foreground">
                {/*
                  Chat is a tab only on mobile. On desktop it is the left
                  pane, and offering it in both places would let the user
                  select a tab that changes nothing.
                */}
                {isMobile && (
                    <TabsTrigger value="chat" className="rounded-md">
                        <MessagesSquareIcon /> <span>Chat</span>
                    </TabsTrigger>
                )}
                <TabsTrigger value="preview" className="rounded-md">
                    <EyeIcon /> <span>Demo</span>
                </TabsTrigger>
                <TabsTrigger value="code" className="rounded-md">
                    <CodeIcon /> <span>Code</span>
                </TabsTrigger>
                <TabsTrigger value="evidence" className="rounded-md">
                    <ClipboardCheckIcon /> <span>Evidence</span>
                </TabsTrigger>
            </TabsList>
            <div className="ml-auto flex items-center gap-x-2">
                <UserControl />
            </div>
        </div>
    );

    const outputPanes = (
        <>
            {isMobile && (
                <TabsContent value="chat" className="min-h-0 flex-1">
                    {conversation}
                </TabsContent>
            )}
            <TabsContent value="preview" className="min-h-0 flex-1">
                {!!activeFragment && <FragmentWeb data={activeFragment} />}
            </TabsContent>
            <TabsContent value="code" className="min-h-0 flex-1">
                {!!activeFragment?.files && (
                    <FileExplorer
                        files={activeFragment.files as { [path: string]: string }}
                    />
                )}
            </TabsContent>
            <TabsContent value="evidence" className="min-h-0 flex-1">
                <EvidencePanel projectId={projectId} />
            </TabsContent>
        </>
    );

    /* ---- mobile: one column, four tabs ---- */

    if (isMobile) {
        return (
            // `dvh`, not `vh` — the browser chrome collapses on scroll and a
            // `100vh` column would stand taller than the visible area.
            <div className="flex h-dvh flex-col">
                {header}
                <Tabs
                    className="flex min-h-0 flex-1 flex-col gap-y-0"
                    value={activePane}
                    onValueChange={(value) => setPane(value as Pane)}
                >
                    {outputTabs}
                    {outputPanes}
                </Tabs>
            </div>
        );
    }

    /* ---- desktop: resizable split ---- */

    return (
        <div className="h-dvh">
            <ResizablePanelGroup direction="horizontal">
                {/*
                  Two-tone, like the hero.

                  The workspace was a single flat surface with everything on
                  `--background`, which is why the new palette did not read
                  as a change here: the tokens moved, but nothing in the
                  layout used the contrast between them.

                  The conversation sits on `--sidebar` (cream-deep in light,
                  a lifted near-black in dark) and the output on
                  `--background`. Same relationship as the split hero, which
                  makes the two pages recognisably the same product.
                */}
                <ResizablePanel
                    defaultSize={35}
                    minSize={20}
                    className="flex min-h-0 flex-col bg-sidebar"
                >
                    {header}
                    {conversation}
                </ResizablePanel>
                <ResizableHandle className="transition-colors hover:bg-primary" />
                <ResizablePanel defaultSize={65} minSize={40}>
                    <Tabs
                        className="flex h-full flex-col gap-y-0"
                        value={activePane}
                        onValueChange={(value) => setPane(value as Pane)}
                    >
                        {outputTabs}
                        {outputPanes}
                    </Tabs>
                </ResizablePanel>
            </ResizablePanelGroup>
        </div>
    );
};
