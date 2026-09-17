import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The sandbox is stubbed. What matters is the decision logic: when a check
 * counts as failed, when the result is genuinely unknown, and that
 * "unknown" is never recorded as "failed".
 *
 * Three commands run per check: prepare (copy), typecheck, bundle. The
 * mock is sequenced accordingly.
 */

const commandRun = vi.fn();

vi.mock("./utils", () => ({
  getSandbox: async () => ({ commands: { run: commandRun } }),
}));

const { runBuildCheck, shouldBuildCheck } = await import("./build-check");

const ok = { exitCode: 0 };

const exitWith = (code: number, output: string) =>
  Object.assign(new Error(`exit status ${code}`), { exitCode: code, stderr: output });

beforeEach(() => {
  commandRun.mockReset();
});

describe("shouldBuildCheck", () => {
  // Measured at 93.4s of a 103.8s run, inside the same sandbox serving the
  // user's live preview. Real users must not pay that by default.
  it("always checks eval runs", () => {
    expect(shouldBuildCheck("EVAL", 0)).toBe(true);
  });

  it("never checks user runs at the default rate of zero", () => {
    expect(shouldBuildCheck("USER", 0, 0)).toBe(false);
    expect(shouldBuildCheck("USER", 0, 0.99)).toBe(false);
  });

  it("samples user runs when a rate is configured", () => {
    expect(shouldBuildCheck("USER", 0.1, 0.05)).toBe(true);
    expect(shouldBuildCheck("USER", 0.1, 0.5)).toBe(false);
  });

  it("treats a malformed rate as off rather than as always-on", () => {
    expect(shouldBuildCheck("USER", Number.NaN, 0)).toBe(false);
  });
});

describe("runBuildCheck", () => {
  it("reports both checks passing", async () => {
    commandRun.mockResolvedValue(ok);

    const result = await runBuildCheck("sbx_1", 3);

    expect(result.typecheck.succeeded).toBe(true);
    expect(result.bundle.succeeded).toBe(true);
  });

  it("separates a type failure from a bundle failure", async () => {
    // The whole reason for two signals: these are different problems and
    // point at different interventions.
    commandRun
      .mockResolvedValueOnce(ok) // prepare
      .mockRejectedValueOnce(exitWith(2, "app/page.tsx(4,7): error TS2322"))
      .mockResolvedValueOnce(ok); // bundle

    const result = await runBuildCheck("sbx_1", 3);

    expect(result.typecheck.succeeded).toBe(false);
    expect(result.bundle.succeeded).toBe(true);
    expect(result.typecheck.output).toContain("TS2322");
  });

  it("leaves both unknown when the copy fails", async () => {
    // Neither check ran, so neither is evidence about the code.
    commandRun.mockRejectedValueOnce(
      exitWith(2, "tar: ./.wh.nextjs-app: Cannot open: Permission denied"),
    );

    const result = await runBuildCheck("sbx_1", 3);

    expect(result.typecheck.attempted).toBe(false);
    expect(result.typecheck.succeeded).toBeNull();
    expect(result.bundle.succeeded).toBeNull();
    expect(result.bundle.output).toContain("copy failed");
  });

  it("does not blame the code for an infrastructure fault", async () => {
    // The real incident: the template shipped a root-owned .next, so every
    // build died with EACCES. Exit code 1 looked like a legitimate verdict,
    // and two runs were scored as generation failures on code that was
    // never compiled.
    commandRun
      .mockResolvedValueOnce(ok)
      .mockRejectedValue(
        exitWith(1, "EACCES: permission denied, open '/home/user/.next/trace'"),
      );

    const result = await runBuildCheck("sbx_1", 3);

    expect(result.typecheck.attempted).toBe(true);
    expect(result.typecheck.succeeded).toBeNull();
    expect(result.typecheck.output).toContain("infrastructure fault");
  });

  it("still blames the code for an ordinary compile error", async () => {
    // The guard above must not become a general excuse.
    commandRun
      .mockResolvedValueOnce(ok)
      .mockRejectedValue(
        exitWith(1, "Failed to compile.\n./app/page.tsx\nType error: TS2304"),
      );

    const result = await runBuildCheck("sbx_1", 3);

    expect(result.typecheck.succeeded).toBe(false);
    expect(result.typecheck.output).not.toContain("infrastructure fault");
  });

  it("leaves success null when a failure carries no exit code", async () => {
    // A timeout or dead sandbox is not evidence about the code.
    commandRun
      .mockResolvedValueOnce(ok)
      .mockRejectedValue(new Error("sandbox unreachable"));

    const result = await runBuildCheck("sbx_1", 3);

    expect(result.typecheck.succeeded).toBeNull();
    expect(result.typecheck.exitCode).toBeNull();
  });

  it("runs nothing when no files were written", async () => {
    // "Produced nothing" and "produced code that does not work" are
    // different failures and must not share a column.
    const result = await runBuildCheck("sbx_1", 0);

    expect(result.typecheck.attempted).toBe(false);
    expect(result.bundle.attempted).toBe(false);
    expect(commandRun).not.toHaveBeenCalled();
  });

  it("keeps the tail of long output, where the failure summary lives", async () => {
    const noise = "progress line\n".repeat(2_000);
    commandRun
      .mockResolvedValueOnce(ok)
      .mockRejectedValue(exitWith(1, `${noise}Failed to compile: TS2304`));

    const result = await runBuildCheck("sbx_1", 3);

    expect(result.typecheck.output).toContain("Failed to compile: TS2304");
    expect(result.typecheck.output).toContain("truncated");
  });
});
