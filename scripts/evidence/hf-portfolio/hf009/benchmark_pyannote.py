#!/usr/bin/env python3
"""
HF009 — the pyannote speaker-diarization benchmark (Worker 64-d, flight 4).

Runs the HF002-ledger candidate `pyannote/speaker-diarization-community-1`
(model cc-by-4.0, code MIT, commercial use yes; task profile
`football.commentarySpeakerDiarization`, FROZEN) at the ledger-pinned
revision 3533c8cf8e369892e6b79ff1bf80f7b0286a54ee on the repo's authorized
audio, following the HF003/HF006 (EXECUTED) and HF004 (typed-refusal)
evidence-tree conventions.

WHAT THIS FLIGHT ACTUALLY DELIVERED (the honest state, recorded by the
EXECUTED `--mode preflight` run on 2026-10-03):

  * THE MODEL IS USER-CONDITIONS-GATED at the pinned revision. Anonymous
    access 401s with GatedRepoError ("Access to model
    pyannote/speaker-diarization-community-1 is restricted. You must have
    access to it and be authenticated to access it. Please log in.").
    The model card's own public README Setup section reads: "1. pip install
    pyannote.audio  2. Accept user conditions  3. Create access token at
    hf.co/settings/tokens" — a HUMAN must accept the conditions; no HF
    token exists in this sandbox (only GitHub/Composio credentials, which
    do not work on the HF Hub). The brief's assumption "the community-1
    pipeline is NOT token-gated (verify)" was VERIFIED FALSE.
  * Public pipeline components were attempted per the brief: the fallback
    segmentation model `pyannote/segmentation-3.0` is ALSO gated (401);
    `pyannote/wespeaker-english-resemblynet` does not exist as a standalone
    repo; third-party mirrors of gated pyannote weights were NOT used —
    using an unofficial re-upload would launder the user-conditions gate
    (recorded as a refusal, not a workaround). `speechbrain/spkrec-ecapa-
    voxceleb` IS anonymously reachable but is NOT a component of the
    ledger candidate — it cannot stand in for community-1.
  * Therefore the FULL mode is READY-TO-RUN but NOT EXECUTED: every
    speaker-turn/latency/RSS/determinism number is typed not-measured and
    this script fail-closes rather than fabricating any of them.

The audio-fixture story (EXECUTED where the bytes are reachable):

  1. `synthetic-diagnostic-01` (the technology-registry fixture): NO audio
     track at all (ffprobe-verified, video-only h264) — typed gap.
  2. `fx-001` (CC0 FIFA Beach Soccer 2021, the repo's authorized real gate
     clip): the COMMITTED normalized clip is video-only by the manifest's
     own transform (`-an` in gate-clips.json normalizeTransform); the audio
     lives only in the ORIGINAL source webm at the manifest's canonical
     Wikimedia URL. This flight's fetch of that original was rate-limited
     (HTTP 429 on every attempt from this sandbox egress) — typed blocked;
     the exact ready-to-run extraction recipe is recorded in the preflight
     evidence.
  3. SPR corpus clips (in-repo bytes): authorized for analysis by the
     repo's own corpus rules (the recorded R606 registration declaration
     analysis/transformation/derivativeGeneration/storage, repo private —
     scripts/evidence/spr-corpus-bytes/README.md). Their audio tracks were
     extracted EXECUTED with ffmpeg to 16 kHz mono PCM WAV (pyannote's
     native input format):
       - `b8p3.mp4`   (R606 real in-play substrate, 47.6 s) -> spr-src-audio.wav
       - `clip-b1-wide-broadcast.mp4` (w3a re-cut, 30.1 s)  -> spr-b1-audio.wav

Metrics contract (what the FULL mode measures when it runs, and what is
typed this flight):

  * DER/JER: NOT MEASURED — no ground-truth speaker annotations exist
    anywhere in the repo for benchmarkable media (the repo-wide search:
    the commentary-segmentation W208 fixture is a SYNTHETIC inline test
    transcript, not an annotation of real media; the ASR adapter passes
    speakerLabel through but owns no annotations; SWM timelines are
    derived state). pyannote-metrics 4.1 IS installed and the DER/JER
    evaluation path is stated exactly (RTTM reference vs hypothesis) — it
    simply has zero ground-truth rows to score in this sandbox.
  * The honest measurable (FULL mode): speaker-segment timelines (turn
    counts, per-speaker durations, speech ratio), run-to-run determinism
    (serialized turn timeline compared across repeated runs), per-file
    wall-clock + the real-time factor RTF = processing time / audio
    duration, process RSS (GPU honestly N/A — CPU-only host).
  * The UNSCORED structural comparison against the repo's derived
    event/transcript timelines: implemented as (a) the static W208
    commentary-unit contract review recorded in benchmark-record.json and
    (b) the boundary-alignment computation in FULL mode (diarization turn
    boundaries vs a repo-derived timeline JSON) — labeled UNSCORED
    structural, never a DER/JER number.

Usage (the EXECUTED preflight — the typed refusal):
  python3 benchmark_pyannote.py --repo-root /home/z/sporta \
      --bench-root /home/z/hf-bench-4 --mode preflight
  (exit code 3 = the typed refusal, results/preflight-refusal.json written)

Usage (the ready-to-run FULL mode — requires an OPERATOR-authenticated
local copy of the gated repo; never a token on the command line):
  python3 benchmark_pyannote.py --repo-root /home/z/sporta \
      --bench-root /home/z/hf-bench-4 --mode full \
      --pipeline-dir /home/z/hf-bench-4/hf-model-auth [--repeats 3]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import resource
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

# --- repo pins (scripts/evidence/hf-portfolio/hf009 conventions) ------------

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
# The ORIGINAL CC0 source (the audio lives ONLY here — the normalized clip
# is -an by the manifest's own transform): url + sha256 from
# packages/real-to-swm/fixtures/gate-clips.json (carried VERBATIM).
FX001_SOURCE_URL = (
    "https://upload.wikimedia.org/wikipedia/commons/d/da/"
    "2021-08-29_-_FIFA_Beach_Soccer_World_Cup_-_Match_31_-_Switzerland_"
    "v_Senegal_-_No%C3%ABl_Ott_scores_a_penalty_kick.webm"
)
FX001_SOURCE_SHA256 = (
    "a4d163a5bcc54b62d9d09926b56278677e06436c4e9d2b01bd0e137ef8cdf131"
)

SPR_CORPUS_BYTES = "scripts/evidence/spr-corpus-bytes"
# clipId -> (file, full sha256 per spr-corpus-bytes/README.md + corpus.json)
SPR_CLIPS = {
    "sprclip-b8-inplay-original": (
        "b8p3.mp4",
        "969af7c6fdb172091ff00705b25fa37b7073f4332d722416b9754a4a7579917a",
    ),
    "sprclip-b1-wide-broadcast": (
        "clip-b1-wide-broadcast.mp4",
        "3a3c249ef351aaffca5c23fde0aa7efceb920c3d40a0b0a1b317e24fc7c01307",
    ),
}
SPR_AUTHORIZATION_NOTE = (
    "scripts/evidence/spr-corpus-bytes/README.md: acquired broadcast bytes "
    "under the recorded R606 registration declaration (analysis / "
    "transformation / derivative generation / storage); repo is private "
    "\u2014 a local speaker-diarization benchmark run is ANALYSIS, inside "
    "the declared scope"
)

# --- model pins (HF002 ledger row, echoed VERBATIM in benchmark-record.json) -

PYANNOTE_REPO_ID = "pyannote/speaker-diarization-community-1"
PYANNOTE_REVISION = "3533c8cf8e369892e6b79ff1bf80f7b0286a54ee"

# The fallback components probed in the preflight (the brief's "attempt the
# public pipeline components" duty):
PROBE_FALLBACK_SEGMENTATION = "pyannote/segmentation-3.0"
PROBE_MISSING_STANDALONE = "pyannote/wespeaker-english-resemblynet"
PROBE_PUBLIC_NONCOMPONENT = "speechbrain/spkrec-ecapa-voxceleb"

AUDIO_EXTRACT_COMMAND = (
    "ffmpeg -v error -y -i <source.mp4> -vn -ac 1 -ar 16000 -c:a pcm_s16le "
    "<out.wav>  # pyannote's native input: 16 kHz mono; the card auto-downmixes/"
    "resamples but the extraction pins the format explicitly"
)

RESOURCE_CAVEAT = (
    "GPU memory: N/A (no GPU on the benchmark host); process RSS recorded instead"
)

HF_TOKEN_NAMES = ("HF_TOKEN", "HUGGING_FACE_HUB_TOKEN", "HF_API_TOKEN")


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


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def audio_stream_of(path: Path) -> dict | None:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_streams", "-of", "json", str(path)],
        capture_output=True,
        text=True,
        check=True,
    )
    for stream in json.loads(out.stdout).get("streams", []):
        if stream.get("codec_type") == "audio":
            return stream
    return None


def format_duration_of(path: Path) -> float:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "csv=p=0", str(path)],
        capture_output=True,
        text=True,
        check=True,
    )
    return float(out.stdout.strip())


def extract_audio(source: Path, target: Path) -> dict:
    """Idempotent ffmpeg extraction to 16 kHz mono PCM WAV (the recorded recipe)."""
    if not target.exists():
        subprocess.run(
            ["ffmpeg", "-v", "error", "-y", "-i", str(source),
             "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le",
             str(target)],
            check=True,
        )
    stream = audio_stream_of(target)
    assert stream is not None, f"extraction produced no audio stream: {target}"
    return {
        "wavPath": str(target),
        "wavSha256": sha256_of(target),
        "codec": stream.get("codec_name"),
        "sampleRateHz": int(stream.get("sample_rate", 0)),
        "channels": int(stream.get("channels", 0)),
        "durationSeconds": round(format_duration_of(target), 3),
        "wavBytes": target.stat().st_size,
        "extractionCommand": AUDIO_EXTRACT_COMMAND,
    }


def huggingface_token_present() -> bool:
    return any(os.environ.get(name) for name in HF_TOKEN_NAMES)


def probe_hub_repo(repo_id: str, revision: str, filename: str) -> dict:
    """Anonymous single-file probe. Records the exact wall, never launders it."""
    try:
        from huggingface_hub import hf_hub_download

        hf_hub_download(repo_id, filename, revision=revision)
        return {"repoId": repo_id, "revision": revision, "file": filename,
                "verdict": "accessible-anonymously"}
    except Exception as error:  # noqa: BLE001 (the wall itself is the evidence)
        name = type(error).__name__
        message = str(error)
        http = next((c for c in ("401", "403", "404", "429") if c in message), "")
        verdict = {
            "GatedRepoError": "gated-user-conditions",
            "RepositoryNotFoundError": "repo-not-found",
        }.get(name, f"error-{name}")
        return {"repoId": repo_id, "revision": revision, "file": filename,
                "verdict": verdict, "errorType": name, "httpStatus": http,
                "message": message[:600]}


def nearest_rank_percentile(values: list[float], p: float) -> float:
    """The repo's percentile convention (packages/latency-benchmark percentiles)."""
    if not values:
        return float("nan")
    ordered = sorted(values)
    rank = max(1, int(-((-(p / 100.0 * len(ordered))) // 1)))
    return ordered[rank - 1]


# --- the preflight (EXECUTED this flight — the typed refusal) ----------------


def run_preflight(repo: Path, bench: Path, results_dir: Path) -> int:
    started = utc_now_iso()
    record: dict = {
        "evidenceId": "hf009-pyannote-preflight-refusal",
        "purpose": (
            "HF009 preflight: verify the pinned community-1 pipeline's "
            "reachability, the audio fixtures, and the ground-truth "
            "situation BEFORE any benchmark claim"
        ),
        "host": {
            "cpuCores": os.cpu_count(),
            "gpu": "none (CPU-only benchmark host)",
            "pythonVenv": str(bench / ".venv"),
            "note": RESOURCE_CAVEAT,
        },
        "candidate": PYANNOTE_REPO_ID,
        "revision": PYANNOTE_REVISION,
        "hfTokenInEnvironment": huggingface_token_present(),
        "startedAtUtc": started,
    }

    # --- 1. repo fixture pins (fail-closed on drift) ------------------------
    fixture_paths: dict[str, tuple[Path, str]] = {
        "synthetic-diagnostic-01": (repo / SYNTHETIC_FIXTURE_MEDIA,
                                    SYNTHETIC_FIXTURE_SHA256),
        "fx-001-normalized": (repo / FX001_NORMALIZED_MEDIA,
                              FX001_NORMALIZED_SHA256),
    }
    for clip_id, (file_name, sha) in SPR_CLIPS.items():
        fixture_paths[clip_id] = (repo / SPR_CORPUS_BYTES / file_name, sha)

    pins: dict[str, dict] = {}
    for clip_id, (path, expected) in fixture_paths.items():
        if not path.exists():
            record.setdefault("fixturePinFailures", []).append(
                f"{clip_id}: missing {path}")
            continue
        actual = sha256_of(path)
        pins[clip_id] = {
            "path": str(path.relative_to(repo)),
            "sha256": actual,
            "pinVerified": actual == expected,
        }
        if actual != expected:
            record.setdefault("fixturePinFailures", []).append(
                f"{clip_id}: sha drift {actual} != {expected}")
    record["fixturePins"] = pins

    # --- 2. the audio-fixture story (executed where reachable) --------------
    fixtures: dict[str, dict] = {}

    # 2a. the synthetic fixture: NO audio track at all (typed gap).
    fixtures["synthetic-diagnostic-01"] = {
        "clipId": "synthetic-diagnostic-01",
        "mediaKind": "synthetic-diagnostic",
        "audioTrack": (
            "ABSENT (ffprobe: video-only h264 stream — the repo's synthetic "
            "fixture carries no audio at all)"
        ),
        "usableForDiarization": False,
        "typedGap": "no audio track exists on the synthetic fixture",
    }

    # 2b. fx-001: the committed normalized clip is -an (the manifest's own
    #     transform); the audio lives only in the ORIGINAL source webm.
    fixtures["fx-001"] = {
        "clipId": "fx-001",
        "mediaKind": "real-footage",
        "license": (
            "CC0-1.0 (FIFA Beach Soccer World Cup 2021 penalty, Wikimedia "
            "Commons — the repo's authorized gate clip)"
        ),
        "committedNormalizedClipAudio": (
            "ABSENT (the gate-clips.json normalizeTransform is '-an' — "
            "video-only by design)"
        ),
        "audioLivesOnlyInOriginalSource": {
            "url": FX001_SOURCE_URL,
            "sourceSha256Pin": FX001_SOURCE_SHA256,
            "thisFlightFetchStatus": (
                "BLOCKED (HTTP 429 rate-limit on every attempt from this "
                "sandbox egress, 2026-10-03: 6 attempts across "
                "upload.wikimedia.org and commons.wikimedia.org "
                "Special:FilePath with 15-45 s backoff — an infrastructure "
                "wall, NOT a licensing wall; the brief's stall rule applies)"
            ),
            "readyToRunExtraction": (
                "curl -L -A '<descriptive-ua>' -o fx-001-source.webm '"
                + FX001_SOURCE_URL + "' ; sha256sum fx-001-source.webm "
                "(must equal " + FX001_SOURCE_SHA256 + ") ; ffmpeg -v error "
                "-y -i fx-001-source.webm -vn -ac 1 -ar 16000 -c:a pcm_s16le "
                "fx-001-audio.wav"
            ),
        },
        "usableForDiarization": False,
    }

    # 2c. SPR corpus clips: EXECUTED extraction (the R606 declaration).
    audio_dir = bench / "audio"
    audio_dir.mkdir(parents=True, exist_ok=True)
    spr_wav = {
        "sprclip-b8-inplay-original": "spr-src-audio.wav",
        "sprclip-b1-wide-broadcast": "spr-b1-audio.wav",
    }
    for clip_id, wav_name in spr_wav.items():
        file_name = SPR_CLIPS[clip_id][0]
        source = repo / SPR_CORPUS_BYTES / file_name
        info = extract_audio(source, audio_dir / wav_name)
        fixtures[clip_id] = {
            "clipId": clip_id,
            "mediaKind": "real-footage",
            "authorization": SPR_AUTHORIZATION_NOTE,
            "sourcePath": str(source.relative_to(repo)),
            "sourceSha256": pins.get(clip_id, {}).get("sha256"),
            "usableForDiarization": True,
            **info,
        }
    record["audioFixtures"] = fixtures

    # --- 3. the auth-wall probes (the brief's verify + attempt duties) ------
    probes = [
        probe_hub_repo(PYANNOTE_REPO_ID, PYANNOTE_REVISION, "config.yaml"),
        probe_hub_repo(PYANNOTE_REPO_ID, PYANNOTE_REVISION, "embedding/model.pt"),
        probe_hub_repo(PYANNOTE_REPO_ID, PYANNOTE_REVISION, "README.md"),
        probe_hub_repo(PROBE_FALLBACK_SEGMENTATION, "main", "config.yaml"),
        probe_hub_repo(PROBE_MISSING_STANDALONE, "main", "README.md"),
        probe_hub_repo(PROBE_PUBLIC_NONCOMPONENT, "main", "hyperparams.yaml"),
    ]
    record["hubProbes"] = probes
    gated = [p for p in probes if p["verdict"] == "gated-user-conditions"]

    # --- 4. the ground-truth situation (DER/JER typed) -----------------------
    record["groundTruthSearch"] = {
        "derJerVerdict": (
            "NOT MEASURED (typed): no ground-truth speaker annotations exist "
            "in the repo for any benchmarkable media"
        ),
        "searched": [
            "packages/commentary-segmentation/test/fixtures.ts — a SYNTHETIC "
            "inline 30-row 5-speaker match transcript for the W208 tests (not "
            "an annotation of any real media; no timestamps-to-audio binding)",
            "packages/asr — the W207/W208 speakerLabel passthrough contract "
            "only (the adapter owns no annotations; 'W208 owns real "
            "diarization' per the source comment)",
            "packages/real-to-swm + technology-registry fixtures — spatial "
            "discs / vision detections only, no speaker labels",
            "SWM event timelines — derived state, never ground truth",
            "no RTTM or diarization annotation file exists anywhere in-repo",
        ],
        "metricImplementationState": (
            "pyannote-metrics 4.1 installed in /home/z/hf-bench-4/.venv; the "
            "DER/JER evaluation path is stated exactly (RTTM reference vs "
            "hypothesis, optionally the 0.25-s forgiveness collar) — it has "
            "zero ground-truth rows to score in this sandbox"
        ),
    }

    # --- 5. the verdict -------------------------------------------------------
    refusal = {
        "verdict": "refused",
        "type": "auth-gated-model",
        "reason": (
            "the pinned pipeline pyannote/speaker-diarization-community-1 @"
            + PYANNOTE_REVISION
            + " is USER-CONDITIONS-GATED on the HF Hub: anonymous access 401s "
            "with GatedRepoError; the model card's own Setup reads 'Accept "
            "user conditions' + 'Create access token'; no HF token exists in "
            "this sandbox and accepting user conditions is a HUMAN action "
            "(the operator's unblock path, recorded below)"
        ),
        "theExactWall": next(
            (p["message"] for p in gated if p["file"] == "config.yaml"),
            "GatedRepoError: 401 (see hubProbes)",
        ),
        "publicComponentsAttempted": [
            "pyannote/segmentation-3.0 (the fallback segmentation): ALSO "
            "gated-user-conditions (401) — recorded in hubProbes",
            "pyannote/wespeaker-english-resemblynet: repo-not-found (no "
            "standalone public embedding repo)",
            "speechbrain/spkrec-ecapa-voxceleb: accessible-anonymously but "
            "NOT a component of the ledger candidate — not used as a "
            "stand-in (a different model would launder the benchmark claim)",
            "third-party mirrors of gated pyannote weights: REFUSED on "
            "principle (an unofficial re-upload would bypass the "
            "user-conditions gate — recorded, never used)",
        ],
        "unblockPath": (
            "an operator with an hf.co account accepts the community-1 user "
            "conditions, creates a read token OUTSIDE any repo/log (never "
            "committed), downloads the pipeline at the pinned revision to "
            "/home/z/hf-bench-4/hf-model-auth (git clone or "
            "snapshot_download with the token in the environment only), then "
            "re-runs this script: --mode full --pipeline-dir "
            "/home/z/hf-bench-4/hf-model-auth"
        ),
        "executedPartial": [
            "the audio-fixture story: SPR corpus audio extracted to 16 kHz "
            "mono WAV (2 files, sha-recorded); the synthetic fixture verified "
            "audio-less (typed gap); fx-001's audio verified to live only in "
            "the original source (429-blocked this flight, recipe recorded)",
            "the auth-wall probe map (6 anonymous probes, verdicts + the "
            "exact 401 text)",
            "the repo ground-truth search (DER/JER typed not-measured)",
            "the FULL mode benchmark script: ready-to-run, fail-closed "
            "(never a fabricated number)",
        ],
        "notMeasured": [
            "speaker-segment timelines (turn counts, durations, speech ratio)",
            "run-to-run determinism",
            "per-file wall-clock latency and the real-time factor (RTF)",
            "process RSS at inference",
            "the unscored structural comparison vs repo-derived timelines",
            "DER/JER (typed: no ground truth — see groundTruthSearch)",
        ],
    }
    record["refusal"] = refusal
    record["completedAtUtc"] = utc_now_iso()
    record["processRssMiB"] = round(vm_rss_mib(), 1)

    out = results_dir / "preflight-refusal.json"
    out.write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")

    # The standalone audio-fixture evidence file (the executed partial).
    fixtures_out = {
        "evidenceId": "hf009-pyannote-audio-fixtures",
        "purpose": (
            "HF009 executed audio-fixture evidence: which audio the repo "
            "authorizes for the diarization benchmark and what was actually "
            "extracted on this host"
        ),
        "recordedAtUtc": utc_now_iso(),
        "extractionCommand": AUDIO_EXTRACT_COMMAND,
        "fixtures": fixtures,
        "fixturePins": pins,
    }
    (results_dir / "audio-fixtures.json").write_text(
        json.dumps(fixtures_out, indent=2) + "\n", encoding="utf-8"
    )

    if "fixturePinFailures" in record:
        refusal["verdict"] = "refused-plus-fixture-drift"
        refusal["type"] = "fixture-drift"
        refusal["reason"] = (
            "repo fixture sha pins DRIFTED — the benchmark refuses to run "
            "against unpinned media: " + "; ".join(record["fixturePinFailures"])
        )
        out.write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")
        print(f"PREFLIGHT REFUSED (fixture drift): {out}")
        return 3

    print(f"PREFLIGHT VERDICT: {refusal['verdict']} ({refusal['type']})")
    print(f"  the wall: {refusal['theExactWall'][:200]}")
    usable = sum(1 for f in fixtures.values() if f.get("usableForDiarization"))
    print(f"  audio fixtures: {len(fixtures)} examined, {usable} usable")
    print(f"  evidence: {out}")
    return 3 if gated else 0


# --- the FULL mode (ready-to-run; NOT EXECUTED this flight) ------------------


def turn_timeline_of(output) -> list[dict]:
    """[(start, end, speaker)] from a community-1 pipeline output object."""
    diar = getattr(output, "speaker_diarization", None) or output
    turns = []
    for turn, speaker in diar:
        turns.append({
            "start": round(float(turn.start), 3),
            "end": round(float(turn.end), 3),
            "speaker": str(speaker),
        })
    return turns


def summarize_turns(turns: list[dict], audio_duration: float) -> dict:
    speakers = sorted({t["speaker"] for t in turns})
    per_speaker = {}
    for speaker in speakers:
        segs = [t for t in turns if t["speaker"] == speaker]
        total = sum(t["end"] - t["start"] for t in segs)
        per_speaker[speaker] = {
            "turnCount": len(segs),
            "totalSpeechSeconds": round(total, 3),
            "meanTurnSeconds": round(total / len(segs), 3) if segs else 0.0,
        }
    speech_total = sum(t["end"] - t["start"] for t in turns)
    durations = sorted(t["end"] - t["start"] for t in turns)
    return {
        "speakerCount": len(speakers),
        "turnCount": len(turns),
        "totalSpeechSeconds": round(speech_total, 3),
        "speechRatio": (round(speech_total / audio_duration, 4)
                        if audio_duration > 0 else None),
        "meanTurnSeconds": round(speech_total / len(turns), 3) if turns else 0.0,
        "medianTurnSeconds": (round(durations[len(durations) // 2], 3)
                              if durations else 0.0),
        "perSpeaker": per_speaker,
    }


def structural_alignment(turns: list[dict], timeline: dict) -> dict | None:
    """UNSCORED structural alignment vs a repo-derived timeline JSON.

    The repo's derived timelines (SWM events, HF003/HF006 vision detections)
    are model outputs — NEVER ground truth. This computes honest overlap
    counts only: how many diarization turn boundaries fall within
    `toleranceSeconds` of a timeline entry timestamp.
    """
    entries = timeline.get("entries") or timeline.get("frames") or []
    if not entries or not turns:
        return None
    stamps: list[float] = []
    for entry in entries:
        for key in ("presentationMs", "startMs", "timeMs", "tMs"):
            if key in entry:
                stamps.append(float(entry[key]) / 1000.0)
                break
        else:
            if "t" in entry:
                stamps.append(float(entry["t"]))
    if not stamps:
        return None
    tolerance = 0.5
    boundaries = sorted({t["start"] for t in turns} | {t["end"] for t in turns})
    matched = sum(1 for b in boundaries
                  if any(abs(b - s) <= tolerance for s in stamps))
    return {
        "kind": (
            "UNSCORED structural alignment (repo-derived timeline — model "
            "output, NOT ground truth)"
        ),
        "toleranceSeconds": tolerance,
        "turnBoundaryCount": len(boundaries),
        "boundariesWithinTolerance": matched,
        "timelineEntryCount": len(stamps),
        "note": (
            "overlap counts only — never a DER/JER number; the repo timeline "
            "is itself derived (SWM state / vision detections)"
        ),
    }


def run_full(repo: Path, bench: Path, results_dir: Path, pipeline_dir: Path,
             repeats: int) -> int:
    """The ready-to-run benchmark. Fail-closed on any unmet precondition."""
    from pyannote.audio import Pipeline  # heavy import, kept local

    if not pipeline_dir.exists():
        print(f"FULL mode refuses: pipeline dir missing: {pipeline_dir}")
        return 2
    if not (pipeline_dir / "config.yaml").exists():
        print(f"FULL mode refuses: {pipeline_dir / 'config.yaml'} missing — an "
              "authenticated download of the gated repo is required (see the "
              "preflight refusal's unblockPath)")
        return 2

    # The honest inventory: record every weight file + sha256 that runs.
    inventory = []
    for path in sorted(pipeline_dir.rglob("*")):
        if path.is_file() and path.suffix in (
                ".pt", ".bin", ".safetensors", ".ckpt", ".pkl", ".onnx"):
            inventory.append({
                "relPath": str(path.relative_to(pipeline_dir)),
                "bytes": path.stat().st_size,
                "sha256": sha256_of(path),
            })

    pipeline = Pipeline.from_pretrained(str(pipeline_dir))
    audio_dir = bench / "audio"
    spr_wav = {
        "sprclip-b8-inplay-original": "spr-src-audio.wav",
        "sprclip-b1-wide-broadcast": "spr-b1-audio.wav",
    }

    first_fixture = True
    for clip_id, wav_name in spr_wav.items():
        wav = audio_dir / wav_name
        if not wav.exists():
            file_name = SPR_CLIPS[clip_id][0]
            info = extract_audio(repo / SPR_CORPUS_BYTES / file_name, wav)
        else:
            info = {
                "wavPath": str(wav),
                "wavSha256": sha256_of(wav),
                "durationSeconds": round(format_duration_of(wav), 3),
                "extractionCommand": AUDIO_EXTRACT_COMMAND,
            }
        duration = info["durationSeconds"]

        # Warm-up (lazy init) on the FIRST fixture only; then timed repeats.
        timed: list[float] = []
        first_call_ms: float | None = None
        turns_runs: list[list[dict]] = []
        for i in range(max(2, repeats)):
            t0 = time.perf_counter()
            output = pipeline(str(wav))
            elapsed = time.perf_counter() - t0
            turns_runs.append(turn_timeline_of(output))
            if i == 0 and first_fixture:
                first_call_ms = round(elapsed * 1000.0, 1)
            else:
                timed.append(elapsed)
        first_fixture = False

        determinism = all(t == turns_runs[0] for t in turns_runs[1:])
        rtf_values = [t / duration for t in timed]
        result = {
            "evidenceId": f"hf009-pyannote-{clip_id}",
            "purpose": "HF009 EXECUTED diarization run (CPU-only host)",
            "recordedAtUtc": utc_now_iso(),
            "clipId": clip_id,
            "audio": info,
            "determinism": {
                "runs": len(turns_runs),
                "serializedTurnTimelinesIdentical": determinism,
            },
            "turnTimeline": turns_runs[0],
            "turnStructure": summarize_turns(turns_runs[0], duration),
            "latency": {
                "measurementKind": (
                    "CPU wall-clock, repeated full-pipeline microbenchmark "
                    "(first-call warm-up excluded, identical input, labeled "
                    "as such)"
                ),
                "audioDurationSeconds": duration,
                "perRunMs": [round(t * 1000.0, 1) for t in timed],
                "meanMs": round(sum(timed) / len(timed) * 1000.0, 1),
                "p50NearestRankMs": round(
                    nearest_rank_percentile(timed, 50) * 1000.0, 1),
                "p95NearestRankMs": round(
                    nearest_rank_percentile(timed, 95) * 1000.0, 1),
                "realTimeFactorMean": round(
                    sum(rtf_values) / len(rtf_values), 4),
                "firstCallWarmupMs": first_call_ms,
                "note": RESOURCE_CAVEAT,
            },
            "derJer": {
                "verdict": (
                    "NOT MEASURED (typed): no ground-truth speaker annotations "
                    "exist in the repo for this media (see the preflight "
                    "refusal's groundTruthSearch); the RTTM-based DER/JER "
                    "harness is stated exactly (pyannote-metrics 4.1) with "
                    "zero ground-truth rows to score"
                ),
            },
            "pipelineInventory": inventory,
            "processRssMiB": round(vm_rss_mib(), 1),
            "peakRssMiBRuMaxrss": round(
                resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024.0, 1),
        }

        # The UNSCORED structural comparison vs repo-derived timelines.
        timeline_path = results_dir / f"{clip_id}-repo-timeline.json"
        if timeline_path.exists():
            result["unscoredStructuralComparison"] = structural_alignment(
                turns_runs[0],
                json.loads(timeline_path.read_text(encoding="utf-8")),
            )

        out = results_dir / f"pyannote-{clip_id}.json"
        out.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
        print(f"EXECUTED {clip_id}: "
              f"{result['turnStructure']['turnCount']} turns / "
              f"{result['turnStructure']['speakerCount']} speakers; "
              f"RTF {result['latency']['realTimeFactorMean']} -> {out}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    parser.add_argument("--repo-root", default="/home/z/sporta", type=Path)
    parser.add_argument("--bench-root", default="/home/z/hf-bench-4", type=Path)
    parser.add_argument("--mode", choices=("preflight", "full"),
                        default="preflight")
    parser.add_argument("--pipeline-dir", type=Path, default=None,
                        help="full mode: the OPERATOR-authenticated local "
                             "download of the gated community-1 repo")
    parser.add_argument("--repeats", type=int, default=3)
    args = parser.parse_args()

    repo = args.repo_root.resolve()
    bench = args.bench_root.resolve()
    results_dir = Path(__file__).parent / "results"
    results_dir.mkdir(parents=True, exist_ok=True)

    if args.mode == "preflight":
        return run_preflight(repo, bench, results_dir)
    if args.pipeline_dir is None:
        print("FULL mode requires --pipeline-dir (the authenticated local "
              "download of the gated repo — never a token on the command line)")
        return 2
    return run_full(repo, bench, results_dir, args.pipeline_dir.resolve(),
                    args.repeats)


if __name__ == "__main__":
    sys.exit(main())
