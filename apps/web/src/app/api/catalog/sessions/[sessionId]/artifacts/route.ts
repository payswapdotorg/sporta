import { getSportaServer } from "@/server/runtime";
import {
  buildArtifactCatalog,
  resolveCatalogRequester,
  viewerSummaryOf,
} from "@/server/catalog-service";
import { errorResponse, jsonResponse } from "@/server/http-errors";

export const dynamic = "force-dynamic";

/**
 * GET /api/catalog/sessions/[sessionId]/artifacts — THE REALITY ARTIFACT
 * CATALOG (R503): one session's artifact set across the four MVP realities
 * (original / tactical / three-d-game / anime-npr), linked through the REAL
 * encoding manifests + artifact stores:
 *
 * - `original` — the media platform's verified `RenderArtifactManifest`
 *   records (real uploads; descriptors carry the manifest link + the
 *   integrity hash the store verified);
 * - the derived realities — the control plane's stored W504 outputs of the
 *   REGISTERED renderers the composition declares for each reality;
 * - realities with no registered producer answer `producer-unavailable`
 *   with the honest reason — entries exist ONLY for real artifacts the
 *   store actually holds, never fixture stand-ins.
 *
 * W916 fail-closed posture preserved exactly: the session must be
 * discoverable by THIS requester (non-discoverable ids answer the uniform
 * unknown-session 404 — no existence oracle), and a playback-denied
 * session reveals NOTHING (`realities: null`, the same semantics the card
 * model carries).
 *
 * This is the data contract the Watch player (R504) consumes: session id,
 * per-reality artifact descriptors (id, kind, manifest link, integrity
 * hash) and availability states.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
): Promise<Response> {
  try {
    const server = await getSportaServer();
    await server.ready;
    const { sessionId } = await context.params;
    const requester = await resolveCatalogRequester(server, request);
    const catalog = await buildArtifactCatalog(server, requester, sessionId);
    return jsonResponse(200, {
      catalogSchemaVersion: "1.0",
      viewer: viewerSummaryOf(requester),
      ...catalog,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
