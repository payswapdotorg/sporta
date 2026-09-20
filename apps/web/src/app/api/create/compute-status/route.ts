import { getSportaServer } from "@/server/runtime";
import { tokenFromRequest } from "@/server/auth-service";
import { errorResponse, jsonResponse } from "@/server/http-errors";

export const dynamic = "force-dynamic";

/**
 * GET /api/create/compute-status — THE COMPUTE/COST STATUS (R506): the
 * caller's legibility document over the REAL seams:
 *
 * - `plane` — whose compute this deployment renders on (the composition's
 *   own DATA: provider, adapter, the selection seam's registered provider
 *   id, and the operator's declared responsibility boundary in the R408
 *   execution-ownership vocabulary — `sporta-managed` vs
 *   `user-owned-provider`). `null` when no compute plane is configured.
 * - `quotas` — the caller's daily compute allowance states (the W919
 *   per-user quotas as the W901 QuotaState shape; an unreadable counter is
 *   the fail-closed `quota-counter-invalid` entry — never zero).
 * - `usage` — the plane's metered usage totals where available (`null` =
 *   not measured — never a fabricated number).
 *
 * A PROJECTION of connection-center state (the SelectionDirector's
 * registered facts + the guardrails' quota/usage seams) — no new domain
 * vocabulary. Requires an authenticated caller (401 anonymous — the studio
 * surface's own rule).
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const server = await getSportaServer();
    await server.ready;
    const token = tokenFromRequest(request);
    if (token === "") {
      const { IdentityUnauthenticatedError } = await import("@sporta/identity");
      throw new IdentityUnauthenticatedError();
    }
    const status = await server.studio.computeStatus(token);
    return jsonResponse(200, status);
  } catch (err) {
    return errorResponse(err);
  }
}
