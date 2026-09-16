import { getSportaServer } from "@/server/runtime";
import { assertWatchable } from "@/server/catalog-service";
import { errorResponse, jsonResponse } from "@/server/http-errors";

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
 */
export async function GET(
  request: Request,
  context: {
    params: Promise<{ sessionId: string; renderId: string; segmentId: string }>;
  },
): Promise<Response> {
  try {
    const server = await getSportaServer();
    await server.ready;
    const { sessionId, renderId, segmentId } = await context.params;
    await assertWatchable(server, request, sessionId);
    const document = await server.control.getRenderOutput(sessionId, renderId, segmentId);
    return jsonResponse(200, document);
  } catch (err) {
    return errorResponse(err);
  }
}
