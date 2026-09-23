import { Navbar } from "@/modules/home/ui/components/navbar";

interface Props {
    children: React.ReactNode;
};

/**
 * Home layout.
 *
 * THREE THINGS WERE WRONG HERE AND EACH SHOWED UP SOMEWHERE ELSE
 *
 *   1. `max-h-screen` capped the page at the viewport, so anything below
 *      the hero was clipped rather than scrolled to.
 *   2. `flex=col` — a typo, not a class. It silently did nothing, which is
 *      why it survived.
 *   3. `px-4 pb-4` put a gutter around every page, so a full-bleed panel
 *      could not reach the edge of the screen. The indigo half of the hero
 *      stopped short on the right and the seam showed.
 *
 * Gutters now belong to the page, not the layout. A landing page that runs
 * edge to edge and a settings page that does not are different layouts, and
 * the wrapper should not assume one of them.
 */
const Layout = ({ children }: Props) => {
    return (
        <div className="flex min-h-screen flex-col bg-background">
            <Navbar />
            {/*
              No dotted background. It was a texture borrowed from the
              tutorial and it fought the flat colour panels — the reference
              this design follows uses solid fields and nothing else.
            */}
            <main className="flex-1">
                {children}
            </main>
        </div>
    )
};

export default Layout
