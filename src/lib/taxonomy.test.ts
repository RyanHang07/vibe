import { describe, expect, it } from "vitest";

import { classify, normalise, tally, UNCLASSIFIED } from "./taxonomy";

/**
 * The property that matters is stability: two runs that failed the same way
 * must produce the same signature, and two that failed differently must
 * not. Everything else is detail.
 *
 * These are also the tests that would catch a future refactor quietly
 * changing every signature — which would silently reset the whole history,
 * since the signature is the identity.
 */

describe("normalise", () => {
  it("strips paths and positions", () => {
    expect(normalise("app/page.tsx(4,7): something")).toBe("<path>: something");
    expect(normalise("./components/ui/card.tsx:19:3 something")).toBe(
      "<path><loc> something",
    );
  });

  it("strips quoted identifiers, which are what vary between instances", () => {
    expect(normalise("Type 'string' is not assignable to type 'number'")).toBe(
      "Type <name> is not assignable to type <name>",
    );
  });

  it("strips content hashes", () => {
    expect(normalise("media/or3nQ6H1.b7d310ad.woff2")).toContain("<");
  });
});

describe("classify", () => {
  it("gives two instances of the same TS error one signature", () => {
    const a = classify("app/page.tsx(4,7): error TS2322: Type 'string' is not assignable to type 'number'.");
    const b = classify("components/card.tsx(19,3): error TS2322: Type 'boolean' is not assignable to type 'Date'.");

    expect(a.signature).toBe(b.signature);
    expect(a.signature).toContain("TS2322");
    expect(a.source).toBe("typecheck");
  });

  it("keeps different TS errors apart", () => {
    const assignable = classify("x.tsx(1,1): error TS2322: Type 'a' is not assignable to type 'b'.");
    const missing = classify("x.tsx(1,1): error TS2304: Cannot find name 'foo'.");

    expect(assignable.signature).not.toBe(missing.signature);
  });

  it("recognises a missing module", () => {
    const shape = classify(
      "Failed to compile.\n./app/page.tsx\nModule not found: Can't resolve 'react-dnd'",
    );

    expect(shape.source).toBe("bundle");
    expect(shape.signature).toContain("Module not found");
  });

  it("prefers the specific complaint over the generic one", () => {
    // "Failed to compile." appears alongside the real reason; the real
    // reason is the useful half.
    const shape = classify(
      "Failed to compile.\nModule not found: Can't resolve 'chart.js'",
    );
    expect(shape.signature).toContain("Module not found");
    expect(shape.signature).not.toBe(UNCLASSIFIED);
  });

  it("recognises a server/client boundary violation", () => {
    const shape = classify(
      "Error: You're importing a component that needs useState. It only works in a Client Component.",
    );
    expect(shape.signature).toContain("Server/client boundary");
  });

  it("names a provider rejection rather than leaving it unclassified", () => {
    // Observed on four of five adversarial cases. Classified as an agent
    // failure, not infrastructure: a 400 most likely means the agent looped
    // until it exhausted the context, which is a real failure mode.
    const shape = classify(
      "AIGatewayError: Error making AI request: unsuccessful status code: 400",
    );

    expect(shape.signature).toBe("Provider rejected request (400)");
    expect(shape.source).toBe("agent");
  });

  it("separates context exhaustion from other 400s", () => {
    // Same symptom, different cause. Merging them would make the common
    // one invisible.
    const exhausted = classify(
      "Error: prompt is too long: 250000 tokens > 200000 maximum context length",
    );
    const other = classify("unsuccessful status code: 400");

    expect(exhausted.signature).toContain("context exhausted");
    expect(exhausted.signature).not.toBe(other.signature);
  });

  it("does not treat a provider rejection as merely 'wrote no files'", () => {
    // A rejection also leaves fileCount at 0, so ordering matters: the
    // specific cause must win over the generic symptom.
    const shape = classify(
      "AIGatewayError: unsuccessful status code: 400\nsummary: false, files: 0",
    );
    expect(shape.signature).toContain("Provider rejected");
  });

  it("recognises the agent producing nothing", () => {
    expect(classify("summary: false, files: 0").signature).toBe(
      "Agent produced no summary",
    );
    expect(classify("summary: true, files: 0").signature).toBe(
      "Agent wrote no files",
    );
  });

  it("returns UNCLASSIFIED rather than guessing", () => {
    // A bucket that absorbs everything reports a tidy taxonomy while
    // hiding the failures nobody has looked at — and those are the
    // interesting ones.
    const shape = classify("something nobody has seen before");
    expect(shape.signature).toBe(UNCLASSIFIED);
    expect(shape.evidence).toContain("something nobody");
  });

  it("handles empty and missing input", () => {
    expect(classify(null).signature).toBe(UNCLASSIFIED);
    expect(classify("").signature).toBe(UNCLASSIFIED);
    expect(classify("   ").signature).toBe(UNCLASSIFIED);
  });
});

describe("tally", () => {
  it("groups by shape and orders by frequency", () => {
    const result = tally([
      { id: "1", text: "a.tsx(1,1): error TS2322: Type 'a' is not assignable to type 'b'." },
      { id: "2", text: "b.tsx(9,2): error TS2322: Type 'c' is not assignable to type 'd'." },
      { id: "3", text: "Module not found: Can't resolve 'x'" },
    ]);

    expect(result).toHaveLength(2);
    expect(result[0].count).toBe(2);
    expect(result[0].shape.signature).toContain("TS2322");
    expect(result[0].runIds).toEqual(["1", "2"]);
  });

  it("is stable across reordering", () => {
    // The same failures in a different order must produce the same shapes,
    // or counts drift between runs for no reason.
    const failures = [
      { id: "1", text: "a.tsx(1,1): error TS2304: Cannot find name 'x'." },
      { id: "2", text: "b.tsx(2,2): error TS2322: Type 'a' is not assignable to type 'b'." },
    ];

    const forward = tally(failures).map((g) => g.shape.signature).sort();
    const backward = tally([...failures].reverse()).map((g) => g.shape.signature).sort();

    expect(forward).toEqual(backward);
  });
});
