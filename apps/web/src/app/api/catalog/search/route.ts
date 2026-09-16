import { getSportaServer } from "@/server/runtime";
import {
  parseSearchQuery,
  resolveCatalogRequester,
  searchCatalog,
  viewerSummaryOf,
} from "@/server/catalog-service";
import { errorResponse, jsonResponse } from "@/server/http-errors";

export const dynamic = "force-dynamic";

/**
 * GET /api/catalog/search — the Search surface's data layer (W916).
 *
 * A REAL search over the requester-scoped discoverable catalog:
 * - `q` — case-insensitive text match over real fields (the session label,
 *   the labeled story key, the renderer ids of the session's renders);
 * - `status` — exact filter (the frozen `SessionStatus` vocabulary);
 * - `renderer` — exact filter against the session's real renders;
 * - `rights` — exact filter (authorized | denied).
 *
 * Strict typing: an unknown closed-vocabulary value answers the typed 400,
 * never a silently-empty result; an empty search (no q, no filters) is a 400
 * as well. Non-discoverable sessions are filtered out BEFORE matching — a
 * search can never reveal what the listing would not (no existence oracle).
 * A denied session never matches on renderer (its renders are not revealed).
 */
export async function GET(request?: Request): Promise<Response> {
  try {
    const server = await getSportaServer();
    await server.ready;
    const url = new URL(request?.url ?? "http://sporta.test/api/catalog/search");
    const requester = await resolveCatalogRequester(server, request);
    const query = parseSearchQuery(url.searchParams);
    const result = await searchCatalog(server, requester, query);
    return jsonResponse(200, {
      catalogSchemaVersion: "1.1",
      viewer: viewerSummaryOf(requester),
      query: {
        ...(query.q !== null ? { q: query.q } : {}),
        ...(query.status !== null ? { status: query.status } : {}),
        ...(query.renderer !== null ? { renderer: query.renderer } : {}),
        ...(query.rights !== null ? { rights: query.rights } : {}),
      },
      matches: result.matches,
      ...(result.degraded !== null ? { degraded: result.degraded } : {}),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
