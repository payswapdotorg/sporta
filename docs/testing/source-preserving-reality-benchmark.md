# Source-Preserving Reality — Benchmark Corpus

Status: SPEC FROZEN v1 (2026-09-24) · Owner: Worker C (corpus), TL (spec)
Acceptance: `docs/testing/source-preserving-reality-acceptance.md`

## 1. Source of truth for media

Frozen source: `https://www.youtube.com/watch?v=93LPZJkCW2w`
("FULL MATCH | BETIS 3 vs 5 FC BARCELONA | LALIGA 2025/26 MD15", channel FC Barcelona).
Acquisition method (recorded, unratified third path — the standing R606 caveat):
vpn-egress yt-dlp HLS pull via proxy `a996d235.acsnet.co:443` (gost HTTPS proxy;
the bgutil PO-token provider plugin at `~/.yt-dlp/plugins/bgutil`, server `:4416`),
client `visionos`, format itag230 (640x360 HLS video) + itag140 m4a audio,
`--download-sections` window cut, `-c copy` merge. Every corpus entry records the
exact command used.

## 2. Required clips

| ID | Category | Window (source media time) | Length | Status |
|---|---|---|---|---|
| b1 | Wide broadcast (players distributed) | 1803.84–1833.84 | ~30s | cut from b8 |
| b2 | Close-up (1-2 players, pan/zoom) | 3515–3524 (disc-3500 t=15-24) | 9s | **READY w6-spr-4** — VLM YES |
| b3 | Fast action (shot/tackle/sprint) | 2046–2058 (b5 window t=67-79) | 12s | **READY w6-spr-4** — VLM YES (shot + GK dive) |
| b4 | Crowd / dense stadium content | — | — | **PENDING (honest)** — 9 windows sampled, every candidate failed direct verification; world feed shows no 8-12s crowd-dominant passage in sampled material |
| b5 | Camera movement (sustained pan/follow) | 1987–1999 (b5 window t=8-20) | 12s | **READY w6-spr-4** — VLM YES (pan following play); 86s window re-pulled as b5-86s substrate |
| b6 | Multi-player interaction / set-piece | 5826–5838 (disc-5800 t=26-38) | 12s | **READY w6-spr-4** — VLM YES (corner kick; night) |
| b7 | Night / difficult lighting | 5840–5850 (disc-5800 t=40-50) | 10s | **READY w6-spr-4** — VLM YES; direct frame check: day at ~30', floodlit night at ~97' |
| b8 | Real in-play R606 source | 1803.84–1851.44 (47.6s) | 47.6s | READY (a13396ec…) |

b8 is the provenance-chained in-play Original from the R606 revalidation
(`w6-real-r606-inplay-evidence/pack.json`): sha256
`a13396ecb00b00b782d928b857cbbe6620008a8f49d2720552e0ac0af1abc8d3`, VLM-verified
in-play (BET 1-2 BAR, ~24'). b1 is a prefix cut of b8 (no re-acquisition needed).

Discovery method for b2-b6: candidate windows from the 86s on-disk pull
(`/home/z/w6-real-r606-inplay-evidence/logs/calibration-ideal-window-1979-2213.mp4`)
and/or fresh yt-dlp window pulls; extract 1 fps thumbnails; classify with VLM
(z-ai CLI); select the best-fitting passage; record the media-time mapping.

## 3. Corpus manifest (`/home/z/spr-evidence/benchmarks/corpus.json`)

```json
{
  "schemaVersion": "1.0",
  "source": { "url": "…", "title": "…", "acquisitionRecipe": "…", "rightsBasis": "benchmark-candidate (unratified VPN-egress path)" },
  "clips": [ {
    "clipId": "sprclip-b3-fast-action",
    "category": "fast-action",
    "file": "clip-b3-fast-action.mp4",
    "byteSize": 0, "sha256": "…",
    "width": 640, "height": 360, "fps": 25, "frameCount": 0, "durationMs": 0,
    "mediaTimeStartSec": 0.0, "mediaTimeEndSec": 0.0,
    "acquisition": { "method": "yt-dlp-hls-window | cut-from-b8 | cut-from-86s-pull", "command": "…", "fromSha256": "…" },
    "vlmVerification": { "file": "vlm/b3.json", "verdict": "in-play, counterattack sprint, 6+ players" }
  } ]
}
```

Rules: every clip real (no synthetic); every clip VLM-verified against its category;
every clip content-addressed; reproducibility = same command + same source → same sha.

## 4. Corpus usage

- Renderer waves render every family on b8 (full) + all clips (12s cuts) for scorecards.
- QA harness consumes corpus.json + render outputs; TL merges into the product manifest.
