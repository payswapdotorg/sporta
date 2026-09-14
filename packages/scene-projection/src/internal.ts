/**
 * Internal helpers shared by the scene-projection modules (deliberately NOT
 * exported from the package barrel). Everything here operates on JSON-safe
 * scene documents, so the helpers are simple and total — they never throw on
 * weird input, except `canonicalize`, which fails loud on non-finite numbers
 * (they have no canonical serialization).
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Deep equality over JSON-safe values: primitives by `===`, arrays element
 * wise, records key wise (same key set). `undefined` is compared by `===`
 * (an explicit `undefined` and an absent key are DIFFERENT under this
 * equality, which the canonical-form check relies on). NaN is not JSON and is
 * treated as unequal to itself.
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, index) => deepEqual(item, b[index]));
  }
  if (isRecord(a) && isRecord(b)) {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    return keysA.every((key) => key in b && deepEqual(a[key], b[key]));
  }
  return false;
}

/**
 * Structural deep clone for JSON-safe documents (scene entities, camera
 * slots, football display state). The projection always emits FRESH objects
 * so consumers can never mutate shared constants or the input snapshot.
 */
export function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Error message extraction that never throws on non-Error throwables. */
export function errMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A finite number (positions, heights, headings, confidences). */
export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Locates the first structural difference between two JSON-safe values and
 * returns it as a `$.path` string (with the leaf values), or `undefined`
 * when the values are deep-equal. Used by the conformance harness to report
 * PRECISE evidence instead of a bare deep-equal failure.
 */
export function firstDifference(
  expected: unknown,
  actual: unknown,
  path: string,
): string | undefined {
  if (deepEqual(expected, actual)) return undefined;
  if (Array.isArray(expected) && Array.isArray(actual)) {
    if (expected.length !== actual.length) {
      return `${path}: expected array length ${expected.length}, got ${actual.length}`;
    }
    for (let i = 0; i < expected.length; i += 1) {
      const found = firstDifference(expected[i], actual[i], `${path}[${i}]`);
      if (found !== undefined) return found;
    }
    return `${path}: arrays differ structurally`;
  }
  if (isRecord(expected) && isRecord(actual)) {
    for (const key of Object.keys(expected).sort()) {
      if (!(key in actual)) return `${path}.${key}: expected present, got absent`;
      const found = firstDifference(expected[key], actual[key], `${path}.${key}`);
      if (found !== undefined) return found;
    }
    for (const key of Object.keys(actual).sort()) {
      if (!(key in expected)) return `${path}.${key}: expected absent, got present`;
    }
    return `${path}: records differ structurally`;
  }
  return `${path}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;
}
