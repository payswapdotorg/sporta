# Source-Preserving Reality — Status

Program start: 2026-09-24 (session w6-spr-1). This file is the durable status
record. Evidence pointers are absolute machine paths or repo-relative.

## Current state: WAVE 1 IN FLIGHT

| Area | State | Evidence |
|---|---|---|
| SPR001 contract freeze | DONE | ADR-012, architecture, contract, work-items, benchmark, acceptance docs (this commit) |
| SPR002 research | WAVE-1 in flight (worker spr-w1-a) | pending docs/research/source-preserving-technology-landscape.md |
| SPR003 corpus | WAVE-1 in flight (worker spr-w1-c) | pending /home/z/spr-evidence/benchmarks/corpus.json |
| SPR004 engine SPE-v1 | WAVE-1 in flight (worker spr-w1-b) | pending scripts/source-preserving/ |
| SPR101/102/108/201 renders | WAVE-1 in flight | pending /home/z/spr-evidence/render/renders.json |
| SPR005 QA harness | WAVE-1 in flight | pending /home/z/my-project/scripts/spr-qa-*.mjs |
| Product surface | TL, after wave-1-B | pending src/app/page.tsx (Realities Lab) + /api/spr/* |

## Substrate (real, provenance-chained)

- b8 in-play Original: `/home/z/w6-real-r606-inplay-evidence/bytes/original-artifact-a13396ec.mp4`
  (47.6 s, 640×360, 25 fps, sha256 a13396ec…, window 1803.84–1851.44 s, VLM-verified
  in-play; source pack `w6-real-r606-inplay-evidence/pack.json`).
- Secondary on-disk window: 86 s calibration-ideal pull (1979–2213 s).
- Frozen source URL + acquisition recipe: benchmark doc §1.

## Relationship to other lanes

- R606 (reconstruction): OPEN, unchanged — calibration stage (W303 lane). The SPR
  program does NOT gate on it and does not modify it.
- R607: not advanced (unchanged rule: no advance while R606 open).

## Decisions log

- 2026-09-24 ADR-012 accepted; deterministic-first; SWM optional; tiers gate
  presentation; provenance + bit-exact reproducibility mandatory (contract doc).

## Risks / watchlist

- Stylization-vs-stability tension (gates G-T2/T3/T4 police it).
- Palette flicker at quantization boundaries — fixed per-clip palette mitigates;
  QA must measure.
- Acquisition path is the unratified VPN-egress third path (standing caveat) —
  benchmark usage is recorded with that honesty.
- CPU-only envelope: neural v2v not runnable here; kept as evidence-gated upgrade
  lane (worker A documents candidates).

## Next executable work

1. Wave-1 returns → TL visual review + integration (product surface).
2. Wave-2: corpus-wide renders + fixes + full scorecards (+ A's upgrades).
3. Tier 2 gate for SPR101/SPR102 → first-milestone complete.
