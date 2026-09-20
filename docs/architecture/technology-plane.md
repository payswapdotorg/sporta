# Sporta Technology Plane

## Purpose

The Technology Plane contains replaceable implementation technologies used to turn authorized media into the Sports World Model and rendered outputs. It is deliberately separate from product/domain contracts.

## Technology object model

Every technology is represented by a versioned adapter profile:

```text
TechnologyProfile
├── technologyId
├── technologyVersion
├── adapterVersion
├── task
├── capabilities
├── inputContract
├── outputContract
├── resourceRequirements
├── executionRequirements
├── provenance
├── license
├── commercialUse
├── benchmarkProfile
├── failureClasses
└── status
```

`status` is one of:

- candidate
- benchmarked
- approved
- canary
- production
- deprecated
- rejected

A technology cannot enter production merely because it works on one example.

## Adapter families

### Perception adapters

- player/object detection;
- ball detection;
- pitch/camera calibration;
- jersey/team classification;
- player re-identification;
- optical/scene metadata.

### Tracking adapters

- multi-object tracking;
- ball tracking;
- identity continuity;
- occlusion handling.

### Intelligence adapters

- ASR;
- commentary segmentation;
- football-language interpretation;
- specialist event classifiers.

### Rendering adapters

- original media;
- tactical;
- game/3D;
- anime/stylized;
- future neural video synthesis.

### Execution adapters

- local CPU;
- local GPU;
- Modal;
- Lightning AI;
- RunPod;
- Vast.ai;
- Hugging Face/ZeroGPU for bounded experiments;
- future providers.

## Replacement and fusion

The runtime must support four promotion patterns:

1. **replacement** — candidate supersedes an existing implementation;
2. **ensemble** — multiple candidates jointly produce evidence or output;
3. **cascade** — a cheap/general candidate filters work before an expensive/specialist candidate;
4. **fallback** — a secondary implementation takes over when the primary is unavailable or outside its supported envelope.

The SWM and product APIs must remain unchanged across these patterns.

## Benchmark contract

Every adapter must be executable against the canonical Sporta benchmark fixture set.

Each benchmark result must contain:

```text
benchmarkId
technologyId
technologyVersion
adapterVersion
fixtureSetVersion
metrics
resourceUsage
runtime
costEstimate
failureSummary
reproducibility
licenseCheck
```

Metrics are task-specific but share common dimensions where applicable:

- quality/accuracy;
- temporal stability;
- identity continuity;
- geometry/camera correctness;
- latency;
- throughput;
- compute resources;
- failure rate;
- cost;
- determinism.

## Promotion lifecycle

```text
candidate
  ↓
compatibility check
  ↓
license/security check
  ↓
benchmark
  ↓
comparison
  ↓
shadow evaluation
  ↓
canary
  ↓
approved / rejected
  ↓
production profile
```

A new technology may remain registered and benchmarked without becoming the production implementation.

## Logical task profiles

The current expanded task-profile catalog is defined in `docs/contracts/technology-task-profiles.md`. It includes soccer detection/tracking, event/commentary intelligence, geometry/camera reconstruction, neural re-camera and character/video generation. This catalog is additive to the existing adapter families and does not introduce model-specific domain dependencies.

## Configuration

Product/domain code refers to logical task profiles, not technology names.

Example:

```text
profile: football.playerTracking.default

preferred:
  - tracker-profile-A

fallback:
  - tracker-profile-B

minimum:
  identityContinuity >= threshold
  pitchCoverage >= threshold
```

The runtime resolves that profile through the Technology Registry.

## License policy

Technology registration must record the exact license for code, model/checkpoint, dataset, weights, and any bundled assets where applicable. Code and model license checks are separate because permissive code licensing does not automatically make a model/checkpoint commercially usable.

A technology with unresolved commercial-use status cannot be promoted to production.
