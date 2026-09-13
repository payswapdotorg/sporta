# Sporta Work Items

All items start `NOT_STARTED`. Status may change only with evidence in the implementation and tests.

## M0 — Foundation

### W001 Repository bootstrap
Owner: Platform. Dependencies: none.
Deliver: project layout, package/module conventions, local dev scripts, lint/format/type checking, CI skeleton.
Accept: clean checkout can run validation commands; CI executes them; contributor instructions exist.

### W002 Domain contracts
Owner: Tech Lead + Platform. Dependencies: none.
Deliver: versioned TypeScript/JSON-schema or equivalent contracts for media session, timestamps, observations, events, SWM references, renderer requests/results.
Accept: contracts validate fixtures; compatibility policy is documented.

### W003 Test/CI foundation
Owner: Platform. Dependencies: W001, W002.
Deliver: unit/integration/e2e test harness, fixture conventions, deterministic test data strategy.
Accept: representative tests run in CI.

### W004 Media session model
Owner: Platform. Dependencies: W002.
Deliver: session, source, authorization policy, timeline, processing state models.
Accept: lifecycle can be persisted and queried without vendor-specific fields.

### W005 Observation/event model
Owner: AI. Dependencies: W002.
Deliver: observation provenance/confidence and event envelope schemas.
Accept: observations and derived events can be linked and replayed.

### W006 Sports World Model contract
Owner: AI. Dependencies: W002.
Deliver: generic temporal SWM schema plus football extension.
Accept: stable identity, time, confidence, provenance, score/clock, entities, spatial state, events.

### W007 Observability foundation
Owner: Platform. Dependencies: W003.
Deliver: structured logs, metrics, traces, correlation IDs.
Accept: a single session can be traced conceptually across every stage.

## M1 — Football perception + commentary

### W101 Source ingestion
Owner: Platform. Dependencies: W004.
Accept: authorized local/file input works; invalid/unsupported media is rejected clearly; rights policy is checked.

### W102 Demux/decode normalization
Owner: Platform. Dependencies: W101.
Accept: video/audio are decoded into normalized internal representations with timestamps.

### W103 Timeline synchronization
Owner: Platform. Dependencies: W102.
Accept: audio/video clocks align to a canonical session timeline with measurable drift.

### W104 Segment transport
Owner: Platform. Dependencies: W103.
Accept: segments can flow between stages with bounded memory and retry semantics.

### W201 Player/object detection
Owner: AI. Dependencies: W005, W102.
Accept: fixture benchmark reports precision/recall and emits normalized observations.

### W202 Ball tracking
Owner: AI. Dependencies: W005, W102.
Accept: fixture benchmark tracks ball through representative occlusion/motion cases.

### W203 Pitch/field mapping
Owner: AI. Dependencies: W102.
Accept: field coordinates can be mapped consistently for benchmark clips.

### W204 Player identity tracking
Owner: AI. Dependencies: W201.
Accept: identity continuity metric is implemented and benchmarked across cuts/occlusion.

### W205 Ball state estimation
Owner: AI. Dependencies: W202.
Accept: position/velocity/confidence state can feed the SWM.

### W206 Spatial state estimation
Owner: AI. Dependencies: W203, W204.
Accept: player locations/projected coordinates are time-aligned.

### W207 Speech-to-text adapter
Owner: AI. Dependencies: W103.
Accept: provider-neutral adapter plus one functioning backend; timestamps retained.

### W208 Commentary segmentation
Owner: AI. Dependencies: W207.
Accept: speech is segmented into synchronized commentary units with speaker/channel metadata where available.

### W209 Football commentary understanding
Owner: AI. Dependencies: W208.
Accept: benchmark commentary extracts event candidates, subjects, emphasis, and confidence.

## M2 — World model

### W401 Multimodal world-model fusion
Owner: AI. Dependencies: W005, W006, W204-W206, W209.
Accept: observations and commentary become versioned SWM state with provenance; conflicting evidence remains explicit.

### W402 Temporal snapshots/events
Owner: AI. Dependencies: W401.
Accept: consumers can request state at time T and replay events forward deterministically within defined limits.

### W403 Replay/evaluation
Owner: AI. Dependencies: W402.
Accept: a fixed fixture produces comparable world-model outputs across runs with documented tolerance.

## M3 — Offline stylized rendering

### W501 Renderer contract
Owner: AI + Platform. Dependencies: W006.
Accept: renderer plugin interface can be implemented without modifying core SWM code.

### W502 Anime renderer prototype
Owner: AI. Dependencies: W501, W402.
Accept: short authorized football clips can render into a coherent stylized output.

### W503 Temporal consistency evaluation
Owner: AI. Dependencies: W502.
Accept: identity flicker, geometry drift, and temporal artifacts are measured on fixtures.

### W504 Anime output pipeline
Owner: AI + Platform. Dependencies: W503.
Accept: generated segments can be encoded, stored, and played back through the viewer API.

## M4 — Real-time pipeline

### W301 Streaming ingress
Owner: Platform. Dependencies: W102.
Accept: supported live input produces normalized segments while preserving timestamps.

### W302 Bounded processing queues
Owner: Platform. Dependencies: W104, W007.
Accept: backpressure, queue limits, cancellation, and recovery are tested.

### W303 GPU worker protocol
Owner: Platform + AI. Dependencies: W302.
Accept: jobs, heartbeats, results, retries, timeouts, and resource metadata are defined.

### W304 Streaming render orchestration
Owner: Platform + AI. Dependencies: W303, W402.
Accept: incremental SWM updates can drive renderer work without unbounded backlog.

### W305 WebRTC output
Owner: Platform. Dependencies: W304.
Accept: live rendered output is viewable end-to-end in supported browsers.

### W306 End-to-end latency benchmark
Owner: Platform. Dependencies: W305.
Accept: p50/p95 stage and end-to-end latency measured on a controlled fixture/stream; target SLOs are documented from evidence.

## M5 — Viewer/product

### W701 Session/control API
Owner: Product + Platform. Dependencies: W004, W501.
Accept: user can create session, choose renderer, inspect state, and obtain playback access according to authorization.

### W702 Viewer shell
Owner: Product. Dependencies: W701.
Accept: browser viewer plays supported batch/live outputs and exposes clear state/errors.

### W703 Renderer/style selection
Owner: Product. Dependencies: W701.
Accept: renderer selection is capability-driven, not hard-coded into frontend pages.

### W704 Live playback integration
Owner: Product. Dependencies: W305, W702.
Accept: live output reconnects safely and displays latency/status telemetry appropriate for users.

### W705 Batch playback integration
Owner: Product. Dependencies: W504, W702.
Accept: generated clip processing states and playback are complete.

### W706 Viewer telemetry
Owner: Product. Dependencies: W702.
Accept: useful playback/renderer errors and quality feedback are observable without collecting unnecessary sensitive data.

## M6 — 3D/game-style renderer

### W601 Scene projection contract
Owner: AI. Dependencies: W401.
Accept: SWM can be projected into a deterministic 3D scene specification.

### W602 3D avatar/field prototype
Owner: AI. Dependencies: W601.
Accept: benchmark SWM state becomes coherent playable-style field scene using original/proprietary-safe assets.

### W603 3D game-style renderer
Owner: AI. Dependencies: W602.
Accept: match progression rendered from SWM rather than replaying broadcast pixels.

### W604 Camera director/event presentation
Owner: AI. Dependencies: W603, W209.
Accept: event importance and commentary can influence camera/replay emphasis deterministically enough to evaluate.

### W605 3D output evaluation
Owner: AI. Dependencies: W604.
Accept: correctness of score, clock, player identity continuity, event ordering, and scene state is benchmarked.

## M7 — Release hardening

### W801 Evaluation harness
Owner: AI. Dependencies: W403.
Accept: repeatable benchmark suite produces machine-readable reports.

### W802 Latency SLOs
Owner: Platform. Dependencies: W306.
Accept: SLOs, alert thresholds, and failure/degradation policies exist.

### W803 Visual quality gates
Owner: AI. Dependencies: W503, W605.
Accept: release gates include temporal stability, scene correctness, and human/automated quality checks.

### W804 Product analytics
Owner: Product. Dependencies: W706.
Accept: product funnel and failure metrics are documented, privacy-scoped, and actionable.

### W805 Production observability
Owner: Platform. Dependencies: W007.
Accept: dashboards/alerts cover media, queue, model, renderer, delivery, and infrastructure health.

### W806 Release readiness
Owner: Tech Lead. Dependencies: W801-W805.
Accept: security, rights policy enforcement, performance, tests, docs, rollback, and known limitations reviewed.

## Status rule

Do not mark work complete merely because a worker says it is complete. The tech lead must verify the acceptance evidence and record the commit/PR reference and relevant test results.
