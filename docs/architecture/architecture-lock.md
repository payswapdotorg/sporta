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


## 16. Reality Engineering Lab

ADR-013 adds a Lab layer for discovering and evaluating production organizations.

- The Lab is additive and does not replace the SWM, renderer, rights, compute or live authorities.
- Lab simulators are not production truth.
- Lab scenarios and counterfactual results are explicitly labeled as simulated/model output.
- Domain Packs keep sport/event-specific rules out of generic Lab infrastructure.
- Football is the first domain pack; other sports and non-sport events must be able to plug into the same Lab contracts.

## 17. Agent Body and Organization

- An Agent Body is a reusable role/capability/tool/memory/permission/evaluation contract.
- A model or algorithm inhabits a body through the provider-neutral model/runtime boundary.
- An Agent Organization is a versioned graph of bodies/instances and delegation/communication edges.
- A generalist baseline and hand-designed baseline are mandatory comparison points.
- Organizations cannot mutate authoritative SWM facts or bypass rights/provenance/policy gates.

## 18. Historical corpus and source acquisition

- Historical material may be user-uploaded, fetched through an authorized provider/source adapter, received from an authorized feed, or retained as a reference-only URL.
- A URL is not proof of transformation rights.
- Source adapters must fail closed when access/use is not permitted.
- Acquired artifacts and derived features are content-addressed and provenance-linked.
- Reusable feature bundles may support repeated Lab replay without repeated media acquisition.

## 19. Organization registry and promotion

- Production organizations are versioned records in one canonical registry.
- Lifecycle is Draft -> Benchmarked -> Validated -> Canary -> Production -> Retired.
- Promotion requires reproducibility, benchmark, robustness, rights/provenance, security/policy, and cost/latency gates.
- Canary failures may trigger automatic rollback.
- Users may choose among eligible organizations for the declared objective/constraints; no organization is globally hard-coded as universally best.

## 20. User Labs and incentives

- User Labs are tenant-scoped and cannot write directly to production.
- Users can keep organizations private, publish them, or request governed promotion.
- Incentives are versioned product policy. Supported mechanisms may include a private-use window up to six months, disclosed discovery/featured benefits, credits, or combinations.
- Incentives never alter benchmark evidence or silently fabricate quality.

## 21. External platform API/MCP and long-running work

- HTTP APIs and MCP tools map to the same application service authority.
- External platforms may discover organizations, submit media/feed jobs, observe/cancel long-running jobs, retrieve validated outputs, and import eligible organization versions.
- No external integration may bypass organization promotion, rights, provenance or security gates.
- Durable job state lives in Sporta persistence/queues/workers.
- CopilotKit/OpenMuse/AG-UI or equivalent products may be connected as optional long-running task/human-interaction harnesses, but their internal state is never authoritative.

## 22. Architecture revision

ADR-013 is the controlling architecture change for the Reality Engineering Lab extension. Future changes to the Lab, Agent Body, Organization, promotion, external platform or historical-source authorities require a new ADR or an explicitly linked architecture revision and must update the dependency graph and handoff.
