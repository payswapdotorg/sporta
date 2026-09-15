/**
 * The fixture-based demo inputs — the release evaluation's default scope.
 *
 * The demo run composes the REAL fixtures of the two completed evaluation
 * packages (this package owns no fixture of its own):
 *
 * - temporal stability: `renderW503CleanFixture()` — the W503 clean clip
 *   (session `sess-anime-clip`), rendered through the REAL
 *   `@sporta/renderer-anime` seam, manifest + SVG frames (so the
 *   byte-level style stability measurement is on);
 * - scene correctness: the three W605 fixtures — `clean-match`
 *   (`sess-w605-clean`), `corrections-match` (`sess-w605-corr`), and
 *   `directed-review` (the corrections timeline through the full W604
 *   chain, plan riding with the input) — under the source package's own
 *   fixture names (its README's fixture table).
 *
 * The human-review record is NOT read here: it is caller-supplied data
 * (the CLI and the tests read the checked-in
 * `fixtures/human-review/self-check-record.json`), keeping `src` free of
 * I/O — `evaluateReleaseReadiness` stays a pure function of its input.
 */
import { renderW503CleanFixture } from "@sporta/renderer-evaluation";
import {
  buildCleanMatchFixture,
  buildCorrectionsMatchFixture,
  buildDirectedReviewFixture,
} from "@sporta/scene-evaluation";
import type { ReleaseGateInput } from "./report";
import type { SceneFixtureCase } from "./sceneGate";

/** The names of the demo fixture set (the source packages' own names). */
export const TEMPORAL_FIXTURE_CASE_NAME = "w503-clean-fixture";

/** Builds the scene fixture cases of the demo run (fresh, through the real seams). */
function buildSceneFixtureCases(): SceneFixtureCase[] {
  const directed = buildDirectedReviewFixture();
  return [
    { name: "clean-match", input: { ...buildCleanMatchFixture() } },
    { name: "corrections-match", input: { ...buildCorrectionsMatchFixture() } },
    { name: "directed-review", input: { ...directed.input } },
  ];
}

/**
 * Builds the default (fixture-demo) release-gate input. Pure and
 * deterministic (the fixture builders are the source packages' own pure
 * builders); the caller supplies the human-review record value.
 */
export function buildDefaultReleaseInputs(options: {
  readonly humanReview?: unknown;
}): ReleaseGateInput {
  const temporal = renderW503CleanFixture();
  return {
    temporal: { input: { manifest: temporal.manifest, frames: temporal.frames } },
    scene: buildSceneFixtureCases(),
    humanReview: options.humanReview,
  };
}
