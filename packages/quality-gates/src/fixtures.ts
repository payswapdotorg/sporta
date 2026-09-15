/**
 * The W803 canonical release input — the fixture-based demo run's input
 * (the `src/fixture.ts` convention of W503/W605): the REAL fixtures of
 * the two completed evaluation packages, assembled into ONE release
 * evaluation input. Nothing is re-implemented or re-shaped here: every
 * document is produced by the source package's own real builder, through
 * the real renderer / engine / director seams (see those packages'
 * fixture modules for their construction rules — all pinned by their
 * tests: injected clocks, no RNG, byte-deterministic outputs).
 *
 * The human review record is NOT built here: it is a checked-in authored
 * document (`fixtures/human-review-self-check.json`, the automated
 * pipeline self-check record — docs/REVIEW.md §2/§5), read by the CLI and
 * the tests and passed in as data, keeping this module pure (no I/O).
 */
import { renderW503CleanFixture } from "@sporta/renderer-evaluation";
import {
  buildCleanMatchFixture,
  buildCorrectionsMatchFixture,
  buildDirectedReviewFixture,
} from "@sporta/scene-evaluation";
import type { ReleaseEvaluationInput } from "./input";

/** The temporal gate's canonical fixture: the real W503 clean clip (the W502 fixture clip through the real renderer). */
export const TEMPORAL_FIXTURE_ID = "w503-clean-clip";

/** The scene gate's canonical fixtures: the real W605 fixture set (match, corrections, directed rundown). */
export const SCENE_FIXTURE_IDS = {
  cleanMatch: "w605-clean-match",
  correctionsMatch: "w605-corrections-match",
  directedReview: "w605-directed-review",
} as const;

/**
 * Builds the canonical release evaluation input over the real fixtures:
 * the W503 clean clip (temporal gate) and all three W605 fixtures — the
 * clean match, the corrections timeline, and the directed rundown (the
 * directed fixture exercises the direction dimension and the
 * plan-consistency checks). Pure and deterministic: two calls yield
 * deep-equal documents (pinned by tests).
 *
 * @param humanReview the human review record document (the checked-in
 *   self-check record for the demo run; any record — or none — is valid
 *   input, and the gate accounts which it was).
 */
export function buildCanonicalReleaseInput(humanReview: unknown): ReleaseEvaluationInput {
  return {
    temporal: { fixture: TEMPORAL_FIXTURE_ID, output: renderW503CleanFixture() },
    scene: [
      { fixture: SCENE_FIXTURE_IDS.cleanMatch, input: buildCleanMatchFixture() },
      { fixture: SCENE_FIXTURE_IDS.correctionsMatch, input: buildCorrectionsMatchFixture() },
      { fixture: SCENE_FIXTURE_IDS.directedReview, input: buildDirectedReviewFixture().input },
    ],
    humanReview,
  };
}
