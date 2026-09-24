# ADR-012 — Source-Preserving Realities

Status: ACCEPTED (2026-09-24)
Deciders: Sporta Tech Lead (session w6-spr-1)
Supersedes: none. Complements ADR-009 (MVP reality engine) and ADR-010 (live reality inputs).

## Context

R606 machine-proved that the SWM-dependent reality chain collapses on real broadcast
input: without pitch calibration (the earliest incorrect stage — the W303 lane), the
Tactical / 3D-Game / Anime-NPR renders land as empty default scenes, byte-identical to
the pre-match run (`w6-real-r606-inplay-evidence`, dedup proof). The reconstruction lane
is honest, valuable, and remains OPEN — but real-match visual realities cannot gate on
world reconstruction completing first.

Separately, the product objective demands a family of realities whose fundamental
contract is different:

```
REAL BROADCAST
     ↓  source-preserving transformation
SAME MATCH / SAME TIMELINE / SAME ACTION / SAME CAMERA / SAME PLAYER MOTION
DIFFERENT VISUAL REALITY
```

## Decision

1. **Add a first-class Source-Preserving Renderer family** to the renderer system
   (contract: `docs/contracts/source-preserving-renderer.md`). The ORIGINAL normalized
   media is the visual substrate. No world reconstruction is required.
2. **A Reality Compiler** composes stages across three transform axes — appearance
   (cartoon/anime/watercolor/ink/noir/neon/…), spatial (trails/silhouette/low-poly),
   semantic (tactical overlay/commentary-reactive/player-focus). Stages are Sporta-owned
   capabilities; external models are adapter implementations behind them.
3. **SWM is optional guidance, never a precondition.** A source-preserving reality must
   not require pitch calibration. This is the architectural correction of the R606
   bottleneck: `source-preserving anime ≠ source-preserving anime requires calibration`.
4. **Deterministic/classical baselines are mandatory first** for every neural category.
   A neural provider may only be promoted after beating the deterministic baseline on
   the Sporta benchmark with measured evidence (ADR-011 discipline).
5. **Tiers gate presentation** (0 prototype / 1 usable / 2 product / 3 premium).
   Only Tier 2+ realities are presented as completed product realities.
6. **Provenance and reproducibility are hard requirements**: every artifact carries
   input hashes, renderer id+version, config hash, pipeline stages, tool versions; a
   deterministic renderer must be byte-reproducible.
7. **Provider neutrality**: external technologies (models, hosted inference, GPU
   providers, closed-source services) enter only as versioned TechnologyProfiles in the
   technology registry and adapter implementations — never as domain truth.

## Consequences

- (+) Real-match alternate realities are unblocked today, on the already-acquired
  in-play R606 substrate, independent of the calibration lane.
- (+) Capabilities compound: each reality adds reusable stages (flow, masking, edge
  extraction, quantization, trails) making later realities configuration, not research.
- (+) Honest degradation: when SWM facts are unavailable, source-enhancing overlays
  degrade explicitly (visible note), never fabricate.
- (−) CPU-only sandbox bounds neural video-to-video today; the deterministic path is
  the first shippable implementation and the neural comparison stays an explicit,
  evidence-gated upgrade lane (not a fashion adoption).
- (−) Stylization strength vs temporal stability is a real tension; the acceptance
  metrics (cut alignment, motion correlation, static-region instability) exist to
  police it.
- R606 is unchanged: reconstruction lane stays OPEN on its own gate.

## Compliance rules (enforced by review)

- No synthetic source video as proof. Only the frozen real source (+ its windows).
- No slideshow-of-generated-frames as "video".
- No quality-bar lowering to close a work item; a reality stays experimental rather
  than being declared Tier 2 without evidence.
- No model/provider hard-wired into domain code; no free-tier dependency as
  architecture assumption.
