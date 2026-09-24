"""The reports.

Port of ``scripts/baseline.ts``, ``shapes.ts``, ``power.ts`` and
``compare.ts``. Each function returns the text it would print rather than
printing it, so the formatting is testable — the TypeScript versions wrote
straight to the console and their layout was checked by reading it.

Every number here is deliberately reported as ``s/n = p% [low, high]``
rather than as a bare percentage. The bracket is the part that stops a later
batch scoring ten points higher from being mistaken for progress.
"""

from __future__ import annotations

import math
from collections import defaultdict

from .db import Run, Snapshot
from .stats import (
    format_interval,
    minimum_detectable_effect,
    paired_difference,
    trials_for_width,
    variance_split,
    wilson_interval,
)

__all__ = ["baseline", "shapes", "power", "compare"]

TIERS = ["trivial", "simple", "moderate", "complex", "adversarial"]

# ASCII ONLY IN REPORT OUTPUT.
#
# This is the resolution to a bug chased through two languages.
#
# `npm run shapes` appeared to drop rows — a shape's run count simply not
# printed, the surrounding lines intact. I blamed carriage returns in
# captured compiler output, sanitised it, and the rows kept vanishing. Then
# the Python port did the same thing on a different line, with clean ASCII
# strings it had built itself.
#
# Redirecting to a file settled it. Every line was there. The terminal was
# the problem: PowerShell's console renders `·` as `V%`, `–` and `—` as
# replacement characters, and a mangled multi-byte sequence takes the rest
# of its line with it. Every line that disappeared contained a `·`.
#
# So the reports use ASCII. A report is read in a terminal, and one that
# renders wrong in the terminal it is read in is broken however correct its
# bytes are — which is the same argument as the rest of this project,
# applied to presentation instead of to data.
SEP = " - "        # was ·
DASH = "-"         # was – (en dash)
PLUSMINUS = "+/-"  # was ±
WARN = "!"         # was ⚠


def _ascii(text: str) -> str:
    """Fold captured output down to ASCII for display.

    The constants above fix the text this module writes. They do nothing
    about text it quotes — and compiler output is full of non-ASCII:
    Next prints `⨯` before a build failure, tsc uses smart quotes, npm
    emits box-drawing characters.

    A failure shape's evidence line vanished from the terminal for exactly
    this reason, one run after the constants went in: the report was clean
    and the thing it was quoting was not.

    `?` rather than dropping the character, so the reader can see that
    something was there. The signature is unaffected — identity comes from
    `normalise`, which runs on the original text. This is display only.
    """
    return text.encode("ascii", errors="replace").decode("ascii")


def _seconds(ms: float | None) -> str:
    if ms is None or not math.isfinite(ms):
        return "--"
    return f"{ms / 1000:.1f}s"


def _signed(ms: float) -> str:
    if not math.isfinite(ms):
        return "--"
    return f"{'+' if ms >= 0 else ''}{ms / 1000:.1f}s"


def _percent(value: float) -> str:
    return "--" if math.isnan(value) else f"{value * 100:.1f}%"


def _difficulty_of(case_id: str | None) -> str | None:
    """Difficulty from the case id prefix.

    The TypeScript version imported the golden set and looked the case up.
    Here the prefix is the source, because the analysis layer reads a
    snapshot and should not need the case definitions to interpret it — a
    report that breaks when `evals/cases.ts` moves is coupled to something
    it has no reason to know about.
    """
    if not case_id:
        return None
    prefix = case_id.split("-")[0]
    return prefix if prefix in TIERS else None


def baseline(snapshot: Snapshot, version: str | None = None, level: float = 0.95) -> str:
    """Build success rate with the honest range around it."""
    out: list[str] = []

    # Only runs with a definite build verdict count. `build_succeeded is
    # None` means the check could not decide — a timeout, a dead sandbox, a
    # filesystem fault. Those are not failures, and letting them into the
    # denominator would quietly deflate every rate on this page.
    runs = [
        r
        for r in snapshot.for_version(version)
        if r.source == "EVAL" and r.build_succeeded is not None
    ]

    if not runs:
        return "No EVAL runs with a build result in this snapshot."

    out.append("")
    out.append("GENERATION QUALITY")
    out.append(
        f"{round(level * 100)}% confidence"
        + (f"{SEP}config {version}" if version else "")
        + f"{SEP}snapshot {snapshot.exported_at[:19]}"
    )

    # Mixed configurations are not a baseline. Runs from different agent
    # configs answer different questions, and averaging them produces a
    # number that describes nothing that ever existed.
    versions = {r.config_version or "(unversioned)" for r in runs}
    if version is None and len(versions) > 1:
        out.append("")
        out.append(
            f"  {WARN} {len(versions)} agent configurations mixed into these numbers:"
        )
        out.append(f"    {', '.join(sorted(versions))}")
        out.append("    They answer different questions, so the averages below")
        out.append("    describe nothing that ever ran. Pass --version to pick one.")

    out.append("")

    # ---- two signals, separately ----

    typechecked = [r for r in runs if r.typecheck_succeeded is not None]
    typecheck_ok = sum(1 for r in typechecked if r.typecheck_succeeded)
    bundle_ok = sum(1 for r in runs if r.build_succeeded)

    overall = wilson_interval(bundle_ok, len(runs), level)

    out.append(
        f"  typecheck      {format_interval(wilson_interval(typecheck_ok, len(typechecked), level))}"
    )
    out.append(f"  bundle         {format_interval(overall)}")

    # Where the two disagree is the interesting part. Code that bundles but
    # does not typecheck is the shape most likely to reach a user looking
    # fine and break later.
    bundles_not_types = sum(
        1 for r in runs if r.build_succeeded and r.typecheck_succeeded is False
    )
    types_not_bundle = sum(
        1 for r in runs if r.typecheck_succeeded and r.build_succeeded is False
    )

    if bundles_not_types or types_not_bundle:
        out.append("")
        out.append("  where they disagree")
        out.append(f"    bundles, fails typecheck   {bundles_not_types}")
        out.append(f"    typechecks, fails bundle   {types_not_bundle}")

    # ---- per difficulty ----

    out.append("")
    out.append("  by difficulty")
    for tier in TIERS:
        tier_runs = [r for r in runs if _difficulty_of(r.case_id) == tier]
        if not tier_runs:
            out.append(f"    {tier:<13}no data")
            continue
        tier_ok = sum(1 for r in tier_runs if r.build_succeeded)
        out.append(
            f"    {tier:<13}{format_interval(wilson_interval(tier_ok, len(tier_runs), level))}"
        )

    # ---- what the old heuristic would have claimed ----

    claimed = sum(1 for r in runs if r.has_summary)
    false_pass = sum(1 for r in runs if r.has_summary and not r.build_succeeded)

    out.append("")
    out.append(f"  the old signal said {claimed}/{len(runs)} succeeded")
    out.append(
        f"  of those, {false_pass} did not compile "
        f"{format_interval(wilson_interval(false_pass, claimed, level))}"
    )
    out.append("")
    out.append("  ^ how often the app told a user it worked on code that does not build.")

    # ---- agent time, not wall time ----

    out.extend(_timing_section(runs))

    # ---- honesty about what this sample can resolve ----

    needed = trials_for_width(0.2, level)
    width = overall.upper - overall.lower

    out.append("")
    out.append(f"  interval width  {width * 100:.1f} points")
    out.append(
        f"  a {PLUSMINUS}10 point interval needs about {needed} runs; "
        f"this batch has {len(runs)}."
    )

    if len(runs) < needed:
        out.append("")
        out.append(
            f"  So: differences smaller than roughly {round(width * 100)} points"
        )
        out.append("  cannot be distinguished from noise at this sample size.")

    out.extend(_exclusions_section(snapshot, version))
    out.append("")

    return "\n".join(out)


def _timing_section(runs: list[Run]) -> list[str]:
    """AGENT TIME, NOT WALL TIME. This distinction is the whole metric.

    `duration_ms` is the full run: sandbox creation, the agent loop, then
    typecheck and bundle. The checks alone measure 11-60 seconds — the same
    order as any effect an intervention could plausibly have — so comparing
    raw wall time compares the harness as much as the agent.
    """
    timed = sorted(
        r.agent_ms for r in runs if r.typecheck_succeeded and r.agent_ms is not None
    )
    dropped = sum(1 for r in runs if r.typecheck_succeeded) - len(timed)

    if len(timed) < 3:
        return [
            "",
            "  Not enough runs carry both a wall time and check durations to",
            "  separate agent time from harness time. Raw wall time is not",
            "  reported instead: it would compare the checks as much as the",
            "  agent, and look like a result.",
        ]

    def at(fraction: float) -> float:
        return timed[min(len(timed) - 1, int(len(timed) * fraction))]

    mean = sum(timed) / len(timed)

    out = [
        "",
        "  agent time to a passing generation",
        "  (wall time minus typecheck and bundle)",
        f"    median   {_seconds(at(0.5))}",
        f"    p10-p90  {_seconds(at(0.1))} {DASH} {_seconds(at(0.9))}",
        f"    mean     {_seconds(mean)}   over {len(timed)} run(s)",
    ]

    if dropped:
        out.append("")
        out.append(
            f"    {dropped} passing run(s) excluded - no check duration recorded,"
        )
        out.append("    so agent time cannot be separated from wall time.")

    out.append("")
    out.append("    Continuous, so a change here is detectable at this sample size")
    out.append("    where a change in the pass rate is not. Latency is a proxy for")
    out.append("    cost, not a price: token counts are unavailable because the")
    out.append("    agent framework reports usage only on its streaming interface.")

    return out


def _exclusions_section(snapshot: Snapshot, version: str | None) -> list[str]:
    """Excluded runs, broken down by reason.

    A single "25 excluded" number is not diagnosable. Runs stuck RUNNING,
    builds that could not be judged, and generations that produced nothing
    are three different problems with three different fixes.
    """
    scope = [r for r in snapshot.for_version(version) if r.source == "EVAL"]

    still_running = sum(1 for r in scope if r.status == "RUNNING")
    unjudged = sum(
        1 for r in scope if r.build_attempted and r.build_succeeded is None
    )
    nothing_produced = sum(
        1 for r in scope if r.status == "FAILED" and not r.build_attempted
    )

    total = still_running + unjudged + nothing_produced
    if total == 0:
        return []

    return [
        "",
        f"  {total} run(s) excluded - absences of data, not failures:",
        f"    {still_running} still RUNNING (never finished)",
        f"    {unjudged} build ran but could not be judged",
        f"    {nothing_produced} produced nothing to build",
    ]


def shapes(snapshot: Snapshot, version: str | None = None) -> str:
    """Every distinct failure shape, most frequent first."""
    from .taxonomy import UNCLASSIFIED, tally

    scope = [r for r in snapshot.for_version(version) if r.source == "EVAL"]

    runs = [
        r
        for r in scope
        if r.typecheck_succeeded is False
        or r.build_succeeded is False
        or (r.status == "FAILED" and not r.build_attempted)
    ]

    # A DELIBERATE NARROWING FROM THE TYPESCRIPT ORIGINAL.
    #
    # `shapes.ts` selected `status: "FAILED"` outright, which pulls in runs
    # that produced a working build and then failed afterwards — during
    # sandbox release, or while recording the result. Those have no code
    # failure to shape, so `classify` fell through to their `errorMessage`
    # and filed them under "Agent produced no summary". Two runs in the v7
    # batch were labelled that way despite having compiled and bundled.
    #
    # A taxonomy of code failures should not contain runs whose code was
    # fine. But they are not silently dropped either — that is the other
    # half of the same mistake — so they are counted and named below.
    failed_after_building = [
        r
        for r in scope
        if r.status == "FAILED"
        and r.build_attempted
        and r.build_succeeded is not None
        and r not in runs
    ]

    if not runs:
        return "No failures to classify."

    groups = tally([(r.id, r.failure_text) for r in runs])
    case_for = {r.id: r.case_id or "?" for r in runs}

    out = ["", "FAILURE SHAPES"]
    out.append(f"{len(runs)} code failure(s) in {len(groups)} shape(s)")
    out.append("")

    for index, group in enumerate(groups, start=1):
        cases = sorted({case_for[i] for i in group.run_ids} - {"?"})

        # Built as one string and appended once. The TypeScript version
        # printed three separate lines per shape, and a stray control
        # character in one of them overwrote the others — which looked
        # exactly like the report dropping rows.
        block = f"  {index:>2}. {_ascii(group.shape.signature)}\n"
        block += f"      {group.count} run(s){SEP}{group.shape.source}"
        if cases:
            block += f"{SEP}{', '.join(cases)}"
        block += f"\n      e.g. {_ascii(group.shape.evidence)[:120]}"
        out.append(block)
        out.append("")

    if failed_after_building:
        out.append(
            f"  {len(failed_after_building)} run(s) failed AFTER producing a build "
            "that was judged."
        )
        out.append("  Excluded above: their code has no failure shape, and filing")
        out.append("  them under an agent failure would describe the wrong thing.")
        out.append("  The failure is in the run, not the generation.")
        out.append("")

    unclassified = next(
        (g for g in groups if g.shape.signature == UNCLASSIFIED), None
    )
    if unclassified:
        out.append(f"  {unclassified.count} failure(s) unclassified. These are the ones")
        out.append("  nobody has looked at yet - worth reading before adding a pattern,")
        out.append("  because a bucket that absorbs everything reports a tidy taxonomy")
        out.append("  and hides the interesting cases.")
        out.append("")

    return "\n".join(out)


def _agent_times_by_case(runs: list[Run]) -> dict[str, list[float]]:
    by_case: dict[str, list[float]] = defaultdict(list)
    for run in runs:
        if run.case_id and run.typecheck_succeeded and run.agent_ms is not None:
            by_case[run.case_id].append(float(run.agent_ms))
    return dict(by_case)


def power(
    snapshot: Snapshot,
    version: str | None = None,
    cases: int = 24,
    level: float = 0.95,
) -> str:
    """Can this experiment detect anything?

    Free. Answers the question that should be asked before spending on a
    batch, not after: is the effect we are looking for larger than the noise
    this design faces?
    """
    runs = [r for r in snapshot.for_version(version) if r.source == "EVAL"]
    by_case = _agent_times_by_case(runs)
    split = variance_split(by_case)

    out = ["", "CAN THIS EXPERIMENT RESOLVE ANYTHING - agent time"]
    out.append(
        f"{round(level * 100)}% confidence, 80% power"
        + (f"{SEP}config {version}" if version else "")
    )

    if split.observations < 4:
        out.append("")
        out.append("  Not enough runs with agent time recorded.")
        return "\n".join(out)

    out.append("")
    out.append(f"  {split.observations} run(s) across {split.groups} case(s)")
    out.append(f"  mean agent time            {_seconds(split.grand_mean)}")
    out.append("")
    out.append("  where the spread comes from")
    out.append(f"    between cases   {_seconds(split.between_sd)}  sd of case means")
    out.append(
        f"    within a case   {_seconds(split.within_sd)}  sd of repeats, from "
        f"{split.groups_with_repeats} case(s) run more than once"
    )
    out.append(f"    ignoring cases  {_seconds(split.total_sd)}  sd of everything")

    unpaired = minimum_detectable_effect(split.total_sd, cases, level)
    paired = minimum_detectable_effect(split.within_sd, cases, level)

    out.append("")
    out.append(f"  smallest detectable change, {cases} runs per arm")
    out.append(
        f"    unpaired  {_seconds(unpaired):>7}  {unpaired / split.grand_mean * 100:.0f}% of the mean"
    )

    if math.isfinite(paired):
        out.append(
            f"    paired    {_seconds(paired):>7}  {paired / split.grand_mean * 100:.0f}% of the mean"
        )
    else:
        out.append("    paired    --       no case has been run twice under one config,")
        out.append("                       so within-case noise is unmeasured")

    out.append("")
    out.append("  Unpaired asks the intervention to beat the difference between a")
    out.append("  trivial case and an adversarial one. It never had to: both arms")
    out.append("  run the same cases, so pairing on case id cancels that term.")

    if math.isfinite(paired) and paired / split.grand_mean > 0.25:
        out.append("")
        out.append(
            f"  {WARN} Even paired, the bar is "
            f"{paired / split.grand_mean * 100:.0f}% of the mean."
        )
        out.append("  An intervention that plausibly moves agent time by less than")
        out.append("  that will report 'no effect' regardless of whether it had one,")
        out.append("  and that is a property of this design rather than a finding")
        out.append("  about the intervention.")

    # What repeats would buy. Resolution goes as √n, so this is usually an
    # argument against them: doubling the spend buys 1.4x.
    if math.isfinite(paired):
        out.append("")
        for repeats in (2, 3):
            with_repeats = minimum_detectable_effect(
                split.within_sd, cases * repeats, level
            )
            out.append(
                f"  {repeats} run(s) per case per arm ({cases * repeats * 2} generations total): "
                f"{_seconds(with_repeats)}, {with_repeats / split.grand_mean * 100:.0f}% of the mean"
            )

    # The caveat that has been right twice.
    #
    # At 9 cases with repeats this estimate said 7.6s; at 21 it said 11.5s.
    # The thin version was optimistic both times, and printing the basis is
    # what stopped the optimistic number from being taken at face value.
    if split.groups_with_repeats < 5:
        out.append("")
        out.append(
            f"  Within-case spread rests on {split.groups_with_repeats} case(s) with repeats."
        )
        out.append("  That is a thin basis for a power estimate, so treat the paired")
        out.append("  figure as indicative. It is still better than assuming the")
        out.append("  unpaired one applies when it does not.")

    out.append("")

    return "\n".join(out)


def compare(
    snapshot: Snapshot, a: str, b: str, level: float = 0.95
) -> str:
    """Compare two configurations, paired on the case."""
    left_runs = [r for r in snapshot.runs if r.config_version == a and r.source == "EVAL"]
    right_runs = [r for r in snapshot.runs if r.config_version == b and r.source == "EVAL"]

    out = [
        "",
        f"A: {a}",
        f"B: {b}",
        f"{round(level * 100)}% confidence, paired on case id",
        "",
    ]

    # Quality first, on purpose. An intervention that speeds the agent up by
    # degrading what it produces is a regression wearing a win, and the
    # latency figure below would not show it.
    def rate(runs: list[Run]):
        judged = [r for r in runs if r.build_succeeded is not None]
        ok = sum(1 for r in judged if r.typecheck_succeeded)
        return wilson_interval(ok, len(judged), level)

    out.append("  typecheck rate")
    out.append(f"    A  {format_interval(rate(left_runs))}")
    out.append(f"    B  {format_interval(rate(right_runs))}")

    left = _agent_times_by_case(left_runs)
    right = _agent_times_by_case(right_runs)
    result = paired_difference(left, right, level)

    if result.pairs < 2:
        out.append("")
        out.append(f"  Only {result.pairs} case(s) passed under both configs.")
        out.append("  Cases are dropped rather than filled in: substituting a value")
        out.append("  for a missing arm assumes the thing being measured.")
        return "\n".join(out)

    out.append("")
    out.append(f"  agent time, A minus B, over {result.pairs} paired case(s)")
    out.append(f"    mean difference  {_signed(result.mean_difference)}")
    out.append(f"    interval         [{_signed(result.lower)}, {_signed(result.upper)}]")
    out.append("")

    if result.resolved:
        faster = "B" if result.mean_difference > 0 else "A"
        out.append(f"  RESOLVED. {faster} is faster, and the interval excludes zero.")
        out.append("  Check the typecheck rates above before calling it an improvement.")
    else:
        bound = max(abs(result.lower), abs(result.upper))
        out.append("  NOT RESOLVED. The interval includes zero, so the sign of the")
        out.append("  effect is unknown - B may be faster, slower, or identical.")
        out.append("")
        out.append("  This is not the same as 'no effect', and must not be written up")
        out.append(f"  as one. Any effect smaller than about {_seconds(bound)} is")
        out.append("  invisible to this design.")

    if result.dropped:
        out.append("")
        out.append(
            f"  {len(result.dropped)} case(s) dropped - passed under one config only:"
        )
        out.append(f"    {', '.join(result.dropped)}")

    out.append("")
    return "\n".join(out)
