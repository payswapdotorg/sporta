# ADR-001: Sports World Model is the canonical rendering source

Status: Accepted / Frozen

## Context

Direct frame-to-frame style transfer can produce visually attractive output but is brittle under cuts, occlusion, player identity changes, commentary-driven emphasis, and multiple renderer targets. Sporta needs both stylized video and synthetic 3D/game-style rendering.

## Decision

Introduce a versioned Sports World Model as the canonical representation of the sporting event. Video and audio are evidence sources; renderers consume SWM snapshots and event streams.

## Consequences

Positive: renderer independence, replay/evaluation, multi-modal fusion, future sport expansion, ability to create synthetic viewpoints and game-style output.

Cost: perception and fusion are harder than a simple video filter; provenance and temporal state must be designed early.

## Rejected alternative

Direct video -> renderer as the core architecture. It is acceptable only as an internal optimization inside a renderer, never as the platform's canonical domain architecture.
