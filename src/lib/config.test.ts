import { describe, expect, it } from "vitest";

import {
  BUILD_CHECK_CWD,
  BUNDLE_COMMAND,
  CHECK_PREPARE_COMMAND,
  TYPECHECK_COMMAND,
} from "./config";

/**
 * Contract tests for the sandbox commands.
 *
 * These strings are shipped to a remote machine and executed. Until now
 * nothing asserted anything about them, so every mistake in one was found
 * by running a 24-case eval batch — roughly thirty minutes and real tokens
 * to discover a flag that no longer exists.
 *
 * Each test below is a bug that already happened. They cost milliseconds
 * and they encode *why* each fix was made, which a string in a config file
 * cannot.
 *
 * See docs/BUILD_PLAN.md: never let an expensive test answer a cheap
 * question.
 */

const ALL_COMMANDS = [CHECK_PREPARE_COMMAND, TYPECHECK_COMMAND, BUNDLE_COMMAND];

describe("bundle command", () => {
  it("does not pass --no-lint", () => {
    // Next 16 removed the built-in lint integration along with the flag.
    // Passing it fails with `unknown option '--no-lint'` before the build
    // starts — and that failure sat at the bottom of a report for a full
    // batch before anyone scrolled to it.
    expect(BUNDLE_COMMAND).not.toContain("--no-lint");
  });

  it("disables telemetry", () => {
    // First-build telemetry phones home over an unreliable sandbox network,
    // producing "Retrying 1/3..." loops that consumed the timeout before
    // the compiler started.
    expect(BUNDLE_COMMAND).toContain("NEXT_TELEMETRY_DISABLED=1");
  });
});

describe("generated next.config", () => {
  it("sets no eslint key", () => {
    // Invalid in Next 16. An unknown config key fails the build, and takes
    // `next typegen` down with it — which leaves the generated types
    // missing and makes the typecheck fail for a reason unrelated to types.
    expect(CHECK_PREPARE_COMMAND).not.toMatch(/eslint\s*:/);
  });

  it("ignores build errors so the bundle step only bundles", () => {
    // Types are measured separately by `tsc --noEmit`. Leaving them on here
    // meant the build spent 11s compiling and then minutes type-checking
    // fifty components the agent never wrote.
    expect(CHECK_PREPARE_COMMAND).toContain("ignoreBuildErrors:true");
  });
});

describe("prepare command", () => {
  it("regenerates Next types in the copy", () => {
    // Next 16 writes `LayoutProps` and friends into `.next/types`, which
    // the copy excludes. Without this, `tsc` failed on every project
    // including "Hello world", and the baseline reported 0% across sixteen
    // runs — a clean, plausible, entirely false result about the agent.
    expect(CHECK_PREPARE_COMMAND).toContain("typegen");
  });

  it("excludes Docker whiteout files", () => {
    // `rm -rf` of a directory from a lower image layer leaves a root-owned
    // `.wh.*` marker that `tar` cannot read as `user`. It took down the
    // copy for eighteen runs of a 24-case batch.
    expect(CHECK_PREPARE_COMMAND).toContain("--exclude='.wh.*'");
  });

  it("excludes node_modules and .next from the tar", () => {
    expect(CHECK_PREPARE_COMMAND).toContain("--exclude=node_modules");
    expect(CHECK_PREPARE_COMMAND).toContain("--exclude=.next");
  });

  it("hardlinks node_modules rather than symlinking it", () => {
    // Turbopack rejects a symlinked node_modules outright —
    // "Symlink [project]/node_modules is invalid, it points out of the
    // filesystem root" — and TypeScript could not resolve through it
    // either, producing `Cannot find module 'lucide-react'` across every
    // shadcn component. Those read exactly like the agent importing
    // packages that were not installed.
    expect(CHECK_PREPARE_COMMAND).toContain("cp -al");
    expect(CHECK_PREPARE_COMMAND).not.toMatch(/ln -s .*node_modules/);
  });

  it("runs typegen from inside the copy", () => {
    // The chain does `cd /home/user` before the tar, so typegen was
    // generating types into /home/user/.next and the copy stayed as empty
    // of them as before. The fix looked correct in the diff and changed
    // nothing.
    const typegenIndex = CHECK_PREPARE_COMMAND.indexOf("typegen");
    const cdIntoCopy = CHECK_PREPARE_COMMAND.indexOf("cd /tmp/datum-build");

    expect(cdIntoCopy).toBeGreaterThan(-1);
    expect(cdIntoCopy).toBeLessThan(typegenIndex);
  });

  it("does not pipe tar into tar", () => {
    // A pipeline reports the exit status of its LAST command, so a failed
    // source tar looked successful, the build ran against a partial copy,
    // and eighteen runs burned the full timeout. Two separate calls, each
    // checked by `&&`.
    expect(CHECK_PREPARE_COMMAND).not.toMatch(/tar cf - .*\|/);
  });
});

describe("all sandbox commands", () => {
  it("operate on the copy, never on the live project", () => {
    // `/home/user/.next` belongs to the dev server serving the user's
    // preview. Building there would destroy the thing they are looking at.
    for (const command of [TYPECHECK_COMMAND, BUNDLE_COMMAND]) {
      expect(command).toContain("/tmp/datum-build");
    }
  });

  it("invoke binaries by path, never through npx", () => {
    // With node_modules symlinked, `npx next` can miss local resolution and
    // go to the registry — over the same unreliable network that produced
    // the retry loops. The symptom was a 240s timeout whose entire captured
    // output was one warning line.
    //
    // The prepare step is exempt: it runs `next typegen` by path too, but
    // the exclusion check below would false-positive on `--exclude=`.
    for (const command of ALL_COMMANDS) {
      expect(command).not.toMatch(/\bnpx\b/);
    }
  });

  it("run as a single shell chain that stops on first failure", () => {
    // `;` as a separator would let a failed copy be followed by a build
    // against whatever happened to be there.
    //
    // Quoted content is stripped before the check. The first version of
    // this test scanned the raw string and flagged the `;` inside
    // `printf 'export default c;'` — a character in a literal, not a shell
    // separator. A test blunt enough to misread its own subject reports a
    // failure that is about the test.
    const withoutLiterals = CHECK_PREPARE_COMMAND.replace(/'[^']*'/g, "''");

    expect(CHECK_PREPARE_COMMAND).toContain("&&");
    expect(withoutLiterals).not.toContain(";");
  });

  it("start from the project root", () => {
    expect(BUILD_CHECK_CWD).toBe("/home/user");
  });
});
