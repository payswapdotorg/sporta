# The R606 re-prep's proven-solutions research — copy and adapt, never from scratch

The operator's directive (the verdict record, typed verbatim): *"instead of
building the complete solution from scratch, try looking for solutions that
have been reported to work and just copy and adapt them."* This document is
the research flight's record: what was searched, what was found, what was
LIVE-MEASURED, and the adaptation design the re-prep flight implements.

The measured facts (URLs, licenses, HTTP probes) live in
`proven-solutions-research.json` (the machine record); this document carries
the reasoning.

## The problem the research solves

The first verdict's diagnosis: the four exported realities failed criterion 1
(the same match/event NOT identifiable) because the prep's fixture class is a
2 s synthetic pitch scene — and, deeper, the derived renderers
(`anime.prototype`, `tactical.prototype`, `game-3d.prototype`) are
PROCEDURAL state-driven synthesizers ("the anime prototype itself needs no
source" — its own render.ts): they never consume the source clip at all.
The four outputs were literally different scenes. The re-prep must make all
four carry the SAME REAL EVENT.

## Leg 1 — the real-footage source (measured, license-clean, downloadable)

| Candidate | License | Live probe | Verdict |
| --- | --- | --- | --- |
| **Mixkit 43499 "Goal play in a semi-professional soccer game"** | Mixkit License (free, no attribution) | **HTTP 200, video/mp4, 3 371 473 B** (the CDN's direct URL, no key/auth) | **THE PICK** |
| Mixkit 43495 "Penalty kick seen from behind the goal nets" | Mixkit License | (same CDN family) | the alternative |
| Wikimedia "Inter vs Ajax U19 goal" (.webm, 720p) | CC BY 2.0 | **HTTP 429 twice** — the upload CDN refuses this sandbox's IP | unreachable at flight time |
| Wikimedia "Barcelona goal" (.ogv) | CC BY-SA 3.0 | HTTP 429 (same) | unreachable |
| SoccerNet corpus | research-only, **NDA-gated** (its own README: "require password from NDA") | — | wrong license shape for a console export |

**The pick: Mixkit 43499** — "Skillful team play that ends in a goal, in a
semi-professional soccer game, in a shot from inside the field" (the page's
own JSON-LD description, `copyrightNotice: "Free"`). A REAL goal event,
license-clean for the operator-watchable export, directly downloadable.

## Leg 2 — the styling (solutions REPORTED TO WORK, adapted)

**The re-prep's path: ffmpeg's own first-party documented filter chains**
applied to the same clip's verified bytes — the search surfaced the recipe
class (ffmpeg.org's edgedetect documentation: "Mix the colors to create a
paint/cartoon effect"; the superuser sketch-filter recipe; the zayne.io
vintage-filter recipes), and the repo ALREADY composes `filter_complex`
chains on real footage in its own ffmpeg seam (`generateTestMp4`'s overlay
chains) — the adaptation point exists in-tree:

- **tactical-look**: green duotone (colorchannelmixer/eq toward pitch-green)
  + edge-line emphasis (the tactical board's drawn-lines character).
- **three-d-game-look**: palette/posterize quantization + saturation and
  sharpen boost (the game-render's flat-shaded, punchy character).
- **anime-npr-look**: edge-outline overlay + cel quantization (the
  documented cartoon-effect mix — the NPR character).

**The honest also-rans** (found, measured, deliberately NOT the re-prep's
path): AnimeGANv2/v3 (proven per-frame GAN styling — the later
Technology-Plane promotion lane, GPU + HF-benchmark-gated per the roadmap);
the broadcast-to-tactical CV projects (FootyTacticalAnalysis, SoccerEye,
Hawk-Eye — the product-scale real-analysis lane, the CAP backlog).

## The adaptation design (the re-prep flight's contract)

1. Download the Mixkit 43499 clip (the CDN URL, license recorded in the
   flight's record), trim to a short goal segment.
2. The ORIGINAL reality: the real clip ingested through the pipeline.
3. The three DERIVED kinds: the SAME clip's verified bytes through the three
   documented chains — **the same-event identity holds BY CONSTRUCTION**
   (the same underlying real footage), the differences are the chains' own
   documented effects.
4. The integrity discipline unchanged: every output sha-256 re-verified at
   the receiving boundary + the `ftyp` container magic + the byte-length
   claim; exports OUTSIDE the repo (the no-committed-media doctrine).
5. The gate re-surfaced on the console for the operator's eyes — the verdict
   always the operator's.

**The honest scope**: this is the VIDEO-STYLIZATION path — exactly the
copy-and-adapt the operator directed. It is NOT the state-driven reality
engine's own real-footage path (SWM analysis → procedural renders — the
product-scale CAP lane behind its own gates). The GATE's substance (the same
real event + meaningful stylistic differences across the four) is what this
path demonstrates.
