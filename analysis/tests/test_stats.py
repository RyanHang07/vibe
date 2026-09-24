"""Ported from src/lib/stats.test.ts.

The assertions are deliberately the same ones, in the same order. A port is
only trustworthy if it fails where the original failed — a Python suite that
tests different things would pass while disagreeing with TypeScript on the
cases nobody thought to check twice.
"""

from __future__ import annotations

import math

import pytest

from datum_analysis.stats import (
    format_interval,
    minimum_detectable_effect,
    overlaps,
    paired_difference,
    trials_for_width,
    variance_split,
    wilson_interval,
)


class TestWilsonInterval:
    def test_brackets_the_point_estimate(self):
        interval = wilson_interval(12, 20)
        assert interval.point == pytest.approx(0.6)
        assert interval.lower < 0.6 < interval.upper

    def test_is_wide_at_n20_which_is_the_point(self):
        # Roughly 39% to 78%. A later batch at 70% has not beaten this one.
        interval = wilson_interval(12, 20)
        assert 0.36 < interval.lower < 0.42
        assert 0.75 < interval.upper < 0.81

    def test_narrows_as_trials_increase(self):
        small = wilson_interval(12, 20)
        large = wilson_interval(120, 200)
        assert (large.upper - large.lower) < (small.upper - small.lower)

    def test_never_collapses_to_zero_width_at_zero_successes(self):
        """The reason this is not the Wald interval.

        Wald gives 0% ± 0 here: certainty about the true rate, from twenty
        observations. The adversarial tier is built to score zero, so this
        is the common case rather than an edge one.
        """
        interval = wilson_interval(0, 20)
        assert interval.point == 0
        assert interval.upper > 0
        assert interval.lower == 0

    def test_never_collapses_at_full_marks_either(self):
        interval = wilson_interval(20, 20)
        assert interval.point == 1
        assert interval.lower < 1
        assert interval.upper == 1

    def test_no_trials_is_no_estimate_not_zero_percent(self):
        interval = wilson_interval(0, 0)
        assert math.isnan(interval.point)
        assert format_interval(interval) == "no data"

    def test_rejects_impossible_counts(self):
        with pytest.raises(ValueError):
            wilson_interval(21, 20)
        with pytest.raises(ValueError):
            wilson_interval(-1, 20)

    def test_rejects_an_unsupported_confidence_level(self):
        with pytest.raises(ValueError):
            wilson_interval(1, 2, level=0.9137)


class TestOverlaps:
    def test_overlapping_means_not_shown_not_the_same(self):
        assert overlaps(wilson_interval(12, 20), wilson_interval(14, 20))

    def test_clearly_separated_results_do_not_overlap(self):
        assert not overlaps(wilson_interval(2, 100), wilson_interval(95, 100))


class TestTrialsForWidth:
    def test_ninety_seven_for_ten_points_not_ninety_six(self):
        """96 is the folk number, from rounding 96.04 to nearest.

        96 runs leaves the interval fractionally wider than the one asked
        for, so this rounds up.
        """
        assert trials_for_width(0.2) == 97


class TestVarianceSplit:
    def test_separates_large_between_from_small_within(self):
        split = variance_split(
            {"trivial-01": [10, 11], "complex-01": [70, 71]}
        )
        assert split.between_sd > 40
        assert split.within_sd == pytest.approx(math.sqrt(0.5))
        assert split.groups_with_repeats == 2

    def test_counts_single_observation_groups_between_but_not_within(self):
        split = variance_split({"a": [10, 20], "b": [50]})
        assert split.groups == 2
        assert split.groups_with_repeats == 1
        # Within rests on `a` alone: deviations ±5, one degree of freedom.
        assert split.within_sd == pytest.approx(math.sqrt(50))

    def test_within_is_unknown_never_zero_without_repeats(self):
        """A zero would report infinite resolution and green-light an
        experiment that can resolve nothing."""
        split = variance_split({"a": [10], "b": [20]})
        assert math.isnan(split.within_sd)

    def test_no_observations_is_no_estimate(self):
        split = variance_split({})
        assert split.observations == 0
        assert math.isnan(split.grand_mean)


class TestMinimumDetectableEffect:
    def test_shrinks_with_the_square_root_of_the_sample(self):
        assert minimum_detectable_effect(10, 25) / minimum_detectable_effect(
            10, 100
        ) == pytest.approx(2, abs=0.05)

    def test_is_proportional_to_the_noise_it_faces(self):
        assert minimum_detectable_effect(20, 24) == pytest.approx(
            2 * minimum_detectable_effect(10, 24)
        )

    def test_pairing_buys_resolution_proportional_to_noise_removed(self):
        unpaired = minimum_detectable_effect(24, 24)
        paired = minimum_detectable_effect(8, 24)
        assert unpaired / paired == pytest.approx(3)

    def test_gives_no_answer_for_a_single_observation(self):
        assert math.isnan(minimum_detectable_effect(10, 1))

    def test_propagates_unmeasured_noise_rather_than_inventing_a_bar(self):
        assert math.isnan(minimum_detectable_effect(math.nan, 24))


class TestPairedDifference:
    def test_resolves_a_small_consistent_shift_under_a_huge_spread(self):
        a = {
            "trivial-01": [10_000],
            "simple-01": [30_000],
            "moderate-01": [60_000],
            "complex-01": [90_000],
        }
        b = {
            "trivial-01": [8_000],
            "simple-01": [28_000],
            "moderate-01": [58_000],
            "complex-01": [88_000],
        }

        result = paired_difference(a, b)

        assert result.pairs == 4
        assert result.mean_difference == pytest.approx(2_000)
        assert result.resolved
        assert result.lower > 0

    def test_does_not_resolve_an_inconsistent_difference_of_the_same_mean(self):
        a = {"a": [10_000], "b": [30_000], "c": [60_000], "d": [90_000]}
        b = {"a": [30_000], "b": [10_000], "c": [80_000], "d": [72_000]}

        result = paired_difference(a, b)
        assert not result.resolved
        assert result.lower < 0 < result.upper

    def test_drops_and_names_cases_present_in_one_arm_only(self):
        a = {"shared": [10_000], "only-a": [50_000], "x": [1_000]}
        b = {"shared": [9_000], "only-b": [50_000], "x": [900]}

        result = paired_difference(a, b)
        assert result.pairs == 2
        assert result.dropped == ["only-a", "only-b"]

    def test_refuses_to_report_a_difference_from_a_single_pair(self):
        result = paired_difference({"a": [10_000]}, {"a": [5_000]})
        assert result.pairs == 1
        assert not result.resolved
        assert math.isnan(result.mean_difference)

    def test_averages_repeats_within_a_case_before_differencing(self):
        result = paired_difference(
            {"a": [10_000, 20_000], "b": [10_000, 20_000]},
            {"a": [5_000, 5_000], "b": [5_000, 5_000]},
        )
        assert result.mean_difference == pytest.approx(10_000)
