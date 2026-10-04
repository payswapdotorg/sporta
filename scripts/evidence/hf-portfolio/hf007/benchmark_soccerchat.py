#!/usr/bin/env python3
"""
HF007 — the SoccerChat event/commentary-reasoning benchmark (Worker 64-e,
flight 5).

Runs the HF002-ledger candidate `SimulaMet/SoccerChat-qwen2-vl-7b`
(model apache-2.0, code apache-2.0, commercialUse yes; task profile
`football.eventReasoning`, FROZEN) at the ledger-pinned revision
29871536004c0ac788af09cbb87969ab9f6e1410 on the repo's authorized media,
following the HF003/HF006 (EXECUTED) and HF004/HF009 (typed-refusal)
evidence-tree conventions.

WHAT THIS FLIGHT ACTUALLY DELIVERED (the honest state, recorded by the
EXECUTED `--mode preflight` run on this host):

  * THE MODEL IS RESOURCE-INFEASIBLE on this host — arithmetically, twice
    over (disk AND RAM). The candidate is a LoRA (PEFT) adapter over the
    Qwen/Qwen2-VL-7B-Instruct base:
      - the ADAPTER is small (40,422,208 B; sha256
        4c3b45687dd15e744f84874ef06e365e96d1d4e308f89f001cf5173a75946e47,
        LOCALLY VERIFIED this flight against the hub LFS oid — downloaded
        and hashed inside the bounded preflight probe);
      - the BASE is 16,582,831,200 B of bf16 safetensors across 5 shards
        (hub-reported LFS oids recorded) — vs a 4,041.6 MiB-RAM /
        ~0.4 GB-free-disk host. Infeasible by ~4.2x on TOTAL RAM (bf16
        working set ~16.6 GiB + vision-tower activations + KV cache) and
        ~38x on free disk. Even the card's own Colab recipe quantizes to
        4-bit nf4 (~4.7 GiB weights) on a 16 GB T4 — still above this
        host's TOTAL RAM, and bitsandbytes 4-bit requires CUDA (no GPU
        here; GPU honestly N/A).
  * The SoccerChat EVAL CORPUS is a second, independent wall: the
    `SimulaMet/SoccerChat` dataset is auto-gated behind the SoccerNet NDA
    (the card's own extra_gated_heading: "SoccerNet NDA Required for
    Video Access"); anonymous access to the validation parquet 401s. The
    held-out eval split therefore cannot be fetched in this sandbox, on
    ANY hardware — an operator NDA action, exactly the HF009 precedent.
  * Therefore the FULL mode is READY-TO-RUN but NOT EXECUTED: every
    event-extraction / hallucination-rate / provenance / latency / memory
    number is typed not-measured and this script fail-closes rather than
    fabricating any of them.

The benchmark media in FULL mode is the repo's own authorized set (the
two sha-pinned gate fixtures + the SPR corpus clips under the repo's R606
analysis-scope declaration) — NOT the NDA-gated SoccerChat videos. No
event ground truth exists for ANY of them (the HF006 repo-wide search
verdict: spatial-disc annotations only, event candidates are model
outputs, SWM timelines are derived) — so hallucination-rate is measured
only where a ground-truth timeline is SUPPLIED by the operator, and is
otherwise typed.

Metrics contract (what the FULL mode measures when it runs, and the
EXACT definitions — all implemented, none executed this flight):

  * EVENT-EXTRACTION (structural, unscored without GT): the model's
    free-text response is parsed by `parse_response_events` (a
    deterministic event-line parser: `<type> @ <seconds>s — <text>` plus
    the SoccerChat response schema's plain-sentence fallback). The repo
    contract mapping (which fields map onto W209/R207 candidates and the
    frozen FOOTBALL_EVENT_TYPES taxonomy) is the machine-checked
    `contract_compatibility.ts` deliverable, not a run claim.
  * HALLUCINATION RATE (event-existence verification), per media M with
    a supplied ground-truth event timeline GT(M):
        matched = greedy one-to-one matching, confidence-descending,
                  same normalized event type AND |t_pred − t_gt| <= tol
                  (tol swept 1 s / 2 s / 5 s)
        hallucinationRate = |{e in E_pred : unmatched(e)}| / |E_pred|
    (recall = |matched| / |GT| is reported alongside). Zero GT rows =>
    the metric is typed not-measured, never zero.
  * PROVENANCE TRACEABILITY, per emitted event e:
        traceable(e) = timestamp present AND parseable AND inside the
                       media duration AND evidence window non-empty
        provenanceTraceability = traceable / |E_pred|
    (the model emits NO observation ids — the repo-side evidence-chain
    contract (EventEnvelope.evidence.observationIds, min 1) is met only
    by an adapter synthesizing frame-window ids; that gap is recorded,
    not laundered).
  * LATENCY: per-inference CPU wall-clock, median + nearest-rank p95
    (rank = ceil(p/100 * n)) — the repo convention; labeled CPU
    wall-clock. GPU N/A honestly.
  * MEMORY: GPU N/A; process RSS via /proc/self/status VmRSS + ru_maxrss.
  * DETERMINISM: repeated identical requests under the pinned
    generation_config (do_sample true, temperature 0.01, top_k 1,
    top_p 0.001 — near-greedy); the serialized parsed-event timeline is
    compared across repeats (exact-match verdict).

Usage (the EXECUTED preflight — the typed refusal):
  /home/z/hf-bench-5/bin/python benchmark_soccerchat.py \
      --repo-root /home/z/sporta --bench-root /home/z/hf-bench-5 \
      --mode preflight
  (exit code 3 = the typed refusal, results/preflight-refusal.json +
  results/load-analysis.json + results/model-output-schema.json written)

Usage (the ready-to-run FULL mode — requires >= 32 GB RAM + >= 24 GB free
disk; downloads at the pinned revisions with local sha verification):
  /home/z/hf-bench-5/bin/python benchmark_soccerchat.py \
      --repo-root /home/z/sporta --bench-root /home/z/hf-bench-5 \
      --mode full [--repeats 3] \
      [--ground-truth path/to/events.json]   # optional: unlocks
                                              # hallucination-rate scoring
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import resource
import subprocess
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

# --- the ledger pins (scripts/evidence/hf-portfolio/hf007 conventions) ------

SOCCERCHAT_REPO_ID = "SimulaMet/SoccerChat-qwen2-vl-7b"
SOCCERCHAT_REVISION = "29871536004c0ac788af09cbb87969ab9f6e1410"  # ledger row

# The adapter blob: size + sha256 LOCALLY VERIFIED this flight (the download
# probe below re-verifies against the hub LFS oid on every preflight run).
ADAPTER_FILE = "adapter_model.safetensors"
ADAPTER_BYTES = 40_422_208
ADAPTER_SHA256 = (
    "4c3b45687dd15e744f84874ef06e365e96d1d4e308f89f001cf5173a75946e47"
)

# The base model (adapter_config.json: base_model_name_or_path — the adapter
# does NOT pin a base revision; sft_args.json records model_revision
# "master"). This flight pins the probed main sha and records the
# unpinned-base caveat honestly.
BASE_REPO_ID = "Qwen/Qwen2-VL-7B-Instruct"
BASE_PROBED_REVISION = "eed13092ef92e448dd6875b2a00151bd3f7db0ac"
BASE_SHARDS = [
    ("model-00001-of-00005.safetensors", 3_898_649_896,
     "eab4f4dc1abf860794c98ce3759b4ace1059fc0fc041ede76b88988b3557c132"),
    ("model-00002-of-00005.safetensors", 3_864_726_320,
     "0546b7cd070ff239de0f61a28770de6a0ac517ad313071e151653e38911ffb25"),
    ("model-00003-of-00005.safetensors", 3_864_726_424,
     "11368ea1e9c0039ca54012a74ac32d543a9e9d980b2d0ad7e93af0341ace1fe6"),
    ("model-00004-of-00005.safetensors", 3_864_733_680,
     "381e110d74db594cc24956af0e74a01ae02104497113a78926990c5bd1f395f6"),
    ("model-00005-of-00005.safetensors", 1_089_994_880,
     "e76ec4dc2e7c0dcbe3432e58fae08e62204a2ef2323069d85c8fa0affb87332a"),
]
BASE_TOTAL_BYTES = sum(size for _, size, _ in BASE_SHARDS)

# The LoRA geometry (adapter_config.json @ the pinned revision).
ADAPTER_LORA = {
    "peft_type": "LORA",
    "r": 8,
    "lora_alpha": 32,
    "lora_dropout": 0.05,
    "target_modules": "^(model)(?!.*(lm_head|output|emb|wte|shared)).*",
    "task_type": "CAUSAL_LM",
    "bias": "none",
}

# The base architecture (config.json @ both the pinned adapter repo and the
# probed base repo — identical digests).
BASE_ARCHITECTURE = {
    "architectures": ["Qwen2VLForConditionalGeneration"],
    "num_hidden_layers": 28,
    "hidden_size": 3584,
    "intermediate_size": 18944,
    "num_attention_heads": 28,
    "num_key_value_heads": 4,
    "vocab_size": 152064,
    "torch_dtype": "bfloat16",
    "vision_config": {
        "depth": 32, "embed_dim": 1280, "num_heads": 16,
        "patch_size": 14, "spatial_merge_size": 2,
        "temporal_patch_size": 2, "hidden_size": 3584,
    },
    "rope_scaling": {"type": "mrope", "mrope_section": [16, 24, 24]},
}

# The model's own generation config (generation_config.json @ the pinned
# revision) — near-greedy decoding, the determinism anchor of FULL mode.
GENERATION_CONFIG = {
    "do_sample": True, "temperature": 0.01, "top_k": 1, "top_p": 0.001,
    "max_new_tokens": 2048,
}

# The card's own inference regime (README usage block): 24 sampled frames,
# 100352 max video pixels, ms-swift PtEngine with the LoRA adapter over the
# base — the FULL mode reproduces this regime via transformers + peft.
CARD_INFERENCE_REGIME = {
    "frames": 24, "max_video_pixels": 100352,
    "engine": "ms-swift PtEngine (card) / transformers+peft (this script)",
    "quantization": "4-bit nf4 bnb on a free T4 (the card's own Colab recipe "
                    "— evidence even the authors need quantization; fp16 "
                    "paper results)",
    "max_tokens": 512, "temperature": 0.3, "top_k": 20, "top_p": 0.7,
}

# The SoccerChat dataset (the eval corpus): auto-gated behind the SoccerNet
# NDA (dataset card extra_gated_heading, fetched this flight).
DATASET_REPO_ID = "SimulaMet/SoccerChat"
DATASET_GATING = {
    "gated": "auto",
    "extraGatedHeading": "SoccerNet NDA Required for Video Access",
    "annotationsLicense": (
        "MIT (dataset card: 'Annotations and metadata in SoccerChat are "
        "released under MIT licence')"
    ),
    "videoLicense": (
        "NOT MIT — SoccerNet NDA terms; 'may not be redistributed, publicly "
        "hosted, reconstructed, or used for commercial purposes'"
    ),
    "validationParquetAnonymousAccess": "401 Unauthorized (probed this flight)",
    "trainExamples": 85_220, "validationExamples": 4_625,
    "videosBytesApprox": 48_000_000_000,
}

# The dataset's documented annotation schema (dataset card dataset_info
# features — the SOURCE-VERIFIED SoccerChat event/output schema):
SOCCERCHAT_SCHEMA = {
    "video": "string (previewable clip path)",
    "query": "string (natural-language question)",
    "response": "string (natural-language answer — the MODEL's output modality)",
    "events": "list of one or more SoccerNet event types (can be empty if "
              "unannotated)",
    "path": "string (relative path inside videos/)",
}

# --- repo media pins (the FULL-mode authorized benchmark set) ---------------

SYNTHETIC_FIXTURE_MEDIA = (
    "packages/technology-registry/fixtures/media/"
    "synthetic-diagnostic-01-players-and-ball.mp4"
)
SYNTHETIC_FIXTURE_SHA256 = (
    "e75abe1441fe2e6680b2aad5e7d2e66a5bcd21ab4b91928e25181f90a37f7f76"
)

FX001_NORMALIZED_MEDIA = "packages/real-to-swm/fixtures/media/fx-001-normalized.mp4"
FX001_NORMALIZED_SHA256 = (
    "4e2f3e3d9df1eb4b0403a442c2371821c684ab8880b4544099b2d5d962543ff7"
)

SPR_CORPUS_BYTES = "scripts/evidence/spr-corpus-bytes"
SPR_CLIPS = {
    "sprclip-b8-inplay-original": ("b8p3.mp4", 47.624),
    "sprclip-b1-wide-broadcast": ("clip-b1-wide-broadcast.mp4", 30.070),
}
SPR_AUTHORIZATION_NOTE = (
    "authorized for analysis by the repo's own R606 registration declaration "
    "(analysis/transformation/derivativeGeneration/storage, repo private — "
    "scripts/evidence/spr-corpus-bytes/README.md)"
)

RESOURCE_CAVEAT = (
    "GPU memory: N/A (no GPU on the benchmark host); process RSS recorded "
    "instead; latency is CPU wall-clock, labeled as such"
)

# The SoccerNet event vocabulary observed in the dataset's own video-path
# naming (the card's example: MultipleEvents/
# 100037_Shotsontarget--Balloutofplay.mp4) — the vocabulary the dataset's
# `events` field draws from (SoccerNet Challenge classes).
SOCCERNET_EVENT_EXAMPLE = "Shotsontarget--Balloutofplay"


# --- utilities ----------------------------------------------------------------

def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def vm_rss_mib() -> float:
    try:
        for line in Path("/proc/self/status").read_text().splitlines():
            if line.startswith("VmRSS:"):
                return float(line.split()[1]) / 1024.0
    except OSError:
        pass
    return float("nan")


def total_ram_mib() -> float:
    with open("/proc/meminfo", encoding="utf-8") as fh:
        for line in fh:
            if line.startswith("MemTotal:"):
                return float(line.split()[1]) / 1024.0
    return float("nan")


def disk_free_bytes(path: Path) -> int:
    st = os.statvfs(path)
    return st.f_bavail * st.f_frsize


def nearest_rank_percentile(values: list[float], p: float) -> float:
    if not values:
        return float("nan")
    ordered = sorted(values)
    rank = max(1, min(len(ordered), int(__import__("math").ceil(p / 100.0 * len(ordered)))))
    return ordered[rank - 1]


def http_get(url: str, timeout: int = 60) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "hf007-preflight-probe/0.1"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def hub_bounded_probe(repo_id: str, revision: str, filename: str,
                      max_bytes: int = 1 << 20) -> dict:
    """A bounded reachability probe — NEVER a full infeasible download.

    Sizes/shas come from the tree API (metadata only); at most `max_bytes`
    of one small file is fetched for reachability, per the brief.
    """
    url = (f"https://huggingface.co/{repo_id}/resolve/main/{filename}"
           f"?revision={revision}")
    try:
        # metadata first (the tree API carries LFS oid = sha256)
        tree_url = (f"https://huggingface.co/api/models/{repo_id}/tree/main"
                    f"?recursive=true&revision={revision}")
        tree = json.loads(http_get(tree_url, timeout=30))
        entry = next((f for f in tree if f["path"] == filename), None)
        lfs = (entry or {}).get("lfs") or {}
        expected_sha = lfs.get("oid")
        expected_size = lfs.get("size") or (entry or {}).get("size")
    except Exception as err:  # noqa: BLE001 - recorded, never fatal
        return {
            "repoId": repo_id, "revision": revision, "file": filename,
            "verdict": "metadata-error", "error": f"{type(err).__name__}: {err}",
        }
    if entry is None:
        return {
            "repoId": repo_id, "revision": revision, "file": filename,
            "verdict": "absent-from-tree",
        }
    # bounded reachability fetch (at most max_bytes — the adapter is 38.5 MiB
    # which stays under the 1 MiB bound? NO — the adapter probe is special-
    # cased below with its own full-download sha verification)
    try:
        if (expected_size or 0) > max_bytes:
            req = urllib.request.Request(url, headers={
                "User-Agent": "hf007-preflight-probe/0.1", "Range": "bytes=0-1023"})
            with urllib.request.urlopen(req, timeout=30) as resp:
                resp.read(1024)
            reachability = "reachable (range probe, first 1 KiB)"
        else:
            blob = http_get(url, timeout=60)
            reachability = f"reachable ({len(blob)} B fetched, sha256-verified)" \
                if hashlib.sha256(blob).hexdigest() == expected_sha else \
                "reachable (sha MISMATCH — drift!)"
        return {
            "repoId": repo_id, "revision": revision, "file": filename,
            "verdict": "reachable", "sizeBytes": expected_size,
            "sha256HubReported": expected_sha, "reachability": reachability,
        }
    except Exception as err:  # noqa: BLE001 - recorded, never fatal
        return {
            "repoId": repo_id, "revision": revision, "file": filename,
            "verdict": f"unreachable ({type(err).__name__}: {str(err)[:160]})",
            "sizeBytes": expected_size, "sha256HubReported": expected_sha,
        }


def dataset_gating_probe() -> dict:
    """Probe the SoccerChat dataset's NDA gate (metadata + one 401 proof)."""
    out: dict = {"repoId": DATASET_REPO_ID}
    try:
        info = json.loads(http_get(
            f"https://huggingface.co/api/datasets/{DATASET_REPO_ID}", timeout=30))
        out["gated"] = info.get("gated")
        out["private"] = info.get("private")
    except Exception as err:  # noqa: BLE001
        out["apiError"] = f"{type(err).__name__}: {str(err)[:160]}"
    try:
        http_get(f"https://huggingface.co/datasets/{DATASET_REPO_ID}/resolve/"
                 "main/data/validation-00000-of-00001.parquet", timeout=30)
        out["validationParquetAnonymous"] = "reachable (unexpected — re-review)"
    except urllib.error.HTTPError as err:
        out["validationParquetAnonymous"] = f"HTTP {err.code} {err.reason}"
    except Exception as err:  # noqa: BLE001
        out["validationParquetAnonymous"] = f"{type(err).__name__}: {str(err)[:120]}"
    return out


# --- the metric implementations (FULL mode; definitions stated exactly) ------

EVENT_LINE_RE = re.compile(
    r"^(?P<type>[A-Za-z][A-Za-z0-9 _/-]*?)\s*@\s*(?P<t>\d+(?:\.\d+)?)\s*s"
    r"\s*(?:[-—:]\s*(?P<text>.*))?$"
)

# The repo's frozen canonical vocabulary (packages/contracts/src/football.ts
# FOOTBALL_EVENT_TYPES) — the normalization target for parsed model events.
FOOTBALL_EVENT_TYPES = [
    "kickoff", "pass", "carry", "tackle", "shot", "save", "goal", "card",
    "substitution", "offside", "restart", "possession-change",
    "injury-pause", "referee-decision", "replay-cue", "commentary-emphasis",
]


def normalize_event_type(raw: str) -> str:
    """SoccerNet-style label -> kebab-case; kept iff canonical or recorded
    as unmapped (the honest W401 'unmapped eventType' path — never forced)."""
    kebab = re.sub(r"[^a-z0-9]+", "-", raw.strip().lower()).strip("-")
    return kebab if kebab in FOOTBALL_EVENT_TYPES else f"unmapped:{kebab}"


def parse_response_events(response_text: str,
                          media_duration_s: float) -> list[dict]:
    """The OUTPUT ADAPTER: SoccerChat's free-text response -> typed event
    candidates (the W209/R207 candidate shapes this benchmark scores).

    The model card documents NO structured event output — the model emits
    natural language. This parser accepts the two honest shapes:
      1. structured event lines:  `<type> @ <seconds>s — <text>`
      2. (fallback, flagged) plain sentences carrying no parseable event —
         emitted as a single `unparsed-response` row so nothing is silently
         dropped (the repo's never-drop-text doctrine).
    Every parsed event carries its parse provenance (which shape matched).
    """
    events: list[dict] = []
    matched_any = False
    for line in response_text.splitlines():
        stripped = line.strip().lstrip("-*").strip()
        if not stripped:
            continue
        m = EVENT_LINE_RE.match(stripped)
        if m:
            matched_any = True
            t = float(m.group("t"))
            events.append({
                "eventType": normalize_event_type(m.group("type")),
                "eventTimeS": t,
                "text": (m.group("text") or "").strip(),
                "withinMediaDuration": 0.0 <= t <= media_duration_s,
                "parseProvenance": "structured-event-line",
            })
    if not matched_any and response_text.strip():
        events.append({
            "eventType": "unparsed-response",
            "eventTimeS": None,
            "text": response_text.strip(),
            "withinMediaDuration": None,
            "parseProvenance": "free-text-fallback (no structured event line "
                               "parseable — the model card emits natural "
                               "language; a production adapter must add "
                               "structured output, a typed gap)",
        })
    return events


def match_events_greedy(pred: list[dict], gt: list[dict],
                        tol_s: float) -> dict:
    """The HF006-stated matching rule, implemented: same normalized event
    type AND |t_pred − t_gt| <= tol; greedy one-to-one, confidence-
    descending (ties: earliest prediction); one GT row matches at most one
    prediction."""
    used_gt: set[int] = set()
    matches: list[dict] = []
    preds_sorted = sorted(
        [e for e in pred if e.get("eventTimeS") is not None],
        key=lambda e: (-(e.get("confidence") or 1.0), e["eventTimeS"]))
    for p in preds_sorted:
        best_j, best_dt = None, None
        for j, g in enumerate(gt):
            if j in used_gt or g["eventType"] != p["eventType"]:
                continue
            dt = abs((p["eventTimeS"] or 0.0) - g["eventTimeS"])
            if dt <= tol_s and (best_dt is None or dt < best_dt):
                best_j, best_dt = j, dt
        if best_j is not None:
            used_gt.add(best_j)
            matches.append({"pred": p, "gt": gt[best_j], "deltaS": best_dt})
    return {"matches": matches, "unmatchedPred": len(preds_sorted) - len(matches),
            "unmatchedGt": len(gt) - len(matches)}


def hallucination_rate(pred: list[dict], gt: list[dict],
                       tol_s: float) -> dict:
    """EXACT DEFINITION (typed not-measured this flight — no GT, no run):
    hallucinationRate = |{e in E_pred : unmatched(e)}| / |E_pred| over the
    parsed structured events; recall = |matched| / |GT| reported alongside.
    Zero GT rows => not-measured (never zero, never fabricated)."""
    typed = [e for e in pred if e.get("parseProvenance") == "structured-event-line"]
    res = match_events_greedy(pred, gt, tol_s)
    n_pred = len(typed)
    if n_pred == 0:
        return {"status": "not-measured (no structured parsed events)"}
    return {
        "toleranceS": tol_s,
        "emittedEvents": n_pred,
        "matched": len(res["matches"]),
        "hallucinationRate": res["unmatchedPred"] / n_pred,
        "recall": (len(res["matches"]) / len(gt)) if gt else None,
        "status": "measured",
    }


def provenance_traceability(pred: list[dict], media_duration_s: float) -> dict:
    """EXACT DEFINITION (typed not-measured this flight): per emitted event,
    traceable = timestamp present AND parseable AND inside media duration
    AND (adapter-supplied) evidence window non-empty. The model emits NO
    observation ids — the repo's EventEnvelope.evidence contract needs an
    adapter; that gap is surfaced, never laundered."""
    structured = [e for e in pred if e.get("parseProvenance") == "structured-event-line"]
    n = len(structured)
    if n == 0:
        return {"status": "not-measured (no structured parsed events)"}
    traceable = sum(
        1 for e in structured
        if e.get("eventTimeS") is not None and e.get("withinMediaDuration")
    )
    return {
        "emittedEvents": n,
        "traceable": traceable,
        "provenanceTraceability": traceable / n,
        "evidenceChainGap": (
            "the model output carries no observation ids — the repo contract "
            "requires EventEnvelope.evidence.observationIds (min 1); an "
            "adapter must synthesize frame-window ids (typed gap, recorded)"
        ),
        "status": "measured",
    }


# --- the preflight (EXECUTED; the typed refusal + the load analysis) ---------


def run_preflight(repo: Path, bench: Path, results_dir: Path) -> int:
    started = utc_now_iso()
    ram_mib = total_ram_mib()
    free_disk = disk_free_bytes(Path.home())

    record: dict = {
        "evidenceId": "hf007-soccerchat-preflight",
        "purpose": (
            "HF007 preflight: the load analysis + the resource arithmetic "
            "FIRST (per the worker brief), bounded reachability probes, "
            "fixture pins, and the eval-corpus gating story — BEFORE any "
            "benchmark claim"
        ),
        "candidate": SOCCERCHAT_REPO_ID,
        "revision": SOCCERCHAT_REVISION,
        "host": {
            "cpuCores": os.cpu_count(),
            "ramTotalMiB": round(ram_mib, 1),
            "diskFreeBytes": free_disk,
            "gpu": "none — GPU memory honestly N/A; process RSS is the "
                   "substitute metric",
            "pythonVenv": str(bench),
            "note": RESOURCE_CAVEAT,
        },
        "startedAtUtc": started,
    }

    # --- 1. the load analysis (adapter + base composition) ------------------
    adapter_local = bench / "probe" / ADAPTER_FILE
    adapter_verified = False
    probes = []
    if not adapter_local.exists():
        try:
            blob = http_get(
                f"https://huggingface.co/{SOCCERCHAT_REPO_ID}/resolve/main/"
                f"{ADAPTER_FILE}?revision={SOCCERCHAT_REVISION}")
            adapter_local.parent.mkdir(parents=True, exist_ok=True)
            adapter_local.write_bytes(blob)
        except Exception as err:  # noqa: BLE001
            probes.append({"probe": "adapter-download",
                           "verdict": f"unreachable ({type(err).__name__}: "
                                      f"{str(err)[:160]})"})
    if adapter_local.exists():
        actual_size = adapter_local.stat().st_size
        actual_sha = sha256_of(adapter_local)
        adapter_verified = (actual_size == ADAPTER_BYTES
                            and actual_sha == ADAPTER_SHA256)
        probes.append({
            "probe": "adapter-download-and-sha",
            "file": ADAPTER_FILE,
            "bytes": actual_size,
            "sha256LocallyVerified": adapter_verified,
            "sha256": actual_sha,
            "hubLfsOid": ADAPTER_SHA256,
            "note": "LOCALLY VERIFIED (unlike HF004's hub-reported-only "
                    "etag — this adapter is small enough to hold)",
        })
    # bounded metadata probes (never full downloads): base shards + dataset
    probes.append({
        "probe": "base-model-metadata",
        "repoId": BASE_REPO_ID,
        "probedRevision": BASE_PROBED_REVISION,
        "shards": [{"file": f, "sizeBytes": s, "sha256HubReported": sh}
                   for f, s, sh in BASE_SHARDS],
        "totalSafetensorsBytes": BASE_TOTAL_BYTES,
        "note": "hub-reported LFS oids (the pinned blob etags); full local "
                "verification happens in FULL mode after download",
    })
    probes.append({"probe": "dataset-gating", **dataset_gating_probe()})
    record["hubProbes"] = probes

    # --- 2. the resource arithmetic (the typed refusal core) ----------------
    needed_disk = BASE_TOTAL_BYTES + ADAPTER_BYTES
    # bf16 working-set estimate: weights + ~1.5 GiB activations/KV/vision
    # tower headroom (Qwen2-VL: 28 layers, hidden 3584, 24-frame regime).
    needed_ram_gib = BASE_TOTAL_BYTES / (1 << 30) * 1.10 + 1.5
    quant4_gib = BASE_TOTAL_BYTES / (1 << 30) * 0.30 + 1.5  # nf4 + headroom
    arithmetic = {
        "disk": {
            "neededBytes": needed_disk,
            "neededGiB": round(needed_disk / (1 << 30), 2),
            "hostFreeBytes": free_disk,
            "hostFreeGiB": round(free_disk / (1 << 30), 2),
            "feasible": needed_disk < free_disk,
            "ratioNeededOverFree": round(needed_disk / max(free_disk, 1), 1),
        },
        "ram": {
            "bf16WorkingSetGiBEstimate": round(needed_ram_gib, 2),
            "hostTotalMiB": round(ram_mib, 1),
            "hostTotalGiB": round(ram_mib / 1024, 2),
            "bf16Feasible": needed_ram_gib < ram_mib / 1024,
            "ratioBf16OverTotal": round(needed_ram_gib / (ram_mib / 1024), 2),
            "quant4GiBEstimate": round(quant4_gib, 2),
            "quant4Feasible": quant4_gib < ram_mib / 1024,
            "quant4Note": "even the card's own 4-bit nf4 Colab recipe "
                          "(bnb, CUDA-only) exceeds this host's TOTAL RAM; "
                          "no CUDA GPU exists here in any case",
        },
        "verdict": "resource-infeasible-host",
    }
    record["resourceArithmetic"] = arithmetic

    # --- 3. repo fixture pins (the FULL-mode authorized media) --------------
    fixture_pins: dict[str, dict] = {}
    pin_targets = {
        "synthetic-diagnostic-01": (repo / SYNTHETIC_FIXTURE_MEDIA,
                                    SYNTHETIC_FIXTURE_SHA256),
        "fx-001": (repo / FX001_NORMALIZED_MEDIA, FX001_NORMALIZED_SHA256),
    }
    pin_failures: list[str] = []
    for clip_id, (path, expected) in pin_targets.items():
        if not path.exists():
            pin_failures.append(f"{clip_id}: missing {path}")
            continue
        actual = sha256_of(path)
        fixture_pins[clip_id] = {
            "path": str(path.relative_to(repo)), "sha256": actual,
            "pinVerified": actual == expected,
        }
        if actual != expected:
            pin_failures.append(f"{clip_id}: sha drift {actual} != {expected}")
    for clip_id, (name, duration) in SPR_CLIPS.items():
        path = repo / SPR_CORPUS_BYTES / name
        if not path.exists():
            pin_failures.append(f"{clip_id}: missing {path}")
            continue
        fixture_pins[clip_id] = {
            "path": str(path.relative_to(repo)),
            "sha256": sha256_of(path), "durationS": duration,
            "authorization": SPR_AUTHORIZATION_NOTE,
        }
    record["fixturePins"] = fixture_pins
    if pin_failures:
        record["fixturePinFailures"] = pin_failures

    # --- 4. the eval-corpus + ground-truth story (typed) ---------------------
    record["evalCorpus"] = {
        "soccerchatHeldOutSplit": {
            "status": "NOT FETCHABLE (typed): the dataset is auto-gated "
                      "behind the SoccerNet NDA (401 anonymous on the "
                      "validation parquet — probed above); access requires "
                      "an operator NDA acceptance (the HF009 auth-wall "
                      "convention)",
            "schema": SOCCERCHAT_SCHEMA,
            "licenseSplit": DATASET_GATING,
        },
        "repoAuthorizedMedia": {
            "status": "the FULL-mode benchmark set (sha-pinned above): "
                      "synthetic-diagnostic-01, fx-001 (CC0), the SPR "
                      "corpus clips (R606 analysis scope)",
        },
        "eventGroundTruth": {
            "status": "NOT MEASURED (typed): no event ground truth exists "
                      "in the repo for any benchmarkable media (the HF006 "
                      "repo-wide search verdict — spatial-disc annotations "
                      "only; real-to-swm emits candidates; SWM timelines "
                      "are derived). The hallucination-rate metric unlocks "
                      "ONLY with an operator-supplied GT timeline.",
        },
    }

    # --- 5. the typed refusal -------------------------------------------------
    refusal_reasons = [
        f"model-load-ram-infeasible: the base bf16 working set "
        f"(~{needed_ram_gib:.1f} GiB: 16,582,831,200 B weights + "
        f"activations/KV/vision headroom) exceeds the host's TOTAL RAM "
        f"({ram_mib:.0f} MiB) — {needed_ram_gib / (ram_mib / 1024):.1f}x "
        f"over; even 4-bit nf4 (~{quant4_gib:.1f} GiB) exceeds it, and "
        f"bnb 4-bit requires CUDA (no GPU here — honestly N/A)",
        f"model-download-disk-infeasible: base safetensors "
        f"({BASE_TOTAL_BYTES:,} B) + adapter ({ADAPTER_BYTES:,} B) vs "
        f"~{free_disk / 1e6:.0f} MB free disk — "
        f"{needed_disk / max(free_disk, 1):.0f}x over",
        "eval-corpus-auth-infeasible: the SoccerChat held-out validation "
        "split is SoccerNet-NDA-gated (auto-gated repo, 401 anonymous — "
        "probed above); the unblock is a HUMAN NDA acceptance, exactly the "
        "HF009 typed-refusal precedent",
    ]
    record["typedRefusal"] = {
        "type": "resource-infeasible-host",
        "reasons": refusal_reasons,
        "note": "per the worker brief: the honest delivery is this typed "
                "refusal + the PARTIAL (the load analysis, the event-extraction "
                "contract mapping, the commentary-alignment mapping, the "
                "hallucination/provenance metric designs, the static "
                "intelligence-pipeline comparison) — never a fabricated "
                "benchmark",
    }
    record["adapterShaLocallyVerified"] = adapter_verified
    record["verdict"] = "refused"
    record["refusalType"] = "resource-infeasible-host"
    record["finishedAtUtc"] = utc_now_iso()

    out = results_dir / "preflight-refusal.json"
    out.write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")

    # --- 6. the load-analysis partial (the SUBSTANTIAL deliverable) ----------
    load_analysis = {
        "evidenceId": "hf007-soccerchat-load-analysis",
        "candidate": SOCCERCHAT_REPO_ID,
        "revision": SOCCERCHAT_REVISION,
        "adapter": {
            "file": ADAPTER_FILE,
            "bytes": ADAPTER_BYTES,
            "sha256": ADAPTER_SHA256,
            "shaVerification": "LOCALLY VERIFIED (downloaded in the bounded "
                               "preflight probe; matches the hub LFS oid)",
            "lora": ADAPTER_LORA,
            "trainerState": "global_step7270 (the repo carries the DeepSpeed "
                            "ZeRO checkpoint shards + optim states — "
                            "inference needs ONLY adapter_model.safetensors "
                            "+ adapter_config.json)",
        },
        "base": {
            "repoId": BASE_REPO_ID,
            "revisionPinnedByAdapter": None,
            "revisionPinnedByAdapterNote": (
                "adapter_config.json revision is null and sft_args.json "
                "records model_revision 'master' — the adapter does NOT pin "
                "a base revision; this flight records the probed main sha "
                "and flags the unpinned-base reproducibility caveat (the "
                "HF015 gate may want the operator to pin it)"
            ),
            "probedRevision": BASE_PROBED_REVISION,
            "safetensors": [
                {"file": f, "bytes": s, "sha256HubReported": sh}
                for f, s, sh in BASE_SHARDS
            ],
            "totalBytes": BASE_TOTAL_BYTES,
            "dtype": "bfloat16 (config.json torch_dtype)",
            "architecture": BASE_ARCHITECTURE,
        },
        "generationConfig": GENERATION_CONFIG,
        "cardInferenceRegime": CARD_INFERENCE_REGIME,
        "loadingRecipe": {
            "transformersPeft": (
                "AutoProcessor.from_pretrained(Qwen/Qwen2-VL-7B-Instruct); "
                "Qwen2VLForConditionalGeneration.from_pretrained(base, "
                "torch_dtype=torch.bfloat16, attn_implementation='sdpa'); "
                "PeftModel.from_pretrained(model, adapter_dir) — the "
                "adapter repo's own config.json carries the full base "
                "architecture (verified identical to the base config)"
            ),
            "cardMsSwift": (
                "ms-swift PtEngine(adapters=['SimulaMet/"
                "SoccerChat-qwen2-vl-7b'], model_id_or_path='Qwen/"
                "Qwen2-VL-7B-Instruct', quantization_config=bnb nf4) with "
                "FPS_MIN_FRAMES=FPS_MAX_FRAMES=24, VIDEO_MAX_PIXELS=100352"
            ),
            "hostRequirement": (
                ">= 32 GB RAM (bf16 unquantized, the paper's regime) or a "
                ">= 16 GB CUDA GPU (the card's 4-bit regime); >= 24 GB free "
                "disk for the download; this host: 4,041.6 MiB RAM / ~442 "
                "MB free — INFEASIBLE (the typed refusal)"
            ),
        },
        "hostGapArithmetic": arithmetic,
        "recordedAtUtc": utc_now_iso(),
    }
    (results_dir / "load-analysis.json").write_text(
        json.dumps(load_analysis, indent=2) + "\n", encoding="utf-8")

    # --- 7. the source-verified model/output schema partial -------------------
    schema = {
        "evidenceId": "hf007-soccerchat-model-output-schema",
        "model": {
            "candidate": "SoccerChat",
            "modelUrl": f"https://huggingface.co/{SOCCERCHAT_REPO_ID}",
            "revision": SOCCERCHAT_REVISION,
        },
        "pipelineTag": "video-text-to-text",
        "modelOutput": {
            "modality": "free-form natural-language text (the response to a "
                        "video + text query)",
            "structuredEventFields": "NONE — the model card documents NO "
                                     "structured event JSON output; "
                                     "structured events exist ONLY as "
                                     "dataset-side annotations",
            "verbatim": "The model accepts video + text queries. ... "
                        "print(resp[0].choices[0].message.content)",
        },
        "datasetAnnotationSchema": {
            "features": SOCCERCHAT_SCHEMA,
            "eventsFieldNote": "list of one or more SoccerNet event types "
                               "(can be empty if unannotated); the observed "
                               "vocabulary is SoccerNet Challenge classes "
                               f"(e.g. the card's own example path "
                               f"'{SOCCERNET_EVENT_EXAMPLE}')",
            "cardMetrics": "BLEU, ROUGE, METEOR (generated text); "
                           "event-based accuracy/recall for detecting key "
                           "match events; human evaluation (fluency/"
                           "correctness) — per the model card",
        },
        "sourcesFetchedThisFlight": [
            f"https://huggingface.co/{SOCCERCHAT_REPO_ID}/resolve/main/"
            f"README.md?revision={SOCCERCHAT_REVISION} (6,632 B)",
            f"https://huggingface.co/{SOCCERCHAT_REPO_ID}/resolve/main/"
            f"adapter_config.json?revision={SOCCERCHAT_REVISION}",
            f"https://huggingface.co/{SOCCERCHAT_REPO_ID}/resolve/main/"
            f"config.json?revision={SOCCERCHAT_REVISION}",
            f"https://huggingface.co/{SOCCERCHAT_REPO_ID}/resolve/main/"
            f"sft_args.json?revision={SOCCERCHAT_REVISION}",
            f"https://huggingface.co/{SOCCERCHAT_REPO_ID}/resolve/main/"
            f"generation_config.json?revision={SOCCERCHAT_REVISION}",
            "https://huggingface.co/datasets/SimulaMet/SoccerChat/resolve/"
            "main/README.md (6,068 B — the dataset card with the features "
            "list + the NDA gate text)",
            "https://huggingface.co/api/models/Qwen/Qwen2-VL-7B-Instruct/"
            "tree/main?recursive=true (the base shards' sizes + LFS oids)",
            "https://raw.githubusercontent.com/simula/SoccerChat/main/"
            "README.md (8,438 B)",
        ],
        "recordedAtUtc": utc_now_iso(),
    }
    (results_dir / "model-output-schema.json").write_text(
        json.dumps(schema, indent=2) + "\n", encoding="utf-8")

    print(f"wrote {out}")
    print(f"  verdict: {record['verdict']} ({record['refusalType']})")
    for reason in refusal_reasons:
        print(f"  - {reason}")
    print(f"  adapter sha locally verified: {adapter_verified}")
    return 3  # the typed-refusal exit code (the HF004/HF009 convention)


# --- the FULL mode (READY-TO-RUN on a >= 32 GB host; NOT executed here) ------


def download_pin(repo_id: str, revision: str, filename: str,
                 expected_sha: str, target: Path) -> Path:
    """Fail-closed pinned download (FULL mode): local sha256 must match."""
    if target.exists() and sha256_of(target) == expected_sha:
        return target
    blob = http_get(
        f"https://huggingface.co/{repo_id}/resolve/main/{filename}"
        f"?revision={revision}")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(blob)
    actual = sha256_of(target)
    if actual != expected_sha:
        raise RuntimeError(
            f"{repo_id}/{filename} sha drift: {actual} != pin {expected_sha}")
    return target


def media_duration_s(path: Path) -> float:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", str(path)],
        capture_output=True, text=True, check=True).stdout.strip()
    return float(out)


def run_full(repo: Path, bench: Path, results_dir: Path,
             repeats: int, ground_truth_path: Path | None) -> int:
    """The ready-to-run benchmark (a >= 32 GB RAM / >= 24 GB free-disk host).

    Executes: pinned downloads (sha-verified) of the adapter + base shards,
    the transformers+peft load (bf16, sdpa), inference over the repo's
    authorized sha-pinned media at the card's own 24-frame/100352-pixel
    regime, the response->event parse, the hallucination-rate +
    provenance-traceability metrics (exact definitions above), determinism
    across repeats, per-inference CPU wall-clock (median + nearest-rank
    p95), and process RSS. FAIL-CLOSES on any pin drift or load failure —
    it never fabricates a number.
    """
    print("HF007 FULL mode — the ready-to-run benchmark (NOT executed in "
          "this flight: the typed refusal stands).")
    print(f"  host RAM check: {total_ram_mib():.0f} MiB total; "
          f"free disk {disk_free_bytes(Path.home()) / 1e9:.2f} GB")
    if total_ram_mib() < 28_000:
        print("REFUSING to run: this host does not meet the >= 32 GB RAM "
              "requirement (the preflight arithmetic; the typed refusal).")
        return 3

    # 1. fail-closed pinned downloads
    models_dir = bench / "hf007-models"
    adapter_path = download_pin(
        SOCCERCHAT_REPO_ID, SOCCERCHAT_REVISION, ADAPTER_FILE,
        ADAPTER_SHA256, models_dir / ADAPTER_FILE)
    for name, size, sha in BASE_SHARDS:
        download_pin(BASE_REPO_ID, BASE_PROBED_REVISION, name, sha,
                     models_dir / name)
    print(f"  pins verified: adapter + {len(BASE_SHARDS)} base shards "
          f"({BASE_TOTAL_BYTES:,} B)")

    # 2. the load (bf16, sdpa) — peft adapter over the base
    import torch  # noqa: PLC0415 - FULL mode only (resource-gated)
    from peft import PeftModel  # noqa: PLC0415
    from transformers import (AutoProcessor,  # noqa: PLC0415
                              Qwen2VLForConditionalGeneration)

    model = Qwen2VLForConditionalGeneration.from_pretrained(
        str(models_dir), torch_dtype=torch.bfloat16,
        attn_implementation="sdpa")
    model = PeftModel.from_pretrained(model, str(adapter_path.parent))
    model.eval()
    processor = AutoProcessor.from_pretrained(
        BASE_REPO_ID, max_pixels=CARD_INFERENCE_REGIME["max_video_pixels"])

    # 3. the media set (fail-closed pins — the preflight pins re-verified)
    media = {}
    pin_map = {
        "synthetic-diagnostic-01": (repo / SYNTHETIC_FIXTURE_MEDIA,
                                    SYNTHETIC_FIXTURE_SHA256),
        "fx-001": (repo / FX001_NORMALIZED_MEDIA, FX001_NORMALIZED_SHA256),
    }
    for clip_id, (path, expected) in pin_map.items():
        actual = sha256_of(path)
        if actual != expected:
            raise RuntimeError(f"fixture {clip_id} drifted: {actual} != {expected}")
        media[clip_id] = path
    for clip_id, (name, _duration) in SPR_CLIPS.items():
        media[clip_id] = repo / SPR_CORPUS_BYTES / name

    # 4. optional operator-supplied ground truth (unlocks hallucination-rate)
    gt: dict[str, list[dict]] = {}
    if ground_truth_path is not None:
        gt_doc = json.loads(Path(ground_truth_path).read_text(encoding="utf-8"))
        gt = {k: v for k, v in gt_doc.items()}

    query = (
        "Describe the football events in this clip. For each event, answer "
        "with one line in exactly this format: "
        "'<event type> @ <seconds>s — <short description>'. Use lowercase "
        "kebab-case event types."
    )

    per_clip: dict[str, dict] = {}
    for clip_id, path in media.items():
        duration = media_duration_s(path)
        wall_clock: list[float] = []
        timelines: list[list[dict]] = []
        for rep in range(repeats):
            t0 = time.perf_counter()
            conversation = [{
                "role": "user",
                "content": [
                    {"type": "video", "video": f"file://{path}"},
                    {"type": "text", "text": query},
                ],
            }]
            text_prompt = processor.apply_chat_template(
                conversation, tokenize=False, add_generation_prompt=True)
            inputs = processor(
                text=[text_prompt], videos=[str(path)], padding=True,
                return_tensors="pt")
            with torch.inference_mode():
                generated = model.generate(
                    **inputs, **GENERATION_CONFIG)
            trimmed = [
                model_generate_trim(out_ids, in_len)
                for out_ids, in_len in zip(
                    generated, inputs.input_ids.shape[1])
            ]
            response = processor.batch_decode(
                trimmed, skip_special_tokens=True,
                clean_up_tokenization_spaces=False)[0]
            wall_clock.append(time.perf_counter() - t0)
            timelines.append(parse_response_events(response, duration))
        # the metrics (exact definitions in the module docstring)
        pred = timelines[0]
        clip_record = {
            "clipId": clip_id,
            "mediaPath": str(path.relative_to(repo)),
            "durationS": duration,
            "parsedEvents": pred,
            "latency": {
                "convention": "per-inference CPU wall-clock (GPU N/A)",
                "repeats": repeats,
                "medianMs": 1000.0 * sorted(wall_clock)[len(wall_clock) // 2],
                "p95NearestRankMs": 1000.0 * nearest_rank_percentile(wall_clock, 95),
            },
            "memory": {
                "gpuMemory": "N/A (no GPU on the benchmark host)",
                "processRssMiB": vm_rss_mib(),
                "ruMaxrssMiB": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024.0,
            },
            "determinism": {
                "rule": "serialized parsed-event timeline exact-match across "
                        "repeats (near-greedy generation: temp 0.01, top_k 1)",
                "deterministic": all(t == timelines[0] for t in timelines[1:]),
            },
            "provenanceTraceability": provenance_traceability(pred, duration),
        }
        if clip_id in gt and gt[clip_id]:
            clip_record["hallucinationRate"] = {
                f"tol{s}s": hallucination_rate(pred, gt[clip_id], s)
                for s in (1.0, 2.0, 5.0)
            }
        else:
            clip_record["hallucinationRate"] = {
                "status": "NOT MEASURED (typed): no event ground truth "
                          "supplied for this clip — the repo owns none for "
                          "its benchmarkable media (the HF006 verdict)",
            }
        per_clip[clip_id] = clip_record

    result = {
        "evidenceId": "hf007-soccerchat-full-run",
        "candidate": SOCCERCHAT_REPO_ID,
        "revision": SOCCERCHAT_REVISION,
        "baseRevision": BASE_PROBED_REVISION,
        "mode": "full (EXECUTED — only valid on an adequate host)",
        "inferenceRegime": CARD_INFERENCE_REGIME,
        "clips": per_clip,
        "recordedAtUtc": utc_now_iso(),
    }
    out = results_dir / "full-run.json"
    out.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {out}")
    return 0


def model_generate_trim(out_ids, in_len: int) -> list:
    """Trim the prompt tokens off a generate() output (helper)."""
    return out_ids[in_len:]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[1])
    parser.add_argument("--repo-root", default="/home/z/sporta", type=Path)
    parser.add_argument("--bench-root", default="/home/z/hf-bench-5", type=Path)
    parser.add_argument("--mode", choices=["preflight", "full"],
                        default="preflight")
    parser.add_argument("--repeats", type=int, default=3)
    parser.add_argument("--ground-truth", type=Path, default=None,
                        help="optional operator JSON {clipId: [{eventType, "
                             "eventTimeS}]} — unlocks hallucination-rate")
    args = parser.parse_args()

    results_dir = Path(__file__).resolve().parent / "results"
    results_dir.mkdir(parents=True, exist_ok=True)

    if args.mode == "preflight":
        return run_preflight(args.repo_root, args.bench_root, results_dir)
    return run_full(args.repo_root, args.bench_root, results_dir,
                    args.repeats, args.ground_truth)


if __name__ == "__main__":
    sys.exit(main())
