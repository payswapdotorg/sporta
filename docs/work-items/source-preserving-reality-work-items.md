# Source-Preserving Reality — Work Items

Status doc: `docs/status/source-preserving-reality-status.md` (evidence pointers live there).
Owner: Tech Lead. Implementation: workers A (research) / B (renderer) / C (QA).

## Foundation

| ID | Title | Owner | Status | Definition of done |
|---|---|---|---|---|
| SPR001 | Architecture/contract freeze | TL | DONE | ADR-012 + architecture + contract docs frozen |
| SPR002 | Technology registry extension | A | WAVE-1 | candidates YAML with full profiles + lifecycle states |
| SPR003 | Benchmark corpus | C | WAVE-1 | 6-8 real windows + corpus.json + VLM verification + reproducible recipe |
| SPR004 | Source-preserving renderer adapter (engine SPE-v1) | B | WAVE-1 | render.py CLI + stage library + registry + provenance writer; double-render determinism proven |
| SPR005 | Temporal consistency evaluation | C | WAVE-1 | metrics harness (cut alignment, motion correlation, static-region instability) runs on any artifact |
| SPR006 | Provider adapter interface | B | WAVE-2+ | adapter seam for hosted/self-hosted neural candidates (profile-driven) |

## Visual realities (appearance axis)

| ID | Title | Owner | Status | Baseline (mandatory first) |
|---|---|---|---|---|
| SPR101 | Cartoon/Cel broadcast | B | WAVE-1 | bilateral flatten + fixed-palette LAB quantize + XDoG lines |
| SPR102 | Anime/NPR broadcast | B | WAVE-1 | stronger flatten + limited palette + clean line art + sat lift |
| SPR103 | Watercolor/Painterly | B | WAVE-2 | Kuwahara/median + paper texture + palette |
| SPR104 | Ink/Manga/Comic | B | WAVE-2 | value quantize + line art + screentone dither |
| SPR105 | Clay/Miniature/Toy | — | BACKLOG (needs research) | — |
| SPR106 | Low-Poly/Game-like | — | BACKLOG (needs research) | — |
| SPR107 | Neon/Cyberpunk | B | WAVE-2 | LUT + bloom + edge glow |
| SPR108 | Noir/Monochrome/Retro | B | WAVE-1 | tone curves + grain + vignette; VHS/CRT profiles |
| SPR109 | Rotoscope/Hand-drawn | B | WAVE-2 | XDoG heavy line + 2-tone value + flow-stabilized edges |

## Source-enhancing realities (spatial/semantic axis)

| ID | Title | Owner | Status | Notes |
|---|---|---|---|---|
| SPR201 | Motion trails | B | WAVE-1 | flow-weighted decay, cut-reset |
| SPR202 | Silhouette/X-ray | B | WAVE-2 | motion-mask; honest degradation under camera motion |
| SPR203 | Tactical overlay | — | WAVE-2 (SWM optional) | must degrade visibly without SWM facts |
| SPR204 | Commentary-reactive | — | BACKLOG | needs commentary lane integration |
| SPR205 | Player focus | — | WAVE-2 | motion-energy emphasis + vignette |

## Technology evaluation

| ID | Title | Owner | Status |
|---|---|---|---|
| SPR301 | Deterministic baseline benchmark of SPR101/102/108/201 | C | WAVE-1/2 |
| SPR302 | Neural v2v candidate shortlist + feasibility matrix | A | WAVE-1 |
| SPR303 | Provider/hosted-inference trial (BYOK/free-tier verification) | A | WAVE-2+ (only where legitimately available) |

## First-milestone gate (§24 of the mandate)

```
real football source → SPE-v1 → two excellent realities (SPR101 + SPR102)
```
"Excellent" = Tier 2 evidence on the benchmark envelope: all hard gates green +
VLM scorecards ≥ 4/5 + TL visual approval. Expansion into other families unlocks
only after this gate.
