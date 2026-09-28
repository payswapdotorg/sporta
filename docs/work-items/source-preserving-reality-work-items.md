# Source-Preserving Reality — Work Items

Status doc: `docs/status/source-preserving-reality-status.md` (evidence pointers live there).
Owner: Tech Lead. Implementation: workers A (research) / B (renderer) / C (QA).

## Foundation

| ID | Title | Owner | Status | Definition of done |
|---|---|---|---|---|
| SPR001 | Architecture/contract freeze | TL | DONE | ADR-012 + architecture + contract docs frozen |
| SPR002 | Technology registry extension | A | **DONE** (877-line landscape + 963-line YAML, 63 searches, license red flags) | docs/research/source-preserving-technology-landscape.md, docs/technology/source-preserving-candidates.yaml |
| SPR003 | Benchmark corpus | C→TL | **MOSTLY COMPLETE (w6-spr-4)**: b8/b1/b12 + b2/b3/b5/b6/b7 discovered, assembled, per-clip VLM-verified (9-window discovery, ~774s sampled); b4 crowd PENDING honestly (no crowd-dominant passage in sampled material — needs goal timestamps); night confirmed day→night match | scripts/evidence/spr-wave2-corpus/corpus.json, /home/z/spr-evidence/benchmarks/corpus.json |
| SPR004 | Source-preserving renderer adapter (engine SPE-v1) | B→TL | **DONE — RE-VERIFIED (w6-spr-2)**: engine untouched (contract frozen), env-parameterized drivers, 5 renders re-run on the recovery substrate, triple-render byte-identical | scripts/source-preserving/, /home/z/spr-evidence/render/renders.json |
| SPR005 | Temporal consistency evaluation | C→TL | **DONE + RE-RUN + SPEC-CONFORMANT (w6-spr-3)**: qa_check hard gates re-measured; cuts_deep.py durable; vlm_scorecard.py v2 implements the frozen 7-axis protocol exactly (the v1 4-axis drift fixed — it was authored blind during the quota outage); cut-adjacent temporal pairs stay within the source shot | scripts/source-preserving/, qa/ |
| SPR006 | Provider adapter interface | B | WAVE-2+ | adapter seam for hosted/self-hosted neural candidates (profile-driven) |

## Visual realities (appearance axis)

| ID | Title | Owner | Status | Baseline (mandatory first) |
|---|---|---|---|---|
| SPR101 | Cartoon/Cel broadcast | B→TL | **RE-RENDERED — TIERED Tier 0 (w6-spr-3)**: all hard gates PASS (incl. b8 full-artifact double-render); VLM 7-axis: stylization 5.0 but identity/motion collapse (min axis 1.53), critical=99 — the aggressive flattening destroys player structure; wave-2 neural upgrade is the fix path | qa/scorecard-cartoon-cel.json, scripts/evidence/spr-tier2-scorecards/ |
| SPR102 | Anime/NPR broadcast | B→TL | **RE-RENDERED — TIERED Tier 0 (w6-spr-3)**: all hard gates PASS; VLM 7-axis min 1.80 (stylization 5.0, structure collapses into blobs), critical=136 | qa/scorecard-anime-npr.json |
| SPR103 | Watercolor/Painterly | B→TL | **TIERED Tier 0 (w5j 2026-09-28, branch spr/w5j/watercolor-promotion — PROMOTED from the w2c trial sprtrial-kuwahara-paint-t1, the subject-toon promotion pattern)**: spr-watercolor-dc1 v0.1.0 — orientation-adaptive anisotropic Kuwahara (own numpy implementation of the public Kyprianidis-class filter) with temporal tensor EMA (cut-reset), coherence-gated N=8 soft orientation field, soft inverse-variance quadrant blend, bilateral field consolidation, paper grain; the trial's measured anti-stages (palette pass, XDoG overlay — re-amplify blend residue) stay out, honestly recorded; 8-variant fast loop all-green (the EMA thesis doubly proven: v0-noema T4 0.9023 vs v1 0.6653 + VLM duel no-EMA WORST 'edge noise'); b8 RAW T2 PASS; determinism ×2 per cell; regression 6/6 byte-exact (all wave-5 siblings); VLM min-axis 1.80, critical 53 → honest Tier 0 (the painterly family range; ss 4.93) | evidence: scripts/evidence/spr-wave5-watercolor/ |
| SPR104 | Ink/Manga/Comic | B→TL | **TIERED Tier 0 (w5c 2026-09-27, lane E merge @f4cf71e)**: spr-ink-manga-dc1 v0.1.0 — XDoG soft-threshold lines + value quantize + screen-anchored 8×8 clustered-dot screentone + fixed paper grain; all gates green (b8/b12/b2, G-T1..T5), determinism ×2 per cell, regression byte-proven (cartoon-cel anchor exact); VLM min-axis 1.47 (identity 1.47/motion 1.53 collapse, stylization 5.0), critical 88 → honest Tier 0; predicted temporal strength real (T4 0.6185% vs base 0.458%, VLM notes dot stability) | evidence: scripts/evidence/spr-wave5-ink-manga/ (variant table, gate record, raw scorecards) |
| SPR105 | Clay/Miniature/Toy | —→TL | **TIERED Tier 0 (w5f REBUILD 2026-09-28, branch spr/w5f/clay-trial, TL rebuild of the reset-lost original)**: spr-clay-toy-dc1 v0.1.0 — medium flatten + fixed LAB K=12 toy palette (chroma-×1.25-lifted output) + relief-shade (Sobel slopes on the flattened luma, 3 fixed lights, flat-response=1, tanh, mix 0.35) + specular fake (inert no-op on b8, honestly recorded) + tilt-blur diorama + noir-law finish; all gates green (b8/b12/b2, G-T1..T5, determinism ×2 per cell), regression byte-proven (cartoon-cel + noir + subject-toon anchors exact); VLM min-axis 1.80, critical 48 → honest Tier 0 (the reset-lost original recorded 2.07/62 — same family range); VLM duel: recipe-with-relief BEST, no-relief WORST ("flat, unrecognizable blobs") — the structure-by-light thesis confirmed | evidence: scripts/evidence/spr-wave5-clay/ (rebuildProvenance block in record.json) + w5b research packet |
| SPR106 | Low-Poly/Game-like | —→TL | **TIERED Tier 0 (w5e 2026-09-27, lane G merge @f1933dd)**: spr-lowpoly-game-dc1 v0.1.0 — jittered-grid anchors + saliency top-up → Farneback warp EMA (cut-reset, emaAlpha 0.75 phase-3) → cv2.Subdiv2D → label-map flat fill + edge darken ×0.45; all gates green on b8/b12/b2 (G-T1..T5, b8 all-6-cuts EXACT), determinism ×2 per cell (cv2.magnitude IPP-f32 1-ulp flakiness root-caused → numpy f64 sqrt); regression byte-proven (cartoon-cel + subject-toon anchors exact); VLM min-axis 1.93 (ic 1.93/mf 2.20 — best flattened-family result yet: cartoon-cel 1.53/99, anime 1.80/136, ink-manga 1.47/88), critical 67 → honest Tier 0; w5b structure-ADDITIVE thesis PARTIALLY confirmed; measured next increment = resolution×density (ranked: subject-adaptive density, SLIC 600-1200, neural keyframe accelerator) | evidence: scripts/evidence/spr-wave5-lowpoly/ (variant table, gate record, raw VLM scorecards) + w5b research packet |
| SPR107 | Neon/Cyberpunk | B | WAVE-2 | LUT + bloom + edge glow |
| SPR108 | Noir/Monochrome/Retro | B→TL | **TIER 0 — NEAR-MISS Tier 1 (w6-spr-3)**: all hard gates PASS; VLM 7-axis sourceFidelity 5.0, min axis 3.59; blocked by ONE critical count (background-figure slight morphing VLM-categorized as limbs) | qa/scorecard-noir-retro-noir.json |
| SPR109 | Rotoscope/Hand-drawn | B→TL | **TIERED Tier 0 (w5i REBUILD 2026-09-28, branch spr/w5i/rotoscope-trial — the wave-5 F/H/J dispatch set now complete on origin)**: spr-rotoscope-dc1 v0.1.0 — pre-smooth + LAB K=10 fills + 2-tone value (wide smoothstep knee, phase-4 frozen light ×1.60/dark ×0.35) + HEAVY XDoG (eps 0.0010/phi 20, binary+median stabilized, FLOW-STABILIZED: Farneback forward-warp + EMA 0.75 + cut-reset, floor 0.10) + clean finish (sat 1.15 + vignette 0.20, no grain); 8-variant fast loop (v0-noflow thesis: VLM WORST 'severe temporal instability'; stabilized BEST); b8/b12 RAW T2 PASS, b2 extra-class → frozen T2b 1.0/0 (honest difference recorded); determinism ×2 per cell; regression 5/5 byte-exact (incl. both wave-5 siblings); VLM min-axis 2.33, critical 62 — EXACTLY the recorded original's count; ss 5.0 (family max) → honest Tier 0 | evidence: scripts/evidence/spr-wave5-rotoscope/ |

## Source-enhancing realities (spatial/semantic axis)

| ID | Title | Owner | Status | Notes |
|---|---|---|---|---|
| SPR201 | Motion trails | B→TL | **TIER 0 — NEAR-MISS Tier 1 (w6-spr-3)**: all hard gates PASS; VLM min axis 3.47; blocked by 2 critical counts (trail streaks on limbs counted as malformation — style-effect conflation recorded in the scorecard) | qa/scorecard-motion-trails.json |
| SPR202 | Silhouette/X-ray | B→TL | **TIERED Tier 0 (w5g 2026-09-27, lane I merge @c8632b3)**: spr-silhouette-xray-dc1 v0.1.0 — motion-compensated MOG2 + ink-fill/xray dual profiles; 11-variant fast loop, pan A/B measured, framediff fallback honestly rejected; b8 all hard gates green (T2b 1.0/0 invented, T3 0.8488; raw-T2 miss recorded + resolved), b12/b2 honest T2b class fails; determinism 4/4 double-render; VLM min-axis 1.47, critical 111 (abstract ink blobs at wide framing) → honest Tier 0 | evidence: scripts/evidence/spr-wave5-silhouette/ |
| SPR203 | Tactical overlay | — | WAVE-2 (SWM optional) | must degrade visibly without SWM facts |
| SPR204 | Commentary-reactive | — | BACKLOG | needs commentary lane integration |
| SPR205 | Player focus | —→TL | **TIERED Tier 0 — NEAR-MISS Tier 1 + TL GATE PASS (w5h3 v0.2.0 PLAYER-PRIORITY 2026-09-28, branch spr/w5h3/player-priority)**: spr-player-focus-dc1 v0.2.0 — the w5h2 named increment delivered: pitch-mask + blob-shape + kit-color + center priors reweight the motion gate (the tracker follows PLAYERS, not the ad-board — the w5h2 TL-FAIL defect, TL-verified fixed), compact spotlight clamp 0.75×0.65 (the window-balloon fix: mean area 1.2834→0.0951), deterministic tracker escape, feather 28 edge (the mini-A/B winner; player-exempt dim measured-and-rejected — the motion-light flicker class); config-gated so the v0.1.0 key set is byte-identical (proven: b8 3f0be6d2 + first-300 3fa814cf anchors); fast loop 6/6 ALL GREEN + VLM duel (WORST = v0.1.0 balloon, BEST = wide clamp); 3/3 double-render byte-identical (b8 0ecfe14e / b12 01ce4d92 / b2 b9e4dc1c); gates green (b8 raw-T2 0.67 stylization-softened class → T2b 1.0/0 binding, 0 invented; b12+b2 RAW PASS); VLM 15/15: min-axis 3.73, critical 2 → honest Tier 0 near-miss Tier 1 (the 2 criticals at ONE cut-adjacent pre-cut-chaos sample c189pre — class diagnosed + VLM run-variance observed; no laundering); **TL visual gate PASS** (both w5h2 defects fixed) — the program's best VLM family with the tracker following players; regression 7/7 byte-exact (all wave-5 siblings + v0.1.0 key-set) | evidence: scripts/evidence/spr-wave5-playerfocus-priority/ (also: the w5h v0.1.0 trial pack spr-wave5-playerfocus/ + the w5h2 withheld-attempt pack spr-wave5-playerfocus-tier1-attempt/) |

## Technology evaluation

| ID | Title | Owner | Status |
|---|---|---|---|
| SPR301 | Deterministic baseline benchmark of SPR101/102/108/201 | C→TL | **COMPLETE (w6-spr-3)**: hard gates + deep cuts + b8 full-artifact double-render determinism + frozen-protocol 7-axis VLM scorecards (60 conformance calls); honest tiers all Tier 0 with the near-miss diagnosis recorded — the wave-2 neural target is exactly stylizer visual quality (preservation proven: sourceFidelity 4.88–5.0) | scripts/evidence/spr-tier2-scorecards/, scripts/source-preserving/vlm_scorecard.py |
| SPR302 | Neural v2v candidate shortlist + feasibility matrix | A | WAVE-1 |
| SPR303 | Provider/hosted-inference trial (BYOK/free-tier verification) | A | WAVE-2+ (only where legitimately available) |

## First-milestone gate (§24 of the mandate)

```
real football source → SPE-v1 → two excellent realities (SPR101 + SPR102)
```
"Excellent" = Tier 2 evidence on the benchmark envelope: all hard gates green +
VLM scorecards ≥ 4/5 + TL visual approval. Expansion into other families unlocks
only after this gate.
