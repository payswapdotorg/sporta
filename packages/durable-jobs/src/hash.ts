/**
 * Canonical JSON serialization + SHA-256 digests (REL-029) — the
 * historical-corpus / organization-registry precedent carried locally:
 * content addressing MUST be deterministic, so keys are sorted recursively
 * and whitespace is stripped before hashing. The digest primitive is the
 * platform WebCrypto subtle (async, no native dependencies).
 *
 * Used by the enqueue IDEMPOTENCY LAW (the request digest that decides
 * whether a repeat submission converges or conflicts) and by the ARTIFACT
 * LINEAGE view (the input digest that answers "which inputs").
 */

/**
 * Deterministic JSON: object keys sorted recursively, no whitespace. Two
 * structurally equal values produce the identical serialization regardless
 * of property insertion order.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item));
  }
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

/** SHA-256 hex digest of a UTF-8 string (the repo's sessions.ts precedent). */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
