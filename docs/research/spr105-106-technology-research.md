# SPR105 (Clay/Miniature/Toy) + SPR106 (Low-Poly/Game-like) — Technology Research

Status: COMPLETE (wave-5b) · Author: Worker D (Family Research, Task `spr/w5b/family-research`)
Date: 2026-09-27 · Machine-readable registry: `docs/technology/spr105-106-candidates.yaml`
Base commit: `f150e32243c2ad176d5d70d0beca33b68785a1a7` (origin/main post lane-B merge)

Scope: the two "BACKLOG (needs research)" appearance families of the SPR work-items
doc — **SPR105 Clay/Miniature/Toy** and **SPR106 Low-Poly/Game-like** — researched to
the wave-1 depth bar so the TL can decide whether trial renderers are worth
dispatching. This packet is ADDITIVE: it extends, and never overwrites, the wave-1
registry (`docs/technology/source-preserving-candidates.yaml`) and narrative
(`docs/research/source-preserving-technology-landscape.md`). Where this research
supersedes a wave-1 observation, the delta is recorded here in §9 — the wave-1
files are untouched.

Contract anchor: `docs/contracts/source-preserving-renderer.md` (frozen v1). Every
candidate below is judged against its invariants: timeline equality, cut
preservation + cut-reset, bit-exact double-render reproducibility, no per-frame
generative restyle (the FORBIDDEN slideshow anti-pattern), `swm: null` must still
produce a complete reality, byte-exact encode.

Status anchor: `docs/status/source-preserving-reality-status.md` (wave-3/4
reconciled). The program's measured failure mode is NOT preservation
(sourceFidelity 4.73–5.0, 0 invented cuts matrix-wide) — it is **stylizer visual
quality**: aggressive flatteners destroy player structure (cartoon-cel min axis
1.53 / 99 critical; anime-npr 1.80 / 136) and subtle ones draw borderline
limb-morphology counts (noir 1 critical; trails 2, style-effect conflation). Any
SPR105/106 recommendation is shaped by that diagnosis: prefer structure-PRESERVING
or structure-REINJECTING recipes over more flatten.

---

## 1. Method

- 34 web-search invocations via the `web-search` skill (z-ai `web_search` CLI),
  2026-09-27; 0 rate-limited; ~20 returned on-target results, ~14 returned
  weak/off-target results (each recorded in §10 — the off-targets are themselves
  evidence: they re-confirm the wave-1 coverage gaps). Raw JSON at
  `/tmp/spr105-106-search/s01..s34.json` (session-local, not repo artifacts).
- Local sandbox re-verification (read-only probes, 2026-09-27): environment
  re-check against the wave-1 recorded envelope, plus **measured
  micro-benchmarks of every primitive the two families need** at 640×360 on this
  2-core CPU box (min-of-3 unless noted). These MEASURED numbers are the strongest
  contribution of this packet: wave-1 recorded feasibility vocabulary; this packet
  records feasibility + per-stage cost.
- Honesty rules (binding, per packet): every candidate carries all fields;
  MEASURED vs ESTIMATED is labeled per claim; license statements are
  search-observed 2026-09-27, NOT legal review; uncertainty is recorded as
  uncertainty ("verification deferred" / ASSUMED); no fabricated versions,
  licenses, or latencies. Quality expectations are expectations (reasoned from the
  wave-3/4 Tier-0 evidence), because no end-to-end render was executed in this
  research task — the trial renderer is where expectations become measurements.

## 2. Constraints that shape these two families

1. **The sandbox envelope (recorded, wave-1)**: CPU-only, 4 GB RAM (4159 MB
   observed), ffmpeg 7.1.5 + cv2 4.13.0 (no ximgproc) + numpy 2.1.3 + scipy
   1.14.1 + PIL 11.3.0, python 3.12.14; no torch/mediapipe/onnxruntime; no
   provider keys. Practical envelope: 47.6 s / 1190 frames per ingest; a 55 s /
   1375-frame ingest OOMs. The b8 benchmark clip is 1190 frames — every budget
   below is quoted against it.
2. **The frozen stage library (contract §6)**: cut-detect · flow (Farneback) ·
   bilateral-flatten · median-pool · palette-quantize (fixed per clip, LAB) ·
   xdog-edges · edge-overlay · tone-lut · saturation-lift · bloom (screen-blur) ·
   grain · vignette · trail-accumulate (cut-reset) · motion-mask ·
   overlay-composite · swm-guidance-gate · encode-bitexact. Candidates are scored
   on how much of their pipeline maps onto these existing stages. This packet
   proposes exactly ONE new stage (SPR105 `relief-shade`, §4.2) and zero changes
   to frozen stages — new stages enter as renderer-declared pipeline entries, not
   engine edits (renderers.py ownership note: the in-flight tier-2 lane owns
   `scripts/source-preserving/`; this packet dispatches NO renderer code).
3. **Temporal consistency is THE problem** (wave-1 §2, re-confirmed by the Tier-0
   results): deterministic per-frame filters flicker only through their
   per-frame-varying inputs (edges, gradients, codebooks) — fixed palettes and
   fixed light directions cannot flicker by construction.
4. **The slideshow anti-pattern** is forbidden (ADR-012 / Packet B): per-frame
   generative restyle of any kind (hosted clay/toy image tools, img2img per
   frame) destroys temporal identity. All hosted/GPU generative candidates in
   this packet are recorded FOR THE RECORD with not-recommended/benchmark-only
   verdicts, never as implementation paths.
5. **`swm: null` completeness** (contract §1): SPR105's segmentation-guided
   direction (§4.5) must use engine-local masks (MOG2-class), never SWM facts;
   degradation when masks are weak is an honest `degradations` entry.

## 3. Environment re-verification + measured stage costs

**Re-verified this session (2026-09-27) — consistent with the wave-1 envelope:**
ffmpeg 7.1.5; python 3.12.14; cv2 4.13.0 (`bilateralFilter`, `medianBlur`,
`Sobel`, `Scharr`, `Laplacian`, `Subdiv2D`, `calcOpticalFlowFarneback`,
`createBackgroundSubtractorMOG2`, `createCLAHE`, `EMD`, `CamShift` all present);
`cv2.ximgproc` ABSENT (re-verified); scipy 1.14.1 (`spatial.Delaunay`,
`ndimage.gaussian_filter` present); numpy 2.1.3 (`default_rng` deterministic —
re-verified); torch/mediapipe/onnxruntime ABSENT (re-verified); 2 cores, 4159 MB
RAM.

**NEW VERIFIED-LOCAL facts beyond the wave-1 filter inventory** (all probed
2026-09-27, ffmpeg 7.1.5 build `7.1.5-0+deb13u1`):

- `elbg` — ffmpeg posterize filter (ELBG codebook; options `l`/codebook length,
  `nb_steps`, `seed`, `pal8`). **Determinism VERIFIED**: two independent runs with
  `elbg=l=16:n=4:s=7` over the same 24-frame synthetic input produced
  byte-identical sha256 (`fede403a…`); a second config (`l=16:n=2:s=7`, 6 frames)
  also byte-identical (`76e1d355…`). Cost: ~40–60 ms/frame MEASURED (6-frame run
  0.37 s wall incl. process startup; the 24-frame timing runs were SIGKILLed by
  the sandbox command-boundary reaper mid-run — the same incident class as
  wave-1's ledger; the determinism runs themselves completed, so the filter is
  sound and the cost figure is labeled honestly as approximate).
- `palettegen` / `paletteuse` — palette generation + palette downsampling filters
  present (GIF-oriented; usable as an encoder-side palette-quantize fallback).
- `geq` (per-pixel equations) and `gradfun` (deband) present.
- `noise` with a fixed component seed (`c0_seed=42`) — **determinism VERIFIED**:
  two runs byte-identical (`7bc8850e…`). This makes the engine's `grain` stage
  available encoder-side without custom numpy, when a fixed seed is set.

**Environment DELTA vs the wave-1 recorded envelope (honest note):**
`scikit-image 0.24.0` and `scikit-learn 1.5.2` are importable in this session's
venv. The wave-1 registry's `environment.verified_local.python` inventory does
NOT list them (it lists numpy/scipy/PIL only). Consequence, applied throughout:
SLIC-superpixel recipes RUN TODAY (verified: `skimage.segmentation.slic` works
and is deterministic at 640×360 — two runs identical labels) but are classified
`cpu-local-after-pip` (outside the recorded envelope; a reset could remove them),
and the **mandatory** SPR106 deterministic baseline is the in-envelope Delaunay
path instead. No other deltas found.

**Measured stage micro-benchmarks** (640×360, this 2-core box, min-of-3, 2026-09-27;
synthetic structured RGB test frames; per-stage, so pipeline sums are ESTIMATES
built from MEASURED parts):

| Stage (family use) | Primitive | MEASURED |
|---|---|---|
| flatten, light (105/106) | `cv2.bilateralFilter` d=9 σ75 | 15.2 ms/f |
| flatten, strong (105) | `cv2.bilateralFilter` d=15 σ120 | 43.3 ms/f |
| micro-flatten (105) | `cv2.medianBlur` k=5 | 1.1 ms/f |
| median-pool heavy (106 hybrid) | `cv2.medianBlur` k=9 | 35.2 ms/f |
| gradients (105 normals, 106 saliency) | `cv2.Sobel` xy / `cv2.Laplacian` | 0.2–0.3 ms/f |
| **relief-shade 3-light (105, §4.2)** | numpy Sobel normals + 3 fixed lights | **13.1 ms/f** |
| specular fake (105 plasticine) | threshold+`GaussianBlur` σ6+screen | 7.8 ms/f |
| tilt-blur diorama cue (105) | `GaussianBlur` σ4 + gradient blend | 2.7 ms/f |
| saturation lift (105) | HSV ×1.25 | 1.3 ms/f |
| vignette (105) | radial mask multiply | 11.6 ms/f |
| grain, fixed PRNG (105) | numpy `default_rng` add | 5.6 ms/f |
| palette snap, fixed 10-color LAB (105/106) | naive broadcast nearest | 74.9 ms/f (naive; LUT-optimizable) |
| palette derive, once per clip | `cv2.kmeans` K=10 on 230k px, 10 it | 75 ms one-time |
| anchor sampling (106) | gradient-magnitude weighted picks | 1.5 ms/f |
| **Delaunay (106)** | `cv2.Subdiv2D` insert 1500 pts + tri list | **2.0 ms/f** |
| Delaunay alt (106) | `scipy.spatial.Delaunay` 1500 pts | 4.0 ms/f |
| **flat fill, label-map + bincount (106)** | fillPoly rasterize + per-channel means | **17.3 ms/f** |
| flat fill, naive per-tri masks (106) | anti-pattern, recorded | 2425.7 ms/f (REJECTED) |
| label-edge darkening (106) | numpy diff on label map ×0.45 | 3.0 ms/f |
| SLIC 600/1200 segments (106, pip-class) | `skimage.segmentation.slic` | 166–173 ms/f |
| SLIC segment-mean recolor (106) | bincount over labels | 9.2 ms/f |
| classic Kuwahara k=7 (106 hybrid) | vectorized numpy, 4 quadrants | 904.2 ms/f (OVER b8 budget) |
| Farneback flow (106 temporal) | `calcOpticalFlowFarneback` | 43.0 ms/f |
| MOG2 apply, warmed (105 mask-split) | `createBackgroundSubtractorMOG2` | 3.3 ms/f |
| posterize LUT 4 levels (106 game-cel) | `cv2.LUT` | 0.2 ms/f |

Budget arithmetic (b8 = 1190 frames): a full SPR105 pipeline (§4 recipe) sums to
≈148 ms/f ≈ **176 s ≈ 2.9 min per render** (ESTIMATED from MEASURED stages; not
yet run end-to-end). A full SPR106 Delaunay pipeline (§5 recipe) sums to ≈26 ms/f
without flow stabilization, ≈69 ms/f with it — **31–82 s per render**. Both sit
far inside the packet-B-class render budgets the six existing lanes operated
under; the double-render determinism proof roughly doubles that and still fits.

## 4. SPR105 — Clay / Miniature / Toy

Goal: plasticine / stop-motion / toy-diorama broadcast feel — same match, same
timeline, same motion.

**Honest headline (re-confirming wave-1 §9/§22): no turnkey open-source claymation
video filter exists.** Searches s01–s03 (2026-09-27) again return only 3D-app
tutorials, hosted image/video generators, and research papers for other problems.
The family is and remains an own-implementation family; what this packet adds is
(a) a decomposition into classical-deterministic stages that all exist locally,
(b) MEASURED costs for each, (c) the license-clean depth-model upgrade path, and
(d) the hosted/GPU candidates recorded for completeness with verdicts.

### 4.1 Deterministic baseline A — "plasticine read" flatten stack (extends wave-1 `spr105.det.clay-approximation`)

Wave-1's baseline sketch was: strong bilateral + wide clay palette (K≈10) +
fixed-PRNG clay-noise displacement + 10–12 fps "on twos" quantization + soft
specular fake. This packet keeps that skeleton and sharpens it with measured
parameters: bilateral d=9 σ75 ×2 iterations (30.4 ms/f measured) + median k=5
(1.1 ms/f) + fixed per-clip LAB palette K=12 with **toy-saturation profile**
(sat-lift ×1.25 applied to palette centroids at derivation time, once per clip —
fixed palette = temporal stability by construction) + specular fake (7.8 ms/f) +
tone-lut contrast S-curve + vignette 0.35 (11.6 ms/f) + fixed-PRNG grain σ6
(5.6 ms/f; or ffmpeg `noise` with fixed `c0_seed` — determinism VERIFIED §3).

- source: Sporta-owned (wave-1 baseline, sharpened here); primitives VERIFIED-LOCAL.
- quality expectation (EXPECTATION, not measured): the wave-3/4 lesson says
  aggressive flatten destroys player structure — this recipe is medium-flatten
  (d=9 ×2, NOT the d=15 strong variant) with the structure carried by relief
  shading (4.2) and specular; the toy palette (K=12, saturated centroids) reads
  "toy" mostly through color, which is the cheapest structure-preserving cue.
- failure modes: can read as "posterize" rather than clay (wave-1's own warning —
  stands); grain+vignette overdone reads as retro, not toy; K too small merges
  kit colors (identity risk — keep K≥10 and derive per-clip).
- integration: 100% existing SPE stages (bilateral-flatten, median-pool,
  palette-quantize, tone-lut, saturation-lift, grain, vignette, encode-bitexact).
- classification: preferred-implementation-candidate · `cpu-local-runnable`.

### 4.2 Deterministic baseline B — relief shading from luma ("fake 3D clay light response") — the packet's ONE proposed new stage

The single strongest addition this research found for SPR105: **compute a normal
map from luma (Sobel gradients as surface slopes) and light it with 2–3 fixed
directional lights, then multiply-blend as a matte shading layer.** This is the
classical hillshade/emboss family of techniques:

- Technique references (search-observed 2026-09-27): Unity docs "Create From
  Grayscale" heightmap→normal-map import path (https://docs.unity3d.com); QGIS
  LiDAR Relief Visualization plugin — multi-directional hillshade, sky-view
  factor (https://plugins.qgis.org); GDAL hillshade (QGIS tutorial,
  https://storage.googleapis.com / https://grass.osgeo.org docs, s05). GIS
  multi-directional hillshading is exactly "deterministic fake relief lighting
  from a height field" — with luma as a proxy height field it becomes a
  video-filterable stage.
- MEASURED: 13.1 ms/f at 640×360 for the full numpy pass (Sobel xy → normalize
  → 3 lights `(-0.5,-0.5,0.7)`, `(0.5,-0.3,0.8)`, `(0,0.6,0.7)` → soft-clip mix).
  Deterministic by construction: fixed lights, fixed params, no state.
- Why it matters strategically: it **re-injects luminance structure that flatten
  destroys** — directly attacking the program's Tier-0 diagnosis (identity /
  structure collapse). The shading follows the source's own luminance edges every
  frame, so it moves WITH the players (no lag, no mask needed), while the palette
  stays fixed. Clay/plasticine is precisely a matte, low-frequency, relief-lit
  surface look.
- failure modes: luma is not depth — relief "pop" on flat-but-bright regions
  (sky, pitch highlights) can shimmer with exposure changes (mitigate: shade the
  FLATTENED luma, not the raw luma — flatten first kills exposure micro-flicker);
  emboss halos around strong edges if the normal step is too large (keep mix ≤
  0.35–0.4).
- integration: new renderer-declared stage `relief-shade` (numpy, ~30 lines) in
  the renderer's pipeline declaration — additive, no engine edit. Everything
  else in the recipe is an existing stage.
- classification: preferred-implementation-candidate · `cpu-local-runnable`.

### 4.3 Toy palette quantization (fixed per-clip LAB, saturated centroids)

The engine's `palette-quantize` stage reused with a family profile: K=12 (wider
than anime's K≈7 — more identity survives), LAB, palette derived ONCE per clip
from 16 evenly-spaced sampled frames via `cv2.kmeans` (fixed seed; 75 ms
one-time), nearest-snap per frame. MEASURED snap cost 74.9 ms/f with the naive
broadcast implementation — acceptable inside the 148 ms/f recipe, and reducible
(via a 32³ LUT) if needed. ffmpeg fallback path exists encoder-side:
`elbg` (posterize, deterministic VERIFIED, ~40–60 ms/f) — but per-frame codebook
refinement can shift colors frame-to-frame (flicker risk) → prefer the engine's
fixed-palette stage; `palettegen`+`paletteuse` (VERIFIED present) is the
palette-fixed ffmpeg alternative when a filtergraph-only variant is wanted.
Classification: preferred-implementation-candidate (as a stage of A) ·
`cpu-local-runnable`.

### 4.4 Diorama depth cue — depth-haze (aerial perspective) + tilt-blur

The miniature/diorama read needs a depth cue. Classical aerial perspective:
distant = lighter, lower-contrast, hue-shifted toward blue (references:
https://en.wikipedia.org/wiki/Aerial_perspective ,
https://perspectiveresearchcentre.com , art-technique write-ups, s07). Tilt-blur
(a.k.a. miniature/tilt-shift): blur the far band, sharpen the near band —
MEASURED 2.7 ms/f (gblur σ4 + vertical-gradient blend).

- **Honest limitation (recorded, not hidden): a real depth map is not available
  in-envelope.** The in-envelope implementation is a HEURISTIC depth proxy:
  vertical-position gradient (in broadcast wide shots, lower-in-frame ≈ nearer).
  It works on the canonical wide in-play shots and is wrong on close-ups and
  low-angle cuts — per contract §1/§8 this is a `degradations` entry
  ("diorama depth cue uses vertical-position heuristic; no depth engine in
  sandbox"), not a fabrication. The depth-model upgrade path (4.6) replaces the
  heuristic when a GPU lane exists.
- classification: fallback (stage of A, degraded-honesty) · `cpu-local-runnable`.

### 4.5 Segmentation-guided treatment (players vs pitch) — contract-compatible

Optional emphasis: MOG2 subject masks (VERIFIED-LOCAL; MEASURED 3.3 ms/f warmed)
→ stronger clay treatment (relief mix ↑, specular ↑) on players, calmer
palette-simplification on pitch — the exact architectural precedent of the
in-engine `spr-subject-toon-dc1` reality (wave-3 promotion). Contract posture
check: masks are engine-local (MOG2), NOT SWM facts; `swm: null` unaffected;
when MOG2 breaks on pans the treatment degrades to global (honest degradation
entry; the R606 global-motion-compensation stabilizer is the known mitigation).
Classification: experimental (profile of A) · `cpu-local-runnable`.

### 4.6 GPU/depth upgrade path (recorded with license verdicts — the 2026-09-27 license findings)

- **Depth Anything V2 — license SPLIT, search-observed 2026-09-27 (supersedes
  wave-1's blanket "verification deferred" for this repo, see §9 delta):**
  "Depth-Anything-V2-Small model is under the Apache-2.0 license.
  Depth-Anything-V2-Base/Large/Giant models are under the CC-BY-NC-4.0 license"
  (repo README snippet, https://github.com/DepthAnything/Depth-Anything-V2, s08).
  RED FLAG for Base/Large/Giant; Small is license-clean for commercial use
  (search-observed, not legal review). A DA-V2-Small → normal map → relief-shade
  pipeline is the highest-fidelity clay path — but needs torch-class runtime →
  `needs-gpu` (this sandbox has no torch; onnxruntime absent too).
- **Video Depth Anything (ByteDance, CVPR 2025)** — temporally consistent
  long-video depth (wave-1 enabler; mlx port card confirms CVPR-2025-highlight
  status, s32; a practitioner note recommends downscaling before inference for
  speed, s32). Code repo license NOT captured by search (2 attempts, s13/s17) —
  **verification deferred**. VDA-Small model card exists on HF (s08) but its
  license statement was not captured by snippets — **verification deferred**
  (do NOT assume it mirrors the DA-V2 split, though that is the ASSUMED pattern).
  `needs-gpu` · classification: experimental (depth enabler for 4.4/4.6).
- **MiDaS (isl-org)** — NEW enabler record (absent from wave-1): robust
  monocular relative depth, the off-the-shelf standard for years. **MIT —
  search-observed 2026-09-27 via multiple independent sources**: LibreYOLO docs
  "The isl-org/MiDaS repository, code and released checkpoints included, is MIT"
  (https://www.libreyolo.com/docs/models/midas); HF space README "MiDaS: MIT
  License"; OpenUPM package card "MIT License"; Medium SOTA survey "Repo:
  isl-org/MiDaS (MIT License)" (s16, s14). Per-frame (no temporal conditioning)
  → flicker risk on video without flow-warp smoothing; relief-shade use is
  more forgiving (shading is a low-frequency signal) — treat as
  ASSUMED-better-than-nothing, needs measurement. `needs-gpu` (torch) ·
  classification: benchmark-only.
- **Depth Anything 3** — 2026 coverage exists (s13 mentions a GGUF-packaged
  smallest model ~99 MB); license not captured (s29 off-target) — verification
  deferred; not load-bearing for any wave decision.

### 4.7 Hosted clay/toy generators (for the record — NOT implementation paths)

All are per-frame-generative or full-generative restyle → the FORBIDDEN
slideshow anti-pattern for source-preserving use; recorded for completeness
with honest pricing/free-tier status:

- **ModelsLab "ClayMotion F1 — Claymation/Stopmotion Style Blend for FLUX"** —
  text-to-image claymation model; **$0.0047 per API call, plans start $149/mo**
  (search-observed on modelslab.com page, s01; docs at
  https://docs.modelslab.com, s27). Free tier: trial credits/coupons appear in
  snippets ("Try model for free", s27 HF snippet) — **ASSUMED, unverified
  quotas**. Per-frame img2img on 1190 frames ≈ $5.6/clip AND destroys temporal
  identity → not-recommended · `needs-provider-key`.
- **DomoAI** — video restyle platform, 30+ styles (anime/illustration focus).
  Search-observed pricing (2026-09-27, s23/s31): new accounts start with 30
  credits ("one generation at 480P and four seconds", domoai.app); Basic
  $9.99/mo with 500 Fast-Mode credits (note.co aggregation); a face-swap
  grid "starts at $9/mo (yearly) with 600 monthly credits" (nation.ai). **Free
  tier status CONFLICTING across aggregators**: ai-deck.app (2025-12) "there is
  no ongoing free plan" vs checkthat.ai (2026-07) "free plan requires no credit
  card… 2 credits per image in a video" vs motionvid.ai listing DomoAI among
  free-tier advertisers — recorded as ASSUMED-CONFLICTING, unverified. One
  aggregator claims "Runway and DomoAI are the only two tools here that permit
  commercial use of free-tier output" (checkthat.ai — aggregator claim, NOT a
  terms review). Generative restyle → forbidden for our use → byok-option at
  best (external quality reference) · `needs-provider-key`.
- **GoEnhance AI** — video-to-animation platform; **claymation/clay/stylized-3D
  looks explicitly listed** ("Direct conversion into illustrated, clay, or
  stylized 3D… claymation, flat animation, and stylized 3D", dev.to comparison,
  Sep 2026, s34; directory confirmation s24). Pricing NOT captured by search —
  verification deferred. Same forbidden-use verdict · `needs-provider-key`.
- **EZArt (Kling O3 V2V-Edit)** — 36 video restyle styles incl. pixel art, free
  trial claimed (s33, ezart.io snippet); terms unverified. **komiko (Wan 2.1
  V2V)**, **autoais (photo→claymation/toy image tool)** — same class, s33.
- **Wave-1's oakgen.ai rejection stands** (per-frame clay image tool).

### 4.8 SPR105 family verdict

**Dispatch-trial — YES (conditional on renderer-lane capacity; never blocking
the in-flight tier-2 push).** Measured reasoning:

1. The full deterministic recipe is IN-ENVELOPE and cheap: ≈148 ms/f MEASURED
   stage sum → ≈2.9 min per b8 render (ESTIMATED from measured stages); the
   trial evidence pack (render + double-render + gates) fits in well under 15
   minutes of machine time.
2. It requires ZERO new dependencies and ONE new renderer-declared stage
   (`relief-shade`) — the rest is existing frozen stages.
3. The family's look is differentiated from the failed flatteners by structure,
   not by more flatten: relief shading + specular + toy palette attack the
   Tier-0 diagnosis (structure collapse) with the cheapest possible mechanism.
4. Honest risks recorded: may read as posterize (wave-1's warning); the diorama
   depth cue is heuristic-only in-envelope (degradation entry); the optional
   "on twos" stop-motion cadence profile carries a real G-T3 motion-correlation
   risk (frame duplication halves effective motion) — keep cadence OFF for gate
   runs, ON as a style profile only.

Exact recipe sketch (spr-clay-toy-dc1 proposal): bilateral d=9 σ75 ×2 (30.4) →
median k=5 (1.1) → palette-quantize fixed LAB K=12 toy-profile (74.9) →
**relief-shade 3 fixed lights mix 0.35 (13.1, NEW STAGE)** → specular fake
(7.8) → tone-lut S-curve + saturation-lift 1.25 (1.3) → tilt-blur diorama cue
(2.7, degraded-honesty) → vignette 0.35 (11.6) → grain σ6 fixed-PRNG (5.6) →
encode-bitexact. Total ≈148 ms/f. Optional profiles: `stop-motion` (12.5 fps
on-twos re-time by duplication), `mask-split` (MOG2-guided stronger clay on
players). All stages deterministic; palette and lights fixed per clip; cut-reset
irrelevant (no temporal state) except for the on-twos profile which must
re-phase per cut.

## 5. SPR106 — Low-Poly / Game-like

Goal: flat-shaded polygon / stylized-game output — faceted flat color, thick
clean edges, same motion.

**Honest headline (re-confirming wave-1 §10/§22): no maintained CPU low-poly
video tool exists** (s18/s26 off-target again; wave-1's CUDA-class reference
https://darkforte.github.io and the collidingscopes Video-to-Pixel-Art reference
stand). Own implementation, and — unlike SPR105 — the implementation primitives
are ALL in the recorded envelope and now MEASURED.

### 5.1 Deterministic baseline A — Delaunay flat-fill with deterministic anchors + temporal stabilization (extends wave-1 `spr106.det.delaunay-lowpoly`)

Wave-1 sketched: gradient-magnitude-weighted point sampling (temporally
smoothed) + `cv2.Subdiv2D`/scipy Delaunay + per-triangle flat palette color.
This packet measured it and fixed the implementation trap:

- **The naive per-triangle fill is an anti-pattern**: 2425.7 ms/f MEASURED
  (per-triangle mask allocation) → 48 min for b8. REJECTED — recorded so nobody
  burns an afternoon on it.
- **The label-map fill is the right implementation**: rasterize all triangles
  once via `cv2.fillPoly` into a label map, then per-channel `np.bincount` means
  + LUT apply: **17.3 ms/f MEASURED** (2567 triangles from 1300 points). A 140×
  speedup over the naive path, purely implementation.
- Anchor selection MEASURED 1.5 ms/f: deterministic jittered grid (fixed
  per-clip PRNG seed, spacing ~24 px) + gradient-magnitude-weighted top-up
  points (Sobel magnitude on luma, Gaussian-σ2 smoothed) to N≈1200–1500.
- Triangulation MEASURED: `cv2.Subdiv2D` 2.0 ms/f @1500 pts (scipy
  `Delaunay` 4.0 ms — both fine; Subdiv2D is the wave-1-verified primitive).
- **Temporal stabilization (the family's central risk is triangle flicker):**
  (i) derive anchors from a 5-frame box-averaged saliency (deterministic
  window) — wave-1's design, kept; (ii) flow-guided anchor propagation — warp
  the previous frame's anchors forward with Farneback flow (43.0 ms/f
  MEASURED), blend with fresh anchors via fixed EMA, **cut-reset on scene
  change** (engine cut-detect stage — contract G-T2/G-T4 compliance: no
  cross-cut blending, ever). Academic precedent for temporally-coherent
  superpixels/segmentation under flow: UC Merced PAMI-2018 spatiotemporal GMM
  with hierarchical superpixels + spanning trees + optical flow
  (https://faculty.ucmerced.edu/mhyang/papers/pami18_background_subtraction.pdf,
  s21). No turnkey implementation found (s30 off-target) — own implementation,
  as wave-1 concluded.
- quality expectation (EXPECTATION): facet edges are IDENTITY ANCHORS — unlike
  the flatteners, this family ADDS structure (triangle boundaries track real
  edges via the saliency anchors), which is why it is the strongest candidate
  against the Tier-0 diagnosis. Risk: 640×360 players are ~20–60 px — triangle
  density must be high near players (saliency weighting does this) or limbs
  turn to mush; ball (small, fast) may under-sample — mitigate with a
  motion-saliency term in the anchor weights (motion-mask stage exists).
- failure modes: triangle flicker if anchors are per-frame-fresh (avoid — use
  the smoothed/flow-stabilized path); mud at low density; Subdiv2D degenerate
  points on duplicate anchors (dedupe with a grid snap — deterministic).
- classification: **preferred-implementation-candidate** · `cpu-local-runnable`.

### 5.2 Deterministic baseline B — SLIC superpixel flat-color + edge darkening (the "classic low-poly still-frame effect, made temporal")

The packet-directed candidate: SLIC over-segmentation + per-segment flat color
+ edge darkening, temporal via flow-guided seed propagation with cut-reset.

- SLIC: Achanta et al., TPAMI 2012 (https://ieeexplore.ieee.org/document/6205760,
  12k+ citations; EPFL IVRL page; IPOL 2022 bilateral-k-means SLIC article,
  s15). Reference CPU implementation: `skimage.segmentation.slic` —
  **scikit-image is BSD-3-Clause** (search-observed 2026-09-27: msys2 package
  card "BSD-3-Clause AND BSD-2-Clause AND MIT", snyk, FreeBSD ports — s12).
- MEASURED in this sandbox (skimage 0.24.0 imports today — §3 delta): SLIC
  600–1200 segments = 166–173 ms/f; segment-mean recolor = 9.2 ms/f; label-edge
  darkening = 3.0 ms/f. Determinism: two runs → identical label maps
  (VERIFIED-LOCAL).
- **Envelope honesty**: skimage is NOT in the wave-1 recorded envelope → this
  candidate is classified `cpu-local-after-pip` (it runs today, but a sandbox
  reset could remove it; the mandatory family baseline is 5.1, in-envelope).
  Also note cv2's own SLIC lives in `ximgproc` which is ABSENT from this build
  (re-verified) — skimage is the only local SLIC.
- Temporal: same architecture as 5.1 (flow-guided seed propagation, EMA,
  cut-reset); SLIC seeds (cluster centers) propagate more naturally than
  Delaunay anchors (grid structure), so this variant may actually stabilize
  better — ASSUMED, needs the trial's measurement.
- classification: preferred-implementation-candidate (upgrade variant, pip-class)
  · `cpu-local-after-pip`.

### 5.3 Deterministic baseline C — posterize + Kuwahara painterly-flatten hybrid (game-look poster shading) — honest over-budget finding

The packet-directed candidate: posterize + Kuwahara hybrid. **MEASURED RESULT:
the classic Kuwahara at k=7 costs 904.2 ms/f** (vectorized numpy, 4 quadrants)
→ ≈17.9 min for ONE pass over b8 — exceeds the single-render budget before
palette, edges, or encode are added. Wave-1 called anisotropic Kuwahara "the
heaviest deterministic stage — budget-test first"; this packet's budget-test
says: too heavy at k=7 in the naive-vectorized form.

- Options recorded honestly: (a) keep the hybrid idea but substitute the
  median-pool + bilateral flatten (1.1 + 15.2 ms/f) for the Kuwahara term —
  the "posterize + flatten" game-poster look survives, the painterly term does
  not; (b) integral-image / separable-statistics optimization of Kuwahara
  (textbook optimization, plausibly 4–8× — ESTIMATED, unproven here) — needs
  research still; (c) Kuwahara on a 2× downsampled proxy then upsample the
  class map — needs research still. **The Kuwahara term stays BACKLOG with the
  measured number attached.**
- pykuwahara license RESOLVED (supersedes wave-1's "verification deferred",
  §9 delta): **GPL-3** (Gentoo Portage overlays, two mirrors, s25 —
  https://github.com/yoch/pykuwahara). GPL-3 code must NOT be copied into the
  Sporta engine; wave-1's posture ("own numpy implementation; do not copy the
  TD GPL-3 port") is now fact-based.
- posterize term: `cv2.LUT` 4-level MEASURED 0.2 ms/f; ffmpeg `elbg` posterize
  VERIFIED deterministic (§3) as the encoder-side alternative.
- classification: fallback (posterize+flatten form) / needs-research (Kuwahara
  term) · `cpu-local-runnable` (without the Kuwahara term).

### 5.4 Deterministic baseline D — toon ramp shading (quantized lambert) + thick outlines (game-cel)

The packet-directed game-cel candidate, fully in-envelope and cheap:

- Toon ramp: quantize the shading term (from the SAME relief-shade machinery as
  SPR105 — a lambert term from luma-normals, or simply posterized luma) through
  a fixed 3–4 step ramp LUT — "toon ramps are one-dimensional textures that
  match a value of light to a color" (https://panthavma.com toon-shading
  fundamentals, s19; Unity/Blender cel-shader discussions, s19). MEASURED ramp
  LUT ≈0.2 ms/f (posterize class) + optional 13.1 ms/f if using the 3-light
  lambert term.
- Thick outlines: gradient-magnitude (Sobel) threshold → `cv2.dilate` (wave-1
  VERIFIED dilation/erosion ffmpeg filters; cv2 morphology present) → dark
  overlay. Cost class ≈2–5 ms/f (Sobel 0.3 measured; dilation similar class —
  ESTIMATED). The classical cartoonify edge-mask pattern (wave-1 evidence:
  geeksforgeeks/datahacker/dev.to) is the fallback edge path (noisier than
  XDoG — wave-1's finding).
- Temporal: ramp LUT fixed → cannot flicker; outlines crawl on noisy grass
  (same class as wave-1's XDoG crawl) → mitigate with temporal edge averaging
  via flow-warp (the in-engine flow-prop-toon architecture from wave-2c is the
  precedent).
- classification: preferred-implementation-candidate (profile of the SPR106
  trial renderer — `game-cel` profile) · `cpu-local-runnable`.

### 5.5 Block-voxel variant (wave-1 baseline re-affirmed)

Wave-1's `spr106.det.block-voxel` (block-downsample nearest ~96×54 + palette +
per-block luma bump + block grid) re-affirmed as the cheapest family fallback —
all primitives in-envelope (the collidingscopes Video-to-Pixel-Art reference
stands). Nothing new to add beyond the wave-1 record; costs are trivially
inside budget (downsample + upsample ≈ a few ms/f — ESTIMATED from primitive
class). True mesh voxelizers remain wrong-modality for video (wave-1's
cuda_voxelizer note stands; MagicaVoxel is a GUI sculpting tool — s28 — same
wrong-modality class).

### 5.6 GPU / provider records for SPR106 (for the record)

- **Depth-modulated density/parallax** (wave-1 `spr106.nn.depth-parallax`):
  Video Depth Anything / DA-V2 modulating triangle density or block height —
  `needs-gpu`; license posture per §4.6 (DA-V2-Small Apache-2.0 clean; VDA
  deferred; Base/Large/Giant CC-BY-NC RED FLAG).
- **TripoSR (Stability AI + Tripo AI)** — image→3D mesh in <0.5 s on GPU —
  **MIT license** search-observed 2026-09-27 (HF model card "License: MIT";
  builderai.tools "MIT licensed"; NexGPU "MIT across the board", ~6 GB VRAM;
  s22). Recorded as the license-clean exemplar of the mesh-converter class —
  but WRONG MODALITY for a video restyle pipeline (per-frame meshes do not
  compose into a source-preserving video; a per-frame mesh generator is the
  mesh form of the slideshow anti-pattern). classification: benchmark-only ·
  `needs-gpu`.
- **Hosted game/low-poly restyle providers**: the EZArt/Kling "pixel art" style
  and komiko (Wan 2.1 V2V) class (s33) — generative restyle → forbidden for
  our use; byok-option at best · `needs-provider-key`. Wave-1's
  Replicate/Runway/fal.ai provider records (pricing, free-tier statuses) remain
  the authoritative provider registry — nothing in this packet supersedes them.

### 5.7 SPR106 family verdict

**Dispatch-trial — YES (strongest next-family candidate of the two).** Measured
reasoning:

1. Cheapest full-family pipeline measured yet: 26 ms/f without flow
   stabilization (31 s/b8 render), 69 ms/f with it (82 s/b8) — the trial
   evidence pack is minutes of machine time.
2. Fully in-envelope (cv2.Subdiv2D + scipy + numpy — all wave-1-verified; the
   label-map fill implementation is specified with the measured anti-pattern
   warning attached).
3. Structure-ADDITIVE family: facet edges and thick outlines give the VLM
   identity anchors that the flatteners lacked — the best-positioned family
   against the Tier-0 diagnosis (EXPECTATION, to be proven by the trial's
   frozen-protocol scorecard).
4. SLIC upgrade variant and game-cel profile ride the same renderer skeleton
   (segment-label plumbing shared by Delaunay labels and SLIC labels) — one
   trial renderer, three looks.

Exact recipe sketch (spr-lowpoly-game-dc1 proposal): luma → 5-frame
box-averaged gradient saliency → anchors = deterministic jittered grid (fixed
PRNG, 24 px) + saliency-weighted top-up to N≈1200 (1.5 ms) → [temporal:
Farneback warp prev anchors (43.0) + fixed EMA + cut-reset] → `cv2.Subdiv2D`
insert (2.0) → fillPoly label-map rasterize + bincount flat fill (17.3) →
palette-quantize snap K=16 fixed per-clip LAB (optional profile) → label-edge
darkening ×0.45 (3.0) → [game-cel profile: ramp LUT 3–4 steps (0.2) + Sobel
outline dilate ×2 (~2–5, ESTIMATED)] → encode-bitexact. Total ≈26 ms/f base /
≈69 ms/f flow-stabilized. SLIC profile: `skimage.slic` 600–1200 segments
(166–173) + same label plumbing (9.2) — pip-class dependency flagged.

## 6. Shared temporal-stabilization architecture (both families)

Both trials need the same thing: per-frame-independent segmentation/anchors
made temporally stable. The architecture (already half-built in-engine):

1. cut-detect (engine stage) gates ALL temporal state — reset on every detected
   cut (contract invariant 4);
2. flow (Farneback, VERIFIED-LOCAL, 43.0 ms/f measured) warps the previous
   frame's anchors/seeds forward;
3. fixed-EMA blend of warped-old + fresh-saliency-new (deterministic, no
   learned state);
4. fixed per-clip PRNG seeds for grids/jitter — palette and lights likewise
   fixed per clip.

This is the flow-prop-toon architecture (wave-2c KEEP verdict) generalized from
palette propagation to point/seed propagation. No new engine capability needed;
it composes existing stages.

## 7. License discipline & red flags (new findings, 2026-09-27, search-observed — NOT legal review)

LOUD flags (new in this packet):

- **Depth-Anything-V2 size-split license**: Small = Apache-2.0; Base/Large/
  Giant = **CC-BY-NC-4.0 — commercial use prohibited** (repo README snippet,
  https://github.com/DepthAnything/Depth-Anything-V2, s08). Any depth lane must
  pin Small (or MiDaS MIT) or stop at the license wall. Supersedes wave-1's
  "verification deferred" for this repo (delta recorded §9).
- **pykuwahara = GPL-3** (Gentoo Portage overlays ×2, s25): do-not-copy for the
  engine; own implementation only (algorithm public per Kyprianidis 2009, per
  wave-1). Resolves wave-1's deferred item.
- **Hosted clay/toy generators** (ModelsLab ClayMotion $149/mo-class plans,
  $0.0047/call; GoEnhance claymation looks; DomoAI; EZArt/Kling; komiko/Wan):
  generative restyle = forbidden anti-pattern regardless of price; ALSO note
  the free-tier honesty rule — DomoAI's free tier is CONFLICTING across
  aggregators (ASSUMED-CONFLICTING), ModelsLab trial credits ASSUMED,
  GoEnhance pricing not captured (deferred). None is load-bearing.

Clean-permissive observed this session: **MiDaS MIT** (multiple sources, s16 —
code and checkpoints); **TripoSR MIT** (HF card + aggregators, s22);
**scikit-image BSD-3-Clause** (package registries, s12); ffmpeg elbg/noise/
palettegen/paletteuse (LGPL build, wave-1 posture).

Carried over from wave-1 unchanged (authoritative): RVM weights CC-BY-NC;
vid2vid CC-BY-NC-SA; ToonCrafter treat-NC; LTX threshold license; AnimeGANv2
weights provenance; EbSynth read-terms; Real-ESRGAN VSR-variant caution.

## 8. Wave recommendation (TL decision input)

| Family | Verdict | One-line reason (measured) |
|---|---|---|
| SPR105 clay/toy | **dispatch-trial** (queue behind the in-flight tier-2 lane) | ≈148 ms/f measured stage sum (≈2.9 min/b8 render), zero new deps, one new renderer-declared stage; relief-shade attacks the Tier-0 structure-collapse diagnosis; risks (posterize-read, heuristic depth cue, on-twos G-T3 risk) recorded and profile-gated. |
| SPR106 low-poly/game | **dispatch-trial** (strongest next-family candidate) | 26–69 ms/f measured (31–82 s/b8 render), fully in-envelope, structure-ADDITIVE look (best positioned vs the Tier-0 diagnosis); triangle-flicker risk mitigated by the measured recipe (smoothed saliency + flow-stabilized anchors + cut-reset); SLIC/game-cel profiles ride the same skeleton. |

Not worth it (recorded, with reasons): per-frame generative clay/toy tools
(forbidden anti-pattern + per-frame cost); full-Kuwahara hybrid in the trial
wave (904.2 ms/f MEASURED over budget — stays backlog with the number
attached); per-frame mesh generation via TripoSR-class converters (wrong
modality — mesh-form slideshow); DA-V2 Base/Large/Giant depth (CC-BY-NC);
assuming hosted free tiers (DomoAI conflicting, ModelsLab assumed — no keys
exist anyway).

## 9. Cross-check note: relationship to the wave-1 registry (BINDING)

This packet is additive to `docs/technology/source-preserving-candidates.yaml`
and `docs/research/source-preserving-technology-landscape.md` (both wave-1,
Worker A). Nothing in either file is overwritten, contradicted, or edited. The
new registry `docs/technology/spr105-106-candidates.yaml` mirrors the wave-1
record schema (environment, feasibility/classification vocabularies, license
red flags, enablers, per-family entries) and references wave-1 records by id
where reused. Deltas where this research SUPERSEDES a wave-1 observation (all
noted here, wave-1 files left untouched):

1. **DA-V2 license**: wave-1 recorded `depth.videodepthanything` with
   "code license verification deferred". This session observed the DA-V2
   size-split (Small Apache-2.0 / Base+ CC-BY-NC-4.0) — the red flag is now
   specific; VDA-specific licenses remain deferred.
2. **pykuwahara**: wave-1's `verification_deferred` list includes
   `pykuwahara-license` — now observed GPL-3 (do-not-copy).
3. **MiDaS**: absent from wave-1's registry; now recorded (MIT, multiple
   sources) as a depth enabler.
4. **ffmpeg inventory**: wave-1's verified filter list did not include
   `elbg`, `palettegen`, `paletteuse`, `geq`, `gradfun`; all now VERIFIED-LOCAL
   (elbg + seeded-noise determinism proven byte-identical).
5. **Python inventory**: skimage 0.24.0 / sklearn 1.5.2 importable in this
   session but absent from the wave-1 recorded envelope — SLIC recipes are
   therefore classified pip-class despite running today.
6. **SPR105/106 family rows**: wave-1's skeletal rows (one baseline each)
   remain valid seeds; this packet expands them to full candidate records with
   measured costs. Wave-1's `spr105.det.clay-approximation`,
   `spr106.det.delaunay-lowpoly`, `spr106.det.block-voxel` are EXTENDED (with
   measured parameters), not replaced.

## 10. Search log (34 invocations, 2026-09-27, z-ai `web_search` CLI)

s01 claymation stop motion video filter open source python (ModelsLab ClayMotion
found) · s02 plasticine clay style video effect algorithm github (off-target) ·
s03 clay style video generator stable diffusion LoRA restyle (off-target) ·
s04 normal map from grayscale heightmap bump shading filter (Unity docs) ·
s05 multidirectional hillshade algorithm open source gdal (QGIS plugin) ·
s06 tilt shift miniature effect video ffmpeg (off-target) · s07 aerial
perspective atmospheric depth haze formula (Wikipedia + art refs) · s08 Video
Depth Anything github license (**DA-V2 size-split captured**) · s09 MiDaS
intel depth estimation github license (off-target) · s10 Video Depth Anything
Small apache cc-by-nc (off-target) · s11 isl-org MiDaS LICENSE file github
(partial) · s12 scikit-image skimage license BSD (confirmed) · s13 VDA-Small
model card license (off-target; DA3 existence) · s14 isl-org MiDaS repository
license (partial pointers) · s15 SLIC superpixels Achanta TPAMI (paper) ·
s16 "MiDaS" "MIT license" (confirmed ×5 sources) · s17 Video-Depth-Anything
repo LICENSE (off-target) · s18 low poly video effect open source python
github (off-target — gap re-confirmed) · s19 toon shading ramp quantized
diffuse (panthavma + engine discussions) · s20 cel shading outline sobel
dilation opencv (generic refs) · s21 temporal superpixel video segmentation
optical flow (UC Merced PAMI 2018) · s22 TripoSR license MIT (confirmed ×4) ·
s23 DomoAI video style transfer pricing free tier (conflicting free-tier
claims) · s24 GoEnhance AI claymation video effect pricing (existence only) ·
s25 pykuwahara github license (**GPL-3 confirmed**) · s26 convert video to low
poly 3D online (off-target — gap re-confirmed) · s27 ModelsLab API pricing
free plan credits (docs + trial credits) · s28 voxel art video generator
github (MagicaVoxel — wrong modality) · s29 Depth Anything 3 github license
(off-target) · s30 flow guided superpixel video stabilization github
(off-target) · s31 DomoAI pricing per second credits (30-credit signup,
$9.99/mo 500 credits) · s32 video depth anything CPU inference speed (mlx
port card; downscale tip) · s33 DomoAI clay style claymation video (EZArt
Kling 36 styles; komiko Wan 2.1; autoais) · s34 GoEnhance video to animation
clay 3D (**claymation looks confirmed**, dev.to).

Raw JSON: `/tmp/spr105-106-search/s01..s34.json` (session-local). 34
invocations, 0 rate-limited, ~20 on-target / ~14 weak-or-off-target (each
listed). No search was used to fabricate a version/license: every license claim
above carries its source, and every unverifiable item is recorded as deferred.

## 11. Source index (primary URLs cited, new in this packet)

https://github.com/DepthAnything/Depth-Anything-V2 (license split) ·
https://huggingface.co/depth-anything/Video-Depth-Anything-Small (existence) ·
https://github.com/isl-org/MiDaS (+ https://www.libreyolo.com/docs/models/midas ,
HF space, OpenUPM, Medium survey, opentrain — MIT observations) ·
https://ieeexplore.ieee.org/document/6205760 + https://www.epfl.ch/labs/ivrl/research/slic-superpixels +
https://www.ipol.im/pub/art/2022/373/article.pdf (SLIC) ·
https://scikit-image.org (BSD-3; registries in s12) ·
https://github.com/yoch/pykuwahara (+ Gentoo mirrors — GPL-3) ·
https://docs.unity3d.com (heightmap→normal) ·
https://plugins.qgis.org (multi-directional hillshade) ·
https://en.wikipedia.org/wiki/Aerial_perspective +
https://perspectiveresearchcentre.com (aerial perspective) ·
https://faculty.ucmerced.edu/mhyang/papers/pami18_background_subtraction.pdf
(temporal superpixels) · https://panthavma.com (toon ramps) ·
https://github.com/VAST-AI/TripoSR (+ HF card, NexGPU, builderai — MIT) ·
https://modelslab.com / https://docs.modelslab.com (ClayMotion pricing) ·
https://domoai.app (+ ai-deck.app, checkthat.ai, nation.ai, note.co, neura.market,
motionvid.ai — pricing/free-tier observations) · https://www.goenhance.ai (+
dev.to comparison, Sep 2026) · https://ezart.io / https://komiko.app /
https://autoais.com (s33) · https://darkforte.github.io +
https://collidingscopes.github.io (wave-1, stands) ·
https://ffmpeg.org/ffmpeg-filters.html (elbg/noise/palettegen/paletteuse) ·
https://magica.voxel (MagicaVoxel, s28).

— Worker D, 2026-09-27. Registry (machine-readable):
`docs/technology/spr105-106-candidates.yaml`.
