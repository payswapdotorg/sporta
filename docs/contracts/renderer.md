# Renderer Contract

A renderer is an implementation of a versioned plugin contract. It must not require callers to know how frames are synthesized.

## Input

- `sessionId`
- `rendererId` and `rendererVersion`
- style/configuration object
- SWM snapshot
- ordered SWM events since the snapshot watermark
- output profile (resolution, frame rate, codec/container, latency class)
- rights/authorization capabilities relevant to source references
- optional source-frame references where permitted

## Output

- encoded media segments/frames;
- output timestamps and watermarks;
- renderer health/lag;
- confidence/quality metadata where available;
- provenance links back to SWM snapshot/event versions.

## Renderer classes

### Stylized video renderer
Uses source-frame references plus SWM guidance and temporal conditioning where permitted.

### Procedural/3D renderer
Projects SWM state into a synthetic world and renders using deterministic graphics/game-engine infrastructure.

### Tactical renderer
Produces field diagrams, player markers, event overlays, trajectories, and analytical views.

## Isolation

A renderer is replaceable. Its dependencies must live behind its adapter/package boundary. The core domain cannot import a renderer-specific ML framework directly.

## Failure behavior

Renderers must expose explicit degradation states. A render worker may fall back to lower quality, reduced frame rate, delayed output, or an alternate compatible renderer only when policy permits it; it must not output misleading stale state without marking it.

## Versioning

Renderer IDs are stable logical identifiers. Renderer versions are immutable. Style/configuration schemas are versioned separately.
