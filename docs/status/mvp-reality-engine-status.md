# Sporta MVP Reality Engine Status

**Status as of 2026-09-17:** APPROVED / NOT YET MVP-COMPLETE

## Important truth

W001-W921 remain valuable and are recorded complete in their respective ledgers. They establish the contracts, SWM, control plane, product shell, and beta infrastructure.

They do **not** by themselves prove the customer-visible MVP. The old beta gate accepted fixture/in-process/SVG-backed evidence that is insufficient for the newly approved product-result definition.

The MVP Reality Engine program therefore starts with all R001-R605 in `NOT_STARTED` until the Tech Lead verifies executable evidence.

## MVP definition

The MVP is complete only when a fresh browser can:

```text
real authorized football MP4
  -> real perception
  -> canonical SWM
  -> Original MP4
  -> Tactical MP4
  -> 3D Game MP4
  -> Anime/NPR MP4
  -> persistent artifacts
  -> HTML5 playback
  -> Reality Switcher for the same match/session
```

This must pass on two materially different real clips and receive human visual acceptance.

## Execution control

### Wave 0 — Tech Lead only

Freeze/verify shared contracts before any parallel implementation:

- TechnologyCandidate / TechnologyProfile;
- BenchmarkRun / EvaluationReport / PromotionRecord;
- PerceptionAdapter;
- ComputeRequest / Quote / Job / Provider;
- SourceAsset / MediaManifest / RenderArtifactManifest;
- GameEngineAdapter / RendererAdapter;
- upload/session/job state transitions.

### Wave 1 — 3 workers concurrent

Worker A: `R001-R005`

Worker B: `R101-R104` + `R401`

Worker C: `R301` + `R302`

### Wave 2 — 3 workers concurrent

Worker A: `R201-R206`

Worker B: `R402-R405`

Worker C: `R303-R304`

### Wave 3 — dependency integration

Worker A: `R207-R208`

Worker B: `R406-R409`

Worker C: `R305-R307`

### Wave 4 — product integration

Worker B: backend portions of `R501-R503` and real compute/media hardening.

Worker C: `R501-R507` browser/product path.

Worker A: evidence/benchmark remediation only; no new shared-contract changes without TL approval.

### Wave 5 — final proof

Tech Lead: `R601-R605`.

All workers are fix-only and may only receive narrowly isolated tasks that cannot mutate shared contracts or reset earlier gates without TL approval.

## Worker evidence requirement

Every worker reports:

```text
worker / work items / start commit / end commit
changed files / contract changes / tests
acceptance evidence / fixture-vs-real boundary
license+model provenance / resource+cost evidence
risks / blockers / proposed architecture deviation
```

An architecture deviation blocks downstream work until the Tech Lead decides whether ADR-009 or the architecture lock must change.

## Current product gap

The current public web path still contains fixture/in-process and animated-SVG boundaries. Those are useful engineering harnesses but do not satisfy the MVP gate.

## Technology policy

All replaceable technology must enter through versioned adapters and be benchmarked through the Technology Evaluation Plane. Candidate technology may be replaced, combined, cascaded or used as fallback without changing product/domain contracts.

Every production candidate must carry version/provenance, resource requirements, license/commercial-use status, benchmark identity, cost/throughput evidence, and known failure semantics.

## Compute policy

The initial user-owned/hosted candidates are Modal, Lightning AI, RunPod and local GPU. Hugging Face/ZeroGPU is experimental only. Sporta-managed compute is a future service tier over the same Compute Broker, not a separate execution architecture.

## Final gate

`R601-R605` must pass `docs/testing/mvp-reality-engine-acceptance.md`. Only then may the repository describe Sporta as MVP-complete.