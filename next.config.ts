import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Two suppressions used to live here:
   *
   *   eslint:     { ignoreDuringBuilds: true }
   *   typescript: { ignoreBuildErrors: true }
   *
   * The first is gone because Next 16 removed the built-in `next lint`
   * integration, which is the error that surfaced during the upgrade.
   * Linting now runs as `eslint` directly, from `npm run lint`.
   *
   * The second was removed deliberately. `ignoreBuildErrors` meant every
   * `next build` passed regardless of type errors — which is why the null
   * passed into `projects.create` and the dead `useState(null)` check
   * survived. The first `tsc --noEmit` ever run on this repo found three
   * errors in three files. Now typecheck, lint and test all gate CI, so
   * there is nothing left for a suppression to buy.
   *
   * If a build ever fails on types again, fix the type.
   */
};

export default nextConfig;
