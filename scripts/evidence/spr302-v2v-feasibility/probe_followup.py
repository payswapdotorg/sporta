#!/usr/bin/env python3
"""
SPR302 — the FOLLOW-UP probe pass (worker 65-h): corrected paths after the
first pass's recorded 404s + the upstream-weights provenance leg.

The first pass (probe_shortlist.py) recorded honest 404s for several
GitHub LICENSE/README fetches — wrong repo names (verified via the GitHub
search API, recorded below) and wrong file names (vid2vid ships
LICENSE.txt, not LICENSE). This pass fetches the CORRECT text documents,
bounded, sha256-recorded, with fetch-meta JSONs — same doctrine: text
documents only, never weights, non-200 recorded as typed gaps.

The GitHub search-API recon that corrected the repo names (EXECUTED
2026-10-04, before the search API rate-limited at 403 — the 403 is also
recorded): DiffToon -> 0 repository hits; FlowVid -> Jeff-LiangF/FlowVid
(main, no license file); ReReVST -> daooshee/ReReVST-Code (master, GPL-3.0)
+ daooshee/ReReVST (master, none); CompoundVST -> daooshee/CompoundVST
(master, none); ebsynth -> jamriska/ebsynth (master, no license file).

Usage:
  /home/z/hf-bench-12/bin/python probe_followup.py
"""
from __future__ import annotations

import datetime as _dt
import hashlib
import json
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
FETCHES = HERE / "fetches"
RESULTS = HERE / "results"


def _utc_now() -> str:
    return _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _http_get(url: str, *, max_bytes: int) -> tuple[int, dict[str, str], bytes]:
    req = urllib.request.Request(url, method="GET")
    req.add_header("User-Agent", "spr302-bounded-probe/1.0 (sporta evidence flight; text documents only, never weights)")
    try:
        with urllib.request.urlopen(req, timeout=45) as resp:
            return resp.status, {k.lower(): v for k, v in resp.headers.items()}, resp.read(max_bytes)
    except urllib.error.HTTPError as err:
        return err.code, {k.lower(): v for k, v in err.headers.items()}, err.read(2048)
    except Exception as err:
        return -1, {"error": type(err).__name__}, b""


def fetch_document(label: str, url: str, max_bytes: int, note: str) -> dict:
    status, _headers, body = _http_get(url, max_bytes=max_bytes)
    meta = {
        "url": url,
        "httpStatus": status,
        "fetchedAtUtc": _utc_now(),
        "bytes": len(body),
        "sha256": _sha256(body) if body else None,
        "note": note,
        "fetchedBy": "SPR302 follow-up pass (worker 65-h) — corrected-path text-document fetches",
    }
    if status == 200 and body:
        (FETCHES / label).write_bytes(body)
    else:
        meta["finding"] = "not fetched (non-200 or empty) — recorded as a typed gap"
    (FETCHES / f"{label}.fetch-meta.json").write_text(json.dumps(meta, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return meta


PLAN: list[tuple[str, str, int, str]] = [
    # vid2vid ships LICENSE.txt at master (the landscape's red-flag citation).
    ("github-NVIDIA-vid2vid-LICENSE.txt", "https://raw.githubusercontent.com/NVIDIA/vid2vid/master/LICENSE.txt", 8_000,
     "the CC BY-NC-SA 4.0 license text the landscape cites (vid2vid red flag)"),
    ("github-NVlabs-few-shot-vid2vid-LICENSE.txt", "https://raw.githubusercontent.com/NVlabs/few-shot-vid2vid/master/LICENSE.txt", 8_000,
     "the few-shot-vid2vid license text (the same NVIDIA class)"),
    # Corrected repo names from the recorded search recon.
    ("github-daooshee-ReReVST-Code-LICENSE", "https://raw.githubusercontent.com/daooshee/ReReVST-Code/master/LICENSE", 40_000,
     "ReReVST code license (GitHub search said GPL-3.0 — verify verbatim)"),
    ("github-daooshee-ReReVST-Code-README", "https://raw.githubusercontent.com/daooshee/ReReVST-Code/master/README.md", 40_000,
     "ReReVST readme (weights provenance + usage terms)"),
    ("github-daooshee-CompoundVST-README", "https://raw.githubusercontent.com/daooshee/CompoundVST/master/README.md", 40_000,
     "CompoundVST readme (weights provenance + usage terms)"),
    ("github-Jeff-LiangF-FlowVid-README", "https://raw.githubusercontent.com/Jeff-LiangF/FlowVid/main/README.md", 40_000,
     "FlowVid readme (code/weights status — the paper-first candidate)"),
    ("github-Jeff-LiangF-FlowVid-LICENSE", "https://raw.githubusercontent.com/Jeff-LiangF/FlowVid/main/LICENSE", 40_000,
     "FlowVid code license (search said none — verify)"),
    # DiffToon: the recorded 404s + the 0-hit search — try both branches + the project page.
    ("github-ECNU-CILab-DiffToon-LICENSE@main", "https://raw.githubusercontent.com/ECNU-CILab/DiffToon/main/LICENSE", 8_000,
     "DiffToon official-code license attempt (branch main)"),
    ("github-ECNU-CILab-DiffToon-LICENSE@master", "https://raw.githubusercontent.com/ECNU-CILab/DiffToon/master/LICENSE", 8_000,
     "DiffToon official-code license attempt (branch master)"),
    ("web-ecnu-cilab-Diffutoon-project-page", "https://ecnu-cilab.github.io/Diffutoon/", 64_000,
     "the official Diffutoon project page (records what the official entry point links)"),
    # Upstream weights provenance for AnimeGANv2 (the landscape's deferred flag).
    ("github-TachibanaYoshino-AnimeGANv2-LICENSE", "https://raw.githubusercontent.com/TachibanaYoshino/AnimeGANv2/master/LICENSE", 8_000,
     "the TF-original AnimeGANv2 license (upstream weights provenance leg)"),
    ("github-TachibanaYoshino-AnimeGANv2-README", "https://raw.githubusercontent.com/TachibanaYoshino/AnimeGANv2/master/README.md", 64_000,
     "the TF-original readme (dataset/weights provenance)"),
    # EbSynth terms: the site, not a repo file (jamriska/ebsynth has no LICENSE file — recorded 404 in pass 1).
    ("web-ebsynth-use-terms", "https://ebsynth.com/use.txt", 64_000,
     "the EbSynth usage terms at the recorded official location (ebsynth.com)"),
    ("web-ebsynth-index", "https://ebsynth.com/", 64_000,
     "the EbSynth site root (records where the terms live)"),
    ("web-ebsynth-terms", "https://ebsynth.com/terms", 64_000,
     "the EbSynth terms page (the site's Terms link — the license leg for the binary tool)"),
    ("github-NVlabs-few-shot-vid2vid-LICENSE", "https://raw.githubusercontent.com/NVlabs/few-shot-vid2vid/master/LICENSE", 8_000,
     "few-shot-vid2vid license file attempt (LICENSE, not LICENSE.txt — the .txt path 404'd in this pass's first run)"),
    ("hf-Doubiiu-ToonCrafter-LICENSE@pinned-rev", "https://huggingface.co/Doubiiu/ToonCrafter/resolve/7c56c5a23d9f8a9d99398e2a2491fff4bd6cffaf/LICENSE", 12_000,
     "the LICENSE file ON THE HUB REPO at the pinned revision (the ToonCrafter license leg — the license also lives in the hub tree itself)"),
]


def main() -> int:
    fetches = []
    for label, url, max_bytes, note in PLAN:
        meta = fetch_document(label, url, max_bytes, note)
        fetches.append(meta)
        print(f"[fetch] {label}: HTTP {meta['httpStatus']} ({meta['bytes']} B)")
    record = {
        "flight": "SPR302 follow-up probe pass (corrected paths + provenance leg)",
        "probedAtUtc": _utc_now(),
        "githubSearchRecon": {
            "executedAtUtc": "2026-10-04 (pass-1 recon, anonymous GitHub search API)",
            "findings": [
                "q=DiffToon -> 0 repository hits (rate-limit-free search)",
                "q=FlowVid -> Jeff-LiangF/FlowVid (default=main, no license file)",
                "q=ReReVST -> daooshee/ReReVST-Code (master, GPL-3.0) + daooshee/ReReVST (master, none)",
                "q=CompoundVST -> daooshee/CompoundVST (master, none)",
                "q=ebsynth -> jamriska/ebsynth (master, no license file)",
            ],
            "note": "the api.github.com search later rate-limited (403, recorded) — the successful searches above are the recorded runs",
        },
        "documentFetches": fetches,
    }
    (RESULTS / "followup-fetches.json").write_text(json.dumps(record, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"[done] wrote {RESULTS / 'followup-fetches.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
