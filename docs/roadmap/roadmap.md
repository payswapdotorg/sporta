# Sporta Roadmap

## Gate G0 — Repository handoff-ready

Outcome: the repository is self-contained and an LLM tech lead can begin without chat context.
Required artifacts: agent contract, architecture lock, architecture, dependency graph, work items, contracts, testing/release guidance.
Current state: READY after this bootstrap commit.

## Gate G1 — Foundation

Complete M0. The team can develop, validate contracts, run CI, persist a media session, and trace a request.

Exit evidence:
- CI green;
- contracts validate fixtures;
- media/session lifecycle tests green;
- tracing correlation works.

## Gate G2 — Football understanding

Complete M1. An authorized football clip can be ingested, decoded, time-aligned, tracked, and semantically interpreted.

Exit demo: a fixture produces synchronized player/ball observations plus commentary-derived event candidates.

## Gate G3 — Sports World Model

Complete M2. Sporta can reconstruct and replay a coherent temporal match state.

Exit demo: query state at selected timestamps and replay event sequence with provenance/confidence.

## Gate G4 — First consumer value

Complete M3. Offline authorized clips render in an anime/stylized mode with measurable temporal consistency.

Exit demo: one clip -> original reference + transformed output, with fixture metrics and playback.

## Gate G5 — Near/live value

Complete M4 and enough M5 to view output. Streaming input flows through bounded queues to a browser-visible live renderer.

Exit evidence: measured latency; controlled degradation under load; reconnect behavior tested.

## Gate G6 — Product experience

Complete M5. Users can create sessions, select supported renderers, watch batch/live outputs, and see processing/errors.

## Gate G7 — Game-style renderer

Complete M6. SWM is rendered into a proprietary-safe 3D football experience. No dependency on commercial game code/assets.

## Gate G8 — Production readiness

Complete M7. Security, rights enforcement, evaluation, observability, performance, rollback, and known limitations are reviewed.

## Recommended execution strategy

M0 should be completed before substantial feature work. M1 can parallelize platform ingestion (W101-W104) with AI perception (W201-W203) once contracts exist. Commentary (W207-W209) can progress in parallel with perception after timeline synchronization. M2 begins when sufficient observations exist. M3 and streaming foundation can proceed in parallel where their dependencies allow. M5 should follow stable session/renderer contracts. M6 deliberately comes after the world model so the renderer is not coupled to broadcast pixels.

## Definition of release candidates

RC0: deterministic offline analysis fixture.
RC1: offline anime renderer demo.
RC2: controlled live streaming prototype.
RC3: public beta for authorized/user-owned media.
RC4: production release after release-readiness gate.

Any target or latency number not backed by benchmark evidence is an aspiration, not an SLO.
