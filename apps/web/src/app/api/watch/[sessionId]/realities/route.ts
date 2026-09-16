import { getSportaServer } from "@/server/runtime";
import { buildWatchModel } from "@/server/catalog-service";
import { capabilityForRequest } from "@/server/capability-service";
import { deriveRealityOptions } from "@/lib/surface-state";
import { errorResponse, jsonResponse } from "@/server/http-errors";

export const dynamic = "force-dynamic";

/**
 * GET /api/watch/[sessionId]/realities — THE REALITY SWITCHER SURFACE
 * (W905, Simulation G): the per-renderer availability for ONE match
 * session, with the real reason for every option that is not ready.
 *
 * The match session is the CONSTANT of this surface: the answer is derived
 * from the same capability response + watch model the page already holds,
 * so switching renderer later is a client-side state change plus a fetch of
 * the newly-selected renderer's output for THIS session — never a reload.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
): Promise<Response> {
  try {
    const server = await getSportaServer();
    await server.ready;
    const { sessionId } = await context.params;
    const capability = await capabilityForRequest(server, request);
    const watch = await buildWatchModel(server, sessionId);
    const options = deriveRealityOptions(capability, watch);
    return jsonResponse(200, { sessionId: watch.sessionId, options });
  } catch (err) {
    return errorResponse(err);
  }
}
