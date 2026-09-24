# Source-Preserving Reality — Work Items

Status doc: `docs/status/source-preserving-reality-status.md` (evidence pointers live there).
Owner: Tech Lead. Implementation: workers A (research) / B (renderer) / C (QA).

## Foundation

| ID | Title | Owner | Status | Definition of done |
|---|---|---|---|---|
| SPR001 | Architecture/contract freeze | TL | DONE | ADR-012 + architecture + contract docs frozen |
| SPR002 | Technology registry extension | A | **DONE** (877-line landscape + 963-line YAML, 63 searches, license red flags) | docs/research/source-preserving-technology-landscape.md, docs/technology/source-preserving-candidates.yaml |
| SPR003 | Benchmark corpus | C→TL | **PARTIAL — RECOVERED (w6-spr-2)**: b8 recovery substrate + b1 re-cut + b12 determinism cut on disk, corpus.json rebuilt with recovery provenance; b5 + b2-b7 PENDING (wave 2) | /home/z/spr-evidence/benchmarks/corpus.json, scripts/evidence/spr-wave1-recovery/corpus.json |
| SPR004 | Source-preserving renderer adapter (engine SPE-v1) | B→TL | **DONE — RE-VERIFIED (w6-spr-2)**: engine untouched (contract frozen), env-parameterized drivers, 5 renders re-run on the recovery substrate, triple-render byte-identical | scripts/source-preserving/, /home/z/spr-evidence/render/renders.json |
| SPR005 | Temporal consistency evaluation | C→TL | **DONE + RE-RUN (w6-spr-2)**: qa_check hard gates re-measured on the recovery substrate; cuts_deep.py + vlm_scorecard.py now durable repo scripts (the my-project/scripts copies died with the reset) | scripts/source-preserving/qa_check.py, cuts_deep.py, vlm_scorecard.py; qa/ metrics + cuts-deep JSONs |
| SPR006 | Provider adapter interface | B | WAVE-2+ | adapter seam for hosted/self-hosted neural candidates (profile-driven) |

## Visual realities (appearance axis)

| ID | Title | Owner | Status | Baseline (mandatory first) |
|---|---|---|---|---|
| SPR101 | Cartoon/Cel broadcast | B→TL | **RE-RENDERED — Tier 1 (w6-spr-2)**: T1/T2b/T3/T4 PASS, T2-det 0.833 = the known reproducible finding (cut@550 preserved at 79% amplitude; deep gate 1.0/0 invented); VLM scorecard pending quota | qa/metrics-cartoon-cel.json, qa/cuts-deep-cartoon-cel.json |
| SPR102 | Anime/NPR broadcast | B→TL | **RE-RENDERED — ALL hard gates PASS (w6-spr-2)** (VLM scorecard pending quota) | qa/metrics-anime-npr.json, qa/cuts-deep-anime-npr.json |
| SPR103 | Watercolor/Painterly | B | WAVE-2 | Kuwahara/median + paper texture + palette |
| SPR104 | Ink/Manga/Comic | B | WAVE-2 | value quantize + line art + screentone dither |
| SPR105 | Clay/Miniature/Toy | — | BACKLOG (needs research) | — |
| SPR106 | Low-Poly/Game-like | — | BACKLOG (needs research) | — |
| SPR107 | Neon/Cyberpunk | B | WAVE-2 | LUT + bloom + edge glow |
| SPR108 | Noir/Monochrome/Retro | B→TL | **RE-RENDERED — noir ALL gates PASS incl. deep cuts (w6-spr-2)** (VLM pending) | qa/metrics-noir-retro-noir.json, qa/cuts-deep-noir-retro-noir.json |
| SPR109 | Rotoscope/Hand-drawn | B | WAVE-2 | XDoG heavy line + 2-tone value + flow-stabilized edges |

## Source-enhancing realities (spatial/semantic axis)

| ID | Title | Owner | Status | Notes |
|---|---|---|---|---|
| SPR201 | Motion trails | B→TL | **RE-RENDERED — ALL gates PASS incl. deep cuts (w6-spr-2)** (camera-compensated translation+zoom flow, noise-knee, alpha-gated; VLM pending) | qa/metrics-motion-trails.json, qa/cuts-deep-motion-trails.json |
| SPR202 | Silhouette/X-ray | B | WAVE-2 | motion-mask; honest degradation under camera motion |
| SPR203 | Tactical overlay | — | WAVE-2 (SWM optional) | must degrade visibly without SWM facts |
| SPR204 | Commentary-reactive | — | BACKLOG | needs commentary lane integration |
| SPR205 | Player focus | — | WAVE-2 | motion-energy emphasis + vignette |

## Technology evaluation

| ID | Title | Owner | Status |
|---|---|---|---|
| SPR301 | Deterministic baseline benchmark of SPR101/102/108/201 | C→TL | **RE-RUN on the recovery substrate (w6-spr-2)**: hard gates + deep cuts + determinism all measured; VLM scorecards pending quota reset (scripts/source-preserving/vlm_scorecard.py) | qa/ (mirrored in scripts/evidence/spr-wave1-recovery/) |
| SPR302 | Neural v2v candidate shortlist + feasibility matrix | A | WAVE-1 |
| SPR303 | Provider/hosted-inference trial (BYOK/free-tier verification) | A | WAVE-2+ (only where legitimately available) |

## First-milestone gate (§24 of the mandate)

```
real football source → SPE-v1 → two excellent realities (SPR101 + SPR102)
```
"Excellent" = Tier 2 evidence on the benchmark envelope: all hard gates green +
VLM scorecards ≥ 4/5 + TL visual approval. Expansion into other families unlocks
only after this gate.
