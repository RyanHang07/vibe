# You can use most Debian-based base images
FROM node:22-slim

# Install curl
RUN apt-get update && apt-get install -y curl && apt-get clean && rm -rf /var/lib/apt/lists/*

COPY compile_page.sh /compile_page.sh
RUN chmod +x /compile_page.sh

# Install dependencies and customize sandbox
#
# NOTE: this WORKDIR creates /home/user/nextjs-app in its own image layer,
# and the `rm -rf` further down deletes it in a later one. OverlayFS records
# that deletion as a root-owned whiteout marker, `.wh.nextjs-app`, which
# survives in the running sandbox and cannot be read by `user`.
#
# Anything that walks /home/user — `tar`, `cp -a`, `find` — trips over it
# and exits non-zero. That cost eighteen runs of a 24-case batch.
#
# Doing the scaffold and the move inside a single RUN would avoid creating
# the whiteout at all. Left alone for now because changing the template
# means rebuilding and republishing it, and the build check already excludes
# `.wh.*`.
WORKDIR /home/user/nextjs-app

# The agent generates code for whatever version lives here, not whatever the
# host app uses, so this pin is the real target — it decides what "correct
# output" means.
#
# Bumped from 15.3.3 to 16 deliberately *before* the baseline, so the
# baseline measures a current target rather than a stale one. That makes the
# bump a prerequisite rather than a measured intervention.
#
# VERIFY ONE GENERATION BUILDS BEFORE RUNNING A BATCH. shadcn's components
# may not be compatible with Next 16 at this pin, and a template that cannot
# build turns every case into an infrastructure fault.
# EVERY VERSION HERE IS PINNED, AND MUST STAY PINNED.
#
# This template is the measurement target: the agent generates code for
# whatever lives in it, so the template defines what "correct output" means.
# `@latest` would mean two builds a month apart produce different targets,
# and a baseline taken against one would not be comparable to a batch taken
# against the other — with nothing anywhere recording that the target moved.
#
# An unpinned dependency in a measurement instrument is the same error as an
# unpinned dependency in a test fixture, and harder to notice.
#
# The `-b neutral` flag is gone, deliberately rather than by version-chasing.
#
# shadcn repurposed `-b` from base colour to the primitive library
# (`radix | base | aria`), so `-b neutral` is now invalid. The CLI's own
# error suggests the previous release, which then suggests the one before
# it — following that walks backwards one version at a time.
#
# The base colour is a theming default. It has no effect on whether
# generated code typechecks or bundles, which is the only thing measured
# here. A flag that cannot change the result is not worth pinning a
# toolchain to.
RUN npx --yes create-next-app@16 . --yes

# shadcn held at 2.6.3, which is the version this template used successfully
# for months. The move to 4.x was a side effect of an unrelated change, not a
# decision, and 4.x turned out to prompt interactively for things `--yes`
# does not cover — component library, then preset, then presumably more.
#
# A Docker build cannot answer a prompt. It hangs until something kills it,
# and the log shows a menu rather than an error.
#
# 2.6.3 is Radix-based, which also happens to be the right target for
# generation: shadcn was Radix-based for its entire popular history, so
# nearly all shadcn code in a model's training data is Radix code. Base UI
# is newer and the agent has seen far less of it. Generating against an API
# the model barely knows would make every resulting failure a consequence of
# this line rather than of anything about the agent.
#
# Upgrading shadcn is a real change to the measurement target and belongs in
# its own commit. The flag set for 4.x, worked out from `init --help` rather
# than discovered one prompt at a time:
#
#   npx --yes shadcn@4.20.0 init --yes --force \
#     -t next            # template; otherwise prompts
#     -b radix           # component library; `--yes` does NOT supply this
#     -p nova            # preset; otherwise prompts
#     --no-monorepo      # otherwise prompts
#
# Four prompts, not one. `--yes` suppresses the confirmation step only.
#
# Unverified: `--defaults` documents its preset as `base-nova`, so preset
# names may be `<base>-<preset>` — in which case `-p radix-nova` is correct
# and `-p nova` prompts again. Check against `--help` on the day.
#
# `-d/--defaults` is the one-flag escape hatch, but it pins `--preset=base-nova`,
# which means Base UI — the library the model has seen least of.
RUN npx --yes shadcn@2.6.3 init --yes -b neutral --force

# AN EXPLICIT LIST, NOT `--all`.
#
# `add --all` asks the remote registry what exists *today* and installs that.
# Pinning the CLI never pinned the component set, because the set lives on a
# server. It broke exactly that way: shadcn@2.6.3 asked for `questionnaire`,
# a component added to the registry after 2.6.3 shipped, and could not fetch
# it — a pinned client defeated by an unpinned remote.
#
# Three problems, one fix:
#
#   1. REPRODUCIBILITY. This template defines what "correct output" means.
#      With `--all`, two builds a month apart produce different targets and
#      nothing records that the target moved.
#   2. THE LONG POLE. `--all` installed roughly fifty components. Type
#      checking them is what made `tsc --noEmit` the slowest step in every
#      check — and none of it is code the agent wrote.
#   3. IT IS BROKEN. `--all` does not currently work at this pin at all.
#
# The list is a judgement about what a generated app plausibly reaches for.
# Too few and the agent imports components that do not exist; too many and
# every check pays for code nobody uses. That tradeoff is measurable, and
# worth revisiting as its own intervention once a baseline exists.
# The registry now serves shadcn 4.x-era component source, while the pinned
# 2.6.3 CLI installs the dependencies *it* knows about. The result is
# component files importing packages that were never installed:
#
#   lucide-react, class-variance-authority, tw-animate-css
#
# while `radix-ui` and `cn` — 4.x conventions — arrive instead.
#
# Doctor found this on an untouched project: 314 packages in both the source
# and the copy, and none of the three present in either. Without that, it
# would have read as the agent importing packages that do not exist.
#
# This line is a patch over a version mismatch, not a fix for it. The real
# fix is to use the CLI that matches the registry — see the 4.x flag set
# documented above — and that belongs in its own change, verified with
# `npm run doctor` before any batch.
#
# PINNED, BECAUSE UNPINNED COST A CASE.
#
# This line read `npm install lucide-react class-variance-authority
# tw-animate-css` — no versions — sitting directly beneath a comment
# declaring that every version here is pinned. Fourth instance of the same
# pattern in this file.
#
# What it cost: a smoke run failed on
#
#   The export Linkedin was not found in module lucide-react
#
# lucide deprecated its brand icons and later removed them. `Linkedin`,
# `Github` and `Twitter` were valid for most of lucide's history, so they
# are abundant in training data and any model asked for a portfolio page
# with social links will reach for them.
#
# Whether that generation is "wrong" therefore depends entirely on which
# lucide version this line happened to install on the day the image was
# built. The template id pins the built image, so a given batch is
# reproducible — but the target was never *known*, and the next rebuild
# would have moved it silently.
#
# That is the difference between an agent failure and a moving target, and
# an unpinned install makes it unanswerable after the fact.
#
# `clsx` and `tailwind-merge` join the list for the same reason the other
# three are here: shadcn's `cn` helper is `twMerge(clsx(...))`, the registry
# ships component files that import it, and the pinned 2.6.3 CLI does not
# install either. `create-next-app` does not either.
#
# `npm run shapes` over 80 runs found this as
#
#   TS2307: Cannot find module 'tailwind-merge'
#
# on 4 runs across complex-02, complex-03 and moderate-05 — every one of
# which was being counted as a generated-code failure. It is a missing
# dependency in the measurement target.
#
# Together with the 3 lucide brand-icon failures below, that is 7 of 26
# code failures, roughly a quarter of the v3 failure set, attributable to
# the template rather than to anything the agent did.
RUN npm install \
      lucide-react@0.525.0 \
      class-variance-authority@0.7.1 \
      tw-animate-css@1.3.5 \
      clsx@2.1.1 \
      tailwind-merge@3.3.1

RUN npx --yes shadcn@2.6.3 add --yes \
    accordion alert avatar badge button calendar card checkbox \
    command dialog dropdown-menu form input label popover progress \
    radio-group scroll-area select separator sheet skeleton slider \
    sonner switch table tabs textarea tooltip

# WRITE `lib/utils.ts` OURSELVES. The CLI did not.
#
# `npm run doctor` reported it missing from the template — source:NO,
# copy:NO — on an otherwise green harness. Every shadcn component imports
# `cn` from `@/lib/utils`, and so does almost every generated component,
# because that is what a shadcn project looks like everywhere a model has
# ever seen one.
#
# What it cost: `TS2307: Cannot find module '@/lib/utils'` on moderate-05
# under v5, and a Turbopack `module-not-found` on the same import under v6,
# both scored as bad generations. The agent was writing the only correct
# thing available to it.
#
# Why it was missing is the interesting part. `shadcn init` normally
# creates this file; `components.json` and the `@/*` tsconfig path both
# landed, so init clearly ran. The 2.6.3 CLI against the current registry
# does not produce the same filesystem it did when 2.6.3 shipped — the
# fourth instance in this file of a pinned client defeated by an unpinned
# remote, and the first where the missing piece was a file rather than a
# package.
#
# So it is written here rather than requested from a tool. A file this
# template depends on should not arrive as a side effect of a CLI whose
# behaviour changes underneath the pin.
#
# NO BACKSLASH ESCAPES IN THE CONTENT. One `echo` per line, appended.
#
# The first attempt used `printf '%s\n' 'line' 'line' … > lib/utils.ts`.
# The file arrived as a single line — `tsc` reported six syntax errors all
# on line 1, at columns up to 338 — because the `\n` did not survive the
# trip through the Dockerfile parser and the shell to printf's format
# string. Which layer ate it does not much matter; relying on it was the
# mistake.
#
# A heredoc is the obvious alternative and needs BuildKit syntax this file
# does not declare, failing confusingly when it is absent.
#
# `echo` per line has no escapes to lose: each one contributes its own
# newline and nothing has to be interpreted. Ugly, and it cannot go wrong
# in a way that produces a file which looks written and is not.
#
# Worth noting that `doctor` caught this on the next run, for one sandbox
# and zero tokens. A batch would have reported the same syntax error as
# twenty-four failed generations.
RUN mkdir -p lib \
 && echo '// Written by the sandbox template, not by `shadcn init`, which' > lib/utils.ts \
 && echo '// stopped producing this file. See e2b.Dockerfile.' >> lib/utils.ts \
 && echo 'import { clsx, type ClassValue } from "clsx"' >> lib/utils.ts \
 && echo 'import { twMerge } from "tailwind-merge"' >> lib/utils.ts \
 && echo '' >> lib/utils.ts \
 && echo 'export function cn(...inputs: ClassValue[]) {' >> lib/utils.ts \
 && echo '  return twMerge(clsx(inputs))' >> lib/utils.ts \
 && echo '}' >> lib/utils.ts \
 && cat lib/utils.ts

# WORKDIR moves out of nextjs-app BEFORE that directory is deleted.
#
# Without this the build fails on the next RUN with
# `cwd '/home/user/nextjs-app' does not exist` — an error about the working
# directory, reported against whatever command happened to run next. The
# command named in the failure has nothing to do with the cause.
WORKDIR /home/user

# Move the app up, drop the scaffold directory, and fix ownership — one RUN,
# because they are one operation.
#
# The chown matters more than it looks. Every RUN above executes as root, so
# everything under /home/user ends up root-owned, while commands issued
# through the E2B SDK run as `user`. The symptom is not a permissions error
# at the point of failure: it is `npm run build` dying with
# `EACCES: permission denied, open '/home/user/.next/trace'`, which reads
# like a broken build rather than a broken image. Two generations were
# scored as failures on that before anyone looked.
RUN mv /home/user/nextjs-app/* /home/user/ \
 && rm -rf /home/user/nextjs-app \
 && chown -R user:user /home/user