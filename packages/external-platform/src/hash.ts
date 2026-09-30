/**
 * Canonical JSON serialization + SHA-256 digests (REL-014) — the repo-wide
 * precedent (organization-registry's registry.ts, historical-corpus's
 * hash.ts): content addressing MUST be deterministic, so keys are sorted
 * recursively and whitespace is stripped before hashing. The digest
 * primitive is the platform WebCrypto subtle (async, no native deps).
 */

/** Deterministic JSON: object keys sorted recursively, no whitespace. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const record: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const item = (value as Record<string, unknown>)[key];
      if (item !== undefined) record[key] = canonicalize(item);
    }
    return record;
  }
  return value;
}

/** SHA-256 hex digest of a UTF-8 string. */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** SHA-256 hex digest of raw bytes (the artifact checksum). */
export async function sha256HexBytes(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
