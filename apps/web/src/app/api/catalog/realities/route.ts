import { getSportaServer } from "@/server/runtime";
import {
  buildRealityGroups,
  resolveCatalogRequester,
  viewerSummaryOf,
} from "@/server/catalog-service";
import { errorResponse, jsonResponse } from "@/server/http-errors";

export const dynamic = "force-dynamic";

/**
 * GET /api/catalog/realities — the REALITY-GROUPED catalog view (W916).
 *
 * Every discoverable session is ONE match entry carrying its REALITY GROUPS:
 * the renderings of the SAME match session, grouped per renderer, with each
 * reality's real availability (`ready` — stored outputs exist;
 * `no-stored-output` — the render ran but nothing is stored;
 * `renderer-unavailable` — the renderer is no longer registered). This is
 * the data model behind "this match in N realities": the session id is the
 * constant that links the alternate realities, exactly like the watch
 * surface's Reality Switcher (Simulation G).
 *
 * Playback-denied sessions keep their match entry (they are discoverable
 * content) but reveal NOTHING about how they were rendered:
 * `realities: null`, `realityCount: null` (fail-closed).
 */
export async function GET(request?: Request): Promise<Response> {
  try {
    const server = await getSportaServer();
    await server.ready;
    const requester = await resolveCatalogRequester(server, request);
    const view = await buildRealityGroups(server, requester);
    return jsonResponse(200, {
      catalogSchemaVersion: "1.1",
      viewer: viewerSummaryOf(requester),
      matches: view.matches,
      ...(view.degraded !== null ? { degraded: view.degraded } : {}),
      catalogSource: "dev-seed",
    });
  } catch (err) {
    return errorResponse(err);
  }
}
