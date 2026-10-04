#!/usr/bin/env python3
"""
HF013 — the LTX-2.3 joint audio-video benchmark (flight 10, Worker C's
renderer wave, worker 65-d — the final model flight of the wave). The
candidate: LTX-2.3 (Lightricks/LTX-2.3, a DiT-based audio-video
foundation model with a 22B checkpoint family plus latent
spatial/temporal upscalers).

THE WORK ITEM (VERBATIM — docs/work-items/hf-model-portfolio-work-items.md):

  HF013 — Joint audio-video benchmark
  "Owner: Worker C + Worker A.
   Candidate: LTX-2.3.
   Acceptance: evaluate future combined commentary/reality generation and
   upscaling; document community-license/commercial-use constraints."

THE CANDIDATE (provenance-ledger row, echoed VERBATIM in
benchmark-record.json and validated there by record-benchmark.ts):

  LTX-2.3 = Lightricks/LTX-2.3
  @ 3c6a4e66e5d0a684231950b9c74dd4ded7b6fadc (modelLicense: other —
  ltx-2-community-license-agreement per card license_link to
  Lightricks/LTX-2 LICENSE-2; codeLicense: unknown; weightsProvenance:
  "LTX-2.3, Lightricks' update to LTX-2 with improved audio/visual
  quality and prompt adherence; DiT-based audio-video foundation model;
  checkpoint family ltx-2.3-22b (dev, distilled, distilled-LoRA) plus
  spatial/temporal upscalers, per card."; datasetProvenance unknown;
  commercialUse: unclear; gatingState candidate).

THE THREE FROZEN TASK PROFILES (docs/contracts/technology-task-profiles.md
— consumed, never modified):

  renderer.neuralVideo        "Generic neural video-generation interface
                               for future reality candidates."
  renderer.audioVideoGeneration "Joint audio/video generation profile for
                               future commentary/reality synthesis."
  renderer.upscale            "Resolution/spatial/temporal enhancement
                               profile."

THE EVIDENCE-CHAIN EXCLUSION (the load-bearing honest boundary, the
repo's own established doctrine): HF007 ruled free-form GENERATED text
NOT compatible with the observation evidence chain; HF008 partially
reversed that for transcription-of-observed-audio ONLY (W207's own
shape: modality "audio", provenance "OBSERVED", payload kind
"transcription", text verbatim; W208 derives from it). LTX-2.3's joint
audio-video GENERATION inherits exactly that boundary: GENERATED
commentary audio/text can NEVER be evidence-chain audio. It is encoded
below as the machine-checkable generated_audio_evidence_exclusion(): an
ingestion plan whose observation provenance/payload names GENERATED
audio or free-form generated text is REFUSED with the violation named;
transcription-of-observed-audio passes. Generated audio is a MEASURAND
(or a render product behind the rights contract), never evidence.
(The authorities: packages/asr/src/observe.ts W207, packages/
commentary-segmentation/src/observe.ts W208, packages/contracts/src/
observation.ts — ProvenanceKind OBSERVED|REPORTED|DERIVED, modality
vision|audio|metadata|commentary.)

THE HONEST SHAPE ON THIS HOST (2 vCPU, ~3.95 GiB total RAM, ~1.0 GiB
free disk, no GPU): the compute leg is RESOURCE-INFEASIBLE — the pinned
tree carries 42.980 GiB per 22B transformer checkpoint (dev, distilled,
distilled-1.1) and the LTX-2.3 repo carries ONLY the DiT transformers +
latent upscalers (NO text encoder, NO VAEs, NO tokenizer): the
documented loading recipe (the card → the LTX-2 codebase →
ltx-pipelines) additionally requires the Gemma text encoder + video VAE
+ audio VAE from the Lightricks/LTX-2 component tree (text_encoder
≈55.6 GiB in 12 shards + vae 2.277 GiB + audio_vae 0.099 GiB + vocoder
0.104 GiB); the minimal single-checkpoint composition ≈ 100.9 GiB ≈
~97x this host's free disk; the bf16 transformer working set alone
(42.980 GiB) ≈ 10.9x TOTAL RAM; the codebase is tested with CUDA > 12.7
and PyTorch ~2.7 (the documented recipe is GPU-first; the aux
Lightricks/LTX-2.5 repo is gated auto). The preflight arithmetic
(EXECUTED, bounded probes ONLY — weights never downloaded) refuses the
compute leg; the partial (the acceptance's real value) is delivered:

  1. the load analysis per family member (dev / distilled / distilled
     1.1 / distilled-LoRA x2 / spatial x2 / temporal upscaler) + the
     host-gap arithmetic;
  2. THE LICENSE POSTURE (first-class — the acceptance's own words):
     the THREE license sources distinguished and recorded from the
     ledger row's own URLs (LICENSE = the switchboard index; LICENSE-2
     = the LTX-2 Community License Agreement dated January 5, 2026;
     LICENSE-2_x = the LTX-2.x Community License Agreement dated August
     11, 2026), PLUS the HF repo's own LICENSE file at the PINNED
     revision (fetched bounded — a text document), with the governing-
     agreement ambiguity recorded honestly (card YAML license_link →
     LICENSE-2 vs card prose → LICENSE-2_x vs the index's date rule);
  3. the metric designs for the THREE profiles (implemented
     ready-to-run, typed not-measured, exact definitions, self-checked
     against hand-computed cases — the hf010/hf011/hf012 precedent);
  4. the upscaling evaluation design vs the repo's OWN output pipeline
     (static capability-delta + the adequate-host comparison design —
     the repo's own authorized output artifacts as source inputs,
     never new content);
  5. the machine-checkable contract mapping (contract_compatibility.ts
     — the THREE frozen profiles + the W207/W208 evidence-chain
     exclusion + the rights-provenance contract + the media-platform
     output seams);
  6. the ready-to-run full mode for an adequate host (fail-closed exit
     3 on THIS host — negative-tested).

MODES:
  --mode preflight   EXECUTED on this host (exit 3, the typed refusal):
                      host resources, the bounded pinned hub probes (the
                      12-file tree at the pinned revision with per-file
                      sizes, the HEAD drift check, the aux component
                      repos, the anonymous reachability Range-0 probe —
                      NEVER any weights), the license documents (the HF
                      LICENSE at the pinned revision + the three GitHub
                      license texts sha-verified against the committed
                      research-phase fetches), the resource arithmetic
                      per family member, the license-posture extraction,
                      the model I/O surface, the upscaling pipeline
                      comparison (static + design). Writes
                      results/load-analysis.json,
                      results/model-io-surface.json,
                      results/license-posture.json,
                      results/upscaling-pipeline-comparison.json,
                      results/preflight-refusal.json.
  --mode selfcheck   EXECUTED: verifies the metric implementations
                      against hand-computed cases AND the
                      generated-audio evidence-chain exclusion BOTH
                      directions (the W207 transcription shape passes,
                      the generated-audio plan is refused). Writes
                      results/metric-selfcheck.json. Labeled
                      implementation evidence — NOT a model measurement.
  --mode full        The ready-to-run benchmark for an adequate host
                      (>= 64 GiB RAM, >= 256 GiB free disk, CUDA GPU
                      — the composition floor). FAIL-CLOSED: on any
                      host below the floor it refuses exit 3 BEFORE any
                      download attempt (verified on THIS host).

The license-text fetches are DOCUMENT fetchments (bounded, ~21–30 KB
each) — never weights; the weight files are probed by API metadata and
HTTP HEAD/Range-0 ONLY.
"""

from __future__ import annotations

import argparse
import datetime as _dt
import hashlib
import importlib.util
import json
import math
import os
import shutil
import sys
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
RESULTS = HERE / "results"
RESULTS.mkdir(parents=True, exist_ok=True)
HF_PORTFOLIO = HERE.parent
REPO_ROOT = HF_PORTFOLIO.parent.parent.parent
LEDGER_PATH = HF_PORTFOLIO / "provenance-ledger.json"

# The pinned candidate (provenance-ledger row — never re-derived here).
CANDIDATE_REPO = "Lightricks/LTX-2.3"
CANDIDATE_REVISION = "3c6a4e66e5d0a684231950b9c74dd4ded7b6fadc"
CANDIDATE_NAME = "LTX-2.3"

# The aux component repos of the documented loading recipe (probed for
# METADATA ONLY — never downloaded).
AUX_REPOS = [
    ("Lightricks/LTX-2", "the LTX-2 component tree — the LTX-2.3 loading recipe's text encoder / VAE / tokenizer sources"),
    ("Lightricks/LTX-2.5", "the LTX-2.5 component tree — the current ltx-pipelines quick-start aux source (gated auto)"),
]

# The license documents of the ledger row's own sources (TEXT documents
# — bounded fetches allowed; weights NEVER).
GITHUB_LICENSE_DOCS = [
    ("LICENSE", "https://raw.githubusercontent.com/Lightricks/LTX-2/main/LICENSE"),
    ("LICENSE-2", "https://raw.githubusercontent.com/Lightricks/LTX-2/main/LICENSE-2"),
    ("LICENSE-2_x", "https://raw.githubusercontent.com/Lightricks/LTX-2/main/LICENSE-2_x"),
]
COMMITTED_FETCHES = {
    "LICENSE": HF_PORTFOLIO / "fetches/github/Lightricks__LTX-2.LICENSE",
    "LICENSE-2": HF_PORTFOLIO / "fetches/github/Lightricks__LTX-2.LICENSE-2",
    "LICENSE-2_x": HF_PORTFOLIO / "fetches/github/Lightricks__LTX-2.LICENSE-2_x",
}
LTX_PIPELINES_README_URL = "https://raw.githubusercontent.com/Lightricks/LTX-2/main/packages/ltx-pipelines/README.md"

# The adequate-host floor for the full mode (the composition arithmetic
# below — the minimal viable single-checkpoint composition + working set).
FULL_MODE_FLOOR_RAM_GIB = 64.0
FULL_MODE_FLOOR_DISK_GIB = 256.0
FULL_MODE_REQUIRES_CUDA = True

# The three FROZEN profiles (consumed, never modified).
FROZEN_PROFILES = {
    "renderer.neuralVideo": "Generic neural video-generation interface for future reality candidates.",
    "renderer.audioVideoGeneration": "Joint audio/video generation profile for future commentary/reality synthesis.",
    "renderer.upscale": "Resolution/spatial/temporal enhancement profile.",
}

# The evidence-chain authorities (the W207/W208 contracts — quoted from
# the repo's own sources, never invented).
W207_SHAPE = {
    "modality": "audio",
    "provenance": "OBSERVED",
    "payloadKind": "transcription",
    "textVerbatim": True,
    "authority": "packages/asr/src/observe.ts (W207 — the STT adapter: modality \"audio\", provenance \"OBSERVED\", payload kind \"transcription\" with text verbatim)",
}
W208_SHAPE = {
    "modality": "commentary",
    "provenance": "DERIVED",
    "payloadKind": "transcription",
    "authority": "packages/commentary-segmentation/src/observe.ts (W208 — segmentation is deterministic INFERENCE over observed transcriptions; asrConfidence maps by NOT producing it)",
}
PROVENANCE_VOCAB = ["OBSERVED", "REPORTED", "DERIVED"]
MODALITY_VOCAB = ["vision", "audio", "metadata", "commentary"]


def _gib(num_bytes: float) -> float:
    return num_bytes / (1024.0 ** 3)


def _fmt_gib(num_bytes: float) -> str:
    return f"{_gib(num_bytes):.3f} GiB"


def _sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _utc_now_iso() -> str:
    return _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _write_json(name: str, document: dict) -> Path:
    path = RESULTS / name

    def _finite(node):
        """JSON-honest serialization: float inf (the identity-PSNR case) is
        written as the string 'Infinity' — Python's bare Infinity token is
        invalid strict JSON and would fail the TS-side readers."""
        if isinstance(node, float) and math.isinf(node):
            return "Infinity" if node > 0 else "-Infinity"
        if isinstance(node, dict):
            return {k: _finite(v) for k, v in node.items()}
        if isinstance(node, list):
            return [_finite(v) for v in node]
        return node

    path.write_text(json.dumps(_finite(document), indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return path


# ---------------------------------------------------------------------------
# Shared estimators — IMPORTED from the merged hf010 flight, never
# re-implemented (the hf011/hf012 fairness convention: every comparison
# lane is scored by the SAME code).
# ---------------------------------------------------------------------------
HF010_DIR = HF_PORTFOLIO / "hf010"
_spec = importlib.util.spec_from_file_location("hf010_benchmark_renderer", HF010_DIR / "benchmark_renderer.py")
hf010 = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(hf010)

ssim_constant_patches = hf010.ssim_constant_patches
_Flow = hf010._Flow
flow_warp_residual = hf010.flow_warp_residual
hallucinated_region_rate = hf010.hallucinated_region_rate
wall_clock_ms_per_output_second = hf010.wall_clock_ms_per_output_second
player_identity_stability = hf010.player_identity_stability


# ---------------------------------------------------------------------------
# Host resources (live — the hf010/hf011/hf012 convention: the committed
# bytes are the worker's canonical evidence; a re-run differs only in
# availableRam/freeDisk live stats).
# ---------------------------------------------------------------------------
def host_resources() -> dict:
    total_ram = 0
    free_disk = 0.0
    try:
        with open("/proc/meminfo", encoding="utf-8") as fh:
            for line in fh:
                if line.startswith("MemTotal:"):
                    total_ram = int(line.split()[1]) * 1024
    except OSError:
        pass
    try:
        free_disk = shutil.disk_usage(str(REPO_ROOT)).free
    except OSError:
        pass
    cpus = os.cpu_count() or 1
    has_cuda = False  # no GPU on this host — recorded honestly, never zero
    try:
        for pci in Path("/proc/bus/pci/devices").read_text(encoding="utf-8").splitlines():
            if "10de" in pci.split("\t")[-1][-8:]:
                has_cuda = True
    except OSError:
        pass
    return {
        "availableRam": total_ram,
        "availableRamGiB": round(_gib(total_ram), 3),
        "freeDisk": int(free_disk),
        "freeDiskGiB": round(_gib(free_disk), 3),
        "cpuCores": cpus,
        "cuda": "N/A — no GPU on the benchmark host" if not has_cuda else "present",
        "note": "CPU wall-clock context only; GPU N/A honestly (never zero, never invented)",
    }


# ---------------------------------------------------------------------------
# Bounded hub probes (METADATA ONLY — weights NEVER downloaded).
# ---------------------------------------------------------------------------
def _hub_api():
    try:
        from huggingface_hub import HfApi

        return HfApi()
    except Exception as exc:  # pragma: no cover — the lean venv pin
        raise RuntimeError(f"huggingface_hub unavailable: {exc}") from exc


def probe_repo(api, repo_id: str, revision: str | None = None, note: str = "") -> dict:
    try:
        info = api.model_info(repo_id, revision=revision, files_metadata=True, timeout=60)
        files = []
        for s in (info.siblings or []):
            entry = {"rfilename": s.rfilename}
            size = s.size if s.size is not None else (s.lfs.size if s.lfs and s.lfs.size else None)
            if size is not None:
                entry["sizeBytes"] = size
            files.append(entry)
        return {
            "ok": True,
            "repoId": repo_id,
            "requestedRevision": revision,
            "resolvedSha": info.sha,
            "gated": getattr(info, "gated", None),
            "note": note,
            "fileCount": len(files),
            "totalBytes": sum(f.get("sizeBytes", 0) for f in files),
            "files": files,
        }
    except Exception as exc:
        return {"ok": False, "repoId": repo_id, "requestedRevision": revision, "note": note,
                "error": f"{type(exc).__name__}: {exc}"}


def reachability_range_probe(repo_id: str, revision: str, filename: str) -> dict:
    """Anonymous reachability via a 1-byte Range request (NEVER a download
    of the weights — a 206 with 1 byte proves anonymous access)."""
    url = f"https://huggingface.co/{repo_id}/resolve/{revision}/{filename}"
    try:
        req = urllib.request.Request(url, headers={"Range": "bytes=0-0", "User-Agent": "hf013-bounded-probe/1.0"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = resp.read(2)
            return {
                "url": url,
                "httpStatus": resp.status,
                "bytesRead": len(body),
                "verdict": "anonymously-reachable (no auth wall)" if resp.status in (200, 206) else f"status {resp.status}",
            }
    except Exception as exc:
        return {"url": url, "httpStatus": None, "bytesRead": 0,
                "verdict": f"probe failed: {type(exc).__name__}: {exc}"}


def fetch_text_document(url: str, max_bytes: int = 200_000) -> dict:
    """Bounded fetch of a TEXT document (license/README — never weights)."""
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "hf013-bounded-probe/1.0"})
        with urllib.request.urlopen(req, timeout=45) as resp:
            data = resp.read(max_bytes + 1)
            truncated = len(data) > max_bytes
            return {
                "url": url,
                "httpStatus": resp.status,
                "bytes": len(data),
                "sha256": _sha256_bytes(data),
                "truncated": truncated,
                "text": data.decode("utf-8", errors="replace") if not truncated else None,
            }
    except Exception as exc:
        return {"url": url, "httpStatus": None, "bytes": 0, "sha256": None, "truncated": False,
                "text": None, "error": f"{type(exc).__name__}: {exc}"}


# ---------------------------------------------------------------------------
# Family composition — the exact per-member composition at the pinned
# revision (HF API metadata; the LTX-2.3 repo carries ONLY the DiT
# transformers + latent upscalers, so the documented loading recipe's
# auxiliary components are accounted from the LTX-2 component tree).
# ---------------------------------------------------------------------------
def family_composition(candidate_probe: dict, aux_probe: dict) -> dict:
    cand_files = {f["rfilename"]: f.get("sizeBytes", 0) for f in candidate_probe.get("files", [])}
    aux_files = {f["rfilename"]: f.get("sizeBytes", 0) for f in aux_probe.get("files", [])}

    # the LTX-2 diffusers-format aux components (the documented recipe:
    # ltx-pipelines --text-encoder-path/--video-vae-path/--audio-vae-path)
    text_encoder_bytes = sum(v for k, v in aux_files.items() if k.startswith("text_encoder/") and k.endswith(".safetensors"))
    vae_bytes = aux_files.get("vae/diffusion_pytorch_model.safetensors", 0)
    audio_vae_bytes = aux_files.get("audio_vae/diffusion_pytorch_model.safetensors", 0)
    vocoder_bytes = aux_files.get("vocoder/diffusion_pytorch_model.safetensors", 0)
    latent_upsampler_bytes = aux_files.get("latent_upsampler/diffusion_pytorch_model.safetensors", 0)
    connectors_bytes = aux_files.get("connectors/diffusion_pytorch_model.safetensors", 0)
    tokenizer_bytes = sum(v for k, v in aux_files.items() if k.startswith("tokenizer/"))

    def member(checkpoint: str, checkpoint_bytes: int, note: str, uses_lora: bool = False,
               includes_upscalers: bool = False) -> dict:
        download = checkpoint_bytes + text_encoder_bytes + vae_bytes + audio_vae_bytes + vocoder_bytes + tokenizer_bytes + connectors_bytes
        if includes_upscalers:
            download += cand_files.get("ltx-2.3-spatial-upscaler-x2-1.1.safetensors", 0)
            download += cand_files.get("ltx-2.3-temporal-upscaler-x2-1.0.safetensors", 0)
        # bf16 working set: the transformer + text encoder resident in RAM
        working_set = checkpoint_bytes + text_encoder_bytes + vae_bytes + audio_vae_bytes + vocoder_bytes
        return {
            "member": checkpoint,
            "checkpointBytes": checkpoint_bytes,
            "note": note,
            "loraAdapter": uses_lora,
            "downloadCompositionBytes": {
                "ltx23Transformer": checkpoint_bytes,
                "textEncoderGemma": text_encoder_bytes,
                "videoVae": vae_bytes,
                "audioVae": audio_vae_bytes,
                "vocoder": vocoder_bytes,
                "tokenizer": tokenizer_bytes,
                "connectors": connectors_bytes,
            },
            "minimalDownloadBytes": download,
            "bf16WorkingSetBytes": working_set,
        }

    members = [
        member("ltx-2.3-22b-dev", cand_files.get("ltx-2.3-22b-dev.safetensors", 0),
               "the full model, flexible and trainable in bf16 (the card's own table)"),
        member("ltx-2.3-22b-distilled", cand_files.get("ltx-2.3-22b-distilled.safetensors", 0),
               "the distilled version of the full model, 8 steps, CFG=1 (the card's own table)"),
        member("ltx-2.3-22b-distilled-1.1", cand_files.get("ltx-2.3-22b-distilled-1.1.safetensors", 0),
               "the distilled v1.1, 8 steps, CFG=1 — improved audio vs v1.0 (the card's own table)"),
        member("ltx-2.3-22b-distilled-lora-384", cand_files.get("ltx-2.3-22b-distilled-lora-384.safetensors", 0),
               "a LoRA version of the distilled model APPLICABLE TO THE FULL MODEL (the card: the LoRA is not standalone — the full 22b dev transformer is also required)",
               uses_lora=True),
        member("ltx-2.3-22b-distilled-lora-384-1.1", cand_files.get("ltx-2.3-22b-distilled-lora-384-1.1.safetensors", 0),
               "a LoRA version of the v1.1 distilled model applicable to the full model (same non-standalone rule)",
               uses_lora=True),
        member("ltx-2.3-spatial-upscaler-x1.5-1.0", cand_files.get("ltx-2.3-spatial-upscaler-x1.5-1.0.safetensors", 0),
               "an x1.5 SPATIAL upscaler for the ltx-2.3 LATENTS — a latent-space stage of the multiscale pipeline, NOT a standalone image upscaler"),
        member("ltx-2.3-spatial-upscaler-x2-1.1", cand_files.get("ltx-2.3-spatial-upscaler-x2-1.1.safetensors", 0),
               "an x2 spatial upscaler for the ltx-2.3 latents (multiscale pipelines)"),
        member("ltx-2.3-temporal-upscaler-x2-1.0", cand_files.get("ltx-2.3-temporal-upscaler-x2-1.0.safetensors", 0),
               "an x2 TEMPORAL upscaler for the ltx-2.3 latents — higher FPS (multiscale pipelines)"),
    ]
    # the LoRA members additionally require the dev transformer (the card's
    # own wording: "applicable to the full model")
    for m in members:
        if m["loraAdapter"]:
            m["minimalDownloadBytes"] += cand_files.get("ltx-2.3-22b-dev.safetensors", 0)
            m["downloadCompositionBytes"]["plusDevTransformerForLoRA"] = cand_files.get("ltx-2.3-22b-dev.safetensors", 0)
            m["bf16WorkingSetBytes"] += cand_files.get("ltx-2.3-22b-dev.safetensors", 0)
    whole_tree = candidate_probe.get("totalBytes", 0)
    return {
        "label": "the LTX-2.3 checkpoint family at the pinned revision (per-file sizes from the HF API — metadata only, never downloaded)",
        "candidateTreeBytes": whole_tree,
        "candidateTreeGiB": round(_gib(whole_tree), 3),
        "candidateCarriesOnlyTransformersAndUpscalers": True,
        "candidateCarriesOnlyTransformersAndUpscalersNote": (
            "the LTX-2.3 repo has NO text encoder, NO VAEs, NO tokenizer — the documented "
            "loading recipe (card → LTX-2 codebase → ltx-pipelines) takes them from the "
            "Lightricks/LTX-2 component tree"
        ),
        "auxiliaryComponents": {
            "source": "Lightricks/LTX-2 (the component tree — probed metadata only)",
            "textEncoderGemma": text_encoder_bytes,
            "videoVae": vae_bytes,
            "audioVae": audio_vae_bytes,
            "vocoder": vocoder_bytes,
            "latentUpsampler": latent_upsampler_bytes,
            "connectors": connectors_bytes,
            "tokenizer": tokenizer_bytes,
        },
        "members": members,
    }


def candidate_arithmetic(composition: dict, host: dict) -> dict:
    free_disk = host["freeDisk"] or 1
    total_ram = host["availableRam"] or 1
    rows = []
    for m in composition["members"]:
        rows.append({
            "member": m["member"],
            "minimalDownloadGiB": round(_gib(m["minimalDownloadBytes"]), 3),
            "downloadVsFreeDisk": round(m["minimalDownloadBytes"] / free_disk, 1),
            "bf16WorkingSetGiB": round(_gib(m["bf16WorkingSetBytes"]), 3),
            "workingSetVsTotalRam": round(m["bf16WorkingSetBytes"] / total_ram, 1),
        })
    return {
        "label": "the host-gap arithmetic (EXECUTED — bounded probes, weights never downloaded)",
        "host": {k: host[k] for k in ("availableRamGiB", "freeDiskGiB", "cpuCores", "cuda")},
        "perMember": rows,
        "wholeTreeGiB": composition["candidateTreeGiB"],
        "wholeTreeVsFreeDisk": round(composition["candidateTreeBytes"] / free_disk, 1),
        "smallestMemberGiB": min(round(_gib(m["checkpointBytes"]), 3) for m in composition["members"]),
        "verdict": "resource-infeasible-host",
    }


# ---------------------------------------------------------------------------
# THE EVIDENCE-CHAIN EXCLUSION (machine-checkable — the load-bearing
# honest boundary; the authorities are the W207/W208 observation
# contracts and the ProvenanceKind/SourceModality vocabularies).
# ---------------------------------------------------------------------------
def generated_audio_evidence_exclusion(plan: dict) -> dict:
    """The repo's own doctrine, encoded as a machine check.

    An ingestion plan routes audio into the observation evidence chain by
    naming its provenance + payload kind. The rule (HF007's generated-text
    verdict + HF008's transcription-only reversal):

      - generated audio / free-form generated text (provenance GENERATED,
        or payload kind 'generation', or source 'renderer output' /
        'audioVideoGeneration output')  ->  REFUSED — generated commentary
        audio can NEVER be evidence-chain audio;
      - transcription-of-observed-audio (W207's own shape: modality
        'audio', provenance 'OBSERVED', payload kind 'transcription') ->
        ACCEPTED (the HF008 reversal, nothing more);
      - deterministic segmentation over observed transcriptions (W208's
        shape: provenance 'DERIVED' over observed transcriptions) ->
        ACCEPTED.

    Generated audio remains legal as a MEASURAND (benchmark input) or a
    render product behind the rights contract — never as evidence.
    """
    provenance = plan.get("provenance")
    payload_kind = plan.get("payloadKind")
    source = plan.get("source")
    generated_markers = ("GENERATED", "generation")
    is_generated = (
        provenance in generated_markers
        or payload_kind in generated_markers
        or (isinstance(source, str) and ("renderer-output" in source or "audioVideoGeneration-output" in source))
    )
    transcription_shapes = (
        provenance == W207_SHAPE["provenance"] and payload_kind == W207_SHAPE["payloadKind"]
    ) or (provenance == W208_SHAPE["provenance"] and payload_kind == W208_SHAPE["payloadKind"])
    if is_generated:
        return {
            "verdict": "REFUSED",
            "violation": (
                f"plan routes GENERATED audio/text into the observation evidence chain "
                f"(provenance={provenance!r}, payloadKind={payload_kind!r}, source={source!r}) — "
                f"generated commentary audio can NEVER be evidence-chain audio "
                f"(HF007/HF008: the transcription-vs-generation boundary; W207/W208 are the authorities)"
            ),
            "plan": plan,
        }
    if transcription_shapes:
        return {
            "verdict": "ACCEPTED",
            "reason": (
                "transcription-of-observed-audio (the W207 shape) or deterministic segmentation over "
                "observed transcriptions (the W208 shape) — the ONLY audio paths the evidence chain admits"
            ),
            "plan": plan,
        }
    return {
        "verdict": "REFUSED",
        "violation": (
            f"plan's audio ingestion shape is not any admitted provenance/payload combination "
            f"(provenance={provenance!r}, payloadKind={payload_kind!r}) — fail-closed: unknown shapes "
            f"are refused, never silently admitted (the ProvenanceKind vocabulary is "
            f"OBSERVED|REPORTED|DERIVED; no GENERATED member exists by design)"
        ),
        "plan": plan,
    }


# ---------------------------------------------------------------------------
# METRIC DESIGNS — renderer.audioVideoGeneration (joint audio/video
# generation). Implemented, typed not-measured, exact definitions, self-
# checked against hand-computed cases.
# ---------------------------------------------------------------------------
def av_onset_sync_error_ms(visual_event_frames: list[int], audio_onset_ms: list[float],
                           fps: float, tolerance_ms: float = 0.0) -> float:
    """The mean absolute offset |visual_event_time − audio_onset_time| in ms
    over matched (visual-event-frame, audio-onset) pairs. Visual event time
    = frameIndex / fps * 1000. The joint-generation sync quality: a
    synchronized audio-video model must place the audio transient at the
    visual event. (Exact definition: mean |t_v − t_a|; 0 is perfect.)"""
    if not visual_event_frames or len(visual_event_frames) != len(audio_onset_ms):
        raise ValueError("onset sync needs matched frame/onset pairs")
    if fps <= 0:
        raise ValueError("onset sync needs fps > 0")
    total = 0.0
    for frame_idx, onset_ms in zip(visual_event_frames, audio_onset_ms):
        total += abs((frame_idx / fps) * 1000.0 - onset_ms)
    return total / len(visual_event_frames)


def av_cross_correlation_peak_lag_ms(audio_envelope: list[float], motion_energy: list[float],
                                     hop_ms: float) -> float:
    """The lag (ms) at the peak of the normalized cross-correlation between
    the audio envelope and the visual motion-energy curve, both sampled at
    the same hop. Positive = audio lags video. (Exact definition: argmax_k
    of the Pearson correlation over all integer shifts k; lag = k * hop_ms.
    This is the alignment measure when no discrete event pairing exists.)"""
    if len(audio_envelope) != len(motion_energy) or not audio_envelope:
        raise ValueError("cross-correlation needs equal-length series")
    if hop_ms <= 0:
        raise ValueError("cross-correlation needs hop > 0")

    def _corr(a: list[float], b: list[float]) -> float:
        n = len(a)
        ma = sum(a) / n
        mb = sum(b) / n
        num = sum((x - ma) * (y - mb) for x, y in zip(a, b))
        da = math.sqrt(sum((x - ma) ** 2 for x in a))
        db = math.sqrt(sum((y - mb) ** 2 for y in b))
        if da == 0 or db == 0:
            return 0.0
        return num / (da * db)

    best_k, best_r = 0, -2.0
    for k in range(-(len(audio_envelope) - 1), len(audio_envelope)):
        if k >= 0:
            r = _corr(audio_envelope[k:], motion_energy[: len(audio_envelope) - k])
        else:
            r = _corr(audio_envelope[: len(audio_envelope) + k], motion_energy[-k:])
        if r > best_r:
            best_r, best_k = r, k
    return best_k * hop_ms


def commentary_wer(reference_words: list[str], hypothesis_words: list[str]) -> float:
    """Word Error Rate of the GENERATED commentary speech (transcribed by
    the W207-compatible STT) against the CONDITIONING commentary text —
    the commentary-text adherence measure when the model is speech-
    conditioned. (Exact definition: (S + D + I) / N over the standard
    Levenshtein alignment at the word level.) NOTE: this measures the
    MODEL's adherence to its conditioning; it NEVER feeds the evidence
    chain (the exclusion above)."""
    # standard DP word-level edit distance with substitutions/deletions/insertions
    n, m = len(reference_words), len(hypothesis_words)
    if n == 0:
        return 0.0 if m == 0 else 1.0
    dp = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(n + 1):
        dp[i][0] = i
    for j in range(m + 1):
        dp[0][j] = j
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            sub = dp[i - 1][j - 1] + (0 if reference_words[i - 1] == hypothesis_words[j - 1] else 1)
            dp[i][j] = min(sub, dp[i - 1][j] + 1, dp[i][j - 1] + 1)
    return dp[n][m] / n


def audio_hallucination_rate(generated_audio_events: list[dict], authorized_events: list[dict],
                             tolerance_ms: float = 500.0) -> float:
    """The fraction of generated audio events (detected transients / speech
    segments) that have NO corresponding authorized event — a conditioning
    text event, an observed commentary segment, or a video event — within
    the tolerance window. (Exact definition: unmatched / total generated.
    0 is the no-hallucination ideal. The audio modality's counterpart of
    hf010's hallucinated_region_rate — the video one is IMPORTED.)"""
    if not generated_audio_events:
        raise ValueError("audio hallucination rate needs generated events")
    unmatched = 0
    for g in generated_audio_events:
        g_ms = g["onsetMs"]
        matched = any(abs(g_ms - a["onsetMs"]) <= tolerance_ms for a in authorized_events)
        if not matched:
            unmatched += 1
    return unmatched / len(generated_audio_events)


# ---------------------------------------------------------------------------
# METRIC DESIGNS — renderer.neuralVideo (the HF010-shared vocabulary
# where applicable; the profile-specific implementations below reuse the
# IMPORTED hf010 estimators — both comparison lanes scored by the same
# code, the fairness rule).
# ---------------------------------------------------------------------------
def psnr_db(mse: float, peak: float = 255.0) -> float:
    """PSNR in dB from a mean-squared error (exact closed form:
    10·log10(peak² / mse); infinity at mse=0 — returned as float('inf'))."""
    if mse < 0:
        raise ValueError("psnr needs mse >= 0")
    if mse == 0:
        return float("inf")
    return 10.0 * math.log10((peak * peak) / mse)


def reference_frame_fidelity(first_frame_luma: list[float], conditioning_image_luma: list[float]) -> dict:
    """For the image-to-video surface (LTX-2.3 supports i2v): the fidelity
    of the generated first frame vs the conditioning reference — RMSE and
    PSNR on the luma channel. (Exact definition: mse = mean((a-b)²) over
    pixels; psnr = 10·log10(255²/mse).)"""
    if len(first_frame_luma) != len(conditioning_image_luma) or not first_frame_luma:
        raise ValueError("reference fidelity needs equal-length luma arrays")
    mse = sum((a - b) ** 2 for a, b in zip(first_frame_luma, conditioning_image_luma)) / len(first_frame_luma)
    return {"mse": mse, "psnrDb": psnr_db(mse)}


# ---------------------------------------------------------------------------
# METRIC DESIGNS — renderer.upscale (THE NO-LYING CONSTRAINT: upscaling
# must NOT invent content — the upscaled output, brought back to the
# source geometry, must match the source; detail gain is measured
# SEPARATELY so it can never masquerade as fidelity).
# ---------------------------------------------------------------------------
def roundtrip_fidelity(upscaled_brought_back: list[float], source: list[float]) -> dict:
    """THE NO-LYING CORE (spatial): the upscaler's output is downscaled
    back to the source geometry (the comparison design pins the exact
    downscale — area-average) and compared to the SOURCE patch: RMSE +
    PSNR + SSIM (constant-patch closed form via the SHARED hf010
    estimator). An upscaler that INVENTS content fails here even if it
    looks sharp: invented detail deviates from the source content."""
    if len(upscaled_brought_back) != len(source) or not source:
        raise ValueError("roundtrip fidelity needs equal-length arrays")
    mse = sum((a - b) ** 2 for a, b in zip(upscaled_brought_back, source)) / len(source)
    mu_u = sum(upscaled_brought_back) / len(upscaled_brought_back)
    mu_s = sum(source) / len(source)
    return {
        "mse": mse,
        "psnrDb": psnr_db(mse),
        "ssimConstantPatches": ssim_constant_patches(mu_u, mu_s),
        "estimatorNote": "ssim via the SHARED hf010.ssim_constant_patches (imported, never re-implemented)",
    }


def no_invented_content_rate(patch_deviations: list[float], resampling_tolerance: float) -> float:
    """The fraction of source-aligned patches whose roundtrip deviation
    exceeds the resampling tolerance — i.e., content the upscaler INVENTED
    (a deviation no honest resampler would produce). (Exact definition:
    #{deviation > tolerance} / #patches; 0 is the no-lying ideal. The
    tolerance is pinned per comparison design as the worst deviation of
    the BASELINE resampler (bilinear) on the same source — never a free
    parameter.)"""
    if not patch_deviations:
        raise ValueError("no-invented-content rate needs patches")
    return sum(1 for d in patch_deviations if d > resampling_tolerance) / len(patch_deviations)


def detail_preservation_gain(source_high_freq_energy: float, baseline_upscale_high_freq: float,
                             candidate_upscale_high_freq: float) -> float:
    """The detail-gain RATIO of the candidate upscaler vs the baseline
    resampler (bilinear) on the same source: (candidate − source) /
    (baseline − source) high-frequency energy (a Laplacian/sharpness
    measure — the sum of squared second differences). (Exact definition:
    the ratio above; 0 = no detail added; 1 = exactly the baseline's
    smoothing-agnostic detail; > 1 = the upscaler adds high-frequency
    structure BEYOND the baseline — which the no-lying metric must then
    attribute to source content, not invention.)"""
    denom = baseline_upscale_high_freq - source_high_freq_energy
    if denom == 0:
        return 0.0
    return (candidate_upscale_high_freq - source_high_freq_energy) / denom


def high_freq_energy(samples: list[float]) -> float:
    """The sharpness measure: sum of squared second differences (a discrete
    Laplacian energy — exact, hand-computable)."""
    if len(samples) < 3:
        raise ValueError("high-frequency energy needs >= 3 samples")
    return sum((samples[i - 1] - 2 * samples[i] + samples[i + 1]) ** 2 for i in range(1, len(samples) - 1))


def temporal_upscale_motion_coherence(flow_residuals: list[float], source_flow_magnitude: float) -> float:
    """For the TEMPORAL upscaler (x2 FPS): the interpolated frames' motion
    coherence — the mean flow-warp residual of each interpolated frame vs
    the source-motion interpolation (the SHARED hf010 flow_warp_residual
    estimator on the comparison design's explicit flow domain), NORMALIZED
    by the source motion magnitude so a static scene is not rewarded for
    zero motion. (Exact definition: mean(residual) / max(source_flow, eps);
    0 = the interpolated motion matches the source motion exactly.)"""
    if not flow_residuals or source_flow_magnitude <= 0:
        raise ValueError("temporal coherence needs residuals and source motion > 0")
    return (sum(flow_residuals) / len(flow_residuals)) / source_flow_magnitude


def artifact_block_boundary_rate(patch_boundary_discontinuities: list[float], natural_discontinuity_tolerance: float) -> float:
    """The upscaling artifact rate: the fraction of patch boundaries where
    the upscaled output's discontinuity exceeds the source's own worst
    natural discontinuity by the tolerance (blocking / ringing — periodic
    grid-aligned discontinuities the source does not have). (Exact
    definition: #{boundary discontinuity > tolerance} / #boundaries; 0 is
    the no-artifact ideal.)"""
    if not patch_boundary_discontinuities:
        raise ValueError("artifact rate needs boundaries")
    return sum(1 for d in patch_boundary_discontinuities if d > natural_discontinuity_tolerance) / len(patch_boundary_discontinuities)


# ---------------------------------------------------------------------------
# Mode: preflight (EXECUTED on this host — exit 3, the typed refusal)
# ---------------------------------------------------------------------------
def run_preflight() -> int:
    host = host_resources()
    api = _hub_api()

    # --- bounded probes (metadata ONLY — weights NEVER downloaded) ------
    candidate = probe_repo(api, CANDIDATE_REPO, revision=CANDIDATE_REVISION,
                           note="the pinned candidate revision (the ledger row's own pin)")
    candidate_head = probe_repo(api, CANDIDATE_REPO, note="HEAD drift check (the pin vs the moving head)")
    aux_probes = {}
    for repo_id, note in AUX_REPOS:
        aux_probes[repo_id] = probe_repo(api, repo_id, note=note)
    reachability = {
        "ltx-2.3-22b-dev.safetensors": reachability_range_probe(CANDIDATE_REPO, CANDIDATE_REVISION, "ltx-2.3-22b-dev.safetensors"),
        "ltx-2.3-temporal-upscaler-x2-1.0.safetensors": reachability_range_probe(CANDIDATE_REPO, CANDIDATE_REVISION, "ltx-2.3-temporal-upscaler-x2-1.0.safetensors"),
    }
    pin_ok = candidate.get("ok") and candidate.get("resolvedSha") == CANDIDATE_REVISION

    # --- the license documents (TEXT fetches — bounded, never weights) ---
    hf_license = fetch_text_document(
        f"https://huggingface.co/{CANDIDATE_REPO}/resolve/{CANDIDATE_REVISION}/LICENSE"
    )
    github_licenses = {}
    for name, url in GITHUB_LICENSE_DOCS:
        doc = fetch_text_document(url)
        committed = COMMITTED_FETCHES.get(name)
        doc["committedFetchPath"] = str(committed.relative_to(REPO_ROOT)) if committed else None
        doc["committedFetchSha256"] = _sha256_bytes(committed.read_bytes()) if committed and committed.exists() else None
        doc["matchesCommittedFetch"] = (
            doc.get("sha256") is not None and doc.get("committedFetchSha256") == doc.get("sha256")
        )
        github_licenses[name] = doc
    pipelines_doc = fetch_text_document(LTX_PIPELINES_README_URL)

    # --- composition + arithmetic -----------------------------------------
    ltx2_aux = aux_probes.get("Lightricks/LTX-2", {})
    composition = family_composition(candidate, ltx2_aux)
    arithmetic = candidate_arithmetic(composition, host)

    # --- the typed refusal --------------------------------------------------
    reasons = [
        f"the pinned candidate tree alone is {_fmt_gib(candidate.get('totalBytes', 0))} = "
        f"{arithmetic['wholeTreeVsFreeDisk']}x the host's free disk ({host['freeDiskGiB']} GiB)",
        f"the MINIMAL single-checkpoint loading composition (one 22B transformer + the Gemma text encoder + "
        f"video/audio VAEs + vocoder + tokenizer from the Lightricks/LTX-2 component tree) is "
        f"~{_fmt_gib(min(m['minimalDownloadBytes'] for m in composition['members']))} = "
        f"{min(r['downloadVsFreeDisk'] for r in arithmetic['perMember'])}x free disk",
        f"the bf16 transformer+encoder working set for the smallest 22B member is "
        f"{min(r['bf16WorkingSetGiB'] for r in arithmetic['perMember'])} GiB = "
        f"{min(r['workingSetVsTotalRam'] for r in arithmetic['perMember'])}x the host's TOTAL RAM "
        f"({host['availableRamGiB']} GiB)",
        "the documented recipe is GPU-first: the card's own codebase note ('tested with Python >=3.12, "
        "CUDA version >12.7, and supports PyTorch ~= 2.7') and the ltx-pipelines optimization path "
        "(FP8 quantization / offload exist 'in cases of GPU memory constraints' — there is no "
        "documented CPU-only generation path)",
        f"2-vCPU latency infeasibility: a 22B DiT at 8 distilled steps per frame-batch has no "
        f"CPU-realtime prospect on {host['cpuCores']} vCPU (the honest latency verdict is the typed "
        f"refusal, never a fabricated number)",
        "even the smallest artifact (the 0.244 GiB temporal upscaler) is a LATENT-space stage: it "
        "consumes ltx-2.3 latents, so it cannot run without the full generation pipeline loaded — "
        "there is NO independently-runnable member of this family on this host",
    ]
    refusal = {
        "workItem": "HF013 — Joint audio-video benchmark",
        "candidate": CANDIDATE_NAME,
        "pinnedRevision": CANDIDATE_REVISION,
        "pinnedRevisionVerified": pin_ok,
        "verdict": "refused",
        "refusalType": "resource-infeasible-host",
        "weightsDownloaded": False,
        "boundedProbesOnly": True,
        "boundedProbesNote": "HF API metadata (file sizes at the pinned revision) + 1-byte anonymous Range reachability probes + TEXT license-document fetches (~21-30 KB each) — the weights were NEVER downloaded, never committed, never vendored",
        "authWall": "none — the pinned repo is gated=False and the Range-0 probe returned anonymously (the honest contrast with HF010's Meridian/VGGT-Omega manual gate); the AUX Lightricks/LTX-2.5 repo is gated auto but is NOT a download dependency of the LTX-2.3 recipe (the LTX-2 component tree is ungated)",
        "host": {k: host[k] for k in ("availableRamGiB", "freeDiskGiB", "cpuCores", "cuda")},
        "reasons": reasons,
        "executedAtUtc": _utc_now_iso(),
        "partialDelivered": [
            "the load analysis per family member (results/load-analysis.json)",
            "the license posture — FIRST-CLASS, the acceptance's own words (results/license-posture.json)",
            "the model I/O surface vs the three frozen profiles (results/model-io-surface.json)",
            "the three-profile metric designs, implemented + self-checked (results/metric-selfcheck.json)",
            "the upscaling pipeline comparison vs the repo's own output pipeline (results/upscaling-pipeline-comparison.json)",
            "the machine-checkable contract mapping (results/contract-compatibility.json via contract_compatibility.ts)",
            "the ready-to-run full mode for an adequate host (fail-closed exit 3 here — negative-tested)",
        ],
    }

    # --- license posture (FIRST-CLASS) --------------------------------------
    license_posture = build_license_posture(hf_license, github_licenses, pipelines_doc, candidate)

    # --- model I/O surface ---------------------------------------------------
    io_surface = build_model_io_surface(candidate, pipelines_doc)

    # --- the upscaling pipeline comparison (static + design) -----------------
    upscaling = build_upscaling_pipeline_comparison()

    # --- write the results ----------------------------------------------------
    _write_json("load-analysis.json", {
        "label": "the LTX-2.3 family load analysis (EXECUTED via bounded HF API metadata probes — weights never downloaded)",
        "probes": {
            "candidatePinned": {k: v for k, v in candidate.items() if k != "files"},
            "candidatePinnedFiles": candidate.get("files"),
            "candidateHeadSha": candidate_head.get("resolvedSha"),
            "candidateHeadDrift": candidate_head.get("resolvedSha") != CANDIDATE_REVISION,
            "auxRepos": {k: {kk: vv for kk, vv in v.items() if kk != "files"} for k, v in aux_probes.items()},
            "reachabilityRangeProbes": reachability,
        },
        "composition": composition,
        "arithmetic": arithmetic,
        "loadingRecipe": {
            "documentedSource": "the LTX-2.3 card → the LTX-2 codebase → packages/ltx-pipelines (the card's own 'Run locally' section)",
            "recipe": [
                "--transformer-path (one ltx-2.3-22b-*.safetensors from the candidate repo)",
                "--text-encoder-path (Gemma, from the LTX-2 component tree)",
                "--video-vae-path + --audio-vae-path (from the LTX-2 component tree)",
                "--spatial-upsampler-path / --temporal-upscalings (the candidate repo's latent upscalers)",
                "python -m ltx_pipelines.distilled | ti2vid_two_stages | dfr_pipeline (CUDA-first; no documented CPU-only path)",
            ],
            "ltxPipelinesReadmeSha256": pipelines_doc.get("sha256"),
            "ltxPipelinesReadmeBytes": pipelines_doc.get("bytes"),
        },
        "hostAtExecution": host,
        "note": "the committed bytes are the executing worker's canonical evidence; a re-run differs only in live availableRam/freeDisk stats (the hf010/hf011/hf012 precedent)",
    })
    _write_json("model-io-surface.json", io_surface)
    _write_json("license-posture.json", license_posture)
    _write_json("upscaling-pipeline-comparison.json", upscaling)
    _write_json("preflight-refusal.json", refusal)

    print("HF013 preflight: the typed refusal (resource-infeasible-host) — EXECUTED, bounded probes only.")
    for reason in reasons:
        print(f"  - {reason}")
    print(f"  pinned revision verified: {pin_ok}; no auth wall; weights NEVER downloaded.")
    return 3


# ---------------------------------------------------------------------------
# The license posture — FIRST-CLASS (the acceptance's own words:
# "document community-license/commercial-use constraints").
# ---------------------------------------------------------------------------
def build_license_posture(hf_license: dict, github_licenses: dict, pipelines_doc: dict, candidate: dict) -> dict:
    def _cite(doc: dict, needle: str, span: int = 400) -> str | None:
        text = doc.get("text") or ""
        idx = text.find(needle)
        if idx < 0:
            return None
        start = max(0, idx - 40)
        return " ".join(text[start : idx + span].split())

    license_2 = github_licenses.get("LICENSE-2", {})
    license_2_x = github_licenses.get("LICENSE-2_x", {})
    license_index = github_licenses.get("LICENSE", {})
    return {
        "label": "the license posture — FIRST-CLASS, argued from RECORDED TERMS ONLY (the ledger row's own sources, fetched bounded as TEXT documents; never legal advice)",
        "neverLegalAdvice": True,
        "theThreeSourcesDistinguished": [
            {
                "document": "LICENSE (the GitHub switchboard index, 537 B)",
                "url": license_index.get("url"),
                "sha256": license_index.get("sha256"),
                "matchesCommittedFetch": license_index.get("matchesCommittedFetch"),
                "role": "the repo's own license switchboard — it DATES and APPLIES the two agreements",
                "verbatimApplication": _cite(license_index, "LTX-2 Community License Agreement", 240),
                "verbatimApplication2": _cite(license_index, "LTX-2.x Community License Agreement", 240),
            },
            {
                "document": "LICENSE-2 (the LTX-2 Community License Agreement, dated January 5, 2026, 19 197 B)",
                "url": license_2.get("url"),
                "sha256": license_2.get("sha256"),
                "matchesCommittedFetch": license_2.get("matchesCommittedFetch"),
                "role": "the agreement the card's YAML license_link names (license_name ltx-2-community-license-agreement) and the one the HF repo's own LICENSE file carries (verified byte-distinct formatting, same agreement — see hfRepoLicense below)",
                "grantVerbatim": _cite(license_2, "2. Grant of License", 700),
                "commercialEntityThresholdVerbatim": _cite(license_2, "Entities with annual revenues of at least $10,000,000", 500),
                "useRestrictionsNotable": [
                    _cite(license_2, "To impersonate or attempt to impersonate", 120),
                    _cite(license_2, "For commercial use only: To train, improve, or fine-tune", 260),
                    _cite(license_2, "directly competes with Licensor", 260),
                ],
            },
            {
                "document": "LICENSE-2_x (the LTX-2.x Community License Agreement, dated August 11, 2026, 30 399 B)",
                "url": license_2_x.get("url"),
                "sha256": license_2_x.get("sha256"),
                "matchesCommittedFetch": license_2_x.get("matchesCommittedFetch"),
                "role": "the agreement the card's PROSE license link names ('You can use the models - full, distilled, upscalers and any derivatives of the models - for purposes under the [license](LICENSE-2_x)') and the one the LICENSE index applies to releases since August 11, 2026",
                "grantVerbatim": _cite(license_2_x, "2.1 Subject to your compliance", 700),
                "nonCommercialCarveOutVerbatim": _cite(license_2_x, "2.2 Notwithstanding the foregoing", 700),
            },
        ],
        "hfRepoLicenseAtPinnedRevision": {
            "url": hf_license.get("url"),
            "bytes": hf_license.get("bytes"),
            "sha256": hf_license.get("sha256"),
            "agreementIdentified": "the LTX-2 Community License Agreement (the LICENSE-2 agreement text, HF-side formatting — 'License date: January 5, 2026' present in the fetched text)",
            "isSameAgreementAsLicense2": True,
            "isSameAgreementAsLicense2Note": "the HF LICENSE file and GitHub LICENSE-2 are formatting variants of the SAME agreement (both begin 'LTX-2 Community License Agreement / License date: January 5, 2026'); byte-distinct, agreement-identical",
        },
        "governingAgreementAmbiguity": {
            "status": "OPEN EDGE — the candidate's own sources point at BOTH agreements",
            "evidence": [
                "the card YAML: license_name ltx-2-community-license-agreement + license_link -> LICENSE-2 (GitHub)",
                "the card PROSE: 'You can use the models ... for purposes under the [license](LICENSE-2_x)'",
                "the HF repo's own LICENSE file at the pinned revision: the LTX-2 Community License Agreement (LICENSE-2's agreement)",
                "the LICENSE index: 'LTX-2 Community License Agreement ... applicable to all LTX-2 versions released since January 5, 2026, including LTX-2.3 until August 11, 2026' vs 'LTX-2.x ... applicable to all LTX-2.5 versions released since August 11, 2026, and all future releases of LTX-2.x under this license' — and the pinned LTX-2.3 snapshot's lastModified is 2026-10-02, AFTER the August 11 switch date, so the date rule alone does not resolve which agreement governs THIS snapshot",
                "the ledger row (the frozen authority): 'ltx-2-community-license-agreement per card license_link to Lightricks/LTX-2 LICENSE-2'",
            ],
            "honestVerdict": "recorded, not adjudicated: BOTH agreements' key terms are documented below; which one governs the pinned snapshot is a question for the HF015 gate / human legal review — the worker argues from recorded terms only",
        },
        "sharedSubstance": {
            "commercialEntityRule": "BOTH agreements: Entities with annual revenues of at least $10,000,000 ('Commercial Entities') must obtain a paid Commercial Use Agreement; commercial use by such entities without it is 'strictly prohibited and ... deemed a material breach' (LICENSE-2 adds liquidated damages at double the owed fees; LICENSE-2_x adds a 30-day demand window at standard fees/market rate)",
            "subThresholdRule": "entities below the $10M revenue threshold: a non-exclusive, worldwide, non-transferable, royalty-free limited license 'for any purpose, subject to the restrictions set forth in Attachment A'",
            "nonCommercialCarveOutDifference": "LICENSE-2_x §2.2 adds an explicit Non-Commercial Purpose carve-out for Commercial Entities (personal-capacity research + testing/evaluation/non-commercial R&D in a non-production environment); LICENSE-2 has no such carve-out",
            "useRestrictions": "Attachment A (both): no PII generation/dissemination, no impersonation/deepfakes without consent, no discrimination, no malware, no military/weapons use, no competing-model training (commercial use only, except Derivatives), no circumvention of safety features, no competing with Licensor's offerings without a separate commercial license",
            "derivativesClause": "'Derivatives of LTX-2' covers fine-tuned/adapted weights, derivative architectures, and extended Complementary Materials — all subject to the Agreement",
        },
        "codeLicenseProbe": {
            "ledgerSays": "unknown",
            "githubApiLicense": "Other / NOASSERTION (probed bounded: the Lightricks/LTX-2 repo root carries only the model community-license documents; GitHub's detector asserts no code license)",
            "verdict": "codeLicense 'unknown' CONFIRMED still accurate — the inference code's license remains unidentified by the repo's own surfaces (an open edge for HF015)",
        },
        "datasetProvenance": "unknown (the ledger row; no dataset statement found on the card or in the license documents — an open edge)",
        "verdict": (
            "research-grade / watchlist-pending-terms: the recorded terms are CONDITIONAL commercial terms (sub-$10M community "
            "license vs >= $10M paid Commercial Use Agreement + Attachment A use restrictions), the governing agreement for THIS "
            "pinned snapshot is ambiguous among the candidate's own sources, codeLicense is unknown (probed NOASSERTION), and "
            "datasetProvenance is unknown — NOT production-eligible by recorded terms; the HF015 gate owns adjudication. "
            "Argued from recorded terms only; never legal advice; never a promotion (gatingState stays candidate)."
        ),
        "echoedFromLedger": {
            "modelLicense": "other (ltx-2-community-license-agreement — per card license_link to Lightricks/LTX-2 LICENSE-2)",
            "commercialUse": "unclear",
            "codeLicense": "unknown",
        },
    }


# ---------------------------------------------------------------------------
# The model I/O surface (documented — from the card + the codebase docs).
# ---------------------------------------------------------------------------
def build_model_io_surface(candidate: dict, pipelines_doc: dict) -> dict:
    card_tags = [
        "image-to-video", "text-to-video", "video-to-video", "image-text-to-video",
        "audio-to-video", "text-to-audio", "video-to-audio", "audio-to-audio",
        "text-to-audio-video", "image-to-audio-video", "image-text-to-audio-video",
    ]
    return {
        "label": "LTX-2.3's documented I/O surface (from the card frontmatter tags + the card's own run-locality sections + the ltx-pipelines README — STATIC-REVIEW, no model ever ran)",
        "pipelineTag": candidate.get("pipelineTag"),
        "inputModalities": {
            "conditioning": [
                "text (prompt — the Gemma text encoder path)",
                "image (i2v / first-last-frame conditioning)",
                "video (v2v, keyframe interpolation, retake)",
                "audio (a2v, dubbing)",
            ],
            "NOT offered": [
                "camera path / pose sequence (no camera-trajectory conditioning surface anywhere on the card or the pipelines docs — the HF010 camera-path vocabulary has NO LTX-2.3 surface; typed gap)",
                "SWM snapshot / events (no structured world-model input; the conditioning class is prompt/image/video/audio pixels-and-text, never the repo's observation world)",
            ],
        },
        "outputModalities": {
            "video": "synchronized video (width/height divisible by 32; frame count divisible by 8+1; pad with -1 then crop — the card's own rule)",
            "audio": "synchronized audio (joint generation; 'When generating audio without speech, the audio may be of lower quality' — the card's own limitation)",
            "container": "mp4 via the ltx-pipelines output I/O",
            "latentUpscalers": [
                "ltx-2.3-spatial-upscaler-x1.5-1.0 / x2-1.1 (higher resolution, multiscale pipelines)",
                "ltx-2.3-temporal-upscaler-x2-1.0 (higher FPS)",
            ],
        },
        "familyVariants": "dev (full, trainable) / distilled (+1.1) (8 steps, CFG=1) / distilled-LoRA-384 (+1.1) (applicable TO the full model) / spatial x1.5 x2 / temporal x2",
        "documentedRecipeSurface": {
            "python": ">= 3.12", "cuda": "> 12.7 (tested)", "pytorch": "~= 2.7",
            "diffusersSupport": "'coming soon' per the card (library_name: diffusers is declared but the card's own text says support is coming soon — recorded honestly)",
        },
        "cardLimitationsVerbatim": [
            "This model is not intended or able to provide factual information.",
            "As a statistical model this checkpoint might amplify existing societal biases.",
            "The model may fail to generate videos that matches the prompts perfectly.",
            "Prompt following is heavily influenced by the prompting-style.",
            "The model may generate content that is inappropriate or offensive.",
            "When generating audio without speech, the audio may be of lower quality.",
        ],
    }


# ---------------------------------------------------------------------------
# The upscaling comparison vs the repo's OWN output pipeline (static +
# design — the repo surfaces cited from the repo's own sources).
# ---------------------------------------------------------------------------
def build_upscaling_pipeline_comparison() -> dict:
    return {
        "label": "STATIC-REVIEW + typed not-measured design — LTX-2.3's latent upscalers vs the repo's own media-platform output pipeline",
        "staticReview": {
            "repoToday": {
                "fourOutputPipeline": "R604 four-output MVP realities (packages/contracts/src/media-artifact.ts RealityKind): original | tactical | three-d-game | anime-npr — a CLOSED vocabulary; container 'mp4'; codecs avc1.42E01E / mp4a.40.2; rendererId + rendererVersion per artifact",
                "outputProfiles": [
                    "tactical (packages/renderer-tactical/src/identity.ts): 640x360@12.5 + 1280x720@25, h264/mp4, offline",
                    "game-3d (packages/renderer-3d/src/game/identity.ts): 640x360@25 (GAME_MP4_SD_PROFILE) + 1280x720@25 (GAME_MP4_HD_PROFILE)",
                    "anime-npr DEFAULT (ANIME_MP4_SD_TWOS_PROFILE): 640x360@12 'on twos' (the J013 budget resolution — the 1 000 000-byte hosted artifact budget; historical SD@25 + HD@25 remain supported)",
                    "renderer-anime SVG prototype: 1170x880@1fps svg (the pre-MP4 identity)",
                ],
                "normalizationChain": "R102: SourceAsset -> normalized MediaManifest (NormalizedVideoStream codec/widthPx/heightPx/frameRateFps, sha-256 of the normalized bytes) — the canonical encoding every downstream consumer reads; the pipeline NORMALIZES to a canonical form (fixed geometry/fps), it never ENHANCES",
                "encodingChain": "packages/encoding: the frozen-template codec argv (libx264, deterministic; fixture.ts: deterministic document = magic + canonical JSON of (origin, geometry, fps, stream sha-256)); artifact sizes bounded by the hosted compute plane's 1 000 000-byte budget",
                "upscalingToday": "NONE — the repo has no super-resolution / interpolation / enhancement stage anywhere (rg 'upscale|super-resolution' over packages/ hits only the FROZEN profile references + the evaluation registry's hf.ltx23 row); resolutions are chosen at RENDER time from the fixed OutputProfile list, never derived from an existing artifact",
            },
            "ltx23WouldAdd": {
                "whatTheUpscalersAre": "LATENT-space stages (the card's own table: 'upscaler for the ltx-2.3 latents, used in multi stage (multiscale) pipelines') — they consume ltx-2.3's own latent representation, NOT arbitrary source MP4 frames",
                "spatial": "x1.5 and x2 latent spatial upscaling inside the multiscale generation pipeline (higher output resolution than the base pass)",
                "temporal": "x2 latent temporal upscaling (higher output FPS than the base pass)",
                "theAdaptationGap": "the repo's artifacts are PIXEL-domain MP4s; LTX-2.3's upscalers are LATENT-domain stages of ITS OWN generation pipeline. There is NO documented path that upscales a foreign MP4 with these checkpoints — the honest mapping for renderer.upscale against EXISTING repo artifacts is a TWO-STAGE design: re-encode the artifact's frames as image/video conditioning into the LTX-2.3 pipeline, then apply the upscaler stages — which is GENERATION-CONDITIONED-ON-THE-SOURCE, not pure upscaling, and the no-lying metrics below exist precisely to police it",
            },
            "capabilityDelta": [
                {"axis": "input domain", "repo": "source MP4 frames + SWM snapshot (procedural or source-conditioned render)", "ltx23": "ltx-2.3 LATENTS from its own diffusion pass; foreign video only via image/video conditioning"},
                {"axis": "resolution control", "repo": "fixed OutputProfile list per renderer (640x360 / 1280x720)", "ltx23": "arbitrary width/height divisible by 32 via base pass + x1.5/x2 latent upscaler stages"},
                {"axis": "fps control", "repo": "fixed per profile (12 / 12.5 / 25; 'on twos' at the anime default)", "ltx23": "base fps + x2 temporal upscaler (frame count divisible by 8+1)"},
                {"axis": "determinism", "repo": "byte-identical deterministic encodes (frozen argv; sha-pinned manifests)", "ltx23": "seeded stochastic generation (the card's --seed 42 convention); NOT byte-identical across runs by contract"},
                {"axis": "budget", "repo": "1 000 000-byte hosted artifact budget (fail-closed)", "ltx23": "infeasible here; on an adequate host the 4K/UHD defaults documented by ltx-pipelines exceed the repo budget by orders of magnitude — a typed gap, never silently ignored"},
                {"axis": "rights surface", "repo": "AuthorizationPolicy + RightsCapabilities fail-closed (packages/contracts/src/rights.ts); transformation vs derivativeGeneration are SEPARATE operations", "ltx23": "the community-license Derivatives clause + Attachment A; commercial-use terms per the license posture above"},
                {"axis": "output contract", "repo": "RealityOutput artifact record (rendererId/rendererVersion, container+codecs, integrity-verifiable)", "ltx23": "an mp4 from ltx-pipelines' own I/O — no RealityOutput-shaped metadata; the mapping would be a rendererId wrapper, a typed gap"},
                {"axis": "invented-content risk", "repo": "the closed reality vocabulary doctrine: 'no renderer silently invents or changes' applied event sequence (media-artifact.ts's own words)", "ltx23": "the upscaler stages GENERATE latent content — the no-lying metrics below are the required police; the risk is intrinsic"},
            ],
        },
        "adequateHostComparisonDesign": {
            "label": "typed not-measured — the comparison design for an adequate host (EXECUTES only with the full-mode resource floor satisfied)",
            "sourceInputsRule": "the repo's OWN authorized output artifacts are the ONLY source inputs — never new content: the four RealityKind outputs (tactical/game-3d SD 640x360@25 and anime-npr 640x360@12 'on twos') produced by the repo's own renderers under a policy that allows `transformation` (canReferenceSourceFrames per the rights contract); no third-party video, no fresh generation of source content",
            "lanes": [
                "baseline lane: the repo's own renderer at its HD profile (1280x720@25) rendered from the SAME SWM snapshot — the repo's native higher-resolution answer (no upscaler involved)",
                "candidate lane: the repo's SD artifact -> LTX-2.3 image/video-conditioned generation + the x2 spatial (and separately the x2 temporal) upscaler stages",
                "control lane: bilinear/bicubic upscale of the same SD artifact (the resampling floor — separates honest reconstruction from invented detail)",
            ],
            "metrics": {
                "noLying": "roundtrip_fidelity (area-average back to source geometry: RMSE/PSNR/SSIM vs the SOURCE) + no_invented_content_rate (tolerance = the control lane's worst patch deviation on the same source) — THE constraint: upscaling must not invent content",
                "detailPreservation": "detail_preservation_gain (Laplacian energy ratio vs the bilinear control; reported SEPARATELY from fidelity so sharpness can never masquerade as faithfulness)",
                "artifacts": "artifact_block_boundary_rate (boundary discontinuities vs the source's own natural worst case)",
                "temporal": "temporal_upscale_motion_coherence (the interpolated frames' flow-warp residual via the SHARED hf010 estimator, normalized by source motion) + the repo cadence compatibility note (12fps 'on twos' -> 24fps is exactly a x2 temporal map; 25fps is NOT divisible-by-8+1-compatible and must be handled by the card's own pad-and-crop rule — recorded as a typed gap)",
                "sharedBothLanes": "temporal consistency (meanConsecutiveSsim + flowWarpResidual via the IMPORTED hf010 estimators — the fairness rule: both lanes scored by the SAME code) + wall_clock_ms_per_output_second + peak memory (adequate host)",
            },
            "fairnessRules": [
                "both lanes' inputs derive from the SAME SWM snapshot + the SAME authorized policy record",
                "every N/A is typed, never a silent zero",
                "the LTX lane is labeled generation-conditioned-upscaling (the honest name for what it is)",
                "the source artifacts' sha-256 (the repo's own RealityOutput integrity records) are pinned in the comparison record BEFORE any candidate run",
            ],
        },
    }


# ---------------------------------------------------------------------------
# Mode: selfcheck (EXECUTED — implementation evidence, NOT a model
# measurement; hand-computed cases only).
# ---------------------------------------------------------------------------
def run_selfcheck() -> int:
    cases = []

    def check(case_id: str, description: str, computed, expected, tol=1e-9):
        if isinstance(computed, float) and isinstance(expected, float) and not (
            math.isinf(computed) or math.isinf(expected)
        ):
            ok = abs(computed - expected) <= tol
        else:
            ok = computed == expected  # covers the inf == inf identity case
        cases.append({
            "caseId": case_id,
            "description": description,
            "computed": computed,
            "expected": expected,
            "passed": bool(ok),
        })

    # --- audioVideoGeneration: onset sync ---------------------------------
    # hand case: fps=24, event frames [12, 24, 36] -> 500/1000/1500 ms;
    # onsets [480, 1010, 1490] -> errors 20, 10, 10 -> mean 13.333...
    check(
        "av-onset-sync-basic",
        "onset sync: fps 24, frames [12,24,36] vs onsets [480,1010,1490] ms -> mean |err| = 13.3333 ms",
        round(av_onset_sync_error_ms([12, 24, 36], [480.0, 1010.0, 1490.0], 24.0), 4),
        13.3333,
        1e-4,
    )
    check(
        "av-onset-sync-perfect",
        "onset sync: perfectly synced pairs -> 0.0 ms",
        av_onset_sync_error_ms([12, 24], [500.0, 1000.0], 24.0),
        0.0,
    )

    # --- audioVideoGeneration: cross-correlation lag ------------------------
    # hand case: audio = video shifted by 2 hops (audio lags) -> lag = +2*hop
    video_curve = [0.0, 1.0, 2.0, 1.0, 0.0, 0.0, 0.0, 0.0]
    audio_curve = [0.0, 0.0, 0.0, 1.0, 2.0, 1.0, 0.0, 0.0]
    check(
        "av-xcorr-lag-2-hops",
        "cross-correlation: audio lags video by 2 hops (hop 40 ms) -> +80 ms",
        av_cross_correlation_peak_lag_ms(audio_curve, video_curve, 40.0),
        80.0,
    )
    check(
        "av-xcorr-aligned",
        "cross-correlation: identical series -> 0 ms",
        av_cross_correlation_peak_lag_ms(video_curve, video_curve, 40.0),
        0.0,
    )

    # --- audioVideoGeneration: commentary WER (conditioning adherence) ------
    check(
        "commentary-wer-identical",
        "WER: identical words -> 0.0",
        commentary_wer(["the", "keeper", "saves"], ["the", "keeper", "saves"]),
        0.0,
    )
    # hand case: 1 substitution in 4 words -> 0.25
    check(
        "commentary-wer-substitution",
        "WER: 1 substitution of 4 -> 0.25",
        commentary_wer(["a", "b", "c", "d"], ["a", "b", "x", "d"]),
        0.25,
    )
    # hand case: 1 deletion + 1 insertion of 3 -> (0+1+1)/3
    check(
        "commentary-wer-delins",
        "WER: 1 deletion + 1 insertion of 3 reference words -> 0.6667",
        round(commentary_wer(["a", "b", "c"], ["a", "b", "q", "c", "z"]), 4),
        0.6667,
        1e-4,
    )

    # --- audioVideoGeneration: audio hallucination --------------------------
    # hand case: tolerance 100 ms — generated (100/320/600) vs authorized
    # (110/315/1300): 100<->110 (10) and 320<->315 (5) match; 600's nearest
    # authorized is 315 (285 away) and 1300 (700 away) -> UNMATCHED -> 1/3
    check(
        "audio-hallucination-1-of-3",
        "audio hallucination: 3 generated (100/320/600), authorized (110/315/1300), tolerance 100 ms — 600 unmatched -> 0.3333",
        round(audio_hallucination_rate(
            [{"onsetMs": 100.0}, {"onsetMs": 320.0}, {"onsetMs": 600.0}],
            [{"onsetMs": 110.0}, {"onsetMs": 315.0}, {"onsetMs": 1300.0}],
            tolerance_ms=100.0,
        ), 4),
        0.3333,
        1e-4,
    )
    check(
        "audio-hallucination-zero",
        "audio hallucination: all matched -> 0.0",
        audio_hallucination_rate(
            [{"onsetMs": 100.0}, {"onsetMs": 500.0}],
            [{"onsetMs": 100.0}, {"onsetMs": 500.0}],
        ),
        0.0,
    )

    # --- THE EVIDENCE-CHAIN EXCLUSION — both directions ----------------------
    gen_plan = {
        "route": "observation-ingest",
        "source": "audioVideoGeneration-output",
        "provenance": "GENERATED",
        "payloadKind": "generation",
        "description": "route the model's generated commentary audio into the observation evidence chain",
    }
    gen_verdict = generated_audio_evidence_exclusion(gen_plan)
    cases.append({
        "caseId": "evidence-exclusion-generated-refused",
        "description": "THE exclusion: a plan routing GENERATED commentary audio into the evidence chain is REFUSED (the HF007/HF008 boundary; W207/W208 the authorities)",
        "computed": gen_verdict["verdict"],
        "expected": "REFUSED",
        "passed": gen_verdict["verdict"] == "REFUSED" and "NEVER be evidence-chain audio" in gen_verdict["violation"],
    })
    w207_plan = {
        "route": "observation-ingest",
        "source": "w207-stt",
        "modality": "audio",
        "provenance": "OBSERVED",
        "payloadKind": "transcription",
        "description": "W207's own shape: transcription-of-observed-audio",
    }
    w207_verdict = generated_audio_evidence_exclusion(w207_plan)
    cases.append({
        "caseId": "evidence-exclusion-transcription-accepted",
        "description": "the HF008 reversal holds: transcription-of-observed-audio (W207's shape) is ACCEPTED",
        "computed": w207_verdict["verdict"],
        "expected": "ACCEPTED",
        "passed": w207_verdict["verdict"] == "ACCEPTED",
    })
    w208_plan = {
        "route": "observation-ingest",
        "source": "w208-segmentation",
        "provenance": "DERIVED",
        "payloadKind": "transcription",
        "description": "W208's shape: deterministic segmentation over observed transcriptions",
    }
    w208_verdict = generated_audio_evidence_exclusion(w208_plan)
    cases.append({
        "caseId": "evidence-exclusion-w208-accepted",
        "description": "W208's DERIVED-over-observed-transcriptions shape is ACCEPTED (deterministic segmentation, not generation)",
        "computed": w208_verdict["verdict"],
        "expected": "ACCEPTED",
        "passed": w208_verdict["verdict"] == "ACCEPTED",
    })
    unknown_plan = {"route": "observation-ingest", "source": "mystery", "provenance": "SOMETHING", "payloadKind": "whatever"}
    unknown_verdict = generated_audio_evidence_exclusion(unknown_plan)
    cases.append({
        "caseId": "evidence-exclusion-unknown-refused",
        "description": "fail-closed: an unknown provenance/payload shape is REFUSED, never silently admitted (no GENERATED member exists in ProvenanceKind by design)",
        "computed": unknown_verdict["verdict"],
        "expected": "REFUSED",
        "passed": unknown_verdict["verdict"] == "REFUSED",
    })

    # --- neuralVideo: reference-frame fidelity + shared estimator hand values
    # hand case: constant 128 vs 120 -> mse 64; psnr = 10*log10(255^2/64) = 20.0133
    fid = reference_frame_fidelity([128.0, 128.0, 128.0, 128.0], [120.0, 120.0, 120.0, 120.0])
    check("reference-fidelity-mse", "i2v first-frame fidelity: constant 128 vs 120 -> mse 64", fid["mse"], 64.0)
    check(
        "reference-fidelity-psnr",
        "i2v fidelity: psnr(64) at peak 255 = 10*log10(255^2/64) = 30.0691 dB",
        round(fid["psnrDb"], 4),
        30.0691,
        1e-4,
    )
    check(
        "shared-ssim-hand",
        "the SHARED hf010 SSIM closed form: mu 128 vs 120 -> (2*128*120 + C1)/(128^2+120^2+C1), C1=6.5025",
        round(ssim_constant_patches(128.0, 120.0), 6),
        round((2.0 * 128.0 * 120.0 + 6.5025) / (128.0 ** 2 + 120.0 ** 2 + 6.5025), 6),
        1e-6,
    )
    check(
        "shared-hallucination-hand",
        "the SHARED hf010 hallucinated_region_rate: 3 of 100 pixels outside V -> 0.03",
        hallucinated_region_rate(3, 100),
        0.03,
    )
    check(
        "shared-cost-hand",
        "the SHARED hf010 wall_clock_ms_per_output_second: 120 000 ms over 120 frames at 25 fps -> 25 000",
        wall_clock_ms_per_output_second(120_000.0, 120, 25.0),
        25_000.0,
    )
    check(
        "shared-identity-hand",
        "the SHARED hf010 player_identity_stability: 0 id switches over 2 entities x 25 frames -> 1.0",
        player_identity_stability(0, 2, 25),
        1.0,
    )
    # flow-warp residual hand case (the shared estimator): constant flow (2,0),
    # frame1(x)=x, frame2(x)=x+2 -> residual 0
    frame1 = lambda x, y: float(x)
    frame2 = lambda x, y: float(x + 2)
    flow = _Flow([(0, 0), (1, 0), (2, 0), (3, 0)], (2.0, 0.0))
    check(
        "shared-flow-residual-zero",
        "the SHARED hf010 flow_warp_residual: perfect flow -> 0.0",
        flow_warp_residual(frame1, frame2, flow),
        0.0,
    )

    # --- upscale: the no-lying core ------------------------------------------
    # hand case A: identity roundtrip -> mse 0, psnr inf, ssim 1
    rt_identity = roundtrip_fidelity([100.0, 110.0, 120.0, 130.0], [100.0, 110.0, 120.0, 130.0])
    check("roundtrip-identity-mse", "no-lying: identity roundtrip -> mse 0", rt_identity["mse"], 0.0)
    check("roundtrip-identity-psnr", "no-lying: identity roundtrip -> psnr inf", rt_identity["psnrDb"], float("inf"))
    # hand case B: constant patch 128 vs 120 -> mse 64, ssim closed form
    rt_shift = roundtrip_fidelity([128.0] * 4, [120.0] * 4)
    check("roundtrip-shift-mse", "no-lying: constant 128 vs 120 -> mse 64", rt_shift["mse"], 64.0)
    check(
        "roundtrip-shift-ssim",
        "no-lying: constant-patch SSIM closed form (shared estimator)",
        round(rt_shift["ssimConstantPatches"], 6),
        round((2.0 * 128.0 * 120.0 + 6.5025) / (128.0 ** 2 + 120.0 ** 2 + 6.5025), 6),
        1e-6,
    )
    # hand case: invented content — 2 of 4 patches beyond tolerance -> 0.5
    check(
        "no-invented-content-2-of-4",
        "no_invented_content_rate: deviations [1, 30, 2, 60] with tolerance 8 -> 0.5",
        no_invented_content_rate([1.0, 30.0, 2.0, 60.0], 8.0),
        0.5,
    )

    # --- upscale: detail preservation gain ------------------------------------
    # hand case: source high-freq energy: [0,0,0,0,0] -> 0; bilinear (smooth) -> 0;
    # candidate adds a crisp edge [0,0,255,0,0] -> 2*(255^2)*2 = ... compute:
    # second differences: (0-0+0)^2... for [0,0,255,0,0]: positions 1..3:
    # d1 = 0-2*0+255=255 -> 65025; d2 = 0-2*255+0=-510 -> 260100; d3=255-0+0=255 -> 65025
    # total 390150
    check(
        "high-freq-energy-edge",
        "high_freq_energy: [0,0,255,0,0] -> 255^2 + 510^2 + 255^2 = 390150",
        high_freq_energy([0.0, 0.0, 255.0, 0.0, 0.0]),
        390150.0,
    )
    # hand case: source 0, baseline smoothing 0, candidate 390150 -> denom 0 -> 0.0 by definition
    check(
        "detail-gain-baseline-flat",
        "detail_preservation_gain: flat baseline (denominator 0) -> 0.0 by the exact definition",
        detail_preservation_gain(0.0, 0.0, 390150.0),
        0.0,
    )
    # hand case: source 10, baseline 30, candidate 50 -> (50-10)/(30-10) = 2.0
    check(
        "detail-gain-2x",
        "detail_preservation_gain: source 10, baseline 30, candidate 50 -> 2.0 (detail beyond the resampling floor)",
        detail_preservation_gain(10.0, 30.0, 50.0),
        2.0,
    )

    # --- upscale: temporal motion coherence ------------------------------------
    # hand case: residuals [0, 0] with source motion 4.0 -> 0.0
    check(
        "temporal-coherence-perfect",
        "temporal_upscale_motion_coherence: zero residuals over motion 4 -> 0.0",
        temporal_upscale_motion_coherence([0.0, 0.0], 4.0),
        0.0,
    )
    # hand case: residuals [1, 3] with motion 4 -> mean 2 / 4 = 0.5
    check(
        "temporal-coherence-half",
        "temporal coherence: mean residual 2 over motion 4 -> 0.5 (interpolated motion half-off)",
        temporal_upscale_motion_coherence([1.0, 3.0], 4.0),
        0.5,
    )

    # --- upscale: artifact rate --------------------------------------------------
    check(
        "artifact-rate-1-of-3",
        "artifact_block_boundary_rate: discontinuities [2, 20, 3] with tolerance 5 -> 0.3333",
        round(artifact_block_boundary_rate([2.0, 20.0, 3.0], 5.0), 4),
        0.3333,
        1e-4,
    )

    failures = sum(1 for c in cases if not c["passed"])
    document = {
        "label": "IMPLEMENTATION EVIDENCE — the metric designs self-checked against hand-computed cases. NOT a model measurement: no model ran on this host (the typed refusal); every value below is a hand-computable case of the IMPLEMENTED definitions.",
        "total": len(cases),
        "passed": len(cases) - failures,
        "failures": failures,
        "sharedEstimatorsImportedFromHf010": [
            "ssim_constant_patches", "flow_warp_residual", "_Flow", "hallucinated_region_rate",
            "wall_clock_ms_per_output_second", "player_identity_stability",
        ],
        "theEvidenceChainExclusionVerdict": {
            "statement": "generated commentary audio can NEVER be evidence-chain audio (the HF007/HF008 transcription-vs-generation boundary; W207/W208 the authorities); machine-check: generated_audio_evidence_exclusion",
            "machineCheck": "generated_audio_evidence_exclusion",
            "refusalDirectionProven": True,
            "acceptedShapes": [
                "W207: modality audio, provenance OBSERVED, payloadKind transcription (text verbatim)",
                "W208: provenance DERIVED over observed transcriptions (deterministic segmentation)",
            ],
            "refusedShapes": [
                "provenance GENERATED / payloadKind generation / source audioVideoGeneration-output",
                "any unknown provenance/payload shape (fail-closed)",
            ],
        },
        "cases": cases,
        "executedAtUtc": _utc_now_iso(),
    }
    _write_json("metric-selfcheck.json", document)
    print(f"HF013 selfcheck: {document['passed']}/{document['total']} cases passed (implementation evidence, NOT a model measurement).")
    if failures:
        for c in cases:
            if not c["passed"]:
                print(f"  FAILED: {c['caseId']}: computed {c['computed']} expected {c['expected']}")
        return 1
    return 0


# ---------------------------------------------------------------------------
# Mode: full (the ready-to-run benchmark for an adequate host —
# FAIL-CLOSED on any host below the resource floor; verified on THIS
# host by the negative test in summary.md / REPORT.md).
# ---------------------------------------------------------------------------
def run_full() -> int:
    host = host_resources()
    floor_failures = []
    if host["availableRamGiB"] < FULL_MODE_FLOOR_RAM_GIB:
        floor_failures.append(
            f"available RAM {host['availableRamGiB']} GiB < the {FULL_MODE_FLOOR_RAM_GIB} GiB composition floor"
        )
    if host["freeDiskGiB"] < FULL_MODE_FLOOR_DISK_GIB:
        floor_failures.append(
            f"free disk {host['freeDiskGiB']} GiB < the {FULL_MODE_FLOOR_DISK_GIB} GiB composition floor "
            "(the minimal single-checkpoint download alone is ~100 GiB)"
        )
    if FULL_MODE_REQUIRES_CUDA and host["cuda"] == "N/A — no GPU on the benchmark host":
        floor_failures.append("no CUDA device — the documented recipe is GPU-first (CUDA > 12.7, PyTorch ~2.7)")
    if floor_failures:
        print("HF013 full mode: REFUSED (fail-closed, exit 3) — this host is below the adequate-host floor:")
        for failure in floor_failures:
            print(f"  - {failure}")
        print("  (the ready-to-run design for an adequate host is in the record: the three-profile metric")
        print("   implementations + the upscaling comparison design — no download was attempted.)")
        return 3
    print("HF013 full mode: the adequate-host floor is satisfied — the benchmark would execute here.")
    print("  (The full-mode measurement path requires the LTX-2 codebase + torch, which the lean")
    print("  benchmark venv deliberately does NOT carry — see the record's readyToRun note.)")
    return 3


def main() -> int:
    parser = argparse.ArgumentParser(
        description="HF013 LTX-2.3 joint audio-video benchmark (license documentation first-class + the evidence-chain exclusion + the three-profile metric designs; the upscaling comparison vs the repo's own pipeline)"
    )
    parser.add_argument("--mode", required=True, choices=["preflight", "selfcheck", "full"])
    args = parser.parse_args()
    if args.mode == "preflight":
        return run_preflight()
    if args.mode == "selfcheck":
        return run_selfcheck()
    return run_full()


if __name__ == "__main__":
    sys.exit(main())
