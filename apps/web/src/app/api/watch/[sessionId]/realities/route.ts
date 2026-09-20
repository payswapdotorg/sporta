import { getSportaServer } from "@/server/runtime";
import {
  assertWatchable,
  buildWatchArtifactCatalog,
  buildWatchModel,
} from "@/server/catalog-service";
import { capabilityForRequest } from "@/server/capability-service";
import { deriveRealityOptions } from "@/lib/surface-state";
import { errorResponse, jsonResponse } from "@/server/http-errors";

export const dynamic = "force-dynamic";

/**
 * GET /api/watch/[sessionId]/realities — THE REALITY SWITCHER SURFACE
 * (W905, Simulation G + R504/R505): the per-renderer availability for ONE
 * match session AND the REALITY ARTIFACT CATALOG (R503's shapes) the Watch
 * player's HTML5 video source resolution consumes.
 *
 * The match session is the CONSTANT of this surface: the answer is derived
 * from the same capability response + watch model + artifact catalog the
 * page already holds, so switching reality later is a client-side state
 * change plus a fetch of the newly-selected reality's artifact for THIS
 * session — never a reload.
 *
 * `options` — the per-RENDERER availability (W905, unchanged; the
 * diagnostic frame player's surface).
 *
 * `artifacts` — the four REALITY entries (R503's `SessionArtifactCatalog`
 * shapes, built through the watch gate's posture): per-reality availability
 * (ready / job-in-flight / job-failed / requires-render / requires-upload /
 * producer-unavailable) with the honest reason VERBATIM, and ONLY real
 * artifact descriptors the stores actually hold (artifact id, kind, manifest
 * link, integrity hash, byte size, content type, producer). A
 * playback-denied session reveals NOTHING (`realities: null` — the W916
 * posture, fail-closed).
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
): Promise<Response> {
  try {
    const server = await getSportaServer();
    await server.ready;
    const { sessionId } = await context.params;
    await assertWatchable(server, request, sessionId);
    const capability = await capabilityForRequest(server, request);
    const watch = await buildWatchModel(server, sessionId);
    const options = deriveRealityOptions(capability, watch);
    const artifacts = await buildWatchArtifactCatalog(server, sessionId);
    return jsonResponse(200, { sessionId: watch.sessionId, options, artifacts });
  } catch (err) {
    return errorResponse(err);
  }
}
