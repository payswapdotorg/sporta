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
| SPR103 | Watercolor/Painterly | B | WAVE-2 | Kuwahara/median + paper texture + palette |
| SPR104 | Ink/Manga/Comic | B→TL | **TIERED Tier 0 (w5c 2026-09-27, lane E merge @f4cf71e)**: spr-ink-manga-dc1 v0.1.0 — XDoG soft-threshold lines + value quantize + screen-anchored 8×8 clustered-dot screentone + fixed paper grain; all gates green (b8/b12/b2, G-T1..T5), determinism ×2 per cell, regression byte-proven (cartoon-cel anchor exact); VLM min-axis 1.47 (identity 1.47/motion 1.53 collapse, stylization 5.0), critical 88 → honest Tier 0; predicted temporal strength real (T4 0.6185% vs base 0.458%, VLM notes dot stability) | evidence: scripts/evidence/spr-wave5-ink-manga/ (variant table, gate record, raw scorecards) |
| SPR105 | Clay/Miniature/Toy | —→TL | **RESEARCHED (w5b 2026-09-27, merge @f4d17ee)**: 11 candidate records + measured stages — plasticine-flatten stack fully in-envelope at ≈148 ms/f measured (100% existing frozen stages + relief-shade as the ONE new renderer-declared stage 13.1 ms/f); dispatch-trial recommended (rank 2) | evidence: docs/technology/spr105-106-candidates.yaml + docs/research/spr105-106-technology-research.md |
| SPR106 | Low-Poly/Game-like | —→TL | **TIERED Tier 0 (w5e 2026-09-27, lane G merge @f1933dd)**: spr-lowpoly-game-dc1 v0.1.0 — jittered-grid anchors + saliency top-up → Farneback warp EMA (cut-reset, emaAlpha 0.75 phase-3) → cv2.Subdiv2D → label-map flat fill + edge darken ×0.45; all gates green on b8/b12/b2 (G-T1..T5, b8 all-6-cuts EXACT), determinism ×2 per cell (cv2.magnitude IPP-f32 1-ulp flakiness root-caused → numpy f64 sqrt); regression byte-proven (cartoon-cel + subject-toon anchors exact); VLM min-axis 1.93 (ic 1.93/mf 2.20 — best flattened-family result yet: cartoon-cel 1.53/99, anime 1.80/136, ink-manga 1.47/88), critical 67 → honest Tier 0; w5b structure-ADDITIVE thesis PARTIALLY confirmed; measured next increment = resolution×density (ranked: subject-adaptive density, SLIC 600-1200, neural keyframe accelerator) | evidence: scripts/evidence/spr-wave5-lowpoly/ (variant table, gate record, raw VLM scorecards) + w5b research packet |
| SPR107 | Neon/Cyberpunk | B | WAVE-2 | LUT + bloom + edge glow |
| SPR108 | Noir/Monochrome/Retro | B→TL | **TIER 0 — NEAR-MISS Tier 1 (w6-spr-3)**: all hard gates PASS; VLM 7-axis sourceFidelity 5.0, min axis 3.59; blocked by ONE critical count (background-figure slight morphing VLM-categorized as limbs) | qa/scorecard-noir-retro-noir.json |
| SPR109 | Rotoscope/Hand-drawn | B | WAVE-2 | XDoG heavy line + 2-tone value + flow-stabilized edges |

## Source-enhancing realities (spatial/semantic axis)

| ID | Title | Owner | Status | Notes |
|---|---|---|---|---|
| SPR201 | Motion trails | B→TL | **TIER 0 — NEAR-MISS Tier 1 (w6-spr-3)**: all hard gates PASS; VLM min axis 3.47; blocked by 2 critical counts (trail streaks on limbs counted as malformation — style-effect conflation recorded in the scorecard) | qa/scorecard-motion-trails.json |
| SPR202 | Silhouette/X-ray | B | WAVE-2 | motion-mask; honest degradation under camera motion |
| SPR203 | Tactical overlay | — | WAVE-2 (SWM optional) | must degrade visibly without SWM facts |
| SPR204 | Commentary-reactive | — | BACKLOG | needs commentary lane integration |
| SPR205 | Player focus | — | WAVE-2 | motion-energy emphasis + vignette |

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
