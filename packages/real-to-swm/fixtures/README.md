# Gate fixtures — `@sporta/real-to-swm` (R208)

This directory holds the REAL reconstruction-gate clips (the TL media drop)
plus the verbatim gate manifest. These are the gate's ground truth: R208
acceptance runs the real-to-SWM pipeline on BOTH real clips and proves a
coherent SWM with confidence/provenance, event candidates, and a replayable
reconstruction artifact.

## Files

| File | What it is |
| --- | --- |
| `gate-clips.json` | The TL media-drop manifest, carried VERBATIM (source URLs, licenses, source sha256s, the exact normalization transform, normalized sha256s) |
| `media/fx-001-normalized.mp4` | GATE clip 1 — FIFA Beach Soccer World Cup 2021 (Switzerland v Senegal penalty), CC0 |
| `media/fx-004-normalized.mp4` | GATE clip 2 — Dutch cup newsreel (Open Beelden 10245), CC BY-SA 3.0 nl |

## Provenance (the honest chain, verifiable end-to-end)

Both clips are REAL footage from Wikimedia Commons, downloaded from the
canonical URLs in `gate-clips.json`, source-sha256-verified, and normalized
with the EXACT transform from the manifest (`-ss 0 -t 20`, scale/pad to
640x360, 25 fps, libx264 CRF 20, yuv420p, no audio, +faststart). The
normalized outputs matched the manifest's pinned sha256s byte-for-byte
before being committed:

- **fx-001** (beach soccer penalty, 10 s / 250 frames):
  source sha256 `a4d163a5…cdf131` (CC0), normalized sha256
  `4e2f3e3d…43ff7`.
- **fx-004** (1944 Dutch cup newsreel, 20 s / 500 frames):
  source sha256 `95c5f155…fea45` (CC BY-SA 3.0 nl — attribution required,
  carried verbatim in every reconstruction artifact), normalized sha256
  `77b631de…3ad07`.

The gate tests re-verify each committed file's sha256 against the manifest
before use (fail-closed: a drifted fixture refuses the gate, never runs as
if nothing happened).

## Why the clips are committed (and the sources are not)

The normalized gate clips (2.0 MB + 3.7 MB) are committed so the gate is
reproducible by anyone with the repository — no network, no re-download, no
re-encode variance. The 26 MB ORIGINAL sources stay out (they are
re-derivable from the canonical URLs + sha256 pins in the manifest).

## License obligations

- `fx-001-normalized.mp4` derives from CC0 footage: no attribution required
  (the artifact still records the source URL + license verbatim — honesty,
  not obligation).
- `fx-004-normalized.mp4` derives from CC BY-SA 3.0 nl footage: attribution
  + share-alike. Every reconstruction artifact produced from it MUST carry
  the source URL, license id, and attribution verbatim (the pipeline's clip
  provenance input enforces this; the gate test asserts it).
