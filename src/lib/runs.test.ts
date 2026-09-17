import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * These tests do not touch a database.
 *
 * `prisma` is replaced with a stub, so what is being checked is the logic in
 * `runs.ts` — which fields get written, and what happens when the row has
 * gone. Whether Postgres can store a string is Postgres's problem.
 */

const findUnique = vi.fn();
const update = vi.fn();
const create = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    run: {
      create: (...args: unknown[]) => create(...args),
      update: (...args: unknown[]) => update(...args),
      findUnique: (...args: unknown[]) => findUnique(...args),
    },
  },
}));

const { finishRun, startRun } = await import("./runs");

beforeEach(() => {
  create.mockReset();
  update.mockReset();
  findUnique.mockReset();
});

describe("startRun", () => {
  it("opens the run as RUNNING and returns its id", async () => {
    create.mockResolvedValue({ id: "run_1" });

    const id = await startRun({
      projectId: "proj_1",
      prompt: "build a todo app",
      provider: "openai",
      model: "gpt-5.6-terra",
    });

    expect(id).toBe("run_1");

    const { data } = create.mock.calls[0][0];
    expect(data.status).toBe("RUNNING");
    expect(data.source).toBe("USER");
    // Stored verbatim — comparing runs means comparing what was asked.
    expect(data.prompt).toBe("build a todo app");
  });

  it("records eval runs separately from user traffic", async () => {
    create.mockResolvedValue({ id: "run_2" });

    await startRun({
      projectId: "proj_1",
      prompt: "x",
      provider: "anthropic",
      model: "claude-haiku-4-5-20251001",
      source: "EVAL",
    });

    expect(create.mock.calls[0][0].data.source).toBe("EVAL");
  });
});

describe("finishRun", () => {
  it("derives duration from the row's own startedAt", async () => {
    const startedAt = new Date(Date.now() - 5_000);
    findUnique.mockResolvedValue({ startedAt });
    update.mockResolvedValue({});

    await finishRun({ runId: "run_1", status: "COMPLETED", fileCount: 3 });

    const { data } = update.mock.calls[0][0];
    expect(data.status).toBe("COMPLETED");
    expect(data.fileCount).toBe(3);
    // ~5s, with room for test-execution jitter.
    expect(data.durationMs).toBeGreaterThanOrEqual(4_900);
    expect(data.durationMs).toBeLessThan(7_000);
  });

  it("does nothing when the row has gone, rather than throwing", async () => {
    // Telemetry must never be able to fail a user's generation.
    findUnique.mockResolvedValue(null);

    await expect(
      finishRun({ runId: "missing", status: "COMPLETED" }),
    ).resolves.toBeUndefined();

    expect(update).not.toHaveBeenCalled();
  });
});
