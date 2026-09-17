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
RUN npx --yes create-next-app@16 . --yes

RUN npx --yes shadcn@latest init --yes -b neutral --force
RUN npx --yes shadcn@latest add --all --yes

# Move the Nextjs app to the home directory and remove the nextjs-app directory
RUN mv /home/user/nextjs-app/* /home/user/ && rm -rf /home/user/nextjs-app

# Every RUN above executes as root, so everything under /home/user ends up
# root-owned — while commands issued through the E2B SDK run as `user`.
#
# The symptom is not a permissions error at the point of failure. It is
# `npm run build` dying with `EACCES: permission denied, open
# '/home/user/.next/trace'`, which reads like a broken build rather than a
# broken image, and scored two generations as failures before anyone looked.
RUN chown -R user:user /home/user