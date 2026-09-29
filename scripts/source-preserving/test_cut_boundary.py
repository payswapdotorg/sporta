#!/usr/bin/env python3
"""Tests for cut_boundary.py (Amendment A2 — the pure window rule).

Run: python3 scripts/source-preserving/test_cut_boundary.py
Exit 0 = all assertions pass. No network, no VLM, no renderer output —
the rule is pure (frozen cut records + frozen sample design in, the
classification out; determinism asserted directly).
"""

from __future__ import annotations

import sys

sys.path.insert(0, __file__.rsplit("/", 1)[0])

from cut_boundary import (  # noqa: E402
    BOUNDARY_CLASS,
    CLUSTER_GAP,
    CUT_OFFSET,
    FPS,
    TEMPORAL_DELTA,
    W_PRE,
    classify_samples,
    cluster_cuts,
    pre_cut_windows,
    sample_pair_frames,
)
from vlm_scorecard import samples as frozen_samples  # noqa: E402

B8_CUTS = [189, 475, 550, 862, 979, 982]  # frozen b8 corpus cut record

CHECKS = 0


def check(name: str, cond: bool) -> None:
    global CHECKS
    CHECKS += 1
    if not cond:
        raise AssertionError(f"FAIL: {name}")
    print(f"  ok: {name}")


def main() -> int:
    print("1. constants derive from the frozen protocol (no new tuning)")
    check("W_PRE == CUT_OFFSET + TEMPORAL_DELTA == 8",
          W_PRE == CUT_OFFSET + TEMPORAL_DELTA == 8)
    check("CLUSTER_GAP/FPS/TEMPORAL_DELTA == frozen scorecard values",
          (CLUSTER_GAP, FPS, TEMPORAL_DELTA) == (5, 25, 5))

    print("2. frozen b8 classification (the w5h4 run's exact set)")
    cls = classify_samples(frozen_samples(), B8_CUTS)
    got = [r["sample"] for r in cls if r["isBoundary"]]
    check("boundary == exactly the 5 pre-cut samples",
          got == ["c189pre", "c475pre", "c550pre", "c862pre", "c979pre"])
    check("no post/fixed sample is boundary",
          not any(r["isBoundary"] for r in cls
                  if r["sample"].endswith("post") or r["kind"] == "fixed"))
    check("c979pre pair [971,976] inside the 979/982 cluster pre window",
          next(r for r in cls if r["sample"] == "c979pre")["matchedSourceWindows"]
          == [{"event": [979, 982], "window": [971, 978]}])
    check("c189pre pair [181,186] inside the cut-189 pre window [181,188]",
          next(r for r in cls if r["sample"] == "c189pre")["matchedSourceWindows"]
          == [{"event": [189, 189], "window": [181, 188]}])

    print("3. pair windows mirror the frozen vlm_scorecard extraction rule")
    for s in frozen_samples():
        f, p = sample_pair_frames(s)
        if s["kind"] == "cut-adjacent" and s["id"].endswith("pre"):
            expected = (round(s["t"] * FPS), round((s["t"] - 0.2) * FPS))
        else:
            expected = (round(s["t"] * FPS), round((s["t"] + 0.2) * FPS))
        check(f"{s['id']} pair == {expected}", (f, p) == expected)

    print("4. determinism (same inputs -> identical classification)")
    check("classify twice deep-equal",
          classify_samples(frozen_samples(), B8_CUTS)
          == classify_samples(frozen_samples(), B8_CUTS))

    print("5. generality (positional rule, not sample-kind special-casing)")
    # a fixed-t sample whose pair lands in a pre-cut window IS boundary
    fixed_near_cut = [{"id": "t8s", "kind": "fixed", "t": 8.0}]
    check("fixed sample pair [200,205] in cut-208 pre window -> boundary",
          [r["isBoundary"] for r in classify_samples(fixed_near_cut, [208])]
          == [True])
    # a fixed sample far from every cut is not
    check("fixed sample far from cuts -> not boundary",
          [r["isBoundary"] for r in classify_samples(fixed_near_cut, [400])]
          == [False])
    # a post sample of its own cut pairs forward into the new shot -> never
    # boundary for that cut
    post = [{"id": "c100post", "kind": "cut-adjacent", "t": 103 / FPS}]
    check("post sample pair [103,108] never enters the cut-100 pre window",
          [r["isBoundary"] for r in classify_samples(post, [100])] == [False])
    # window edges: [start-8, start-1] inclusive
    edge_in = [{"id": "x", "kind": "cut-adjacent", "t": 199 / FPS}]
    check("pair [199,194] reaching start-6 -> boundary (window interior)",
          [r["isBoundary"] for r in classify_samples(edge_in, [205])] == [True])
    edge_hi = [{"id": "y", "kind": "fixed", "t": 204 / FPS}]
    check("pair [204,209] touching start-1 -> boundary (window edge)",
          [r["isBoundary"] for r in classify_samples(edge_hi, [205])] == [True])
    edge_out = [{"id": "z", "kind": "fixed", "t": 196 / FPS}]
    check("pair [196,201] overlapping window [197,204] -> boundary",
          [r["isBoundary"] for r in classify_samples(edge_out, [205])] == [True])
    far_out = [{"id": "w", "kind": "fixed", "t": 191 / FPS}]
    check("pair [191,196] fully below window [197,204] -> NOT boundary",
          [r["isBoundary"] for r in classify_samples(far_out, [205])] == [False])

    print("6. clustering (the frozen scorecard CLUSTER_GAP rule)")
    check("979/982 cluster into one event",
          cluster_cuts(B8_CUTS) == [[189, 189], [475, 475], [550, 550],
                                    [862, 862], [979, 982]])
    check("pre windows anchor at the cluster START",
          pre_cut_windows([[979, 982]]) == [{"event": [979, 982],
                                             "window": [971, 978]}])
    check("boundary class name is the named A2 class",
          BOUNDARY_CLASS == "source-pre-cut-transition")

    print(f"\nALL {CHECKS} CHECKS PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
