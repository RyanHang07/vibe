import { describe, expect, it } from "vitest";

import { CONFIG_VERSION, truncateForModel } from "./interventions";

describe("truncateForModel", () => {
  it("leaves short output alone", () => {
    expect(truncateForModel("npm install ok", 100)).toBe("npm install ok");
  });

  it("keeps both ends, not just the tail", () => {
    // A command's opening lines say what ran; a failure summary lands at
    // the end. Both halves carry signal, which is why this differs from
    // the build check's tail-only truncation.
    const text = `START${"x".repeat(5_000)}END`;
    const result = truncateForModel(text, 1_000);

    expect(result.startsWith("START")).toBe(true);
    expect(result.endsWith("END")).toBe(true);
  });

  it("says how much it removed", () => {
    // The model must know a gap exists, or it reasons about the missing
    // section as though it were empty.
    const result = truncateForModel("y".repeat(10_000), 1_000);
    expect(result).toMatch(/\d+ characters omitted/);
  });

  it("stays near the limit", () => {
    const result = truncateForModel("z".repeat(100_000), 4_000);
    // The limit plus the marker, not a multiple of it.
    expect(result.length).toBeLessThan(4_200);
  });

  it("handles a limit larger than the text", () => {
    expect(truncateForModel("short", 10_000)).toBe("short");
  });
});

describe("CONFIG_VERSION", () => {
  it("is a readable name, not a hash", () => {
    // These get printed in reports and compared by eye. A hash would be
    // stable and useless.
    expect(CONFIG_VERSION).toMatch(/^v\d+-[a-z0-9-]+$/);
  });
});
