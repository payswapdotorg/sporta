/**
 * Stable content hashing for lab record identities (REL-001..003).
 *
 * Scenario ids, run ids, fault-schedule ids, ensemble ids and trajectory
 * hashes are CONTENT hashes of their inputs — never random uuids — so the
 * same (seed, configuration, inputs) yields the same identity, and a
 * reproduced record is byte-identical including its id. Hashing runs over
 * `stableStringify`, a canonical JSON serialization with RECURSIVELY
 * SORTED OBJECT KEYS, so record identity never depends on property
 * insertion order.
 *
 * sha256 via `Bun.CryptoHasher` (the repo is a bun monorepo; this module is
 * the only place the Bun hash API is touched).
 */

/** Canonical JSON: object keys sorted recursively, arrays order-preserving. */
export function stableStringify(value: unknown): string {
  return serialize(value);
}

function serialize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => serialize(item)).join(",")}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${serialize(record[key])}`).join(",")}}`;
}

/** sha256 hex (64 chars) of the canonical serialization of `value`. */
export function contentHash(value: unknown): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(serialize(value));
  return hasher.digest("hex");
}

/** A short content-derived id (first 16 hex chars) — readable, collision-checked by content. */
export function contentId(value: unknown): string {
  return contentHash(value).slice(0, 16);
}
