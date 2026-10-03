#!/usr/bin/env python3
"""
HF004 — the MapAnything geometry benchmark (Worker A flight 2, worker 64-b).

The candidate (HF002 ledger row, echoed verbatim into
benchmark-record.json): `facebook/map-anything-apache` @ revision
00f9c245bbcb60522d1ed7f9e9d88462c6e3f38a (apache-2.0 model+code), benchmarked
against:

  1. the Sporta benchmark fixture `synthetic-diagnostic-01` (the
     technology-registry fixture pair, sha-pinned) — the camera-motion
     fallback input per the worker brief (no ground-truthed camera-motion
     fixture exists in the repo; recorded as the typed gap);
  2. the authorized REAL licensed clip `fx-001` (CC0, FIFA Beach Soccer
     World Cup 2021 penalty, Wikimedia; the repo's L010 gate clip,
     sha-pinned) — UNSCORED for geometry (no ground truth exists).

Frame sampling: stride 10 by decode order (the L010 harness convention —
the same frames the HF003 flight saw).

!!! THE HONEST STATE OF THIS FLIGHT ON THIS HOST !!!
The benchmark host (2 vCPU, 4,041 MB total RAM, ~1.3 GB free disk, NO GPU)
CANNOT hold the pinned checkpoint: model.safetensors is 4,914,062,480 B and
the fp32 working set (weights + DPT/AAT activations) exceeds total RAM, and
construction additionally fetches the DINOv2-giant backbone via torch.hub.
Running `--preflight` ON THIS HOST therefore emits the TYPED REFUSAL
(results/preflight-refusal.json, exit code 3): resource-infeasible-host.
The FULL benchmark below is READY-TO-RUN on an adequate host (>= 16 GB RAM,
>= 8 GB free disk): its API usage is written against the pinned mapanything
source (git 3d10cf7a3016fc0f9bb13a071ee66c47b10be0d9, package version
1.1.4 — see results/model-output-schema.json for the source-verified output
schema) and its syntax is checked on this host. It was NOT executed here —
no number in this flight's evidence is fabricated to stand in for it.

Quality metrics (no ground truth for geometry on either clip): UNSCORED
structural evidence only — pose sanity (finiteness, rotation
orthonormality, determinant, first-view gauge), cross-view depth-map
consistency (world-point re-projection agreement between adjacent views),
run-to-run determinism (output digests), and the live output-schema
capture. Labeled as unscored-structural, never as quality numbers.

Latency: per-inference wall-clock CPU (median + nearest-rank p95, the repo
convention rank = ceil(p/100 * n)). Memory: process RSS (VmRSS per
inference + ru_maxrss peak); GPU honestly N/A (no GPU on the host).

Usage:
  # the typed-refusal preflight (RUNS on this host):
  python3 benchmark_mapanything.py --preflight --repo-root /home/z/sporta
  # the full benchmark (adequate host only):
  python3 benchmark_mapanything.py --repo-root /home/z/sporta [--stride 10]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import resource
import shutil
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

# --- pins (the HF002 ledger row + the pinned code revision) ------------------

MODEL_REPO = "facebook/map-anything-apache"
MODEL_REVISION = "00f9c245bbcb60522d1ed7f9e9d88462c6e3f38a"
MODEL_URL = f"https://huggingface.co/{MODEL_REPO}"
CHECKPOINT_FILE = "model.safetensors"
CHECKPOINT_BYTES = 4_914_062_480
# The HF LFS etag of the pinned blob = the hub-reported sha256 (NOT locally
# verified on this host — the file cannot be stored here; the ready-to-run
# path verifies it locally after download).
CHECKPOINT_SHA256_HF = "fa06c0fdccefc5048e072c85935d5789b1e36b307f3859033c17f9dcb9fd5201"
CODE_COMMIT = "3d10cf7a3016fc0f9bb13a071ee66c47b10be0d9"  # facebookresearch/map-anything
# DINOv2-giant torch-hub backbone fetched at construction (config.json:
# uses_torch_hub=true, size=giant, keep_first_n_layers=24).
DINOV2_TORCHHUB_BYTES_ESTIMATE = 1_150_000_000

# --- repo pins (identical to the HF003 evidence tree) ------------------------

FIXTURE_MEDIA = "packages/technology-registry/fixtures/media/synthetic-diagnostic-01-players-and-ball.mp4"
FIXTURE_SHA256 = "e75abe1441fe2e6680b2aad5e7d2e66a5bcd21ab4b91928e25181f90a37f7f76"
REAL_CLIP_MEDIA = "packages/real-to-swm/fixtures/media/fx-001-normalized.mp4"
REAL_CLIP_SHA256 = "4e2f3e3d9df1eb4b0403a442c2371821c684ab8880b4544099b2d5d962543ff7"

RESOURCE_CAVEAT = (
    "GPU memory: N/A (no GPU on the benchmark host); process RSS recorded instead"
)
REFUSAL_EXIT_CODE = 3

# Sliding inference windows over the sampled frames (views per inference).
WINDOW_VIEWS = 4
WINDOW_STRIDE = 2


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


def mem_total_mib() -> float:
    with open("/proc/meminfo", "r", encoding="utf-8") as handle:
        for line in handle:
            if line.startswith("MemTotal:"):
                return float(line.split()[1]) / 1024.0
    return float("nan")


def nearest_rank_percentile(samples: list[float], p: float) -> float:
    """rank = ceil(p/100 * n), clamped to [1, n] — the repo convention."""
    if not samples:
        raise ValueError("percentile of empty samples")
    rank = max(1, min(len(samples), math.ceil(p / 100.0 * len(samples))))
    return sorted(samples)[rank - 1]


def json_write(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


# --- the preflight (RUNS on this host — the typed refusal) -------------------


def run_preflight(repo_root: Path, out_dir: Path) -> int:
    """The honest resource gate. Emits the typed refusal when infeasible."""
    started = datetime.now(timezone.utc).isoformat()

    # 1. bounded network probe (8 MiB; proves reachability + rate, nothing else)
    probe: dict = {"url": f"{MODEL_URL}/resolve/main/{CHECKPOINT_FILE}", "revision": MODEL_REVISION}
    try:
        t0 = time.monotonic()
        req = urllib.request.Request(
            probe["url"], headers={"Range": "bytes=0-8388607"}
        )
        with urllib.request.urlopen(req, timeout=60) as response:
            data = response.read()
        dt = time.monotonic() - t0
        probe.update(
            probeBytes=len(data),
            elapsedS=round(dt, 3),
            throughputMiBPerS=round(len(data) / 1048576 / dt, 2),
            reachable=True,
            note=(
                "bounded 8 MiB range probe (deleted after read; never stored, "
                "never a full download)"
            ),
        )
    except Exception as error:  # noqa: BLE001 - recorded honestly
        probe.update(reachable=False, error=repr(error))
    json_write(out_dir / "download-probe.json", probe)

    # 2. torch / mapanything importability (expected to fail on this host)
    torch_status: dict = {}
    try:
        import torch  # noqa: F401
        torch_status = {"importable": True, "version": torch.__version__}
    except Exception as error:  # noqa: BLE001
        torch_status = {"importable": False, "error": repr(error)}
    mapanything_status = "not probed (torch unimportable)" if not torch_status.get("importable") else "probed in full mode"

    # 3. the disk arithmetic
    disk = shutil.disk_usage(str(repo_root))
    disk_needed = CHECKPOINT_BYTES + DINOV2_TORCHHUB_BYTES_ESTIMATE
    disk_feasible = disk.free >= disk_needed

    # 4. the RAM arithmetic
    ram_total = mem_total_mib()
    ram_needed_gib = CHECKPOINT_BYTES / (1024**3) + 1.0  # weights + activations estimate
    ram_feasible = ram_total / 1024.0 >= ram_needed_gib

    checks = {
        "networkProbeReachable": probe.get("reachable", False),
        "diskFreeBytes": disk.free,
        "diskNeededBytesEstimate": disk_needed,
        "diskFeasible": disk_feasible,
        "ramTotalMiB": round(ram_total, 1),
        "ramNeededGiBEstimate": round(ram_needed_gib, 2),
        "ramFeasible": ram_feasible,
        "torchImportable": torch_status.get("importable", False),
        "gpu": "none — GPU memory honestly N/A; process RSS is the substitute metric",
    }
    feasible = disk_feasible and ram_feasible and torch_status.get("importable", False)

    refusal = {
        "evidenceId": "hf004-mapanything-preflight",
        "model": f"{MODEL_REPO} @ {MODEL_REVISION}",
        "checkpoint": {
            "file": CHECKPOINT_FILE,
            "bytes": CHECKPOINT_BYTES,
            "sha256HubReported": CHECKPOINT_SHA256_HF,
            "sha256Note": (
                "the HF LFS etag of the pinned blob (hub-reported); not "
                "locally verified — the file cannot be stored on this host"
            ),
        },
        "startedAtUtc": started,
        "checks": checks,
        "torch": torch_status,
        "mapanything": mapanything_status,
        "resourceCaveat": RESOURCE_CAVEAT,
        "verdict": "benchmark-runnable" if feasible else "refused",
    }
    if not feasible:
        reasons = []
        if not disk_feasible:
            reasons.append(
                "model-download-disk-infeasible: the pinned checkpoint "
                f"({CHECKPOINT_BYTES:,} B) + the torch-hub DINOv2-giant "
                f"backbone (~{DINOV2_TORCHHUB_BYTES_ESTIMATE:,} B) exceed the "
                f"host's free disk ({disk.free:,} B) — the download is "
                "arithmetically impossible, not stalled"
            )
        if not ram_feasible:
            reasons.append(
                "model-load-ram-infeasible: the fp32 working set (weights "
                f"~{CHECKPOINT_BYTES / (1024**3):.2f} GiB + activations) "
                f"exceeds the host's TOTAL RAM ({ram_total:.0f} MiB)"
            )
        if not torch_status.get("importable", False):
            reasons.append(
                "runtime-unavailable: torch is not importable in the pinned "
                "venv (/home/z/hf-bench-2) — installing it + the fp32 model "
                "is exactly the resource infeasibility above"
            )
        refusal["refusalType"] = "resource-infeasible-host"
        refusal["refusalReasons"] = reasons
        refusal["note"] = (
            "per the worker brief: the honest delivery is this typed refusal "
            "+ the partial (the load analysis, the source-verified "
            "contract-compatibility review, and the ready-to-run benchmark "
            "path in this same script) — never a fabricated benchmark"
        )
    json_write(out_dir / "preflight-refusal.json", refusal)

    print(f"preflight verdict: {refusal['verdict']}")
    for reason in refusal.get("refusalReasons", []):
        print(f"  - {reason}")
    print(f"probe: {json.dumps(probe.get('reachable'))}"
          f" ({probe.get('throughputMiBPerS', 'n/a')} MiB/s)")
    return 0 if feasible else REFUSAL_EXIT_CODE


# --- the full benchmark (READY-TO-RUN on an adequate host) -------------------


def sample_frames(video_path: Path, stride: int) -> tuple[list, dict]:
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
    frames: list = []
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
    return frames, meta


def digest_tensor(tensor) -> str:
    import torch

    flat = tensor.detach().to(torch.float32).reshape(-1)
    return hashlib.sha256(flat.numpy().tobytes()).hexdigest()


def pose_sanity(predictions: list) -> dict:
    """Unscored-structural: finite poses, orthonormal rotations, gauge check."""
    import torch

    orthonormality_errors = []
    determinants = []
    first_pose_deviation = None
    finite_all = True
    for index, pred in enumerate(predictions):
        pose = pred["camera_poses"][0]
        if not bool(torch.isfinite(pose).all()):
            finite_all = False
            continue
        rotation = pose[:3, :3]
        eye = torch.eye(3)
        orthonormality_errors.append(
            float(torch.norm(rotation.T @ rotation - eye, p="fro"))
        )
        determinants.append(float(torch.det(rotation)))
        if index == 0:
            first_pose_deviation = float(torch.norm(pose - torch.eye(4)))
    quat_norm_errors = [
        float(torch.norm(pred["cam_quats"][0]) - 1.0) for pred in predictions
    ]
    return {
        "finite": finite_all,
        "rotationOrthonormalityFrobeniusMax": max(orthonormality_errors) if orthonormality_errors else None,
        "rotationDeterminantMin": min(determinants) if determinants else None,
        "rotationDeterminantMax": max(determinants) if determinants else None,
        "firstViewPoseIdentityDeviationFrobenius": first_pose_deviation,
        "quaternionUnitNormErrorMaxAbs": max(abs(e) for e in quat_norm_errors) if quat_norm_errors else None,
        "convention": "camera_poses are cam2world, OpenCV (+X Right, +Y Down, +Z Forward), world frame = the model's predicted canonical gauge (view 0 expected at identity)",
    }


def cross_view_depth_consistency(predictions: list, pair_limit: int = 4) -> dict:
    """
    Unscored-structural: for adjacent view pairs (a, b), project a's world
    points into b's camera (P_b_cam = R_b^T (P - t_b)), keep points with
    positive Z that land inside b's image, sample b's depth_z at the mapped
    pixel (nearest pixel), and report the relative Z error distribution.
    """
    import torch

    rel_errors: list[float] = []
    pairs_checked = 0
    for a, b in zip(predictions[:-1], predictions[1:]):
        if pairs_checked >= pair_limit:
            break
        pts_world = a["pts3d"][0].reshape(-1, 3)
        pose_b = b["camera_poses"][0]
        rotation_b = pose_b[:3, :3]
        trans_b = pose_b[:3, 3]
        pts_cam_b = (pts_world - trans_b) @ rotation_b  # R^T (P - t) row form
        z = pts_cam_b[:, 2]
        intrinsics_b = b["intrinsics"][0]
        fx, fy = intrinsics_b[0, 0], intrinsics_b[1, 1]
        cx, cy = intrinsics_b[0, 2], intrinsics_b[1, 2]
        height, width = b["depth_z"][0].shape[:2]
        u = (pts_cam_b[:, 0] / z.clamp_min(1e-6)) * fx + cx
        v = (pts_cam_b[:, 1] / z.clamp_min(1e-6)) * fy + cy
        inside = (
            (z > 0)
            & (u >= 0) & (u < width - 1)
            & (v >= 0) & (v < height - 1)
        )
        if int(inside.sum()) < 64:
            pairs_checked += 1
            continue
        ui = u[inside].round().long().clamp(0, width - 1)
        vi = v[inside].round().long().clamp(0, height - 1)
        depth_b = b["depth_z"][0][vi, ui, 0]
        valid = (depth_b > 0) & (z[inside] > 0)
        if int(valid.sum()) < 64:
            pairs_checked += 1
            continue
        rel = ((z[inside] - depth_b)[valid] / depth_b[valid]).abs()
        rel_errors.extend(rel.tolist())
        pairs_checked += 1
    if not rel_errors:
        return {"pairsChecked": pairs_checked, "validPairs": 0, "note": "no valid cross-view matches"}
    rel_sorted = sorted(rel_errors)
    return {
        "pairsChecked": pairs_checked,
        "matchedPoints": len(rel_errors),
        "relativeDepthErrorMedian": rel_sorted[len(rel_sorted) // 2],
        "relativeDepthErrorP95NearestRank": nearest_rank_percentile(rel_errors, 95),
        "note": (
            "unscored-structural self-consistency (the model's own two views "
            "agreeing with each other), NOT a quality score — no ground "
            "truth exists for either clip"
        ),
    }


def run_benchmark(repo_root: Path, out_dir: Path, stride: int) -> int:
    import torch
    from huggingface_hub import snapshot_download
    from mapanything.models import MapAnything
    from mapanything.utils.image import load_images

    torch.manual_seed(0)
    torch.set_num_threads(2)
    threads = torch.get_num_threads()

    # fail-closed clip verification (the L010 manifest pins)
    fixture_path = repo_root / FIXTURE_MEDIA
    real_path = repo_root / REAL_CLIP_MEDIA
    if sha256_of(fixture_path) != FIXTURE_SHA256:
        raise RuntimeError("fixture sha256 drift — fail-closed")
    if sha256_of(real_path) != REAL_CLIP_SHA256:
        raise RuntimeError("fx-001 sha256 drift — fail-closed")

    # the pinned, sha-verified model download (NEVER inside the repo)
    model_dir = Path(os.environ.get("HF_BENCH_2_MODEL_DIR", "/home/z/hf-bench-2/model"))
    local_weights = model_dir / CHECKPOINT_FILE
    if not local_weights.exists():
        model_dir.mkdir(parents=True, exist_ok=True)
        snapshot_download(
            repo_id=MODEL_REPO, revision=MODEL_REVISION,
            local_dir=str(model_dir),
            allow_patterns=["config.json", CHECKPOINT_FILE],
        )
    local_sha = sha256_of(local_weights)
    if local_sha != CHECKPOINT_SHA256_HF:
        raise RuntimeError(
            f"checkpoint sha256 drift: {local_sha} != pinned {CHECKPOINT_SHA256_HF}"
        )

    model = MapAnything.from_pretrained(str(model_dir)).to("cpu")
    model.eval()

    clips = [
        {
            "clipId": "synthetic-diagnostic-01",
            "mediaKind": "synthetic-diagnostic",
            "licenseId": "in-repo-synthetic-diagnostic",
            "path": fixture_path,
            "expectedSha256": FIXTURE_SHA256,
            "scored": False,
            "unscoredReason": "no ground truth for geometry (camera pose / depth) exists for this fixture",
            "out": "mapanything-synthetic-diagnostic-01.json",
        },
        {
            "clipId": "fx-001",
            "mediaKind": "real-footage",
            "licenseId": "CC0-1.0 (FIFA Beach Soccer World Cup 2021 penalty, Wikimedia Commons — the repo's authorized licensed gate clip)",
            "path": real_path,
            "expectedSha256": REAL_CLIP_SHA256,
            "scored": False,
            "unscoredReason": "no ground truth for geometry exists for this real clip",
            "out": "mapanything-fx-001.json",
        },
    ]

    for clip in clips:
        frames, video_meta = sample_frames(clip["path"], stride)
        # materialize sampled frames as images for load_images
        import cv2

        tmp_dir = out_dir / f".frames-{clip['clipId']}"
        tmp_dir.mkdir(parents=True, exist_ok=True)
        frame_paths = []
        for decode_order, frame in frames:
            frame_path = tmp_dir / f"f-{decode_order:06d}.jpg"
            cv2.imwrite(str(frame_path), frame)
            frame_paths.append(frame_path)

        windows = [
            frame_paths[i : i + WINDOW_VIEWS]
            for i in range(0, len(frame_paths) - WINDOW_VIEWS + 1, WINDOW_STRIDE)
        ]
        per_inference_ms: list[float] = []
        rss_mib: list[float] = []
        all_predictions: list = []
        for window_index, window in enumerate(windows):
            views = load_images(
                window, resize_mode="longest_side", size=512,
                norm_type="dinov2", patch_size=14,
            )
            t0 = time.perf_counter()
            predictions = model.infer(
                views,
                memory_efficient_inference=True,
                minibatch_size=1,
                use_amp=False,
                amp_dtype="fp32",
                apply_mask=True,
                mask_edges=True,
                apply_confidence_mask=False,
                use_multiview_confidence=False,
            )
            per_inference_ms.append((time.perf_counter() - t0) * 1000.0)
            rss_mib.append(vm_rss_mib())
            all_predictions.extend(predictions)

        # determinism: re-run the first window, compare digests
        views0 = load_images(
            windows[0], resize_mode="longest_side", size=512,
            norm_type="dinov2", patch_size=14,
        )
        rerun = model.infer(
            views0, memory_efficient_inference=True, minibatch_size=1,
            use_amp=False, amp_dtype="fp32", apply_mask=True, mask_edges=True,
        )
        determinism = {
            "reRunWindowDigestsMatch": all(
                digest_tensor(rerun[i][key]) == digest_tensor(all_predictions[i][key])
                for i in range(len(rerun))
                for key in ("depth_z", "camera_poses")
            ),
            "comparedFields": ["depth_z", "camera_poses"],
        }

        # live schema capture (the import-executed check of the static scan)
        live_schema = {
            key: {
                "shape": list(pred.shape),
                "dtype": str(pred.dtype),
            }
            for key, pred in all_predictions[0].items()
        }

        result = {
            "evidenceId": f"hf004-mapanything-{clip['clipId']}",
            "model": f"{MODEL_REPO} @ {MODEL_REVISION} (checkpoint sha256 {local_sha})",
            "code": f"mapanything 1.1.4 @ {CODE_COMMIT}",
            "taskProfiles": [
                "scene.metric3DReconstruction", "scene.depth",
                "scene.cameraPose", "scene.covisibility",
            ],
            "stride": stride,
            "sampling": "cv2.VideoCapture sequential read; every stride-th frame by decode order (the L010 harness convention)",
            "inferenceWindows": {
                "viewsPerWindow": WINDOW_VIEWS,
                "windowStride": WINDOW_STRIDE,
                "windowCount": len(windows),
                "resolutionMode": "load_images(resize_mode='longest_side', size=512)",
            },
            "startedAtUtc": datetime.now(timezone.utc).isoformat(),
            "resourceCaveat": RESOURCE_CAVEAT,
            "clip": {
                "clipId": clip["clipId"],
                "mediaKind": clip["mediaKind"],
                "licenseId": clip["licenseId"],
                "sha256": clip["expectedSha256"],
                "scored": clip["scored"],
                "unscoredReason": clip["unscoredReason"],
            },
            "decodedVideoMeta": video_meta,
            "host": {
                "cpuCores": os.cpu_count(),
                "torchThreads": threads,
                "device": "cpu",
                "gpu": "none — GPU memory: N/A; process RSS recorded instead",
                "torchVersion": torch.__version__,
            },
            "unscoredStructural": {
                "poseSanity": pose_sanity(all_predictions),
                "crossViewDepthConsistency": cross_view_depth_consistency(all_predictions),
                "determinism": determinism,
                "liveOutputSchema": live_schema,
            },
            "latencyMs": {
                "note": "wall-clock CPU readings, per inference (one window of views); nearest-rank percentiles",
                "inferenceCount": len(per_inference_ms),
                "mean": sum(per_inference_ms) / len(per_inference_ms),
                "min": min(per_inference_ms),
                "max": max(per_inference_ms),
                "p50NearestRank": nearest_rank_percentile(per_inference_ms, 50),
                "p95NearestRank": nearest_rank_percentile(per_inference_ms, 95),
                "perViewMean": sum(per_inference_ms) / len(per_inference_ms) / WINDOW_VIEWS,
            },
            "memory": {
                "resourceCaveat": RESOURCE_CAVEAT,
                "vmRssMiBMin": min(rss_mib),
                "vmRssMiBMax": max(rss_mib),
                "peakRssMiBRuMaxrss": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024.0,
            },
            "completedAtUtc": datetime.now(timezone.utc).isoformat(),
        }
        json_write(out_dir / clip["out"], result)
        print(f"wrote {out_dir / clip['out']}")
        shutil.rmtree(tmp_dir, ignore_errors=True)

    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[1])
    parser.add_argument("--repo-root", default=str(Path(__file__).resolve().parents[5]))
    parser.add_argument("--stride", type=int, default=10)
    parser.add_argument(
        "--out-dir", default=str(Path(__file__).resolve().parent / "results")
    )
    parser.add_argument(
        "--preflight", action="store_true",
        help="the resource gate: emits the typed refusal JSON when the host cannot hold the model",
    )
    args = parser.parse_args()

    repo_root = Path(args.repo_root)
    out_dir = Path(args.out_dir)
    if args.preflight:
        return run_preflight(repo_root, out_dir)
    return run_benchmark(repo_root, out_dir, args.stride)


if __name__ == "__main__":
    raise SystemExit(main())
