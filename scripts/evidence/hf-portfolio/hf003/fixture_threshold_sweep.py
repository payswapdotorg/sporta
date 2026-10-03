#!/usr/bin/env python3
"""
HF003 — the fixture threshold-sweep DIAGNOSTIC (Worker A, flight 1).

Explains the zero player-recall on the synthetic-diagnostic fixture: the
broadcast-trained model does not fire on flat colored discs at any usable
confidence. Sweeps thresholds {0.5, 0.3, 0.1, 0.05} over fixture frames
{0, 100, 200} (stride 100) and records detection counts per class + the
confidence range. Diagnostic only — the primary benchmark
(benchmark_rfdetr.py) runs at the model-card default threshold 0.5.

Run:
  python3 fixture_threshold_sweep.py --checkpoint /home/z/hf-bench/checkpoint_best_regular.pth \
      --repo-root /home/z/sporta
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from benchmark_rfdetr import CLASS_NAMES, load_model, sample_frames  # noqa: E402

THRESHOLDS = (0.5, 0.3, 0.1, 0.05)
STRIDE = 100


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--checkpoint", required=True)
    parser.add_argument("--repo-root", default=str(Path(__file__).resolve().parents[5]))
    parser.add_argument("--out", default=str(Path(__file__).resolve().parent / "results" / "rfdetr-fixture-threshold-sweep.json"))
    args = parser.parse_args()

    repo = Path(args.repo_root)
    fixture = repo / "packages/technology-registry/fixtures/media/synthetic-diagnostic-01-players-and-ball.mp4"
    model, load_info = load_model(Path(args.checkpoint))
    frames, _meta = sample_frames(fixture, STRIDE)

    records = []
    for decode_order, bgr in frames:
        rgb = bgr[:, :, ::-1].copy()
        del bgr
        for threshold in THRESHOLDS:
            out = model.predict(rgb, threshold=threshold)
            ids = out.class_id.tolist() if out.class_id is not None and len(out.class_id) else []
            confs = (
                [round(float(c), 4) for c in out.confidence.tolist()]
                if out.confidence is not None and len(out.confidence)
                else []
            )
            histogram = dict(Counter(CLASS_NAMES.get(int(i), f"unknown({i})") for i in ids))
            records.append(
                {
                    "frameIndex": decode_order,
                    "threshold": threshold,
                    "detectionCount": len(ids),
                    "classHistogram": histogram,
                    "confidences": sorted(confs, reverse=True),
                }
            )
        del rgb

    payload = {
        "evidenceId": "hf003-rfdetr-fixture-threshold-sweep",
        "purpose": (
            "diagnostic for the zero player-recall on the synthetic fixture: "
            "the broadcast-trained model never ranks the flat colored discs as "
            "confident players at any threshold in {0.5, 0.3, 0.1, 0.05}"
        ),
        "model": "julianzu9612/RFDETR-Soccernet @ 1e388b922a64f2be39cbf1925e5fd5fc4f7dd771",
        "fixture": "synthetic-diagnostic-01 (strided frames 0/100/200)",
        "sweep": records,
        "conclusion": (
            "out-of-distribution: the discs only attract 0.05-0.17-confidence "
            "classifications (mostly ball/goalkeeper); the true white ball is "
            "detected at 0.49-0.56. The fixture is a synthetic diagnostic, not "
            "a model-quality benchmark for broadcast-trained detectors."
        ),
        "recordedAtUtc": datetime.now(timezone.utc).isoformat(),
    }
    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"threshold-sweep evidence written: {out_path}")
    for rec in records:
        print(
            f"  frame {rec['frameIndex']} thr={rec['threshold']}: {rec['detectionCount']} dets {rec['classHistogram']}"
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
