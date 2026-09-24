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
| SPR104 | Ink/Manga/Comic | B | WAVE-2 | value quantize + line art + screentone dither |
| SPR105 | Clay/Miniature/Toy | — | BACKLOG (needs research) | — |
| SPR106 | Low-Poly/Game-like | — | BACKLOG (needs research) | — |
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
