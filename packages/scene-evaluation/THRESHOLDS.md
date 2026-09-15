# W605 Threshold Contract

**Package:** `@sporta/scene-evaluation` (`packages/scene-evaluation`) — the W605
3D-output correctness benchmark. The canonical reference is the executable
`THRESHOLDS` object in `src/report.ts`.

This document mirrors the executable thresholds: the value table in §4 is
pinned row-for-row to the code by `test/thresholds-doc.test.ts` — a change to
either side without the other fails the test suite (fail loud, no silent
drift; the W403 TOLERANCE.md / W503 THRESHOLDS.md convention).

The work item (docs/work-items/work-items.md §W605): *"correctness of score,
clock, player identity continuity, event ordering, and scene state is
benchmarked."* It is executed as: a six-axis measurement core over the REAL
W601–W604 seams (score, clock, identity continuity, event ordering, scene
state, direction consistency — the directed half of scene-state correctness),
three deterministic fixtures exercising the seams end-to-end, and an
injected-defect detection proof (`test/detection.test.ts`) that rejects any
metric unable to detect its defect class.

## §1 Policy

1. **Every threshold is ZERO.** The renderer under evaluation is a
   deterministic pure function of its input documents (the W602/W603/W604
   posture — no clock reads, no RNG, no I/O), so any nonzero defect count —
   one wrong score claim, one swapped style token, one unaccounted marker —
   is a real defect, never noise. Thresholds are never tuned to make a
   failing fixture pass.
2. **Evidence counters are not thresholds.** The measurement base (frames
   checked, entity-frame pairs compared, token frames, boundary crossings,
   marker counts) is REPORTED, never credited toward a pass.
3. **Malformed is not defective.** Structural malformation of an input
   document throws a typed `SceneEvaluationError` with a JSON path before any
   measurement; measured defects never throw — they are counted and drive
   the verdict.
4. **The verdict is conjunctive.** PASS iff every check passes; no partial
   credit, no per-dimension averaging. Per-dimension verdicts are reported
   for diagnosis.
5. **Every check carries its evidence.** Each check reports its measured
   value; every defect count has a bounded finding trail (truncation beyond
   `MAX_FINDINGS = 200` is counted into the report, never silent).
6. **One numerical tolerance only.** The interpolated-timestamp re-derivation
   uses `INTERPOLATION_TIME_EPSILON_MS = 1e-6` (floating-point headroom for
   pure arithmetic over whole-millisecond plans — four orders below the
   smallest honest cadence step). Every other comparison is exact.
7. **Gaps are honest.** Entities without positions, markers outside render
   windows, and dropped boundary-tail frames are ACCOUNTED (dispositions,
   skip reasons, transfer accounting) — an unaccounted absence is itself a
   defect.

## §2 What the metrics measure

| family | source | defect classes |
| --- | --- | --- |
| sourceTruth | every step's scene vs the REAL W601 `projectScene` of its ground-truth snapshot | score/clock/possession/entity/block drift between the render's input and the SWM's own documents |
| score + clock | per-frame HUD status line vs the renderer's own `statusLine` over the frame's authoritative scene; claim discipline within segments | wrong score/clock/period/stoppage claims; a clock ticked by frame time |
| identity | recorded style tokens vs the renderer's own `stableAvatarStyle(styleKey, entityId)`; temporal and cross-entity stability | wrong/diverging tokens, two-entity swaps, kind or style-kind changes |
| ordering | markers vs the SWM's event stream, the steps' marker windows, and the renderer's own chip-cap derivation; per-window total accounting | field drift, misordering, duplicates, unaccounted or novel markers |
| sceneState | per-frame entity entries vs the renderer's own `resolve3dFrame` over the expected scene (positions, dispositions, provenance, possession); interpolation claims vs the W603 frame-plan contract | invented positions, unjustified held/interpolated claims, entity set drift |
| direction | camera slots, labels, realized camera blocks, and the W604 plan's decision records | wrong slot in force, non-canonical camera geometry, plan divergence |

## §3 The zero-threshold derivation

- **Count metrics (36 constants):** each counts occurrences of a defect class
  whose correct value is exactly 0 on a correct renderer — the expectation is
  derived through the renderer's OWN public seams (`statusLine`,
  `stableAvatarStyle`, `interpolateMatchFrame`, `sceneCutHeldProvenance`,
  `resolve3dFrame`, `eventChipText`/`MAX_EVENT_CHIPS`, the canonical W601
  camera slots, `FOCAL_PX`/`NEAR_PLANE_METERS`, `REVIEW_OUTPUT_PROFILE`) or
  against the SWM's own documents (`projectScene`, the engine's event log).
  Any nonzero occurrence indicts either the renderer's output or its input
  documents — both are W605's subject.
- **Sanctioned-restyle accounting (1 constant):** the only sanctioned restyle
  moment is a rendererVersion change, and within one output the version is
  immutable — so `MAX_SANCTIONED_RESTYLE_COUNT = 0` by construction; the
  counter is computed and reported (never asserted away) so a divergence is
  visible.
- **Plan-consistency metrics (2 constants):** the W604 composition contract
  copies windows and director provenance VERBATIM from the plan; any drift
  (window kind/source/slot/decision, provenance/summary) is a composition
  defect.
- **Claim-advance discipline (1 constant):** the W603 contract pins clock and
  score display state to snapshot boundaries — within one authority segment
  (same from-step, same directed window) the claim is constant, so
  mid-segment changes are exactly 0 on a correct renderer.

## §4 The threshold table (code-pinned, order-preserving)

Every row lists ALL metric paths the constant governs (three constants are
shared by two dimensions each — the combined status-line claim indicts both
score and clock). The `check` column is `<metric paths> <= <value>`.

| constant | value | check | rationale |
| --- | --- | --- | --- |
| MAX_STEP_SCORE_MISMATCH_COUNT | 0 | sourceTruth.stepScoreMismatchCount, score.stepScoreMismatchCount <= 0 | a step's scene score block is the SWM projection's, verbatim |
| MAX_STEP_CLOCK_MISMATCH_COUNT | 0 | sourceTruth.stepClockMismatchCount, clock.stepClockMismatchCount <= 0 | a step's scene clock block is the SWM projection's, verbatim |
| MAX_STEP_POSSESSION_MISMATCH_COUNT | 0 | sourceTruth.stepPossessionMismatchCount <= 0 | a step's scene possession block is the SWM projection's, verbatim |
| MAX_STEP_ENTITY_STATE_MISMATCH_COUNT | 0 | sourceTruth.stepEntityStateMismatchCount <= 0 | every entity, kind, version, disposition, position is the projection's |
| MAX_STEP_SCENE_BLOCK_MISMATCH_COUNT | 0 | sourceTruth.stepSceneBlockMismatchCount <= 0 | source/world/schema/session/camera-slot blocks are the projection's |
| MAX_FRAME_CLAIM_MISMATCH_COUNT | 0 | score.frameClaimMismatchCount, clock.frameClaimMismatchCount <= 0 | the HUD status line is the renderer's own template over the authoritative scene |
| MAX_MID_SEGMENT_CLAIM_CHANGE_COUNT | 0 | clock.midSegmentClaimChangeCount <= 0 | clock/score display state advances only at snapshot boundaries |
| MAX_STYLE_TOKEN_DIVERGENCE_COUNT | 0 | identity.styleTokenDivergenceCount <= 0 | the recorded token equals the recomputed stableAvatarStyle(styleKey, entityId) |
| MAX_STYLE_TOKEN_INSTABILITY_COUNT | 0 | identity.styleTokenInstabilityCount <= 0 | an entity's token is constant across the whole rundown |
| MAX_ENTITY_IDENTITY_SWAP_COUNT | 0 | identity.entityIdentitySwapCount <= 0 | a token matching another entity's expectation is a swap |
| MAX_ENTITY_KIND_CHANGE_COUNT | 0 | identity.entityKindChangeCount <= 0 | an entity entry never becomes a different entity |
| MAX_ENTITY_STYLE_KIND_CHANGE_COUNT | 0 | identity.entityStyleKindChangeCount <= 0 | the style kind is a pure function of kind + disposition |
| MAX_SANCTIONED_RESTYLE_COUNT | 0 | identity.sanctionedRestyleCount <= 0 | the rendererVersion is immutable within one output |
| MAX_STEP_MARKER_LOG_ORDER_VIOLATION_COUNT | 0 | ordering.stepMarkerLogOrderViolationCount <= 0 | each step's marker sequences ascend in engine log order |
| MAX_FRAME_MARKER_ORDER_VIOLATION_COUNT | 0 | ordering.frameMarkerOrderViolationCount <= 0 | a frame's markers follow the marker-union (source) order |
| MAX_MARKER_FIELD_MISMATCH_COUNT | 0 | ordering.markerFieldMismatchCount <= 0 | marker fields are the SWM stream entry's, verbatim |
| MAX_MARKER_WINDOW_CONTAINMENT_VIOLATION_COUNT | 0 | ordering.markerWindowContainmentViolationCount <= 0 | a marker lands in the frame whose window contains its event time |
| MAX_MARKER_DUPLICATE_DISPLAY_COUNT | 0 | ordering.markerDuplicateDisplayCount <= 0 | a sequence is presented at most once per window |
| MAX_MARKER_CROSS_WINDOW_DUPLICATE_COUNT | 0 | ordering.markerCrossWindowDuplicateCount <= 0 | a sequence is live-presented at most once per rundown |
| MAX_MARKER_UNACCOUNTED_COUNT | 0 | ordering.markerUnaccountedCount <= 0 | every union sequence is displayed, skipped, or transferred |
| MAX_BOUNDARY_TRANSFER_UNACCOUNTED_COUNT | 0 | ordering.boundaryTransferUnaccountedCount <= 0 | a boundary-transferred marker is re-presented by a later window |
| MAX_REVIEW_NOVEL_MARKER_COUNT | 0 | ordering.reviewNovelMarkerCount <= 0 | a review re-presents; it never invents |
| MAX_MARKER_NOT_IN_UNION_DISPLAY_COUNT | 0 | ordering.markerNotInUnionDisplayCount <= 0 | a displayed sequence is carried by the window's own steps |
| MAX_MARKER_DISPLAY_ACCOUNTING_MISMATCH_COUNT | 0 | ordering.markerDisplayAccountingMismatchCount <= 0 | displayed/chips/notDisplayed/applied match the chip-cap derivation |
| MAX_MARKER_SKIP_ACCOUNTING_MISMATCH_COUNT | 0 | ordering.markerSkipAccountingMismatchCount <= 0 | skipped entries are in-union with the correct before/after reason |
| MAX_FRAME_INTERPOLATION_MISMATCH_COUNT | 0 | sceneState.frameInterpolationMismatchCount <= 0 | interpolation claims follow the W603 frame-plan contract, cuts declared |
| MAX_INTERPOLATION_INDEX_MISMATCH_COUNT | 0 | sceneState.interpolationIndexMismatchCount <= 0 | the recorded step pair resolves to the recorded atMs values |
| MAX_FRAME_ENTITY_SET_MISMATCH_COUNT | 0 | sceneState.frameEntitySetMismatchCount <= 0 | the rendered entity id set is the expected scene's, never invented or dropped |
| MAX_FRAME_ENTITY_STATE_MISMATCH_COUNT | 0 | sceneState.frameEntityStateMismatchCount <= 0 | every entity entry field is the resolve3dFrame expectation's |
| MAX_DISPOSITION_MISMATCH_COUNT | 0 | sceneState.dispositionMismatchCount <= 0 | scene and render dispositions are the vocabulary's correct values |
| MAX_POSITION_MISMATCH_COUNT | 0 | sceneState.positionMismatchCount <= 0 | TRUE positions are never invented |
| MAX_PROVENANCE_MISMATCH_COUNT | 0 | sceneState.provenanceMismatchCount <= 0 | inferred/held marks and held reasons are the motion model's own |
| MAX_BALL_HEIGHT_MISMATCH_COUNT | 0 | sceneState.ballHeightMismatchCount <= 0 | the ball's z exists exactly when the height slot is carried |
| MAX_POSSESSION_MISMATCH_COUNT | 0 | sceneState.possessionMismatchCount <= 0 | the possession accounting is the resolve3dFrame expectation's |
| MAX_FRAME_SLOT_MISMATCH_COUNT | 0 | direction.frameSlotMismatchCount <= 0 | a directed frame's own slot equals its window's |
| MAX_FRAME_CAMERA_LABEL_MISMATCH_COUNT | 0 | direction.frameCameraLabelMismatchCount <= 0 | the HUD camera label is the template over the slot in force |
| MAX_WINDOW_SLOT_NOT_CARRIED_COUNT | 0 | direction.windowSlotNotCarriedCount <= 0 | a window's slot is one of the steps' carried canonical slots |
| MAX_WINDOW_CAMERA_BLOCK_MISMATCH_COUNT | 0 | direction.windowCameraBlockMismatchCount <= 0 | the realized camera block is the canonical slot geometry plus the renderer constants |
| MAX_REVIEW_PROFILE_MISMATCH_COUNT | 0 | direction.reviewProfileMismatchCount <= 0 | review windows render at REVIEW_OUTPUT_PROFILE |
| MAX_PLAN_WINDOW_MISMATCH_COUNT | 0 | direction.planWindowMismatchCount <= 0 | the manifest's windows match the plan's, verbatim |
| MAX_PLAN_PROVENANCE_MISMATCH_COUNT | 0 | direction.planProvenanceMismatchCount <= 0 | the director provenance block matches the plan, verbatim |

## §5 Evaluation flow and exit codes

1. `evaluateSceneOutput(input)` validates the input (typed errors on
   malformation), derives every frame's expectation through the renderer's
   own seams, measures the six axes + the source-truth layer, and assembles
   the conjunctive verdict with the bounded findings list.
2. `bun run evaluate` (scripts/evaluate.ts) rebuilds every checked-in fixture
   through the real seams, prints every check with its measured value and a
   `VERDICT <fixture>: PASS|FAIL` line per fixture, then runs the
   detection proof.
3. Exit codes: `0` = every fixture PASSes and every injection is detected;
   `1` = a clean fixture FAILED; `2` = some injection went undetected.

## §6 Honest limitations

- Correctness is evaluated against the SWM's OWN claims — the SWM is ground
  truth by program definition (W006); a wrong SWM is upstream's defect.
- Identity continuity is evaluated within the disposition vocabulary's
  expressiveness: officials and the ball dress by fixed constants (no
  identity token to swap), and their continuity is measured as kind/style
  stability plus full-entry scene-state comparison.
- The direction axis evaluates the W604 plan's declared semantics
  (re-presentation: slots, cuts, review windows, verbatim decision records),
  not cinematic quality.
- Human-perceived visual quality is W803's territory; the SVG frame bytes
  are validated for count and determinism but not pixel-compared, and
  broadcast-pixel comparison is explicitly out of scope.
- Everything runs on the injected-clock domain (`TEST_EPOCH_MS`); no wall
  clock, RNG, or I/O participates in any measurement.
- The per-frame marker accounting re-derivation trusts the renderer's
  documented chip-cap rule (`MAX_EVENT_CHIPS`); a renderer that changed the
  rule without changing the constant would need a constant bump to be
  caught here.
- The two derived mappings the renderer does not export as functions
  (`expectedStyleKind`, the `applyEntityProvenance` overlay in
  sceneState) are replicated from the renderer's documented behavior and
  pinned against the real renderer's output on every fixture frame by
  `test/fixture.test.ts`.
