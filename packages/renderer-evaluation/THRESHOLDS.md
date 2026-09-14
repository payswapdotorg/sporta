# W503 Threshold Contract

**The documented thresholds of the W503 temporal consistency evaluation.**
`@sporta/renderer-evaluation` · canonical reference:
`packages/renderer-evaluation/src/thresholds.ts` (`THRESHOLDS`).

This document mirrors the executable thresholds: the value table in §4 is
pinned row-for-row to the code by `test/thresholds-doc.test.ts` — a change to
either side without the other fails the test suite (fail loud, no silent
drift; the W403 TOLERANCE.md convention).

The accept criterion of work item W503 — *"identity flicker, geometry drift,
and temporal artifacts are measured on fixtures"* — is executed by:

- the **measurement core** (`src/identity.ts`, `src/drift.ts`,
  `src/artifacts.ts`): pure functions over the W502 clip manifest
  (`AnimeRenderOutput.manifest`), plus byte-level marker style stability when
  the SVG frames are supplied;
- the **clean fixture** (`src/fixture.ts` `renderW503CleanFixture`): the W502
  fixture clip replicated in this package and driven through the REAL
  renderer (`renderAnimeClip`) — it must PASS every threshold below, with the
  measured values pinned by tests;
- the **detection proof** (`test/detection.test.ts`, `scripts/evaluate.ts`):
  one injector per defect class; every injected defect must flip the verdict
  to FAIL. A metric that cannot detect its defect class is rejected.

## 1. Policy

1. **Zero-defect thresholds for deterministic renderers.** The evaluated
   renderer (W502) is a pure function of its SWM inputs — no RNG, no clock.
   An unexplained identity absence, a changing style token, a duplicate event
   attribution, a watermark regression, or a flapping disposition therefore
   has no innocent cause: every count threshold is 0 and every stability
   ratio is 1.0. Thresholds are never tuned to make a failing fixture pass
   (the fix is upstream determinism or a documented, reviewed threshold
   change with a physical or semantic derivation).
2. **Physical bounds for geometry drift.** The only non-trivial thresholds
   are the drift bound parameters (§3): displacement plausibility is derived
   from documented physical ceilings, not from observed fixture values.
3. **Justified omissions are never defects.** The W502 dispositions
   `omitted-no-position`, `omitted-invalid-position`, `omitted-out-of-play`,
   and `not-rendered-kind` are honest accounting (architecture-lock §4:
   explicit uncertainty, never invented). A drawn→justified-omission
   transition is NOT identity flicker; a justified-omission frame is a GAP in
   the geometry series (accounted, never interpolated); a changing style
   token is only measurable on frames that carry one.
4. **Malformed ≠ defective.** Structural malformation (missing fields,
   non-monotone frame timestamps, unknown dispositions, non-finite positions)
   is a fail-loud `TemporalEvaluationError` with the JSON path
   (`src/validate.ts`) — the evaluator never measures over a manifest it
   cannot trust, and never silently skips. Defects (this document) are
   measured, counted, and drive the verdict.
5. **Verdict is conjunctive.** PASS requires every check to pass; there is no
   partial credit, no weighting, no score. One defect class, one failing
   check, verdict FAIL.
6. **Every check is evidence.** The report lists every check with its
   measured value (`ThresholdCheck`) — passing checks are reported with their
   measured values too, not just a boolean.
7. **Gaps are honest.** An entity missing a recorded position on a frame
   breaks its geometry series; the next pair is measured over the FULL
   elapsed time against the FULL-time bound (endpoint measurement — no
   interpolation), the pair is flagged `spansGap`, and the missing frames are
   counted (`gapFrameCount`). Nothing is ever silently interpolated.

## 2. What the metrics measure (summary)

| family | source | defect classes |
|---|---|---|
| identity | `manifest.frames[i].entities[*]` | unexplained absence (entity recorded at N, absent at N+1 — W502 records EVERY snapshot entity per frame, so absence is unexplained); identity flicker (drawn at N, absent at N+1); style instability (manifest style token changes across frames; byte-level marker-group instability across SVG frames) |
| geometry | `manifest.frames[i].entities[*].positionMeters` | drift jumps: consecutive recorded positions whose displacement exceeds the kind's physical bound over the elapsed output time |
| artifacts | `frames[i].windowMs`, `frames[i].source.watermark`, `frames[i].appliedEventSequences`, `frames[i].captions`, `frames[i].entities[*].disposition`, `frames[i].possession`, `watermarkAfter`, `skippedEvents` | inverted or overlapping caption windows; windows not starting at the frame timestamp; captioned-but-unapplied events; applied-but-unaccounted events; duplicate attribution; unsorted or gapped applied sequences; watermark sequence/time regressions; watermarkAfter below the consumed event stream (R6 breach); drawn-omitted-drawn flapping; kind changes; possession ring without its drawn entity |

## 3. The drift bound derivation

For each entity and each pair of consecutive RECORDED positions (frame i →
next recorded frame j):

```
displacement = hypot(xj − xi, yj − yi)            meters (true, unrounded)
Δt           = outputTimestampMs[j] − outputTimestampMs[i]   milliseconds
bound        = maxSpeed(kind) × (Δt / 1000) + POSITION_EPSILON_METERS
defect       = displacement > bound               (inclusive: at-bound passes)
```

- **PLAYER_MAX_SPEED_MPS = 12.5.** The fastest verified human sprint is
  Usain Bolt's 100 m world record (Berlin 2009): 9.58 s ⇒ 10.44 m/s average,
  with the fastest 10 m split around 12.4 m/s peak. No footballer has ever
  been timed faster. A participant whose AVERAGE speed over an interval
  exceeds 12.5 m/s is physically impossible, not merely unusual — the bound
  is derived from the human ceiling, not from fixture data.
- **BALL_MAX_SPEED_MPS = 40.** Reliably measured professional shot speeds
  peak around 130-140 km/h (36.1-38.9 m/s). 40 m/s (144 km/h) covers every
  reliably-measured struck-ball speed with headroom. Claimed extremes above
  this exist in unofficial records; they are not reliably measured and are
  an accepted limitation (§6).
- **POSITION_EPSILON_METERS = 0.01.** Numerical-safety headroom, not a
  semantic tolerance: the renderer's own serialization rounds canvas
  coordinates to 2 decimals (1 cm at the documented scale of 10 SVG units
  per meter), and the manifest's true meters pass through affine transforms
  whose double rounding is far below 1 cm. The epsilon absorbs such
  numerical noise while being 3 orders of magnitude below the smallest
  plausible displacement the fixtures exercise (0.5 m) — it can never mask a
  real jump.
- The bound SCALES with the elapsed time, so a pair measured across a gap
  (frames without a recorded position between the endpoints) is judged
  against the FULL elapsed time: honest endpoint measurement, never
  interpolation, never a gap-masked teleport (a teleport across a gap that
  exceeds the full-time bound is still caught; one that does not exceed it
  is honestly unprovable from the endpoints alone).
- Non-ball kinds (participant and any other kind that happens to carry a
  position) use the player bound — the conservative (lower) ceiling.

## 4. The threshold table (code-pinned, order-preserving)

| constant | value | check | rationale |
|---|---|---|---|
| MAX_UNEXPLAINED_ABSENCE_COUNT | 0 | identity.unexplainedAbsenceCount <= 0 | the W502 accounting contract records EVERY snapshot entity in EVERY frame — an entity id that vanishes from a frame's entity list is unexplained under any disposition history |
| MAX_IDENTITY_FLICKER_COUNT | 0 | identity.flickerCount <= 0 | an entity drawn at frame N and absent at N+1 is the visual pop-out the product calls identity flicker — zero is the only honest budget for a deterministic renderer |
| MIN_STYLE_STABILITY_RATIO | 1 | identity.styleStabilityRatio >= 1 | the W502 style token is a pure function of (entityId, rendererVersion) — any frame whose token deviates from the entity's modal token is a styling defect; vacuously 1.0 when an entity never carries a token |
| MIN_STYLE_BYTE_STABILITY_RATIO | 1 | styleBytes.stabilityRatio >= 1 | the marker GROUP bytes (geometry and confidence-opacity stripped) must be identical for one entity across frames — measured counterpart of W502's byte-identity proof; checked only when SVG frames are supplied |
| PLAYER_MAX_SPEED_MPS | 12.5 | bound parameter | documented physical ceiling, see §3 |
| BALL_MAX_SPEED_MPS | 40 | bound parameter | documented physical ceiling, see §3 |
| POSITION_EPSILON_METERS | 0.01 | bound parameter | numerical-safety headroom, see §3 |
| MAX_GEOMETRY_JUMP_COUNT | 0 | geometry.jumpCount <= 0 | a single physically-implausible displacement is a geometry drift defect — zero tolerance |
| MAX_GEOMETRY_JUMP_RATIO | 1 | geometry.maxJumpRatio <= 1 | the same defect seen as a ratio: displacement over bound; 1.0 means exactly at the bound (inclusive pass) |
| MAX_WINDOW_OVERLAP_COUNT | 0 | artifacts.windowOverlapCount <= 0 | frame windows tile the output timeline without overlap in both W502 render paths — an overlap means one frame's captions claim another frame's time |
| MAX_INVERTED_WINDOW_COUNT | 0 | artifacts.invertedWindowCount <= 0 | a window with startMs >= endMs covers no time and breaks every caption attribution invariant |
| MAX_WINDOW_TIMESTAMP_MISMATCH_COUNT | 0 | artifacts.windowTimestampMismatchCount <= 0 | both W502 paths construct windows that start exactly at the frame's output timestamp — a mismatch desynchronizes the caption window from the frame timeline |
| MAX_CAPTION_DUPLICATE_COUNT | 0 | artifacts.captionDuplicateCount <= 0 | one event consumed by two frames captions the same event twice — a temporal artifact in the output |
| MAX_CAPTION_UNAPPLIED_COUNT | 0 | artifacts.captionUnappliedCount <= 0 | a displayed or accounted caption whose sequence is not in the frame's appliedEventSequences was shown without accounting |
| MAX_APPLIED_DUPLICATE_COUNT | 0 | artifacts.appliedDuplicateCount <= 0 | an event applied to more than one frame breaks the consumed-exactly-once semantics of the W502 event windows |
| MAX_APPLIED_UNSORTED_COUNT | 0 | artifacts.appliedUnsortedCount <= 0 | appliedEventSequences preserve the strictly-ascending input order in both W502 paths — non-ascending sequences indicate a re-sorted or corrupted attribution |
| MAX_APPLIED_GAP_COUNT | 0 | artifacts.appliedGapCount <= 0 | an event sequence strictly between two applied sequences that is neither applied nor accounted in skippedEvents was silently dropped |
| MAX_APPLIED_UNACCOUNTED_COUNT | 0 | artifacts.appliedUnaccountedCount <= 0 | an applied sequence in neither captions.events nor captions.uncaptionedEvents was consumed without caption accounting |
| MAX_WATERMARK_SEQUENCE_REGRESSION_COUNT | 0 | artifacts.watermarkSequenceRegressionCount <= 0 | a frame whose source watermark sequence is below the previous frame's means the render read the event log backwards |
| MAX_WATERMARK_TIME_REGRESSION_COUNT | 0 | artifacts.watermarkTimeRegressionCount <= 0 | a frame whose source watermark time is below the previous frame's means the render's provenance went backwards in match time |
| MAX_WATERMARK_BELOW_EVENTS_COUNT | 0 | artifacts.watermarkBelowEventsCount <= 0 | watermarkAfter.sequence must cover every applied or skipped event (R6: the consumer resumes from the watermark and must not re-consume) |
| MAX_DISPOSITION_FLAP_COUNT | 0 | artifacts.dispositionFlapCount <= 0 | drawn, omitted, drawn on three consecutive frames is the briefest visible identity oscillation; longer justified omissions are not flapping (documented limitation §6) |
| MAX_KIND_CHANGE_COUNT | 0 | artifacts.kindChangeCount <= 0 | the same entity id recorded with two kinds across frames is an identity-level inconsistency |
| MAX_POSSESSION_DISPLAY_MISMATCH_COUNT | 0 | artifacts.possessionDisplayMismatchCount <= 0 | a displayed possession ring requires its entity drawn in that frame — otherwise the ring floats without a marker |

## 5. Evaluation flow and exit codes

`evaluateTemporalConsistency({ manifest, frames? })` (or
`evaluateRenderOutput(output)`):

1. `validateManifest` — structural validation, fail-loud
   (`TemporalEvaluationError`, JSON path, code `manifest-malformed`);
2. `measureIdentityFlicker`, `measureGeometryDrift`,
   `measureTemporalArtifacts` (+ `measureStyleByteStability` when frames are
   supplied);
3. apply §4 thresholds (the conditional styleBytes check only when frames
   were supplied), build the report and the conjunctive verdict.

The CLI (`bun run evaluate` in this package) renders the clean fixture,
prints every check with its measured value, runs the detection proof over
every injected defect, and exits: 0 = PASS + all injections detected; 1 =
clean-fixture FAIL; 2 = some injection undetected.

## 6. Honest limitations

- **Applied-sequence gap detection inspects the interior of the applied
  range only.** An event dropped before the first applied sequence or after
  the last applied sequence leaves no manifest trace — the manifest records
  what was applied and what was explicitly skipped, never the input event
  stream itself — so prefix/suffix drops (and a correspondingly lying
  `provenance.lastEventSequence`) are unprovable from the manifest alone.
  Interior sequences strictly between applied ones that are neither applied
  nor skipped-accounted are detected.
- **Byte-level style stability is W502-serialization-specific.** It extracts
  `<g data-entity="…">` marker groups (the W502 SVG construction) and strips
  geometry (`cx`, `cy`, `x`, `y`) and confidence-driven `opacity` attributes.
  A future renderer with a different serialization would need its own
  extractor or would evaluate at the manifest-token level only (the token
  measurement is serialization-independent and always runs).
- **Flapping detects only the one-frame oscillation** (drawn, omitted,
  drawn). A longer justified omission that later reverses is a disposition
  transition (reported, not thresholded) — per-frame the omission is honest,
  and longer-range oscillation semantics would need a product decision.
- **Gap-masked teleports are honestly unprovable.** Across a gap (frames
  without a recorded position) only the endpoints are known; a displacement
  within the full-time physical bound cannot be distinguished from motion
  that happened during the gap. The evaluator reports the gap and judges the
  endpoints — never invents the middle.
- **Unexplained absence cannot distinguish renderer-drop from upstream
  track-loss.** A manifest-side absent entity id is an accounting breach
  (the W502 contract records every snapshot entity); an entity absent from
  the SNAPSHOT (upstream identity break) produces the identical manifest
  symptom. Both are reported as unexplained absence — the visual symptom is
  the same; root-cause triage is upstream (perception/tracking).
- **Ball speed above 40 m/s** (disputed unofficial records) would be flagged
  as drift; no reliably-measured match shot exceeds the bound.
- **The evaluation measures the manifest and the SVG frames, not the video
  stream.** W503 evaluates temporal consistency at the render-report level
  (the documented W502 seam); pixel-level video analysis is out of scope.
