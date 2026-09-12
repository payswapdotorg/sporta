# Sporta Canonical Architecture

## 1. System context

Sporta converts authorized sports media into alternate visual representations while preserving the underlying event. It is split into control plane, media plane, intelligence plane, rendering plane, and experience plane.

```text
Authorized Media
   |        \
 video      audio/commentary
   |          |
   +---- Ingestion / Normalization ----+
                                      |
                          Time-aligned Media Timeline
                                      |
                +---------------------+---------------------+
                |                                           |
         Visual Perception                         Commentary Intelligence
                |                                           |
                +---------------------+---------------------+
                                      |
                           Multimodal Event Fusion
                                      |
                             Sports World Model
                              /       |        \
                             /        |         \
                         Anime      3D Game    Tactical
                       Renderer    Renderer     Renderer
                             \        |         /
                              +-------+--------+
                                      |
                               Output / Delivery
                                      |
                                  Viewer API/UI
```

## 2. Planes

### Control plane

Owns users, projects, media sessions, authorization policy, renderer configuration, model configuration, quotas, and audit records.

### Media plane

Owns ingestion, demuxing, decoding, frame normalization, audio normalization, timestamp alignment, buffering, and output delivery.

### Intelligence plane

Owns object detection, segmentation, tracking, field mapping, audio transcription, commentary interpretation, event extraction, identity reconciliation, and SWM updates.

### Rendering plane

Owns renderer plugins, style configuration, temporal consistency, graphics composition, neural generation, 3D scene generation, and encoding.

### Experience plane

Owns viewer, session management, playback controls, renderer/style selection, generated highlights, accessibility, and creator configuration.

## 3. Canonical data flow

A `MediaSession` is the unit of processing. It references authorized source media and a clock/timeline. Perception components emit observations. Commentary components emit semantic observations. Event fusion reconciles them into versioned SWM state. Renderers consume immutable snapshots plus an event stream.

The SWM is not a database dump; it is an event-sourced/temporal domain model whose snapshots can be persisted for replay and evaluation.

## 4. Core domains

- `identity`: opaque stable session-local subject identifiers, with optional external identity mappings when legally/technically justified.
- `media`: source streams, tracks, codecs, timestamps, segments, permissions.
- `observation`: raw model observations with provenance/confidence.
- `match`: sport rules, teams, players, clock, score, official events.
- `world`: canonical SWM entities/state.
- `render`: renderer contracts, style specs, output jobs, renderer telemetry.
- `delivery`: manifests, stream sessions, latency/quality state.

## 5. Observation versus fact

A detector saying “there is a player at (x,y)” is an observation. A fused world-model statement saying “home_player_7 controls the ball” is a derived fact. Every derived fact retains links to supporting observations and confidence.

## 6. Event model

Examples include kickoff, possession-change, pass, carry, tackle, shot, save, goal, card, substitution, offside, injury pause, referee decision, replay cue, and commentary-emphasis. Event taxonomy is versioned by sport.

## 7. Real-time mode

Streaming stages communicate through bounded low-latency queues. Expensive processing can operate at variable rates, but the system must preserve a coherent match clock. Every stage reports watermark and lag relative to the canonical media timeline.

## 8. Batch mode

The same contracts are used for uploaded media. Batch mode is not a separate product implementation. It runs the same pipeline with larger buffers, retryable jobs, deterministic evaluation hooks, and offline quality scoring.

## 9. Renderer contract

Renderers receive:

- session/match metadata;
- an SWM snapshot;
- subsequent SWM events;
- current presentation style;
- output constraints;
- optional source-frame references allowed by the rights policy.

Renderers return encoded segments/frames plus telemetry and quality metadata.

## 10. Model provider boundary

`ModelAdapter` interfaces abstract speech recognition, vision inference, tracking, multimodal reasoning, generation, embeddings, and optional moderation. Model selection/configuration is data-driven so models can be replaced without changing domain contracts.

## 11. Storage

Object storage holds source segments when allowed, intermediate artifacts when necessary, generated outputs, renderer assets, and evaluation fixtures. Relational storage holds control-plane entities and durable metadata. An event/queue system carries transient processing messages. No single storage product is required by the domain model.

## 12. Runtime

The first deployment target may use a conventional web frontend, API service, relational database, object storage, queue/stream service, and on-demand GPU workers. GPU orchestration is isolated behind job contracts so the platform can later move from simple managed GPU jobs to a dedicated worker cluster.

## 13. Reference deployment shape

- Web client: Next.js/React.
- API/control plane: typed HTTP API with asynchronous job endpoints.
- Relational DB: PostgreSQL-compatible service.
- Object storage: S3-compatible bucket, preferably Cloudflare R2 initially.
- Queue/cache: Redis-compatible service, preferably Upstash initially.
- Compute: CPU service plus isolated GPU workers.
- Streaming: WebRTC for interactive low-latency delivery, with HLS/DASH for compatibility when needed.
- Observability: OpenTelemetry-compatible traces/metrics/logs.

These are implementation defaults, not frozen vendor dependencies.

## 14. Key APIs/contracts

Minimum logical APIs:

- create/get media authorization policy;
- create/inspect media session;
- ingest source or source manifest;
- retrieve session processing state;
- subscribe to world-model events;
- request renderer/job;
- obtain playback manifest/session;
- retrieve generated highlight/render artifacts.

## 15. Evaluation architecture

The repository must maintain fixtures for:

- player detection;
- ball tracking;
- identity continuity;
- event extraction;
- commentary synchronization;
- SWM reconstruction;
- renderer temporal consistency;
- end-to-end latency.

Every major perception/rendering change should be benchmarked against fixed fixtures before release.
