"""The bar the port has to clear.

Both taxonomies read ``evals/fixtures/expectations.json`` and must agree
with it. The TypeScript implementation is deleted only once this passes.

Same corpus, same assertions, both languages. A port validated against
tests someone wrote fresh for it would pass while disagreeing with the
original on exactly the cases nobody thought to check twice.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from datum_analysis.taxonomy import classify

FIXTURES = Path(__file__).resolve().parents[2] / "evals" / "fixtures"
EXPECTATIONS = json.loads((FIXTURES / "expectations.json").read_text(encoding="utf-8"))

CASES = [(name, spec) for name, spec in EXPECTATIONS.items() if not name.startswith("_")]


@pytest.mark.parametrize("name,spec", CASES, ids=[c[0] for c in CASES])
def test_signature_matches_the_contract(name: str, spec: dict):
    text = (FIXTURES / name).read_text(encoding="utf-8")
    shape = classify(text)

    assert shape.signature == spec["signature"], (
        f"\n{name}\n"
        f"  expected: {spec['signature']}\n"
        f"  got:      {shape.signature}\n\n"
        f"  This fixture exists because: {spec['why']}"
    )


@pytest.mark.parametrize("name,spec", CASES, ids=[c[0] for c in CASES])
def test_source_matches_the_contract(name: str, spec: dict):
    text = (FIXTURES / name).read_text(encoding="utf-8")
    assert classify(text).source == spec["source"]


@pytest.mark.parametrize("name,_", CASES, ids=[c[0] for c in CASES])
def test_evidence_is_always_printable(name: str, _):
    """No control characters, whatever the input.

    A lone carriage return returns the terminal cursor to column zero and
    the rest of the line overwrites what was printed — which looks exactly
    like a report dropping rows, and is not.
    """
    text = (FIXTURES / name).read_text(encoding="utf-8")
    evidence = classify(text).evidence

    assert not any(ord(c) < 0x20 or ord(c) == 0x7F for c in evidence)


@pytest.mark.parametrize("name,_", CASES, ids=[c[0] for c in CASES])
def test_nothing_in_the_corpus_is_unclassified(name: str, _):
    """Every fixture is a failure that really happened.

    If one of them classifies as `unclassified`, a pattern has stopped
    matching real output — the silent regression this corpus exists to
    catch.
    """
    text = (FIXTURES / name).read_text(encoding="utf-8")
    assert classify(text).signature != "unclassified"


def test_windows_line_endings_do_not_change_the_signature():
    """The harness runs on Windows; the sandbox does not.

    Output reaches the database with whichever line endings the machine
    that produced it used, so a taxonomy sensitive to them would classify
    the same failure differently depending on where it ran.
    """
    for name, spec in CASES:
        unix = (FIXTURES / name).read_text(encoding="utf-8")
        windows = unix.replace("\n", "\r\n")

        assert classify(windows).signature == spec["signature"], name
