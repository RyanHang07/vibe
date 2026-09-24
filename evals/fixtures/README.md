# Captured failure output

Real output from real runs, kept verbatim. Every file here was produced by
the harness and copied out of a `Run` row — none of it is invented.

That matters. A parser tested against output someone imagined will match
what they imagined, and the failures that break it are the ones nobody
thought of. Every fixture here corresponds to a failure that actually
happened, most of them to a bug that took real time to find.

## The contract

`expectations.json` maps each fixture to the signature the taxonomy must
produce for it. **Both implementations read the same file and must agree.**

- `src/lib/taxonomy.ts` — used by the harness
- `analysis/datum_analysis/taxonomy.py` — used by the analysis layer

The TypeScript version is deleted only once Python matches it on every
fixture here. Same inputs, same outputs, or it is not a port.

## Why a signature changing is a silent regression

Nothing fails when a pattern stops matching. The taxonomy simply reports
fewer shapes, or moves failures into `unclassified`, and a report with a
tidier-looking taxonomy is easy to read as progress. These tests are what
turn that into a test failure.

## Adding one

When a new failure shape appears, copy the output verbatim into a file
named after what it is, add its expected signature to `expectations.json`,
and note in a comment what the failure was really about. The fixture is
evidence; the filename is the diagnosis.
