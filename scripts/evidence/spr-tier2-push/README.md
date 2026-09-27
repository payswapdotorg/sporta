# SPR-W5-A — subject-toon Tier-2 quality push (v0.1.0 → v0.2.0), frozen protocol, honest verdict

Task: iterate the `spr-subject-toon-dc1` row's quality to attack the wave-3
scorecard gaps (min-axis 2.73, criticalArtifacts 15 vs the frozen Tier-2 bar
= hard gates green AND every axis ≥ 4.0 AND criticals = 0 AND TL visual
approval). Branch `spr/w5a/tier2-push`, base `5650cfd3…` (origin/main post
w5e merge). The frozen bar is NEVER lowered; this is the Worker-C closure
lane (`docs/status/lane-coordination.md`). Engine contract FROZEN — every
change lives in the subject-toon code path of `spe/renderers.py` (the
renderer's own row + `_SubjectToonState`); `render.py`, `stages.py`,
`encode.py`, `provenance.py`, the harness, and every other lane are
byte-verified untouched (regression shas below).

## 1. Substrate + toolchain verification

```
b8p3.mp4          969af7c6fdb17209…  == spr-corpus-bytes README
b8-b12.mp4        b3cc5f0e2fae840f…  == README (post-w3a-fix)
clip-b2-closeup…  e65ae48740472f57…  == README
tools: ffmpeg 7.1.5-0+deb13u1, opencv 5.0.0 (headless 5.0.0.93), numpy 2.5.3
       == the w3b/w4b session records (cross-session determinism held)
```

Anchor reproductions (pristine tree, BEFORE the edit): b7×motion-trails
`998c9b49…` ✓, b8×cartoon-cel `a9e8cd56…` ✓, b8×subject-toon v0.1.0
`503ea271…` ✓, b12 gateref `d19079ca…` ✓ (w4b recipe) — all BYTE-MATCH.

## 2. Diagnosis — the 15 criticals mapped to renderer mechanisms

Source: `spr-wave3-toon-promotion/scorecards/raw/subject-toon-*.json`
(15 per-call VLM JSONs) + the per-sample justifications.

| sample | limbs | players | VLM justification (verbatim extracts) | mapped mechanism (v0.1.0) |
|---|---|---|---|---|
| t45s | 4 | 0 | "flickering and morphing of the field texture and player shapes" | mask-path switching + per-frame palette flicker |
| t15s | 2 | 1 | — (terse output) | same |
| c550pre | 2 | 1 | "facial features and body details shift noticeably" | partial mask coverage inside bodies (seam through limbs) |
| c982post | 2 | 0 | "flickering and morphing of the field texture and player shapes" | same as t45s |
| c862post | 1 | 0 | "arm disappears, body rotates" | bg-path bleed through a thin mask at a limb |
| c189post | 0 | 1 | post-cut MOG2 rebuild window | mask ≈ 0 for the first frames after a cut |
| t8s | 1 | 0 | — (terse output) | post-cut rebuild window (11 frames after cut 189) |

Axis-gap mechanisms:

- **player disappearance (3)**: MOG2 (lr 0.05) absorbs standing/slow players
  into the background model after ~0.8 s; the Farneback residual knee (1.8
  px/frame @320×180) misses slow motion; the mask max-decay (0.90) then
  decays away in ~1 s → the player falls into the strong background path and
  palette-merges into the pitch.
- **limb malformation (12)**: the soft composite seam runs THROUGH small
  players (dilate 5 @320×180 ≈ 10 px pad at 640×360, less after the
  Gaussian soften), so partial-mask limbs get palette-quantized + boundary
  lines burned mid-limb; stale EMA ghost shells add duplicate/shifted
  shapes; the subject path's phi-8 XDoG soft-threshold produces broken
  contour noise on ~25 px players.
- **temporalConsistency 2.87 / sceneFidelity 2.73**: the background path
  re-quantizes independently per frame — cluster-boundary pixels flip
  palette index frame-to-frame ("field lines … shift noticeably in shape and
  position", "advertising boards severely warped"); the median-5 +
  triple-bilateral front-end erases 1–3 px pitch-line structure; the 5×5
  region mode-filter draws unstable fake boundaries on grass texture.
- **identityConsistency 3.20**: players reduced to "colored blobs" wherever
  the mask misses (they land in the strong path); XDoG noise on small
  subjects.
- **motionFidelity 3.13**: follows from the above (motion obscured by
  re-quantization + warping).

## 3. The v0.2.0 iteration (ADDITIVE-style, subject-toon code path only)

`_SubjectToonState` (config-key gated — with the v0.1.0 config overlay the
modified class is v0.1.0-equivalent, proven byte-identically on the w4b b12
anchor `3c0fdf81…`):

1. **Dual-rate mask hysteresis** (`maskRiseAlpha` 0.60 / `maskFallAlpha`
   0.05, cut-reset) replaces the max-decay EMA: new subjects covered within
   ~3 frames; subjects MOG2 has adapted to stay covered ~2 s (kills the
   disappearance class). MOG2 more sensitive (`mogVarThreshold` 25→18,
   `mogLearningRate` 0.05→0.02). Scale-aware pad: dilate 7 @320×180
   (~14 px @640×360) moves the composite seam off limbs.
2. **Sticky palette assignment** (`bgHysteresis` 1.18): per-pixel Schmitt
   trigger keeps the previous palette index while the previous center is
   within 1.18× the best current distance (ratio on squared distances);
   cut-reset discards the sticky map (contract §3.4). Pure index-level
   state — no pixel averaging, pans do not smear.
3. **Structure-preserving background front-end**: median 5→3, bilateral
   ×3→×2 (σ 75→60), region window 5→3, line floor 0.30→0.24, sat
   1.22→1.15 — 1–3 px pitch lines survive; fewer fake boundaries.
4. **Softer subject XDoG**: φ 8→5, line floor 0.70→0.62 — fewer broken
   contours on ~25 px players.

Registry row: version 0.2.0, pipeline description updated, config extended
(+`maskDilate`, `maskRiseAlpha`, `maskFallAlpha`, `bgHysteresis`;
`maskDecay` superseded by the dual-rate pair). Diff +124/−26, confined to
the subject-toon class + row; no other declaration, dispatch branch,
REGISTRY construction, or engine file touched.

## 4. Fast loop (variants A/B/C on short windows BEFORE any full render)

Window: b12 (300 frames = b8 frames 862–1161; covers the c862/c979/982
cut cluster + t45s — 7 of 15 v0.1.0 criticals) and b8 first-600 (covers
t2s…c550pre — 10 of 15). Machine gates green on every variant (T1/T2/T2b/
T3/T4, `fastloop/`). Mini-protocol VLM (frozen PROMPT, variant-selection
signal only; NOTE: the scratch loop paired c*pre samples forward across the
cut — pessimistic for all variants equally, does not affect the frozen
scorecard):

| variant (4 worst b12 samples) | criticals | tc | ic | mf | scf | ss |
|---|---|---|---|---|---|---|
| v0.1.0 baseline | 9 | 2.50 | 3.00 | 2.75 | 2.50 | 4.50 |
| A — mask v2 only | 0 | 2.25 | 3.75 | 2.75 | 2.00 | 4.75 |
| B — A + bg v2 | 1 | 2.75 | 3.75 | 3.00 | 3.25 | 4.50 |
| **C — B + subject v2 (shipped)** | **0** | **3.25** | **4.25** | **3.50** | **3.50** | 4.25 |

Second cluster (b8 first-600, 5 samples): v0.1.0 criticals 15 → C: 4; every
axis mean up (sf 4.0→5.0, tc 2.0→2.8, ic 2.8→3.6, mf 2.4→2.8, scf 2.4→3.0).
**Winner: C** (= the shipped v0.2.0 defaults) — the only variant with 0
criticals on both clusters and the best or tied-best mean on every axis.
A alone regressed sceneFidelity (bigger masks eat the toon background); B's
sticky background restored it; C's softer XDoG removed B's last limb count.

## 5. Full battery on the winner (frozen CLI, double-rendered)

| cell | frames | sha256 (both passes identical) | G-T1 | G-T2 | G-T2b | G-T3 | G-T4 | G-T5 |
|---|---|---|---|---|---|---|---|---|
| b8 (vs raw substrate) | 1190 | `aaac76b75a24f43e6a479ddd663a322a078afb441d40855d118fc79dc075a6a3` | PASS 1190==1190 Δ20 ms audio ✓ | PASS cov 1.0, extra 0.0 | PASS cov 1.0, 0 invented | PASS r=0.9951 | PASS 0.5178 % | **byte-identical ×2** |
| b12 (vs derived gateref `d19079ca…`, --max-frames 300) | 300 | `50edb582f6874d0d1ca1b79ed5ade6a7984cf1ba6a37f5f928c32a602372d964` | PASS 300==300 Δ0 ms audio ✓ | PASS cov 1.0 | PASS cov 1.0, 0 invented | PASS r=0.9974 | PASS 0.6036 % | **byte-identical ×2** |
| b2 (vs raw substrate) | 225 | `883172b6cadbb75d3d9f7a4e289c77214e0a0149b4ddcc5f31821b403ba2fe80` | PASS 225==225 Δ20 ms audio ✓ | PASS cov 1.0 | PASS cov 1.0, 0 invented | PASS r=0.9966 | PASS 1.1079 % | **byte-identical ×2** |

Other-lane regression on the modified tree: b8×cartoon-cel `a9e8cd56…`
BYTE-MATCH, b7×motion-trails `998c9b49…` BYTE-MATCH (the edit is
lane-isolated; the contract violation class did not occur).

## 6. Frozen-protocol VLM scorecard (harness, 15/15 calls landed)

| axis | v0.1.0 (w3b frozen) | v0.2.0 (this push) | Δ |
|---|---|---|---|
| sourceFidelity | 4.73 | **5.00** | +0.27 |
| temporalConsistency | 2.87 | **3.40** | +0.53 |
| identityConsistency | 3.20 | **4.27** | **+1.07 — crossed the 4.0 bar** |
| motionFidelity | 3.13 | **3.73** | +0.60 |
| sceneFidelity | 2.73 | **3.73** | +1.00 |
| stylizationStrength | 4.60 | **4.47** | −0.13 (intentionally spent headroom) |
| **minAxisMean** | 2.73 | **3.40** | +0.67 |
| **overallMean** | 3.54 | **4.10** | +0.56 |
| **criticalArtifacts** | 15 (12 limbs + 3 players) | **3 (3 limbs + 0 players)** | −12 |
| totalArtifacts | 75 | **31** | −44 |

Hard gates: ALL GREEN (T1/T2/T2b/T3/T4 on 3 cells + T5 double-render
byte-identity). VLM accounting: 15/15 frozen-protocol calls ok
(glm-5v-turbo, 0 retries needed) + 26 fast-loop mini-protocol calls + 1
access test. Per-sample table in `scorecards/scorecard-subject-toon.json`
+ raw per-call JSONs in `scorecards/raw/`. The player-disappearance class
is eliminated (players=0 on all 15 samples).

## 7. VERDICT — honest near-miss, Tier 2 NOT claimed

**tierClaim = 0.** The frozen bar is every axis ≥ 4.0 AND criticals = 0:
temporalConsistency 3.40 < 4.0 and criticals 3 > 0. No threshold, sample
set, or protocol was adjusted; the near-miss is recorded as the program
value. (Tier 1 also not claimable: means ≥ 3.5 but criticals > 0.)

Remaining defects, precisely located (`scorecards/raw/`):
- **c550pre: 2 limbs** — pre-cut frame (547) with "background players and
  the field texture shift", "melting" ad boards (warped=4). The sticky
  assignment is per-pixel; region-level temporal consolidation is the next
  classical step.
- **t30s: 1 limb** — single count, terse call.
- **c979pre (tc=2, scf=2)** — the 979/982 micro-shot-adjacent sample: the
  VLM reads the within-shot 0.2 s pair as "a completely different camera
  shot" (same reading as v0.1.0 — content before the double cut contains a
  whip-pan-like camera change; recorded harness-limitation class, the
  Tier-3 video-audit escape applies).
- **t8s-class (tc/scf 3)** — the post-cut MOG2 rebuild window: the first
  ~12 frames after cuts 189/475/550 have evolving mask coverage.

**Measured next increment** (for the next session, by these numbers):
1. region-level temporal consolidation of the palette index map (3-frame
   majority vote, cut-reset) — targets the remaining warped/`melting` class
   (c550pre, t45s, t8s): the residual artifact buckets are warped 14 /
   bg 10 / tj 4 (of 31 total; limbs 3, players/dupes/ball 0);
2. post-cut rebuild warmup (slower mask rise for ~10 frames after a cut,
   seeded by the within-shot motion mask) — targets the t8s/c*pre window
   without delaying c*post coverage;
3. if those land, temporalConsistency needs +0.60 mean (≈9 sample-points
   across 15 samples) and criticals 3→0 — both plausibly in reach of 1+2;
   stylizationStrength headroom (4.47) remains to spend.

## 8. Files

- `renders.json` — the full record (schema follows the w3a/w4b convention):
  substrate verification, controls/anchors, fast-loop variants, per-cell
  renders with gate tables + determinism pairs, scorecard block with the
  v0.1.0 baseline for comparison.
- `qa/` — qa_check + cuts_deep JSONs per battery cell (b8/b12/b2).
- `scorecards/` — `scorecard-subject-toon.json` (frozen harness output) +
  `vlm-scorecard-aggregate.json` + `raw/` 15 per-call VLM JSONs.
- `frames/` — 45 PNGs: original + stylized@t + stylized@t±0.2 for every
  frozen sample (t=2/8/15/30/45 + cut-adjacent; covers every
  previously-critical sample).
- `fastloop/` — variant gate JSONs + the mini-protocol VLM JSONs (b12 + b8
  first-600 windows) + this README's variant table sources.
- `commands.md` — every command class, verbatim.

Not committed (re-derivable, commands recorded): the render mp4 outputs
(shas above are the verification anchors, W2-B convention), the sandbox
evidence root `/home/z/spr-evidence/` (harness layout), the scratch
variant/fastloop drivers (`commands.md` §8).

## 9. Deviations

1. The fast-loop mini-protocol (§4) used the frozen PROMPT but a
   self-chosen sample set and a forward-paired c*pre defect (recorded in
   `commands.md` §4) — variant-SELECTION signal only; the formal tiering
   (§6) is exclusively the frozen harness on the full b8 render.
2. The b12 gate input is the derived 300-frame gateref (W2C/W4B precedent —
   the raw-substrate qa_check crashes on the pre-existing 338-vs-300
   metadata class; the gateref was byte-reproduced from the w4b recipe,
   `d19079ca…`).
3. b12's v0.1.0 anchor for the equivalence proof is the w4b matrix sha
   (`3c0fdf81…`, current substrate) rather than w3b's `edafe79f…`
   (pre-w3a substrate): the w3a apad fix changed the audio stream bytes;
   video packets are identical (w4b proof) — the equivalence claim is about
   the engine's frame pipeline.
