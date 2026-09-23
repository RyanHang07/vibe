import { ProjectForm } from "@/modules/home/ui/components/project-form";
import { ClaimPanel } from "@/modules/home/ui/components/claim-panel";
import { MobileClaim } from "@/modules/home/ui/components/mobile-claim";
import { IntroCurtain } from "@/modules/home/ui/components/intro-curtain";

/**
 * The split hero.
 *
 * Left: the claim at display size, on cream. Right: a full-bleed indigo
 * panel carrying the input. Edge to edge, zero radius on the panels
 * themselves — the structure the reference site uses.
 *
 * BOTH PANELS ARE FIXED-COLOUR SURFACES.
 *
 * They do not follow the theme, so everything inside them sets its own
 * foreground. Relying on `text-foreground` here put cream text on a cream
 * panel the moment the system preferred dark.
 *
 * MOBILE
 *
 * The left panel is hidden below `md`, so the indigo panel carries the
 * identity on a phone: wordmark, full-bleed colour, and one condensed line
 * of the figure rather than dropping the argument entirely.
 */
const Page = () => {
  return (
    <>
      <IntroCurtain />

      {/*
        `dvh`, not `vh`.

        On a phone, `100vh` is the viewport with the browser chrome
        *expanded*, so the panel is taller than the visible area and the
        layout jumps as the URL bar collapses on scroll. `dvh` tracks the
        dynamic viewport and settles.
      */}
      <section className="grid grid-cols-1 md:grid-cols-2">
        {/*
          Left: cream, the claim. Desktop only.

          `block`, not `flex`, and the containment context lives HERE rather
          than on the panel inside it.

          The previous version made this a flex container and `ClaimPanel`
          a flex item that also declared `container-type`. That is circular:
          the item's width came from its content, the content's font size
          came from `cqi`, and `cqi` came from the item's width. Flex
          resolved it by shrinking the item to min-content, so every line of
          the claim wrapped after a single word.

          The css-layout guide states the rule directly: do not size a
          container and its children to fill each other — give one side a
          definite size. A grid track is definite, so the context belongs on
          the track.
        */}
        <div className="@container hidden md:block md:min-h-dvh bg-cream">
          <ClaimPanel />
        </div>

        {/* Right: indigo, the input. Its own containment context, so the
            headline scales with the panel rather than the window. */}
        <div className="@container min-h-dvh bg-indigo">
          <div className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center px-6 pt-24 pb-16 md:px-10">
            <div className="md:hidden mb-10">
              <MobileClaim />
            </div>

            <h1 className="display-head font-sans font-bold text-cream">
              Generated code,
              <br />
              actually checked.
            </h1>

            <p className="display-lead mt-6 max-w-md text-cream/65">
              Describe an app. Datum builds it in a sandbox, then type-checks
              and bundles the result before telling you it works.
            </p>

            <div className="mt-10">
              <ProjectForm />
            </div>
          </div>
        </div>
      </section>

      {/*
        The builds list used to sit here, below the fold.

        It has moved into the navbar (`BuildsMenu`). It was in the worst of
        both positions: too far down to be a convenient way back into work,
        and close enough to compete with the claim for attention. A list of
        your own projects is navigation, not marketing.

        The page is now exactly one screen — the hero — with nothing below
        it. Signed-out visitors see the same thing, which is the intent:
        the claim is the whole landing page.
      */}
    </>
  );
};

export default Page;
