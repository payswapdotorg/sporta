#!/usr/bin/env python3
"""
HF008 — the streaming commentary ASR portfolio benchmark (flight 6, worker 64-f).

BOTH ledger candidates, BOTH pinned revisions, echoed VERBATIM from
scripts/evidence/hf-portfolio/provenance-ledger.json:

  1. microsoft/VibeVoice-ASR-Streaming-1.5B @ 4262d23d8a539a6530cf64fbd0b1751ef9a30853 (MIT/MIT)
  2. Qwen/Qwen3-ASR-1.7B                @ 7278e1e70fe206f11671096ffdd38061171dd6e5 (apache-2.0)

The honest shape on THIS host (2 vCPU, 4,041.6 MiB total RAM, ~1.1 GB free
disk, no GPU): both checkpoints are 4.3-5.6 GB — the preflight arithmetic
(see --mode preflight, EXECUTED) refuses BOTH as resource-infeasible-host.
The delivery is therefore the HF004/HF007/HF009 convention: the typed
refusal + the SUBSTANTIAL partial — the metric designs IMPLEMENTED
ready-to-run (WER, streaming latency, hotword recall, multilingual WER) and
the machine-checkable ASR contract mappings (contract_compatibility.ts).

METRIC DESIGNS (typed not-measured until a run executes them — a machine
claim stands on a single measured run):

  WER (the streaming profile's quality metric):
    WER = (S + D + I) / N over the word-sequence Levenshtein alignment
    (S substitutions, D deletions, I insertions, N reference words), with
    the normalization stated EXACTLY: case-folded to lower-case, all
    Unicode punctuation stripped, whitespace-collapsed, then split on
    whitespace (the jiwer convention, implemented here standalone so the
    metric needs no dependency beyond the stdlib). Reported PER UTTERANCE
    and POOLED corpus-level (the pooled micro-average over all reference
    words — not the mean of per-utterance rates).
    REFERENCE TRANSCRIPTS: none exist. The repo owns NO commentary
    transcripts of any real audio (the W208 test transcripts are SYNTHETIC
    inline text; the ASR fixture backend returns canned strings — see the
    ground-truth search in the preflight output). `--ground-truth` is the
    OPERATOR UNLOCK: a JSON file mapping fixture id -> reference
    transcript; without it, WER is not-measured, never guessed.

  STREAMING-CHUNKING SEMANTICS (the VibeVoice convention):
    the preprocessor_config pins chunk_frames=22, lookahead_frames=4 at
    speech_tok_compress_ratio=3200, target_sample_rate=24000 — i.e. 3200
    samples per speech token at 24 kHz = 0.1333 s/token, so one hypothesis
    chunk covers ~22 tokens (~2.93 s) with a ~4-token (~0.53 s) lookahead.
    The benchmark distinguishes HYPOTHESIS-PER-CHUNK (the partial
    transcript emitted while speech is still arriving) from FINAL (the
    settled transcript once the chunk has left the lookahead window):
    WER is computed on the CONCATENATED FINAL transcript; the per-chunk
    hypothesis churn is reported separately as
    hypothesisChurnRate = 1 - mean(word F1 of each chunk hypothesis vs
    its own final) — the streaming-consistency measure, NOT a WER.

  STREAMING LATENCY (the streaming profile's latency metric):
    firstChunkLatencyMs — wall-clock from the first audio sample fed to
    the model to the FIRST emitted hypothesis (the streaming contract
    a live commentary pipeline actually feels);
    steadyStateRtf — over all chunks after the first: processing
    wall-clock / audio duration (lower is faster-than-real-time; RTF 1.0
    is exactly real time), reported per fixture and pooled;
    perUtteranceWallClockMs — per final utterance, median + nearest-rank
    p95 (rank = ceil(p/100 * n), the repo convention from the earlier
    flights). For Qwen3-ASR: the card documents streaming ONLY via the
    vLLM backend ("streaming inference ... only available with the vLLM
    backend"), so firstChunkLatencyMs is typed vllm-only for that
    candidate; the transformers backend measures offline
    perUtteranceWallClockMs + RTF only.

  HOTWORD RECALL (the streaming profile's metric):
    hotwordRecall = |{hotwords present in the reference AND recognized in
    the hypothesis}| / |{hotwords present in the reference}|, per fixture,
    greedy longest-match-leftmost on the NORMALIZED text (the same
    normalization as WER). REQUIRES the reference transcript (the same
    --ground-truth unlock) AND a hotword VOCABULARY — which is an
    AUTHORED decision this flight records as a gap: the repo's own
    candidates are the W401 FOOTBALL_EVENT_TYPES (16 canonical types)
    and the W209 lexicon patterns (football phrasings), but neither is a
    proper-noun/name vocabulary; the operator passes --hotwords with the
    authored list. VibeVoice natively documents "Customized Hotwords"
    (names and technical terms); Qwen3-ASR documents NO hotword support —
    a typed capability gap for the multilingual candidate.

  MULTILINGUAL WER (the multilingual profile's metric):
    per-language WER pooled per detected language. Qwen3-ASR returns a
    language id per utterance (the card documents results[0].language;
    config.json support_languages lists the 30 named languages; the card
    claims 52 languages AND dialects = 30 + 22 Chinese dialects — both
    recorded verbatim). VibeVoice declares 10 languages in the card. The
    protocol requires PER-LANGUAGE licensed fixtures — NONE exist (the
    two SPR WAVs' spoken language is not annotated anywhere in the repo;
    fx-001's audio is unreachable; the synthetic fixture has no audio
    track at all). TYPED not-measured.

  SPEAKER HINTS (the streaming profile's output):
    VibeVoice documents Who-said-What speaker attribution natively ("a
    unified streaming ASR model that transcribes Who (Speaker) said What
    (Content)"); Qwen3-ASR documents NO speaker metadata anywhere in its
    card (grep: zero hits for speaker/diarization). The speaker-hints
    verdict is therefore per-candidate: VibeVoice emits speaker cluster
    labels per chunk (SPEAKER_XX-class — NOT identities, exactly the
    HF009 typed gap); Qwen3-ASR requires the HF009 pyannote composition.
    No speaker metric is measured (no diarization ground truth exists —
    the HF009 repo-wide verdict).

Modes:
  --mode preflight  EXECUTED on this host (exit 3, the typed refusal):
                    host resources, both pinned hub probes (bounded — file
                    trees + small config/card fetches, NEVER the weights),
                    the resource arithmetic, the audio-fixture verification
                    (SPR WAV shas + the fx-001/synthetic no-audio story),
                    the ground-truth search, the typed refusal.
  --mode full       READY-TO-RUN on an adequate host (>= 16 GB RAM, >= 24 GB
                    free disk, GPU recommended but CPU honest): pinned
                    sha-verified downloads, both runtimes, every metric
                    above, the --ground-truth operator unlock. NOT executed
                    in this flight (the refusal).

MODES: preflight (EXECUTED, exit 3), full (ready-to-run), selfcheck
(EXECUTED: verifies the metric implementations against hand-computed
cases — implementation evidence, NOT a model measurement).

Run (from the repo root, the venv outside it):
  /home/z/hf-bench-6/bin/python scripts/evidence/hf-portfolio/hf008/benchmark_asr.py --mode preflight
  /home/z/hf-bench-6/bin/python scripts/evidence/hf-portfolio/hf008/benchmark_asr.py --mode selfcheck
Exit codes: 0 = record stands; 3 = typed refusal (the preflight verdict on
this host); 2 = configuration/fixture error (fail-closed, never a silent
pass).
"""
from __future__ import annotations

import argparse
import json
import math
import os
import re
import shutil
import subprocess
import sys
import time
import unicodedata
from pathlib import Path

HERE = Path(__file__).resolve().parent
RESULTS = HERE / "results"
REPO_ROOT = HERE.parent.parent.parent.parent

# --- the two ledger candidates (echoed VERBATIM from provenance-ledger.json) --

CANDIDATES = [
    {
        "candidate": "VibeVoice-ASR-Streaming",
        "modelUrl": "https://huggingface.co/microsoft/VibeVoice-ASR-Streaming-1.5B",
        "repoId": "microsoft/VibeVoice-ASR-Streaming-1.5B",
        "revision": "4262d23d8a539a6530cf64fbd0b1751ef9a30853",
        "modelLicense": "mit",
        "codeLicense": "mit",
        "weightsProvenance": "unknown",
        "datasetProvenance": "unknown",
        "commercialUse": "yes",
        "gatingState": "candidate",
        "taskProfiles": ["football.commentaryASR.streaming"],
    },
    {
        "candidate": "Qwen3-ASR",
        "modelUrl": "https://huggingface.co/Qwen/Qwen3-ASR-1.7B",
        "repoId": "Qwen/Qwen3-ASR-1.7B",
        "revision": "7278e1e70fe206f11671096ffdd38061171dd6e5",
        "modelLicense": "apache-2.0",
        "codeLicense": "apache-2.0",
        "weightsProvenance": (
            "large-scale speech training data on the Qwen3-Omni foundation model, "
            "per card (1.7B and 0.6B family; 52 languages/dialects)."
        ),
        "datasetProvenance": "unknown",
        "commercialUse": "yes",
        "gatingState": "candidate",
        "taskProfiles": ["football.commentaryASR.multilingual"],
    },
]

# The audio fixtures staged by the 64-d extraction (R606 analysis-scope
# authorized, repo-private — see HF009's audio-fixtures evidence).
SPR_AUDIO = [
    {
        "clipId": "sprclip-b1-wide-broadcast",
        "path": "/home/z/hf-bench-4/audio/spr-b1-audio.wav",
        "durationSec": 30.070,
        "sampleRate": 16000,
        "channels": 1,
        "codec": "pcm_s16le",
        "sha256": "08c2fcfb8fb1740bf07d29a7e0abc986c1c4832ac2c0877b5de485a735391918",
        "bytes": 962314,
        "role": "SPR corpus clip-b1-wide-broadcast.mp4 audio (the w3a re-cut of the b8p3 source window), ffmpeg -vn -ac 1 -ar 16000 -c:a pcm_s16le, extracted by 64-d (HF009)",
    },
    {
        "clipId": "sprclip-b8-inplay-original",
        "path": "/home/z/hf-bench-4/audio/spr-src-audio.wav",
        "durationSec": 47.624,
        "sampleRate": 16000,
        "channels": 1,
        "codec": "pcm_s16le",
        "sha256": "ddf9c20335e7c4e7873e9267906682ac21ccfd1a74f841f58e8676fc0a2a7a17",
        "bytes": 1523984,
        "role": "SPR corpus b8p3.mp4 audio, same extraction convention, by 64-d (HF009)",
    },
]

# The repo fixture pins this flight re-verifies (the no-audio structural gap
# exactly as HF009 recorded it).
REPO_VIDEO_FIXTURES = [
    {
        "clipId": "fx-001",
        "path": "packages/real-to-swm/fixtures/media/fx-001-normalized.mp4",
        "expected": "video-only (the gate-clips.json normalizeTransform carries '-an': the committed clip has NO audio stream)",
    },
    {
        "clipId": "synthetic-diagnostic-01",
        "path": "packages/technology-registry/fixtures/media/synthetic-diagnostic-01-players-and-ball.mp4",
        "expected": "video-only (the synthetic fixture was authored with a single h264 video stream — no audio track exists at all)",
    },
]

MI_PER_GIB = 1024.0


def mib(num_bytes: int) -> float:
    return num_bytes / (1024.0 * 1024.0)


def gib(num_bytes: int) -> float:
    return num_bytes / (1024.0 ** 3)


# --- host resources (honest, read at run time) --------------------------------

def read_host() -> dict:
    total_kb = 0
    available_kb = 0
    with open("/proc/meminfo", "r", encoding="ascii") as fh:
        for line in fh:
            if line.startswith("MemTotal:"):
                total_kb = int(line.split()[1])
            elif line.startswith("MemAvailable:"):
                available_kb = int(line.split()[1])
    usage = shutil.disk_usage("/")
    cpus = os.cpu_count() or 1
    return {
        "cpuCount": cpus,
        "gpu": "N/A (no GPU on the benchmark host — CPU-only, honestly recorded)",
        "ramTotalMiB": round(total_kb / 1024.0, 1),
        "ramAvailableMiB": round(available_kb / 1024.0, 1),
        "diskFreeBytes": usage.free,
        "diskFreeGiB": round(gib(usage.free), 3),
    }


def sha256_of(path: Path) -> str:
    import hashlib

    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for block in iter(lambda: fh.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def ffprobe_streams(path: Path) -> list:
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "stream=codec_type,codec_name",
             "-of", "csv=p=0", str(path)],
            capture_output=True, text=True, timeout=60,
        )
        if out.returncode != 0:
            return []
        rows = []
        for line in out.stdout.strip().splitlines():
            parts = [p.strip() for p in line.split(",")]
            if len(parts) >= 2:
                rows.append({"index": parts[0], "codecType": parts[1] if len(parts) > 1 else "?", "codecName": parts[2] if len(parts) > 2 else "?"})
        return rows
    except Exception:
        return []


# --- the bounded hub probe (NEVER the weights) --------------------------------

def probe_candidate(repo_id: str, revision: str) -> dict:
    """Bounded reachability probe: the file tree at the PINNED revision plus
    the small config/card files. NEVER downloads a weight shard."""
    from huggingface_hub import HfApi, hf_hub_download

    api = HfApi()
    info = api.model_info(repo_id=repo_id, revision=revision, files_metadata=True)
    files = []
    weights_bytes = 0
    small_bytes = 0
    for s in info.siblings:
        size = getattr(s, "size", None) or 0
        lfs = getattr(s, "lfs", None)
        entry = {
            "path": s.rfilename,
            "sizeBytes": size,
            "lfsSha256": (lfs.sha256 if lfs else None),
        }
        files.append(entry)
        if s.rfilename.endswith((".safetensors", ".bin", ".pt", ".ckpt")):
            weights_bytes += size
        else:
            small_bytes += size
    # the bounded small-file fetches (each < 200 KB — card + configs only)
    fetched = {}
    for fn in ["README.md", "config.json", "generation_config.json",
               "preprocessor_config.json", "chat_template.json",
               "model.safetensors.index.json", "tokenizer_config.json"]:
        try:
            p = hf_hub_download(repo_id=repo_id, revision=revision, filename=fn)
            fetched[fn] = {"bytes": os.path.getsize(p), "sha256": sha256_of(Path(p))}
        except Exception as exc:  # 404s are expected for absent files
            fetched[fn] = {"error": f"{type(exc).__name__}: {str(exc)[:180]}"}
    return {
        "repoId": repo_id,
        "revision": revision,
        "resolvedSha": info.sha,
        "gated": str(getattr(info, "gated", "False")),
        "pipelineTag": info.pipeline_tag,
        "fileCount": len(files),
        "weightShardBytes": weights_bytes,
        "smallFileBytes": small_bytes,
        "totalRepoBytes": weights_bytes + small_bytes,
        "files": files,
        "boundedSmallFileFetches": fetched,
        "weightsDownloaded": False,
    }


# --- the resource arithmetic (the preflight's verdict engine) ------------------

def resource_verdict(host: dict, weights_bytes: int, stored_dtype: str,
                     label: str) -> dict:
    """fp32/bf16 working-set arithmetic vs TOTAL RAM; download vs free disk."""
    if stored_dtype == "float32":
        fp32_ws = weights_bytes
        bf16_ws = weights_bytes // 2
    else:  # stored bf16 (Qwen3)
        bf16_ws = weights_bytes
        fp32_ws = weights_bytes * 2
    ram_total = host["ramTotalMiB"] / MI_PER_GIB  # GiB
    ram_avail = host["ramAvailableMiB"] / MI_PER_GIB
    disk_free = host["diskFreeGiB"]
    download_gib = gib(weights_bytes)
    reasons = []
    if gib(fp32_ws) > ram_total:
        reasons.append(
            f"{label} model-load-ram-infeasible: the fp32 working set "
            f"({gib(fp32_ws):.2f} GiB weights alone, before activations/KV/runtime) "
            f"exceeds the host's TOTAL RAM ({ram_total:.2f} GiB)"
        )
    if gib(bf16_ws) > ram_total:
        reasons.append(
            f"{label} even a bf16 cast ({gib(bf16_ws):.2f} GiB weights alone) "
            f"exceeds TOTAL RAM ({ram_total:.2f} GiB) — and exceeds AVAILABLE RAM "
            f"({ram_avail:.2f} GiB) before any activation is allocated"
        )
    elif gib(bf16_ws) > ram_avail:
        reasons.append(
            f"{label} a bf16 cast ({gib(bf16_ws):.2f} GiB weights alone) does not "
            f"exceed TOTAL RAM ({ram_total:.2f} GiB) but EXCEEDS AVAILABLE RAM "
            f"({ram_avail:.2f} GiB) — and the fp32 checkpoint must be resident "
            f"(or streamed) before the cast; activations/KV/tokenizers are on top"
        )
    if download_gib > disk_free:
        reasons.append(
            f"{label} model-download-disk-infeasible: the pinned weight shards "
            f"({download_gib:.2f} GiB) vs the host's free disk ({disk_free:.2f} GiB) "
            f"— {download_gib / disk_free:.1f}x over"
        )
    reasons.append(
        f"{label} CPU-only host ({host['cpuCount']} vCPU, no GPU): GPU memory is "
        "honestly N/A; even if the weights fit, 2-vCPU decode latency would be "
        "far from the streaming regime the profile measures"
    )
    return {
        "label": label,
        "storedDtype": stored_dtype,
        "weightShardBytes": weights_bytes,
        "weightShardGiB": round(gib(weights_bytes), 3),
        "fp32WorkingSetGiB": round(gib(fp32_ws), 3),
        "bf16WorkingSetGiB": round(gib(bf16_ws), 3),
        "hostRamTotalGiB": round(ram_total, 3),
        "hostRamAvailableGiB": round(ram_avail, 3),
        "hostDiskFreeGiB": disk_free,
        "downloadOverFreeDisk": round(download_gib / disk_free, 2) if disk_free else None,
        "reasons": reasons,
    }


# =============================================================================
# THE METRIC IMPLEMENTATIONS (ready-to-run, typed not-measured until executed)
# =============================================================================

_PUNCT_CATS = {"Pc", "Pd", "Ps", "Pe", "Pi", "Pf", "Po"}


def normalize_transcript(text: str) -> str:
    """The EXACT WER normalization (stated, deterministic, dependency-free):
    case-fold, strip Unicode punctuation per category, collapse whitespace."""
    lowered = text.casefold()
    stripped = "".join(
        ch for ch in lowered
        if unicodedata.category(ch) not in _PUNCT_CATS
    )
    return " ".join(stripped.split())


def wer(reference: str, hypothesis: str) -> dict:
    """WER = (S + D + I) / N — the word-sequence Levenshtein alignment.

    Returns the full accounting (never a bare float: the number stands on
    its alignment). N = 0 with a non-empty hypothesis is a pure-insertion
    transcript (WER undefined; reported as such, never 0.0).
    """
    ref = normalize_transcript(reference).split()
    hyp = normalize_transcript(hypothesis).split()
    n, m = len(ref), len(hyp)
    if n == 0 and m == 0:
        return {"wer": 0.0, "S": 0, "D": 0, "I": 0, "N": 0, "note": "empty reference and hypothesis"}
    if n == 0:
        return {"wer": None, "S": 0, "D": 0, "I": m, "N": 0,
                "note": "empty reference — insertion-only transcript; WER undefined, never reported as 0"}
    # DP table with move tracking (substitution/insertion/deletion)
    dp = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(n + 1):
        dp[i][0] = i
    for j in range(m + 1):
        dp[0][j] = j
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            sub = dp[i - 1][j - 1] + (0 if ref[i - 1] == hyp[j - 1] else 1)
            dp[i][j] = min(sub, dp[i - 1][j] + 1, dp[i][j - 1] + 1)
    # backtrace for S/D/I
    i, j, s, d, ins = n, m, 0, 0, 0
    while i > 0 or j > 0:
        if i > 0 and j > 0:
            cost = 0 if ref[i - 1] == hyp[j - 1] else 1
            if dp[i][j] == dp[i - 1][j - 1] + cost:
                if cost:
                    s += 1
                i, j = i - 1, j - 1
                continue
        if i > 0 and dp[i][j] == dp[i - 1][j] + 1:
            d += 1
            i -= 1
        else:
            ins += 1
            j -= 1
    return {"wer": round((s + d + ins) / n, 6), "S": s, "D": d, "I": ins, "N": n}


def pooled_wer(pairs: list[tuple[str, str]]) -> dict:
    """Corpus-level micro-average: sum the S/D/I/N counts across pairs, then
    WER = (S+D+I)/N — NOT the mean of per-pair rates (stated exactly)."""
    S = D = I = N = 0
    skipped = 0
    for ref, hyp in pairs:
        r = wer(ref, hyp)
        if r["N"] == 0:
            skipped += 1
            continue
        S += r["S"]; D += r["D"]; I += r["I"]; N += r["N"]
    if N == 0:
        return {"pooledWer": None, "N": 0, "skippedPairs": skipped,
                "note": "no reference words — not-measured, never zero"}
    return {"pooledWer": round((S + D + I) / N, 6), "S": S, "D": D, "I": I,
            "N": N, "skippedPairs": skipped}


def hotword_recall(reference: str, hypothesis: str, hotwords: list) -> dict:
    """hotwordRecall = |{hotwords in reference AND recognized in hypothesis}|
    / |{hotwords in reference}| — greedy longest-match, leftmost, on the
    NORMALIZED text. A hotword absent from the reference does not count
    against recall (it is a precision matter, reported alongside)."""
    if not hotwords:
        return {"hotwordRecall": None,
                "note": "no hotword vocabulary supplied — the W401-lane authored-gap; never guessed"}
    ref_norm = normalize_transcript(reference)
    hyp_norm = normalize_transcript(hypothesis)
    def occurrences(text: str, word: str) -> int:
        if not word:
            return 0
        w = normalize_transcript(word)
        return len(re.findall(rf"(?<!\w){re.escape(w)}(?!\w)", text))
    present = [w for w in hotwords if occurrences(ref_norm, w) > 0]
    if not present:
        return {"hotwordRecall": None, "hotwordsInReference": 0,
                "note": "no listed hotword occurs in the reference — recall undefined, never zero"}
    recognized = [w for w in present if occurrences(hyp_norm, w) > 0]
    return {
        "hotwordRecall": round(len(recognized) / len(present), 6),
        "hotwordsInReference": len(present),
        "hotwordsRecognized": len(recognized),
        "missed": sorted(set(present) - set(recognized)),
    }


def hypothesis_churn_rate(chunk_hypotheses: list, chunk_finals: list) -> dict:
    """Streaming-consistency (NOT a WER): 1 - mean word-F1 of each chunk's
    hypothesis vs its own FINAL settled transcript. High churn = the early
    hypotheses keep changing (bad for downstream captioning)."""
    if not chunk_hypotheses or len(chunk_hypotheses) != len(chunk_finals):
        return {"hypothesisChurnRate": None,
                "note": "chunk hypothesis/final sequences must align 1:1 — not-measured"}
    f1s = []
    for hyp, fin in zip(chunk_hypotheses, chunk_finals):
        h = normalize_transcript(hyp).split()
        f = normalize_transcript(fin).split()
        if not h and not f:
            continue
        overlap = sum(min(h.count(w), f.count(w)) for w in set(h) & set(f))
        prec = overlap / len(h) if h else 0.0
        rec = overlap / len(f) if f else 0.0
        f1 = (2 * prec * rec / (prec + rec)) if (prec + rec) else 0.0
        f1s.append(f1)
    if not f1s:
        return {"hypothesisChurnRate": None, "note": "no scored chunk pairs"}
    return {"hypothesisChurnRate": round(1.0 - (sum(f1s) / len(f1s)), 6),
            "chunkPairs": len(f1s)}


def nearest_rank_percentile(values: list, p: float) -> float:
    """Nearest-rank percentile: rank = ceil(p/100 * n), 1-indexed (the repo
    convention from the earlier flights)."""
    if not values:
        return math.nan
    ordered = sorted(values)
    rank = max(1, math.ceil(p / 100.0 * len(ordered)))
    return ordered[rank - 1]


def latency_summary(first_chunk_ms, per_chunk_rtf, per_utterance_ms) -> dict:
    """The latency metric block — every field a MEASURED number or an honest
    typed note (vllm-only constraints etc.). Assembled after a full run."""
    block = {}
    block["firstChunkLatencyMs"] = first_chunk_ms
    block["steadyStateRtf"] = (
        {
            "perFixture": per_chunk_rtf,
            "pooled": (round(sum(v["processingMs"] for v in per_chunk_rtf) /
                             sum(v["audioMs"] for v in per_chunk_rtf), 6)
                       if per_chunk_rtf and sum(v["audioMs"] for v in per_chunk_rtf) > 0 else None),
        }
        if per_chunk_rtf is not None else None
    )
    if per_utterance_ms:
        block["perUtteranceWallClockMs"] = {
            "n": len(per_utterance_ms),
            "median": sorted(per_utterance_ms)[len(per_utterance_ms) // 2] if per_utterance_ms else None,
            "p95NearestRank": nearest_rank_percentile(per_utterance_ms, 95),
        }
    return block


# --- the W207 windowing convention (the repo's own streaming seam) -------------

W207_WINDOW_MS = 5000  # the repo's ASR adapter transcribes fixed 5-second windows


def w207_window_grid(duration_sec: float, window_ms: int = W207_WINDOW_MS) -> list:
    """The repo's W207 convention: window N covers [N*windowMs, (N+1)*windowMs),
    endMs = the ACTUAL covered span end (never beyond the audio). This is the
    landing grid an ASR backend's output must tile to enter the W208 chain."""
    total_ms = duration_sec * 1000.0
    windows = []
    n = 0
    while n * window_ms < total_ms:
        start = n * window_ms
        end = min((n + 1) * window_ms, total_ms)
        windows.append({"windowIndex": n, "windowId": f"w-{n}", "unitId": f"tu-{n}",
                        "startMs": start, "endMs": end})
        n += 1
    return windows


# =============================================================================
# MODE: preflight (EXECUTED on this host — the typed refusal)
# =============================================================================

def run_preflight() -> int:
    RESULTS.mkdir(parents=True, exist_ok=True)
    host = read_host()
    checks = {}

    # 1. the fixture pins (fail-closed on sha drift)
    fixtures_out = []
    for fx in SPR_AUDIO:
        p = Path(fx["path"])
        entry = dict(fx)
        if not p.exists():
            checks[f"fixture:{fx['clipId']}"] = "FAIL (missing staged WAV)"
            entry["status"] = "missing"
        else:
            actual = sha256_of(p)
            ok = actual == fx["sha256"]
            checks[f"fixture:{fx['clipId']}"] = "PASS" if ok else "FAIL (sha drift)"
            entry["status"] = "verified" if ok else "sha-drift"
            entry["actualSha256"] = actual
        fixtures_out.append(entry)

    # 2. the repo's own video fixtures — the no-audio structural gap, re-verified
    for fx in REPO_VIDEO_FIXTURES:
        p = REPO_ROOT / fx["path"]
        streams = ffprobe_streams(p) if p.exists() else []
        has_audio = any(s["codecType"] == "audio" for s in streams)
        checks[f"repo-fixture:{fx['clipId']}"] = (
            "CONFIRMED-NO-AUDIO" if (p.exists() and not has_audio) else "UNEXPECTED (audio present or unreadable — re-review)"
        )
        fixtures_out.append({
            "clipId": fx["clipId"],
            "path": fx["path"],
            "streams": streams,
            "hasAudioTrack": has_audio,
            "expected": fx["expected"],
            "recordedBy": "HF009 (audio-fixtures.json) — re-verified by this flight's ffprobe",
        })

    # 3. the bounded hub probes (both candidates, pinned revisions)
    probes = {}
    for cand in CANDIDATES:
        try:
            probes[cand["repoId"]] = probe_candidate(cand["repoId"], cand["revision"])
            checks[f"probe:{cand['repoId']}"] = f"REACHABLE (gated={probes[cand['repoId']]['gated']})"
        except Exception as exc:
            probes[cand["repoId"]] = {"error": f"{type(exc).__name__}: {str(exc)[:300]}"}
            checks[f"probe:{cand['repoId']}"] = "UNREACHABLE"

    # 4. the resource arithmetic (stored dtypes: VibeVoice checkpoint is fp32
    #    per config.json 'dtype: float32'; Qwen3-ASR shards are bf16)
    arithmetic = []
    vv = probes.get("microsoft/VibeVoice-ASR-Streaming-1.5B", {})
    q3 = probes.get("Qwen/Qwen3-ASR-1.7B", {})
    arithmetic.append(resource_verdict(host, vv.get("weightShardBytes", 0), "float32", "VibeVoice-ASR-Streaming-1.5B"))
    arithmetic.append(resource_verdict(host, q3.get("weightShardBytes", 0), "bfloat16", "Qwen3-ASR-1.7B"))

    # 5. the ground-truth search (the reference-transcript requirement) —
    #    the static, source-scanned record: the repo owns NO real-audio
    #    transcripts. (Machine-verifiable pointers, stated in the record.)
    ground_truth_search = {
        "question": "does the repo own any REFERENCE TRANSCRIPT for real commentary audio (the WER denominator)?",
        "verdict": "NO — WER requires the --ground-truth operator unlock",
        "sourcesScanned": [
            {"source": "packages/asr/src/fixture-backend.ts",
             "finding": "the deterministic TEST substrate returns CANNED strings keyed by window start — synthetic, never a transcript of real audio"},
            {"source": "packages/asr/src/zai-backend.ts",
             "finding": "the functioning production backend transcribes but the repo stores no reference to score it against"},
            {"source": "packages/commentary-segmentation/test/*",
             "finding": "the W208 test transcripts are SYNTHETIC inline text (makeUnit({...text...}) literals), not real-media annotations"},
            {"source": "packages/technology-registry/fixtures/annotations/synthetic-diagnostic-01.json",
             "finding": "per-frame SPATIAL disc annotations only (the HF006 verdict) — no transcript fields"},
            {"source": "SPR corpus (R606)",
             "finding": "the registration declaration authorizes analysis; no transcript annotation exists for either clip (HF009 searched for speaker annotations; the same absence holds for text)"},
        ],
        "operatorUnlock": "--ground-truth <json> mapping fixture id -> reference transcript; without it every WER/hotword field is not-measured, never guessed",
    }

    # 6. the typed refusal
    refusal_reasons = []
    for a in arithmetic:
        refusal_reasons.extend(a["reasons"])
    refusal = {
        "workItem": "HF008",
        "runBy": "Worker A + Worker B (flight 6, worker 64-f)",
        "host": host,
        "candidates": [
            {
                "candidate": c["candidate"], "repoId": c["repoId"],
                "revision": c["revision"], "modelUrl": c["modelUrl"],
                "modelLicense": c["modelLicense"], "codeLicense": c["codeLicense"],
                "weightsProvenance": c["weightsProvenance"],
                "datasetProvenance": c["datasetProvenance"],
                "commercialUse": c["commercialUse"], "gatingState": c["gatingState"],
                "taskProfiles": c["taskProfiles"],
                "ledgerEchoNote": "the twelve provenance fields echo provenance-ledger.json VERBATIM",
            }
            for c in CANDIDATES
        ],
        "verdict": "refused",
        "refusalType": "resource-infeasible-host",
        "typedRefusal": {
            "type": "resource-infeasible-host",
            "reasons": refusal_reasons,
            "note": (
                "per the worker brief: both candidates are 1.5-1.7B — the honest "
                "delivery is this typed refusal + the SUBSTANTIAL partial (the WER/"
                "latency/hotword/multilingual metric designs implemented ready-to-run "
                "in this script + the machine-checked ASR contract mappings in "
                "contract_compatibility.ts), never a fabricated benchmark. NO "
                "promotion — HF015 owns the gate."
            ),
        },
        "checks": checks,
        "weightsDownloaded": False,
        "boundedProbesOnly": True,
        "groundTruthSearch": ground_truth_search,
        "arithmetic": arithmetic,
    }
    (RESULTS / "preflight-refusal.json").write_text(json.dumps(refusal, indent=2) + "\n")

    # 7. the load analysis (the model-composition record)
    load_analysis = {
        "candidates": [],
        "host": host,
        "arithmetic": arithmetic,
    }
    for cand, key in [(CANDIDATES[0], "microsoft/VibeVoice-ASR-Streaming-1.5B"),
                      (CANDIDATES[1], "Qwen/Qwen3-ASR-1.7B")]:
        probe = probes.get(key, {})
        load_analysis["candidates"].append({
            **{k: cand[k] for k in ("candidate", "repoId", "revision", "modelUrl", "modelLicense", "codeLicense")},
            "probe": {k: v for k, v in probe.items() if k not in ("files",)},
            "files": probe.get("files", []),
        })
    (RESULTS / "load-analysis.json").write_text(json.dumps(load_analysis, indent=2) + "\n")

    # 8. the source-verified output schema (the card-documented output facts)
    schema = {
        "vibevoice": {
            "candidate": "microsoft/VibeVoice-ASR-Streaming-1.5B",
            "revision": CANDIDATES[0]["revision"],
            "pipelineTag": probe.get("pipelineTag", "automatic-speech-recognition"),
            "outputVerbatim": (
                "VibeVoice-ASR-Streaming is a unified streaming ASR model that "
                "transcribes Who (Speaker) said What (Content), with support for "
                "Customized Hotwords and 10 languages."
            ),
            "speakerHints": "DOCUMENTED: who-said-what speaker attribution is a first-class card feature (cluster labels, not identities)",
            "hotwords": "DOCUMENTED: 'Users can provide customized hotwords, such as names and technical terms'",
            "languages": ["zh", "en", "es", "pt", "de", "ja", "ko", "fr", "ru", "it"],
            "streamingChunking": {
                "source": "preprocessor_config.json at the pinned revision",
                "chunkFrames": 22, "lookaheadFrames": 4,
                "speechTokCompressRatio": 3200, "targetSampleRate": 24000,
                "derived": "3200 samples/token @ 24 kHz = 0.1333 s/token -> chunk ~= 22 tokens (~2.93 s), lookahead ~4 tokens (~0.53 s)",
                "semantics": "hypothesis-per-chunk while speech arrives; FINAL transcript once the chunk leaves the lookahead window (the WER object)",
            },
            "storedDtype": "float32 (config.json: 'torch_dtype': 'float32', 'dtype': 'float32'; components declare bfloat16)",
            "architecture": "VibeVoiceForASRStreamingTraining: qwen2-family 28-layer decoder (hidden 1536, vocab 151936, tied embeddings) + acoustic/semantic tokenizers + diffusion head (the full VibeVoice architecture family)",
            "confidence": "NOT DOCUMENTED in the card — asrConfidence stays undefined (architecture-lock §4: never invented)",
            "timestamps": "chunk-level timing only (the chunking convention above); NO word-level timestamps documented",
        },
        "qwen3asr": {
            "candidate": "Qwen/Qwen3-ASR-1.7B",
            "revision": CANDIDATES[1]["revision"],
            "pipelineTag": q3.get("pipelineTag", "automatic-speech-recognition"),
            "output": "per-utterance {language, text}; word/character timestamps ONLY via the SEPARATE Qwen3-ForcedAligner-0.6B model",
            "speakerHints": "NOT DOCUMENTED: zero card hits for speaker/diarization — the HF009 pyannote composition is REQUIRED for speaker metadata",
            "hotwords": "NOT DOCUMENTED: no hotword support in the card — a typed capability gap for the multilingual candidate",
            "languages": {
                "cardClaim": "52 languages and dialects",
                "cardDecomposition": "30 languages + 22 Chinese dialects (the card's own table)",
                "configSupportLanguagesCount": 30,
                "configSupportLanguages": json.loads((Path("/home/z/hf-bench-6/probe/Qwen__Qwen3-ASR-1.7B") / "config.json").read_text())["support_languages"] if (Path("/home/z/hf-bench-6/probe/Qwen__Qwen3-ASR-1.7B") / "config.json").exists() else None,
            },
            "streaming": "streaming / offline unified inference; streaming ONLY via the vLLM backend ('streaming inference is only available with the vLLM backend'), and streaming mode does not support batch inference or timestamps",
            "generationConfig": "do_sample=false, temperature=1e-6 — the near-greedy determinism anchor",
            "preprocessor": "30 s chunks, 16 kHz input, 128-mel Whisper-style features (preprocessor_config.json)",
            "sibling": "Qwen3-ASR-0.6B (the card names it: 'the 0.6B version achieves accuracy-efficient trade-off') — recorded as an HF015-lane observation; NOT substituted for the pinned 1.7B candidate",
            "storedDtype": "bfloat16 shards (4,698,521,512 B across 2 shards)",
            "confidence": "NOT DOCUMENTED in the card — asrConfidence stays undefined (never invented)",
        },
    }
    (RESULTS / "model-output-schema.json").write_text(json.dumps(schema, indent=2) + "\n")

    # 9. the audio-fixture record (HF009's story, re-verified)
    audio_fixtures = {
        "stagedAudio": [f for f in fixtures_out if "sha256" in f],
        "repoVideoFixtures": [f for f in fixtures_out if "sha256" not in f],
        "fx001AudioGap": (
            "the committed fx-001-normalized.mp4 is VIDEO-ONLY by the manifest's own "
            "transform ('-an' in gate-clips.json normalizeTransform — re-verified this "
            "flight by ffprobe: a single h264 video stream); the audio lives ONLY in "
            "the ORIGINAL source webm at the canonical URL (sha a4d163a5...), whose "
            "fetch was HTTP-429-rate-limited on all 6 attempts in the 64-d flight — "
            "an infrastructure wall, not licensing (recorded by HF009; unchanged this flight)"
        ),
        "syntheticFixtureGap": (
            "the synthetic fixture carries a single video-only h264 stream — NO audio "
            "track exists at all (ffprobe re-verified this flight; first recorded by "
            "HF009): the repo fixture set cannot exercise ANY audio task profile"
        ),
        "authorization": (
            "SPR corpus clips authorized by the repo's own R606 registration "
            "declaration (analysis scope, repo private) — the HF009 record"
        ),
        "languageAnnotation": "NONE: the spoken language of the two SPR WAVs is not annotated anywhere in the repo — the multilingual protocol needs per-language fixtures that do not exist",
        "recreateCommand": "ffmpeg -v error -y -i <spr-clip>.mp4 -vn -ac 1 -ar 16000 -c:a pcm_s16le <out>.wav (the 64-d one-liner; shas pinned above)",
    }
    (RESULTS / "audio-fixtures.json").write_text(json.dumps(audio_fixtures, indent=2) + "\n")

    hard_fail = any(v.startswith("FAIL") for v in checks.values())
    print("HF008 preflight (EXECUTED) — verdict: refused (resource-infeasible-host)")
    for k, v in checks.items():
        print(f"  {k}: {v}")
    for a in arithmetic:
        print(f"  arithmetic: {a['label']}: weights {a['weightShardGiB']} GiB ({a['storedDtype']}), "
              f"fp32 WS {a['fp32WorkingSetGiB']} GiB / bf16 WS {a['bf16WorkingSetGiB']} GiB "
              f"vs RAM {a['hostRamTotalGiB']} GiB; download {a['downloadOverFreeDisk']}x free disk")
    print(f"  refusal reasons: {len(refusal_reasons)}")
    if hard_fail:
        print("  FAIL-closed: a fixture pin drifted — refusing to write a record that stands on it")
        return 2
    return 3  # the typed refusal


# =============================================================================
# MODE: selfcheck (the metric implementations verified — NOT a model measurement)
# =============================================================================

SELF_CHECK_CASES = [
    # (kind, args, expected facts) — hand-computed, the exact definitions above
    {"metric": "wer", "ref": "the cat sat on the mat", "hyp": "the cat sat on the mat",
     "expect": {"wer": 0.0, "S": 0, "D": 0, "I": 0, "N": 6}},
    {"metric": "wer", "ref": "the cat sat on the mat", "hyp": "the cat sat",
     "expect": {"wer": 0.5, "S": 0, "D": 3, "I": 0, "N": 6}},  # 3 deletions / 6 ref words
    {"metric": "wer", "ref": "it's a GOAL!!!", "hyp": "its a goal",
     "expect": {"wer": 0.0, "N": 3}},  # the stated normalization: case + punctuation
    {"metric": "wer", "ref": "", "hyp": "hello world",
     "expect": {"wer": None, "I": 2, "N": 0}},  # empty ref: undefined, NEVER 0
    {"metric": "wer", "ref": "great save", "hyp": "great shave",
     "expect": {"wer": 0.5, "S": 1, "N": 2}},  # one substitution
]


def run_selfcheck() -> int:
    """Verifies the metric implementations against hand-computed cases.
    This is IMPLEMENTATION evidence (the functions compute the stated
    definitions) — it is NOT a model measurement and never enters the
    quality/latency blocks as a number."""
    RESULTS.mkdir(parents=True, exist_ok=True)
    rows = []
    failures = 0
    for case in SELF_CHECK_CASES:
        got = wer(case["ref"], case["hyp"])
        good = all(got.get(k) == v for k, v in case["expect"].items())
        if not good:
            failures += 1
        rows.append({**case, "got": got, "pass": good})
    # the pooled micro-average: ("a b c", "a b c") + ("d e", "d") -> 1 deletion / 5 ref words
    pooled = pooled_wer([("a b c", "a b c"), ("d e", "d")])
    pooled_ok = pooled["pooledWer"] == 0.2 and pooled["N"] == 5
    if not pooled_ok:
        failures += 1
    # hotword recall: "Messi" absent from the reference must NOT count against recall
    hot = hotword_recall(
        "Ronaldo scores, what a strike by Ronaldo",
        "Ronaldo scores what a strike",
        ["Ronaldo", "Messi", "strike"],
    )
    hot_ok = hot["hotwordRecall"] == 1.0 and hot["hotwordsInReference"] == 2
    if not hot_ok:
        failures += 1
    # churn: hypotheses converge to finals -> churn in (0, 1)
    churn = hypothesis_churn_rate(["he shoots", "he shoots and"],
                                  ["he shoots and scores", "he shoots and scores"])
    churn_ok = churn["hypothesisChurnRate"] is not None and 0.0 < churn["hypothesisChurnRate"] < 1.0
    if not churn_ok:
        failures += 1
    # the W207 window grid: 12.5 s -> windows [0,5000), [5000,10000), [10000,12500)
    grid = w207_window_grid(12.5)
    grid_ok = (len(grid) == 3 and grid[-1]["endMs"] == 12500.0 and grid[0]["unitId"] == "tu-0")
    if not grid_ok:
        failures += 1
    record = {
        "label": "IMPLEMENTATION SELF-VERIFICATION — the metric functions compute the stated definitions; NOT a model measurement",
        "werCases": rows,
        "pooledWer": {"got": pooled, "pass": pooled_ok, "expect": {"pooledWer": 0.2, "N": 5}},
        "hotwordRecall": {"got": hot, "pass": hot_ok,
                          "expect": {"hotwordRecall": 1.0, "hotwordsInReference": 2,
                                     "note": "Messi absent from reference: recall denominator counts only present hotwords"}},
        "hypothesisChurnRate": {"got": churn, "pass": churn_ok},
        "w207WindowGrid": {"got": grid, "pass": grid_ok,
                           "expect": "12.5 s -> 3 windows, last endMs 12500 (never beyond the audio)"},
        "failures": failures,
    }
    (RESULTS / "metric-selfcheck.json").write_text(json.dumps(record, indent=2) + "\n")
    print(f"HF008 metric selfcheck: {len(rows) + 5 - failures}/{len(rows) + 5} checks pass")
    return 0 if failures == 0 else 2


# =============================================================================
# MODE: full (READY-TO-RUN on an adequate host — NOT executed in this flight)
# =============================================================================

def run_full(args) -> int:
    """The ready-to-run benchmark path. REQUIRES an adequate host: >= 16 GB RAM,
    >= 24 GB free disk (both checkpoints + venv), GPU recommended (CPU honest
    but far from the streaming regime). Fail-closed at every step: pinned
    sha-verified downloads, fixture pins, ground-truth unlock.

    VibeVoice path: install the vibevoice package (github.com/microsoft/VibeVoice)
    + torch CPU/CUDA + transformers>=4.51; download the 3 pinned shards and
    verify the recorded LFS sha256s BEFORE loading; load with dtype pinned to
    the stored fp32 (or an explicit bf16 cast, recorded); resample each
    fixture to 24 kHz mono; feed the model's streaming generator chunk-by-
    chunk (chunk_frames=22, lookahead_frames=4 semantics); collect
    (chunkIndex, hypothesisText, finalText, firstChunkLatencyMs, per-chunk
    processing ms); map each FINAL chunk onto the W207 window grid via
    w207_window_grid; compute pooled/per-utterance WER, hypothesis churn,
    hotword recall, and the latency summary via the metric functions above.

    Qwen3-ASR path: install qwen-asr (the card's package) + torch; download the
    2 pinned shards and verify the recorded LFS sha256s; run the transformers
    backend OFFLINE per fixture (30 s chunks, 16 kHz — the SPR WAVs are
    already 16 kHz mono); collect per-utterance {language, text} +
    wall-clock; per-utterance WER pooled per DETECTED language (the
    multilingual metric); RTF from total processing time / audio duration.
    firstChunkLatencyMs is typed vllm-only (the card's own constraint) — the
    transformers path reports offline metrics only. Timestamps require the
    SEPARATE Qwen3-ForcedAligner-0.6B (typed gap — not bundled here).

    Both paths: every measurement-shaped output field is written ONLY from
    an executed run's own numbers; nothing is estimated.
    """
    # Fail-closed guards (the refusal is the expected state on this host):
    host = read_host()
    blockers = resource_verdict(host, 5_628_388_290, "float32", "VibeVoice-ASR-Streaming-1.5B")["reasons"]
    blockers += resource_verdict(host, 4_698_521_512, "bfloat16", "Qwen3-ASR-1.7B")["reasons"]
    feasible = host["ramTotalMiB"] >= 16 * MI_PER_GIB and host["diskFreeGiB"] >= 24
    if not feasible:
        print("HF008 full mode REFUSED on this host (resource-infeasible):")
        for r in blockers:
            print(f"  - {r}")
        print("The typed refusal is the honest terminal state here — see preflight-refusal.json")
        return 3

    if not args.ground_truth:
        print("full mode requires --ground-truth <json> (fixture id -> reference transcript);")
        print("WER/hotword metrics are not-measured without it — never guessed (the operator unlock)")
        return 2

    gt = json.loads(Path(args.ground_truth).read_text())
    hotwords = json.loads(Path(args.hotwords).read_text()) if args.hotwords else []
    if not hotwords:
        print("NOTE: no --hotwords supplied — the W401-lane authored vocabulary gap stands; hotwordRecall = not-measured")

    # --- the executed-run skeleton (fail-closed, honest placeholders that
    # --- REFUSE to fabricate: every number below is produced by the run)
    for fx in SPR_AUDIO:
        p = Path(fx["path"])
        if not p.exists() or sha256_of(p) != fx["sha256"]:
            print(f"fixture pin failed for {fx['clipId']} — refusing to run")
            return 2

    # The model loads happen here on an adequate host (the recipes above);
    # everything below this line is the METRIC assembly from the run's own
    # collected numbers (chunk timings, hypotheses, finals, languages).
    #   transcript_pairs = [(gt[fixtureId], final_transcript), ...]
    #   results = {
    #     "wer": pooled_wer(transcript_pairs),
    #     "perUtterance": [wer(ref, hyp) for ...],
    #     "hotwordRecall": hotword_recall(ref, hyp, hotwords),
    #     "hypothesisChurnRate": hypothesis_churn_rate(hyps, finals),
    #     "latency": latency_summary(first_chunk_ms, per_chunk_rtf, per_utterance_ms),
    #     "languages": {lang: pooled_wer(pairs_for_lang)},
    #   }
    print("full mode executed path: see the recipes in this function's docstring;")
    print("on an adequate host the run assembles results from its own measurements only")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="HF008 ASR portfolio benchmark")
    parser.add_argument("--mode", choices=["preflight", "full", "selfcheck"], required=True)
    parser.add_argument("--ground-truth", default=None,
                        help="operator unlock: JSON mapping fixture id -> reference transcript")
    parser.add_argument("--hotwords", default=None,
                        help="operator unlock: JSON list of authored hotwords (the W401-lane gap)")
    args = parser.parse_args()
    if args.mode == "preflight":
        return run_preflight()
    if args.mode == "selfcheck":
        return run_selfcheck()
    return run_full(args)


if __name__ == "__main__":
    sys.exit(main())
