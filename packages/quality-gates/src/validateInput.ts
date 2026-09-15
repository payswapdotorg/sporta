/**
 * The fail-loud validation of the CALLER's wrapper contract
 * (docs/GATES.md §fail-closed).
 *
 * Layering, kept honest and one-directional:
 *
 * - THIS module validates only what THIS package owns: the shape of
 *   `ReleaseGateInput` itself (unknown keys rejected, seams must be
 *   objects/arrays of the right shape, fixture-case names bounded).
 *   A violation is a caller bug and THROWS `QualityGatesError`
 *   (`input-malformed`, JSON path) — never coerced, never defaulted.
 * - The CONTENT behind each seam (a clip manifest, a scene fixture, a
 *   review record) is NOT re-validated here: the source packages' own
 *   fail-loud validation is the authority. A malformed manifest or
 *   fixture is caught by the gate runners and ACCOUNTED as a
 *   `NOT-RUNNABLE` gate (counted FAIL); a malformed review record is
 *   accounted by the inspector (PENDING-HUMAN-REVIEW). Nothing inside a
 *   seam ever throws out of `evaluateReleaseReadiness`.
 * - An absent seam is NOT a wrapper violation — it is an accounted
 *   `NOT-RUNNABLE` (a gate that could not run for missing input). Only a
 *   PRESENT-but-wrong seam throws here.
 */
import { structuralBound } from "./bounds";
import { QualityGatesError } from "./errors";

/** The allowed top-level keys of a `ReleaseGateInput`. */
const INPUT_KEYS: readonly string[] = ["temporal", "scene", "humanReview"];

/** Whether a value is a plain object (not null, not an array). */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Rejects unknown keys of one object against an allowlist (sorted, deterministic). */
function rejectUnknownKeys(
  value: Record<string, unknown>,
  path: string,
  allowed: readonly string[],
): void {
  for (const key of Object.keys(value).sort()) {
    if (!allowed.includes(key)) {
      throw new QualityGatesError(
        "input-malformed",
        `${path}.${key}`,
        `unknown key "${key}" (allowed: ${allowed.join(", ")})`,
      );
    }
  }
}

/**
 * Validates the release-gate input's wrapper shape. Throws
 * `QualityGatesError("input-malformed", path, message)` on the first
 * violation class it finds, with every check carrying its JSON path.
 */
export function validateReleaseGateInput(input: unknown): void {
  if (!isPlainObject(input)) {
    throw new QualityGatesError(
      "input-malformed",
      "$",
      `the release gate input must be an object (got ${typeof input})`,
    );
  }
  rejectUnknownKeys(input, "$", INPUT_KEYS);

  const temporal = input.temporal;
  if (temporal !== undefined) {
    if (!isPlainObject(temporal)) {
      throw new QualityGatesError(
        "input-malformed",
        "$.temporal",
        `the temporal seam must be an object (got ${typeof temporal})`,
      );
    }
    rejectUnknownKeys(temporal, "$.temporal", ["input"]);
    if (temporal.input === undefined) {
      throw new QualityGatesError(
        "input-malformed",
        "$.temporal.input",
        "required when the temporal seam is present (omit $.temporal entirely for an accounted NOT-RUNNABLE gate)",
      );
    }
    if (!isPlainObject(temporal.input)) {
      throw new QualityGatesError(
        "input-malformed",
        "$.temporal.input",
        `the temporal evaluation input must be an object (got ${typeof temporal.input}) — its manifest is validated by @sporta/renderer-evaluation`,
      );
    }
  }

  const scene = input.scene;
  if (scene !== undefined) {
    if (!Array.isArray(scene)) {
      throw new QualityGatesError(
        "input-malformed",
        "$.scene",
        `the scene seam must be an array of fixture cases (got ${typeof scene})`,
      );
    }
    scene.forEach((entry, index) => {
      const path = `$.scene[${index}]`;
      if (!isPlainObject(entry)) {
        throw new QualityGatesError(
          "input-malformed",
          path,
          `a scene fixture case must be an object (got ${typeof entry})`,
        );
      }
      rejectUnknownKeys(entry, path, ["name", "input"]);
      if (typeof entry.name !== "string" || entry.name.length === 0) {
        throw new QualityGatesError(
          "input-malformed",
          `${path}.name`,
          "a scene fixture case name must be a non-empty string",
        );
      }
      if (entry.name.length > structuralBound("MAX_FIXTURE_CASE_NAME_LENGTH")) {
        throw new QualityGatesError(
          "input-malformed",
          `${path}.name`,
          `the fixture case name exceeds the structural bound MAX_FIXTURE_CASE_NAME_LENGTH (${entry.name.length} > ${structuralBound("MAX_FIXTURE_CASE_NAME_LENGTH")} — docs/GATES.md §structural-bounds)`,
        );
      }
      if (entry.input === undefined) {
        throw new QualityGatesError(
          "input-malformed",
          `${path}.input`,
          "required on every scene fixture case",
        );
      }
      if (!isPlainObject(entry.input)) {
        throw new QualityGatesError(
          "input-malformed",
          `${path}.input`,
          `a scene evaluation input must be an object (got ${typeof entry.input}) — its content is validated by @sporta/scene-evaluation`,
        );
      }
    });
    if (scene.length === 0) {
      // Structurally fine, accounted by the gate as NOT-RUNNABLE (never a
      // wrapper throw — an empty fixture list is a missing-input case).
      return;
    }
  }

  // $.humanReview is deliberately NOT validated here: it is `unknown` by
  // contract, and its fail-closed inspection (missing / malformed /
  // incomplete → PENDING-HUMAN-REVIEW) is src/humanReview.ts's authority.
}
