# SPR-W5-F — SPR105 Clay/Miniature/Toy deterministic trial (TL REBUILD of the reset-lost w5f)

**Provenance (read this first):** the original spr/w5f/clay-trial implementation
was lost to the 2026-09-27 sandbox reset **before its PAT-blocked push ever
reached origin** (local main 9f9cd3f era, 6 commits queued on a PAT that never
arrived; the lost shas ee677d79/39a07659/38a42432 resolve nowhere on origin).
This is the faithful re-implementation of the recorded w5b rank-2 recipe
(same stage order, same parameters, from the wave-5 dispatch record) with
**every measurement re-run fresh** on this tree. The original's recorded
gate/duel/scorecard CLASSES reproduce (details in record.json
`rebuildProvenance`); nothing from the lost tree is claimed.

Renderer: `spr-clay-toy-dc1` v0.1.0 (`clay-toy`, deterministic-classical,
additive diff to `spe/renderers.py`: dispatch elif + `_ClayToyState` class +
`CLAY_TOY` spec/registration).

Recipe (the w5b rank-2, verbatim): medium flatten (median k5 + bilateral
d9 σ75 ×2) → fixed LAB K=12 toy palette (assignment on the learned
centroids; output through chroma-×1.25-lifted centroids) → **relief-shade**
(the ONE new renderer-declared stage: Sobel k3 slopes on the FLATTENED
luma → normals; 3 fixed lights key/fill/rim 0.50/0.30/0.20; flat-response
normalized to EXACTLY 1; tanh soft-clip; matte multiply at mix 0.35; numpy
float64 — the w5e IEEE law) → specular fake (threshold 235 + blur σ6 +
screen; exact identity on empty mask) → linear-contrast S-curve LUT
(pivot 0.45 / contrast 1.12, the ink-manga convention) + sat ×1.25 →
tilt-blur diorama cue (fixed band 0.30–0.62, 0.25 ramps, σ6) → vignette
0.35 + noir-law grain σ6.

## 1. Environment anchors (BEFORE the edit — the sanity gate)

| control render (pristine tree 3c31b7c) | sha256 | verdict |
|---|---|---|
| cartoon-cel b8 | `a9e8cd5612f1486f…` | == w4b anchor BYTE-MATCH |
| noir-retro noir b8 | `3eedb4238f56900f…` | == w4b anchor BYTE-MATCH |
| subject-toon v0.2.0 b8 | `aaac76b75a24f43e…` | == w5a anchor BYTE-MATCH |
| b8-first300 gateref | `9efa9b99aa74c0e3…` | == w4b pin BYTE-MATCH |
| b12-first300-from-old gateref | `d19079ca133cbfe0…` | == w3b pin BYTE-MATCH |

Toolchain identical to the frozen engine record (py 3.12.14 / cv2 4.13.0 /
np 2.1.3 / ffmpeg 7.1.5-0+deb13u1). Substrate shas byte-verified
(969af7c6 / b3cc5f0e / e65ae487). Engine cut-detect on b8 == the recorded
w5g behavior (`[188, 474, 549, 861, 881–942 goal-segment class, 977]`).

## 2. Additive-diff gate

`git diff 3c31b7c --numstat -- scripts/source-preserving/` → additions
only on `spe/renderers.py`; every frozen file (render.py, stages.py,
encode.py, provenance.py, qa_check.py, cuts_deep.py, vlm_scorecard.py,
spe/trials/) byte-identical. `registry-listing.txt` records the CLI
`--reality` set including `clay-toy`.

## 3. Fast loop (7 variants, b8 first-300 vs the 9efa9b99 gateref)

All 7 variants ALL GATES GREEN (T2b cov 1.0, 0 invented everywhere;
T3 0.9625–0.9687; T4 0.4615–0.5405). Full table: `variant-table.json`.

| variant | overrides | T3 | T4 % | notes |
|---|---|---|---|---|
| v1-recipe | (none — the dispatched recipe) | 0.9647 | 0.4813 | **WINNER (frozen)** |
| v2-relief-off | reliefMix 0.0 | 0.9687 | 0.4928 | VLM duel WORST — "flat, unrecognizable blobs" |
| v3-relief-55 | reliefMix 0.55 | 0.9625 | 0.4784 | |
| v4-relief-20 | reliefMix 0.20 | 0.9664 | 0.4862 | |
| v5-tilt-off | tiltBlur False | 0.9636 | 0.5405 | tilt-blur REDUCES static-region flicker |
| v6-spec-075 | specStrength 0.75 | 0.9647 | 0.4813 | **sha IDENTICAL to v1** — specular INERT on b8 (honest no-op) |
| v7-vign-50 | vignette 0.50 | 0.9654 | 0.4615 | |

VLM duel (full-res strip, original + 6 variants at t=2/t=8 —
`fastloop-visual/duel-strip.png` + `vlm-duel.json`):
**BEST=A (v1-recipe), WORST=B (v2-relief-off)** — "Variant A perfectly
balances the tilt-shift miniature effect with relief shading to maintain
3D player structure, whereas Variant B lacks relief shading entirely,
causing players to appear as flat, unrecognizable blobs." The
relief-structure-by-light thesis is independently confirmed (the same
verdict class as the lost original's recorded duel).

Pre-freeze correction (honestly recorded): one broadcasting bug caught by
the 3-frame smoke (specular mask `(h,w)` vs `(h,w,3)`) — fixed BEFORE the
fast loop. Smoke determinism: 3-frame double render byte-identical.

## 4. Full renders + gates (frozen config = v1; double render per cell)

| cell | frames | sha256 (×2, byte-identical) | T1 | T2 raw | T2b | T3 | T4 |
|---|---|---|---|---|---|---|---|
| b8 (raw substrate) | 1190 | `69d9ae777cb89477…` | PASS | 0.833 cov / 0.63 extra — stylization-softened 5/6 class, honestly recorded | **cov 1.0, 0 invented PASS** | 0.9766 | 0.4424 % (input floor 0.458) |
| b12 (pre-adjudicated gateref) | 300 | `465da5a1462b8023…` | PASS | extra@72 sustained-motion amplification (the recorded w5f class) | **cov 1.0, 0 invented PASS** | 0.9691 | 0.4490 % |
| b2 (raw substrate) | 225 | `a34c7edfacb42031…` | PASS | **cov 1.0 / extra 0.0 RAW PASS** | cov 1.0 PASS | 0.9929 | 0.7843 % (b2 close-up class; baseline 0.945) |

ALL HARD GATES GREEN 3/3 cells (G-T1..G-T5; the raw-T2 misses are the
pre-adjudicated classes resolved by the frozen deep-correspondence rule —
the w5e/w5g precedent, never a bar-lowering). Gate JSONs: `qa/`.

## 5. Regression (modified tree, AFTER the full registration edit)

| anchor | sha256 | verdict |
|---|---|---|
| cartoon-cel b8 | `a9e8cd56…` | == pristine/frozen BYTE-MATCH |
| noir-retro noir b8 | `3eedb423…` | == pristine/frozen BYTE-MATCH |
| subject-toon v0.2.0 b8 | `aaac76b7…` | == pristine/frozen BYTE-MATCH |

3/3 byte-exact — the clay-toy edit is proven output-neutral for every
other reality.

## 6. Frozen-protocol VLM scorecard (15/15 calls, glm-5v)

| axis | mean |
|---|---|
| sourceFidelity | 2.80 |
| temporalConsistency | 3.00 |
| identityConsistency | 1.80 |
| motionFidelity | 2.20 |
| sceneFidelity | 2.27 |
| stylizationStrength | 5.00 |

**minAxis 1.80, critical 48 → honest Tier 0** (bar: every axis ≥ 4.0 +
0 critical + TL approval). The rebuild sits in the same classical-family
range as the lost original's recorded result (ic 2.07 / critical 62) —
clay 1.80/48 vs lowpoly 1.93/67, cartoon-cel 1.53/99. The
relief-structure-by-light thesis measurably moves identity vs no-relief
(the duel) but classical relief alone cannot cross the Tier bars — the
wave-2 neural keyframe accelerator remains the identity frontier (the w5b
ranked next step for this family).

Raw calls: `scorecards/raw/clay-toy-*.json` (15); aggregate:
`scorecards/vlm-scorecard.json`; per-family: `scorecards/scorecard-clay-toy.json`.

## 7. Honest verdict

**DELIVERED — honest Tier 0.** Deterministic (3/3 double-render
byte-identical), preservation-gated (all hard gates green, 0 invented cuts),
output-neutral (3/3 regression anchors), honestly tiered (Tier 0 — never
laundered). The rebuild faithfully reproduces the recorded recipe's
behavior classes: same T2 miss classes (incl. extra@72 on b12), same inert
specular no-op (v6 ≡ v1), same VLM duel verdict (recipe best / no-relief
worst), same Tier-0 family range on the scorecard.

Evidence shape mirrors the w5c/w5e/w5g packs. Commands: `commands.md`.
Full machine record: `record.json`.
