# Sporta Architecture Lock

**Status: FROZEN FOR IMPLEMENTATION**

This document defines the architectural decisions that implementation agents must preserve. A worker may implement within these boundaries; it may not silently redefine them.

## 1. Product boundary

Sporta is a sports reality rendering platform. The initial sport is football. The platform accepts only media that the operator/user is authorized to ingest and transform. The output is a newly rendered representation of the underlying sporting event.

## 2. Core architectural thesis

The canonical representation is a time-versioned Sports World Model (SWM), not raw broadcast pixels. All renderers consume SWM snapshots/events. Video and audio are perception inputs.

Required logical pipeline:

`authorized media -> ingestion -> normalized media timeline -> perception -> commentary intelligence -> multimodal event fusion -> Sports World Model -> renderer -> output stream`

## 3. First-class inputs

Video, audio/commentary, optional scoreboard/statistics feeds, and explicit match metadata are separate inputs. Commentary must be processed as a semantic signal. The system must preserve provenance and confidence for inferred facts.

## 4. Sports World Model invariants

Every canonical fact must have:

- stable entity identity within the relevant match/session;
- event-time and ingestion-time timestamps where applicable;
- confidence/provenance metadata;
- temporal versioning;
- explicit uncertainty rather than invented certainty.

The SWM must be sport-extensible. Football-specific rules live in a football domain module and cannot leak into generic transport or rendering interfaces.

## 5. Renderer abstraction

A renderer is a plugin behind a stable interface. At minimum the architecture supports:

- original/enhanced broadcast presentation;
- anime/stylized video rendering;
- 3D game/arcade-style rendering;
- tactical visualization.

A renderer may use neural video synthesis, deterministic graphics, game-engine rendering, or a hybrid. The rest of Sporta must not depend on a specific implementation technique.

## 6. Temporal consistency

Frame-to-frame identity and motion continuity are product-critical. Renderers must consume stable tracked state and may use temporal windows, reference embeddings, explicit scene geometry, or other mechanisms. Per-frame image quality alone is not sufficient.

## 7. Commentary intelligence

Speech-to-text, speaker/segment metadata, football-language interpretation, event extraction, confidence scoring, and synchronization with the match timeline are first-class services. Commentary may influence event confidence and presentation intensity but must not overwrite high-confidence visual evidence without provenance.

## 8. Real-time architecture

The platform must support both offline/batch generation and streaming. The data path therefore uses bounded buffers, asynchronous workers, explicit backpressure, and measured latency budgets. End-to-end latency is a measurable SLO, not a UI promise.

## 9. Vendor neutrality

No core contract may hard-code a single AI-model provider, GPU provider, cloud vendor, or game engine. Provider adapters are allowed behind stable interfaces.

## 10. Game-style rendering boundary

Sporta may create a proprietary game-like renderer inspired by general interaction patterns in sports games, but must not copy proprietary source code, assets, branding, protected UI, or game-specific implementation. “FIFA/PES-like” is a product-style reference, not a dependency or cloning requirement.

## 11. Rights boundary

Ingestion requires an explicit authorization/rights policy record. Rights metadata travels with the media session. Export/publication paths must be able to enforce restrictions. Engineering must never assume that transformation by itself clears rights.

## 12. Observability

Every media session must be traceable across ingestion, perception, event fusion, world-model updates, rendering, and delivery. Metrics include throughput, dropped frames, queue depth, model latency, renderer latency, end-to-end latency, identity continuity, event precision/recall where available, and output quality evaluations.

## 13. Security

Treat uploaded media and model outputs as untrusted data. Validate codecs/containers, bound resource usage, isolate GPU workloads, authenticate control APIs, authorize media access, and avoid exposing private source media through derived URLs.

## 14. Architecture-change procedure

A frozen decision can change only after an ADR is created under `docs/adr/`, the affected dependency chain is identified, migration/backward-compatibility is specified, and the tech lead explicitly records the architecture-lock revision. Workers may propose changes but may not unilaterally make them.

## 15. Explicit non-goals for the first release

- replacing licensed broadcasters;
- guaranteeing rights-free distribution of any sporting event;
- recreating a commercial football game or its proprietary assets;
- supporting every sport before the football vertical works;
- training a giant foundation model from scratch before validating the product loop.
