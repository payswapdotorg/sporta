# SPR-W5-C — SPR104 Ink/Manga/Comic: Deterministic Renderer Trial (Lane E)

Task: implement the SPR104 deterministic baseline `spr104.det.xdog-halftone`
(grayscale + XDoG soft-threshold sketch lines + 2-3 ink value classes +
screen-space fixed-lattice screentone + paper grain) as a registered
reality `spr-ink-manga-dc1`, fast-loop the parameters, full-render the
coverage cells, gate everything, and run the frozen 7-axis VLM scorecard
on b8 with an honest tier verdict. Branch `spr/w5c/ink-manga`, base
`0f905e2` (origin/main post lane-A merge). Engine contract FROZEN; the
registration is additive (one new row, +293/−0 in renderers.py).

## 1. Substrate verification (run first)

`sha256sum scripts/evidence/spr-corpus-bytes/*` — the three clips used by
this lane match the corpus README table exactly:

- `b8p3.mp4` `969af7c6fdb172091ff00705b25fa37b7073f4332d722416b9754a4a7579917a`
- `b8-b12.mp4` `b3cc5f0e2fae840f2aef93d859ce814babca226ee0b5d27e6da4e969b4312462`
- `clip-b2-closeup.mp4` `e65ae48740472f57ada031fdfb076cbb40a845239693acad83e8142c0caec062`

Tools: python 3.12.14, opencv 4.13.0, numpy 2.1.3 (system — identical to
the frozen engine toolset record), ffmpeg 7.1.5-0+deb13u1. No new repo
dependencies.

## 2. The renderer (frozen declaration, SPR104 candidate record)

`_InkMangaState` in `spe/renderers.py` (+293/−0 vs base):

- **Stage 1 pre_smooth** — median3 + bilateral ×3 (d9,s75): the XDoG
  noise-crawl mitigation; the cartoon-cel pre-quantize class (this became
  load-bearing — see §4).
- **Stage 2 XDoG line art** — the frozen stage library's Winnemöller
  soft-threshold DoG (sketch mode), sigma 1.0 / k 1.6 / tau 0.98 /
  eps 0.0015 / phi 10, params FIXED per frame. eps sets the shadow
  ink-pooling floor (flats with L > eps/(1−tau) ≈ 0.075 stay paper).
  The line layer is then **binarized at knee 0.5, median5-stabilized,
  re-softened σ0.8** — the cartoon-cel boundary-line pattern — so the
  soft band's enormous gain (φ/ε ≈ 6667/unit at these params) never
  reaches the compositor.
- **Stage 3 value quantize** — BT.601 luma → baked 256-entry
  pivot-contrast S-curve (pivot 0.55, contrast 1.15, ink pooling), line
  strokes burned at line floor 0.20.
- **Stage 4 screentone** — screen-anchored 8×8 **clustered-dot halftone**
  screen (ink grows from tile centers, paper holes shrink at corners;
  rank-ordered periodic distance matrix — compact 2..8 px dots, not Bayer
  scatter), ink dot iff threshold < density, density = 1 − tone over the
  FULL range with FIXED soft knees to solid ink (0.16, w 0.12) and clean
  paper (0.84, w 0.08) — **no hard class boundaries exist**, so sub-gate
  content drift grows/shrinks dots continuously instead of flipping whole
  pixels. Soft-dot ramp (window 0.25, exact saturation clamps) bounds
  flip amplitude. The dither is local-mean-preserving, which is why G-T3
  survives binarization (area-averaged dot fields reconstruct the tone).
- **Stage 5 paper grain** — a FIXED zero-mean texture (seed 42, scale 5),
  generated once per render, composited identically every frame: zero
  temporal delta by construction.

**Anti-crawl audit** (the candidate record's binding rules): the lattice
is screen-anchored (pixel-indexed, never content-fit); all
thresholds/knees are fixed constants; no temporal state; no per-frame
RNG; no frame-index dependence. Static scene areas produce byte-identical
dot patterns by construction. Player-region handling follows the
noir-retro pattern (global transform, no segmentation machinery invented
— the preservation gates decide).

## 3. Fast loop (variant table: `variant-table.json`)

Phase 1 (b8 first-300 window, gate input = the w4b-recorded b8-first300
derived reference, byte-reproduced `9efa9b99…`): four variants
(aggressive pooling / pooled-4 ladder / coarse 12px screen / fine 8px
screen) — **all gates passed on all four**; the full-resolution VLM duel
picked **v4** (eps 0.003, 8px, light pooling): "cleaner panel, clearer
limbs, kits and the number 3, authentic print texture".

Phase 2/3 (honest re-open): v4's full-render b2 close-up cell **FAILED
G-T4 raw** (1.8963% vs the 1.5% bar; input baseline 0.9449%). Isolation
A/B (E1–E5) + a direct drift measurement found the real mechanism: the
b2 G-T4 static selection carries **2–16 gray levels/frame of genuine
sub-gate content drift** (slow pan + crowd shimmer) — every hard
threshold converts drift into 255-level boundary swings; sensor-noise
models do not apply (E4 phi-cut and E5 eps-cut barely moved it; E1
no-lines proved the line burn dominant). Redesign: binary
median-stabilized strokes + soft density knees + cartoon-class smoothing
+ soft dots → **v8a**: b2 T4 **1.4337% PASS**, b8-300 T3 0.9605 / T4
0.6847%, and the final full-resolution VLM strip (original | v4 | V7a |
v8a) ruled "**SHIP: R** — stabilized thicker lines and softer screentone
dots mimic professional manga inking (like Captain Tsubasa)". v8a is
frozen verbatim in the shipped row; the earlier v4 full renders were
discarded and re-produced from scratch.

## 4. Full renders + gates (all green; `record.json` is the canonical table)

Every cell double-rendered into independent out-dirs (G-T5 discipline);
b12 gated against the pre-adjudicated first-300 gateref rebuilt from the
pre-w3a-fix b12 bytes (byte-reproduced `7cb3d728…` → `d19079ca…`, the
w3b pin).

| cell | frames | sha256 (BOTH passes) | det | G-T1 | G-T2 raw | G-T2b deep | G-T3 | G-T4 |
|---|---|---|---|---|---|---|---|---|
| b8 | 1190 | `8ffff3c1cb584307a6d61fe37232403057b0f14bbec72a80b97fc616f36e47df` ×2 | **yes** | PASS 1190==1190, Δ20 ms, audio ✓ | **PASS** cov 1.0, extra 0.0 — all 6 cuts at EXACT indices 189/475/550/862/979/982 | PASS cov 1.0, 0 invented (amp ratios 1.195–1.698) | **PASS r=0.9468** | **PASS 0.6185 %** (base 0.458 %) |
| b12 | 300 | `95fca63a5bea364b6f056766725f1e25cce7789a2948aff1c6294085c70ce841` ×2 | **yes** | PASS 300==300, Δ0 ms, audio ✓ | PASS cov 1.0, extra 0.0 (cuts 117/120 exact) | PASS cov 1.0, 0 invented | **PASS r=0.9546** | **PASS 0.7171 %** (base 0.4806 %) |
| b2 | 225 | `ecea14b0379141de0ba4b2561a2f975a2390407a2518e8287259aa25bbbbfa16` ×2 | **yes** | PASS 225==225, Δ20 ms, audio ✓ | PASS cov 1.0, extra 0.0 | PASS cov 1.0, 0 invented | **PASS r=0.9756** | **PASS 1.4337 %** (base 0.9449 %) |

Wall-clock (provenance telemetry): b8 68.5 s / 69.0 s (pass 1/2); b12
~13 s; b2 ~10 s. styleConfigHash stable across passes per cell (b8
`e7c01ded…`, b12 `8ff249f7…`, b2 `7702b3ff…`; the frozen adapter hashes
config + profile + frameCount, hence per-clip). The b8 flat-threshold
diagnostic records outputOnly frames [865, 868, 871, 874, 952] —
stylization-amplified sustained motion, the harness's own
counted-not-gated class (the spike detector that IS the gate found 0
extra cuts).

## 5. Regression (engine untouched, proven byte-level)

cartoon-cel / noir-retro (noir) / subject-toon b8 re-rendered via the
frozen `render.py` AFTER the promotion edit — all three **byte-identical
to the w4b 54-cell ledger anchors** (`a9e8cd56…` / `3eedb423…` /
`503ea271…`). The edit is provably additive to the engine's behavior for
every pre-existing reality.

## 6. Frozen-protocol VLM scorecard (b8, 15/15 calls landed)

`vlm_scorecard.py` (frozen, unmodified) on the machine-local
evidence root populated per its expected paths. glm-5v-turbo.

| axis | mean |
|---|---|
| sourceFidelity | 2.40 |
| temporalConsistency | 3.33 |
| identityConsistency | **1.47** |
| motionFidelity | **1.53** |
| sceneFidelity | 2.13 |
| stylizationStrength | 5.00 |

min axis **1.47**, overall 2.64, critical artifacts **88** (141 total),
hard gates ALL GREEN (G-T1..T5) — **tierClaim 0**.

**Honest verdict — Tier 0.** The family reproduces the cartoon-cel /
anime-npr failure class exactly: maximal stylization with identity/motion
collapse. The predicted temporal-strength IS real and visible to the VLM
("the visual noise and dot patterns remain highly stable between the two
frames" — temporalConsistency 3.33 with zero dot crawl by construction),
but monochrome binarization at 640×360 destroys player identity on wide
shots ("players are reduced to indistinct dark blobs"). The frozen bar
(every axis ≥ 4.0 + 0 critical + TL approval) is NOT met and no tier is
claimed beyond 0.

**Measured next increment:** identityConsistency 1.47 / motionFidelity
1.53 are the blockers (stylization 5.0 is at ceiling). The gap is the
monochrome-identity trade-off. Two attack paths, both already in the
architecture: (a) the candidate record's own replacement path —
ControlNet lineart/ink keyframes + EbSynth propagation (neural
keyframe accelerator, `*-nn*` registry row); (b) a subject-preserving
dual-path variant — subject-toon's mask-gentle architecture applied to
ink (gentle grayscale tone on masked players, full screentone on the
background), which attacks identity directly without giving up the
screentone background.

## 7. Files

- `record.json` — canonical machine record (declaration, shas, gates,
  regression, scorecard, next increment).
- `variant-table.json` — the full fast-loop + iteration record (phases,
  params, shas, gates, VLM verdicts).
- `qa/` — 6 raw gate JSONs (`qa-ink-manga-{b8,b12,b2}.json` +
  `cuts-deep-ink-manga-{b8,b12,b2}.json`).
- `scorecards/` — `scorecard-ink-manga.json` + `vlm-scorecard.json`
  (aggregate) + `raw/` 15 per-call VLM JSONs (the frozen harness's own
  outputs).
- `frames/` — extracted t=2/8 (+15/30/45 on b8) PNGs per cell from the
  pass-1 artifacts (the frozen adapter's `--frames`).
- `fastloop-visual/` — the three comparison strips (half-res grid,
  full-res duel, final strip) + the raw VLM comparison JSONs.
- `registry-listing.txt` — frozen `render.py --help` proving `ink-manga`
  in `--reality` choices.
- `commands.md` — every command, in order, with exact paths.

Not committed (re-derivable, commands recorded): the render
mp4/provenance outputs (the shas above are the verification anchors,
W2-B/W3-B/W4-C convention), the machine-local evidence root
(`/home/z/spr-evidence/`, the harness's expected paths), the derived
gate references and the scratch isolation harness (`/tmp/w5c/…`).

## 8. Deviations

1. **Phase-2/3 loop re-open after the initial winner**: v4 was frozen per
   the fast-loop mandate, but its b2 coverage cell failed G-T4 raw. The
   loop was honestly re-opened, root-caused (drift, not speckle), the
   design hardened, and ALL full renders re-produced with the final v8a
   config. The earlier v4-based artifacts were discarded, not archived
   as evidence.
2. **`spe/registry.py` left as found** (pre-existing dead code importing
   a non-existent `RENDERER_DECLARATIONS` — the W4-C recorded repo fact).
3. Task-packet wording "version dc1" interpreted per the W3-B/W4-C
   precedent: the rendererId carries the `-dc1` suffix; rendererVersion
   is `0.1.0` mirroring contract §4.
4. Renders ran with the system python3 (3.12.14 / cv2 4.13.0 /
   numpy 2.1.3 — identical to the frozen engine toolset record), not a
   project venv; recorded explicitly.
5. The scorecard's per-call VLM JSONs land in the machine-local evidence
   root per the frozen harness's paths; the copies committed here are
   byte-identical.
