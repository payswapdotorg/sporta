# SPR303 — Worker 65-i delivery (the executed trial flight)

Manifest:

- work item: SPR303 — Provider/hosted-inference trial (BYOK/free-tier verification) (Owner: A, Wave: WAVE-2+ "only where legitimately available")
- branch: `work/spr303-animeganv2-trial` (from main @ 83ab9b9; never pushed)
- evidence tree: `scripts/evidence/spr303-animeganv2-trial/` (the trial scripts EXECUTED — 60 stylizations, 15/15 VLM calls; the render artifacts committed; latency/determinism JSONs; the 7-axis scorecard + per-call evidence; the fail-closed validator NEGATIVE-TESTED 6×; summary.md)
- gates: `bun scripts/evidence/spr303-animeganv2-trial/validate-trial.ts` exit 0 · `bash scripts/evidence/spr303-animeganv2-trial/negative-tests.sh` 6 refusals + the clean pass · `bunx prettier --check .` clean · `bunx eslint` 0 errors on the touched TS · FROZEN contracts + all prior evidence trees untouched
- the executed A/B verdict: the collapse axes BEATEN (trial minAxisMean 2.67 vs anime-npr 1.80 / cartoon-cel 1.53); tier claim honestly 0 (sampled-frame trial, hard gates a typed gap); TL visual gate PENDING; EbSynth leg DEFERRED (honest); no promotion

=== SPR303 TRIAL REPORT ===

## 1. The work item's honest resolution (the hosted angle)

SPR303's text says "Provider/hosted-inference trial (BYOK/free-tier
verification)". The SPR302 matrix (merged, `0ab5321`) recorded that **no
legitimate v2v hosted provider exists in the shortlist's classes** (the
diffusion class exceeds the host, two artifact-absent, two NC-not-ready,
ReReVST off-hub). So the honest resolution: **the local ONNX trial IS the
legitimately-available path** — executed, not simulated. The BYOK/free-tier
hosted angle is a **TYPED GAP** (`hosted-provider-absent`), recorded in
`trial-record.json` `honestReading`, never faked: no hosted provider was
invoked, no token was used.

## 2. The weights (ONE style, bounded, sha-recorded, the NC terms verbatim)

- Mirror: `vumichien/AnimeGANv2_Hayao` (ungated, HTTP-206-reachable — the
  SPR302-recorded mirror) @ revision
  `f84714b47ad2c7e930c5f3d5dff58fe91659be95`, file `AnimeGANv2_Hayao.onnx`.
- Executed download: 8,649,739 B (exactly the matrix-recorded per-style size),
  **sha256 `5a84ca468f3c4fd891fe8c883a3a507ed3e463f4f059985735f6449dae7590b5`**
  (`weights-fetch-meta.json`; stored OUTSIDE the repo at
  `/home/z/hf-bench-13/weights/` — weights are never committed). ONE style
  only — the trial is the A/B, not a portfolio.
- The NC terms, verbatim (the committed SPR302 fetch
  `spr302-v2v-feasibility/fetches/hf-vumichien-AnimeGANv2_Hayao-README@pinned-rev`):
  *"This repo is made freely available to academic and non-academic entities
  for non-commercial purposes such as academic research, teaching, scientific
  publications. Permission is granted to use the AnimeGAN given that you agree
  to my license terms. Regarding the request for commercial use, please
  contact us via email to help you obtain the authorization letter."*
- Recorded contradiction (never adjudicated): the card metadata tags
  `license: apache-2.0` while the body carries the NC terms; the tag plausibly
  covers the ONNX conversion, the body covers the AnimeGAN usage. Code is MIT
  (the canonical bryandlee port, fetched by 65-h). Film-frame training
  provenance (The Wind Rises / Shinkai / Paprika classes) is the standing
  production-class blocker. **Commercial clearance NOT proven; this is a
  research-class benchmark evaluation, never a promotion.**

## 3. The substrate (sha-pinned, byte-verified)

`scripts/evidence/spr-corpus-bytes/b8p3.mp4` — `sprclip-b8-inplay-original`,
1190 frames @ 25 fps, 640×360, **sha256
`969af7c6fdb172091ff00705b25fa37b7073f4332d722416b9754a4a7579917a`** —
identical with the scorecard-convention pin
(`spr-tier2-scorecards/renders-with-b8-determinism.json` inputSubstrate) and
re-verified against the committed bytes before every run phase
(`trial_animegan.py check_pins()`; the validator recomputes it too).

## 4. The executed A/B (measurements from real runs, CPU-labeled)

**60 stylizations executed** (onnxruntime 1.30.0 CPUExecutionProvider, 2 vCPU,
no GPU — GPU N/A honestly): the 30 trial frames (the frozen 15 scorecard
samples: t = 2/8/15/30/45 s + cut-adjacent pre/post for every frozen b8 cut
[189, 475, 550, 862, 979, 982], each with its within-shot ±0.2 s partner) +
a 30-frame consecutive mid-shot latency-probe block (300..329; labeled
latency-probe-only, not VLM evidence).

- **Latency (per-frame stylization wall-clock, CPU host)**: p50 **1366.4 ms**,
  p95 **1547.6 ms** (decode+inference+encode; inference-only p50 1267.7 ms /
  p95 1440.9 ms) over 60 frames. Full-clip arithmetic FROM the executed p50:
  1190 frames × 1.37 s ≈ **27.1 min/clip** — labeled arithmetic, NOT a
  measured full render (the typed gap `trial-is-sampled-frames-not-full-render`
  stands).
- **Determinism (double-run byte-identity, the anime-npr convention)**: all 30
  stylized frames re-stylized in a FRESH interpreter (fresh ONNX session) and
  sha256-compared with the committed renders — **byte-identical 30/30**;
  frame extraction re-run twice — byte-identical 15/15. `results/determinism.json`.
- **Renders committed** (the evidence chain): `renders/animeganv2-hayao-<sample>{,p2}.png`
  (30 PNGs) + `frames/original-<sample>.png` (15 PNGs); per-frame sha pins in
  `results/latency.json` (`rendersSha256`) — the validator recomputes every pin.

**Baseline side of the A/B**: the committed `spr-tier2-scorecards` evidence
REUSED verbatim (the anime-npr / cartoon-cel scorecards + their VLM per-call
evidence — never re-rendered, never re-scored).

## 5. The 7-axis VLM scorecard (the frozen protocol, 15/15 calls executed)

`scorecard-animeganv2-hayao.json` + `vlm/animeganv2-hayao-<sample>.json`
(the z-ai vision CLI, the `vlm_scorecard.py` calling convention; the model:
glm-5v-turbo, the same backend the baseline scorecards used). The ONE
recorded deviation: the prompt's family string names the trial's stylizer
honestly ("anime (AnimeGANv2 Hayao style)") — the trial is NOT the
spr-anime-npr renderer and is never labeled as it. Axis criteria, sample set,
temporal-pair design, artifact checklist and response contract are identical.

| axis (1–5) | **AnimeGANv2 Hayao trial** | anime-npr baseline | cartoon-cel baseline |
|---|---|---|---|
| sourceFidelity | **4.93** | 2.2 | 2.13 |
| temporalConsistency | 2.73 | 2.73 | 3.13 |
| identityConsistency | **2.67** | 1.80 | 1.53 |
| motionFidelity | **3.00** | 1.87 | 1.67 |
| sceneFidelity | **3.33** | 2.00 | 1.93 |
| stylizationStrength | 4.93 | 5.0 | 5.0 |
| **minAxisMean** | **2.67** | **1.80** | **1.53** |
| criticalArtifacts (limbs+players) | **38** | 136 | 99 |
| totalArtifacts (7 keys) | **83** | 235 | 190 |

**THE COLLAPSE AXES ARE BEATEN — the honest verdict**: trial minAxisMean
**2.67 > anime-npr 1.80** and **> cartoon-cel 1.53**. The identity collapse
axis (identityConsistency — the axis that collapsed the deterministic
stylizers) moves 1.80 → 2.67; sourceFidelity moves 2.2 → 4.93 (the
per-frame learned map preserves the source frame's content far better than
the aggressive classical stylization); critical artifacts drop 136 → 38.
Honest caveats, recorded not laundered: (a) the trial is **sampled-frame, not
a full render** — the G-T1..G-T5 hard gates are a **TYPED GAP** on this
trial, so **no tier may be claimed**; (b) identityConsistency 2.67 still sits
**below the Tier-1 3.5 bar** — the per-frame class's flicker risk (the
matrix's recorded HIGH class risk) remains visible in the per-sample spread
(t2s 4, c475pre 4, c982post 4 vs c979pre 1, t8s/t15s/t45s 2); (c) the
baseline scores are an earlier VLM run (cross-run drift recorded; same
protocol, same sample set, same prompt criteria); (d) temporalConsistency
2.73 equals anime-npr and trails cartoon-cel's 3.13.

## 6. The tier claim + the TL visual gate

**Tier claim: 0** — honestly. The tier thresholds require the full-render hard
gates green; a sampled-frame trial cannot claim a tier, and the collapse-axes
comparison above is the trial's actual result. **TL approval: PENDING** — the
TL owns the visual gate (the re-verification commands are in summary.md; the
committed originals + renders support direct visual inspection at every
sample).

## 7. The EbSynth leg (the second candidate — the honest deferral)

DEFERRED, not executed: the AnimeGANv2 leg completed within the flight
budget; the EbSynth leg requires the EbSynth CLI binary (not a hub model —
nothing to download legitimately from the hub) + our deterministic keyframes
as seeds, and the flight's time budget closed first. The recorded design
(keyframes from the committed spr-anime-npr family, propagated across
within-shot spans, scored by the same frozen protocol on the same sample set)
+ the matrix's standing blockers (public-domain code + the Adobe PatchMatch
patent warning + the tool terms) are in `trial-record.json` `ebsynthLeg` — a
wave-2 continuation flight if the TL admits the second leg.

## 8. The fail-closed record + validator (negative-tested)

`trial-record.json` (assembled by `record_trial.py` FROM the executed
artifacts — no hand-typed measurements) validated by
`bun scripts/evidence/spr303-animeganv2-trial/validate-trial.ts`:
structure; the weights pin (64-hex sha vs the fetch-meta, the exact 8,649,739 B,
ONE style, the NC citation verbatim IN the committed SPR302 fetch doc, the
commercial-clearance NOT-proven statement); the substrate sha (recomputed
against the committed bytes); the latency block vs `results/latency.json`
VERBATIM + all 30 render sha pins RECOMPUTED + the CPU/GPU honesty labels +
a recursive GPU-latency-key fabrication scan; determinism (run1 == the
committed bytes, run2 == run1, 30/30); the scorecard (15/15 ok, axes 1..5,
minAxisMean == min, critical == limbs+players, **every per-call evidence file
re-parsed against its entry**); the A/B baselines vs the committed scorecards
VERBATIM; tier 0 + TL PENDING; no promotion; the honest EbSynth deferral.
**NEGATIVE-TESTED** (`negative-tests.sh`): 6 fabricated/laundered variants —
a fabricated `gpuLatencyP50Ms`, the TL approval laundered to APPROVED, the
weights sha tampered, a laundered anime-npr baseline (1.8 → 2.9), a drifted
p50, the EbSynth deferral gutted — each REFUSED exit 1 with the failure
named; the committed record passes exit 0.

## 9. Limitations (all recorded in the record + scorecard)

1. Sampled-frame trial: no full 1190-frame render; the G-T1..G-T5 hard gates
   are a typed gap (measured instead: double-run determinism, byte-identical).
2. Temporal axes judged from within-shot 0.2 s pairs, not full-video review
   (the Tier-3 / wave-2 video audit owns that); artifact counts are per
   sampled frame.
3. Cross-run VLM drift vs the baseline (an earlier run) — recorded, never
   laundered; the TL's re-scoring can close it.
4. The hosted-provider angle is a typed gap (no legitimate provider exists
   per the matrix); GPU latency N/A (no GPU on this host).
5. The NC-weights commercial-clearance contradiction stays recorded — the
   HF015-class adjudication owns it; this flight promotes nothing.

## 10. The first-milestone-gate implication

The gate ("two excellent realities, Tier 2 evidence") is NOT met by this
trial — honestly: tier 0, hard gates not measured, identityConsistency 2.67 <
3.5. What the trial DOES establish for the lane: the collapse axes
(1.80/1.53) are beaten by the per-frame neural class on the identity/
source/motion/scene axes while remaining deterministic (byte-identity proven)
and CPU-host-feasible (27.1 min/clip arithmetic from the executed p50) —
i.e., the wave-2 neural path is a real candidate for closing the identity
collapse, pending the full-render hard-gate run + the VLM identity bar + the
TL visual gate + the license adjudication. The next honest step for SPR303b
(the TL's call): the full 1190-frame render + the G-T gate battery + the
Tier-2 scorecard, or the EbSynth seeded-keyframes leg for the
propagation-vs-per-frame class comparison.

=== END REPORT ===
