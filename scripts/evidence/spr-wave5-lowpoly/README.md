# SPR-W5-E — SPR106 Low-Poly/Game: Deterministic Renderer Trial (Lane G)

Task: implement the SPR106 deterministic baseline
`spr106.det.delaunay-flatfill` — the w5b rank-1 dispatch recipe (luma →
5-frame box-averaged gradient saliency → jittered-grid anchors + saliency
top-up → Farneback warp + fixed EMA + cut-reset → cv2.Subdiv2D → fillPoly
label rasterize + bincount flat fill → optional palette snap → label-edge
darken ×0.45 → encode-bitexact) — as a registered reality
`spr-lowpoly-game-dc1`, fast-loop the parameters (incl. the temporal A/B
flicker proof), full-render the coverage cells with double-render
determinism, gate everything, and run the frozen 7-axis VLM scorecard on
b8 with an honest tier verdict. Branch `spr/w5e/lowpoly-trial`, base
`a150cb2` (origin/main, post w5b merge). Engine contract FROZEN; the
registration is additive (one new row, +451/−0 in renderers.py).

## 1. Substrate verification (run first)

`sha256sum scripts/evidence/spr-corpus-bytes/*` — the three clips used by
this lane match the corpus README table exactly:

- `b8p3.mp4` `969af7c6fdb172091ff00705b25fa37b7073f4332d722416b9754a4a7579917a`
- `b8-b12.mp4` `b3cc5f0e2fae840f2aef93d859ce814babca226ee0b5d27e6da4e969b4312462`
- `clip-b2-closeup.mp4` `e65ae48740472f57ada031fdfb076cbb40a845239693acad83e8142c0caec062`

Tools: python 3.12.14, opencv 4.13.0 (Subdiv2D verified), numpy 2.1.3
(system — identical to the frozen engine toolset record), ffmpeg
7.1.5-0+deb13u1. No new repo dependencies (stdlib/numpy/cv2/ffmpeg only;
the SLIC variant was out of scope per the packet).

## 2. The renderer (frozen declaration, w5b candidates.yaml SPR106 record)

`_LowpolyGameState` in `spe/renderers.py` (+451/−0 vs base):

- **Stage 1 saliency** — Sobel k=3 magnitude on luma, Gaussian σ2
  smoothed, 5-frame trailing box average (cut-reset). Magnitude computed
  as **numpy float64 sqrt** — `cv2.magnitude` (IPP float32) was
  root-caused as 1-ulp alignment-flaky in this environment during the
  determinism battle (§4).
- **Stage 2 anchors** — FIXED jittered grid (20px lattice, PRNG seed
  20260927, jitter ±6px, generated once per render, screen-anchored —
  never moves) + border ring (inset 1px, full-frame hull coverage) +
  saliency top-up to N=1500 by **fixed-quantile inverse-CDF sampling**
  (seed 1066; the same fixed uniforms every frame — the slots track the
  saliency-mass quantiles, so per-frame resampling is smooth, not noisy).
- **Stage 3 temporal (the anti-flicker leg)** — Farneback
  (0.5/3/15/3/5/1.2/0) at 320×180 (the in-engine flow convention),
  bilinear-sampled at anchor positions, displacement ×2; fixed EMA
  (α=0.75) blends warped-prev slots with the fresh quantile sample;
  out-of-frame slots hard-respawn; **CUT-RESET drops all state** at every
  engine cut-detect hit (contract invariant 4).
- **Stage 4 rasterize + fill** — cv2.Subdiv2D over the 1-px grid-snap
  deduped anchor set; per-triangle `cv2.fillPoly` into an int32 label map
  (the w5b MEASURED label-map path — the 2425.7 ms/f naive per-triangle
  mask fill is the recorded anti-pattern and is NOT used);
  `np.bincount` per-channel means + LUT back-projection = flat facets.
  Palette snap (K=16 fixed LAB) implemented but OFF in the shipped
  profile (measured worse: T3 0.9316 / T4 1.4127 — the hard
  class-boundary flip class).
- **Stage 5 facet lines** — label-edge darken ×0.45 via the frozen
  `boundary_edge_map` + `edge_overlay` stages (dilate 1, soften 0.8) —
  the identity-anchor facet edges.
- **game-cel profile (optional)** — soft-knee 4-step V toon ramp + Sobel
  outline (dilate 2, floor 0.30); registered and smoke-verified, not
  gate-run (the default profile is the deliverable).

~2305 triangles from 1200 anchors (phase-1 measure; the shipped 1500/20px
mesh ≈ 2900). Render cost ≈ 54 ms/f pure (64 s per b8 pass incl. the
analysis pass) — inside the w5b measured budget envelope (26–69 ms/f).

## 3. Fast loop (`variant-table.json` — three phases, honest)

**Phase 1 (selection, b8 first-300, pre-determinism-fix code):** four
variants — v1 temporal-OFF / v2 recipe-baseline 24px-N1200 / v3 +palette
snap / v4 dense 20px-N1500. All gates passed on all four; the
full-resolution VLM duel (`fastloop-visual/duel-strip.png`) picked **v4**:
"the denser mesh provides significantly higher geometric resolution…
retains the distinct low-poly aesthetic without sacrificing broadcast
readability"; v3's palette snap flagged for "harsh, unnatural color
banding".

**Phase 2 (canonical regeneration, shipped code):** the four-variant
table re-run after the determinism fix; the frozen winner re-verified
through the CLI byte-exactly. **The temporal A/B flicker proof (the w5b
honest risk #3, now MEASURED):** G-T4 static-region flicker with temporal
OFF vs ON — phase 1: 1.4546% → 1.2188%; phase 2: 1.3958% → 1.2186%. The
flow-warp + fixed-EMA leg removes ~13–17% of static-region flicker and
holds all other gates.

**Phase 3 (honest re-open — the ink-manga precedent):** the first
full-render pass (α=0.65) FAILED G-T4 on the b12/b2 coverage cells
(1.5084% / 1.5339% vs the frozen 1.5% bar; b2 = the known crowd-shimmer
cell). A/B on the failing cells: v5 (α=0.75) / v6 (α=0.75 + soften 1.2) /
v7 (α=0.80 + soften 1.2). v6/v7 over-damp b8's cut-550 spike to the
16.0 threshold edge (T2b resolves, but raw is better); **v5 shipped**
(α 0.65 → 0.75, the only change) — ALL cells re-rendered from scratch.

## 4. Determinism battle (recorded for future lanes)

The first b12 full-render pass produced a pass1/pass2 sha MISMATCH
(bcba791b… vs 878f5025…). Empirical isolation: `cv2.magnitude` (OpenCV
4.13.0 / IPP 2022.2, float32) is **alignment-dispatched and 1-ulp
nondeterministic** in this environment (36/60 frames differing between
identical double-runs under memory churn; Sobel, GaussianBlur, Farneback
and remap all verified deterministic). The 1-ulp saliency noise compounds
through the EMA anchor recurrence and crossed pixel-rounding boundaries
from frame ~150. Fix: numpy float64 sqrt (IEEE-correctly-rounded) cast to
float32, in both saliency and the game-cel outline. After the fix all
cells double-render byte-identical. (The b8 smoke had "passed" twice
before by luck of the intermittent flake.)

## 5. Full renders + gates (`record.json` is the canonical table)

Every cell double-rendered into independent out-dirs (G-T5 discipline);
b12 gated against the pre-adjudicated first-300 gateref rebuilt from the
pre-w3a-fix b12 bytes (byte-reproduced `7cb3d728…` → `d19079ca…`, the
w3b pin).

| cell | frames | sha256 (BOTH passes) | det | G-T1 | G-T2 raw | G-T2b deep | G-T3 | G-T4 |
|---|---|---|---|---|---|---|---|---|
| b8 | 1190 | `492395d4b6892ecc14f9f5d47bd250dd72d4e28e922758637fc1756847b921d6` ×2 | **yes** | PASS 1190==1190, Δ20 ms, audio ✓ | **PASS** cov 1.0, extra 0.0 — all 6 cuts at EXACT indices 189/475/550/862/979/982 | PASS cov 1.0, 0 invented (amp ratios 0.813–1.394) | **PASS r=0.9579** | **PASS 1.1544 %** (base 0.458 %) |
| b12 | 300 | `372d538a7f4c4bce1dcafebb88b848a99d76de03763bbbae01675cb1d9b78d32` ×2 | **yes** | PASS 300==300, Δ0 ms, audio ✓ | raw cov 0.5 (117/120 micro-shot softened; fires 118) — **T2b-resolved** | PASS cov 1.0, 0 invented | **PASS r=0.9621** | **PASS 1.3864 %** (base 0.4806 %) |
| b2 | 225 | `a32ee92ecfdb4110a55164d83a21c8c4f8a41d78aa4d5b535cc80bf50dc5ec5f` ×2 | **yes** | PASS 225==225, Δ20 ms, audio ✓ | raw extra 3.326/30s (96/99 split-spike on cut 97) — **T2b-resolved** | PASS cov 1.0, 0 invented | **PASS r=0.9958** | **PASS 1.3782 %** (base 0.9449 %) |

Wall-clock (provenance telemetry): b8 64.3 s / 63.7 s; b12 ~17.3 s; b2
~13.6 s. The two T2-raw residual classes are the pre-adjudicated
stylization-softened/split cut classes — both resolved by the deep
correspondence gate (coverage 1.0, 0 invented), the frozen harness's own
resolution rule; flat-threshold diagnostic is empty on every cell.

## 6. Regression (engine untouched, proven byte-level)

cartoon-cel / noir-retro (noir) / subject-toon b8 re-rendered via the
frozen `render.py` AFTER the promotion edit — all three **byte-identical
to the w4b 54-cell ledger anchors** (`a9e8cd56…` / `3eedb423…` /
`503ea271…`). The frozen engine file set is byte-identical to the base
commit (`git diff a150cb2 --stat` over render.py / stages.py / encode.py /
provenance.py / registry.py / __init__.py / qa_check.py / cuts_deep.py /
vlm_scorecard.py / spe/trials/ = EMPTY).

## 7. Frozen-protocol VLM scorecard (b8, 15/15 calls landed)

`vlm_scorecard.py` (frozen, unmodified) on the machine-local evidence
root populated per its expected paths. glm-5v-turbo.

| axis | mean |
|---|---|
| sourceFidelity | 2.53 |
| temporalConsistency | 2.87 |
| identityConsistency | **1.93** |
| motionFidelity | 2.20 |
| sceneFidelity | 2.33 |
| stylizationStrength | 5.00 |

min axis **1.93**, overall 2.81, critical artifacts **67** (117 total),
hard gates ALL GREEN (G-T1..T5) — **tierClaim 0**.

**Honest verdict — Tier 0.** The w5b thesis is PARTIALLY confirmed and
measured precisely: the structure-ADDITIVE facet field is real and
visible (stylization 5.0; the VLM credits "the low-poly mesh structure is
stable"; close-ups carry identity — ic=3–4 with "jersey number, name, and
colors… distinct and recognizable"), and identityConsistency 1.93 with
criticals 67 is the **best flattened-family result yet** (cartoon-cel
1.53/99, anime-npr 1.80/136, ink-manga 1.47/88) — but the wide-shot
identity collapse persists ("players are reduced to indistinct colored
blobs" at 640×360 wide framing) and the frozen bar (every axis ≥ 4.0 + 0
critical + TL approval) is NOT met. No tier is claimed beyond 0.

**Measured next increment:** identityConsistency 1.93 / motionFidelity
2.20 are the blockers; the gap is RESOLUTION × DENSITY — a 20–60 px
wide-shot player is covered by ~3–8 facets of the 1500-anchor mesh.
Ranked attack paths: (a) subject-adaptive density (subject-toon's
mask-gentle architecture applied to the mesh — player regions at 3–5×
anchor density); (b) the SLIC superpixel profile (600–1200 segments ≈
2–4× effective facet count on players; pip-class posture recorded);
(c) the neural keyframe accelerator path. All three ride the same
segment-label skeleton this trial shipped.

## 8. Files

- `record.json` — canonical machine record (declaration, shas, gates,
  determinism battle, regression, scorecard, next increment).
- `variant-table.json` — the full fast-loop record (phases 1/2/3, params,
  shas, gates, VLM verdicts, temporal A/B numbers).
- `qa/` — 6 raw gate JSONs (`qa-lowpoly-game-{b8,b12,b2}.json` +
  `cuts-deep-lowpoly-game-{b8,b12,b2}.json`).
- `scorecards/` — `scorecard-lowpoly-game.json` + `vlm-scorecard.json`
  (aggregate) + `raw/` 15 per-call VLM JSONs (the frozen harness's own
  outputs).
- `frames/` — extracted t=2/8/15/30/45 (b8) + t=2/8 (b12/b2) PNGs from
  the pass-1 artifacts (the frozen adapter's `--frames`).
- `fastloop-visual/` — the duel strip + raw VLM comparison JSON.
- `registry-listing.txt` — frozen `render.py --help` proving
  `lowpoly-game` in `--reality` choices.
- `commands.md` — every command, in order, with exact paths.

Not committed (re-derivable, commands recorded): the render
mp4/provenance outputs (the shas above are the verification anchors,
W2-B/W3-B/W4-C/W5-C convention), the machine-local evidence root
(`/home/z/spr-evidence/`, the harness's expected paths), the derived
gate references and the scratch iteration harnesses (`/tmp/w5e/…`,
`/home/z/my-project/scripts/w5e_*.py`).

## 9. Deviations

1. **Phase-3 loop re-open after the fast-loop freeze**: the winner (v4,
   α=0.65) failed G-T4 on the b12/b2 coverage cells at full render. The
   loop was honestly re-opened, the failing cells measured directly,
   α hardened to 0.75 (the one free stabilization parameter), and ALL
   full renders re-produced from scratch. Earlier α=0.65 artifacts were
   discarded, not archived as evidence.
2. **Flow at 320×180 (flowScale=2), displacement ×2** — the in-engine
   flow convention (stages.flow_magnitude / `_gray_small`), declared in
   the pipeline string; the w5b 43.0 ms/f figure was measured at full
   resolution, ours runs ~10 ms/f at half resolution (budget-beating,
   same mechanism, honest wall-clock recorded).
3. **cv2.magnitude → numpy float64 sqrt** (the determinism battle, §4) —
   an environment-specific OpenCV/IPP flake, root-caused and recorded for
   future lanes.
4. **Quantile-slot top-up** instead of free resampling: the recipe's
   "saliency top-up N≈1200" is implemented as fixed-quantile inverse-CDF
   slots (same fixed uniforms every frame) — this is the mechanism that
   makes "warp prev anchors + EMA" well-defined without nearest-neighbor
   matching, and is declared in the pipeline string.
5. **Grid density 20px/N=1500 (not the recipe's ~24px/N≈1200-1500)**:
   the fast-loop variant axis (anchor density) selected the dense end of
   the recipe's own recorded range; the VLM duel verdict + gates recorded
   in `variant-table.json`.
6. **game-cel profile**: implemented, registered, smoke-verified (30
   frames + VLM confirm); not gate-run/scorecard-run — recorded
   honestly per the packet's "optional if time permits".
7. Task-packet wording "version dc1" interpreted per the W3-B/W4-C/W5-C
   precedent: rendererId carries the `-dc1` suffix; rendererVersion
   `0.1.0` mirrors contract §4.
