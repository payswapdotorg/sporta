/**
 * Canonical serialization + strict parsing of capability responses (W901).
 *
 * The builder constructs response objects with a FIXED key order, so
 * `JSON.stringify` is deterministic: the same input produces the same bytes.
 * `parseCapabilityResponse` validates the bytes against the full response
 * schema (shape + closed vocabularies + cross-field invariants) and throws
 * {@link CapabilityParseError} on any violation — a consumer can never ingest
 * an invalid capability document silently.
 */
import { CapabilityParseError } from "./errors";
import { CapabilityResponseSchema } from "./schema";
import type { CapabilityResponse } from "./schema";

/** Serializes a capability response to canonical (deterministic) JSON bytes. */
export function serializeCapabilityResponse(response: CapabilityResponse): string {
  return JSON.stringify(response);
}

/** Parses and validates capability response bytes. */
export function parseCapabilityResponse(text: string): CapabilityResponse {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new CapabilityParseError("capability response is not valid JSON", {
      reason: err instanceof Error ? err.message : "unknown JSON parse failure",
    });
  }
  const parsed = CapabilityResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new CapabilityParseError(
      "capability response failed schema validation (unknown keys, closed-vocabulary violations, or cross-field invariants)",
      {
        issues: parsed.error.issues.map(
          (issue) => `${issue.path.join(".")}: ${issue.message}`,
        ),
      },
    );
  }
  return parsed.data;
}
