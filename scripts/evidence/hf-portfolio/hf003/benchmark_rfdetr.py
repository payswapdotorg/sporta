#!/usr/bin/env python3
"""
HF003 — the RF-DETR SoccerNet benchmark (Worker A, flight 1).

Runs the HF002-ledger candidate `julianzu9612/RFDETR-Soccernet`
(RF-DETR-Large fine-tuned on SoccerNet-Tracking 2023, apache-2.0) on:

  1. the Sporta benchmark fixture `synthetic-diagnostic-01` (the
     technology-registry fixture pair: mp4 + exact JSON annotations) —
     SCORED (precision/recall at IoU 0.5, ball recall) with the repo's
     own matching conventions (greedy label-aware one-to-one IoU
     matching, IoU-descending, ties by ground-truth then prediction
     order — a faithful re-implementation of
     packages/perception-detection/src/benchmark.ts);
  2. the authorized REAL licensed clip `fx-001` (CC0, FIFA Beach Soccer
     World Cup 2021 penalty, Wikimedia Commons; sha-pinned in the repo's
     L010 clip manifest) — recorded UNSCORED (no annotations exist),
     latency/dropout/observation counts still measure.

Frame sampling: stride 10 by decode order (cv2.VideoCapture sequential
read) — the same convention as the repo's L010 harness
(packages/perception-benchmark/src/harness.ts), so the RF-DETR run and
the current-detector baseline (results/baseline-current-detector.json)
see the SAME frames.

Honest resource caveats (recorded in every output):
  - CPU-only inference on a 2-vCPU benchmark host with NO GPU:
    "GPU memory: N/A (no GPU on the benchmark host); process RSS
    recorded instead" — VmRSS sampled per frame + ru_maxrss peak.
  - Latency numbers are wall-clock CPU readings, labeled as such.
  - Percentiles use the repo's nearest-rank convention
    (rank = ceil(p/100 * n) — packages/latency-benchmark/src/percentiles.ts).

Class mapping (from the model repo's config.json, verified against the
live revision 1e388b922a64f2be39cbf1925e5fd5fc4f7dd771):
  0=ball, 1=player, 2=referee, 3=goalkeeper.

Checkpoint loading (the honest recipe for THIS checkpoint on the CURRENT
rfdetr package): the checkpoint was trained with an older rfdetr codebase
whose classification head has EXACTLY 4 rows (no background row; the
current package builds num_classes+1 rows). Constructing the original
RF-DETR-Large variant (RFDETRLargeDeprecated: dinov2_windowed_base
encoder, hidden_dim 384, 3 decoder layers, patch 14, 4 windows,
PE size 37, 300 queries, group_detr 13, resolution 560 — every value
read from the checkpoint's own `args` entry) with num_classes=3
reproduces the checkpoint's 4-row head shape exactly; class ids at
inference are the raw sigmoid-slot indices 0..3. state_dict load:
strict=False, missing keys = ['_kp_active_mask'] (an inert keypoint-mask
buffer), unexpected keys = 0.

The model checkpoint lives OUTSIDE the repo (/home/z/hf-bench/) and is
NEVER committed — apache-2.0 permits the operator download for benchmark
evaluation (HF002 ledger + the L010 candidate registration).

Usage:
  python3 benchmark_rfdetr.py --checkpoint /home/z/hf-bench/checkpoint_best_regular.pth \
      --repo-root /home/z/sporta [--stride 10]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import resource
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

# --- repo pins (scripts/evidence/hf-portfolio/hf003 conventions) ------------

FIXTURE_MEDIA = "packages/technology-registry/fixtures/media/synthetic-diagnostic-01-players-and-ball.mp4"
FIXTURE_ANNOTATIONS = "packages/technology-registry/fixtures/annotations/synthetic-diagnostic-01.json"
FIXTURE_SHA256 = "e75abe1441fe2e6680b2aad5e7d2e66a5bcd21ab4b91928e25181f90a37f7f76"

REAL_CLIP_MEDIA = "packages/real-to-swm/fixtures/media/fx-001-normalized.mp4"
REAL_CLIP_SHA256 = "4e2f3e3d9df1eb4b0403a442c2371821c684ab8880b4544099b2d5d962543ff7"

# The model-card class mapping (config.json @ revision 1e388b9...).
CLASS_NAMES = {0: "ball", 1: "player", 2: "referee", 3: "goalkeeper"}
CONFIDENCE_THRESHOLD = 0.5
IOU_THRESHOLD = 0.5

RESOURCE_CAVEAT = (
    "GPU memory: N/A (no GPU on the benchmark host); process RSS recorded instead"
)


# --- small utilities ---------------------------------------------------------


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def vm_rss_mib() -> float:
    with open("/proc/self/status", "r", encoding="utf-8") as handle:
        for line in handle:
            if line.startswith("VmRSS:"):
                return float(line.split()[1]) / 1024.0
    return float("nan")


def nearest_rank_percentile(samples: list[float], p: float) -> float:
    """rank = ceil(p/100 * n), clamped to [1, n] — the repo convention."""
    if not samples:
        raise ValueError("percentile of empty samples")
    rank = max(1, min(len(samples), math.ceil(p / 100.0 * len(samples))))
    return sorted(samples)[rank - 1]


def iou_xyxy(a: tuple[float, float, float, float], b: tuple[float, float, float, float]) -> float:
    """IoU of two xyxy pixel boxes, edges clamped to >= 0 (repo iou() convention)."""
    ax1, ay1, ax2, ay2 = max(0.0, a[0]), max(0.0, a[1]), max(0.0, a[2]), max(0.0, a[3])
    bx1, by1, bx2, by2 = max(0.0, b[0]), max(0.0, b[1]), max(0.0, b[2]), max(0.0, b[3])
    inter_w = min(ax2, bx2) - max(ax1, bx1)
    inter_h = min(ay2, by2) - max(ay1, by1)
    inter = max(0.0, inter_w) * max(0.0, inter_h)
    area_a = max(0.0, ax2 - ax1) * max(0.0, ay2 - ay1)
    area_b = max(0.0, bx2 - bx1) * max(0.0, by2 - by1)
    union = area_a + area_b - inter
    if union <= 0:
        return 1.0 if (ax1, ay1, ax2, ay2) == (bx1, by1, bx2, by2) else 0.0
    return min(1.0, max(0.0, inter / union))


def match_detections(
    gt_boxes: list[tuple[float, float, float, float, str]],
    pred_boxes: list[tuple[float, float, float, float, str]],
    iou_threshold: float,
) -> dict[str, int]:
    """
    Greedy label-aware one-to-one matching — a faithful port of
    packages/perception-detection/src/benchmark.ts `matchDetections`:
    candidates = same-label (gt, pred) pairs with IoU >= threshold,
    sorted IoU-DESC then gt order then pred order, consumed greedily.
    """
    candidates: list[tuple[float, int, int]] = []
    for gt_idx, gt in enumerate(gt_boxes):
        for pred_idx, pred in enumerate(pred_boxes):
            if gt[4] != pred[4]:
                continue
            overlap = iou_xyxy(gt[:4], pred[:4])
            if overlap >= iou_threshold:
                candidates.append((overlap, gt_idx, pred_idx))
    candidates.sort(key=lambda c: (-c[0], c[1], c[2]))
    gt_matched = [False] * len(gt_boxes)
    pred_matched = [False] * len(pred_boxes)
    for overlap, gt_idx, pred_idx in candidates:
        if gt_matched[gt_idx] or pred_matched[pred_idx]:
            continue
        gt_matched[gt_idx] = True
        pred_matched[pred_idx] = True
    tp = sum(gt_matched)
    fp = sum(1 for m in pred_matched if not m)
    fn = sum(1 for m in gt_matched if not m)
    return {"tp": tp, "fp": fp, "fn": fn}


def prf(tp: int, fp: int, fn: int) -> dict[str, float]:
    precision = tp / (tp + fp) if (tp + fp) > 0 else 0.0
    recall = tp / (tp + fn) if (tp + fn) > 0 else 0.0
    f1 = (2 * precision * recall) / (precision + recall) if (precision + recall) > 0 else 0.0
    return {"precision": precision, "recall": recall, "f1": f1}


def sample_frames(video_path: Path, stride: int) -> list[tuple[int, "object"]]:
    """Sequential cv2 read, keep every `stride`-th frame by decode order."""
    import cv2

    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise RuntimeError(f"cannot open video: {video_path}")
    meta = {
        "frameCount": int(cap.get(cv2.CAP_PROP_FRAME_COUNT)),
        "fps": cap.get(cv2.CAP_PROP_FPS),
        "width": int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)),
        "height": int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)),
    }
    frames: list[tuple[int, object]] = []
    decode_order = 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        if decode_order % stride == 0:
            frames.append((decode_order, frame))
        else:
            del frame
        decode_order += 1
    cap.release()
    return frames, meta  # type: ignore[return-value]


# --- the benchmark -----------------------------------------------------------


def load_model(checkpoint: Path):
    """The honest loading recipe for this legacy checkpoint (see module doc)."""
    import torch
    import warnings

    warnings.filterwarnings("ignore")
    from rfdetr import RFDETRLargeDeprecated

    ckpt = torch.load(str(checkpoint), map_location="cpu", weights_only=False, mmap=True)
    train_args = ckpt.get("args")
    state = dict(ckpt["model"])
    # Architecture values read from the checkpoint's own args (not guessed):
    args = vars(train_args) if hasattr(train_args, "__dict__") else dict(train_args)
    resolution = int(args["resolution"])
    pe_size = 37  # the checkpoint's backbone PE table is 1370 = 37*37 + 1 (cls)
    model = RFDETRLargeDeprecated(
        num_classes=3,  # package adds +1 background row -> 4-row head == checkpoint
        resolution=resolution,
        positional_encoding_size=pe_size,
        dec_layers=int(args["dec_layers"]),
        sa_nheads=int(args["sa_nheads"]),
        ca_nheads=int(args["ca_nheads"]),
        dec_n_points=int(args["dec_n_points"]),
        num_windows=int(args["num_windows"]),
        patch_size=int(args["patch_size"]),
        out_feature_indexes=list(args["out_feature_indexes"]),
        projector_scale=list(args["projector_scale"]),
        num_queries=int(args["num_queries"]),
        num_select=int(args["num_select"]),
        group_detr=int(args["group_detr"]),
        pretrain_weights=None,  # never fetch starter weights; we load our own
        device="cpu",
    )
    inner = model.model.model if hasattr(model.model, "model") else model.model
    result = inner.load_state_dict(state, strict=False)
    missing = list(result.missing_keys)
    unexpected = list(result.unexpected_keys)
    if unexpected:
        raise RuntimeError(f"unexpected checkpoint keys (wrong architecture?): {unexpected[:10]}")
    inner.eval()
    load_info = {
        "variant": "RFDETRLargeDeprecated (the original RF-DETR-Large: dinov2_windowed_base, hidden 384)",
        "inferenceResolutionPx": resolution,
        "trainArgsEcho": {k: args[k] for k in (
            "num_classes", "resolution", "dec_layers", "hidden_dim", "encoder",
            "num_queries", "group_detr", "patch_size", "num_windows",
            "out_feature_indexes", "projector_scale") if k in args},
        "stateDictEntries": len(state),
        "missingKeys": missing,
        "unexpectedKeys": unexpected,
        "classMapping": {str(k): v for k, v in CLASS_NAMES.items()},
        "classHeadConstruction": (
            "constructed with num_classes=3 so the package's num_classes+1 head "
            "reproduces the checkpoint's exactly-4-row classification head "
            "(the legacy training code had no background row); class ids are "
            "the raw sigmoid-slot indices 0..3 per the model card mapping"
        ),
    }
    del state, ckpt
    return model, load_info


def circle_to_box(x: float, y: float, r: float, w: int, h: int) -> tuple[float, float, float, float]:
    """The fixture annotations are circle centers+radius in PIXELS (verified:
    annotation (x,y,r) == the generator math of the L010 harness on sampled
    frames — see `conventionCheck` in the fixture result). Box = the disc's
    bounding square, clamped into the frame (the harness convention)."""
    x1 = max(0.0, x - r)
    y1 = max(0.0, y - r)
    x2 = min(float(w), x + r)
    y2 = min(float(h), y + r)
    return (x1, y1, x2, y2)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[1])
    parser.add_argument("--checkpoint", required=True, help="path to checkpoint_best_regular.pth (outside the repo)")
    parser.add_argument("--repo-root", default=str(Path(__file__).resolve().parents[5]))
    parser.add_argument("--stride", type=int, default=10)
    parser.add_argument("--out-dir", default=str(Path(__file__).resolve().parent / "results"))
    args = parser.parse_args()

    repo = Path(args.repo_root)
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    import torch

    started_at = datetime.now(timezone.utc).isoformat()

    # fail-closed clip verification (the L010 manifest pins)
    fixture_path = repo / FIXTURE_MEDIA
    real_path = repo / REAL_CLIP_MEDIA
    fixture_sha = sha256_of(fixture_path)
    real_sha = sha256_of(real_path)
    if fixture_sha != FIXTURE_SHA256:
        raise RuntimeError(f"fixture drifted: {fixture_sha} != pin {FIXTURE_SHA256}")
    if real_sha != REAL_CLIP_SHA256:
        raise RuntimeError(f"fx-001 drifted: {real_sha} != pin {REAL_CLIP_SHA256}")

    model, load_info = load_model(Path(args.checkpoint))
    import rfdetr as rfdetr_pkg
    import cv2

    try:
        import importlib.metadata as importlib_metadata

        rfdetr_version = f"{importlib_metadata.version('rfdetr')} (importlib.metadata)"
    except Exception:
        rfdetr_version = getattr(rfdetr_pkg, "__version__", "unknown")

    host = {
        "cpuCores": os.cpu_count(),
        "torchThreads": torch.get_num_threads(),
        "device": "cpu",
        "gpu": "none — GPU memory: N/A; process RSS recorded instead",
        "torchVersion": torch.__version__,
        "rfdetrPackageVersion": rfdetr_version,
        "opencvVersion": cv2.__version__,
    }

    common = {
        "model": "julianzu9612/RFDETR-Soccernet @ 1e388b922a64f2be39cbf1925e5fd5fc4f7dd771",
        "taskProfile": "football.playerDetection",
        "confidenceThreshold": CONFIDENCE_THRESHOLD,
        "iouThreshold": IOU_THRESHOLD,
        "stride": args.stride,
        "sampling": (
            "cv2.VideoCapture sequential read; every stride-th frame by decode "
            "order (the L010 harness convention; matches "
            "results/baseline-current-detector.json frame sets)"
        ),
        "startedAtUtc": started_at,
        "resourceCaveat": RESOURCE_CAVEAT,
    }

    # ------------------------------------------------------------------ fixture
    annotations = json.loads((repo / FIXTURE_ANNOTATIONS).read_text())
    ann_meta = {k: annotations[k] for k in ("fixtureId", "mediaKind", "width", "height", "fps", "frameCount")}
    frames, video_meta = sample_frames(fixture_path, args.stride)
    if len(frames) == 0:
        raise RuntimeError("fixture decoded zero frames")

    # Coordinate-convention check (honesty doctrine): the annotations must
    # match the L010 harness's own generator math on the sampled frames.
    convention_max_delta = 0.0
    for decode_order, _frame in frames:
        frame_ann = annotations["frames"][decode_order]
        t = decode_order / 25.0
        idx = 0
        for i in range(5):
            red_anchor = (90 + i * 62, 110 + 42 * math.sin(i * 1.7))
            blue_anchor = (640 - 90 - i * 62, 360 - 110 - 42 * math.sin(i * 1.7))
            discs = [
                (
                    red_anchor[0] + 42 * math.sin(t * 0.7 + i),
                    red_anchor[1] + 26 * math.cos(t * 0.53 + i * 2.1),
                ),
                (
                    blue_anchor[0] + 42 * math.sin(t * 0.61 + i * 1.3 + 2),
                    blue_anchor[1] + 26 * math.cos(t * 0.47 + i),
                ),
            ]
            for disc in discs:
                gt = frame_ann["players"][idx]
                convention_max_delta = max(
                    convention_max_delta,
                    abs(disc[0] - gt["x"]),
                    abs(disc[1] - gt["y"]),
                )
                idx += 1
    convention_check = {
        "annotationsVsL010GeneratorMathMaxCenterDeltaPx": round(convention_max_delta, 6),
        "annotationCoordinateConvention": "pixel centers + radius in the 640x360 frame",
        "tolerancePx": 0.01,
        "toleranceNote": (
            "the annotation JSON rounds centers to 3-6 decimals; a wrong "
            "convention would differ by tens of px, so < 0.01 px passes"
        ),
        "passes": convention_max_delta < 0.01,
    }
    if not convention_check["passes"]:
        raise RuntimeError(f"annotation convention mismatch: {convention_check}")

    detections: dict[str, list[dict]] = {}
    latencies: list[float] = []
    rss_per_frame: list[float] = []
    frame_records: list[dict] = []
    class_histogram: dict[str, int] = {}

    for decode_order, frame_bgr in frames:
        frame_rgb = frame_bgr[:, :, ::-1].copy()  # cv2 BGR -> RGB
        del frame_bgr
        rss_before = vm_rss_mib()
        t0 = time.perf_counter()
        out = model.predict(frame_rgb, threshold=CONFIDENCE_THRESHOLD)
        t1 = time.perf_counter()
        detect_ms = (t1 - t0) * 1000.0
        latencies.append(detect_ms)
        rss_per_frame.append(vm_rss_mib())
        boxes = out.xyxy.tolist() if len(out.xyxy) else []
        confs = out.confidence.tolist() if out.confidence is not None and len(out.confidence) else []
        ids = out.class_id.tolist() if out.class_id is not None and len(out.class_id) else []
        frame_dets = []
        for box, conf, cid in zip(boxes, confs, ids):
            name = CLASS_NAMES.get(int(cid), f"unknown({cid})")
            class_histogram[name] = class_histogram.get(name, 0) + 1
            frame_dets.append(
                {
                    "boxXyxyPx": [round(v, 2) for v in box],
                    "classId": int(cid),
                    "className": name,
                    "confidence": round(float(conf), 4),
                }
            )
        detections[str(decode_order)] = frame_dets
        frame_records.append(
            {
                "frameId": f"f-0-{decode_order}",
                "decodeOrder": decode_order,
                "detectionCount": len(frame_dets),
                "detectMs": round(detect_ms, 2),
                "vmRssMiB": round(rss_per_frame[-1], 1),
            }
        )
        del frame_rgb, out

    # --- scoring vs the fixture annotations ----------------------------------
    gt_player: dict[str, list[tuple]] = {}
    gt_ball: dict[str, list[tuple]] = {}
    for decode_order, _ in frames:
        frame_ann = annotations["frames"][decode_order]
        players = [
            (*circle_to_box(p["x"], p["y"], p["radius"], annotations["width"], annotations["height"]), "player")
            for p in frame_ann["players"]
        ]
        ball = frame_ann.get("ball")
        gt_player[str(decode_order)] = players
        gt_ball[str(decode_order)] = [
            (*circle_to_box(ball["x"], ball["y"], ball["radius"], annotations["width"], annotations["height"]), "ball")
        ] if ball else []

    def predictions_for(key: str, label_filter: set[str], label: str) -> list[tuple]:
        out_list = []
        for det in detections[key]:
            if det["className"] in label_filter:
                out_list.append((*det["boxXyxyPx"], label))
        return out_list

    # primary: strict player-class detections vs GT players
    counts = {"tp": 0, "fp": 0, "fn": 0}
    for key in gt_player:
        preds = predictions_for(key, {"player"}, "player")
        result = match_detections(gt_player[key], preds, IOU_THRESHOLD)
        for k in counts:
            counts[k] += result[k]
    player_strict = {**counts, **prf(counts["tp"], counts["fp"], counts["fn"])}

    # secondary: all person-classes merged (player+referee+goalkeeper -> "player")
    counts = {"tp": 0, "fp": 0, "fn": 0}
    for key in gt_player:
        preds = predictions_for(key, {"player", "referee", "goalkeeper"}, "player")
        result = match_detections(gt_player[key], preds, IOU_THRESHOLD)
        for k in counts:
            counts[k] += result[k]
    person_merged = {**counts, **prf(counts["tp"], counts["fp"], counts["fn"])}

    # ball recall (primary IoU 0.5; secondary: any ball detection whose center
    # is within 10 px of the GT ball center — the fixture ball is an 8 px disc,
    # an honest coarse "locates-the-ball" criterion, clearly labeled)
    ball_tp_iou = 0
    ball_tp_center = 0
    ball_fn = 0
    for key, gts in gt_ball.items():
        if not gts:
            continue
        gt = gts[0]
        preds = predictions_for(key, {"ball"}, "ball")
        hit_iou = any(iou_xyxy(gt[:4], p[:4]) >= IOU_THRESHOLD for p in preds)
        gcx, gcy = (gt[0] + gt[2]) / 2.0, (gt[1] + gt[3]) / 2.0
        hit_center = any(
            math.hypot((p[0] + p[2]) / 2.0 - gcx, (p[1] + p[3]) / 2.0 - gcy) <= 10.0
            for p in preds
        )
        ball_tp_iou += 1 if hit_iou else 0
        ball_tp_center += 1 if hit_center else 0
        ball_fn += 0 if hit_iou else 1
    ball_recall = {
        "iou05": {
            "hits": ball_tp_iou,
            "misses": ball_fn,
            "recall": ball_tp_iou / (ball_tp_iou + ball_fn) if (ball_tp_iou + ball_fn) else 0.0,
        },
        "centerWithin10Px": {
            "hits": ball_tp_center,
            "recall": ball_tp_center / (ball_tp_iou + ball_fn) if (ball_tp_iou + ball_fn) else 0.0,
            "note": "secondary coarse criterion (fixture ball is an 8 px disc)",
        },
    }

    steady = latencies[1:]  # the first call carries lazy-init warmup
    fixture_record = {
        "evidenceId": "hf003-rfdetr-synthetic-diagnostic-01",
        **common,
        "clip": {
            "clipId": "synthetic-diagnostic-01",
            "mediaKind": "synthetic-diagnostic",
            "licenseId": "in-repo-synthetic-diagnostic",
            "sha256": fixture_sha,
            "annotationFile": "packages/technology-registry/fixtures/annotations/synthetic-diagnostic-01.json",
        },
        "annotationMeta": ann_meta,
        "decodedVideoMeta": video_meta,
        "conventionCheck": convention_check,
        "loadInfo": load_info,
        "host": host,
        "scoring": {
            "playerStrictClass": player_strict,
            "personClassesMerged": person_merged,
            "ballRecall": ball_recall,
            "groundTruthCounts": {
                "playersPerFrame": len(annotations["frames"][0]["players"]),
                "ballPerFrame": 1,
                "sampledFrames": len(frames),
            },
        },
        "latencyMs": {
            "note": "wall-clock CPU readings; first call carries lazy-init warmup",
            "firstCallMs": round(latencies[0], 2),
            "steadyCount": len(steady),
            "mean": round(sum(steady) / len(steady), 2) if steady else None,
            "min": round(min(steady), 2) if steady else None,
            "max": round(max(steady), 2) if steady else None,
            "p50NearestRank": round(nearest_rank_percentile(steady, 50), 2) if steady else None,
            "p95NearestRank": round(nearest_rank_percentile(steady, 95), 2) if steady else None,
        },
        "memory": {
            "resourceCaveat": RESOURCE_CAVEAT,
            "vmRssMiBMin": round(min(rss_per_frame), 1) if rss_per_frame else None,
            "vmRssMiBMax": round(max(rss_per_frame), 1) if rss_per_frame else None,
            "peakRssMiBRuMaxrss": round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024.0, 1),
        },
        "classHistogram": class_histogram,
        "frames": frame_records,
        "detections": detections,
        "completedAtUtc": datetime.now(timezone.utc).isoformat(),
    }
    fixture_out = out_dir / "rfdetr-synthetic-diagnostic-01.json"
    fixture_out.write_text(json.dumps(fixture_record, indent=2) + "\n")
    print(f"fixture evidence written: {fixture_out}")
    print(
        f"  player(strict) P={player_strict['precision']:.3f} R={player_strict['recall']:.3f} F1={player_strict['f1']:.3f}"
    )
    print(
        f"  person(merged) P={person_merged['precision']:.3f} R={person_merged['recall']:.3f} F1={person_merged['f1']:.3f}"
    )
    print(f"  ball recall IoU@0.5={ball_recall['iou05']['recall']:.3f} center10px={ball_recall['centerWithin10Px']['recall']:.3f}")
    print(f"  latency steady mean={fixture_record['latencyMs']['mean']}ms p50={fixture_record['latencyMs']['p50NearestRank']}ms p95={fixture_record['latencyMs']['p95NearestRank']}ms")
    print(f"  vmRSS max={fixture_record['memory']['vmRssMiBMax']} MiB peak={fixture_record['memory']['peakRssMiBRuMaxrss']} MiB")

    # ------------------------------------------------------------------ fx-001
    real_frames, real_meta = sample_frames(real_path, args.stride)
    real_detections: dict[str, list[dict]] = {}
    real_latencies: list[float] = []
    real_rss: list[float] = []
    real_class_histogram: dict[str, int] = {}
    zero_detection_frames = 0
    real_frame_records: list[dict] = []
    for decode_order, frame_bgr in real_frames:
        frame_rgb = frame_bgr[:, :, ::-1].copy()
        del frame_bgr
        t0 = time.perf_counter()
        out = model.predict(frame_rgb, threshold=CONFIDENCE_THRESHOLD)
        t1 = time.perf_counter()
        real_latencies.append((t1 - t0) * 1000.0)
        real_rss.append(vm_rss_mib())
        boxes = out.xyxy.tolist() if len(out.xyxy) else []
        confs = out.confidence.tolist() if out.confidence is not None and len(out.confidence) else []
        ids = out.class_id.tolist() if out.class_id is not None and len(out.class_id) else []
        frame_dets = []
        for box, conf, cid in zip(boxes, confs, ids):
            name = CLASS_NAMES.get(int(cid), f"unknown({cid})")
            real_class_histogram[name] = real_class_histogram.get(name, 0) + 1
            frame_dets.append(
                {
                    "boxXyxyPx": [round(v, 2) for v in box],
                    "classId": int(cid),
                    "className": name,
                    "confidence": round(float(conf), 4),
                }
            )
        if not frame_dets:
            zero_detection_frames += 1
        real_detections[str(decode_order)] = frame_dets
        real_frame_records.append(
            {
                "frameId": f"f-0-{decode_order}",
                "decodeOrder": decode_order,
                "detectionCount": len(frame_dets),
                "detectMs": round(real_latencies[-1], 2),
                "vmRssMiB": round(real_rss[-1], 1),
            }
        )
        del frame_rgb, out

    steady_real = real_latencies[1:]
    real_record = {
        "evidenceId": "hf003-rfdetr-fx-001",
        **common,
        "clip": {
            "clipId": "fx-001",
            "mediaKind": "real-footage",
            "licenseId": "CC0-1.0",
            "sha256": real_sha,
            "sourceUrl": (
                "https://upload.wikimedia.org/wikipedia/commons/d/da/"
                "2021-08-29_-_FIFA_Beach_Soccer_World_Cup_-_Match_31_-_"
                "Switzerland_v_Senegal_-_No%C3%ABl_Ott_scores_a_penalty_kick.webm"
            ),
            "note": (
                "REAL footage (FIFA Beach Soccer World Cup 2021 penalty, Wikimedia "
                "Commons, CC0) — the repo's authorized licensed gate clip. No "
                "ground-truth annotations exist — observations recorded unscored."
            ),
        },
        "decodedVideoMeta": real_meta,
        "loadInfo": load_info,
        "host": host,
        "scoring": {
            "kind": "unscored",
            "note": "no ground-truth annotations exist for this real clip",
        },
        "latencyMs": {
            "note": "wall-clock CPU readings; first call carries lazy-init warmup",
            "firstCallMs": round(real_latencies[0], 2),
            "steadyCount": len(steady_real),
            "mean": round(sum(steady_real) / len(steady_real), 2) if steady_real else None,
            "min": round(min(steady_real), 2) if steady_real else None,
            "max": round(max(steady_real), 2) if steady_real else None,
            "p50NearestRank": round(nearest_rank_percentile(steady_real, 50), 2) if steady_real else None,
            "p95NearestRank": round(nearest_rank_percentile(steady_real, 95), 2) if steady_real else None,
        },
        "memory": {
            "resourceCaveat": RESOURCE_CAVEAT,
            "vmRssMiBMin": round(min(real_rss), 1) if real_rss else None,
            "vmRssMiBMax": round(max(real_rss), 1) if real_rss else None,
            "peakRssMiBRuMaxrss": round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024.0, 1),
        },
        "dropout": {
            "sampledFrames": len(real_frames),
            "refusedFrames": 0,
            "zeroDetectionFrames": zero_detection_frames,
        },
        "classHistogram": real_class_histogram,
        "frames": real_frame_records,
        "detections": real_detections,
        "completedAtUtc": datetime.now(timezone.utc).isoformat(),
    }
    real_out = out_dir / "rfdetr-fx-001.json"
    real_out.write_text(json.dumps(real_record, indent=2) + "\n")
    print(f"real-clip evidence written: {real_out}")
    print(
        f"  unscored; dets/frame mean={sum(len(v) for v in real_detections.values()) / max(1, len(real_detections)):.1f}; "
        f"latency steady mean={real_record['latencyMs']['mean']}ms p50={real_record['latencyMs']['p50NearestRank']}ms "
        f"p95={real_record['latencyMs']['p95NearestRank']}ms"
    )
    print(f"  class histogram: {real_class_histogram}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
