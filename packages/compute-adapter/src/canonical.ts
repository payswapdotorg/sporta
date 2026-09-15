/**
 * Canonical serialization + content addressing for dispatched inputs
 * (W914 Wave 2, ADDITIVE to the Wave-1 contract).
 *
 * A hosted dispatch carries an inputs manifest whose entries may declare a
 * `contentHash` (sha-256) and `byteSize`. For those declarations to be
 * VERIFIABLE by a provider that received the payload over a wire, both
 * sides must derive the exact same bytes from the same payload — so the
 * contract layer owns THE canonical serialization:
 *
 * - object keys sorted ascending (code-unit order), recursively;
 * - arrays kept in order;
 * - only JSON scalar/object/array values (functions, `undefined`, symbols,
 *   bigints, and sparse holes REJECT loudly — a payload that cannot be
 *   serialized canonically must never travel with a silent fallback);
 * - no whitespace, `JSON.stringify` scalar formatting.
 *
 * The hash is sha-256 over the UTF-8 bytes of that canonical form, hex
 * lowercase — the same convention as the W504 `contentHashOf` (64 lowercase
 * hex digits), implemented through the platform-neutral
 * `globalThis.crypto.subtle` (available in Bun and Node 18+; the contract
 * layer imports NOTHING — the Wave-1 zod-only isolation rule).
 *
 * Purity: no clock, no randomness, no imports; `sha256OfCanonicalJson` is
 * async because `crypto.subtle.digest` is — determinism is total (the same
 * value always produces the same canonical string and the same hash).
 */

/** `true` for values that can appear in a canonical JSON document. */
function isCanonicalValue(value: unknown, seen: unknown[]): boolean {
  switch (typeof value) {
    case "string":
      return true;
    case "number":
      // Only finite numbers have a JSON serialization.
      return Number.isFinite(value);
    case "boolean":
      return true;
    case "object":
      break;
    default:
      // undefined, function, symbol, bigint — never canonical.
      return false;
  }
  if (value === null) return true;
  if (seen.includes(value)) return false; // cycle — cannot be JSON
  seen.push(value);
  try {
    if (Array.isArray(value)) {
      // No holes, no `undefined`/non-finite entries.
      for (const entry of value) {
        if (!isCanonicalValue(entry, seen)) return false;
      }
      return true;
    }
    const keys = Object.keys(value as Record<string, unknown>);
    for (const key of keys) {
      if (!isCanonicalValue((value as Record<string, unknown>)[key], seen)) return false;
    }
    return true;
  } finally {
    seen.pop();
  }
}

/** Escapes a JSON string exactly like `JSON.stringify` (incl. lone surrogates). */
function canonicalString(value: string): string {
  return JSON.stringify(value);
}

/**
 * The canonical JSON serialization of a JSON-safe value (see module docs).
 * Throws `TypeError` for anything that cannot be canonically serialized
 * (non-finite numbers, `undefined`, functions, symbols, bigints, cycles,
 * sparse arrays) — loud, never a silent fallback.
 */
export function canonicalJsonOf(value: unknown): string {
  if (!isCanonicalValue(value, [])) {
    throw new TypeError(
      "value cannot be canonically serialized to JSON (non-finite number, undefined, " +
        "function, symbol, bigint, cycle, or sparse array)",
    );
  }
  return serialize(value);
}

function serialize(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
      return canonicalString(value);
    case "number":
      return Number.isFinite(value) ? String(value) : "null";
    case "boolean":
      return value ? "true" : "false";
    case "object":
      break;
    default:
      return "null";
  }
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (const entry of value) parts.push(serialize(entry));
    return `[${parts.join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const parts: string[] = [];
  for (const key of keys) parts.push(`${canonicalString(key)}:${serialize(record[key])}`);
  return `{${parts.join(",")}}`;
}

/** UTF-8 byte length of the canonical serialization (the `byteSize` of a manifest entry). */
export function canonicalByteLengthOf(value: unknown): number {
  return new TextEncoder().encode(canonicalJsonOf(value)).length;
}

/** The minimal structural view of `crypto.subtle.digest` this module needs (no DOM lib required). */
interface Sha256Subtle {
  digest(algorithm: "SHA-256", data: Uint8Array): Promise<ArrayBuffer>;
}

/** The digest of `bytes` as 64 lowercase hex digits (sha-256). */
async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const subtle = (globalThis as { crypto?: { subtle?: Sha256Subtle } }).crypto?.subtle;
  if (subtle === undefined) {
    throw new TypeError(
      "globalThis.crypto.subtle is unavailable (needs Bun or Node 18+); cannot hash",
    );
  }
  const digest = await subtle.digest("SHA-256", bytes);
  const view = new Uint8Array(digest);
  let hex = "";
  for (const byte of view) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

/** The manifest `contentHash` of a materialized input: sha-256 of its canonical JSON (UTF-8). */
export async function sha256OfCanonicalJson(value: unknown): Promise<string> {
  return sha256Hex(new TextEncoder().encode(canonicalJsonOf(value)));
}
