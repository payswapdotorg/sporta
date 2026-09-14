# @sporta/spatial-state

Spatial state estimation (work item **W206**): projects W204's image-space
player **tracks** through W203's per-frame camera calibration into
**pitch space** (canonical 105 x 68 m frame), time-aligned to the W103
session timeline, and emits the result as the SWM-facing spatial
observation stream (`TrackPayload`, pitch meters, NO velocity). Owner: AI
(Worker A). Dependencies: W203 (`@sporta/field-mapping`) ✓, W204
(`@sporta/perception-tracking`) ✓, W103 (`@sporta/timeline`) ✓.

Accept criterion (work-items.md): *player locations / projected
coordinates are time-aligned* — made visible in the emitted stream's
`eventTimeMs`, which is the point's SESSION time (not the frame-native
`presentationMs` the W201/W203/W204/W205 ancestors emit).

## Module map

- `src/state.ts` — `estimateSpatialState(frames, options):
  SpatialStateSeries` — the fusion core
- `src/align.ts` — `alignSessionMs(clock, presentationMs)` (the W103
  seam) and `ensureSpatialMonotonic(points)` (bounded-reorder re-stamping)
- `src/observe.ts` — `emitSpatialObservations(input): Observation[]`,
  `validateObservation(obs): boolean`
- `src/benchmark.ts` — `runSpatialBenchmark(scenarios):
  SpatialBenchmarkReport[]`, `buildSpatialScenarioFrames(scenario)`

## The fusion's documented rules

- **Per-frame calibration**: every `SpatialFrame` carries its own
  `FieldCornerSet`; `createPitchProjector` solves that frame's homography
  once (unsupported corner orders / degenerate geometry throw W203's typed
  errors — fail loud, never a silently wrong projection).
- **Position**: the tracked box CENTER (`box.x + box.w/2`,
  `box.y + box.h/2`) projected into pitch METERS. Out-of-pitch
  projections stay out-of-pitch: `inBounds` (0 <= x <= 105 AND
  0 <= y <= 68, inclusive, W203 semantics) is passed through VERBATIM and
  coordinates are NEVER clamped (architecture-lock §4 — out-of-play is a
  fact, not a clamped fiction).
- **Time**: the frame's `presentationMs` (SOURCE time on the video
  track's own clock) is mapped ONCE per frame through the W103 affine
  `TrackClock` (`sessionMs = presentationMs + offsetMs +
  presentationMs * driftPpm / 1e6`). Default clock: `identityClock("video")`
  (source === session — W103's honest fallback). Single-video output is
  already monotonic; `ensureSpatialMonotonic` re-stamps only multi-source
  fusions, using W103's `ensureMonotonic` semantics, purely.
- **Identity**: the W204 `trackId` passes through VERBATIM — never
  re-minted, never re-associated (re-identification across cuts/occlusions
  is W204-measured, later fusion's concern).
- **Confidence** (explicit, no inflation): `min` (default) or `product`
  of (track confidence, corner-set confidence); the RAW sources are
  preserved in `sourceConfidences` so downstream can re-fuse differently —
  the combination choice is recorded, never hidden. Out-of-range
  confidences fail loud.
- **Ordering**: frames processed in array order; points sorted by
  `(sessionMs, trackId)` with a stable sort.
- **Purity**: no RNG, no clock reads, no `Date.now`, no I/O — the same
  inputs always produce a deep-equal series.

## Emission (SWM-facing)

`emitSpatialObservations` emits one contract `Observation` per point:

- `observationId = "sp-<frameId>-<trackId>"` (unique while
  (frameId, trackId) pairs are — always true for single-video estimator
  output);
- `eventTimeMs = point.sessionMs` — the SESSION timeline (the W206
  difference from the frame-native ancestors); `ingestTimeMs` deliberately
  unset (deterministic package, no clock reads);
- `provenance: "DERIVED"` — a pitch position is INFERENCE from OBSERVED
  corners + OBSERVED tracks; OBSERVED would be invented certainty
  (architecture-lock §4). The image-space ancestors remain in the
  W201/W204 streams;
- `confidence`: the fused value, passthrough;
- `payload`: `{ kind: "track", entityId: trackId, position: pitch meters }`
  — pitch-space is now the canonical spatial frame for SWM ingestion (TL
  decision; the unitless `Point2D` slot is documented per payload kind) —
  and NO `velocity` key (W205 ball-state / later fusion own velocity);
- `subjectEntityRefs`: exactly `{ entityId, kind }` (the contracts
  `LocalEntityRef` shape) from W204's `FOOTBALL_LABEL_KINDS` via the label
  carried on each point; unmapped label -> `[]` (no invented kind);
  label-less hand-built points default to `"participant"`.

## Benchmark

`runSpatialBenchmark` runs, per scenario: W204 `generateFixtureFrames` ->
per frame W203 `FixtureFieldCalibrator` corner set + W204
`GreedyIouTracker` boxes -> `estimateSpatialState` -> report. Metrics:
frames, points, outOfBounds, maxPerFrameJump (max pitch distance any
track moves between consecutive points, meters), meanConfidence,
identitySwitches, coverage. Identity metrics are delegated VERBATIM to
W204's `runTrackingBenchmark`; coverage is matched / total GT entries.

Scenario sketch fields are the work-item brief's; two documented OPTIONAL
extensions exist because the brief's own acceptance tests require them:
`panTo` (camera pan sweep `pan -> panTo` across the frames, the
per-frame-calibration path) and `sceneCutFrames` (hard cut markers,
W204 semantics: fresh track ids after the cut). `MotionSpec` is derived
TYPE-ONLY from W204's exported `FixtureTrackSpec` (perception-tracking
does not re-export it — same type, no extra dependency). Scenario players
get `BENCHMARK_PLAYER_SIZE` (0.1 x 0.1) boxes; `buildSpatialScenarioFrames`
is exported so tests can inspect the series the report summarizes.

## Testing

`bun test` from the repository root (or this package) runs
`test/*.test.ts`: bit-exact identity-camera projection math, W103 clock
alignment (identity + affine slope 1.001/offset +50) and monotonicity
semantics, confidence fusion (min/product, sources preserved),
out-of-play honesty (raw unclamped coordinates, bit-identical to the W203
projector), the 120-frame pan-sweep fusion end-to-end accept proof
(strictly increasing session time, < 3 m per-frame jumps, stable ids,
coverage 1, deep-equal reruns), scene-cut handling (fresh ids, timeline
survives, exact outOfBounds), and contract-valid emission (zod-parse,
DERIVED provenance, session-time eventTimeMs, no velocity, store- and
builder-interop). No `Math.random`, no `Date.now`
(docs/testing/HARNESS.md).
