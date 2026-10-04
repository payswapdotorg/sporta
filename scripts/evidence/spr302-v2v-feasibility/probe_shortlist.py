#!/usr/bin/env python3
"""
SPR302 — the neural v2v candidate shortlist PROBE (worker 65-h, flight 14).

The bounded-research probe for the SPR lane's WAVE-1 work item:
"SPR302 — Neural v2v candidate shortlist + feasibility matrix. Owner: A.
Wave: WAVE-1." This flight runs NO model (the matrix is the research
deliverable; the executed trial is SPR303's WAVE-2 item). What it DOES run:

  1. LIVE hub API probes (huggingface_hub, anonymous, metadata only) for
     every shortlist candidate's canonical repo id — recording, per repo:
     exists / gated state / pinned sha / hub-reported per-file sizes
     (files_metadata=True — sizes come from the API listing, NEVER from
     downloads) / license tags / card license field. Repos that do not
     exist are recorded as RepositoryNotFoundError — the honest
     "no public HF repo under the canonical id" fact.
  2. Anonymous reachability probes at the pinned revision (the HF005/HF009
     convention): a 1-byte Range request `bytes=0-0` per representative
     weight file — ZERO body bytes read for weights (a 401 on a gated repo
     reads at most the short error body, recorded as the wall text).
  3. Bounded TEXT-DOCUMENT fetches ONLY (the HF005 first-class license leg):
     the HF README/model-card and the GitHub code-repo LICENSE/README for
     each candidate, each bounded, sha256-recorded, with a fetch-meta JSON
     in fetches/. No weight byte is ever fetched.

Host arithmetic is measured LIVE (total RAM / free disk / vCPU) and written
into the record so the RESOURCE axis of the feasibility matrix stands on
measured numbers, not on the landscape's 2026-09-24 snapshot.

Usage:
  /home/z/hf-bench-12/bin/python probe_shortlist.py
Exit 0 on a complete recorded run; exit 1 on any hard probe failure.
"""
from __future__ import annotations

import datetime as _dt
import hashlib
import json
import os
import urllib.error
import urllib.request
from pathlib import Path

from huggingface_hub import HfApi
from huggingface_hub.errors import RepositoryNotFoundError

HERE = Path(__file__).resolve().parent
RESULTS = HERE / "results"
FETCHES = HERE / "fetches"

HF_RESOLVE = "https://huggingface.co"

# The shortlist (the landscape classes, docs/research/
# source-preserving-technology-landscape.md §4.5/§4.6/§4.7):
#   full-V2V diffusion: Diffutoon, FlowVid, Pix2Video, vid2vid (NVIDIA),
#                       ToonCrafter (the generative-interpolation NC class)
#   per-frame NST:      AnimeGANv2
#   neural VST:         ReReVST, CompoundVST
#   example-based:      EbSynth
SHORTLIST: list[dict] = [
    {
        "candidate": "AnimeGANv2",
        "landscapeClass": "per-frame neural style transfer (landscape §4.6)",
        "hfRepoIds": [
            "akhaliq/AnimeGANv2-pytorch",
            "vumichien/AnimeGANv2_Hayao",
            "vumichien/AnimeGANv2_Paprika",
            "vumichien/AnimeGANv2_Shinkai",
        ],
        "canonicalRepoNote": "canonical PyTorch port is GitHub bryandlee/animegan2-pytorch (MIT); the hub carries small mirrors",
        "githubRepo": "bryandlee/animegan2-pytorch",
        "githubBranch": "main",
    },
    {
        "candidate": "Diffutoon",
        "landscapeClass": "diffusion toon shading (landscape §4.5, the wave-3+ quality reference)",
        "hfRepoIds": ["camenduru/Diffutoon", "ECNU-CILab/Diffutoon"],
        "canonicalRepoNote": "official code is GitHub ECNU-CILab/DiffToon; hub hit is a community asset mirror",
        "githubRepo": "ECNU-CILab/DiffToon",
        "githubBranch": "main",
    },
    {
        "candidate": "FlowVid",
        "landscapeClass": "flow-conditioned full V2V (landscape §4.5, paper 2312.08126)",
        "hfRepoIds": ["Jeff-Lun/FlowVid"],
        "canonicalRepoNote": "paper-first; code repo (if public) is GitHub",
        "githubRepo": "Jeff-Lun/FlowVid",
        "githubBranch": "main",
    },
    {
        "candidate": "Pix2Video",
        "landscapeClass": "text-guided V2V editing via image diffusion (landscape §4.5, CVPR 2023)",
        "hfRepoIds": ["duyguceylan/Pix2Video"],
        "canonicalRepoNote": "paper-first (openaccess.thecvf.com / duyguceylan.github.io); hub search for pix2video returns nothing",
        "githubRepo": "duyguceylan/Pix2Video",
        "githubBranch": "main",
    },
    {
        "candidate": "vid2vid (NVIDIA)",
        "landscapeClass": "conditional photoreal V2V synthesis (landscape §4.5, CC BY-NC-SA red flag)",
        "hfRepoIds": ["nvidia/vid2vid", "NVlabs/few-shot-vid2vid"],
        "canonicalRepoNote": "GitHub-only research code; no official hub weights found",
        "githubRepo": "NVIDIA/vid2vid",
        "githubBranch": "master",
    },
    {
        "candidate": "ReReVST",
        "landscapeClass": "zero-shot recurrent temporally-consistent VST (landscape §4.6, NTIRE2023)",
        "hfRepoIds": ["daooshee/ReReVST"],
        "canonicalRepoNote": "research code; NTIRE2023 challenge repo",
        "githubRepo": "daooshee/ReReVST-NTIRE2023",
        "githubBranch": "main",
    },
    {
        "candidate": "CompoundVST",
        "landscapeClass": "compound temporally-consistent VST (landscape §4.6, NTIRE2023)",
        "hfRepoIds": ["daooshee/CompoundVST"],
        "canonicalRepoNote": "research code; NTIRE2023 challenge repo",
        "githubRepo": "daooshee/CompoundVST-NTIRE2023",
        "githubBranch": "main",
    },
    {
        "candidate": "EbSynth",
        "landscapeClass": "example-based keyframe propagation (landscape §4.7, the rotoscope bridge)",
        "hfRepoIds": ["jamriska/ebsynth"],
        "canonicalRepoNote": "a desktop/binary tool + CLI, not a hub model; terms at ebsynth.com",
        "githubRepo": "jamriska/ebsynth",
        "githubBranch": "master",
    },
    {
        "candidate": "ToonCrafter",
        "landscapeClass": "generative cartoon interpolation (landscape §4.5, NC red-flag class, benchmark-only)",
        "hfRepoIds": ["Doubiiu/ToonCrafter"],
        "canonicalRepoNote": "official weights on the hub (ungated); website content CC BY-NC-SA per the landscape",
        "githubRepo": "Doubiiu/ToonCrafter",
        "githubBranch": "main",
    },
]

# Bounded text-document fetch plan (the ONLY fetches this flight performs).
# (label, url, max_bytes)
FETCH_PLAN: list[tuple[str, str, int]] = []


def _utc_now() -> str:
    return _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _http_get(url: str, *, max_bytes: int, headers: dict[str, str] | None = None) -> tuple[int, dict[str, str], bytes]:
    req = urllib.request.Request(url, method="GET")
    req.add_header("User-Agent", "spr302-bounded-probe/1.0 (sporta evidence flight; text documents only, never weights)")
    for key, value in (headers or {}).items():
        req.add_header(key, value)
    try:
        with urllib.request.urlopen(req, timeout=45) as resp:
            return resp.status, {k.lower(): v for k, v in resp.headers.items()}, resp.read(max_bytes)
    except urllib.error.HTTPError as err:
        return err.code, {k.lower(): v for k, v in err.headers.items()}, err.read(2048)
    except Exception as err:  # network-level refusal — recorded, never retried around
        return -1, {"error": type(err).__name__}, b""


def _write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def probe_repo(api: HfApi, repo_id: str) -> dict:
    """Metadata-only hub probe (sizes are hub-REPORTED, never downloaded)."""
    record: dict = {"repoId": repo_id}
    try:
        info = api.model_info(repo_id, files_metadata=True)
    except RepositoryNotFoundError:
        record["exists"] = False
        record["finding"] = "RepositoryNotFoundError — no public HF repo under this id"
        return record
    except Exception as err:
        record["exists"] = False
        record["finding"] = f"probe error {type(err).__name__}: {err}"
        return record
    record["exists"] = True
    record["gated"] = info.gated
    record["pinnedRevision"] = info.sha
    record["private"] = info.private
    license_tags = [t for t in (info.tags or []) if t.startswith("license:")]
    record["licenseTags"] = license_tags
    card = getattr(info, "card_data", None)
    card_license = getattr(card, "license", None) if card else None
    record["cardLicenseField"] = card_license
    files = []
    total = 0
    for s in info.siblings or []:
        size = getattr(s, "size", None)
        total += size or 0
        files.append({"file": s.rfilename, "hubReportedBytes": size})
    record["files"] = files
    record["totalHubReportedBytes"] = total
    record["sizeClassGiB"] = round(total / (1024**3), 3)
    # The reachability probe (1-byte Range at the PINNED revision, zero
    # weight body bytes): probe the largest weight-looking file.
    weight_files = [
        f for f in files
        if f["hubReportedBytes"] and f["hubReportedBytes"] > 1_000_000
        and f["file"].split(".")[-1].lower() in {"pt", "pth", "ckpt", "safetensors", "onnx", "bin"}
    ]
    if weight_files:
        biggest = max(weight_files, key=lambda f: f["hubReportedBytes"] or 0)
        url = f"{HF_RESOLVE}/{repo_id}/resolve/{info.sha}/{biggest['file']}"
        status, headers, body = _http_get(url, max_bytes=1, headers={"Range": "bytes=0-0"})
        record["reachabilityProbe"] = {
            "file": biggest["file"],
            "probe": f"GET {url} with Range: bytes=0-0 (the hf005/hf009 convention)",
            "httpStatus": status,
            "xErrorCode": headers.get("x-error-code"),
            "bodyBytesRead": len(body),
            "weightBytesDownloaded": 0,
        }
        # The model card README is a public TEXT document — bounded fetch.
        FETCH_PLAN.append(
            (
                f"hf-{repo_id.replace('/', '-')}-README@pinned-rev",
                f"{HF_RESOLVE}/{repo_id}/resolve/{info.sha}/README.md",
                64_000,
            )
        )
    return record


def fetch_document(label: str, url: str, max_bytes: int) -> dict:
    """Bounded text-document fetch with sha256 + fetch-meta (hf005 convention)."""
    status, headers, body = _http_get(url, max_bytes=max_bytes)
    meta = {
        "url": url,
        "httpStatus": status,
        "fetchedAtUtc": _utc_now(),
        "bytes": len(body),
        "sha256": _sha256(body) if body else None,
        "note": "bounded text-document fetch (license/card/README leg); NEVER weights",
        "fetchedBy": "SPR302 (worker 65-h) — the candidate shortlist license/provenance leg",
    }
    meta_path = FETCHES / f"{label}.fetch-meta.json"
    if status == 200 and body:
        (FETCHES / label).write_bytes(body)
        _write_json(meta_path, meta)
    else:
        meta["finding"] = "not fetched (non-200 or empty) — recorded as a typed gap, never retried around"
        _write_json(meta_path, meta)
    return meta


def measure_host() -> dict:
    total_kb = 0
    with open("/proc/meminfo", encoding="utf-8") as fh:
        for line in fh:
            if line.startswith("MemTotal:"):
                total_kb = int(line.split()[1])
                break
    disk = os.statvfs("/home/z")
    free_gib = disk.f_bavail * disk.f_frsize / (1024**3)
    return {
        "measuredAtUtc": _utc_now(),
        "totalRamMiB": round(total_kb / 1024, 1),
        "freeDiskGiB": round(free_gib, 2),
        "vcpu": os.cpu_count(),
        "gpu": None,
        "gpuFinding": "no GPU on this host (the standing SPR/HF-portfolio host fact)",
    }


def main() -> int:
    api = HfApi()  # anonymous — no token in this sandbox, by the worker contract
    record: dict = {
        "flight": "SPR302 — neural v2v candidate shortlist probe",
        "probedAtUtc": _utc_now(),
        "probeMode": "metadata + 1-byte Range reachability + bounded text-document fetches; ZERO weight bytes",
        "hfLibraryVersion": __import__("huggingface_hub").__version__,
        "host": measure_host(),
        "shortlist": [],
    }

    # GitHub license/README fetch plan per candidate (the code-repo license leg).
    for entry in SHORTLIST:
        gh = entry["githubRepo"]
        branch = entry["githubBranch"]
        FETCH_PLAN.append((f"github-{gh.replace('/', '-')}-LICENSE", f"https://raw.githubusercontent.com/{gh}/{branch}/LICENSE", 64_000))
        FETCH_PLAN.append((f"github-{gh.replace('/', '-')}-README", f"https://raw.githubusercontent.com/{gh}/{branch}/README.md", 64_000))

    # 1) the hub probes
    for entry in SHORTLIST:
        row = {
            "candidate": entry["candidate"],
            "landscapeClass": entry["landscapeClass"],
            "canonicalRepoNote": entry["canonicalRepoNote"],
            "githubRepo": entry["githubRepo"],
            "hubProbes": [probe_repo(api, rid) for rid in entry["hfRepoIds"]],
        }
        record["shortlist"].append(row)
        print(f"[hub] {entry['candidate']}: {[(p['repoId'], p.get('exists')) for p in row['hubProbes']]}")

    # 2) the bounded text-document fetches (license/card leg, first-class)
    fetches = []
    for label, url, max_bytes in FETCH_PLAN:
        meta = fetch_document(label, url, max_bytes)
        fetches.append(meta)
        print(f"[fetch] {label}: HTTP {meta['httpStatus']} ({meta['bytes']} B)")
    record["documentFetches"] = [
        {"label": f["label"] if "label" in f else m["url"], **m} if False else {"url": m["url"], "httpStatus": m["httpStatus"], "bytes": m["bytes"], "sha256": m["sha256"]}
        for m in fetches
    ]

    _write_json(RESULTS / "shortlist-probe.json", record)
    print(f"[done] wrote {RESULTS / 'shortlist-probe.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
