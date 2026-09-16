import { getSportaServer } from "@/server/runtime";
import { errorResponse, jsonResponse } from "@/server/http-errors";
import {
  fetchSegmentDocumentViaPresignedUrl,
  R2ArtifactIntegrityError,
  R2PlaybackUnavailableError,
} from "@/server/platform/r2/playback";

export const dynamic = "force-dynamic";

/**
 * GET /api/watch/[sessionId]/renders/[renderId]/outputs/[segmentId] — the
 * REAL render-output read through the control plane's playback gate.
 *
 * The gate is the W504/W902 property, not a UI convention: the control plane
 * re-derives the session's rights fail-closed FIRST and denies 403 BEFORE
 * the store is consulted — a session without `canStoreDerivatives` never
 * learns whether the segment exists, and no byte is exposed. Authorized
 * reads return the real encoded segment document (the animated-SVG source,
 * its content hash/length, and the deterministic container manifest).
 *
 * W912 (env-gated R2 round-trip): when the hosted artifact store is
 * configured, the bytes are then FETCHED BACK from the private R2 bucket via
 * a short-lived presigned GET (issued server-side; the browser never sees
 * an object URL) and verified against the gated record — content hash and
 * UTF-8 byte length must match exactly. The response then carries
 * `x-sporta-artifact-source: r2`. Without the binding the route serves the
 * in-process bytes and says `in-memory` in the same header (health reports
 * the same state). A configured-but-unreachable R2 answers an honest 503;
 * an integrity mismatch answers an honest 500 — NEVER a silent fallback that
 * would claim R2 persistence while serving other bytes.
 */
export async function GET(
  _request: Request,
  context: {
    params: Promise<{ sessionId: string; renderId: string; segmentId: string }>;
  },
): Promise<Response> {
  try {
    const server = await getSportaServer();
    await server.ready;
    const { sessionId, renderId, segmentId } = await context.params;
    const document = await server.control.getRenderOutput(sessionId, renderId, segmentId);
    if (server.artifacts !== null) {
      try {
        const sourced = await fetchSegmentDocumentViaPresignedUrl(
          server.artifacts,
          sessionId,
          renderId,
          segmentId,
          { contentHash: document.contentHash, byteLength: document.byteLength },
        );
        return jsonResponse(200, sourced, { "x-sporta-artifact-source": "r2" });
      } catch (err) {
        if (err instanceof R2PlaybackUnavailableError) {
          return jsonResponse(503, {
            error: {
              failureClass: "provider-unavailable",
              message: "artifact storage is configured but unreachable — playback cannot proceed",
            },
          });
        }
        if (err instanceof R2ArtifactIntegrityError) {
          return jsonResponse(500, {
            error: {
              failureClass: "internal",
              message: "stored artifact failed integrity verification against the gated record",
            },
          });
        }
        throw err;
      }
    }
    return jsonResponse(200, document, { "x-sporta-artifact-source": "in-memory" });
  } catch (err) {
    return errorResponse(err);
  }
}
