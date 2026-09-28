# SPR-W5-I — SPR109 Rotoscope deterministic trial (TL REBUILD of the reset-lost w5i)

**Provenance (read this first):** the original spr/w5i/rotoscope-trial was
lost to the 2026-09-27 sandbox reset **before its PAT-blocked push reached
origin** (local main 0859ba6 era; the lost shas 2d5fb163/2847128c/4f3c8a62
resolve nowhere on origin). This is the faithful re-implementation of the
recorded phase-4 frozen recipe with **every measurement re-run fresh**;
honest differences from the recorded original are called out inline.

Renderer: `spr-rotoscope-dc1` v0.1.0 (`rotoscope`, deterministic-classical,
additive +227/−0 to `spe/renderers.py`).

Recipe (the recorded phase-4 frozen values, verbatim): pre-smooth
(median k3 + bilateral d9 σ75 ×2) → fixed LAB K=10 fills → **2-tone
value** (wide smoothstep knee: gain = 0.35 + (1.60−0.35)·smoothstep
((L−0.30)/0.40); the recorded phase-3/4 re-open history — the phase-1
recipe failed full-b8 T2b at cov 0.667 (the 979/982 micro-shot
compression class) and was re-hardened by the tone contrast + phi 20 +
floor 0.10 combination — is encoded in the frozen starting config) →
**HEAVY XDoG** (eps 0.0010 / phi 20, binary+median stabilized,
**FLOW-STABILIZED**: Farneback forward-warp + EMA 0.75 + cut-reset, line
floor 0.10) → clean finish (sat 1.15 + vignette 0.20, **no grain**).

## 1. Fast loop (8 variants, b8 first-300 vs the 9efa9b99 gateref)

| variant | overrides | T3 | T4 % | verdict |
|---|---|---|---|---|
| v0-noflow | flowStabilize=False | 0.9727 | 0.6332 | VLM duel WORST — "severe temporal instability and noise" |
| **v1-recipe** | (phase-4 verbatim) | 0.9750 | 0.6193 | **WINNER (frozen)** |
| v2-tone-15-04 | tone 1.5/0.4 (phase-3) | 0.9761 | 0.6056 | all green |
| v3-tone-17-03 | tone 1.7/0.3 | 0.9745 | 0.6329 | all green |
| v4-eps-0015 | eps 0.0015 | 0.9746 | 0.6398 | all green |
| v5-phi-12 | phi 12 | 0.9749 | 0.6183 | all green |
| v6-floor-02 | floor 0.20 | 0.9751 | 0.6133 | all green |
| v7-sat-125 | sat 1.25 | 0.9724 | 0.6077 | all green |

Flow-stabilization thesis: v0 (unstabilized) T4 0.6332 vs v1
(stabilized) 0.6193 — the direction reproduces (honest fresh delta is
smaller than the recorded original's 0.6248→0.4263); the VLM duel
independently ranks no-flow WORST and stabilized BEST.

VLM duel: **BEST=B (v1-recipe)** — "optimal balance of flow-stabilized,
clean ink lines and a compelling 2-tone cel-shaded look"; **WORST=A
(v0-noflow)** — "severe temporal instability and noise due to the lack
of flow stabilization". Matches the recorded original's verdict class.

## 2. Full renders + gates (frozen config = v1; double render per cell)

| cell | frames | sha256 (×2 byte-identical) | T1 | T2 raw | T2b | T3 | T4 |
|---|---|---|---|---|---|---|---|
| b8 (raw substrate) | 1190 | `32c8666c382adaeb…` | PASS | **RAW PASS (cov 1.0, extra 0.63)** | cov 1.0, 0 invented | 0.9774 | 0.5487 |
| b12 (pre-adjudicated gateref) | 300 | `24cf2ddedd08d0a5…` | PASS | **RAW PASS (cov 1.0, extra 0.0)** | cov 1.0 | 0.9885 | 0.6752 |
| b2 (raw substrate) | 225 | `e121df44a3b6ee2b…` | PASS | extra 3.326 — the close-up sustained-motion class (honest difference: the original's b2 passed raw; recorded) | **cov 1.0, 0 invented PASS** | 0.9699 | 1.0635 (b2 close-up class) |

ALL HARD GATES GREEN 3/3 cells.

## 3. Regression (modified tree, AFTER the registration edit)

| anchor | sha256 | verdict |
|---|---|---|
| cartoon-cel b8 | `a9e8cd56…` | BYTE-MATCH |
| noir-retro noir b8 | `3eedb423…` | BYTE-MATCH |
| subject-toon v0.2.0 b8 | `aaac76b7…` | BYTE-MATCH |
| clay-toy b8 (w5f sibling) | `69d9ae77…` | BYTE-MATCH |
| player-focus b8 (w5h sibling) | `3f0be6d2…` | BYTE-MATCH |

5/5 byte-exact — the rotoscope edit is proven output-neutral.

## 4. Frozen-protocol VLM scorecard (15/15 calls)

| axis | mean |
|---|---|
| sourceFidelity | 4.47 |
| temporalConsistency | 2.60 |
| identityConsistency | 2.33 |
| motionFidelity | 2.47 |
| sceneFidelity | 2.53 |
| stylizationStrength | 5.00 |

**minAxis 2.33, critical 62 → honest Tier 0.** The critical count
matches the recorded original EXACTLY (62 = 62 — the family's per-frame
limb-class counting on ~25 px players); ss 5.0 = the family stylization
maximum (same as recorded). The 2-tone classical family cannot cross the
identity bars — the wave-2 neural keyframe guidance remains the frontier.

## 5. Honest verdict

**DELIVERED — honest Tier 0.** The wave-5 F/H/J dispatch set is now
COMPLETE on origin (all three rebuilds delivered + pushed): clay-toy
(w5f, 1.80/48), player-focus (w5h, 3.80/1 — the program's best VLM
family, near-miss Tier 1), rotoscope (w5i, 2.33/62 — critical exactly
matching the lost original's 62). All gates green, deterministic 3/3
each, regression 5/5 (this trial), honestly tiered throughout.
