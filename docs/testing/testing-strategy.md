# Sporta Testing Strategy

## Test layers

### Unit
Validate domain logic, schema validation, timeline arithmetic, confidence/provenance handling, state transitions, renderer configuration validation, and rights-policy checks.

### Contract
Validate compatibility between producers/consumers for media, observations, events, SWM, renderer, and streaming contracts.

### Integration
Exercise ingestion -> normalization, audio/video synchronization, perception adapters, commentary adapters, fusion, storage, queues, renderer workers, and delivery.

### End-to-end
Use fixed authorized fixtures to verify the full pipeline from media input to playable output.

### ML evaluation
Track task-specific metrics rather than relying on a single generic score:

- object detection precision/recall;
- ball tracking accuracy/continuity;
- player identity continuity;
- field mapping error;
- commentary event extraction precision/recall;
- event timing error;
- SWM state accuracy;
- renderer temporal consistency;
- output artifact validity.

### Performance
Measure p50/p95/p99 where meaningful for each stage. Record throughput, GPU/CPU utilization, queue depth, memory use, dropped/degraded frames, and end-to-end latency.

## Golden fixtures

Fixtures must be rights-cleared or synthetic. They should cover stable camera, cuts, zooms, occlusion, crowded scenes, fast ball motion, goals, commentary excitement, silence, clock/score changes, and adverse input conditions.

## Determinism policy

Perception and generative models may be nondeterministic. Tests should distinguish exact deterministic contracts from statistical evaluation. Fixed seeds/model versions and tolerances are required for comparable ML benchmarks.

## Release gate

No release may rely solely on visual inspection. The release candidate must pass automated validation plus a documented human-quality review of representative fixtures.
