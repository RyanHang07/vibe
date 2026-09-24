"""Reading the runs back.

THE SNAPSHOT IS THE SOURCE, NOT THE DATABASE.

The original plan had this connecting to Postgres read-only. The committed
JSON snapshot from ``npm run export`` is better for three reasons that only
became clear once the dataset stopped growing:

1. **Reproducible.** Figures in the writeup currently depend on whatever the
   database holds when someone runs the command — including rows added since,
   or pruned since. A file means anyone can recompute them, forever.
2. **No credentials.** Analysis runs without ``DATABASE_URL`` and without a
   provider key, so a reader can check the arithmetic.
3. **No risk.** Every row cost a sandbox and real tokens, and
   ``npm run report prune`` deletes rows by design. A reader analysing the
   data cannot damage it.

``load_live`` exists for regenerating a snapshot and needs the ``db`` extra.
It is read-only and deliberately awkward to reach for.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

__all__ = ["Run", "Snapshot", "load", "load_live"]


def _parse_time(value: str | None) -> datetime | None:
    if not value:
        return None
    # JSON carries ISO-8601 with a trailing Z; fromisoformat wants +00:00
    # before 3.11 and accepts Z after. Normalised either way.
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


@dataclass(frozen=True)
class Run:
    """One recorded generation.

    Every three-state field stays three-state: ``typecheck_succeeded`` is
    ``True``, ``False`` or ``None``, and ``None`` means the check could not
    decide. Collapsing it to a bool here would undo the distinction the whole
    harness is built around, in the layer that reports it.
    """

    id: str
    source: str
    status: str
    stage: str | None
    case_id: str | None
    config_version: str | None
    sandbox_template: str | None
    provider: str
    model: str
    prompt: str

    started_at: datetime | None
    finished_at: datetime | None
    duration_ms: int | None

    file_count: int | None
    has_summary: bool
    error_message: str | None

    typecheck_attempted: bool
    typecheck_succeeded: bool | None
    typecheck_exit_code: int | None
    typecheck_stderr: str | None
    typecheck_duration_ms: int | None

    build_attempted: bool
    build_succeeded: bool | None
    build_exit_code: int | None
    build_stderr: str | None
    build_duration_ms: int | None

    @property
    def agent_ms(self) -> int | None:
        """Wall time minus the harness's own checks.

        ``duration_ms`` is the full run: sandbox creation, the agent loop,
        then typecheck and bundle. The checks alone run 11-60 seconds — the
        same order as any effect worth looking for — so comparing raw wall
        time compares the harness as much as the agent.

        Returns ``None`` when a check duration is missing rather than
        treating it as zero. A missing duration is not a duration of nothing.
        """
        if (
            self.duration_ms is None
            or self.typecheck_duration_ms is None
            or self.build_duration_ms is None
        ):
            return None

        agent = self.duration_ms - self.typecheck_duration_ms - self.build_duration_ms
        return agent if agent > 0 else None

    @property
    def failure_text(self) -> str | None:
        """The most specific evidence available, in order of usefulness."""
        if self.typecheck_succeeded is False and self.typecheck_stderr:
            return self.typecheck_stderr
        if self.build_succeeded is False and self.build_stderr:
            return self.build_stderr
        return self.error_message


@dataclass(frozen=True)
class Snapshot:
    exported_at: str
    count: int
    config_versions: list[str]
    sandbox_templates: list[str]
    runs: list[Run]

    def for_version(self, version: str | None) -> list[Run]:
        if version is None:
            return self.runs
        return [r for r in self.runs if r.config_version == version]


_FIELD_MAP = {
    "case_id": "caseId",
    "config_version": "configVersion",
    "sandbox_template": "sandboxTemplate",
    "started_at": "startedAt",
    "finished_at": "finishedAt",
    "duration_ms": "durationMs",
    "file_count": "fileCount",
    "has_summary": "hasSummary",
    "error_message": "errorMessage",
    "typecheck_attempted": "typecheckAttempted",
    "typecheck_succeeded": "typecheckSucceeded",
    "typecheck_exit_code": "typecheckExitCode",
    "typecheck_stderr": "typecheckStderr",
    "typecheck_duration_ms": "typecheckDurationMs",
    "build_attempted": "buildAttempted",
    "build_succeeded": "buildSucceeded",
    "build_exit_code": "buildExitCode",
    "build_stderr": "buildStderr",
    "build_duration_ms": "buildDurationMs",
}

_TIME_FIELDS = {"started_at", "finished_at"}


def _to_run(row: dict) -> Run:
    values = {}
    for name in Run.__dataclass_fields__:
        if name == "agent_ms":
            continue
        key = _FIELD_MAP.get(name, name)
        raw = row.get(key)
        values[name] = _parse_time(raw) if name in _TIME_FIELDS else raw
    return Run(**values)


def default_snapshot_path() -> Path:
    """``data/runs.json`` at the repository root.

    Resolved relative to this file rather than the working directory, so the
    CLI behaves the same wherever it is invoked from.
    """
    return Path(__file__).resolve().parents[2] / "data" / "runs.json"


def load(path: str | Path | None = None) -> Snapshot:
    """Load a snapshot produced by ``npm run export``."""
    resolved = Path(path) if path else default_snapshot_path()

    if not resolved.exists():
        raise FileNotFoundError(
            f"No snapshot at {resolved}.\n\n"
            "Produce one with `npm run export` from the repository root. "
            "The snapshot is the source for analysis — see db.py for why."
        )

    payload = json.loads(resolved.read_text(encoding="utf-8"))

    return Snapshot(
        exported_at=payload.get("exportedAt", "(unknown)"),
        count=payload.get("count", 0),
        config_versions=payload.get("configVersions", []),
        sandbox_templates=payload.get("sandboxTemplates", []),
        runs=[_to_run(row) for row in payload.get("runs", [])],
    )


def load_live(database_url: str | None = None) -> Snapshot:
    """Read the database directly. Requires the ``db`` extra.

    For regenerating a snapshot, not for routine analysis. Read-only by
    construction: this module contains no INSERT, UPDATE or DELETE, and the
    schema belongs to Prisma.
    """
    try:
        import psycopg
        from psycopg.rows import dict_row
    except ImportError as error:
        raise ImportError(
            "psycopg is not installed. `pip install -e '.[db]'`, or use the "
            "committed snapshot instead — which is the intended path."
        ) from error

    url = database_url or os.environ.get("DATABASE_URL")
    if not url:
        raise ValueError("DATABASE_URL is not set.")

    columns = [_FIELD_MAP.get(n, n) for n in Run.__dataclass_fields__]
    quoted = ", ".join(f'"{c}"' for c in columns)

    with psycopg.connect(url, row_factory=dict_row) as conn:
        rows = conn.execute(
            f'SELECT {quoted} FROM "Run" ORDER BY "startedAt" ASC'
        ).fetchall()

    runs = [_to_run(row) for row in rows]

    return Snapshot(
        exported_at=datetime.now().isoformat(),
        count=len(runs),
        config_versions=sorted({r.config_version or "(unversioned)" for r in runs}),
        sandbox_templates=sorted({r.sandbox_template or "(unrecorded)" for r in runs}),
        runs=runs,
    )
