import { getSportaServer } from "@/server/runtime";
import {
  buildCatalogFor,
  resolveCatalogRequester,
  viewerSummaryOf,
} from "@/server/catalog-service";
import { errorResponse, jsonResponse } from "@/server/http-errors";

export const dynamic = "force-dynamic";

/**
 * GET /api/catalog/sessions — the REQUESTER-SCOPED catalog (W916).
 *
 * The listing answers what THIS caller is authorized to discover:
 * anonymous → public sessions only; an authenticated account → public + its
 * own sessions; a rights holder → public + owned + policy-scoped sessions
 * it attested; an operator → the full operational view; role-scoped
 * content additionally reaches the grants named on its record. Unknown
 * visibility is discoverable by NOBODY (fail-closed).
 *
 * Shape (catalog schema 1.1 — versioned, additive over the W904/W906 answer):
 * every card additionally carries its reality groups (`realities` — the
 * renders of the same match session grouped per renderer), and the owner /
 * operator view carries the visibility flag + the operator's operational
 * fields. Callers without a live session answer exactly as anonymous
 * (a request without a valid token IS anonymous).
 */
export async function GET(request?: Request): Promise<Response> {
  try {
    const server = await getSportaServer();
    await server.ready;
    const requester = await resolveCatalogRequester(server, request);
    const listing = await buildCatalogFor(server, requester);
    return jsonResponse(200, {
      catalogSchemaVersion: "1.1",
      viewer: viewerSummaryOf(requester),
      sessions: listing.sessions,
      ...(listing.degraded !== null ? { degraded: listing.degraded } : {}),
      catalogSource: "dev-seed",
    });
  } catch (err) {
    return errorResponse(err);
  }
}
