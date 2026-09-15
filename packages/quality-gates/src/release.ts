/**
 * The W803 fixture-based demo run: the release evaluation over the repo's
 * REAL fixtures, composed through the REAL public seams of the two
 * completed evaluation packages (their own fixture builders — nothing is
 * re-implemented here):
 *
 * - temporal gate: W503's `renderW503CleanFixture()` — the canonical
 *   6-step anime clip (session `sess-anime-clip`), rendered by the real
 *   `renderAnimeClip` inside the source package, with its SVG frames
 *   supplied (enabling W503's byte-level style stability measurement);
 * - scene gate: W605's three fixtures — `buildCleanMatchFixture()`,
 *   `buildCorrectionsMatchFixture()` (the honest-discontinuity story),
 *   and `buildDirectedReviewFixture()` (the full W604 directed chain,
 *   with the plan riding along) — each evaluated by the real
 *   `evaluateSceneOutput`;
 * - human gate: the checked-in automated-pipeline SELF-CHECK record
 *   (`fixtures/human-review/w803-fixture-self-check.json`), read by the
 *   CLI/tests and passed in as data (src does no I/O — the record is a
 *   document, not a computation).
 *
 * The builders are PURE and deterministic (their source packages pin
 * byte-stability): two calls yield deep-equal inputs and byte-identical
 * release reports (pinned by `test/report.test.ts`).
 *
 * Boundary (docs/GATES.md §boundaries): this is the FIXTURE demo run.
 * It evaluates fixtures, never production traffic; the self-check record
 * is a pipeline self-check, not a human attestation.
 */
import { renderW503CleanFixture } from "@sporta/renderer-evaluation";
import {
  buildCleanMatchFixture,
  buildCorrectionsMatchFixture,
  buildDirectedReviewFixture,
} from "@sporta/scene-evaluation";
import type { SceneEvaluationFixture, SceneEvaluationInput } from "@sporta/scene-evaluation";
import type { ReleaseReadinessInput } from "./report";
import type { SceneGateInput, TemporalGateInput } from "./gates";

/** The demo temporal fixture's documented name. */
export const DEMO_TEMPORAL_FIXTURE = "w503-clean-clip";

/** The demo clean-match scene fixture's documented name. */
export const DEMO_SCENE_FIXTURE_CLEAN = "w605-clean-match";

/** The demo corrections-match scene fixture's documented name. */
export const DEMO_SCENE_FIXTURE_CORRECTIONS = "w605-corrections-match";

/** The demo directed-review scene fixture's documented name. */
export const DEMO_SCENE_FIXTURE_DIRECTED = "w605-directed-review";

/** The demo scene fixtures' documented names, in evaluation order. */
export const DEMO_SCENE_FIXTURES: readonly string[] = [
  DEMO_SCENE_FIXTURE_CLEAN,
  DEMO_SCENE_FIXTURE_CORRECTIONS,
  DEMO_SCENE_FIXTURE_DIRECTED,
];

/** The checked-in self-check record's path, relative to the package root. */
export const DEMO_HUMAN_REVIEW_RECORD_PATH = "fixtures/human-review/w803-fixture-self-check.json";

/** Reduces a W605 fixture to its evaluation input (the contract shape). */
function sceneInputOf(fixture: SceneEvaluationFixture): SceneEvaluationInput {
  return {
    snapshots: fixture.snapshots,
    eventStream: fixture.eventStream,
    steps: fixture.steps,
    output: fixture.output,
    ...(fixture.plan === undefined ? {} : { plan: fixture.plan }),
  };
}

/**
 * Builds the demo release-readiness input over the real fixtures. The
 * human-review record is a PARAMETER (data in, no I/O): the CLI and the
 * tests read the checked-in JSON document and pass it here.
 */
export function buildDemoReleaseInput(humanReviewRecord: unknown): ReleaseReadinessInput {
  const w503 = renderW503CleanFixture();
  const temporal: TemporalGateInput = {
    evaluations: [
      {
        name: DEMO_TEMPORAL_FIXTURE,
        input: { manifest: w503.manifest, frames: w503.frames },
      },
    ],
  };
  const scene: SceneGateInput = {
    evaluations: [
      { name: DEMO_SCENE_FIXTURE_CLEAN, input: sceneInputOf(buildCleanMatchFixture()) },
      {
        name: DEMO_SCENE_FIXTURE_CORRECTIONS,
        input: sceneInputOf(buildCorrectionsMatchFixture()),
      },
      {
        name: DEMO_SCENE_FIXTURE_DIRECTED,
        input: sceneInputOf(buildDirectedReviewFixture().input),
      },
    ],
  };
  return { temporal, scene, humanReview: humanReviewRecord };
}
