# Sporta MVP Reality Engine — Tech Lead Handoff

You are the implementation Tech Lead/Orchestrator for `payswapdotorg/sporta`.

The repository is the sole source of truth. The architecture lock remains frozen. Read it before any implementation.

## Mission

Turn Sporta from a strong engineering foundation into a genuinely demonstrable MVP:

> Upload a real authorized football MP4 -> reconstruct the event -> produce actual Original, Tactical, 3D Game and Anime/NPR video outputs -> play them in Sporta -> switch realities for the same match.

Do not optimize for another large set of engineering-only completion checkboxes. Optimize for this customer-visible result.

## Required reading

1. `AGENTS.md`
2. `docs/architecture/architecture-lock.md`
3. `docs/architecture/architecture.md`
4. `docs/architecture/technology-plane.md`
5. `docs/architecture/compute-broker.md`
6. `docs/architecture/ux-architecture.md`
7. `docs/architecture/deployment-architecture.md`
8. `docs/adr/ADR-009-mvp-reality-engine-and-technology-neutrality.md`
9. `docs/roadmap/mvp-reality-engine-roadmap.md`
10. `docs/work-items/mvp-reality-engine-work-items.md`
11. `docs/status/mvp-reality-engine-status.md`
12. `docs/testing/ux-operational-simulation.md`
13. existing SWM, renderer, compute, control-api and viewer contracts relevant to each slice

## Frozen strategic decisions

### 1. Preserve the SWM

The existing SWM remains canonical. Do not replace it with a renderer-specific state model.

### 2. Technology neutrality is mandatory

No product/domain contract may depend directly on a concrete model, tracker, renderer, engine or GPU provider.

Use versioned adapters and the Technology Registry.

### 3. Continuous evaluation

Every serious candidate technology must be benchmarkable against the same fixtures and metrics. The system must support replacement, ensemble, cascade and fallback strategies.

### 4. Real video is the MVP artifact

Animated SVG remains a useful diagnostic/engineering representation. It is not the primary MVP output.

The MVP player must play actual video files.

### 5. Game-engine rendering

Use a real game-engine adapter. Godot 4 is the initial candidate implementation for 3D and Anime/NPR rendering, but Godot is itself replaceable behind the renderer contract.

### 6. Anime strategy

The MVP Anime reality should use deterministic/non-photorealistic 3D rendering first. Neural video-to-video is a later upgrade, not a dependency for MVP completion.

### 7. Compute strategy

Use the Compute Broker.

Initial provider adapters:

- Modal;
- Lightning AI;
- RunPod;
- local/self-hosted GPU;
- Hugging Face/ZeroGPU only for bounded experimental workloads.

Do not hard-code any provider into Create Studio or render jobs.

### 8. User-owned compute

Build a Compute Connection Center inside Sporta.

The user should be able to:

- use Sporta compute;
- connect a Modal account;
- connect a Lightning AI account;
- connect a RunPod account;
- connect another future provider;
- use a local worker.

Use OAuth/authorization surfaces where providers support them. Otherwise use narrowly scoped API credentials. Never request provider master passwords.

The compute selection UX should ask what the user wants — low cost, speed, quality, use my GPU, etc. — rather than forcing the user to understand GPU infrastructure.

## Provider strategy

Modal is the initial free/low-cost development candidate.

Lightning is the alternate free-development candidate.

RunPod is the initial user-owned/pay-as-you-go candidate and a future managed provider.

The exact provider is not architecturally privileged and must remain replaceable.

## Technology evaluation

Every candidate must expose:

- capabilities;
- resource requirements;
- license/commercial-use metadata;
- benchmark identity;
- failure semantics;
- version/provenance.

Benchmarks must evaluate the relevant task dimensions, including quality, temporal stability, identity continuity, geometry, latency, throughput, resource requirements, cost, failure rate and determinism.

Do not promote technology because it looks good on one clip.

## Three-worker execution

### Worker A — Perception / reconstruction

Own:

`R001-R005, R201-R208`

Primary concern:

```text
real football MP4
 -> player detection
 -> ball detection
 -> tracking/ReID
 -> pitch calibration
 -> team/identity
 -> SWM
```

Use open-source football reconstruction research where it materially reduces risk, subject to license/model review. Candidate references include TrackLab, SoccerNet Game State Reconstruction and SoccerTrack v2. Do not copy incompatible code or introduce license violations.

### Worker B — Media / platform / compute

Own:

`R101-R104, R401-R409`

Primary concern:

```text
real browser upload
 -> R2
 -> normalization
 -> job queue
 -> Compute Broker
 -> GPU worker
 -> artifact persistence
```

### Worker C — Rendering / product experience

Own:

`R301-R307, R501-R507`

Primary concern:

```text
SWM
 -> tactical MP4
 -> Godot 3D MP4
 -> Godot Anime/NPR MP4
 -> HTML5 video
 -> Reality Switcher
```

## Parallelization rules

Shared contracts are frozen before parallel implementation.

Do not let workers concurrently redefine:

- SWM contracts;
- ComputeRequest / ComputeJob contracts;
- renderer contracts;
- artifact manifests;
- upload/session APIs.

Worker A may proceed on technology adapters while Worker B builds the compute/media boundary only after the shared adapter contracts are locked.

Worker C can build renderer adapters against the frozen SWM/output contracts without waiting for the final production model implementation.

## Required product-quality correction

The current web app contains deliberate fixture/in-process/SVG boundaries. Do not hide them.

Replace them only when the corresponding real path exists.

No fake upload.

No fake processing.

No fake progress.

No fake GPU execution.

No SVG artifact presented as production video.

No claim of a renderer that has not actually produced a playable artifact.

## MVP golden path

The final acceptance test is:

```text
fresh browser
  -> Create
  -> upload authorized football.mp4
  -> rights declaration
  -> choose compute
  -> processing
  -> Original MP4
  -> Tactical MP4
  -> 3D MP4
  -> Anime MP4
  -> Watch
  -> Reality Switcher
  -> same match/session throughout
```

Then repeat with a materially different clip.

## MVP gate

R601-R605 must pass.

The final human visual review must confirm:

1. the artifacts are actual video;
2. the four realities are genuinely visually different;
3. all realities clearly correspond to the same underlying football event;
4. score/clock/event ordering and major player/ball movement are preserved within the declared MVP envelope;
5. the system works from a clean browser without developer intervention.

Only after this gate passes should the repository describe Sporta as MVP-complete.
