/**
 * Internal helpers of the camera director (deliberately NOT exported from
 * the package barrel — the scene-projection `internal.ts` convention).
 * Everything here is total over JSON-safe documents: no throws, no clock,
 * no RNG.
 */

/** A plain JSON record (not an array, not null). */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A finite number. */
export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** A non-empty string. */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** Human-readable type name for error messages (never throws). */
export function describeValue(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  if (isRecord(value)) return "an object";
  if (isFiniteNumber(value)) return `the number ${value}`;
  return `a ${typeof value}`;
}

/** A validated field reader: non-empty string or `undefined`. */
export function readNonEmptyString(value: unknown): string | undefined {
  return isNonEmptyString(value) ? value : undefined;
}

/** A validated field reader: finite number or `undefined`. */
export function readFiniteNumber(value: unknown): number | undefined {
  return isFiniteNumber(value) ? value : undefined;
}

/**
 * Structural deep clone for JSON-safe documents (fresh objects, so
 * consumers can never mutate the policy constants or input steps — the
 * W601 `projectScene` posture).
 */
export function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
