/**
 * Internal helpers of the W605 scene-evaluation package: a JSON-safe deep
 * equality (object-key-order-insensitive, array-order-sensitive — the
 * document-comparison authority for every block-level check) and a deep
 * clone. Pure, dependency-free, deterministic.
 */

/**
 * Deep equality over JSON-safe values. Objects compare KEY-SET-wise
 * (insertion order is irrelevant — a re-serialized document is equal);
 * arrays compare element-wise IN ORDER (order is semantic); `undefined`
 * and absent are equal ONLY to each other; numbers compare by `===` (the
 * renderer's outputs are exact same-arithmetic values — no epsilon: an
 * epsilon here would mask real drift, the opposite of this package's job).
 */
export function deepEqualJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) {
    return false;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (!deepEqualJson(a[i], b[i])) return false;
    }
    return true;
  }
  const aKeys = Object.keys(a as Record<string, unknown>);
  const bKeys = Object.keys(b as Record<string, unknown>);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    if (
      !deepEqualJson(
        (a as Record<string, unknown>)[key],
        (b as Record<string, unknown>)[key],
      )
    ) {
      return false;
    }
  }
  return true;
}

/** A deep clone over JSON-safe values (fresh objects, inputs never shared). */
export function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Renders a JSON-safe value for a finding (bounded: never longer than
 * 240 chars — evidence, not a payload dump).
 */
export function describeValue(value: unknown): string {
  const text = JSON.stringify(value) ?? String(value);
  return text.length > 240 ? `${text.slice(0, 237)}...` : text;
}
