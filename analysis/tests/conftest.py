"""Shared test factories.

In `conftest.py` rather than imported between test modules: `tests/` is not
a package, so `from .test_report import ...` has no parent to resolve
against. pytest puts this directory on the path and loads this file first,
which is the mechanism that exists for exactly this.
"""

from __future__ import annotations

from datetime import datetime, timezone

from datum_analysis.db import Run, Snapshot


def make_run(
    run_id: str,
    case_id: str,
    *,
    config: str = "v7",
    typecheck: bool | None = True,
    build: bool | None = True,
    has_summary: bool = True,
    duration_ms: int | None = 60_000,
    check_ms: int = 10_000,
    status: str = "COMPLETED",
    build_attempted: bool = True,
    typecheck_stderr: str | None = None,
    error_message: str | None = None,
) -> Run:
    """A run with sensible defaults, overridable one field at a time.

    Defaults to a clean pass at 60s wall / 10s per check, so a test that
    cares about failures says so explicitly and a reader can see which field
    the test is actually about.
    """
    return Run(
        id=run_id,
        source="EVAL",
        status=status,
        stage="done",
        case_id=case_id,
        config_version=config,
        sandbox_template="tpl",
        provider="anthropic",
        model="claude-haiku-4-5",
        prompt="build a thing",
        started_at=datetime(2026, 9, 23, tzinfo=timezone.utc),
        finished_at=datetime(2026, 9, 23, tzinfo=timezone.utc),
        duration_ms=duration_ms,
        file_count=3,
        has_summary=has_summary,
        error_message=error_message,
        typecheck_attempted=True,
        typecheck_succeeded=typecheck,
        typecheck_exit_code=0 if typecheck else 2,
        typecheck_stderr=typecheck_stderr,
        typecheck_duration_ms=check_ms,
        build_attempted=build_attempted,
        build_succeeded=build,
        build_exit_code=0 if build else 1,
        build_stderr=None,
        build_duration_ms=check_ms,
    )


def make_snapshot(runs: list[Run]) -> Snapshot:
    return Snapshot(
        exported_at="2026-09-23T22:00:00.000Z",
        count=len(runs),
        config_versions=sorted({r.config_version or "?" for r in runs}),
        sandbox_templates=["tpl"],
        runs=runs,
    )
