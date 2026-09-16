/**
 * W912 playback delivery: the server-side R2 round-trip for the watch page's
 * output route.
 *
 * ACCESS-CONTROL ORDER (the core W912 requirement — every step fail-closed):
 *
 * 1. The control plane's playback gate ALREADY ran before this module is
 *    called (the route's `server.control.getRenderOutput` — the W902/W701
 *    fail-closed rights re-derivation, deny-before-existence);
 * 2. ONLY THEN is a SHORT-LIVED presigned GET issued (query-signed SigV4,
 *    `SERVER_FETCH_PRESIGN_SECONDS` — never a day-scale URL, never an
 *    unsigned object URL) and fetched server-side;
 * 3. the fetched envelope is verified against the GATED record — scope ids
 *    must match, and the content's measured sha-256 + UTF-8 byte length must
 *    equal both the envelope's declared values AND the gated record's. Any
 *    mismatch is a loud `R2ArtifactIntegrityError` — the route answers an
 *    honest error, NEVER silently falls back to other bytes while claiming
 *    R2 delivery.
 *
 * If R2 is unreachable the fetch fails with `R2PlaybackUnavailableError`
 * (the route answers a typed 503) — a configured provider is never silently
 * substituted with the in-process store.
 */
import { createHash } from "node:crypto";
import type { R2RenderOutputStore } from "./r2-store";

/** The presign lifetime for SERVER-side artifact fetches (short by policy). */
export const SERVER_FETCH_PRESIGN_SECONDS = 60;

/** The stored segment envelope R2 hands back (see r2-store.ts `SegmentDocumentV1`). */
interface StoredSegmentEnvelope {
  schema: "sporta.render-output/1";
  sessionId: string;
  renderId: string;
  segmentId: string;
  contentType: string;
  content: string;
  byteLength: number;
  contentHash: string;
  manifest: unknown;
}

/** A verified, R2-sourced segment document (the playback route's answer body). */
export interface R2SourcedSegmentDocument {
  sessionId: string;
  renderId: string;
  segmentId: string;
  contentType: string;
  byteLength: number;
  contentHash: string;
  content: string;
  manifest: unknown;
}

/** R2 was configured but the artifact fetch failed (route → honest 503). */
export class R2PlaybackUnavailableError extends Error {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "R2PlaybackUnavailableError";
    this.details = details;
  }
  readonly details: Record<string, unknown>;
}

/** The fetched bytes failed verification (route → honest 500, never fallback). */
export class R2ArtifactIntegrityError extends Error {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "R2ArtifactIntegrityError";
    this.details = details;
  }
  readonly details: Record<string, unknown>;
}

function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function measureUtf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

function isEnvelope(value: unknown): value is StoredSegmentEnvelope {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<StoredSegmentEnvelope>;
  return (
    candidate.schema === "sporta.render-output/1" &&
    typeof candidate.sessionId === "string" &&
    typeof candidate.renderId === "string" &&
    typeof candidate.segmentId === "string" &&
    typeof candidate.contentType === "string" &&
    typeof candidate.content === "string" &&
    typeof candidate.byteLength === "number" &&
    typeof candidate.contentHash === "string" &&
    "manifest" in candidate
  );
}

/**
 * Fetches one stored segment from R2 via a SHORT-LIVED presigned GET and
 * verifies it against the playback-gated record. The presign is issued here
 * — the browser never receives it (the browser-facing presigned delivery is
 * the platform render-outputs route); this is the server's own fetch.
 */
export async function fetchSegmentDocumentViaPresignedUrl(
  store: R2RenderOutputStore,
  sessionId: string,
  renderId: string,
  segmentId: string,
  gated: { contentHash: string; byteLength: number },
): Promise<R2SourcedSegmentDocument> {
  const url = store.presignedGetUrl(sessionId, renderId, segmentId, SERVER_FETCH_PRESIGN_SECONDS);
  let response: Response;
  try {
    response = await store.fetchViaTransport(url);
  } catch (err) {
    throw new R2PlaybackUnavailableError("artifact storage is unreachable", {
      cause: err instanceof Error ? err.message : String(err),
    });
  }
  if (!response.ok) {
    // 404 on a configured bucket means the object was never mirrored (e.g.
    // stored before R2 was wired) — honest absence, not a fallback case.
    throw new R2PlaybackUnavailableError(`artifact fetch failed with HTTP ${response.status}`, {
      status: response.status,
    });
  }
  const parsed: unknown = await response.json().catch(() => {
    throw new R2ArtifactIntegrityError("artifact envelope is not valid JSON");
  });
  if (!isEnvelope(parsed)) {
    throw new R2ArtifactIntegrityError("artifact envelope failed structural validation");
  }
  if (
    parsed.sessionId !== sessionId ||
    parsed.renderId !== renderId ||
    parsed.segmentId !== segmentId
  ) {
    throw new R2ArtifactIntegrityError("artifact envelope is outside the requested scope", {
      requestedScope: { sessionId, renderId, segmentId },
      envelopeScope: {
        sessionId: parsed.sessionId,
        renderId: parsed.renderId,
        segmentId: parsed.segmentId,
      },
    });
  }
  const measuredBytes = measureUtf8Bytes(parsed.content);
  const measuredHash = sha256Hex(parsed.content);
  if (parsed.byteLength !== measuredBytes || parsed.contentHash !== measuredHash) {
    throw new R2ArtifactIntegrityError("stored artifact failed self-verification", {
      declared: { byteLength: parsed.byteLength, contentHash: parsed.contentHash },
      measured: { byteLength: measuredBytes, contentHash: measuredHash },
    });
  }
  if (parsed.contentHash !== gated.contentHash || parsed.byteLength !== gated.byteLength) {
    throw new R2ArtifactIntegrityError(
      "stored artifact does not match the playback-gated record (possible stale mirror)",
      {
        gated: { byteLength: gated.byteLength, contentHash: gated.contentHash },
        stored: { byteLength: parsed.byteLength, contentHash: parsed.contentHash },
      },
    );
  }
  return {
    sessionId: parsed.sessionId,
    renderId: parsed.renderId,
    segmentId: parsed.segmentId,
    contentType: parsed.contentType,
    byteLength: parsed.byteLength,
    contentHash: parsed.contentHash,
    content: parsed.content,
    manifest: parsed.manifest,
  };
}
