#!/usr/bin/env python3
"""Cut-adjacent boundary-class adjudication (Amendment A2, w5h4) — the pure
source-side classifier for the VLM scorecard protocol.

THE RULE (frozen acceptance doc, Amendment A2 — see
docs/testing/source-preserving-reality-acceptance.md, appended):

  A scorecard sample is classified `cut-boundary-class` BEFORE scorecard
  assignment iff the temporal-pair window it evaluates (primary frame + its
  frozen 0.2 s partner, per the scorecard's own sample design) intersects
  the pre-cut window of a SOURCE-side cut event.

  - Cut events: the frozen per-clip cut records (the source's own detected
    cuts, e.g. b8 [189, 475, 550, 862, 979, 982] from the corpus record /
    cuts_deep inputCuts), clustered with the scorecard's frozen CLUSTER_GAP
    (cuts within 5 frames are one event — micro-shots).
  - Pre-cut window of event [start, end]:
      [start - W_PRE, start - 1], W_PRE = CUT_OFFSET + TEMPORAL_DELTA (3+5=8)
    — exactly the backward reach of the frozen pre-sample design: a pre
    sample at start-3 pairs backward to start-8, so every frame a pre
    sample's temporal judgment can touch lies inside this window; the
    source's transition completes AT the cut (the frames strictly before
    it are the transition-in-progress region the renderer must preserve).
  - No post-cut window: a post sample at end+3 pairs FORWARD into the new
    shot — post-cut frames are new-shot content, not transition content.

LAWS honored (Amendment A2 no-laundering conditions):
  - SOURCE-SIDE ONLY: the classification is a pure function of the frozen
    cut records + the frozen sample design. It never reads the renderer
    output, never reads a VLM verdict, and is computed BEFORE any VLM call
    (pre-adjudication, w4b precedent). A sample is boundary because the
    SOURCE cut there — not because the score was bad.
  - DETERMINISTIC + RE-RUNNABLE: same cut records + same sample set -> the
    exact same classification (test_cut_boundary.py).
  - The adjudication reclassifies ONLY the critical-artifact ATTRIBUTION of
    boundary samples (limbs+players -> the named boundary class); their
    axis scores still count in the means, the raw verdicts stay recorded
    verbatim, and the raw aggregate/tierClaim stay in the record.

Usage (module):  from cut_boundary import classify_samples
                 cls = classify_samples(samples, cuts)   # samples from
                                                        # vlm_scorecard.samples()
Usage (CLI):     python3 cut_boundary.py [--cuts 189,475,...] [--json out.json]
                 [--samples-json samples.json]   # [{"id","kind","t"},...]
                                              # default: the frozen 15-sample
                                              # protocol set
"""

from __future__ import annotations

import argparse
import json
import sys

# Frozen protocol constants (vlm_scorecard.py — reused, never re-tuned):
FPS = 25
CUT_OFFSET = 3              # frames before/after a cut (pre = start-3)
CLUSTER_GAP = 5             # cuts within this many frames are one event
TEMPORAL_DELTA = 5          # frames (0.2 s @ 25 fps pair partner)
W_PRE = CUT_OFFSET + TEMPORAL_DELTA  # 8: full backward reach of a pre sample

BOUNDARY_CLASS = "source-pre-cut-transition"
DEFAULT_CUTS = [189, 475, 550, 862, 979, 982]  # frozen b8 corpus cut record


def cluster_cuts(cuts: list[int], gap: int = CLUSTER_GAP) -> list[list[int]]:
    """Cluster the frozen cut records into events (the scorecard's rule)."""
    events: list[list[int]] = []
    for f in cuts:
        if events and f - events[-1][1] <= gap:
            events[-1][1] = f
        else:
            events.append([f, f])
    return events


def pre_cut_windows(events: list[list[int]],
                    w_pre: int = W_PRE) -> list[dict]:
    """Pre-cut boundary window per cut event: [start-w_pre, start-1]."""
    return [{"event": [start, end],
             "window": [start - w_pre, start - 1]} for start, end in events]


def sample_pair_frames(sample: dict, fps: int = FPS,
                       delta: int = TEMPORAL_DELTA) -> tuple[int, int]:
    """(frame, partner) pair a sample's temporal judgment evaluates.

    Mirrors the frozen vlm_scorecard.py extraction rule exactly: a
    cut-adjacent `pre` sample pairs BACKWARD (the pair never crosses the
    source cut); everything else pairs FORWARD.
    """
    frame = round(sample["t"] * fps)
    if sample.get("kind") == "cut-adjacent" and sample["id"].endswith("pre"):
        partner = frame - delta
    else:
        partner = frame + delta
    return frame, partner


def classify_samples(samples: list[dict], cuts: list[int],
                     fps: int = FPS, delta: int = TEMPORAL_DELTA,
                     cluster_gap: int = CLUSTER_GAP,
                     w_pre: int = W_PRE) -> list[dict]:
    """Classify every sample — pure, deterministic, source-side only.

    Returns one record per sample: the pair window, the boundary flag, and
    the matched source-side windows (full transparency, w4b style).
    """
    windows = pre_cut_windows(cluster_cuts(cuts, cluster_gap), w_pre)
    out = []
    for s in samples:
        frame, partner = sample_pair_frames(s, fps, delta)
        lo, hi = min(frame, partner), max(frame, partner)
        matched = [w for w in windows
                   if lo <= w["window"][1] and hi >= w["window"][0]]
        out.append({
            "sample": s["id"], "kind": s.get("kind"),
            "frame": frame, "partner": partner,
            "pairWindow": [lo, hi],
            "boundaryClass": BOUNDARY_CLASS if matched else None,
            "isBoundary": bool(matched),
            "matchedSourceWindows": matched,
        })
    return out


def _frozen_samples() -> list[dict]:
    """The frozen 15-sample protocol set (vlm_scorecard.samples())."""
    sys.path.insert(0, __file__.rsplit("/", 1)[0])
    from vlm_scorecard import samples  # noqa: PLC0415
    return samples()


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--cuts", default=",".join(str(c) for c in DEFAULT_CUTS),
                    help="frozen source-side cut frames (comma list)")
    ap.add_argument("--samples-json", default=None,
                    help="sample list JSON ([{id,kind,t},...]); default = "
                         "the frozen 15-sample protocol set")
    ap.add_argument("--json", default=None, help="output JSON path")
    a = ap.parse_args()

    cuts = [int(c) for c in a.cuts.split(",") if c.strip()]
    if a.samples_json:
        samples = json.loads(open(a.samples_json).read())
    else:
        samples = _frozen_samples()

    classified = classify_samples(samples, cuts)
    result = {
        "amendment": "A2 (w5h4) — cut-adjacent boundary-class adjudication",
        "rule": {
            "cutEvents": cluster_cuts(cuts),
            "preCutWindows": pre_cut_windows(cluster_cuts(cuts)),
            "wPre": W_PRE,
            "wPreDerivation": "CUT_OFFSET (3) + TEMPORAL_DELTA (5) — the "
                              "frozen scorecard sample design's own backward "
                              "reach; no new constants",
            "postCutWindow": None,
            "clusterGap": CLUSTER_GAP,
            "sourceSideOnly": True,
        },
        "cutRecordSource": "frozen corpus cut record / cuts_deep inputCuts",
        "samples": classified,
        "boundarySamples": [r["sample"] for r in classified if r["isBoundary"]],
    }
    txt = json.dumps(result, indent=1)
    if a.json:
        with open(a.json, "w") as f:
            f.write(txt + "\n")
    print(txt)
    return 0


if __name__ == "__main__":
    sys.exit(main())
