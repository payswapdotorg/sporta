# SPR-W5-J — SPR103 Watercolor/Painterly promotion from the w2c kuwahara-paint trial

**Provenance:** promoted from the wave-2 lane-C trial
`sprtrial-kuwahara-paint-t1` (the subject-toon w3b promotion pattern) —
the trial's frozen processor ported **verbatim** into `renderers.py` as
`_WatercolorState` (helpers restated; no `spe.trials` import). The trial's
honest anti-stages stay OUT: palette re-quantization + XDoG overlay were
measured in the trial's stage-isolation diagnostics to re-amplify the
8-orientation blend residue into net/grass blotching and dark speckle
ghosting — dropped, recorded. The w2c CONDITIONAL verdict (painterly
family only) becomes the family declaration.

Renderer: `spr-watercolor-dc1` v0.1.0 (`watercolor`, deterministic-classical,
additive +294/−0). Pipeline (the trial verbatim): half-res abstraction core
(median k3 + bilateral d7 σ50) → structure tensor (Sobel + Gaussian σ2.5,
**temporal EMA α 0.45 + cut-reset**) → coherence-gated N=8 soft orientation
field (weight-map σ2) → per-orientation 4-quadrant anisotropic Kuwahara
(soft inverse-variance quadrant blend p=3, variance σ2 smoothing,
qLong 3 × qShort 2) → bilinear upsample (brush-stroke transitions) →
bilateral ×2 field consolidation → saturation ×1.14 → paper grain 1.5.

## 1. Fast loop (8 variants, b8 first-300 vs the 9efa9b99 gateref)

All 8 variants ALL GATES GREEN. Full table: `variant-table.json`.

| variant | overrides | T3 | T4 % | note |
|---|---|---|---|---|
| v0-noema | tensorAlpha=1.0 | 0.9871 | **0.9023** | VLM WORST — "significant edge noise and temporal instability" |
| **v1-recipe** | (trial verbatim) | 0.9826 | **0.6653** | **WINNER (frozen)** — EMA cuts static-region flicker ~26% |
| v2-orient-4 | N=4 | 0.9781 | 0.6974 | |
| v3-orient-12 | N=12 | 0.9818 | 0.6149 | |
| v4-qshort-3 | qShort 3 | 0.9805 | 0.6541 | |
| v5-varsoft-1 | varSoftness 1.0 | 0.9838 | 0.6659 | |
| v6-nograin | grain 0 | 0.9825 | 0.6522 | |
| v7-sat-125 | sat 1.25 | 0.9803 | 0.6634 | |

VLM duel: **BEST=B (v1-recipe)** — "best balance of smooth, stable
brushstrokes and painterly texture"; **WORST=A (v0-noema)**. The temporal
tensor-EMA thesis (the trial's yaml mitigation) is doubly confirmed —
gates + VLM.

## 2. Full renders + gates (frozen config = v1; double render per cell)

| cell | frames | sha256 (×2 byte-identical) | T1 | T2 raw | T2b | T3 | T4 |
|---|---|---|---|---|---|---|---|
| b8 (raw) | 1190 | `2b0b740441d2ce6a…` | PASS | **RAW PASS (1.0/0.63)** | 1.0/0 | 0.9557 | 0.4474 |
| b12 (gateref) | 300 | `1fc49b53fc73bffd…` | PASS | extra 2.5 — the known extra@72 class | **1.0/0 PASS** | 0.9343 | 0.4602 |
| b2 (raw) | 225 | `378b87e73069f584…` | PASS | extra 3.326 — the close-up class | **1.0/0 PASS** | 0.9765 | 0.9069 |

ALL HARD GATES GREEN 3/3 cells.

## 3. Regression (modified tree, AFTER the registration edit)

6/6 anchors BYTE-MATCH: cartoon-cel `a9e8cd56`, noir `3eedb423`,
subject-toon `aaac76b7`, clay-toy `69d9ae77`, player-focus `3f0be6d2`,
rotoscope `32c8666c` (all wave-5 siblings) — the promotion is proven
output-neutral.

## 4. Frozen-protocol VLM scorecard (15/15 calls)

sf 2.60 / tc 2.87 / ic 1.80 / mf 2.00 / scf 2.20 / ss 4.93 —
**minAxis 1.80, critical 53 → honest Tier 0** (the classical painterly
family range; ss 4.93 near the family max). The painterly abstraction
softens identity — the wave-2 neural target remains the identity frontier.

## 5. Honest verdict

**DELIVERED — honest Tier 0.** The last WAVE-2 visual family promoted:
every visual-reality row in the work-items doc is now delivered or
tiered. Deterministic 3/3, gates green 3/3, regression 6/6, honestly
tiered. Evidence: `record.json` (with the `promotionProvenance` block),
`variant-table.json`, `qa/`, `scorecards/`, `frames/`,
`fastloop-visual/`. Commands: `commands.md`.
