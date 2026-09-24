"""The ``datum`` command.

    datum baseline --version v7-utils-truncate-1000
    datum shapes
    datum power
    datum compare v5-pinned-truncate-4000 v6-pinned-truncate-1000

``npm run baseline`` and friends shell out to this, so the commands people
already type keep working while there is only one implementation behind
them. Two implementations of the same statistics is two places to be wrong,
and the one nobody runs drifts.
"""

from __future__ import annotations

import argparse
import sys

from . import report
from .db import load


def _add_shared(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--snapshot",
        help="Path to a snapshot. Defaults to data/runs.json at the repo root.",
    )
    parser.add_argument(
        "--level",
        type=float,
        default=0.95,
        help="Confidence level. One of 0.8, 0.9, 0.95, 0.99.",
    )


#: Options that take a value, for the dashless translation below.
_VALUE_OPTIONS = {"version", "snapshot", "level", "cases"}


def _normalise_argv(argv: list[str]) -> list[str]:
    """Accept the project's dashless convention as well as argparse's.

    The TypeScript scripts used `version=v7` rather than `--version v7`,
    deliberately: npm swallows some dashed arguments before they reach the
    script, and that silently created twenty-four orphan projects once when
    `--dry-run` was consumed by npm instead of being passed through.

    That convention is now muscle memory and appears throughout the docs, so
    the port accepts it rather than making everyone relearn the commands to
    accommodate an implementation detail of the new implementation.

    `--version v7` still works. Both forms, one meaning.
    """
    out: list[str] = []

    for token in argv:
        if "=" in token and not token.startswith("-"):
            name, _, value = token.partition("=")
            if name in _VALUE_OPTIONS:
                out.extend([f"--{name}", value])
                continue
        out.append(token)

    return out


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="datum",
        description="Analysis for the Datum measurement harness.",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    p_baseline = sub.add_parser(
        "baseline", help="Rates with Wilson intervals, per tier, per config."
    )
    p_baseline.add_argument("--version", help="Restrict to one agent configuration.")
    _add_shared(p_baseline)

    p_shapes = sub.add_parser("shapes", help="Deterministic failure taxonomy.")
    p_shapes.add_argument("--version")
    _add_shared(p_shapes)

    p_power = sub.add_parser(
        "power", help="Can this experiment resolve anything? Free."
    )
    p_power.add_argument("--version")
    p_power.add_argument("--cases", type=int, default=24, help="Runs per arm.")
    _add_shared(p_power)

    p_compare = sub.add_parser(
        "compare", help="Paired comparison of two configurations."
    )
    p_compare.add_argument("a", help="Baseline config version.")
    p_compare.add_argument("b", help="Intervention config version.")
    _add_shared(p_compare)

    args = parser.parse_args(_normalise_argv(list(argv or sys.argv[1:])))

    try:
        snapshot = load(args.snapshot)
    except FileNotFoundError as error:
        print(error, file=sys.stderr)
        return 1

    if args.command == "baseline":
        print(report.baseline(snapshot, args.version, args.level))
    elif args.command == "shapes":
        print(report.shapes(snapshot, args.version))
    elif args.command == "power":
        print(report.power(snapshot, args.version, args.cases, args.level))
    elif args.command == "compare":
        print(report.compare(snapshot, args.a, args.b, args.level))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
