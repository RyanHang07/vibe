"""The dashless argument convention, preserved across the port.

`version=v7` rather than `--version v7` was a deliberate choice in the
TypeScript scripts: npm consumes some dashed arguments before they reach
the script, and that once created twenty-four orphan projects when
`--dry-run` was swallowed instead of passed through.

The convention is muscle memory and appears throughout the docs, so the
port accepts it. These tests are what stop a later tidy-up from "fixing"
it back to argparse's house style.
"""

from __future__ import annotations

from datum_analysis.cli import _normalise_argv


def test_translates_the_dashless_form():
    assert _normalise_argv(["baseline", "version=v7"]) == [
        "baseline",
        "--version",
        "v7",
    ]


def test_leaves_the_dashed_form_alone():
    assert _normalise_argv(["baseline", "--version", "v7"]) == [
        "baseline",
        "--version",
        "v7",
    ]


def test_leaves_positional_arguments_alone():
    """`compare` takes two config names positionally, and a version string
    can contain an `=` in principle — only known option names translate."""
    assert _normalise_argv(["compare", "v6-a", "v7-b"]) == [
        "compare",
        "v6-a",
        "v7-b",
    ]


def test_ignores_unknown_names_that_happen_to_contain_equals():
    assert _normalise_argv(["shapes", "something=else"]) == [
        "shapes",
        "something=else",
    ]


def test_handles_several_at_once():
    assert _normalise_argv(
        ["power", "version=v7", "cases=24", "level=0.99"]
    ) == [
        "power",
        "--version",
        "v7",
        "--cases",
        "24",
        "--level",
        "0.99",
    ]
