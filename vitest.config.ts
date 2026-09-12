import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    // Deliberately `node`, not `jsdom`. Every test here is pure.
    //
    // A jsdom environment nothing uses is a dependency that can stop the
    // suite starting for reasons unrelated to any test — see
    // solarity/docs/patterns.md, "A dependency the tests do not use should
    // not be able to stop them running". Add jsdom only when a test needs
    // a DOM, and say so in the commit.
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    clearMocks: true,
    restoreMocks: true,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
