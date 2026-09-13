/**
 * Internal helpers shared by the renderer-contract modules (deliberately NOT
 * exported from the package barrel): JSON-space record detection, deep
 * equality and cloning for capability documents and output profiles, safe
 * error messages, and numeric coercion for capability fields.
 *
 * Everything here operates on JSON-safe data (the contract documents), so the
 * helpers can be simple and total — they never throw on weird input.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Error message extraction that never throws on non-Error throwables. */
export function errMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Structural deep clone for JSON-safe documents (capabilities, profiles). */
export function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Deep equality over JSON-safe values: primitives by `===`, arrays element
 * wise, records key wise (same key set). NaN is not JSON and is treated as
 * unequal to itself, which is the safe choice for contract documents.
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

/** Coerces a capability numeric field to a non-negative integer (0 fallback). */
export function clampNonNegativeInt(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}
