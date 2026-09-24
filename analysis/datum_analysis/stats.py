"""Turning counts into claims you can defend.

Port of ``src/lib/stats.ts``. The TypeScript version is deleted once this
one agrees with it on the shared fixtures — two implementations of the same
statistics is two places to be wrong, and the one nobody runs drifts.

WHY A BARE PERCENTAGE IS NOT AN ANSWER

"12 of 20 built, so 60%" describes those twenty runs exactly. It says almost
nothing about the twenty-first. The honest range around 12/20 runs from
roughly 39% to 78%, so a later batch scoring 70% is not an improvement — it
is the same claim wearing a different number.

Reporting 60% and 70% as though the second beat the first is the single most
common way an eval suite produces confident nonsense. Everything in this
module exists to make that mistake hard.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

__all__ = [
    "Interval",
    "wilson_interval",
    "format_interval",
    "overlaps",
    "trials_for_width",
    "VarianceSplit",
    "variance_split",
    "minimum_detectable_effect",
    "PairedResult",
    "paired_difference",
]


# z for a two-sided normal interval.
#
# Only the handful of levels anyone actually uses. Interpolating an
# arbitrary level would invite passing 0.9137 and believing the result.
_Z: dict[float, float] = {
    0.80: 1.2815515655446004,
    0.90: 1.6448536269514722,
    0.95: 1.959963984540054,
    0.99: 2.5758293035489004,
}


def _z_for(level: float) -> float:
    try:
        return _Z[round(level, 4)]
    except KeyError:
        supported = ", ".join(str(k) for k in _Z)
        raise ValueError(
            f"Unsupported confidence level {level}. Use one of: {supported}."
        ) from None


@dataclass(frozen=True)
class Interval:
    """A proportion, with the honest range around it."""

    successes: int
    trials: int
    #: Point estimate. Real, and on its own, misleading.
    point: float
    lower: float
    upper: float
    level: float


def wilson_interval(successes: int, trials: int, level: float = 0.95) -> Interval:
    """Wilson score interval.

    WHY WILSON AND NOT THE OBVIOUS ONE

    The textbook interval is ``p ± z·sqrt(p(1-p)/n)`` — the Wald interval. It
    is easier to write and wrong exactly where this project needs it:

    - At 0/20 it gives 0% ± 0. A zero-width interval, claiming certainty that
      the true rate is exactly zero, from twenty observations. The
      adversarial tier is deliberately full of cases expected to score 0, so
      this is not an edge case here, it is the common case.
    - At 20/20 it does the same in reverse.
    - For small n it is too narrow generally, so differences look real when
      they are not.

    Wilson never collapses to zero width, never runs past 0 or 1, and behaves
    at small samples.
    """
    if successes < 0 or trials < 0 or successes > trials:
        raise ValueError(f"Invalid counts: {successes} of {trials}")

    # No trials means no estimate. Returning 0 here would let an empty run
    # report a 0% success rate, which reads as a catastrophic result rather
    # than as an absence of data.
    if trials == 0:
        return Interval(successes, trials, math.nan, 0.0, 1.0, level)

    z = _z_for(level)
    p = successes / trials
    z2 = z * z

    denominator = 1 + z2 / trials
    centre = (p + z2 / (2 * trials)) / denominator
    spread = (z / denominator) * math.sqrt(
        (p * (1 - p)) / trials + z2 / (4 * trials * trials)
    )

    return Interval(
        successes=successes,
        trials=trials,
        point=p,
        lower=max(0.0, centre - spread),
        upper=min(1.0, centre + spread),
        level=level,
    )


def _percent(value: float) -> str:
    return "—" if math.isnan(value) else f"{value * 100:.1f}%"


def format_interval(interval: Interval) -> str:
    """``9/20 = 45.0%  [25.8%, 65.8%]``"""
    if interval.trials == 0:
        return "no data"

    return "  ".join(
        [
            f"{interval.successes}/{interval.trials}",
            f"= {_percent(interval.point):>6}",
            f"[{_percent(interval.lower)}, {_percent(interval.upper)}]",
        ]
    )


def overlaps(a: Interval, b: Interval) -> bool:
    """Could these two results plausibly come from the same underlying rate?

    Overlapping intervals mean the difference is not established — which is
    weaker than proving they are the same, and is the honest thing to say
    from two batches.

    Non-overlap is the conservative direction: decent evidence of a real
    difference. Overlap means "not shown", never "no effect".
    """
    return a.trials > 0 and b.trials > 0 and a.lower <= b.upper and b.lower <= a.upper


def trials_for_width(width: float, level: float = 0.95) -> int:
    """How many trials before an interval is narrower than ``width``?

    Worth knowing before spending twenty minutes on a batch. At 50% — the
    widest case — reaching ±10% takes 97 runs.

    Rounds up. The commonly quoted figure for ±10% is 96, which is 96.04
    rounded to nearest; 96 runs leaves the interval fractionally wider than
    the one that was asked for.
    """
    z = _z_for(level)
    # Worst case p = 0.5, where the interval is widest.
    return math.ceil((z * z * 0.25) / ((width / 2) ** 2))


# --------------------------------------------------------------------- #
# Continuous measures: can this design resolve anything?
# --------------------------------------------------------------------- #


@dataclass(frozen=True)
class VarianceSplit:
    #: Number of groups (cases) with at least one observation.
    groups: int
    #: Number with at least two, which is what within-group needs.
    groups_with_repeats: int
    observations: int
    grand_mean: float
    #: Spread of the group means around the grand mean.
    between_sd: float
    #: Pooled spread of observations around their own group mean.
    within_sd: float
    #: Spread ignoring groups entirely.
    total_sd: float


def _mean(xs: list[float]) -> float:
    return sum(xs) / len(xs)


def _sample_sd(xs: list[float], centre: float, dof: int) -> float:
    """Sample standard deviation, dividing by degrees of freedom.

    Dividing by the count instead would understate the spread, which here
    would understate the noise floor and make an underpowered experiment look
    adequate. That is the direction of error this module exists to avoid, so
    the conservative denominator is not optional.
    """
    if dof <= 0:
        return math.nan
    return math.sqrt(sum((x - centre) ** 2 for x in xs) / dof)


def variance_split(groups: dict[str, list[float]]) -> VarianceSplit:
    """Split spread into between-group and within-group parts.

    WHY THIS DECIDES WHETHER AN EXPERIMENT IS WORTH RUNNING

    Agent time varies for two unrelated reasons. A trivial case is fast and
    an adversarial case is slow — that is between-case variance, and it is
    enormous. The same case run twice varies too — that is within-case
    variance, and it is the only part an intervention has to beat.

    Compare two configs by throwing all runs into two buckets and the
    between-case variance lands in the noise term, even though both configs
    ran the same cases. The experiment then needs a vast effect to clear a
    bar made mostly of "trivial-01 is not complex-03".

    Pair on the case and that term cancels. Usually worth several times the
    sample size.

    Groups with a single observation still count toward the between term.
    They contribute nothing to the within term and are not pretended to.
    """
    all_values = [x for values in groups.values() for x in values]
    n = len(all_values)

    if n == 0:
        return VarianceSplit(0, 0, 0, math.nan, math.nan, math.nan, math.nan)

    grand_mean = _mean(all_values)
    group_means = [_mean(values) for values in groups.values() if values]

    with_repeats = [values for values in groups.values() if len(values) >= 2]

    # Pooled within-group: every deviation from its own group mean, with one
    # degree of freedom spent per group that contributed.
    within_deviations = [
        x - _mean(values) for values in with_repeats for x in values
    ]
    within_dof = len(within_deviations) - len(with_repeats)

    return VarianceSplit(
        groups=len(group_means),
        groups_with_repeats=len(with_repeats),
        observations=n,
        grand_mean=grand_mean,
        between_sd=_sample_sd(group_means, _mean(group_means), len(group_means) - 1)
        if group_means
        else math.nan,
        within_sd=_sample_sd(within_deviations, 0.0, within_dof),
        total_sd=_sample_sd(all_values, grand_mean, n - 1),
    )


def minimum_detectable_effect(sd: float, n: int, level: float = 0.95) -> float:
    """Smallest difference in means a two-arm comparison could detect.

    Uses 2.8 standard errors rather than 1.96 — the conventional minimum
    detectable effect at 80% power — because an effect exactly at the
    significance threshold is missed as often as it is caught.

    ``sd`` is the noise the design actually faces: total spread for an
    unpaired comparison, within-group spread for a paired one. ``n`` is
    observations per arm, or pairs.
    """
    if not math.isfinite(sd) or n <= 1:
        return math.nan
    # z for the test plus z for 80% power (0.8416).
    return (_z_for(level) + 0.8416212335729143) * sd * math.sqrt(2 / n)


@dataclass(frozen=True)
class PairedResult:
    #: Cases present in both arms.
    pairs: int
    #: Mean of (a - b). Negative means b is faster.
    mean_difference: float
    lower: float
    upper: float
    level: float
    #: False when the interval straddles zero. "Not shown" — which is not the
    #: same as "no effect", and the difference is the whole discipline.
    resolved: bool
    #: Cases that appeared in one arm only, and so contribute nothing.
    dropped: list[str]


def paired_difference(
    a: dict[str, list[float]],
    b: dict[str, list[float]],
    level: float = 0.95,
) -> PairedResult:
    """Compare two configurations case by case.

    WHY PAIRED AND NOT TWO BUCKETS

    Agent time on this golden set has a between-case standard deviation of
    roughly 53s and a within-case one of roughly 14s. Pooling every run of
    one config against every run of the other puts that 53s into the noise
    term, even though both arms ran the identical cases.

    A case present in one arm only is dropped and named. Substituting the
    other arm's mean for a missing value would quietly assume the very thing
    being measured, and a case that failed under one config and not the other
    is a result about the pass rate, not a data point about latency.
    """
    keys = sorted(set(a) | set(b))
    differences: list[float] = []
    dropped: list[str] = []

    for key in keys:
        left = a.get(key)
        right = b.get(key)

        if not left or not right:
            dropped.append(key)
            continue

        differences.append(_mean(left) - _mean(right))

    pairs = len(differences)

    if pairs < 2:
        return PairedResult(pairs, math.nan, math.nan, math.nan, level, False, dropped)

    centre = _mean(differences)
    sd = math.sqrt(sum((d - centre) ** 2 for d in differences) / (pairs - 1))
    margin = _z_for(level) * (sd / math.sqrt(pairs))

    lower = centre - margin
    upper = centre + margin

    return PairedResult(
        pairs=pairs,
        mean_difference=centre,
        lower=lower,
        upper=upper,
        level=level,
        # Straddling zero means the sign of the effect is unknown. Reporting
        # the point estimate as a result at that stage is how null results
        # become success stories.
        resolved=lower > 0 or upper < 0,
        dropped=dropped,
    )
