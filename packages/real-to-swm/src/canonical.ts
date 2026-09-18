/**
 * Canonical serialization + content hashing (R207 determinism rule).
 *
 * `canonicalJson` produces a byte-stable JSON string for the SAME logical
 * value: object keys sorted recursively, `undefined`-valued properties
 * omitted, arrays kept in order. The artifact content hash is sha-256 over
 * the canonical JSON of the artifact with its `contentHash` field excluded —
 * so the same pipeline run (same clip, same config, same candidates) always
 * produces the same hash, in-process or cross-subprocess.
 */

/**
 * Canonical JSON: recursively key-sorted, `undefined` properties omitted.
 * Numbers serialize via the ECMAScript deterministic number formatting.
 * Throws on values JSON cannot represent (functions, symbols, bigints) —
 * the artifact must be plain data.
 */
export function canonicalJson(value: unknown): string {
  return serialize(value);
}

function serialize(value: unknown): string {
  if (value === null) return "null";
  const type = typeof value;
  if (type === "undefined") return "null";
  if (type === "boolean") return value ? "true" : "false";
  if (type === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(`canonicalJson: non-finite number (${value}) is not representable`);
    }
    return JSON.stringify(value);
  }
  if (type === "string") return JSON.stringify(value);
  if (type === "bigint") {
    throw new TypeError("canonicalJson: bigint is not representable (convert to number)");
  }
  if (type === "function" || type === "symbol") {
    throw new TypeError(`canonicalJson: ${type} is not representable`);
  }
  if (Array.isArray(value)) {
    const items = value.map((item) => serialize(item === undefined ? null : item));
    return `[${items.join(",")}]`;
  }
  if (type === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const entries = keys.map((key) => `${JSON.stringify(key)}:${serialize(record[key])}`);
    return `{${entries.join(",")}}`;
  }
  throw new TypeError(`canonicalJson: unsupported value type "${type}"`);
}

/** sha-256 of `bytes` as lowercase hex (Bun's built-in hasher — no deps). */
export function sha256Hex(bytes: Uint8Array): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(bytes);
  return hasher.digest("hex");
}

/** sha-256 of a UTF-8 string as lowercase hex. */
export function sha256HexOfString(text: string): string {
  return sha256Hex(new TextEncoder().encode(text));
}
