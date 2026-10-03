#!/usr/bin/env python3
"""
HF006 — the Spivak action-spotting benchmark (Worker 64-c, flight 3).

Runs the HF002-ledger candidate `yahoo-inc/spivak-action-spotting-soccernet`
(Spivak dense-detection-anchor action spotting, SoccerNet Challenge 2022
first place; model license cc-by-4.0, code apache-2.0) at the ledger-pinned
revision 1dced1b7a921f95ab741cad59325ee2e4dc08496 on:

  1. the Sporta benchmark fixture `synthetic-diagnostic-01` (the
     technology-registry fixture pair; the repo's event-fixture search found
     NO event ground truth — the annotation JSON carries per-frame SPATIAL
     discs only, no event timestamps+labels) — UNSCORED structural evidence;
  2. the authorized REAL licensed clip `fx-001` (CC0, FIFA Beach Soccer
     World Cup 2021 penalty, Wikimedia Commons; sha-pinned in the repo's
     gate-clips manifest) — UNSCORED structural evidence.

Model chain (the model's own documented path for new videos —
spivak-src/bin/predict_on_videos.py + Action-spotting-usage.md):

  video --(ResNet-152 keras h5 + SoccerNet PCA512, 2 fps)--> ResNET_TF2_PCA512
      --(zoo MaxAbsScaler `resnet_normalizer.pkl`, factor 1.0)--> resnet_normalized
      --(dense UNet, 224-frame/112 s window, 17 challenge classes)-->
      per-(frame, class) confidence logits -> sigmoid
      --(flexible NMS @ challenge nms_windows.csv + threshold 0.5)-->
      spotted events.

The benchmarked checkpoint: the zoo's Challenge-Validated resnet_normalized
CONFIDENCE model (the exact model the zoo ships for this feature family):
models/spotting_challenge_validated_resnet_normalized_confidence_zoo_
lr5e-4_dwd2e-4_sr0.02_mu0.0/best_model (variables.data-00000-of-00001
= 74,155,300 B; sha256 af234e7040cde800587cca70ff960bfb93f967df2f66bceb5
e2df43b777cf444 = the HF LFS oid, verified locally). The zoo's second
(temporal-displacement) phase was NOT run (typed caveat: confidence-only
spotting; timestamps come from dense anchors at 2 fps, no delta refinement).

Everything model-side lives OUTSIDE the repo (/home/z/hf-bench-3: venv +
spivak-src @ git a1a67483966123097447cd9312366c15ca04e9ff + downloaded
zoo files) and is NEVER committed — cc-by-4.0 permits the operator download
for benchmark evaluation (HF002 ledger + the L010 candidate registration).

Honest resource caveats (recorded in every output):
  - CPU-only inference on a 2-vCPU benchmark host with NO GPU:
    "GPU memory: N/A (no GPU on the benchmark host); process RSS
    recorded instead" — VmRSS sampled per stage + ru_maxrss peak.
  - Latency numbers are wall-clock CPU readings, labeled as such.
  - Percentiles use the repo's nearest-rank convention (rank =
    ceil(p/100 * n) — packages/latency-benchmark/src/percentiles.ts).
  - The benchmark clips are 10-12 s long; the model's inference window is
    112 s (224 feature frames) — each clip runs as ONE zero-padded window
    (the package's own VideoChunkIterator zero-padding convention).
  - Repeated-window latency microbenchmark: the same single window is run
    REPEATEDLY (identical input) to obtain a per-window latency
    distribution — labeled as such, never presented as distinct windows.

Usage:
  python3 benchmark_spivak.py --repo-root /home/z/sporta \
      --bench-root /home/z/hf-bench-3 [--repeats 12]
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

# --- repo pins (scripts/evidence/hf-portfolio/hf006 conventions) ------------

FIXTURE_MEDIA = "packages/technology-registry/fixtures/media/synthetic-diagnostic-01-players-and-ball.mp4"
FIXTURE_ANNOTATIONS = "packages/technology-registry/fixtures/annotations/synthetic-diagnostic-01.json"
FIXTURE_SHA256 = "e75abe1441fe2e6680b2aad5e7d2e66a5bcd21ab4b91928e25181f90a37f7f76"

REAL_CLIP_MEDIA = "packages/real-to-swm/fixtures/media/fx-001-normalized.mp4"
REAL_CLIP_SHA256 = "4e2f3e3d9df1eb4b0403a442c2371821c684ab8880b4544099b2d5d962543ff7"

# --- model pins (HF002 ledger row, echoed VERBATIM in benchmark-record.json) -

SPIVAK_REVISION = "1dced1b7a921f95ab741cad59325ee2e4dc08496"
SPIVAK_CODE_COMMIT = "a1a67483966123097447cd9312366c15ca04e9ff"  # github yahoo/spivak (apache-2.0)
MODEL_SUBDIR = (
    "models/spotting_challenge_validated_resnet_normalized_confidence_zoo_"
    "lr5e-4_dwd2e-4_sr0.02_mu0.0/best_model"
)
VARIABLES_DATA_REL = f"{MODEL_SUBDIR}/variables/variables.data-00000-of-00001"
VARIABLES_DATA_SHA256 = (
    "af234e7040cde800587cca70ff960bfb93f967df2f66bceb5e2df43b777cf444"
)  # the HF LFS oid at the pinned revision (hub-reported AND verified locally)
VARIABLES_DATA_SIZE = 74_155_300
NORMALIZER_REL = "models/resnet_normalizer.pkl"

CONFIDENCE_THRESHOLD = 0.5  # spivak.models.dense_predictor.DETECTION_SCORE_THRESHOLD

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


def install_import_shims() -> list[str]:
    """
    The recorded loading-recipe shims (each fail-closed if ever actually used):

    1. tensorflow_addons is ARCHIVED (last release 0.23.0, for TF <= 2.13)
       and cannot be installed alongside TF 2.21; spivak imports it at
       module top level but only ever touches `tfa.optimizers.AdamW/SGDW`
       on the TRAINING path (spivak/application/model_creation.py:491,495).
       Inference never calls them — the shim raises if it ever is.
    2. moviepy.editor and skvideo.io are imported at module top level by
       spivak's SoccerNetDataLoader but are ONLY used by the "skvideo"
       frame grabber; the benchmarked path uses the DEFAULT "opencv"
       grabber (FrameCV). The shims raise if the skvideo path is taken.
    """
    import types

    notes: list[str] = []

    shim = types.ModuleType("tensorflow_addons")
    optimizers = types.ModuleType("tensorflow_addons.optimizers")

    class _TrainingOnly:
        def __init__(self, *args, **kwargs):
            raise RuntimeError(
                "tensorflow_addons shim: optimizer construction is "
                "training-only and never happens on the inference path"
            )

    for name in ("AdamW", "SGDW", "RectifiedAdam", "Lookahead"):
        setattr(optimizers, name, _TrainingOnly)
    shim.optimizers = optimizers
    sys.modules["tensorflow_addons"] = shim
    sys.modules["tensorflow_addons.optimizers"] = optimizers
    notes.append(
        "sys.modules shim for archived tensorflow_addons (training-only "
        "optimizers AdamW/SGDW; raises if ever constructed — the inference "
        "path never constructs them; spivak/application/model_creation.py:491,495)"
    )

    def _video_loader_shim(name: str) -> types.ModuleType:
        module = types.ModuleType(name)

        def _raise(*args, **kwargs):
            raise RuntimeError(
                f"{name} shim: the skvideo frame grabber is NOT the "
                "benchmarked path (the default opencv/FrameCV grabber is)"
            )

        module.editor = _raise
        module.io = types.SimpleNamespace(io=_raise, vreader=_raise)
        return module

    shimmed: list[str] = []
    for mod_name in ("moviepy", "moviepy.editor", "skvideo", "skvideo.io"):
        try:
            __import__(mod_name)
        except ImportError:
            sys.modules[mod_name] = _video_loader_shim(mod_name)
            shimmed.append(mod_name)
    notes.append(
        "sys.modules shims (fail-closed, raise if used) for the video-loader "
        f"modules that could not be installed on this host: {shimmed} — "
        "imported at top level by SoccerNetDataLoader; only the skvideo "
        "graber and moviepy's duration probe touch them, the benchmarked "
        "path is the DEFAULT opencv/FrameCV grabber (moviepy itself was "
        "installed and used for the duration probe where present)"
    )
    return notes


# --- the benchmark -----------------------------------------------------------


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[1])
    parser.add_argument("--repo-root", default=str(Path(__file__).resolve().parents[5]))
    parser.add_argument(
        "--bench-root", default="/home/z/hf-bench-3",
        help="the OUTSIDE-the-repo flight root (venv + spivak-src + hf-model)",
    )
    parser.add_argument("--repeats", type=int, default=12)
    parser.add_argument("--out-dir", default=str(Path(__file__).resolve().parent / "results"))
    args = parser.parse_args()

    repo = Path(args.repo_root).resolve()
    bench = Path(args.bench_root).resolve()
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    shim_notes = install_import_shims()
    os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "3")

    import numpy as np  # noqa: E402
    import tensorflow as tf  # noqa: E402

    # fail-closed clip verification (the repo's own manifest pins)
    fixture_path = repo / FIXTURE_MEDIA
    real_path = repo / REAL_CLIP_MEDIA
    fixture_sha = sha256_of(fixture_path)
    real_sha = sha256_of(real_path)
    if fixture_sha != FIXTURE_SHA256:
        raise RuntimeError(f"fixture drifted: {fixture_sha} != pin {FIXTURE_SHA256}")
    if real_sha != REAL_CLIP_SHA256:
        raise RuntimeError(f"fx-001 drifted: {real_sha} != pin {REAL_CLIP_SHA256}")

    # fail-closed checkpoint verification (the pinned revision + LFS oid)
    model_dir = bench / "hf-model" / "dl" / MODEL_SUBDIR
    variables_path = bench / "hf-model" / "dl" / VARIABLES_DATA_REL
    normalizer_path = bench / "hf-model" / "dl" / NORMALIZER_REL
    for required in (model_dir / "saved_model.pb", variables_path, normalizer_path):
        if not required.exists():
            raise RuntimeError(f"zoo file missing: {required}")
    variables_sha = sha256_of(variables_path)
    if variables_sha != VARIABLES_DATA_SHA256:
        raise RuntimeError(f"checkpoint drifted: {variables_sha} != pin {VARIABLES_DATA_SHA256}")
    if variables_path.stat().st_size != VARIABLES_DATA_SIZE:
        raise RuntimeError(
            f"checkpoint size drifted: {variables_path.stat().st_size} != {VARIABLES_DATA_SIZE}"
        )

    # the spivak package (code pin; installed editable from spivak-src)
    sys.path.insert(0, str(bench / "spivak-src"))
    from spivak.application.argument_parser import SharedArgs  # noqa: E402
    from spivak.data.dataset import Task  # noqa: E402
    from spivak.application.dataset_creation import create_label_maps  # noqa: E402

    # SharedArgs: the model's own saved run arguments (from shared_args.pkl)
    shared_args = SharedArgs.load(str(model_dir))
    shared_args.config_dir = str(bench / "spivak-src" / "configs" / "soccernet_challenge_confidence")
    label_maps = create_label_maps(shared_args)
    spot_labels = [
        label_maps[Task.SPOTTING].int_to_label[i]
        for i in range(label_maps[Task.SPOTTING].num_classes())
    ]

    # --- model load: the package's own DensePredictor path, with honest
    # fallbacks. The checkpoint is a Keras-2-era SavedModel (TF 2.7 line);
    # this host runs TF 2.21 (Keras 3 native), so the primary path loads it
    # through the tf_keras (Keras 2 compat) package and wraps it in the
    # spivak package's own DensePredictor. Ladder, recorded in loadInfo.path:
    #   1. tf_keras.models.load_model(compile=False) + spivak DensePredictor
    #      (heads + chunk iterator + NMS straight from the package);
    #   2. tf.saved_model.load serving-default fallback driving the package's
    #      own VideoChunkIterator + accumulation + expit post-process.
    load_started = time.perf_counter()
    from spivak.data.video_chunk_iterator import VideoChunkIteratorProvider  # noqa: E402
    from spivak.models.dense_predictor import DensePredictor  # noqa: E402
    from spivak.application.model_creation import (  # noqa: E402
        _dense_predictor_heads,
        _video_chunk_iterator_provider,
        create_flexible_nms,
    )
    from spivak.models.sam_model import maybe_convert_model_to_sam  # noqa: E402
    flexible_nms = create_flexible_nms(shared_args, label_maps[Task.SPOTTING])
    provider = _video_chunk_iterator_provider(
        shared_args, shared_args.chunk_prediction_border)

    try:
        import tf_keras  # noqa: E402

        keras_model = tf_keras.models.load_model(str(model_dir), compile=False)
        maybe_convert_model_to_sam(keras_model, shared_args.sam_rho, 1e-12)
        predictor_heads = _dense_predictor_heads(shared_args, label_maps)
        predictor = DensePredictor(
            keras_model, predictor_heads, provider,
            bool(getattr(shared_args, "throw_out_delta", True)), False)
        load_path = (
            "tf_keras.models.load_model(compile=False) + the spivak package's "
            "own DensePredictor (heads, chunk iterator, NMS) — the Keras-2 "
            "compat load of the Keras-2-era SavedModel on TF 2.21"
        )

        def run_window(features: np.ndarray) -> dict:
            return predictor.predict_video_base(features)

    except Exception as keras_error:
        from scipy.special import expit  # noqa: E402

        loaded = tf.saved_model.load(str(model_dir))
        signature = loaded.signatures["serving_default"]
        input_name = sorted(signature.structured_input_signature[1].keys())[0]
        output_names = sorted(signature.structured_outputs.keys())
        confidence_output_name = next(
            (n for n in output_names if "confidence" in n), output_names[0])
        import math as _math  # noqa: E402

        num_chunk_frames = _math.floor(shared_args.frame_rate * shared_args.chunk_duration)
        from spivak.application.model_creation import _num_border_frames  # noqa: E402
        num_border_frames = _num_border_frames(
            shared_args, shared_args.chunk_prediction_border)
        load_path = (
            "tf.saved_model.load serving-default fallback (both keras load "
            f"paths failed: {type(keras_error).__name__}) driving the "
            "package's own VideoChunkIterator + accumulate + expit"
        )

        def run_window(features: np.ndarray) -> dict:
            iterator = provider.provide(features)
            batch, valid_sizes = iterator.prepare_input_batch()
            raw = signature(tf.constant(batch, dtype=tf.float32))
            logits = raw[confidence_output_name].numpy()  # (B, T, C, 1)
            confidences = expit(logits[:, :, :, 0])  # sigmoid, the head's post_process
            accumulated = np.zeros(
                (features.shape[0], confidences.shape[2]), dtype=np.float32)
            outputs_by_chunk = [confidences[c:c + 1] for c in range(confidences.shape[0])]
            iterator.accumulate_chunk_outputs(accumulated, outputs_by_chunk)
            return {"confidence": accumulated}
    load_seconds = time.perf_counter() - load_started

    tf_version = tf.__version__
    host = {
        "cpuCores": os.cpu_count(),
        "device": "cpu",
        "gpu": "none — GPU memory: N/A; process RSS recorded instead",
        "tensorflowVersion": tf_version,
        "spivakCodeCommit": SPIVAK_CODE_COMMIT,
        "spivakModelRevision": SPIVAK_REVISION,
    }

    common = {
        "model": (
            "yahoo-inc/spivak-action-spotting-soccernet @ "
            f"{SPIVAK_REVISION} — {MODEL_SUBDIR} (the Challenge-Validated "
            "resnet_normalized CONFIDENCE model; the zoo's second "
            "temporal-displacement phase NOT run in this flight)"
        ),
        "taskProfile": "football.eventSpotting",
        "confidenceThreshold": CONFIDENCE_THRESHOLD,
        "labels": spot_labels,
        "frameRateHz": shared_args.frame_rate,
        "window": {
            "chunkDurationArgSeconds": shared_args.chunk_duration,
            "chunkFrames": int(shared_args.frame_rate * shared_args.chunk_duration),
            "chunkSeconds": shared_args.chunk_duration,
            "chunkPredictionBorderSeconds": shared_args.chunk_prediction_border,
            "note": (
                "each 10-12 s clip is ONE zero-padded 112 s window (the "
                "package's own VideoChunkIterator zero-padding convention)"
            ),
        },
        "startedAtUtc": datetime.now(timezone.utc).isoformat(),
        "resourceCaveat": RESOURCE_CAVEAT,
    }

    # --- the feature front-end (the model's own extraction path) -------------
    from spivak.feature_extraction.extraction import (  # noqa: E402
        create_feature_extractor,
        VideoInfo,
    )
    import pickle  # noqa: E402

    feature_models_dir = bench / "feature-models"
    feature_extractor = create_feature_extractor("ResNet_TF2", feature_models_dir)
    with open(normalizer_path, "rb") as f:
        normalizer = pickle.load(f)  # sklearn MaxAbsScaler (zoo, sklearn 1.0.2)
    # Version-compat patch (recorded): the zoo scaler was pickled with
    # sklearn 1.0.2, before MaxAbsScaler gained the `clip` attribute
    # (sklearn >= 1.1, default False). 1.0.2 semantics == clip=False.
    if not hasattr(normalizer, "clip"):
        normalizer.clip = False
    normalizer_note = (
        f"{type(normalizer).__name__} (zoo models/resnet_normalizer.pkl, "
        "pickled with sklearn 1.0.2; transform applied per feature with "
        "the stored scale_ — the pre-1.1 `clip` attribute patched to "
        "False (the 1.0.2 semantics); transform is otherwise "
        "scale-invariant across versions; fit on 2048-dim features)"
    )

    work_dir = bench / "work" / "hf006"
    work_dir.mkdir(parents=True, exist_ok=True)

    def make_features(video_path: Path) -> tuple[np.ndarray, dict]:
        # Forensic (recorded): the zoo normalizer is a MaxAbsScaler fitted on
        # 2048-dim features — the resnet_normalized family consumes the RAW
        # ResNET_TF2 features (2048-d avg-pool @ 2 fps), NOT the PCA512 ones
        # (extraction.py's PCA512 path serves the older soccernet_v2 models;
        # the challenge commands normalize `ResNET_TF2` with factor 1.0).
        t0 = time.perf_counter()
        raw_features = np.asarray(
            feature_extractor.raw_feature_extractor.extract_features(
                str(video_path), 0, 0))
        extraction_s = time.perf_counter() - t0
        t0 = time.perf_counter()
        normalized = normalizer.transform(raw_features)
        normalization_s = time.perf_counter() - t0
        meta = {
            "extractionSeconds": round(extraction_s, 3),
            "normalizationSeconds": round(normalization_s, 4),
            "rawFeatureFrames": int(raw_features.shape[0]),
            "featureDim": int(raw_features.shape[1]),
            "featuresPerSecond": 2.0,
            "rawFeaturesMin": float(raw_features.min()),
            "rawFeaturesMax": float(raw_features.max()),
            "normalizedFeaturesAbsMax": float(abs(normalized).max()),
            "featureFamily": (
                "resnet_normalized = RAW 2048-d ResNET_TF2 @ 2 fps "
                "(keras ResNet-152 avg_pool) through the zoo MaxAbsScaler "
                "(models/resnet_normalizer.pkl) — the 2048-d fit of the "
                "scaler proves the raw path; extraction.py's PCA512 branch "
                "is NOT this family (challenge commands: factor 1.0, "
                "input feature name ResNET_TF2)"
            ),
            "normalizer": normalizer_note,
        }
        return normalized.astype(np.float32), meta

    # --- the run loop --------------------------------------------------------
    import cv2  # noqa: E402

    def probe_meta(path: Path) -> dict:
        cap = cv2.VideoCapture(str(path))
        meta = {
            "frameCount": int(cap.get(cv2.CAP_PROP_FRAME_COUNT)),
            "fps": cap.get(cv2.CAP_PROP_FPS),
            "width": int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)),
            "height": int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)),
        }
        cap.release()
        return meta

    def run_clip(clip_id: str, media_path: Path, media_sha: str, kind: str,
                 license_note: str) -> dict:
        features, feature_meta = make_features(media_path)
        # warmup + repeated-window microbenchmark (identical input each time)
        window_latencies: list[float] = []
        outputs: dict = {}
        for repeat in range(2 + args.repeats):
            t0 = time.perf_counter()
            outputs = run_window(features)
            window_latencies.append((time.perf_counter() - t0) * 1000.0)
        steady = window_latencies[2:]  # first two calls carry lazy-init warmup
        confidence = outputs["confidence"]  # (num_frames, 17) probabilities

        # NMS + threshold — exactly spivak DensePredictor.save_predictions
        detection_scores = confidence  # confidence-only model: scores == confidence
        scores_nms = flexible_nms.maybe_apply(detection_scores.copy())
        thresholded = np.where(scores_nms >= CONFIDENCE_THRESHOLD, 1, 0)
        events = []
        for frame_idx, class_idx in zip(*np.nonzero(thresholded)):
            events.append({
                "timeSeconds": round(frame_idx / shared_args.frame_rate, 3),
                "frameIndex": int(frame_idx),
                "label": spot_labels[int(class_idx)],
                "confidence": round(float(scores_nms[frame_idx, class_idx]), 4),
            })

        # structural (unscored) metrics
        max_per_class = confidence.max(axis=0)
        per_class_stats = [
            {
                "label": spot_labels[c],
                "maxConfidence": round(float(max_per_class[c]), 4),
                "meanConfidence": round(float(confidence[:, c].mean()), 5),
                "anchorCountAbove0.5": int((confidence[:, c] >= 0.5).sum()),
                "anchorCountAbove0.9": int((confidence[:, c] >= 0.9).sum()),
            }
            for c in range(len(spot_labels))
        ]
        histogram = np.histogram(confidence.ravel(), bins=10, range=(0.0, 1.0))
        confidence_histogram = {
            "binEdges": [round(float(b), 2) for b in histogram[1]],
            "counts": [int(c) for c in histogram[0]],
        }

        event_label_hist: dict[str, int] = {}
        for event in events:
            event_label_hist[event["label"]] = event_label_hist.get(event["label"], 0) + 1

        record = {
            "evidenceId": f"hf006-spivak-{clip_id}",
            **common,
            "clip": {
                "clipId": clip_id,
                "mediaKind": kind,
                "licenseId": license_note,
                "sha256": media_sha,
                "decodedVideoMeta": probe_meta(media_path),
            },
            "scoring": {
                "kind": "unscored-structural",
                "note": (
                    "NO event ground truth exists in the repo for this media "
                    "(the fixture annotations carry per-frame SPATIAL discs "
                    "only; the real clip has no annotations) — spotted-event "
                    "distributions recorded unscored per the brief's fallback"
                ),
            },
            "features": feature_meta,
            "loadInfo": {
                "path": load_path,
                "loadSeconds": round(load_seconds, 2),
                "shims": shim_notes,
                "checkpoint": {
                    "file": VARIABLES_DATA_REL,
                    "sizeBytes": VARIABLES_DATA_SIZE,
                    "sha256": VARIABLES_DATA_SHA256,
                    "verification": "sha256 == the HF LFS oid at the pinned revision (verified locally)",
                },
                "sharedArgsEcho": {
                    k: getattr(shared_args, k) for k in (
                        "chunk_duration", "chunk_prediction_border", "frame_rate",
                        "detector", "backbone", "feature_name", "nms_window",
                        "nms_decay", "confidence_weight", "delta_weight",
                        "sam_rho", "width", "unet_layers_start", "unet_layers_end")
                },
                "twoPhaseNote": (
                    "the zoo's temporal-displacement (delta) second phase NOT "
                    "run — confidence-only spotting; event timestamps are the "
                    "dense anchor positions at 2 fps"
                ),
            },
            "host": host,
            "latencyMs": {
                "note": (
                    "wall-clock CPU readings; repeated-window microbenchmark "
                    "(the SAME single zero-padded window run repeatedly); the "
                    "first two calls carry lazy-init warmup and are excluded"
                ),
                "firstCallMs": round(window_latencies[0], 2),
                "steadyCount": len(steady),
                "mean": round(sum(steady) / len(steady), 2),
                "min": round(min(steady), 2),
                "max": round(max(steady), 2),
                "p50NearestRank": round(nearest_rank_percentile(steady, 50), 2),
                "p95NearestRank": round(nearest_rank_percentile(steady, 95), 2),
                "frontEndExtractionMs": round(feature_meta["extractionSeconds"] * 1000.0, 1),
                "frontEndExtractionNote": (
                    "the ResNet-152 + PCA512 feature extraction of this clip "
                    "(the cascade's front-end cost; not amortized per window)"
                ),
            },
            "memory": {
                "resourceCaveat": RESOURCE_CAVEAT,
                "vmRssMiBAfterRun": round(vm_rss_mib(), 1),
                "peakRssMiBRuMaxrss": round(
                    resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024.0, 1),
            },
            "spottedEvents": {
                "count": len(events),
                "labelHistogram": event_label_hist,
                "events": events[:200],
                "eventsTruncated": len(events) > 200,
                "detectionThreshold": CONFIDENCE_THRESHOLD,
                "nms": "flexible NMS (suppress decay, per-class challenge nms_windows.csv)",
            },
            "structure": {
                "perClass": per_class_stats,
                "confidenceHistogramAllAnchors": confidence_histogram,
                "anchorCount": int(confidence.shape[0] * confidence.shape[1]),
                "eventsPerMinuteEquivalent": round(
                    len(events) / (features.shape[0] / 2.0 / 60.0), 2),
            },
            "completedAtUtc": datetime.now(timezone.utc).isoformat(),
        }
        return record

    fixture_record = run_clip(
        "synthetic-diagnostic-01", fixture_path, fixture_sha,
        "synthetic-diagnostic", "in-repo-synthetic-diagnostic")
    fixture_out = out_dir / "spivak-synthetic-diagnostic-01.json"
    fixture_out.write_text(json.dumps(fixture_record, indent=2) + "\n")
    print(f"fixture evidence written: {fixture_out}")
    print(f"  load path: {load_path}")
    print(f"  events: {fixture_record['spottedEvents']['count']} "
          f"{fixture_record['spottedEvents']['labelHistogram']}")
    print(f"  latency steady mean={fixture_record['latencyMs']['mean']}ms "
          f"p50={fixture_record['latencyMs']['p50NearestRank']}ms "
          f"p95={fixture_record['latencyMs']['p95NearestRank']}ms")
    print(f"  front-end extraction: {fixture_record['latencyMs']['frontEndExtractionMs']}ms")

    real_record = run_clip(
        "fx-001", real_path, real_sha, "real-footage", "CC0-1.0")
    real_out = out_dir / "spivak-fx-001.json"
    real_out.write_text(json.dumps(real_record, indent=2) + "\n")
    print(f"real-clip evidence written: {real_out}")
    print(f"  events: {real_record['spottedEvents']['count']} "
          f"{real_record['spottedEvents']['labelHistogram']}")
    print(f"  latency steady mean={real_record['latencyMs']['mean']}ms "
          f"p50={real_record['latencyMs']['p50NearestRank']}ms "
          f"p95={real_record['latencyMs']['p95NearestRank']}ms")
    print(f"  front-end extraction: {real_record['latencyMs']['frontEndExtractionMs']}ms")
    print(f"  vmRSS={real_record['memory']['vmRssMiBAfterRun']} MiB "
          f"peak={real_record['memory']['peakRssMiBRuMaxrss']} MiB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
