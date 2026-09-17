import { describe, expect, it } from "vitest";

import { infrastructureFault, isMarkedFault, markFault } from "./faults";

/**
 * The guard has two ways to be wrong, and both are bad:
 *
 *   - Too narrow, and infrastructure faults get recorded as the agent
 *     writing bad code. That already happened twice with EACCES.
 *   - Too broad, and it starts excusing genuine failures, at which point
 *     the metric forgives everything and measures nothing.
 *
 * So both directions are tested.
 */

describe("infrastructureFault", () => {
  it("catches rate limits however they are worded", () => {
    expect(infrastructureFault("HTTP 429 Too Many Requests")).toBe("rate limit");
    expect(infrastructureFault("rate_limit_error")).toBe("rate limit");
    expect(infrastructureFault("You have exceeded your rate limit")).toBe("rate limit");
  });

  it("catches the sandbox faults that already bit", () => {
    expect(
      infrastructureFault("EACCES: permission denied, open '/home/user/.next/trace'"),
    ).toBe("filesystem permissions");
    expect(infrastructureFault("rm: cannot remove '.next/x': Permission denied")).toBe(
      "filesystem permissions",
    );
  });

  it("catches provider outages and transport errors", () => {
    expect(infrastructureFault("503 Service Unavailable")).toBe("provider outage");
    expect(infrastructureFault("Error: overloaded_error")).toBe("provider outage");
    expect(infrastructureFault("connect ECONNREFUSED 127.0.0.1:8288")).toBe("network");
  });

  it("leaves genuine build failures alone", () => {
    // If any of these start matching, the guard has become an excuse.
    expect(infrastructureFault("Failed to compile.\nType error: TS2304")).toBeNull();
    expect(infrastructureFault("Module not found: Can't resolve 'react-dnd'")).toBeNull();
    expect(infrastructureFault("SyntaxError: Unexpected token")).toBeNull();
    expect(infrastructureFault("exit status 1")).toBeNull();
  });

  it("leaves genuine agent failures alone", () => {
    expect(infrastructureFault("The model declined to answer")).toBeNull();
    expect(infrastructureFault("maxIter reached without a summary")).toBeNull();
  });

  it("treats empty input as no fault rather than as a fault", () => {
    expect(infrastructureFault(null)).toBeNull();
    expect(infrastructureFault("")).toBeNull();
  });
});

describe("fault markers", () => {
  it("round-trips", () => {
    const marked = markFault("rate limit", "HTTP 429");
    expect(isMarkedFault(marked)).toBe(true);
    expect(marked).toContain("rate limit");
    expect(marked).toContain("HTTP 429");
  });

  it("does not see a marker in ordinary error text", () => {
    expect(isMarkedFault("Failed to compile.")).toBe(false);
    expect(isMarkedFault(null)).toBe(false);
  });
});
