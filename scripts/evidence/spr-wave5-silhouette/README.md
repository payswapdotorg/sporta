# SPR-W5-G — SPR202 Silhouette/X-Ray: Deterministic Renderer Trial (Lane I)

Task: implement the SPR202 deterministic baseline
`spr202.det.mog2-silhouette` — the frozen dispatch recipe (global-motion
compensation: Farneback frame-pair flow → warp-align → MOG2 background
subtraction, deterministic config, fixed history → motion-mask threshold +
morphology, fixed kernels → TWO output profiles: ink-fill default
(solid ink silhouette on paper-white) and xray `--profile xray`
(mask-distance → thermal-LUT false-color + rim glow) → encode-bitexact) —
as a registered reality `spr-silhouette-xray-dc1`, fast-loop the
parameters (incl. the mandated pan A/B and the framediff fallback leg
measured ONCE), full-render the coverage cells with double-render
determinism, gate everything, and run the frozen 7-axis VLM scorecard on
b8 with an honest tier verdict. Branch `spr/w5g/silhouette-trial`, base
`b612adf` (origin/main, post w5f ink-manga merge). Engine contract
FROZEN; the registration is additive (+559/−0 in renderers.py).

## 1. Substrate verification (run first)

`sha256sum scripts/evidence/spr-corpus-bytes/*` — the three clips used by
this lane match the corpus README table exactly:

- `b8p3.mp4` `969af7c6fdb172091ff00705b25fa37b7073f4332d722416b9754a4a7579917a`
- `b8-b12.mp4` `b3cc5f0e2fae840f2aef93d859ce814babca226ee0b5d27e6da4e969b4312462`
- `clip-b2-closeup.mp4` `e65ae48740472f57ada031fdfb076cbb40a845239693acad83e8142c0caec062`

Derived gate references byte-reproduced: b8-first300 `9efa9b99…`
(== w4b), b12-first300-gateref-from-old `d19079ca…` (== w3b pin; old
substrate `7cb3d728…` via `git show 805a5fc:…`).

Tools: python 3.12.14, opencv 4.13.0, numpy 2.1.3, ffmpeg
7.1.5-0+deb13u1 — identical to the frozen engine toolset record. No new
runtime deps (stdlib/numpy/cv2/ffmpeg only; NO neural matting — SAM2/RVM
are future upgrades, out of scope per the packet).

## 2. The renderer (frozen declaration, candidates.yaml SPR202 record)

`_SilhouetteXrayState` in `spe/renderers.py` (+559/−0 vs base):

- **Stage 0 — global-motion compensation (the anti-pan leg)**: Farneback
  frame-pair flow at 320×180 (the in-engine convention) → global
  translation+zoom least-squares fit (stride-4 subsample, the
  `stages.flow_magnitude` model class) → cumulative per-shot float64
  affine (zoom clipped ±0.10, translation clipped ±24 px/frame) → each
  frame warp-affine-aligned into the shot-reference coordinates before
  MOG2; the mask warps back with the forward affine. Determinism: a
  closed-form float64 chain — no RNG, no wall-clock — covered by every
  per-cell double-render byte-equality. A per-shot coverage age-map
  (union of warped viewports) linear-fades the MOG2 mask in over
  mogWarmup=10 frames so never-modeled pan regions do not flash; the
  camera-compensated residual-flow mask (> 2.2 px/frame) fills those
  blind spots ONLY (gated to `1 − valid`, ramped over the warmup window)
  — a global OR flooded at 55% frame coverage on pan ramps (measured).
- **Stage 1 — MOG2** (deterministic config: fixed history=200,
  varThreshold=34, learningRate=0.04 with a post-flood boost 0.12 for 12
  frames, detectShadows=False, applied to the WARP-ALIGNED stream; model
  created once per clip, never re-initialized). The cut-handling design
  was re-derived in the fast loop after the first full-render b8 pass
  FAILED T2b with 10 invented cuts: re-initializing at the engine's
  cut-detect hits (which include the recorded 882–943 goal-segment
  false-positive class) manufactured all-ink fresh-model flashes →
  invented output cuts. Final design: the natural model-mismatch flood
  at REAL cuts is the cut-preservation spike; the GLOBAL-JUMP rule (mean
  mask jump > 0.25 → instant entry + learning-rate boost) detects it;
  cross-cut global-fit garbage is noise-averaged (measured increments
  ≤ 8 px) so the cumulative affine needs no reset.
- **Stage 2 — threshold + morphology + stabilization**: open3/close5
  fixed RECT kernels; max-decay EMA (0.65 — the T3-hardened decay;
  0.90 ghost-lag decorrelated the output motion series, measured
  0.6986 → 0.8473) with a PER-PIXEL rise cap (+0.40/frame — binds on
  LOCAL high-contrast growth with small mean impact, i.e. fast limbs
  popping; spreading such pops under the 16-absdiff spike threshold).
- **Stage 3 — ink-fill (default)**: stabilized soft mask → solid ink
  (26,26,26) composited on paper-white (244,244,244); the clip's first
  frame initializes with a zero mask (clean paper start).
- **Stage 3′ — xray (`--profile xray`)**: mask distance transform
  (DIST_L2, scale 10 px) → baked 256-entry FIXED thermal ironbow LUT
  false-color + Sobel-rim additive glow (numpy float64 magnitude — the
  w5e cv2.magnitude IPP lesson).

## 3. Fast loop (`variant-table.json` — three phases, honest)

**Phase 1 (the mandated axes, b8 first-300):** v1 compensation-OFF (the
pan A/B leg), v2 baseline (compensation ON), v3 varThreshold 40, v4
morphology open5/close7/dilate3, v5 the framediff fallback leg
(maskSource=framediff, measured ONCE). Machine gates on each + a 7-column
VLM duel strip. Findings: v1 passes T3 (0.8565) via pan-correlated mask
jitter — the classic pan corruption, flagged by the VLM as "significant
background noise and ghosting of the stadium structure"; the compensated
variants fail T3 0.65–0.70 (the STRUCTURE-SELECTING tension: the output
honestly tracks subject motion only, the input series is
camera-dominated); v5 framediff FAILS G-T2b with 4 invented cuts
[33,121,126,173] and T3 0.7885 — worse than MOG2 on the gates → not
shipped (the packet's own rule). VLM duel 1 winner v3 (cleanest
background) — but v3 fails T3, so the verdict drove the phase-2
synthesis rather than the direct pick.

**Phase 2 (the T3 root-cause grid):** maskDecay is the T3 knob — 0.90 →
0.75 lifts T3 0.6986 → 0.8573 (the max-decay ghost-lag decorrelates the
output motion series); threshold+decay synthesis passes all first-300
gates; VLM duel 2 among the gate-passing candidates (s1/s5/s6) →
WINNER s6-thr34-decay75, frozen into the shipped config.

**Phase 3 (the full-render honest re-opens — two of them):**
1. The first full b8 pass (with cut-re-init + all-ink flash) FAILED
   G-T2b with 11 invented cuts — root cause: the engine's cut list
   contains the recorded 882–943 goal-segment false positives and every
   re-init flash became an invented cut. The cut-handling was redesigned
   (see §2 stage 1): natural floods + the global-jump rule + the
   post-flood learning-rate boost + the per-pixel rise cap. Intermediate
   designs measured honestly (EMA-reset-at-cut re-entry spikes at
   919/937; ramped floods costing T3 0.6556; a partial-entry experiment;
   a residual-flow cut detector measured NOT separable — cuts 3.0–10.5
   vs goal segment up to 5.4 — and abandoned).
2. The micro-shot second-boundary class (b8 982 / b12 120): the
   post-flood wash elevates the output's local median so the boundary
   spike misses the 2.6× bar; decay 0.65 + the boost threads it on b8
   (coverage 1.0). The close-up amplification class (b8-935/b12-73): a
   sustained 51.4-absdiff close-up input event floods MOG2 legitimately
   and the binary ink amplifies it ~2.4× vs the 2× invented-cut
   tolerance — one knife-edge invented cut that survives on b12 (the b8
   twin is suppressed by a different model state). Recorded, not gamed.

**Final-code re-verify:** b8 first-300 through the frozen CLI:
sha `0ee35c7b…`, T2b PASS cov 1.0 inv [], T3 0.7875 (the sub-window
lacks the full cut-alignment contribution; the full-clip value 0.8488
is the shipped evidence), T4 0.9743%.

## 4. Full renders + gates (`record.json` is the canonical table)

Every cell double-rendered into independent out-dirs (G-T5 discipline);
b12 gated against the pre-adjudicated first-300 gateref rebuilt from the
pre-w3a-fix b12 bytes (byte-reproduced `7cb3d728…` → `d19079ca…`).

| cell | frames | sha256 (BOTH passes) | det | G-T1 | G-T2 raw | G-T2b deep | G-T3 | G-T4 |
|---|---|---|---|---|---|---|---|---|
| b8 | 1190 | `81f5a8ee1ad26cbe739c347438a241bd8ac68b9b604010100fef160b0da0ba1d` ×2 | **yes** | PASS 1190==1190, Δ20 ms, audio ✓ | cov 0.667 (micro-shot merged-fire) — **T2b-resolved** | **PASS cov 1.0, 0 invented** (ratios 1.18–4.82) | **PASS r=0.8488** | **PASS 0.7121 %** (base 0.458 %) |
| b12 | 300 | `b7164f475b051639…` (full sha in record.json) ×2 | **yes** | PASS | cov 0.0 | **FAIL cov 0.5 + inv [73]** | PASS r=0.8213 | PASS 1.1169 % |
| b2 | 225 | `d7c791ca2fa9702a…` ×2 | **yes** | PASS | cov 0.0 | **FAIL cov 0.0** (cut 97 ratio 0.99, bar never cleared) | PASS r=0.8447 | **FAIL 1.9583 %** (closeup zoom/parallax churn) |
| b8-xray | 1190 | `3a5c467f683d80aa…` ×2 | **yes** | PASS | cov 0.833 | **FAIL cov 1.0 + inv [936]** | 0.7989 (just under) | **FAIL 2.279 %** |

The honest classes, precisely: (a) the micro-shot merged-fire class
(raw T2 coverage residual, resolved by T2b — the frozen harness's own
rule, the w5e b12/b2 precedent); (b) the micro-shot second-boundary
local-median class (b12 120); (c) the close-up amplification class
(b12 73 / xray 936 — a legitimate flood response amplified 2.4× vs the
2× tolerance); (d) the closeup zoom/parallax class (b2: the
translation+zoom compensation cannot hold a 1–2-player closeup — mask
churn T4 1.96% and the cut never clears the high-median bar).

## 5. Regression (engine untouched, proven byte-level)

cartoon-cel / noir-retro (noir) / subject-toon b8 re-rendered via the
frozen `render.py` AFTER the full registration edit — all three
**byte-identical to the w4b 54-cell ledger anchors** (`a9e8cd56…` /
`3eedb423…` / `503ea271…`). The frozen engine file set is byte-identical
to the base commit (`git diff b612adf` over render.py / stages.py /
encode.py / provenance.py / registry.py / __init__.py / qa_check.py /
cuts_deep.py / vlm_scorecard.py / spe/trials/ = EMPTY).

## 6. Frozen-protocol VLM scorecard (b8, 15/15 calls landed)

`vlm_scorecard.py` (frozen, unmodified) on the machine-local evidence
root populated per its expected paths (symlinked from /tmp — the
commands.md records the exact layout). glm-5v-turbo.

| axis | mean |
|---|---|
| sourceFidelity | 2.53 |
| temporalConsistency | 2.40 |
| identityConsistency | **1.47** |
| motionFidelity | 1.93 |
| sceneFidelity | 1.87 |
| stylizationStrength | 4.93 |

min axis **1.47**, overall 2.52, critical artifacts **111** (limbs 64 +
players 47; 221 total), hard gates ALL GREEN on b8 (G-T1..T5) —
**tierClaim 0**.

**Honest verdict — Tier 0.** The packet's thesis is measured precisely:
this family IS structure-selecting — the machine-gate behavior differed
from the flatteners exactly as predicted (the T3 subject-vs-camera
tension needed the decay hardening; the invented-cut amplification
classes are motion-response phenomena, not stylization damage) — but the
VLM outcome lands in the same identity-collapse region as the flattening
family (identityConsistency 1.47 ≈ ink-manga 1.47; criticals 111 between
cartoon-cel 99 and anime 136). The frozen bar (every axis ≥ 4.0 + 0
critical + TL approval) is NOT met. No tier is claimed beyond 0.

**Measured next increment:** identityConsistency 1.47 / motionFidelity
1.93 are the blockers. Ranked attack paths: (a) NEURAL MATTING —
SAM2/RVM replace the MOG2 mask with semantic player masks (the
candidates.yaml neural_candidates; the deterministic engine architecture
stays, the mask source swaps — the coverage-age/warp machinery rides
through unchanged); (b) dual-path compositing — subject-toon's
mask-gentle architecture applied to the ink profile (silhouette ink on
subjects, soft desaturated source on background — attacks sceneFidelity
1.87 and sourceFidelity 2.53 directly); (c) a hysteresis cut-tagger for
the knife-edge micro-shot/invented-cut classes (±15% margins measured).
All three ride the same mask-stabilization skeleton this trial shipped.

## 7. Files

- `record.json` — canonical machine record (declaration, shas, gates,
  determinism, regression, scorecard, verdict, next increment).
- `variant-table.json` — the full fast-loop record (phases 1/2, the
  pan A/B numbers, the framediff fallback leg, VLM duel verdicts).
- `fastloop-base-config-phase1.json` — the phase-1 config snapshot the
  loop's variant patches applied against.
- `qa/` — 8 raw gate JSONs (4 cells × qa_check + cuts_deep) + 22
  fast-loop variant gate JSONs.
- `scorecards/` — `scorecard-silhouette-xray.json` + `vlm-scorecard.json`
  (aggregate) + `raw/` 15 per-call VLM JSONs (the frozen harness's own
  outputs, byte-identical copies).
- `frames/` — extracted t=2/8/15/30/45 (b8) + t=2/8 (b12/b2) + the xray
  profile's t-grid PNGs from the pass-1 artifacts.
- `fastloop-visual/` — the two duel strips + raw VLM comparison JSONs.
- `registry-listing.txt` — frozen `render.py --help` proving
  `silhouette-xray` in `--reality` choices.
- `commands.md` — every command, in order, with exact paths.

Not committed (re-derivable, commands recorded): the render
mp4/provenance outputs (the shas above are the verification anchors,
the W2-B/W3-B/W4-C/W5-C/W5-E convention), the machine-local evidence
root (symlinked /tmp layout, the frozen harness's expected paths), the
derived gate references and the scratch iteration harnesses
(`/tmp/w5g/…`, `/home/z/my-project/scripts/w5g_*.py`).

## 8. Deviations

1. **Two honest re-opens during the full-render phase** (the ink-manga /
   w5e precedent followed): the cut-handling redesign (the engine's
   goal-segment false-positive cuts manufactured 10 invented cuts via
   the all-ink re-init flash — root-caused, redesigned, re-measured) and
   the micro-shot/close-up knife-edge classes (measured to ±15%
   tolerance margins; NOT gamed — one invented cut survives on b12 and
   is recorded as the honest T2b fail).
2. **The framediff fallback leg** was measured ONCE in the fast loop as
   mandated (4 invented cuts, T3 0.7885 — worse than MOG2) and NOT
   shipped; the fallback is config-only (`maskSource: "framediff"`,
   registered in the shipped row, unused by both profiles).
3. **The xray profile shipped with full double-render + gates** (not the
   w5e game-cel smoke-only precedent) — its honest weaker gates are in
   the table above.
4. **MOG2 is never re-initialized at cuts** (a deliberate deviation from
   the subject-toon precedent, root-caused in §3 phase 3): the natural
   model-mismatch flood at real cuts + the global-jump rule + the
   post-flood learning-rate boost provide the contract's cut-preservation
   semantics; the EMA carry resets via the flood overwrite (contract
   invariant 4's intent — measured coverage 1.0, 0 invented on b8).
5. **The evidence root lives under /tmp, symlinked to
   /home/z/spr-evidence** (the task packet's "local evidence-root layout
   under /tmp" + the frozen harness's hardcoded expected path — both
   satisfied; recorded in commands.md).
6. Task-packet wording "version dc1" interpreted per the W3-B/W4-C/W5-C/
   W5-E precedent: rendererId carries the `-dc1` suffix; rendererVersion
   `0.1.0` mirrors contract §4.
