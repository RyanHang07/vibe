"""Report formatting.

The TypeScript versions printed straight to the console, so their layout was
only ever checked by reading it. These return strings, which makes the
invariants testable — and the invariants are the point: a report that omits
its interval, or renders an unknown as a failure, is wrong in a way that
reads as fine.
"""

from __future__ import annotations

from conftest import make_run, make_snapshot
from datum_analysis.report import PLUSMINUS, baseline, compare, power, shapes


class TestBaseline:
    def test_every_rate_carries_its_interval(self):
        """A bare percentage describes the runs it was computed from and
        says almost nothing about the next one."""
        snapshot = make_snapshot(
            [make_run(f"r{i}", f"simple-0{i % 5 + 1}") for i in range(10)]
        )
        out = baseline(snapshot, "v7")

        assert "typecheck" in out
        # `10/10 = 100.0% [x, y]` — the bracket, not just the number.
        assert "[" in out and "]" in out

    def test_unknown_verdicts_stay_out_of_the_denominator(self):
        """`build_succeeded is None` means the check could not decide.

        Counting it would quietly deflate every rate on the page.
        """
        runs = [make_run("a", "simple-01"), make_run("b", "simple-02")]
        runs.append(make_run("c", "simple-03", build=None, typecheck=None))

        out = baseline(make_snapshot(runs), "v7")

        # Two judged runs, not three.
        assert "2/2" in out

    def test_reports_the_false_success_rate(self):
        """The finding the project exists to produce."""
        runs = [
            make_run("a", "simple-01", build=True, has_summary=True),
            make_run("b", "simple-02", build=False, has_summary=True),
        ]
        out = baseline(make_snapshot(runs), "v7")

        assert "the old signal said 2/2 succeeded" in out
        assert "of those, 1 did not compile" in out

    def test_warns_when_configurations_are_mixed(self):
        """Runs from different configs answer different questions."""
        runs = [
            make_run("a", "simple-01", config="v6"),
            make_run("b", "simple-02", config="v7"),
        ]
        out = baseline(make_snapshot(runs))

        assert "2 agent configurations mixed" in out

    def test_says_what_the_sample_cannot_resolve(self):
        # Built from the constant rather than spelled out: this assertion
        # hardcoded `±` and broke when report output went ASCII, which is
        # the test noticing a deliberate change rather than a regression.
        # Referencing the constant means the next such change does not.
        out = baseline(make_snapshot([make_run("a", "simple-01")]), "v7")
        assert f"{PLUSMINUS}10 point interval needs about 97 runs" in out

    def test_agent_time_excludes_the_checks(self):
        """60s wall minus 10s typecheck minus 10s bundle is 40s."""
        runs = [make_run(f"r{i}", f"simple-0{i + 1}") for i in range(3)]
        out = baseline(make_snapshot(runs), "v7")

        assert "40.0s" in out
        assert "agent time to a passing generation" in out

    def test_refuses_wall_time_when_agent_time_is_unavailable(self):
        """Reporting wall time instead would compare the checks as much as
        the agent, and look like a result."""
        runs = [
            make_run(f"r{i}", f"simple-0{i + 1}", duration_ms=None) for i in range(3)
        ]
        out = baseline(make_snapshot(runs), "v7")

        assert "Not enough runs carry both a wall time" in out
        assert "would compare the checks as much as the" in out


class TestShapes:
    def test_groups_identical_failures_into_one_shape(self):
        runs = [
            make_run(
                f"r{i}",
                f"simple-0{i + 1}",
                typecheck=False,
                build=False,
                typecheck_stderr=(
                    f"app/page{i}.tsx(4,7): error TS2322: "
                    f"Type 'string' is not assignable to type 'number'."
                ),
            )
            for i in range(3)
        ]
        out = shapes(make_snapshot(runs), "v7")

        assert "3 code failure(s) in 1 shape(s)" in out
        assert "TS2322" in out

    def test_names_the_unclassified_rather_than_absorbing_them(self):
        runs = [
            make_run(
                "a",
                "simple-01",
                typecheck=False,
                build=False,
                typecheck_stderr="something nobody has seen before",
            )
        ]
        out = shapes(make_snapshot(runs), "v7")

        assert "unclassified" in out
        assert "nobody has looked at yet" in out


class TestPower:
    def test_separates_between_case_from_within_case_spread(self):
        runs = [
            make_run("a1", "trivial-01", duration_ms=30_000),
            make_run("a2", "trivial-01", duration_ms=32_000),
            make_run("b1", "complex-01", duration_ms=140_000),
            make_run("b2", "complex-01", duration_ms=142_000),
        ]
        out = power(make_snapshot(runs), "v7")

        assert "between cases" in out
        assert "within a case" in out
        assert "smallest detectable change" in out

    def test_says_when_within_case_noise_is_unmeasured(self):
        """A missing within-case figure must not read as zero — that would
        report infinite resolution."""
        runs = [
            make_run("a", "trivial-01", duration_ms=30_000),
            make_run("b", "complex-01", duration_ms=140_000),
            make_run("c", "simple-01", duration_ms=60_000),
            make_run("d", "moderate-01", duration_ms=90_000),
        ]
        out = power(make_snapshot(runs), "v7")

        assert "no case has been run twice" in out


class TestCompare:
    def test_reports_the_quality_rate_before_the_latency(self):
        """An intervention that speeds the agent up by degrading what it
        produces is a regression wearing a win."""
        runs = [
            make_run("a1", "simple-01", config="v6", duration_ms=60_000),
            make_run("a2", "simple-02", config="v6", duration_ms=60_000),
            make_run("b1", "simple-01", config="v7", duration_ms=50_000),
            make_run("b2", "simple-02", config="v7", duration_ms=50_000),
        ]
        out = compare(make_snapshot(runs), "v6", "v7")

        assert out.index("typecheck rate") < out.index("agent time")

    def test_not_resolved_states_the_bound_it_could_not_see(self):
        runs = [
            make_run("a1", "simple-01", config="v6", duration_ms=60_000),
            make_run("a2", "simple-02", config="v6", duration_ms=90_000),
            make_run("b1", "simple-01", config="v7", duration_ms=90_000),
            make_run("b2", "simple-02", config="v7", duration_ms=60_000),
        ]
        out = compare(make_snapshot(runs), "v6", "v7")

        assert "NOT RESOLVED" in out
        assert "not the same as 'no effect'" in out

    def test_names_dropped_cases_rather_than_filling_them_in(self):
        runs = [
            make_run("a1", "simple-01", config="v6"),
            make_run("a2", "only-in-a", config="v6"),
            make_run("a3", "simple-02", config="v6"),
            make_run("b1", "simple-01", config="v7"),
            make_run("b2", "simple-02", config="v7"),
        ]
        out = compare(make_snapshot(runs), "v6", "v7")

        assert "only-in-a" in out
        assert "dropped" in out
