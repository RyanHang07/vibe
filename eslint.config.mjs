import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

/**
 * Next 16 ships `eslint-config-next` as native flat config — both subpaths
 * export `Linter.Config[]` directly.
 *
 * The previous version of this file wrapped them in `FlatCompat`, which is
 * the eslintrc-to-flat shim from the Next 15 scaffold. Feeding a native flat
 * config through it crashes: the legacy validator calls JSON.stringify on a
 * plugin object whose `plugins.react` references itself, and the error
 * surfaces as "Converting circular structure to JSON" with no mention of
 * eslint-config-next.
 *
 * Spread the arrays instead. `@eslint/eslintrc` is now unused and can come
 * out of devDependencies.
 */
const config = [
  {
    ignores: [
      ".next/**",
      "out/**",
      "build/**",
      // Prisma client output. Thousands of lines of generated JS that no
      // lint rule has an opinion worth hearing about.
      "src/generated/**",
      "next-env.d.ts",
    ],
  },
  ...coreWebVitals,
  ...typescript,
];

export default config;
