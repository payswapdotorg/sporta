# Sporta MVP + Live Reality Work Items

## Rule

J001-J015 remain the batch/public MVP hardening items. L001-L017 establish live reality. They share only the frozen contracts and evidence surfaces; workers may implement concurrently where dependencies permit.

## Live Reality work items

### L001 — Live contract freeze
Owner: Tech Lead.
Depends on: ADR-010.
Acceptance: live observation, world-state, watermark, temporal buffer, source adapter and live renderer contracts are frozen and discoverable in docs/contracts/live-reality.md.

### L002 — Synthetic/replay live source
Owner: Worker B.
Acceptance: deterministic timestamped live source can emit player/ball updates incrementally at a configurable rate, including jitter, delay, dropout and reconnect cases.

### L003 — Incremental SWM updater
Owner: Worker A.
Acceptance: live observations update the existing canonical SWM without creating a second live-only world model; version, watermark, provenance and uncertainty are retained.

### L004 — Temporal buffer / watermark engine
Owner: Worker A + B.
Acceptance: bounded reorder window, interpolation/extrapolation markers, lag accounting and explicit degraded state; no fabricated certainty.

### L005 — Live tactical renderer
Owner: Worker C.
Acceptance: browser tactical renderer consumes live SWM state/events, visibly changes as positions/events change, maintains identity continuity and runs without developer-only tooling.

### L006 — Live telemetry
Owner: Worker B + C.
Acceptance: source-to-ingest, ingest-to-SWM, SWM-to-render and end-to-end latency are measured; dropped/extrapolated updates and frame drops are visible to operators.

### L007 — SkillCorner/open-data replay adapter
Owner: Worker A + B.
Acceptance: legally permitted sample data can replay through the exact live adapter/SWM/tactical path; provider-specific fields do not leak into product contracts.

### L008 — Live provider TechnologyProfile
Owner: Worker A.
Acceptance: at least one real or explicitly blocked provider candidate is registered with capabilities, data format, rate, provenance, license/data-use state and failure classes.

### L009 — Authorized live provider adapter
Owner: Worker B.
Acceptance: one real authorized provider can feed the live contract when credentials/feed access exist; otherwise the item remains BLOCKED with exact external dependency recorded, while L001-L007 remain testable without it.

### L010 — Broadcast-to-live perception benchmark
Owner: Worker A.
Acceptance: at least one broadcast-perception candidate produces timestamped player/ball/pitch observations on an authorized or explicitly licensed benchmark clip; benchmark identity, pitch mapping, latency and dropout.

### L011 — Broadcast perception runtime seam
Owner: Worker A + Tech Lead.
Acceptance: broadcast perception can feed the same live observation contract without renderer changes or a second SWM.

### L012 — Multi-source evidence fusion
Owner: Worker A.
Acceptance: tracking and broadcast observations can coexist; confidence/provenance are retained; conflicts and source loss are explicit; fallback policy is deterministic.

### L013 — Live 3D renderer
Owner: Worker C.
Acceptance: existing 3D renderer consumes live SWM state/events; no renderer-specific world truth; camera remains interactive while state updates.

### L014 — Live/replay continuity
Owner: Worker B + C.
Acceptance: live session can be replayed through the same SWM and renderer contracts after the live window; state versions/timecodes remain aligned.

### L015 — Live tactical gate
Owner: Tech Lead.
Acceptance:
- real browser;
- state updates arrive continuously;
- tactical view visibly follows meaningful state changes;
- declared percentile latency budget is measured;
- identity continuity is bounded/measured;
- dropout/reconnect behavior is visible and recovers;
- no hidden fixture session or developer API.

### L016 — Live tracking -> SWM -> tactical journey
Owner: Tech Lead.
Acceptance:
fresh browser -> enter live match -> see live tactical state -> inspect player/ball state -> tolerate update interruption -> recover -> continue -> end live window -> open replay.

### L017 — Live-to-replay recovery gate
Owner: Tech Lead.
Acceptance:
the same match/session identity, world versions and timebase survive the live-to-replay transition; reload/redeploy does not create a second canonical state or lose already persisted replayable state.

## Parallelization

### Wave 0 — Tech Lead
L001 plus shared contracts for J004/J005/J007/J012/J013. Freeze schemas before worker changes.

### Wave 1
Worker A: J012 investigation + L003 + L004 design + L010 research/benchmark harness.
Worker B: J005 + J007 + L002.
Worker C: J004 + L005 renderer integration design.

### Wave 2
Worker A: J012 + L007 + L010 + L011.
Worker B: J006 backend + J014 + L006 + L009.
Worker C: J006 UI + J013 + L005 + L013.

### Wave 3
Worker A: J008-J010 + L012.
Worker B: J011 + L014 platform side + live connection/recovery.
Worker C: renderer fidelity + L013 + L014 presentation side.

### Wave 4 — integration
All workers test dependency-safe paths. No shared contract changes without Tech Lead approval.

### Wave 5 — final gates
Tech Lead: J015 -> R606/R607 -> L015/L016/L017.
Workers become fix-only lanes.

## Research/implementation constraints

- Do not fork commercial implementations.
- Prefer independently licensed building blocks and isolate copyleft research references.
- Do not make SkillCorner or any provider a permanent domain dependency.
- Do not block the live tactical milestone on perfect broadcast perception.
- Do not accept a live demo that only animates canned/static state.
