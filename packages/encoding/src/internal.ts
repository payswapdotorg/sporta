/**
 * Internal helpers of the encoding package (the camera-director
 * `internal.ts` convention — deliberately NOT exported from the package
 * barrel). No clock, no RNG; the only side-effecting helpers are the
 * byte-hashers (pure functions of their input).
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
export function isNonEmptyString(value: unknown): value is string {
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

/** sha-256 of bytes, as 64 lowercase hex digits (the repo-wide convention). */
export function sha256Of(bytes: Uint8Array): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(bytes);
  return hasher.digest("hex");
}

/** FNV-1a 32-bit over a UTF-8 string (the repo's stable identity hash). */
export function fnv1a32(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * The identity-derived manifest id: `enc-<fnv1a32-hex8>` (the W504
 * segmentId / tactical artifactId precedent — identity-derived, NOT
 * content-derived, so a re-encode of the same render identity with
 * different bytes is a visible difference, never a silent merge).
 */
export function encodedManifestIdOf(identity: string): string {
  return `enc-${fnv1a32(identity).toString(16).padStart(8, "0")}`;
}

/** Structural deep clone for JSON-safe documents. */
export function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
