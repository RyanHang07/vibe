import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { classify, UNCLASSIFIED } from "./taxonomy";

/**
 * The contract, read from the same file the Python port reads.
 *
 * `evals/fixtures/expectations.json` is the single definition of what each
 * captured failure must classify as. Both implementations assert against
 * it, so "the port matches" is a thing the test suite checks rather than a
 * thing someone compared by eye.
 *
 * The fixtures are real output from real runs, kept verbatim. A parser
 * tested against output someone imagined matches what they imagined, and
 * the failures that break it are the ones nobody thought of.
 */
const FIXTURES = join(process.cwd(), "evals", "fixtures");

type Expectation = { signature: string; source: string; why: string };

const expectations: Record<string, Expectation> = Object.fromEntries(
  Object.entries(
    JSON.parse(
      readFileSync(join(FIXTURES, "expectations.json"), "utf-8"),
    ) as Record<string, Expectation>,
  ).filter(([name]) => !name.startsWith("_")),
);

const read = (name: string) =>
  readFileSync(join(FIXTURES, name), "utf-8");

describe("captured failure corpus", () => {
  for (const [name, spec] of Object.entries(expectations)) {
    it(`${name} → ${spec.signature}`, () => {
      const shape = classify(read(name));

      expect(
        shape.signature,
        `\n  expected: ${spec.signature}` +
          `\n  got:      ${shape.signature}` +
          `\n\n  This fixture exists because: ${spec.why}\n`,
      ).toBe(spec.signature);

      expect(shape.source).toBe(spec.source);
    });
  }

  /**
   * A pattern that stops matching real output fails nothing on its own —
   * the taxonomy just reports fewer shapes, or moves failures into the
   * unclassified bucket, and a tidier-looking taxonomy reads as progress.
   * This is what makes that loud.
   */
  it("classifies every fixture — none fall through", () => {
    for (const name of Object.keys(expectations)) {
      expect(classify(read(name)).signature, name).not.toBe(UNCLASSIFIED);
    }
  });

  /**
   * The harness runs on Windows; the sandbox does not. Output reaches the
   * database with whichever line endings produced it, so a taxonomy
   * sensitive to them would classify the same failure differently
   * depending on where it ran.
   */
  it("gives the same signature for Windows line endings", () => {
    for (const [name, spec] of Object.entries(expectations)) {
      const windows = read(name).replace(/\n/g, "\r\n");
      expect(classify(windows).signature, name).toBe(spec.signature);
    }
  });

  /**
   * A lone carriage return returns the terminal cursor to column zero, so
   * the rest of the line overwrites what was already printed — which looks
   * exactly like a report dropping rows, and is not.
   */
  it("produces evidence with no control characters", () => {
    for (const name of Object.keys(expectations)) {
      // eslint-disable-next-line no-control-regex
      expect(classify(read(name)).evidence, name).not.toMatch(
        /[\u0000-\u001F\u007F]/,
      );
    }
  });
});
