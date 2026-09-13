# @sporta/ball-state

Ball state estimation (work item **W205**): turns W202's per-frame ball
**tracks** into a ball **state series** — position + velocity + confidence
with honest gap semantics — and emits it as the SWM-facing ball observation
stream (`TrackPayload` with velocity). Owner: AI (Worker A). Dependencies:
W202 (`@sporta/ball-tracking`) ✓.

## Scope boundary

Positions stay in **image space** (normalized units, box centers — W202's
domain). Pitch-frame projection (homography) is W206/W401 territory and is
deliberately NOT touched here. The emitted `TrackPayload.position` therefore
carries image-space coordinates; the `Point2D` contract documents the frame
as "context-dependent, documented per payload kind", and this package
documents it here: **image space, box-center convention**.

## Module map

- `src/state.ts` — `estimateBallState(tracks, options): BallStateSeries`
- `src/observe.ts` — `emitBallStateObservations(input): Observation[]`,
  `validateObservation(obs): boolean`
- `src/benchmark.ts` — `runBallStateBenchmark(specs, options): BallStateBenchmarkReport[]`

## The estimator's documented rules

- **Merge** (deterministic): all tracks' points merge into one series
  ordered by `presentationMs` ascending; tie-break `frameId` then `trackId`
  (lexicographic ascending). W202 tracks are disjoint in time, so ties do
  not occur in pipeline data — the merge is well-defined regardless.
- **Position**: the track point's box center (`x + w/2`, `y + h/2`), image
  space. A track point without a box fails loud — a position is never
  invented.
- **Velocity** (honest): for point index `i`, velocity is defined IFF
  neighbors exist and `0 < t[i+1] - t[i-1] <= maxSpanMs` (default
  `2.5 * 1000 / fps`); then the centered difference
  `v = (p[i+1] - p[i-1]) / ((t[i+1] - t[i-1]) / 1000)` — **image-units per
  second** (times are milliseconds on the canonical media timeline). At
  series ends, across a gap jump wider than `maxSpanMs`, or on a degenerate
  zero span, velocity is **omitted** — never extrapolated, never
  zero-filled. Consecutive interpolated points inside a bridged gap DO get
  velocities when the span rule holds: linear interpolation ⇒ near-constant
  velocity, an honest consequence of the W202 bridging model.
- **Confidence** (passthrough verbatim): detected points keep the detector's
  confidence; interpolated points keep W202's exponential decay
  (`anchorConfidence * 0.5^ceil(gapElapsed/4)`). Never averaged, never
  bumped — no silent confidence collapse (architecture-lock §6).
- **Source** (passthrough): `detected` / `interpolated` survives into the
  state series.
- **Gap union**: all tracks' `occlusionGaps`, sorted by `fromMs`
  (ties: `toMs` ascending, then unbridged first); overlapping OR touching
  windows merge into one window `[min fromMs, max toMs]`; the merged
  window's `bridged` is the CONJUNCTION of its constituents — one unbridged
  constituent means part of the union lacks interpolation coverage, and the
  merged record must not overstate coverage.
- **Smoothing**: default `"none"` (pure passthrough). `"ema"` applies
  `EMA_0 = p_0; EMA_k = alpha * p_k + (1 - alpha) * EMA_{k-1}` to POSITION
  only, per coordinate, across the merged series (not reset at gaps); the
  centered velocity rule is then applied to the smoothed positions;
  confidence and source remain verbatim. `emaAlpha` must be in (0, 1) when
  `smoothing === "ema"` (typed `BallStateOptionsError` otherwise); any
  `emaAlpha` is ignored when smoothing is `"none"`.
- **Purity**: no RNG, no clock, no I/O — the same `(tracks, options)`
  always produce a deep-equal result.

## Emission (SWM-facing)

`emitBallStateObservations` emits one contract `Observation` per state point:

- `observationId = "bs-<frameId>"` (a repeated frameId in a hand-built
  series appends `-<index>` so ids never collide — cannot happen for
  estimator output);
- `eventTimeMs = presentationMs`, `modality: "vision"`;
- `provenance`: `detected → OBSERVED`, `interpolated → DERIVED` —
  interpolated state is inference, NOT observation; emitting it as OBSERVED
  would be invented certainty (architecture-lock §4);
- `confidence`: passthrough;
- `payload`: `{ kind: "track", entityId: "ball", position, velocity? }` —
  the `velocity` key is present ONLY when defined, never zero-filled;
- `subjectEntityRefs: [{ entityId: "ball", kind: "ball" }]` — the exact
  `LocalEntityRef` shape (`entityId` + `kind` only);
- `schemaVersion` from the contracts constants; `ingestTimeMs` is
  deliberately unset (wall-clock time belongs to the pipeline; this package
  is deterministic).

## Tech-lead decision: the canonical ball entity

`entityId: "ball"` is the canonical **session-scoped ball entity**. W202
track fragmentation (id switches) remains visible in each state point's
`trackId` field — conflict/identity evidence is never silently collapsed.
How to weigh that evidence during fusion is SWM territory (W401); the
observations themselves always reference the single canonical ball entity.

## Benchmark

`runBallStateBenchmark` runs, per scenario:
`generateScenarioFrames` (W202) → `NearestBoxBallTracker` (defaults) →
`estimateBallState` → compare against exact ground truth (matched by
frameId) and **analytic velocities** derived from the flight's closed form
(see `src/benchmark.ts` for the full derivation). Each spec's own `fps` is
used as the estimator's nominal cadence. Metrics: points, velocity
coverage, velocity/position RMSE, mean confidence, detected fraction, gap
count, bridged-gap fraction. Pure and deterministic — the same inputs always
produce deep-equal reports.

## Testing

`bun test` from the repository root (or this package) runs
`test/*.test.ts`: velocity exactness on clean linear flights, velocity
honesty across bridged/unbridged gaps (hand-computed index sets),
confidence honesty (verbatim decay, no inflation, monotone within gap
runs), smoothing (exact hand-computed EMA values), contract-valid emission
with provenance mapping and key-absence semantics, benchmark
accept-criterion proofs with hand-computed tight bounds, and determinism.
No `Math.random`, no `Date.now` (docs/testing/HARNESS.md).
