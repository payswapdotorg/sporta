# @sporta/spatial-state

Spatial state estimation (work item **W206**): fuses W204's image-space
player **tracks**, W203's per-frame camera **calibration**, and W103's
timeline **clocks** into the SWM-facing spatial observation stream — player
positions in canonical PITCH space (meters), time-aligned to the session
timeline (milliseconds), with honest confidence fusion. Owner: AI
(Worker A). Dependencies: W203 (`@sporta/field-mapping`) ✓, W204
(`@sporta/perception-tracking`) ✓, W103 (`@sporta/timeline`) ✓.

## Scope boundary

W204 tracks players in IMAGE space; W203 maps image -> pitch; W103 maps
frame-native time -> session timeline. This package FUSES the three and
emits the result — no new detection, no new calibration, no new
synchronization, and **no velocity** (velocity is W205's ball-state concern
/ later fusion). The emitted `TrackPayload.position` carries pitch METERS
in the unitless `Point2D` slot (tech-lead decision): **pitch space is now
the canonical spatial frame for SWM ingestion**; the image-space ancestors
remain in the W204/W201 streams (and in W203's corner observations), so no
information is lost.

## Module map

- `src/state.ts` — `estimateSpatialState(frames, options?): SpatialStateSeries`
- `src/align.ts` — `alignSessionMs(clock, presentationMs): number`,
  `ensureSpatialMonotonic(points): SpatialStatePoint[]`
- `src/observe.ts` — `emitSpatialObservations(input): Observation[]`,
  `validateObservation(obs): boolean`
- `src/benchmark.ts` — `runSpatialBenchmark(specs): SpatialBenchmarkReport[]`

## The estimator's documented rules

- **Projection**: per frame, the W203 projector is solved once from the
  frame's corner set and each tracked box's CENTER (`x + w/2`, `y + h/2`)
  is projected into canonical pitch meters. Out-of-pitch results keep their
  TRUE coordinates with `inBounds: false` — flagged, NEVER clamped
  (architecture-lock §4). Degenerate camera geometry surfaces W203's typed
  errors unchanged.
- **Time alignment**: `presentationMs` is SOURCE time on the video track's
  own clock; the W103 affine `TrackClock` maps it to `sessionMs`
  (measured drift or the identity fallback; default
  `identityClock("video")`).
- **Confidence fusion — explicit, no inflation**: `"min"` (default, the
  bottleneck is honest) or `"product"` of the track confidence and the
  corner-set confidence; the raw values are preserved VERBATIM in
  `sourceConfidences` so downstream can re-fuse differently. The
  combination choice is a pure function of the options — callers should
  record which mode they requested (the series shape is frozen by the W206
  interface contract and does not embed it).
- **Determinism**: no RNG, no clock reads, no I/O. Frames are processed in
  ARRAY order; `points` are sorted by (`sessionMs`, `trackId`, `frameId`) —
  a total order, so the same inputs always produce a deep-equal output.
- **Identity**: W204 track ids pass through untouched (`trackId` on every
  point); the optional `label` passthrough exists so emission can map
  label -> entity kind via W204's `FOOTBALL_LABEL_KINDS` (the brief
  sanctions carrying the label through the fusion; the point's other fields
  are exactly the W206 interface contract).

## Emission (SWM-facing)

`emitSpatialObservations` emits one contract `Observation` per fused point:

- `observationId = "sp-<frameId>-<trackId>"` (a repeated pair in a
  hand-built series appends `-<index>` so ids never collide);
- `eventTimeMs = sessionMs` — the SESSION timeline. This differs from
  W201/W203/W204's frame-native `presentationMs` convention: those streams
  are pre-alignment perception, this one is the time-aligned fused product
  the SWM ingests (the W206 accept criterion made visible in the stream);
- `provenance: "DERIVED"` — the projection is inference from OBSERVED
  corners + OBSERVED tracks; emitting it as OBSERVED would be invented
  certainty (architecture-lock §4). `modality: "vision"`;
- `confidence`: the fused confidence, passthrough;
- `payload`: `{ kind: "track", entityId: trackId, position: pitch meters }`
  — NO velocity key, ever;
- `subjectEntityRefs`: `FOOTBALL_LABEL_KINDS[label]` when the label maps
  (e.g. `"player" -> "participant"`); `[]` for an unmapped label (identity
  is never guessed); the documented `participant` default for label-less
  points — exact `LocalEntityRef` shape (`entityId` + `kind` only);
- `schemaVersion` from the contracts constants; `ingestTimeMs` deliberately
  unset (wall-clock time belongs to the pipeline; this package is
  deterministic).

`ingestTimeMs` and wall-clock concerns aside, the emitted records append
directly to `@sporta/observation` stores (validated on append there).

## Benchmark

`runSpatialBenchmark` runs, per scenario: `generateFixtureFrames` (W204)
-> `detectionsFromGroundTruth` (W204) -> `GreedyIouTracker` (W204,
default options) -> `FixtureFieldCalibrator` (W203) ->
`estimateSpatialState` (W206) -> metrics. Identity switches reuse W204's
`runTrackingBenchmark` verbatim (walk semantics; for these fixtures equal
to the sum over objects of distinct-ids-minus-one). Metrics: `frames`,
`points`, `outOfBounds`, `maxPerFrameJump` (meters, between a track's
consecutive points in session order), `meanConfidence`,
`identitySwitches`, `coverage` (points / visible ground-truth entries).
Pure and deterministic — the same specs always produce deep-equal reports.

Documented scenario deviations from the brief's type sketch (all optional,
all required by the brief's own accept scenarios — mirroring W204's
documented `size` deviation): `players[].size` (default 0.2 x 0.2 — W204
fixture specs require extents), `panSweep` (the slow 0.4 -> 0.6 pan sweep
the accept scenario demands), `sceneCutFrames` (the cut-at-frame-70
scenario), and `motion` typed as `FixtureTrackSpec["motion"]` (W204 does
not re-export `MotionSpec`; the indexed access is the identical type).

## Testing

`bun test` from the repository root (or this package) runs
`test/*.test.ts`: identity-camera projection math (hand-derived exact
values), time alignment (identity and affine clocks, monotonic re-stamping),
confidence fusion (min/product/bottleneck, raw provenance), inBounds
honesty (out-of-play flagged and unclamped), the 120-frame pan-sweep
accept scenario (time-aligned, smooth, stable identity, lossless,
deterministic), the scene-cut scenario (fresh ids, still time-aligned), and
contract-valid emission (zod parsing, DERIVED provenance, session-time
event stamps, entity refs, no velocity). No `Math.random`, no `Date.now`
(docs/testing/HARNESS.md).
