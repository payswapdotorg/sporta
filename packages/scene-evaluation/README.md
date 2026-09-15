# @sporta/scene-evaluation — W605 3D output evaluation

The W605 acceptance criterion (docs/work-items/work-items.md):

> correctness of score, clock, player identity continuity, event ordering,
> and scene state is benchmarked.

This package is that benchmark: a **standalone six-axis correctness
evaluation** (the W503 `renderer-evaluation` posture — harness integration is
not required for acceptance and is out of scope) over the REAL public seams of
the W601–W604 pipeline. It re-implements nothing: every expectation is
derived through the renderer's own exported functions
(`statusLine`, `stableAvatarStyle`, `interpolateMatchFrame`,
`sceneCutHeldProvenance`, `resolve3dFrame`, `eventChipText`) or against the
SWM's own documents (`projectScene`, the engine's event log), and every
fixture is built end-to-end through the real seams (`WorldModelEngine` +
`stateAt` + `projectScene` + `render3dMatch` / `direct` +
`render3dDirectedMatch`).

## What is measured

| axis | definition | primary surfaces |
| --- | --- | --- |
| **score** | the score the output claims, per frame and per step, is exactly the SWM's | HUD status line vs `statusLine(authoritative scoreClock)`; step score blocks vs the W601 projection of the ground-truth snapshot |
| **clock** | the clock/period/stoppage the output claims is exactly the SWM's, and it advances ONLY at snapshot boundaries | same combined claim; mid-segment claim-change discipline; step clock blocks |
| **identity continuity** | every color property of an entity is a pure function of `(styleKey, entityId)` — constant, correct, and never swapped | recorded tokens vs recomputed `stableAvatarStyle`; temporal stability; cross-entity swap signature; kind/style-kind stability |
| **event ordering** | markers preserve the SWM's log order, land at their timeline positions, carry verbatim fields, and are TOTALLY accounted per window (displayed / skipped-with-reason / boundary-transferred) | markers vs the engine's event stream, the steps' marker windows, and the renderer's own chip-cap derivation |
| **scene state** | every per-frame entity entry is the renderer's own `resolve3dFrame` over the frame's authoritative scene (positions never invented, dispositions accounted, inferred/held provenance justified by the motion model, ball z only when carried) | full-entry field comparison; the W603 frame-plan contract including declared-cut justification; possession |
| **direction** (the directed half) | a directed rundown presents exactly the plan's windows: the right slot in force per frame, canonical camera geometry, review windows at the review profile, and the plan's decision records verbatim | HUD camera labels, realized camera blocks (geometry + `FOCAL_PX`/`NEAR_PLANE_METERS`), `REVIEW_OUTPUT_PROFILE`, plan window/provenance comparison |

A seventh measurement layer — **source truth** — pins the render's INPUT: every
step's scene must be the REAL W601 projection of that step's ground-truth
SWM snapshot (captured at construction time through the real `stateAt` seam,
because the engine's football state has no history).

## Verdicts

Every threshold is ZERO (see [THRESHOLDS.md](./THRESHOLDS.md) for the full
derivation, pinned row-for-row to the code by
`test/thresholds-doc.test.ts`): the renderer under evaluation is a
deterministic pure function of its inputs, so any nonzero defect count is a
real defect, never noise. The verdict is the strict conjunction of all 44
checks across the seven dimension verdicts. Evidence counters (frames
checked, entity-frame pairs, token frames, boundary crossings) report the
measurement base and never credit a pass. Findings are bounded at 200 with
accounted truncation.

## Fixture inventory

All fixtures are deterministic builders checked into `src/fixture.ts` (the
W503 convention — no serialized artifacts; determinism is pinned by tests).
All run on the injected clock domain (`TEST_EPOCH_MS`,
2025-01-06T12:00:00.000Z — no wall clock anywhere).

| fixture | builder | story | sample sizes |
| --- | --- | --- | --- |
| clean-match | `buildCleanMatchFixture()` | 4 steps (t=1000..4000), 5 entities, 3 events, stable 0-0 score, advancing clock; `render3dMatch` at the 5 fps animated profile | 16 frames, 3 markers, 80 entity-frame comparisons |
| corrections-match | `buildCorrectionsMatchFixture()` | 8 steps (t=1000..8000): keeper disposition change at a boundary, ball height gap mid-timeline, velocity-bound teleport, substitute appearing (never interpolated into existence), score 0-0 → 1-0 provisional → confirmed, possession change, stoppage, an event CORRECTION (`correctionOf`), an unknown-taxonomy event, a two-marker frame, a boundary-exact marker, a declared scene cut into the last step | 36 frames, 9 markers, ~237 positioned entity-frame comparisons |
| directed-review | `buildDirectedReviewFixture()` | the SAME 8-step timeline through the full W604 chain: commentary → `extractEventCandidates` → `direct(DEFAULT_DIRECTOR_POLICY)` → `render3dDirectedMatch`; 3 live windows (2 cuts, possession-follow + event-focus), 1 replay-emphasis REVIEW window, one boundary-transferred marker; the plan rides with the input | 62 frames, 4 windows, 9 markers |

## Re-running

```bash
cd packages/scene-evaluation
bun run typecheck   # tsc --noEmit (zero errors)
bun test            # the suite (run twice — byte-identical reports)
bun run evaluate    # regenerate every report + the detection proof, print VERDICT lines
```

The CLI exits 0 (all fixtures PASS + all injections detected), 1 (a clean
fixture FAILED), or 2 (an injection went undetected). Its stdout is a pure
function of the fixtures: the same input yields byte-identical output (pinned
by `test/report.test.ts`).

## Report shape

`evaluateSceneOutput(input)` returns a machine-readable report
(`REPORT_SCHEMA_TAG = "sporta/scene-evaluation/w605@1"`, validated against its
own zod schema before returning): input identity, the seven metric documents,
per-dimension verdicts, the conjunctive verdict with every check's measured
value, and the bounded findings list. Reports are byte-deterministic: two
evaluations of the same input serialize identically (pinned on bytes).

## Honest boundaries

- **SWM-is-ground-truth scope.** Correctness is evaluated against the SWM's
  OWN claims — the SWM is ground truth by program definition; if the SWM is
  wrong, that is an upstream (W006) defect, not a rendering one.
- **Disposition-vocabulary expressiveness.** Identity continuity is evaluated
  within the W603 disposition vocabulary: officials and the ball dress by
  fixed constants with no identity token; their continuity is measured as
  kind/style-kind stability plus the scene-state full-entry comparison.
- **Direction axis per W604 plan.** The direction axis evaluates the plan's
  declared semantics — re-presentation (slots, cuts, review windows, verbatim
  decision records) — not cinematic quality. The plan's OWN semantic
  self-consistency is W604's `checkCameraPlan` job; this package measures the
  manifest's AGREEMENT with the plan.
- **Visual quality is W803's territory.** Human-perceived quality is out of
  scope; the SVG frame documents are validated for count and determinism but
  never pixel-compared. Broadcast-pixel comparison is explicitly out of
  scope — the render is game-style presentation from the SWM, never a
  reconstruction of broadcast pixels.
- **Injected clock domain.** Everything runs on the injected clock
  (`TEST_EPOCH_MS`); no wall clock, RNG, or I/O participates in any
  measurement (the package source is scanned clean by its own conventions and
  tests).
- **Two documented replications.** The renderer does not export the
  style-kind mapping or the provenance overlay as functions, so
  `expectedStyleKind` and `applyExpectedProvenance` replicate them from the
  renderer's documented behavior — pinned against the real renderer's output
  on every fixture frame by `test/fixture.test.ts`.
- **Sample sizes per axis per fixture** are listed in the fixture inventory
  above; they are small, hand-verifiable timelines (the W503 posture), not
  production-scale corpora.

## Package boundary

Runtime dependencies: `@sporta/contracts`, `@sporta/scene-projection`,
`@sporta/renderer-3d`, `@sporta/camera-director`,
`@sporta/commentary-understanding` (fixtures only), `@sporta/temporal`
(fixtures only), `@sporta/world-model` (fixtures only), `@sporta/testing`
(fixtures only), and `zod` (the report schema). Every import of another
package goes through its public `index.ts`; no `src/**` reach-throughs, no
proprietary assets (G7).
