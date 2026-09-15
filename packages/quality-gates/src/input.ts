/**
 * The W803 RELEASE EVALUATION INPUT — the one document a release
 * evaluation consumes (the slo `input.ts` module map convention).
 *
 * The input carries, per gate, the documents the REAL evaluations consume:
 *
 * - `temporal` — one W502 render output (`AnimeRenderOutput`: manifest +
 *   frames), passed VERBATIM to `@sporta/renderer-evaluation`'s real
 *   `evaluateRenderOutput`, which validates it fail-loud;
 * - `scene` — a bounded list of named W605 evaluation inputs
 *   (`SceneEvaluationInput` documents), each passed VERBATIM to
 *   `@sporta/scene-evaluation`'s real `evaluateSceneOutput`, which
 *   validates them fail-loud;
 * - `humanReview` — the human review RECORD document (docs/REVIEW.md §3),
 *   validated by this package's own `validateHumanReviewRecord`, or
 *   absent (the accounted `record-missing` outcome).
 *
 * The gate-input fields are typed `unknown` ON PURPOSE (the W605
 * `SceneEvaluationInput` posture): the fields are externally provided
 * documents, and the REAL downstream evaluators validate them fail-loud
 * with their own typed errors — this package never re-validates, never
 * repairs, and never silently coerces them. A malformed document flows to
 * the real evaluator, whose typed error is caught, echoed verbatim, and
 * accounted as a `NOT_RUNNABLE` gate (which counts as FAIL) — never a
 * silent skip.
 *
 * Only the ENVELOPE structure (the keys and the fixture-name bounds below)
 * is validated here, fail-loud (`input-malformed`, with the JSON path).
 * The bounds are FORMAT bounds of the input schema, not quality
 * thresholds (GATES.md §7: this package defines zero quality thresholds).
 */
import { fail } from "./errors";
import { MAX_FIXTURE_NAME_LENGTH, MAX_SCENE_RUNS } from "./humanReview";

/** The temporal gate's input: one named W502 render output document. */
export interface TemporalGateInput {
  /** A stable fixture name (echoed into the report's run rows; bounded). */
  readonly fixture: string;
  /** The W502 render output (`AnimeRenderOutput`), validated by the real W503 evaluator. */
  readonly output: unknown;
}

/** One scene gate run: one named W605 evaluation input document. */
export interface SceneGateRunInput {
  /** A stable fixture name (echoed into the report's run rows; bounded). */
  readonly fixture: string;
  /** The W605 evaluation input (`SceneEvaluationInput`), validated by the real W605 evaluator. */
  readonly input: unknown;
}

/** The release evaluation input (the one document `evaluateReleaseReadiness` consumes). */
export interface ReleaseEvaluationInput {
  /** The temporal gate's input, or absent/null (the accounted `input-missing` outcome). */
  readonly temporal?: TemporalGateInput | null;
  /** The scene gate's runs (bounded), or absent/null (the accounted `input-missing` outcome). */
  readonly scene?: readonly SceneGateRunInput[] | null;
  /** The human review record document, or absent/null (the accounted `record-missing` outcome). */
  readonly humanReview?: unknown;
}

/** Structural check: is it a plain JSON object? */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Structural check: a fixture name (non-empty, bounded). */
function isFixtureName(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_FIXTURE_NAME_LENGTH;
}

/** Validates one `{ fixture, … }` gate-input object's shared shape. */
function validateFixtureEntry(
  value: unknown,
  path: string,
  documentKey: string,
): { fixture: string } {
  if (!isRecord(value)) {
    fail("input-malformed", path, `must be an object with a fixture name and a ${documentKey}`);
  }
  const keys = Object.keys(value);
  if (keys.length !== 2 || !keys.includes("fixture") || !keys.includes(documentKey)) {
    fail(
      "input-malformed",
      path,
      `must have exactly the keys {fixture, ${documentKey}} (got {${keys.join(", ")}})`,
    );
  }
  if (!isFixtureName(value.fixture)) {
    fail(
      "input-malformed",
      `${path}.fixture`,
      `must be a non-empty string of at most ${MAX_FIXTURE_NAME_LENGTH} characters`,
    );
  }
  return { fixture: value.fixture };
}

/**
 * Validates the release evaluation input's ENVELOPE structure (fail-loud
 * `input-malformed`, with the JSON path; unknown keys are rejected — no
 * silent extras). Returns the same document, typed. Absent (`undefined`)
 * or explicit `null` gate inputs are SHAPE-VALID: they are the accounted
 * `input-missing` / `record-missing` gate outcomes, never envelope errors.
 */
export function validateReleaseInputShape(input: unknown): ReleaseEvaluationInput {
  if (!isRecord(input)) {
    fail("input-malformed", "$", "the release evaluation input must be a JSON object");
  }
  for (const key of Object.keys(input)) {
    if (key !== "temporal" && key !== "scene" && key !== "humanReview") {
      fail(
        "input-malformed",
        `$.${key}`,
        "unknown input field (allowed: temporal, scene, humanReview)",
      );
    }
  }
  if (input.temporal !== undefined && input.temporal !== null) {
    validateFixtureEntry(input.temporal, "$.temporal", "output");
  }
  if (input.scene !== undefined && input.scene !== null) {
    if (!Array.isArray(input.scene)) {
      fail("input-malformed", "$.scene", "must be an array of scene gate runs");
    }
    if (input.scene.length > MAX_SCENE_RUNS) {
      fail(
        "input-malformed",
        "$.scene",
        `at most ${MAX_SCENE_RUNS} scene runs are allowed (got ${input.scene.length})`,
      );
    }
    input.scene.forEach((run, index) => {
      validateFixtureEntry(run, `$.scene[${index}]`, "input");
    });
  }
  return input as ReleaseEvaluationInput;
}
