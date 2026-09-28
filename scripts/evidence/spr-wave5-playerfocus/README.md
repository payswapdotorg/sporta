# SPR-W5-H — SPR205 Player Focus deterministic trial (TL REBUILD of the reset-lost w5h)

**Provenance (read this first):** the original spr/w5h/playerfocus-trial was
lost to the 2026-09-27 sandbox reset **before its PAT-blocked push reached
origin** (local main c1ebaac era; the lost shas 9e0aa306/fda349d3/f048a10d
resolve nowhere on origin). This is the faithful re-implementation of the
recorded phase-2 winner design with **every measurement re-run fresh**.
Honest differences from the recorded original are called out inline —
nothing from the lost tree is claimed.

Renderer: `spr-player-focus-dc1` v0.1.0 (`player-focus`,
deterministic-classical, additive +352/−0 to `spe/renderers.py`).

Design (the recorded phase-2 winner, verbatim):
**static punch-in zoom z=1.35** (frame-center FIXED warp — static regions
map to fixed output pixels = T4 clean by construction; uniform motion
scaling = T3 preserved; cuts pass through the fixed warp) +
**4D critically-damped spring (k=0.02)** on the camshift-tracked
soft-focus dim mask (motion gate = the subject-toon MOG2+residual-flow
convention; 12-frame flood-immune opening armed ONCE per clip;
pos=target=neutral at init — no init jump; all four dimensions sprung —
no unsprung mask-size hops; cut-reset glides the target home — never a
single-frame discontinuity). The **phase-1 crop-following-zoom** design
lives on as the `cropFollow` config mode, re-measured as the v0
anti-precedent.

## 1. Fast loop (8 variants, b8 first-300 vs the 9efa9b99 gateref)

| variant | overrides | T3 | T4 % | verdict |
|---|---|---|---|---|
| **v0-crop-follow** | cropFollow=True | **0.7989 FAIL** | **1.6391 FAIL** | **ANTI-PRECEDENT — REJECTED** (the recorded phase-1 root cause reproduced: crop translation decorrelates motion and drifts static regions) |
| v1-recipe | (phase-2 verbatim) | 0.9751 | 0.7407 | **WINNER (frozen)** |
| v2-zoom-only | dim 0.0 | 0.9756 | 0.7510 | all green |
| v3-dim-only | zoom 1.0 | 0.9964 | 0.6104 | all green |
| v4-zoom-120 | zoom 1.20 | 0.9875 | 0.6613 | all green |
| v5-zoom-150 | zoom 1.50 | 0.9645 | 0.8235 | all green |
| v6-dim-030 | dim 0.30 | 0.9754 | 0.7446 | all green |
| v7-dim-060 | dim 0.60 | 0.9742 | 0.7388 | all green |

Honest difference (recorded): the original's phase-1 also manufactured
invented cuts @11/@200; this rebuild's crop-follow inherits the phase-2
spring fixes (all-4D sprung, glide-from-neutral init) so **no invented
cuts** — the rejection verdict stands on the T3/T4 hard-gate axes.

VLM duel (`fastloop-visual/duel-strip.png` + `vlm-duel.json`):
**BEST=A (v1-recipe)** — "combines a moderate 1.35x zoom with soft dimming
to effectively highlight the player while maintaining full context and
readability"; WORST=E (zoom 1.5 — "crops out too much of the surrounding
action"). Matches the recorded original's v1-winner verdict.

Pre-freeze correction (honestly recorded): `cv2.CamShift` returns a
RotatedRect 3-tuple, not (x,y,w,h) — unpacked via `cv2.boxPoints` (caught
by the 3-frame smoke, fixed BEFORE the fast loop).

## 2. Full renders + gates (frozen config = v1; double render per cell)

| cell | frames | sha256 (×2 byte-identical) | T1 | T2 raw | T2b | T3 | T4 |
|---|---|---|---|---|---|---|---|
| b8 (raw substrate) | 1190 | `3f0be6d2050cf317…` | PASS | 0.833 cov / 0.0 extra — the stylization-softened 5/6 class (honest difference: the original passed b8 raw; recorded) | **cov 1.0, 0 invented PASS** | 0.9386 | 0.6309 |
| b12 (pre-adjudicated gateref) | 300 | `48059e48c4874b43…` | PASS | **RAW PASS (cov 1.0, extra 0.0)** | cov 1.0 PASS | 0.9285 | 0.7020 |
| b2 (raw substrate) | 225 | `fabb4141932d0380…` | PASS | **RAW PASS** | cov 1.0 PASS | 0.9528 | 1.3626 (b2 close-up class — the original's 1.358) |

ALL HARD GATES GREEN 3/3 cells. Gate JSONs: `qa/`.

## 3. Regression (modified tree, AFTER the full registration edit)

| anchor | sha256 | verdict |
|---|---|---|
| cartoon-cel b8 | `a9e8cd56…` | BYTE-MATCH |
| noir-retro noir b8 | `3eedb423…` | BYTE-MATCH |
| subject-toon v0.2.0 b8 | `aaac76b7…` | BYTE-MATCH |
| clay-toy b8 (w5f sibling) | `69d9ae77…` | BYTE-MATCH |

4/4 byte-exact — the player-focus edit is proven output-neutral.

## 4. Frozen-protocol VLM scorecard (15/15 calls)

| axis | mean |
|---|---|
| sourceFidelity | 4.73 |
| temporalConsistency | 3.80 |
| identityConsistency | 4.67 |
| motionFidelity | 4.33 |
| sceneFidelity | 4.07 |
| stylizationStrength | 3.93 |

**minAxis 3.80, critical 1 → honest Tier 0, NEAR-MISS Tier 1** (Tier-1
bar: every axis ≥ 3.5 AND critical = 0 — blocked by ONE critical count).
Same verdict class as the recorded original (3.67/2) — the program's best
VLM family: **player-focus 3.80/1** > subject-toon 3.40/3 > noir 3.59/1.

## 5. Honest verdict

**DELIVERED — honest Tier 0 (near-miss Tier 1).** The design-pivot
doctrine re-proven: the frozen gates arbitrated — phase-1 crop-following
REJECTED on hard-gate axes (measured anti-precedent), phase-2 static-zoom
ALL GREEN. Deterministic 3/3, gates green 3/3, regression 4/4, honestly
tiered. Raw calls: `scorecards/raw/` (15); full machine record:
`record.json` (with the `rebuildProvenance` block). Commands: `commands.md`.
