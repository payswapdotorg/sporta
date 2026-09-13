/**
 * Shared MediaSession document validation (internal).
 *
 * The zod schemas in `@sporta/contracts` are the source of truth for the
 * vendor-neutral session document. Every read and write path in this package
 * funnels through {@link parseSessionDocument} so that schema drift fails
 * loudly (W004 acceptance) instead of silently persisting malformed state.
 */
import { MediaSession } from "@sporta/contracts";
import type { MediaSession as MediaSessionDoc } from "@sporta/contracts";

/**
 * A MediaSession document failed validation against the `MediaSession` schema
 * from `@sporta/contracts`.
 *
 * Carries the zod error as `cause` so callers can inspect the exact issues;
 * the optional `sessionId` is the best-effort session identifier from the
 * offending document.
 */
export class SessionDocumentValidationError extends Error {
  readonly sessionId?: string;

  constructor(message: string, options?: { sessionId?: string; cause?: unknown }) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "SessionDocumentValidationError";
    this.sessionId = options?.sessionId;
  }
}

function sessionIdHint(doc: unknown): string | undefined {
  if (typeof doc === "object" && doc !== null) {
    const id = (doc as { sessionId?: unknown }).sessionId;
    if (typeof id === "string" && id.length > 0) return id;
  }
  return undefined;
}

/**
 * Validates an untrusted value against the canonical `MediaSession` zod
 * schema and returns the parsed (canonicalized) document — unknown keys are
 * stripped, so the result contains only vendor-neutral contract fields.
 *
 * Throws {@link SessionDocumentValidationError} on any drift.
 *
 * @param doc untrusted document (parsed JSON, test input, ...).
 * @param hint optional session id used for error context when the document
 *   itself does not carry a usable `sessionId`.
 */
export function parseSessionDocument(doc: unknown, hint?: string): MediaSessionDoc {
  const sessionId = sessionIdHint(doc) ?? hint;
  const result = MediaSession.safeParse(doc);
  if (!result.success) {
    const where = sessionId !== undefined ? ` for session '${sessionId}'` : "";
    throw new SessionDocumentValidationError(
      `document failed MediaSession schema validation${where}`,
      { sessionId, cause: result.error },
    );
  }
  return result.data;
}
