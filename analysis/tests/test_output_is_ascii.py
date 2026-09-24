"""Report output must be pure ASCII.

WHY THIS IS A TEST AND NOT A STYLE PREFERENCE

`npm run shapes` appeared to drop rows for weeks. A shape's run count would
simply not be printed, with the lines around it intact. It was blamed on
carriage returns in captured compiler output, which were duly sanitised,
and the rows kept vanishing. Then the Python port did the same thing on a
different line, with clean strings it had built itself.

Redirecting to a file settled it: every line was there. PowerShell's
console renders `·` as `V%` and en dashes as replacement characters, and a
mangled multi-byte sequence takes the rest of its line with it. Every
vanished line contained a `·`.

A report is read in a terminal. One that renders wrong in the terminal it
is read in is broken however correct its bytes are — so this is checked,
not merely intended.
"""

from __future__ import annotations

import pytest

from conftest import make_run, make_snapshot
from datum_analysis.report import baseline, compare, power, shapes


def _assert_ascii(text: str, label: str) -> None:
    offenders = sorted({c for c in text if ord(c) > 127})
    assert not offenders, (
        f"{label} contains non-ASCII: {offenders}\n"
        "These do not survive a Windows console. Use the SEP / DASH / "
        "PLUSMINUS / WARN constants in report.py."
    )


@pytest.fixture
def snapshot():
    return make_snapshot(
        [
            make_run("a1", "trivial-01", config="v6", duration_ms=30_000),
            make_run("a2", "trivial-01", config="v6", duration_ms=32_000),
            make_run("a3", "complex-01", config="v6", duration_ms=140_000),
            make_run(
                "a4",
                "simple-01",
                config="v6",
                typecheck=False,
                build=False,
                typecheck_stderr="app/p.tsx(1,1): error TS2322: Type 'a' is not assignable to type 'b'.",
            ),
            make_run("b1", "trivial-01", config="v7", duration_ms=28_000),
            make_run("b2", "complex-01", config="v7", duration_ms=130_000),
        ]
    )


def test_baseline_is_ascii(snapshot):
    _assert_ascii(baseline(snapshot, "v6"), "baseline")


def test_baseline_with_mixed_configs_is_ascii(snapshot):
    """The mixed-config warning carries the only remaining symbol."""
    _assert_ascii(baseline(snapshot), "baseline (mixed)")


def test_shapes_is_ascii(snapshot):
    _assert_ascii(shapes(snapshot, "v6"), "shapes")


def test_power_is_ascii(snapshot):
    _assert_ascii(power(snapshot, "v6"), "power")


def test_compare_is_ascii(snapshot):
    _assert_ascii(compare(snapshot, "v6", "v7"), "compare")


def test_no_data_placeholders_are_ascii():
    """The empty-interval and missing-duration markers were em dashes."""
    empty = make_snapshot([make_run("a", "simple-01", duration_ms=None)])
    _assert_ascii(baseline(empty, "v7"), "baseline (no timing)")


def test_quoted_compiler_output_is_folded_to_ascii():
    """The report being clean is not enough if what it quotes is not.

    Next prints `⨯` before a build failure, tsc uses smart quotes, npm
    emits box drawing. One evidence line disappeared from the terminal for
    exactly this reason, one run after the constants above went in.
    """
    runs = [
        make_run(
            "a",
            "simple-04",
            typecheck=False,
            build=False,
            typecheck_stderr=(
                "} Export encountered an error on /page: /, exiting the build. "
                "⨯ Next.js build worker exited with code: 1 — see “above”"
            ),
        )
    ]

    out = shapes(make_snapshot(runs), "v7")

    _assert_ascii(out, "shapes (non-ASCII compiler output)")
    # Replaced, not dropped: the reader can see something was there.
    assert "?" in out


def test_folding_does_not_change_the_signature():
    """Identity comes from `normalise` on the original text. Folding is
    display only, and must not quietly create a second shape for one
    cause."""
    from datum_analysis.taxonomy import classify

    plain = "app/p.tsx(1,1): error TS2322: Type 'a' is not assignable to type 'b'."
    fancy = plain.replace("'", "‘", 1)

    assert classify(plain).signature == classify(plain).signature
    # The smart quote changes the text but the shape is still a TS2322.
    assert classify(fancy).signature.startswith("TS2322:")
