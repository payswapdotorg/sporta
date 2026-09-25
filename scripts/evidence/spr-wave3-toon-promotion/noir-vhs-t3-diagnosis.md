# noir-retro (vhs) G-T3 Misses — Root-Cause Diagnosis (SPR-W3-B task 4, F4)

Status: DIAGNOSIS ONLY (record, do NOT patch) · Gate `qa_check.py` G-T3 FROZEN ·
Author: SPR-W3-B worker · Input to a lead decision, not a fix.

**The F4 facts under diagnosis** (SPR-W2-B, `scripts/evidence/spr-wave2-renders`,
commit `7d8b277`): b5 `noir-retro` profile `vhs` G-T3 Pearson r = **0.7303**,
b6 = **0.7978**, vs threshold **0.80**. Every other gate (T1/T2/T4 + T2b +
determinism) passed on both clips; the `noir` profile passes G-T3 at
0.9985/0.9988 on the same clips.

## 1. Method and reproduction

The F4 artifacts were re-rendered with the FROZEN `render.py`
(`--reality noir-retro --profile vhs`) on the frozen substrates and are
**byte-identical to the W2B records** (cross-session determinism proof):

| clip | re-render sha256 | W2B record sha256 | G-T3 r (reproduced) | W2B r |
|---|---|---|---|---|
| b5 | `05e4e27768a0683d31e87e12574938953d3bc13342c8625ba3870038ad2516e3` | same | **0.7303** | 0.7303 |
| b6 | `61cff549fcfd500599d2a0dcec2aea0dd310dfceba1e1f409e14927ce84c4c89` | same | **0.7978** | 0.7978 |

All measurements below run on these exact artifacts (or on diagnostic
counterfactual renders — see §3 — produced in a scratch harness that reuses the
frozen `spe.stages` READ-ONLY; no engine/gate/renderer file was modified).

The G-T3 metric (frozen `qa_check.py`): per-frame Farneback magnitude mean at
64×36 on input and output → Pearson r of the two 300-point series.

## 2. Mechanism — why the series decorrelate

The vhs pipeline is `saturation_lift(0.95) → vhs_artifacts(chroma shift (2,1),
scanlines 0.12, per-frame horizontal jitter ±2 px, 6-row noise band every 97
frames) → grain(σ=7.0)`. Two of these are TEMPORALLY VARYING per frame:
the grain (fresh i.i.d. noise each frame, seeded `1000+frame`) and the jitter
(fresh uniform integer `dx ∈ [-2,2]` px each frame, seeded `2000+frame`).

Measured decomposition of the b5/b6 motion-energy series (25-frame trend =
signal, residual = per-frame noise):

| clip | input trend σ (signal) | per-frame noise σ: input → output | noise added | per-frame SNR | Pearson r (observed) |
|---|---|---|---|---|---|
| b5 | 0.1484 | 0.0316 → 0.1190 | **+0.0874** | 1.25 | 0.7303 |
| b6 | 0.1475 | 0.0459 → 0.1003 | **+0.0543** | 1.47 | 0.7978 |

The prediction r ≈ σ_signal/√(σ²_signal+σ²_noise) gives 0.78 (b5) / 0.83 (b6)
— consistent with the observed 0.73/0.80. The vhs stack adds a per-frame
random component to the OUTPUT series only; Pearson r falls as that noise
variance approaches the input signal variance.

**Why b5 and b6 specifically** (and not b2/b3/b7, which pass at 0.99/0.93/0.87):
the noise variance is roughly clip-independent, but the SIGNAL variance is not.
b5 (sustained pan at near-constant speed) and b6 (set-piece: long static setup
plus one kick) have the FLATTEST input motion-energy series of the five wave-2
clips — coefficient of variation 0.76 (b5) and 0.83 (b6) vs 0.97–1.05 for the
passing clips. Across all five clips,
**corr(CV_input, r_vhs) = 0.9715**: the flatter the true motion series, the
more the per-frame jitter noise dominates the covariance. A steady pan is the
worst case for a per-frame motion-correlation gate on an analog-simulation
reality.

## 3. Component isolation — counterfactual renders (b5, decisive pair re-run on b6)

Counterfactual renders apply the frozen stages with one component disabled
(scratch harness; same frozen bit-exact encoder, so measurements are
post-codec like the real gate):

| counterfactual (b5) | G-T3 r | Δ vs full stack |
|---|---|---|
| full vhs stack (grain 7 + jitter 2 + scanlines + chroma) | 0.7303 | — |
| **− jitter** (grain + scanlines + chroma) | **0.9987** | **+0.268** |
| − grain (jitter + scanlines + chroma) | 0.7354 | +0.005 |
| − scanlines (grain + jitter + chroma) | 0.7280 | −0.002 |
| no vhs artifacts (saturation only) | 0.9996 | +0.269 |
| **grain only** (σ7 on the original) | **0.9986** | +0.268 |
| **jitter only** (±2 px on the original) | **0.7304** | −0.000 |

| counterfactual (b6) | G-T3 r |
|---|---|
| full vhs stack | 0.7978 |
| − jitter | **0.9991** |
| jitter only | **0.7914** |

**The decorrelation is entirely the per-frame horizontal jitter.** The task
hypothesis ("isolate the VHS grain/scanline contribution") is REFUTED by
measurement: grain alone costs ~0.001 of r (0.9986 at σ7.0 — note the `noir`
profile passes at 0.998 with the same grain pattern at σ6.0), scanlines are
±0.002, and the jitter ALONE reproduces the full-stack damage (0.7304 vs
0.7303 on b5; 0.7914 vs 0.7978 on b6); removing it recovers r to 0.999.

Why grain is harmless while jitter is not: grain is spatially i.i.d. — after
the 64×36 INTER_AREA downscale (100× area averaging) and Farneback's windowed
least-squares, its flow perturbation is negligible. The jitter is a COHERENT
global translation each frame (E|dx| = 1.17 px at 640×360 → 0.117 px at 64×36,
varying uniformly in ±0.2 px) — a real displacement the flow field measures
exactly, i.e. a per-frame random additive motion term that no spatial
averaging can remove.

## 4. Noise-robust metric test — would a different metric pass the SAME renders?

Hypothesis under test (task packet): "a noise-robust metric (e.g.
rank-correlation or detrended series) would pass the same pair WITHOUT
changing the render". Result: **partially — by temporal smoothing, not by rank
correlation.**

| metric (same b5 / b6 vhs artifacts, unchanged) | b5 | b6 | ≥ 0.80? |
|---|---|---|---|
| Pearson r per frame (the frozen G-T3) | 0.7303 | 0.7978 | **FAIL** |
| Spearman rank correlation | 0.6845 | 0.6427 | **FAIL — worse than Pearson** |
| Pearson r after 5-frame (0.2 s) centered moving average | **0.9661** | **0.9594** | **PASS both** |
| Pearson r after 25-frame (1.0 s) moving average | 0.9922 | 0.9907 | PASS both |
| Pearson r of detrended series (25-frame rolling median removed) | 0.1416 | 0.2273 | FAIL (removes the signal, which IS the trend) |

Interpretation: the jitter noise is i.i.d. per frame, so a 5-frame box average
suppresses it ~√5 while the true motion-energy signal (which changes on
play/cut timescales) survives — r recovers to 0.96+ on both clips. Rank
correlation FAILS because the low-motion region is dense with near-tied values
that the noise reshuffles (the b5/b6 flat-series problem again, amplified).
Detrending fails because there is no spurious trend to remove — the trend is
the signal. The 0.2 s window is a principled choice, not bar-lowering: it is
the SAME temporal granularity the frozen VLM protocol itself uses for its
temporal frame pairs (`TEMPORAL_DELTA_S = 0.2`).

## 5. Verdict — gate-metric design vs real stylizer trade-off

**This is a gate-metric design gap for analog-simulation realities, not a
stylizer defect.** Evidence: with the jitter removed the render's motion
correlation is 0.999 — the underlying broadcast motion passes through the vhs
stack essentially perfectly. The jitter is a deliberate, visible aesthetic
component of the VHS reality (analog tape horizontal instability) and is REAL
motion in the pixel field; a per-frame motion-correlation gate cannot
distinguish "intended analog jitter" from "corrupted motion". The same stylizer
passes the same gate on every clip whose motion series has enough variance to
drown the jitter noise (corr(CV, r) = 0.97), and the `noir` profile — identical
architecture, no jitter — passes everywhere at 0.997+.

Not a real stylizer trade-off: nothing in the render is degraded; the b5/b6
renders preserve cuts, timeline, audio, and (at 0.2 s granularity) motion.

## 6. Recommendation for the lead (NO code changed — the gate is frozen)

1. **Preferred**: keep G-T3 per-frame for digital-style realities; for
   analog-simulation profiles (vhs) gate G-T3 on the **0.2 s moving-averaged
   series** — the protocol's own temporal-pair granularity. Both F4 clips pass
   (0.9661 / 0.9594) with the renders unchanged; the metric change is
   documented, principled, and does not lower any other gate.
2. Alternative (stylizer-side, if the lead insists on the per-frame metric):
   reduce jitter amplitude (±1 px) or quantize it (e.g. hold dx per GOP) —
   estimated to lift b5/b6 r to ~0.9+/~0.95+ respectively — at the cost of
   visible VHS character (contract §5: a profile default change bumps the
   renderer version). This is a real trade-off and the lead's call.
3. Either way, record in the corpus notes that **flat-motion clips (sustained
   pans, b5-class) are the systematic worst case** for per-frame motion gates
   on analog realities (corr(CV_input, r_vhs) = 0.9715 across the five wave-2
   clips); a lead may want one such clip as a standing regression canary.
4. Do NOT adopt Spearman or detrending for this gate — measured worse/failed
   (§4); adopting them would be bar-lowering by metric-shopping in the wrong
   direction.

## 7. Reproduction commands (scratch harness, frozen files untouched)

```
# F4 artifact re-render (byte-identical to W2B):
python3 scripts/source-preserving/render.py --clip scripts/evidence/spr-corpus-bytes/clip-b5-camera-move.mp4 \
  --reality noir-retro --profile vhs --out-dir <dir> --suffix b5
# series + noise-robust metrics: t3_metrics.py (scratch, replicates qa_check G-T3 exactly)
# counterfactuals: vhs_counterfactual.py (scratch; frozen spe.stages reused read-only)
```
