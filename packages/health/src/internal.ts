/**
 * Internal shared helpers for @sporta/health — not exported from the barrel.
 *
 * `canonicalJson` is the determinism primitive behind every artifact this
 * package renders (the dashboard definition, the alert evaluation input
 * summary): a recursive serializer that sorts object keys, so two
 * structurally-equal values ALWAYS serialize to identical bytes regardless of
 * the key-insertion order they were built with. Byte-stable artifacts are a
 * test-pinned contract (docs/observability/PRODUCTION.md §7).
 */

/** Fail-loud guard for non-empty strings used as ids/names. */
export function assertNonEmptyString(value: string, what: string): void {
  if (typeof value !== "string" || value.length < 1) {
    throw new RangeError(`${what} must be a non-empty string (got ${String(value)})`);
  }
}

/** Fail-loud guard for finite, non-negative numbers (thresholds, values). */
export function assertNonNegativeFinite(value: number, what: string): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new RangeError(`${what} must be a finite non-negative number (got ${String(value)})`);
  }
}

/**
 * Serializes `value` to canonical JSON bytes: object keys sorted ascending,
 * arrays kept in order, no insignificant whitespace. Structurally-equal
 * inputs produce byte-identical output — the property the dashboard
 * determinism tests pin.
 */
export function canonicalJson(value: unknown): string {
  return serializeCanonical(value);
}

function serializeCanonical(value: unknown): string {
  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value) ?? "null";
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    const items = value.map((item) => serializeCanonical(item));
    return `[${items.join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    const parts: string[] = [];
    for (const key of keys) {
      const serialized = serializeCanonical(record[key]);
      if (serialized === undefined) continue; // matches JSON.stringify: undefined drops
      parts.push(`${JSON.stringify(key)}:${serialized}`);
    }
    return `{${parts.join(",")}}`;
  }
  // undefined / functions / symbols / bigint: JSON.stringify would fail or
  // drop — fail loud instead of inventing a representation.
  throw new TypeError(
    `canonicalJson cannot serialize a ${String(typeof value)} (artifacts must be JSON-safe)`,
  );
}
