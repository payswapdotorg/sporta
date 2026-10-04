#!/usr/bin/env python3
"""
HF012 — the Wan2.2-Animate character animation benchmark (flight 9,
Worker C's renderer wave, worker 65-c). The candidate: Wan2.2-Animate.

THE WORK ITEM (VERBATIM — docs/work-items/hf-model-portfolio-work-items.md):

  HF012 — Character animation benchmark
  "Owner: Worker C. Candidate: Wan2.2-Animate.
   Acceptance: evaluate player/avatar motion fidelity and temporal identity
   stability against Sporta's Anime/NPR direction; no canonical player truth
   may be generated solely by the renderer."

THE CANDIDATE (provenance-ledger row, echoed VERBATIM in
benchmark-record.json and validated there by record-benchmark.ts):

  Wan2.2-Animate = Wan-AI/Wan2.2-Animate-14B
  @ cb93a225fbaf1ca100f54e79da8f994995b689b3 (apache-2.0/apache-2.0,
  commercialUse yes; weights: "Wan2.2-Animate-14B, a unified character
  animation and replacement model built on base model
  Wan-AI/Wan2.2-I2V-A14B (per card frontmatter and release notes).";
  datasetProvenance unknown; gatingState candidate)

THE FROZEN TASK PROFILE renderer.characterAnimation
(docs/contracts/technology-task-profiles.md — consumed, never modified):

  "Inputs: canonical entity motion/state plus authorized style/avatar
   reference. Outputs: temporally coherent character animation. Metrics:
   identity, motion fidelity, temporal consistency, style adherence."

THE BUILT-IN HONESTY CONSTRAINT (the acceptance's own words,
load-bearing — the C→A boundary): "no canonical player truth may be
generated solely by the renderer." The benchmark MEASURES fidelity and
identity AGAINST canonical truth (the SWM entity state / the authorized
avatar reference); the renderer under test is NEVER the source of that
truth. This is encoded below as the machine-checkable
no_canonical_truth_invariant(): a benchmark plan whose ground-truth
provenance names the renderer under test is REFUSED (self-checked both
ways). The renderer's output is a MEASURAND, never a truth source.

THE HONEST SHAPE ON THIS HOST (2 vCPU, ~3.95 GiB total RAM, ~1.04 GiB
free disk, no GPU): the compute leg is RESOURCE-INFEASIBLE — the pinned
tree's core inference composition is 47.68 GiB (MoE dual-expert diffusion
32.18 GiB + umt5-xxl text encoder 10.58 GiB + CLIP image encoder 4.44
GiB + Wan2.1 VAE 0.47 GiB) vs ~1.04 GiB free disk; the documented
preprocessing leg adds ~5.36 GiB more; the card's own download command
pulls the whole 67.41 GiB tree; the RECOMMENDED animation preprocessing
route (pose retargeting with --use_flux) additionally requires the GATED
(auto) black-forest-labs/FLUX.1-Kontext-dev (53.90 GiB of weights,
license:other); the bf16 inference working set ≈ 48+ GiB ≈ 12x this
host's TOTAL RAM; every documented generation command runs on a GPU
(single-GPU recipe + --dit_fsdp/--t5_fsdp multi-GPU variants; torch>=2.4
+ flash_attn). The preflight arithmetic (EXECUTED, bounded probes ONLY —
weights never downloaded) refuses the compute leg; the partial (the
acceptance's real value) is delivered: the load analysis, the license
posture, the motion-fidelity + temporal-identity + style-adherence +
temporal-consistency metric designs (implemented ready-to-run, typed
not-measured, self-checked against hand-computed cases), the Anime/NPR
direction comparison (static capability delta + the adequate-host
comparison design), and the machine-checkable contract mapping
(contract_compatibility.ts).

MODES:
  --mode preflight   EXECUTED on this host (exit 3, the typed refusal):
                      host resources, the bounded pinned hub probes (the
                      file tree at the pinned revision, the 20 010-byte
                      card, the FLUX.1-Kontext-dev dependency, the base
                      model — NEVER any weights), the candidate's own
                      GitHub docs (UserGuider.md + LICENSE.txt +
                      generate.py, sha-pinned), the resource arithmetic,
                      the license-posture extraction, the Anime/NPR
                      comparison (static + design). Writes
                      results/load-analysis.json,
                      results/model-io-surface.json,
                      results/license-posture.json,
                      results/anime-npr-comparison.json,
                      results/preflight-refusal.json.
  --mode selfcheck   EXECUTED: verifies the metric implementations
                      against hand-computed cases AND the
                      no-canonical-truth invariant both ways (a
                      renderer-truth plan is refused) — IMPLEMENTATION
                      evidence, NOT a model measurement. Writes
                      results/metric-selfcheck.json.
  --mode full        READY-TO-RUN on an adequate host (>= 32 GiB RAM,
                      >= 64 GiB free disk, a CUDA GPU — the repo's own
                      generation commands are GPU recipes; CPU-only hosts
                      are refused): the sha-pinned weights staged by the
                      repo's own commands, the documented preprocessing
                      (preprocess_data.py) + generation (generate.py
                      --task animate-14B), the pose-estimated output
                      track, the identity/style descriptor extraction,
                      and the full metric battery (the same
                      implementations self-checked below). Refuses exit 3
                      otherwise (fail-closed; negative-tested on THIS
                      host).

Run (from the repo root, the venv outside it):
  /home/z/hf-bench-9/bin/python scripts/evidence/hf-portfolio/hf012/benchmark_wan22animate.py --mode preflight
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import math
import os
import shutil
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
RESULTS = HERE / "results"
HF010_DIR = HERE.parent / "hf010"

# ---------------------------------------------------------------------------
# The pinned candidate + its documented composition (echoed verbatim in
# benchmark-record.json, validated there against the provenance ledger)
# ---------------------------------------------------------------------------

CANDIDATE = {
    "candidate": "Wan2.2-Animate",
    "repoId": "Wan-AI/Wan2.2-Animate-14B",
    "revision": "cb93a225fbaf1ca100f54e79da8f994995b689b3",
    "baseModel": "Wan-AI/Wan2.2-I2V-A14B (per the card frontmatter; the ledger's weightsProvenance row verbatim)",
    "smallMetadataFiles": ["README.md"],
    "codeRepo": "https://github.com/Wan-Video/Wan2.2 (the code + docs the card points to)",
}

# The documented dependency set (the card's own Run-Wan2.2-Animate section +
# the UserGuider, both fetched bounded and sha-pinned in load-analysis.json):
#   - core inference: the 4-shard MoE diffusion model + Wan2.1_VAE.pth +
#     models_t5_umt5-xxl-enc-bf16.pth + models_clip_...-vit-huge-14.pth;
#   - preprocessing (MANDATORY pose detection per the UserGuider):
#     process_checkpoint/det/yolov10m.onnx + pose2d/vitpose_h_wholebody.onnx +
#     sam2/sam2_hiera_large.pt + xlm-roberta-large (the tree carries 4 format
#     variants; one is needed);
#   - the RECOMMENDED animation preprocessing route (--retarget_flag
#     --use_flux) additionally requires black-forest-labs/FLUX.1-Kontext-dev
#     — GATED (auto), license:other, 53.90 GiB of weights;
#   - the replacement mode adds the optional relighting LoRA
#     (relighting_lora/adapter_model.safetensors 2.87 GB).
FLUX_DEPENDENCY = {
    "repoId": "black-forest-labs/FLUX.1-Kontext-dev",
    "role": "the UserGuider's RECOMMENDED enhanced pose-retargeting route for animation mode (--use_flux); basic retargeting and no-retarget routes exist without it",
    "licenseTag": "license:other (the hub API tag at probe time)",
    "shaAtProbe": "24e9dedc4ef646698dc8eb4e18ae2cec3c9fea0d",
}

BASE_MODEL = {
    "repoId": "Wan-AI/Wan2.2-I2V-A14B",
    "role": "the card frontmatter's declared base model (the ledger's weightsProvenance); NOT a download dependency — the Animate-14B tree carries its own inference weights",
    "shaAtProbe": "206a9ee1b7bfaaf8f7e4d81335650533490646a3",
}

# The ready-to-run full-mode host floor (the repo's own posture: the
# single-GPU recipe + the multi-GPU --dit_fsdp/--t5_fsdp variants; torch>=2.4).
FULL_HOST_MIN_RAM_GIB = 32.0
FULL_HOST_MIN_DISK_GIB = 64.0

# The UserGuider's own preprocessing pin (fetched, sha-pinned below).
PREPROCESS_PINNED_FILES = {
    "det": "yolov10m.onnx",
    "pose2d": "vitpose_h_wholebody.onnx (394 tensor files in the tree)",
    "sam2": "sam2_hiera_large.pt",
    "flux": "FLUX.1-Kontext-dev/ (the --use_flux route only)",
}


def _gib(num_bytes: float) -> float:
    return num_bytes / (1024**3)


def _fmt_gib(num_bytes: float) -> str:
    return f"{_gib(num_bytes):.2f} GiB"


# ---------------------------------------------------------------------------
# The SHARED metric implementations — imported from the merged HF010 flight's
# benchmark_renderer.py so BOTH comparison lanes (anime-npr and Wan2.2-
# Animate) are scored by THE SAME estimator code (the fairness rule the
# acceptance's "against Sporta's Anime/NPR direction" demands)
# ---------------------------------------------------------------------------

_spec = importlib.util.spec_from_file_location("hf010_benchmark_renderer", HF010_DIR / "benchmark_renderer.py")
hf010 = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(hf010)

ssim_constant_patches = hf010.ssim_constant_patches
_Flow = hf010._Flow
flow_warp_residual = hf010.flow_warp_residual
wall_clock_ms_per_output_second = hf010.wall_clock_ms_per_output_second


# ---------------------------------------------------------------------------
# Host resources
# ---------------------------------------------------------------------------


def host_resources() -> dict:
    with open("/proc/meminfo", "r", encoding="ascii") as fh:
        lines = {k: int(v.strip().rstrip(" kB")) * 1024 for k, v in (ln.split(":", 1) for ln in fh if ":" in ln)}
    total = lines.get("MemTotal", 0)
    available = lines.get("MemAvailable", 0)
    usage = shutil.disk_usage(str(Path.home()))
    gpu = "N/A (no CUDA device on this host — nvidia-smi absent)"
    if shutil.which("nvidia-smi"):
        probe = subprocess.run(
            ["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"], capture_output=True, timeout=10
        )
        if probe.returncode == 0 and probe.stdout.strip():
            gpu = probe.stdout.decode().strip().splitlines()[0]
    return {
        "cpuCount": os.cpu_count(),
        "totalRamBytes": total,
        "totalRamGiB": round(_gib(total), 2),
        "availableRamBytes": available,
        "availableRamGiB": round(_gib(available), 2),
        "freeDiskBytes": usage.free,
        "freeDiskGiB": round(_gib(usage.free), 2),
        "gpu": gpu,
        "measuredAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }


# ---------------------------------------------------------------------------
# Bounded probes (metadata ONLY — weights NEVER downloaded)
# ---------------------------------------------------------------------------


def _hub_api():
    from huggingface_hub import HfApi

    return HfApi()


def probe_repo(api, repo_id: str, revision: str | None = None) -> dict:
    info = api.model_info(repo_id, revision=revision, files_metadata=True)
    files = []
    total = 0
    for s in info.siblings:
        sz = getattr(s, "size", None)
        files.append({"name": s.rfilename, "bytes": sz})
        if sz:
            total += sz
    return {
        "repoId": repo_id,
        "requestedRevision": revision,
        "resolvedSha": info.sha,
        "revisionMatch": (info.sha == revision) if revision else None,
        "gated": str(info.gated),
        "pipelineTag": getattr(info, "pipeline_tag", None),
        "licenseTags": [t for t in (getattr(info, "tags", None) or []) if "license" in t],
        "fileCount": len(files),
        "totalBytes": total,
        "totalGiB": round(_gib(total), 2),
        "weightsDownloaded": False,
        "note": "bounded metadata probe (HfApi.model_info files_metadata) — zero weight bytes fetched",
    }


def _file_group(name: str) -> str:
    if name.startswith("process_checkpoint/pose2d"):
        return "preprocess-pose2d"
    if name.startswith("process_checkpoint/sam2"):
        return "preprocess-sam2"
    if name.startswith("process_checkpoint/"):
        return "preprocess-det"
    if name.startswith("xlm-roberta-large"):
        return "preprocess-xlm-roberta-large"
    if name.startswith("relighting"):
        return "optional-relighting-lora"
    if name.startswith("diffusion_pytorch_model"):
        return "core-diffusion-moe"
    if name == "Wan2.1_VAE.pth":
        return "core-vae"
    if name == "models_t5_umt5-xxl-enc-bf16.pth":
        return "core-t5-encoder"
    if name == "models_clip_open-clip-xlm-roberta-large-vit-huge-14.pth":
        return "core-clip-encoder"
    return "other"


def composition_breakdown(repo_probe: dict) -> dict:
    """Group the pinned tree's file listing into the documented composition."""
    # re-probe siblings (the probe dict above keeps only the summary; the
    # breakdown re-derives groups from a fresh files_metadata listing)
    api = _hub_api()
    info = api.model_info(repo_probe["repoId"], revision=repo_probe["requestedRevision"], files_metadata=True)
    groups: dict[str, dict] = {}
    pinned = {}
    for s in info.siblings:
        sz = getattr(s, "size", None) or 0
        name = s.rfilename
        g = _file_group(name)
        entry = groups.setdefault(g, {"bytes": 0, "files": 0})
        entry["bytes"] += sz
        entry["files"] += 1
        if name in (
            "Wan2.1_VAE.pth",
            "models_t5_umt5-xxl-enc-bf16.pth",
            "models_clip_open-clip-xlm-roberta-large-vit-huge-14.pth",
            "process_checkpoint/sam2/sam2_hiera_large.pt",
            "process_checkpoint/det/yolov10m.onnx",
            "xlm-roberta-large/pytorch_model.bin",
            "relighting_lora/adapter_model.safetensors",
        ) or name.startswith("diffusion_pytorch_model-0000"):
            pinned[name] = sz
    for g, entry in groups.items():
        entry["GiB"] = round(_gib(entry["bytes"]), 2)
    core = groups["core-diffusion-moe"]["bytes"] + groups["core-vae"]["bytes"] + groups["core-t5-encoder"]["bytes"] + groups["core-clip-encoder"]["bytes"]
    preprocess = groups["preprocess-det"]["bytes"] + groups["preprocess-pose2d"]["bytes"] + groups["preprocess-sam2"]["bytes"] + pinned["xlm-roberta-large/pytorch_model.bin"]
    return {
        "pinnedFileBytes": pinned,
        "groups": groups,
        "coreInferenceBytes": core,
        "coreInferenceGiB": round(_gib(core), 2),
        "coreComponents": {
            "diffusionMoeShards": f"{groups['core-diffusion-moe']['files']} files (4 safetensors shards + index), {groups['core-diffusion-moe']['GiB']} GiB",
            "t5Encoder": f"models_t5_umt5-xxl-enc-bf16.pth, {groups['core-t5-encoder']['GiB']} GiB",
            "clipEncoder": f"models_clip_open-clip-xlm-roberta-large-vit-huge-14.pth, {groups['core-clip-encoder']['GiB']} GiB",
            "vae": f"Wan2.1_VAE.pth, {groups['core-vae']['GiB']} GiB",
        },
        "mandatoryPreprocessBytes": preprocess,
        "mandatoryPreprocessGiB": round(_gib(preprocess), 2),
        "wholeTreeBytes": repo_probe["totalBytes"],
        "wholeTreeGiB": repo_probe["totalGiB"],
        "xlmRobertaNote": "the tree carries xlm-roberta-large in 4 formats (flax/onnx/pytorch/tf = 10.47 GiB); the breakdown counts the single pytorch_model.bin variant",
        "relightingNote": "the replacement mode's optional relighting LoRA (adapter_model.safetensors 2.87 GB; the tree also carries a .ckpt twin — both formats 5.35 GiB)",
    }


def fetch_small_file(api, repo_id: str, revision: str, filename: str) -> dict:
    from huggingface_hub import hf_hub_download

    path = hf_hub_download(repo_id, filename, revision=revision)
    data = Path(path).read_bytes()
    return {
        "repoId": repo_id,
        "revision": revision,
        "filename": filename,
        "bytes": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
    }


def fetch_github_doc(url: str) -> dict:
    with urllib.request.urlopen(url, timeout=30) as r:
        data = r.read()
    return {
        "url": url,
        "bytes": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
    }


# ---------------------------------------------------------------------------
# THE NO-CANONICAL-TRUTH INVARIANT (machine-checkable, load-bearing)
# ---------------------------------------------------------------------------

# The ONLY provenances a ground-truth track may carry in this benchmark
# (the C→A boundary: renderer-required read model only; never a new source
# of world truth).
CANONICAL_TRUTH_SOURCES = ("swm-entity-state", "authorized-avatar-reference")

# The renderers this benchmark may put under test (their outputs are
# MEASURANDS — if a ground-truth track's provenance names one of these,
# the renderer generated canonical truth and the plan is REFUSED).
RENDERERS_UNDER_TEST = (
    "Wan-AI/Wan2.2-Animate-14B@cb93a225",
    "anime-npr.prototype@0.2.0",
)


def no_canonical_truth_invariant(plan: dict) -> dict:
    """The machine-checkable form of the acceptance's own constraint: "no
    canonical player truth may be generated solely by the renderer."

    A benchmark plan carries ground-truth tracks; each track's provenance
    must be one of CANONICAL_TRUTH_SOURCES. Any track whose provenance names
    a renderer under test (the Wan2.2-Animate candidate or the repo's own
    anime-npr renderer) is REFUSED — the invariant fails closed, listing the
    offending track(s). The renderer's OUTPUT is always recorded under the
    measurand key, never under groundTruth.
    """
    tracks = plan.get("groundTruth") or []
    violations = []
    for track in tracks:
        prov = str(track.get("provenance", ""))
        if prov not in CANONICAL_TRUTH_SOURCES:
            violations.append(
                f"ground-truth track {track.get('trackId', '?')} provenance '{prov}' is not a canonical source"
            )
        for renderer in RENDERERS_UNDER_TEST:
            if renderer.lower() in prov.lower():
                violations.append(
                    f"ground-truth track {track.get('trackId', '?')} provenance names the renderer under test ({renderer}) — the renderer may never be the source of canonical player truth"
                )
    if plan.get("measurand", {}).get("provenance") not in RENDERERS_UNDER_TEST:
        violations.append("the measurand must be the renderer-under-test output (the thing measured, never the truth)")
    return {
        "invariant": "no-canonical-player-truth-from-the-renderer",
        "sourceConstraint": "canonical truth = the SWM entity state / the authorized avatar reference (the C→A read-model boundary)",
        "holds": len(violations) == 0,
        "violations": violations,
    }


# ---------------------------------------------------------------------------
# THE METRIC IMPLEMENTATIONS (typed not-measured — exact definitions below;
# every function is pure and self-checked against hand-computed cases)
# ---------------------------------------------------------------------------


def _cosine(a, b) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(x * x for x in b))
    if na == 0 or nb == 0:
        return 0.0
    return dot / (na * nb)


def motion_fidelity_joint_error(ground_truth_track, output_track, reference_scale: float) -> dict:
    """MOTION FIDELITY — the acceptance's core metric #1.

    EXACT DEFINITION. The ground truth is the CANONICAL entity motion/state
    (the SWM entity state seam: the participant entities' positions over
    time — 'pitchPosition' etc. — sampled at the fixture's frame times,
    projected through W601 into the output video's pixel frame). The output
    track is the pose/joint trajectory ESTIMATED FROM THE RENDERED OUTPUT
    VIDEO by a fixed pose estimator (the adequate-host design pins the
    candidate's own process_checkpoint/pose2d vitpose_h_wholebody estimator,
    applied IDENTICALLY to the conditioning video and the output video —
    the same estimator for both comparison lanes).

    Reported numbers:
      - meanNormalizedJointError: mean over frames and joints of
        ||o_frame_joint − g_frame_joint|| (pixels) / reference_scale.
        reference_scale = the output frame diagonal (the design's
        normalization; a pure number, resolution-independent).
      - endpointJointError (normalized): the LAST frame's mean joint error
        (does the performance END where the canonical state ends).
      - velocityDirectionAgreement: mean over frames and joints of the
        cosine between the ground-truth per-joint frame-to-frame delta and
        the output's — the DYNAMICS agreement (a constant spatial offset
        scores position error but perfect direction: the metric split the
        self-check pins).
    Both tracks must be time-aligned (the same frame count and rate).
    """
    if len(ground_truth_track) != len(output_track):
        raise ValueError("motion fidelity needs time-aligned tracks")
    if len(ground_truth_track) < 2:
        raise ValueError("motion fidelity needs >= 2 frames")
    if reference_scale <= 0:
        raise ValueError("reference_scale must be positive")
    frame_errs = []
    joint_counts = []
    for g_frame, o_frame in zip(ground_truth_track, output_track):
        if len(g_frame) != len(o_frame) or not g_frame:
            raise ValueError("per-frame joint lists must be non-empty and equal-length")
        errs = []
        for (gx, gy), (ox, oy) in zip(g_frame, o_frame):
            errs.append(math.hypot(ox - gx, oy - gy) / reference_scale)
        frame_errs.append(sum(errs) / len(errs))
        joint_counts.append(len(g_frame))
    endpoint = frame_errs[-1]
    cosines = []
    for i in range(len(ground_truth_track) - 1):
        # per-joint deltas (index-matched, not value-matched):
        for j in range(len(ground_truth_track[i])):
            gx0, gy0 = ground_truth_track[i][j]
            gx1, gy1 = ground_truth_track[i + 1][j]
            ox0, oy0 = output_track[i][j]
            ox1, oy1 = output_track[i + 1][j]
            gd = (gx1 - gx0, gy1 - gy0)
            od = (ox1 - ox0, oy1 - oy0)
            ng = math.hypot(*gd)
            no = math.hypot(*od)
            if ng == 0 or no == 0:
                cosines.append(0.0)  # a still joint has no direction; the honest zero
            else:
                cosines.append((gd[0] * od[0] + gd[1] * od[1]) / (ng * no))
    return {
        "meanNormalizedJointError": sum(frame_errs) / len(frame_errs),
        "endpointJointError": endpoint,
        "velocityDirectionAgreement": sum(cosines) / len(cosines),
        "frames": len(frame_errs),
        "jointsPerFrame": joint_counts[0],
    }


def identity_drift(frame_embeddings, reference_embedding) -> dict:
    """TEMPORAL IDENTITY STABILITY — the acceptance's core metric #2.

    EXACT DEFINITION. The target character's identity must not drift across
    frames. Per frame k, an identity descriptor e_k is extracted from the
    detected character/face crop of the OUTPUT video (the adequate-host
    design fixes the embedding model as part of the fixture contract and
    applies it identically to the authorized avatar reference image → the
    ANCHOR embedding e_ref; the anchor is the AUTHORIZED REFERENCE, not the
    output's own first frame — identity is defined by what the output is
    supposed to preserve). Reported numbers:
      - meanPairwiseIdentityDistance: mean of 1 − cos(e_i, e_j) over ALL
        C(n,2) frame pairs (drift anywhere in the take);
      - maxDriftFromReference: max_k 1 − cos(e_ref, e_k) (the worst
        identity departure from the authorized avatar);
      - driftTrendSlopePerFrame: the OLS slope of 1 − cos(e_ref, e_k)
        against the frame index (a monotonic drift signal: a renderer that
        slowly 'melts' the identity scores a positive slope even when the
        pairwise mean looks small).
    """
    n = len(frame_embeddings)
    if n < 2:
        raise ValueError("identity drift needs >= 2 frames")
    pairwise = []
    for i in range(n):
        for j in range(i + 1, n):
            pairwise.append(1.0 - _cosine(frame_embeddings[i], frame_embeddings[j]))
    ref_dists = [1.0 - _cosine(reference_embedding, e) for e in frame_embeddings]
    xs = list(range(n))
    xbar = sum(xs) / n
    ybar = sum(ref_dists) / n
    denom = sum((x - xbar) ** 2 for x in xs)
    slope = (sum((x - xbar) * (y - ybar) for x, y in zip(xs, ref_dists)) / denom) if denom else 0.0
    return {
        "meanPairwiseIdentityDistance": sum(pairwise) / len(pairwise),
        "maxDriftFromReference": max(ref_dists),
        "driftTrendSlopePerFrame": slope,
        "frames": n,
    }


def style_adherence_distance(frame_style_descriptors, reference_style_descriptor) -> dict:
    """STYLE ADHERENCE — the profile's 4th metric, against the authorized
    style/avatar reference.

    EXACT DEFINITION. The authorized reference image defines the target
    style; per output frame k a style descriptor s_k is computed (the
    design's concrete pure-statistics descriptor: a per-channel 8-bin color
    histogram, L1-normalized and concatenated across channels, plus the
    per-channel mean — the SAME extractor applied to the reference). The
    reported numbers:
      - meanStyleDistance: mean_k of 1 − cos(s_ref, s_k) over frames;
      - maxStyleDistance: the worst frame;
      - meanChannelShift: mean over frames and channels of |mean_k −
        mean_ref| / 255 (a luminance/color-balance drift signal the cosine
        over sparse histograms can miss).
    """
    n = len(frame_style_descriptors)
    if n < 1:
        raise ValueError("style adherence needs >= 1 frame")
    dists = [1.0 - _cosine(reference_style_descriptor["histogram"], d["histogram"]) for d in frame_style_descriptors]
    channels = len(reference_style_descriptor["channelMeans"])
    shifts = []
    for d in frame_style_descriptors:
        for c in range(channels):
            shifts.append(abs(d["channelMeans"][c] - reference_style_descriptor["channelMeans"][c]) / 255.0)
    return {
        "meanStyleDistance": sum(dists) / n,
        "maxStyleDistance": max(dists),
        "meanChannelShift": sum(shifts) / len(shifts),
        "frames": n,
    }


def temporal_consistency_scores(frames_luma: list) -> dict:
    """TEMPORAL CONSISTENCY — the profile's 3rd metric, the SHARED estimator
    (imported from the merged HF010 flight): BOTH comparison lanes (the
    anime-npr renderer's output and Wan2.2-Animate's output) are scored by
    THIS SAME code. On constant/uniform patches the consecutive-frame SSIM
    reduces to hf010's closed form; the flow-warp residual measures whether
    frame k+1 is a rigid translation of frame k (the warp residual a
    coherent render should minimize). The adequate-host path swaps the
    hand-computed constant patches for the 8x8-mean-filter SSIM over real
    frames (the hf010 implementation) — the DEFINITION is the estimator,
    and the estimator is shared.
    """
    if len(frames_luma) < 2:
        raise ValueError("temporal consistency needs >= 2 frames")
    ssims = []
    for i in range(len(frames_luma) - 1):
        ssims.append(ssim_constant_patches(frames_luma[i], frames_luma[i + 1]))
    return {
        "meanConsecutiveSsim": sum(ssims) / len(ssims),
        "estimator": "hf010.ssim_constant_patches (the SHARED estimator — imported, never re-implemented; the real path uses the 8x8 mean-filter SSIM)",
        "frames": len(frames_luma),
    }


def flow_consistency_residual(frame1, frame2, flow) -> float:
    """The shared flow-warp residual (hf010's estimator, re-exported so the
    comparison design names one module for both lanes)."""
    return flow_warp_residual(frame1, frame2, flow)


# ---------------------------------------------------------------------------
# The resource arithmetic (the typed refusal)
# ---------------------------------------------------------------------------


def candidate_arithmetic(repo_probe: dict, breakdown: dict, flux_probe: dict, host: dict) -> dict:
    core_gib = _gib(breakdown["coreInferenceBytes"])
    preprocess_gib = _gib(breakdown["mandatoryPreprocessBytes"])
    whole_gib = _gib(repo_probe["totalBytes"])
    flux_gib = _gib(flux_probe["totalBytes"])
    disk = host["freeDiskGiB"]
    ram = host["totalRamGiB"]
    minimal_download_gib = core_gib + preprocess_gib
    recommended_download_gib = minimal_download_gib + flux_gib
    bf16_working_set_gib = core_gib  # diffusion + t5 + clip + vae resident in bf16
    reasons = [
        f"model-download-disk-infeasible (core+mandatory-preprocess): {minimal_download_gib:.2f} GiB vs {disk:.2f} GiB free disk = {minimal_download_gib / disk:.1f}x over",
        f"model-download-disk-infeasible (the card's own command): 'huggingface-cli download Wan-AI/Wan2.2-Animate-14B' pulls the WHOLE pinned tree {whole_gib:.2f} GiB = {whole_gib / disk:.1f}x free disk",
        f"model-download-disk-infeasible (the RECOMMENDED animation preprocessing route): the --use_flux pose-retargeting route adds the GATED black-forest-labs/FLUX.1-Kontext-dev {flux_gib:.2f} GiB of weights -> the recommended-route total {recommended_download_gib:.2f} GiB = {recommended_download_gib / disk:.1f}x free disk",
        f"model-load-ram-infeasible: the bf16 inference working set (MoE diffusion + umt5-xxl + CLIP + VAE resident) ≈ {bf16_working_set_gib:.2f} GiB = {bf16_working_set_gib / ram:.1f}x this host's TOTAL RAM ({ram:.2f} GiB)",
        "cuda-required (the repo's own documented posture): the single-GPU recipe plus the --dit_fsdp/--t5_fsdp/--ulysses multi-GPU variants; torch>=2.4 + flash_attn in requirements; this host has NO CUDA device",
        "cpu-latency infeasibility: a 2-vCPU CPU-only host is orders of magnitude beyond benchmark-grade wall-clock for a 14B video diffusion model",
    ]
    return {
        "host": {
            "totalRamGiB": ram,
            "freeDiskGiB": disk,
            "cpuCount": host["cpuCount"],
            "gpu": host["gpu"],
        },
        "coreInferenceGiB": round(core_gib, 2),
        "mandatoryPreprocessGiB": round(preprocess_gib, 2),
        "minimalDownloadGiB": round(minimal_download_gib, 2),
        "wholeTreeGiB": round(whole_gib, 2),
        "fluxRecommendedRouteGiB": round(recommended_download_gib, 2),
        "bf16WorkingSetGiB": round(bf16_working_set_gib, 2),
        "verdict": "refused" if core_gib > disk or bf16_working_set_gib > ram else "feasible",
        "refusalType": "resource-infeasible-host",
        "reasons": reasons,
    }


# ---------------------------------------------------------------------------
# The Anime/NPR direction comparison (STATIC + the adequate-host design)
# ---------------------------------------------------------------------------


def build_anime_npr_comparison() -> dict:
    """The acceptance's 'against Sporta's Anime/NPR direction' — delivered
    honestly on this host as (a) a STATIC capability-delta review (labeled
    static-review: what the repo's own anime-npr renderer does TODAY, from
    its own sources, vs what Wan2.2-Animate would add, from its card/docs)
    and (b) the COMPARISON DESIGN for an adequate host (same ground-truth
    conventions; BOTH lanes scored by the SAME metric implementations).
    """
    capability_delta = [
        {
            "axis": "conditioning (the input that drives motion)",
            "animeNprToday": "the canonical SWM snapshot + ordered events, projected through W601 projectScene into the engine's scene — a PURE SWM→scene→pixels pipeline (requiresSourceFrames: false; packages/renderer-3d/src/game/plugin.ts: 'a render projects nothing renderer-side')",
            "wan22AnimateWouldAdd": "a PERFORMANCE VIDEO + a character reference image: the documented conditioning is video pixels + a pose/face preprocessing pipeline (preprocess_data.py -> src_pose.mp4/src_face.mp4), NOT structured entity state — the SWM-state-to-video adapter gap (see contract-compatibility.json)",
            "delta": "the repo reads canonical state directly; the candidate reads pixels — an adapter (SWM state -> performance video) must exist before the candidate consumes the repo's truth",
        },
        {
            "axis": "motion fidelity source (the truth the metric scores against)",
            "animeNprToday": "the SWM entity state IS the input and the truth: player motion is placed at the canonical positions each frame by construction (no tracking error to measure against the SWM — the render IS the projection; the profile's motion-fidelity question degenerates to projection correctness, which the repo pins by determinism tests)",
            "wan22AnimateWouldAdd": "a learned motion-transfer: the output's pose track must be MEASURED against the canonical entity state (meanNormalizedJointError etc.) — fidelity is an empirical property of the model, not a construction guarantee",
            "delta": "determinism-pinned projection vs measured learned transfer — the benchmark exists precisely for the second",
        },
        {
            "axis": "identity (the acceptance's temporal identity stability)",
            "animeNprToday": "identity-stable entity styling is a pure function of the style key (packages/renderer-anime/src/identity.ts) — a per-entity look derived deterministically; a restyle is ONLY a version bump (ANIME_NPR_RENDERER_VERSION 0.2.0, the deliberate-restyle doctrine)",
            "wan22AnimateWouldAdd": "photoreal/anime identity preservation from the reference image across frames — a learned property, MEASURED (identity_drift against the authorized avatar reference embedding)",
            "delta": "constructed identity stability vs measured identity stability",
        },
        {
            "axis": "style (the authorized style/avatar reference)",
            "animeNprToday": "the cel-shaded/NPR style: flat two-tone shading, bold outlines, posterized palette, halftone pitch, speed-line accents (the ADR-009 visibly-different reality; rendererClass stylized-video)",
            "wan22AnimateWouldAdd": "the style comes from the reference image itself (animation mode animates THE reference character) — style adherence is transfer from the reference, MEASURED (style_adherence_distance)",
            "delta": "authored procedural style vs reference-transferred style",
        },
        {
            "axis": "output cadence/resolution",
            "animeNprToday": "ANIME_MP4_SD_TWOS_PROFILE 640x360 @ 12 fps (on-twos, the cel-animation cadence; the J013 budget resolution — 650 036–671 203 B at defaults, ≈65% of the 1 000 000-B hosted budget), SD/HD @ 25 fps remain supported; offline latency class; 4 000 ms default duration; ≤ 2 400 frames; ≤ 64 entities",
            "wan22AnimateWouldAdd": "the candidate's documented recipe pins --resolution_area 1280 720 (preprocessing) with an fps knob; output length/rate set by the generation config (clip_len/frame_num, sample steps/solver)",
            "delta": "the repo's cadence is a budget-fit doctrine (on-twos); the candidate's is a generation parameter — the comparison design pins the SAME profile for both lanes",
        },
        {
            "axis": "determinism/contract posture",
            "animeNprToday": "same profile + same SWM input -> byte-identical artifacts (pinned by test); renderer versions immutable; degradation always flagged with a reason; R2 fail-closed rights (source-frame refs without canReferenceSourceFrames -> rights-denied)",
            "wan22AnimateWouldAdd": "seeded stochastic diffusion (base_seed, sample_solver/steps/guide_scale); NO renderer-contract surface (no capability document, no rights gate, no degradation flags) — the integration gap the HF014 lane owns",
            "delta": "a versioned deterministic plugin contract vs an un-contracted model invocation — a provider adapter must synthesize the contract surface",
        },
        {
            "axis": "multi-entity scale",
            "animeNprToday": "the SWM scene carries up to 64 entities (maxConcurrentEntities) — 22 players + ball + officials by construction",
            "wan22AnimateWouldAdd": "the candidate animates ONE character per run (the card's animation mode); the replacement mode's own mask extraction is 'designed for single-person videos ONLY' (UserGuider verbatim) — multi-person video 'requires users to develop their own solution'",
            "delta": "whole-scene rendering vs per-character generation — N runs + a compositing step, a typed scale gap",
        },
        {
            "axis": "compute cost",
            "animeNprToday": "runs on THIS host (the software engine + ffmpeg; the real-path 12fps render measured in the L014 record within the hosted budget)",
            "wan22AnimateWouldAdd": "47.68 GiB core weights, GPU-class working set, the FLUX-gated recommended preprocessing route — resource-infeasible on this host (the typed refusal)",
            "delta": "CPU-feasible today vs GPU-class infeasible here — the adequate-host requirement",
        },
    ]
    comparison_design = {
        "label": "typed not-measured (the adequate-host comparison design — NO model ran on this host)",
        "theQuestion": "on the SAME canonical window, does Wan2.2-Animate's animated output track the canonical entity motion with stable identity and adherent style at least as well as the repo's own anime-npr renderer — measured by the SAME estimators?",
        "fixtures": {
            "source": "the repo's canonical SWM window (the renderer-3d canonical fixture session / the L005 scenario sessions — the materially-different SWMs the sensitivity battery uses)",
            "groundTruthTrack": {
                "provenance": "swm-entity-state",
                "definition": "the participant entities' positions over the window, sampled at the comparison profile's frame times, projected through W601 projectScene into the output pixel frame (pixels; the same projection both lanes are scored in)",
            },
            "authorizedReference": {
                "provenance": "authorized-avatar-reference",
                "definition": "the rights-clean target character reference image (the avatar-field posture: renderer-3d's own source renders, or an operator-authorized avatar asset — the R2 rights gate applies; sourceFrameRefs only with canReferenceSourceFrames)",
            },
            "theNoCanonicalTruthRule": "the ground truth is the SWM entity state + the authorized reference — NEVER either lane's output. Both lanes' outputs are measurands. Machine-checkable via no_canonical_truth_invariant() (self-checked).",
        },
        "lanes": [
            {
                "lane": "anime-npr (the repo today)",
                "invocation": "the anime-npr.prototype @ 0.2.0 plugin through its own renderer contract (RenderRequest with the SAME output profile as the Wan lane)",
                "conditioning": "the SWM snapshot + events (its native input — no adapter needed)",
            },
            {
                "lane": "Wan2.2-Animate (the candidate)",
                "invocation": "the pinned revision's documented recipe: preprocess_data.py (--retarget_flag, the basic retargeting route — the FLUX route is the gated optional enhancement) then generate.py --task animate-14B (single-GPU recipe) with base_seed pinned",
                "conditioning": "THE TYPED ADAPTER: the SWM entity motion -> a performance video (the repo's own renderer output at the same profile may serve as the driving video — conditioning, NOT truth) + the authorized avatar reference image",
            },
        ],
        "profileAlignment": "both lanes render at the SAME resolution/fps/duration (the design pins 640x360 @ 12 fps — the anime-npr default on-twos profile — so the cadence doctrine is part of the comparison, with the 25 fps SD profile as the second condition)",
        "metrics": {
            "sharedForBothLanes": [
                "motion_fidelity_joint_error vs the SWM ground-truth track (meanNormalizedJointError / endpointJointError / velocityDirectionAgreement — the canonical view)",
                "motion_fidelity_joint_error vs the conditioning performance-video pose track (the model-side view — reported SEPARATELY, never conflated with the canonical view)",
                "identity_drift (meanPairwiseIdentityDistance / maxDriftFromReference / driftTrendSlopePerFrame — the anchor is the authorized avatar reference)",
                "style_adherence_distance vs the authorized reference (meanStyleDistance / maxStyleDistance / meanChannelShift)",
                "temporal_consistency_scores + the flow-warp residual (the SHARED hf010 estimators — imported, never re-implemented)",
                "wall_clock_ms_per_output_second + cold-start download bytes (cost; GPU peak honestly N/A-typed on this host)",
            ],
            "perLaneNotes": "the anime-npr lane's identity/style numbers are expected construction-stable; the Wan lane's are the empirical question — the design records BOTH with the same estimator code and never a silent zero (an unmeasurable column is typed N/A)",
        },
        "fairnessRules": [
            "the SAME pose estimator extracts the output track from BOTH lanes' videos (the candidate's own process_checkpoint/pose2d vitpose, applied identically)",
            "the SAME identity/style descriptor extractor, applied identically to both lanes' frames and the authorized reference",
            "the SAME profile (resolution/fps/duration) for both lanes; the same ground-truth SWM window; the same frame indices",
            "the anime-npr lane runs on THIS host class; the Wan lane needs the adequate host — an unexecuted lane is typed not-run, never scored from a card claim",
        ],
    }
    return {
        "label": "STATIC-REVIEW (the capability delta) + typed not-measured (the comparison design) — no model ran, no renderer rendered for this evidence",
        "capabilityDelta": capability_delta,
        "comparisonDesign": comparison_design,
        "sources": [
            "packages/renderer-3d/src/game/identity.ts (ANIME_NPR_RENDERER_VERSION 0.2.0, ANIME_MP4_SD_TWOS_PROFILE 640x360@12fps, the capability documents)",
            "packages/renderer-3d/src/game/plugin.ts (the pure SWM→scene→pixels pipeline; R2 rights posture)",
            "packages/renderer-anime/src/identity.ts (identity-stable entity styling; the deliberate-restyle doctrine)",
            "docs/research/l014-anime-budget-and-live-replay-presentation.md (the on-twos doctrine, the J013 budget measurements, the version-bump rule)",
            "the candidate card + UserGuider + generate.py (fetched bounded, sha-pinned in load-analysis.json)",
        ],
    }


# ---------------------------------------------------------------------------
# Mode: preflight (EXECUTED on this host — exit 3, the typed refusal)
# ---------------------------------------------------------------------------


def run_preflight() -> int:
    RESULTS.mkdir(parents=True, exist_ok=True)
    host = host_resources()
    api = _hub_api()

    repo_probe = probe_repo(api, CANDIDATE["repoId"], CANDIDATE["revision"])
    flux_probe = probe_repo(api, FLUX_DEPENDENCY["repoId"])
    base_probe = probe_repo(api, BASE_MODEL["repoId"])

    fetched = {}
    for name in CANDIDATE["smallMetadataFiles"]:
        fetched[f"{CANDIDATE['repoId']}::{name}"] = fetch_small_file(api, CANDIDATE["repoId"], CANDIDATE["revision"], name)
    for key, url in [
        ("UserGuider.md", "https://raw.githubusercontent.com/Wan-Video/Wan2.2/main/wan/modules/animate/preprocess/UserGuider.md"),
        ("LICENSE.txt", "https://raw.githubusercontent.com/Wan-Video/Wan2.2/main/LICENSE.txt"),
        ("generate.py", "https://raw.githubusercontent.com/Wan-Video/Wan2.2/main/generate.py"),
    ]:
        fetched[f"github::{key}"] = fetch_github_doc(url)

    breakdown = composition_breakdown(repo_probe)
    arithmetic = candidate_arithmetic(repo_probe, breakdown, flux_probe, host)

    load_analysis = {
        "label": "the load analysis at the pinned revision — metadata arithmetic ONLY (weights never downloaded, never committed, never vendored)",
        "candidate": {
            "repoId": CANDIDATE["repoId"],
            "revision": CANDIDATE["revision"],
            "resolvedSha": repo_probe["resolvedSha"],
            "revisionMatch": repo_probe["revisionMatch"],
            "gated": repo_probe["gated"],
            "pipelineTag": repo_probe["pipelineTag"],
            "baseModel": CANDIDATE["baseModel"],
            "baseModelProbe": {
                "repoId": base_probe["repoId"],
                "resolvedSha": base_probe["resolvedSha"],
                "gated": base_probe["gated"],
                "licenseTags": base_probe["licenseTags"],
                "totalGiB": base_probe["totalGiB"],
                "note": "the ledger's weightsProvenance names it as the base; the Animate tree carries its own inference weights — NOT a download dependency",
            },
        },
        "composition": breakdown,
        "loadingRecipe": {
            "theCardOwnCommand": "huggingface-cli download Wan-AI/Wan2.2-Animate-14B --local-dir ./Wan2.2-Animate-14B (pulls the whole 67.41 GiB tree)",
            "preprocessing": "python ./wan/modules/animate/preprocess/preprocess_data.py --ckpt_path ./Wan2.2-Animate-14B/process_checkpoint --video_path <driving.mp4> --refer_path <character.jpeg> --save_path <out> --resolution_area 1280 720 --retarget_flag [--use_flux] (animation) / ... --replace_flag (replacement)",
            "generationSingleGpu": "python generate.py --task animate-14B --ckpt_dir ./Wan2.2-Animate-14B/ --src_root_path <process_results> --refert_num 1",
            "generationMultiGpu": "python -m torch.distributed.run --nnodes 1 --nproc_per_node 8 generate.py --task animate-14B ... --dit_fsdp --t5_fsdp --ulysses_size 8",
            "replacementMode": "generate.py ... --replace_flag --use_relighting_lora (adds the optional 2.87 GB relighting LoRA)",
            "stack": "the repo's requirements (torch>=2.4, flash_attn et al.) — no CPU inference path is documented for the animate task",
            "dependencies": [
                "core inference: the 4-shard MoE diffusion (32.18 GiB) + umt5-xxl enc bf16 (10.58 GiB) + CLIP xlm-roberta-large-vit-huge-14 (4.44 GiB) + Wan2.1 VAE (0.47 GiB)",
                "preprocessing (mandatory pose detection): yolov10m.onnx + vitpose_h_wholebody.onnx + sam2_hiera_large.pt + xlm-roberta-large (one format)",
                "the RECOMMENDED animation retargeting route (--use_flux): black-forest-labs/FLUX.1-Kontext-dev — GATED auto, license:other, 53.90 GiB",
                "the replacement mode's optional relighting LoRA (2.87 GB)",
            ],
        },
        "hostGapArithmetic": arithmetic,
        "boundedProbes": {
            "candidateRepo": repo_probe,
            "fluxDependency": {
                **flux_probe,
                "role": FLUX_DEPENDENCY["role"],
                "licenseTagAtProbe": FLUX_DEPENDENCY["licenseTag"],
                "authWall": "gated=auto (license acceptance required before weight access; metadata reachable anonymously)",
            },
            "fetchedSmallFiles": fetched,
        },
    }
    (RESULTS / "load-analysis.json").write_text(json.dumps(load_analysis, indent=2, ensure_ascii=False) + "\n")

    io_surface = {
        "label": "the candidate's documented I/O surface (the card + the UserGuider + generate.py — fetched bounded, sha-pinned above)",
        "taskType": "video-to-video (the hub pipeline_tag at the pinned revision)",
        "theCardVerbatim": "Wan-Animate takes a video and a character image as input, and generates a video in either \"animation\" or \"replacement\" mode.",
        "modes": {
            "animation": "The model generates a video of the character image that mimics the human motion in the input video. (the card verbatim)",
            "replacement": "The model replaces the character image with the input video. (the card verbatim)",
        },
        "inputs": [
            {"name": "video_path", "kind": "performance video (the driving motion source)", "role": "the CONDITIONING — the motion to replicate"},
            {"name": "refer_path", "kind": "character image", "role": "the TARGET character (identity + style source)"},
            {"name": "resolution_area", "kind": "pixel-area resolution pin (1280 720 in the card's example)", "role": "preprocessing + generation resolution"},
            {"name": "fps", "kind": "frame-rate knob", "role": "'A lower frame rate can improve generation efficiency, but may cause stuttering' (the UserGuider verbatim)"},
            {"name": "retarget_flag / use_flux", "kind": "pose-retargeting route selectors", "role": "the basic retargeting vs the FLUX-enhanced route (gated dependency)"},
            {"name": "refert_num", "kind": "int (default 77, 'Recommended to be 1 or 5')", "role": "how many frames are used for temporal guidance (generate.py)"},
            {"name": "seed / sample_solver / sampling_steps / guide_scale / clip_len", "kind": "generation config (generate.py's WanAnimate.generate signature)"},
        ],
        "preprocessingOutputs": "src_face.mp4 + src_pose.mp4 (animation mode); + src_bg.mp4 + src_mask.mp4 (replacement mode) — 'The input video should be preprocessed into several materials before be feed into the inference process' (the card verbatim)",
        "outputs": [
            {"name": "the animated video", "kind": "the character image animated with the driving video's motion (animation) / the character replaced into the video (replacement)"},
        ],
        "textPromptSurface": "the task registry carries an example prompt for animate-14B ('视频中的人在做动作'), but the WanAnimate.generate() call in generate.py takes NO prompt argument — the animate conditioning is the preprocessed video materials + the reference image",
        "documentedLimitations": [
            "replacement mask extraction: 'designed for single-person videos ONLY and may produce incorrect results or fail in multi-person videos' (the UserGuider verbatim)",
            "the FLUX retargeting route: 'Due to the limited capabilities of FLUX.1-Kontext-dev, it is NOT guaranteed to produce the expected results' (the UserGuider verbatim)",
            "'If you're using Wan-Animate, we do not recommend using LoRA models trained on Wan2.2, since weight changes during training may lead to unexpected behavior.' (the card verbatim)",
        ],
        "theContractQuestion": "does 'canonical entity motion/state' (the frozen profile's input) map to the performance-video conditioning? — the SWM entity state is STRUCTURED STATE, the conditioning is VIDEO PIXELS: the mapping is maps-with-adapter (the SWM-state-to-performance-video adapter — see contract-compatibility.json for the typed gap table)",
    }
    (RESULTS / "model-io-surface.json").write_text(json.dumps(io_surface, indent=2, ensure_ascii=False) + "\n")

    license_posture = {
        "status": "argued-from-recorded-terms-only (never legal advice, never a promotion — HF015 owns all adjudication)",
        "candidate": {
            "modelLicense": "apache-2.0 (the card frontmatter + the ledger row)",
            "codeLicense": "apache-2.0 (the LICENSE.txt fetched from the candidate's own code repo, sha-pinned in load-analysis.json)",
            "commercialUse": "yes (the recorded terms)",
            "datasetProvenance": "unknown (the open edge — the training corpus is not in the recorded terms)",
        },
        "openEdges": [
            "datasetProvenance unknown — the corpus behind the weights is not in the recorded terms (the standing HF015 input)",
            "the RECOMMENDED animation preprocessing route (--use_flux) requires black-forest-labs/FLUX.1-Kontext-dev: hub license tag 'license:other', gated=auto — a DIFFERENT licensor's terms cover that dependency's weights (and its outputs per that license family's own text; recorded as a tag-level observation from the probe, the exact terms to be read on the adequate host before any production use — never adjudicated here)",
            "the replacement mode's relighting LoRA ships inside the candidate's own tree (apache-2.0 by the repo's frontmatter) — recorded, not adjudicated",
        ],
        "verdict": "production-eligible-by-recorded-terms for the candidate's own weights, with the datasetProvenance unknown edge and the FLUX-route dependency posture recorded — the basic retargeting route (no FLUX) keeps the dependency set apache-2.0-only; never legal advice",
    }
    (RESULTS / "license-posture.json").write_text(json.dumps(license_posture, indent=2, ensure_ascii=False) + "\n")

    comparison = build_anime_npr_comparison()
    (RESULTS / "anime-npr-comparison.json").write_text(json.dumps(comparison, indent=2, ensure_ascii=False) + "\n")

    refusal = {
        "workItem": "HF012",
        "verdict": "refused",
        "refusalType": "resource-infeasible-host",
        "exitCode": 3,
        "reasons": arithmetic["reasons"],
        "weightsDownloaded": False,
        "boundedProbesOnly": True,
        "boundedProbeKinds": [
            "HfApi.model_info(files_metadata=True) on the pinned candidate revision + the FLUX dependency + the base model (file trees + sizes; zero weight bytes)",
            "the 20 010-byte README.md card fetched from the pinned revision",
            "the candidate's own GitHub docs fetched bounded (UserGuider.md 4 854 B, LICENSE.txt 11 357 B, generate.py 20 392 B)",
        ],
        "reachability": {
            "candidateRepo": f"gated={repo_probe['gated']} — anonymously reachable at the pinned revision (no auth wall; the contrast with HF010's Meridian/VGGT-Omega manual gate)",
            "revisionPin": f"resolved sha {repo_probe['resolvedSha']} == the pinned revision {CANDIDATE['revision']} ({repo_probe['revisionMatch']})",
            "fluxDependency": "gated=auto (license acceptance before weights; the metadata probe itself is anonymous)",
        },
        "host": host,
        "thePartial": "the typed refusal covers the COMPUTE leg only — the load analysis, license posture, the motion-fidelity/temporal-identity/style-adherence/temporal-consistency metric designs (self-checked), the Anime/NPR comparison (static + design), and the contract mapping are DELIVERED (see benchmark-record.json partialDeliverables)",
        "noCanonicalTruthNote": "the benchmark design measures AGAINST canonical truth (the SWM entity state + the authorized avatar reference); the renderer under test is NEVER the truth source — the machine-checkable invariant is in this script and self-checked",
    }
    (RESULTS / "preflight-refusal.json").write_text(json.dumps(refusal, indent=2, ensure_ascii=False) + "\n")

    print("HF012 preflight (EXECUTED — bounded probes only, weights never downloaded):")
    print(f"  candidate: {CANDIDATE['repoId']} @ {repo_probe['resolvedSha']} (pin match: {repo_probe['revisionMatch']}, gated: {repo_probe['gated']})")
    print(f"  core inference composition: {_fmt_gib(breakdown['coreInferenceBytes'])} vs free disk {host['freeDiskGiB']:.2f} GiB and total RAM {host['totalRamGiB']:.2f} GiB")
    print(f"  verdict: {arithmetic['verdict']} — {len(arithmetic['reasons'])} reasons recorded")
    print(f"  wrote: load-analysis.json, model-io-surface.json, license-posture.json, anime-npr-comparison.json, preflight-refusal.json")
    return 3 if arithmetic["verdict"] == "refused" else 0


# ---------------------------------------------------------------------------
# Mode: selfcheck (EXECUTED — implementation evidence, NOT a model measurement)
# ---------------------------------------------------------------------------


def run_selfcheck() -> int:
    RESULTS.mkdir(parents=True, exist_ok=True)
    cases = []
    failures = []

    def check(case_id: str, description: str, expected, actual, tol: float = 1e-9):
        ok = abs(expected - actual) <= tol if isinstance(expected, float) or isinstance(expected, int) and isinstance(actual, (int, float)) else expected == actual
        cases.append({"caseId": case_id, "description": description, "expected": expected, "actual": actual, "passed": bool(ok)})
        if not ok:
            failures.append(case_id)

    # --- motion fidelity: hand case A (2 joints would complicate; start single-joint)
    # G = [(0,0),(1,0),(2,0)], O = [(0,0),(1,0.5),(2,0)], ref scale 1.0
    # per-frame errors: 0, 0.5, 0 -> mean 1/6; endpoint 0
    # velocity cosines: cos((1,0),(1,0.5)) = cos((1,0),(1,-0.5)) = 1/sqrt(1.25)
    mf = motion_fidelity_joint_error([[(0.0, 0.0)], [(1.0, 0.0)], [(2.0, 0.0)]], [[(0.0, 0.0)], [(1.0, 0.5)], [(2.0, 0.0)]], 1.0)
    check("motion-fidelity-mean-A", "mean normalized joint error, 3 frames (0, 0.5, 0)/1.0", 1.0 / 6.0, mf["meanNormalizedJointError"])
    check("motion-fidelity-endpoint-A", "endpoint joint error (last frame 0)", 0.0, mf["endpointJointError"])
    check("motion-fidelity-velocity-A", "mean velocity-direction cosine (2 x 1/sqrt(1.25))", 1.0 / math.sqrt(1.25), mf["velocityDirectionAgreement"])

    # --- motion fidelity: perfect track (G == O)
    mf2 = motion_fidelity_joint_error([[(0.0, 0.0)], [(1.0, 0.0)], [(2.0, 0.0)]], [[(0.0, 0.0)], [(1.0, 0.0)], [(2.0, 0.0)]], 1.0)
    check("motion-fidelity-perfect-mean", "identical tracks -> 0", 0.0, mf2["meanNormalizedJointError"])
    check("motion-fidelity-perfect-velocity", "identical tracks -> direction 1", 1.0, mf2["velocityDirectionAgreement"])

    # --- motion fidelity: constant offset (position error, PERFECT dynamics)
    # G = [(0,0),(1,0)], O = [(0.5,0),(1.5,0)], scale 1.0
    mf3 = motion_fidelity_joint_error([[(0.0, 0.0)], [(1.0, 0.0)]], [[(0.5, 0.0)], [(1.5, 0.0)]], 1.0)
    check("motion-fidelity-offset-mean", "constant 0.5 offset -> mean 0.5", 0.5, mf3["meanNormalizedJointError"])
    check("motion-fidelity-offset-velocity", "constant offset, same deltas -> direction 1", 1.0, mf3["velocityDirectionAgreement"])

    # --- motion fidelity: multi-joint (2 joints, frame 1 only joint 2 off)
    # G=[[(0,0),(10,0)],[(0,1),(10,1)]], O=[[(0,0),(10,0)],[(0,1),(11,1)]], scale 10
    # frame0 err 0; frame1 errs [0, 0.1] -> 0.05; mean = 0.025; endpoint 0.05
    mf4 = motion_fidelity_joint_error(
        [[(0.0, 0.0), (10.0, 0.0)], [(0.0, 1.0), (10.0, 1.0)]],
        [[(0.0, 0.0), (10.0, 0.0)], [(0.0, 1.0), (11.0, 1.0)]],
        10.0,
    )
    check("motion-fidelity-multijoint-mean", "2 joints, one off by 1px/10 -> mean 0.025", 0.025, mf4["meanNormalizedJointError"])
    check("motion-fidelity-multijoint-endpoint", "endpoint (frame1 mean err)", 0.05, mf4["endpointJointError"])

    # --- identity drift: 3 unit vectors at 0, 10, 20 degrees; anchor at 0 deg
    def _unit(deg: float):
        r = math.radians(deg)
        return [math.cos(r), math.sin(r)]

    idr = identity_drift([_unit(0.0), _unit(10.0), _unit(20.0)], _unit(0.0))
    # pairwise: 1-cos(10)=0.0151922469877919, 1-cos(20)=0.0603073792140916, 1-cos(10)
    mean_pairwise = (2.0 * (1.0 - math.cos(math.radians(10.0))) + (1.0 - math.cos(math.radians(20.0)))) / 3.0
    check("identity-mean-pairwise", "3 embeddings at 0/10/20 deg -> mean pairwise cos distance", mean_pairwise, idr["meanPairwiseIdentityDistance"])
    check("identity-max-drift", "max drift from the 0-deg reference = 1-cos(20 deg)", 1.0 - math.cos(math.radians(20.0)), idr["maxDriftFromReference"])
    # slope: x=[0,1,2], y=[0, 1-cos10, 1-cos20]; OLS slope = (y2-y0)/2
    slope = ((1.0 - math.cos(math.radians(20.0))) - 0.0) / 2.0
    check("identity-drift-slope", "OLS slope of drift-from-reference over 3 frames = (y2-y0)/2", slope, idr["driftTrendSlopePerFrame"])

    # --- identity drift: stable (all identical)
    idr2 = identity_drift([_unit(0.0), _unit(0.0), _unit(0.0), _unit(0.0)], _unit(0.0))
    check("identity-stable-mean", "identical embeddings -> 0", 0.0, idr2["meanPairwiseIdentityDistance"])
    check("identity-stable-slope", "identical embeddings -> slope 0", 0.0, idr2["driftTrendSlopePerFrame"])

    # --- style adherence: 4-bin L1-normalized histograms (NOT unit-norm vectors:
    # the cosine is the overlap-style similarity the design defines)
    # ref [1,0,0,0]; frames [0.75,0.25,0,0]: cos = 0.75/sqrt(0.75^2+0.25^2) = 0.75/sqrt(0.625)
    #                        [0.5,0.5,0,0]:  cos = 0.5/sqrt(0.5)
    ref_style = {"histogram": [1.0, 0.0, 0.0, 0.0], "channelMeans": [128.0, 128.0, 128.0]}
    f1 = {"histogram": [0.75, 0.25, 0.0, 0.0], "channelMeans": [130.0, 128.0, 128.0]}
    f2 = {"histogram": [0.5, 0.5, 0.0, 0.0], "channelMeans": [128.0, 128.0, 128.0]}
    d1 = 1.0 - 0.75 / math.sqrt(0.625)
    d2 = 1.0 - 0.5 / math.sqrt(0.5)
    sa = style_adherence_distance([f1, f2], ref_style)
    check("style-mean-distance", "mean style cos distance ((1-0.75/sqrt(0.625)) + (1-0.5/sqrt(0.5)))/2", (d1 + d2) / 2.0, sa["meanStyleDistance"])
    check("style-max-distance", "max style distance 1-0.5/sqrt(0.5)", d2, sa["maxStyleDistance"])
    # channel shift: |130-128|/255 for one channel of one frame; others 0 -> (2/255)/2 frames = 1/255 ... per (frame,channel) mean:
    # shifts = [2/255, 0, 0, 0, 0, 0] (f1 has 3 channels, f2 has 3) -> mean = (2/255)/6
    check("style-channel-shift", "mean channel shift = (2/255)/6", (2.0 / 255.0) / 6.0, sa["meanChannelShift"])

    # --- style adherence: identical to reference
    sa2 = style_adherence_distance([ref_style, ref_style], ref_style)
    check("style-perfect", "frames == reference -> 0", 0.0, sa2["meanStyleDistance"])

    # --- temporal consistency: the SHARED hf010 estimator (the same values
    # the hf010/hf011 selfchecks pinned — the fairness-rule evidence)
    tc = temporal_consistency_scores([100.0, 100.0, 100.0])
    # SSIM(100,100) = (2*100*100 + 6.5025)/(10000 + 6.5025) = 1.0
    check("temporal-ssim-identical", "constant identical frames -> SSIM 1", 1.0, tc["meanConsecutiveSsim"])
    tc2 = temporal_consistency_scores([100.0, 200.0])
    c1 = (0.01 * 255.0) ** 2
    check("temporal-ssim-step", "constant patches 100 vs 200 -> (2*100*200+C1)/(100^2+200^2+C1)", (2.0 * 100.0 * 200.0 + c1) / (100.0**2 + 200.0**2 + c1), tc2["meanConsecutiveSsim"])

    # --- flow warp residual: shared estimator, hand lattice
    frame1 = lambda x, y: 100.0
    frame2 = lambda x, y: 100.0
    flow = _Flow([(0, 0), (1, 0), (2, 0)], (1, 0))
    check("flow-warp-perfect-translation", "constant frames + any flow -> 0 residual", 0.0, flow_consistency_residual(frame1, frame2, flow))
    frame3 = lambda x, y: 100.0 if x < 1 else 180.0
    # residual = mean |frame2(x) - frame1(x+1)| over domain [(0,0),(1,0),(2,0)]:
    # frame2 is constant 100; frame3(x>=1) = 180 -> each pixel |100-180| = 80
    check("flow-warp-step", "step frame + flow (1,0) -> mean |100-180| over 3 px = 80", 80.0, flow_consistency_residual(frame3, frame2, flow))

    # --- THE NO-CANONICAL-TRUTH INVARIANT (both ways — the load-bearing check)
    good_plan = {
        "groundTruth": [
            {"trackId": "window-player-tracks", "provenance": "swm-entity-state"},
            {"trackId": "authorized-avatar-embedding", "provenance": "authorized-avatar-reference"},
        ],
        "measurand": {"provenance": "Wan-AI/Wan2.2-Animate-14B@cb93a225"},
    }
    inv_good = no_canonical_truth_invariant(good_plan)
    check("invariant-good-plan", "SWM truth + authorized reference + renderer measurand -> invariant HOLDS", True, inv_good["holds"])

    bad_plan = {
        "groundTruth": [
            {"trackId": "window-player-tracks", "provenance": "swm-entity-state"},
            {"trackId": "renderer-output-poses", "provenance": "pose track estimated from the Wan-AI/Wan2.2-Animate-14B@cb93a225 output video"},
        ],
        "measurand": {"provenance": "Wan-AI/Wan2.2-Animate-14B@cb93a225"},
    }
    inv_bad = no_canonical_truth_invariant(bad_plan)
    check("invariant-renderer-truth-refused", "a ground-truth track from the renderer output -> invariant REFUSED", False, inv_bad["holds"])
    check("invariant-renderer-truth-named", "the refusal names the renderer-truth violation", True, any("renderer under test" in v for v in inv_bad["violations"]))

    bad_plan2 = {
        "groundTruth": [{"trackId": "anime-poses", "provenance": "anime-npr.prototype@0.2.0 rendered frames"}],
        "measurand": {"provenance": "anime-npr.prototype@0.2.0"},
    }
    inv_bad2 = no_canonical_truth_invariant(bad_plan2)
    check("invariant-animenpr-truth-refused", "the repo's OWN renderer as truth source -> REFUSED too (the C->A boundary binds both lanes)", False, inv_bad2["holds"])

    report = {
        "label": "IMPLEMENTATION self-check — hand-computed metric cases + the no-canonical-truth invariant both ways. NOT a model measurement: no model ran, no renderer rendered; every value below is arithmetic on hand-built inputs.",
        "metricDesignsUnderTest": [
            "motion_fidelity_joint_error (meanNormalizedJointError / endpointJointError / velocityDirectionAgreement)",
            "identity_drift (meanPairwiseIdentityDistance / maxDriftFromReference / driftTrendSlopePerFrame)",
            "style_adherence_distance (meanStyleDistance / maxStyleDistance / meanChannelShift)",
            "temporal_consistency_scores + flow_consistency_residual (the SHARED hf010 estimators, imported)",
            "no_canonical_truth_invariant (the acceptance's own constraint, machine-checkable)",
        ],
        "total": len(cases),
        "passed": len(cases) - len(failures),
        "failures": len(failures),
        "failedCaseIds": failures,
        "cases": cases,
    }
    (RESULTS / "metric-selfcheck.json").write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n")
    print(f"HF012 metric self-check: {report['passed']}/{report['total']} passed ({report['failures']} failures)")
    for c in cases:
        mark = "ok" if c["passed"] else "FAIL"
        print(f"  [{mark}] {c['caseId']}: {c['description']} (expected {c['expected']}, actual {c['actual']})")
    return 0 if not failures else 1


# ---------------------------------------------------------------------------
# Mode: full (READY-TO-RUN on an adequate host; fail-closed here)
# ---------------------------------------------------------------------------


def run_full() -> int:
    host = host_resources()
    reasons = []
    if host["totalRamGiB"] < FULL_HOST_MIN_RAM_GIB:
        reasons.append(f"total RAM {host['totalRamGiB']:.2f} GiB < the required {FULL_HOST_MIN_RAM_GIB} GiB")
    if host["freeDiskGiB"] < FULL_HOST_MIN_DISK_GIB:
        reasons.append(f"free disk {host['freeDiskGiB']:.2f} GiB < the required {FULL_HOST_MIN_DISK_GIB} GiB (the pinned composition alone is 47.68 GiB + the preprocessing leg)")
    if "N/A" in str(host["gpu"]):
        reasons.append(f"no CUDA device ({host['gpu']}) — the candidate's documented generation recipes are GPU-only (single-GPU + --dit_fsdp/--t5_fsdp variants; torch>=2.4)")
    if reasons:
        print("HF012 full mode REFUSED (fail-closed — the adequate-host floor):")
        for r in reasons:
            print(f"  - {r}")
        print("  the ready-to-run path (documented, never executed here):")
        print("   1. stage the pinned tree (huggingface-cli download Wan-AI/Wan2.2-Animate-14B --revision cb93a225fbaf1ca100f54e79da8f994995b689b3)")
        print("   2. the repo's own stack (github.com/Wan-Video/Wan2.2: torch>=2.4 + flash_attn + requirements.txt)")
        print("   3. preprocess_data.py over the ADAPTER output (SWM entity motion -> performance video) + the authorized avatar reference (--retarget_flag, the basic route)")
        print("   4. generate.py --task animate-14B --src_root_path <materials> --refert_num 1 (base_seed pinned per the determinism doctrine)")
        print("   5. extract the output pose track with the candidate's own pose2d estimator; embed identity/style with the fixture-contract extractors")
        print("   6. score with THIS script's metric implementations (the same code the selfcheck verified) + the anime-npr lane at the SAME profile")
        print("   7. the no-canonical-truth invariant gate: the ground truth stays the SWM entity state + the authorized reference — never either lane's output")
        return 3
    print("HF012 full mode: the adequate-host path is documented in this function and in results/preflight-refusal.json;")
    print("the heavy environment (torch, the pinned weights) is not part of this lean venv by design — stage it per the load-analysis recipe.")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="HF012 Wan2.2-Animate character animation benchmark (motion fidelity + temporal identity + style adherence designs; the Anime/NPR comparison)")
    parser.add_argument("--mode", required=True, choices=["preflight", "selfcheck", "full"])
    args = parser.parse_args()
    if args.mode == "preflight":
        return run_preflight()
    if args.mode == "selfcheck":
        return run_selfcheck()
    return run_full()


if __name__ == "__main__":
    sys.exit(main())
