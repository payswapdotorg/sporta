import { getSportaServer } from "@/server/runtime";
import { tokenFromRequest } from "@/server/auth-service";
import { errorResponse, jsonResponse } from "@/server/http-errors";

export const dynamic = "force-dynamic";

/**
 * GET /api/operations/queues — the OPERATIONS CONSOLE's queue panel (W918).
 *
 * The W913 bounded render queue's live state: the depth against the hard
 * bound, the per-job admission views (with ages), the backing provider
 * (upstash shared vs the honest in-memory fallback), and the admission
 * refusals counted at the studio dispatch seam — where a full queue
 * actually refuses work (Simulation E: fail-closed, never silently
 * dropped). OPERATOR GRANT REQUIRED.
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
    const snapshot = await server.operations.queuesSnapshot(token);
    return jsonResponse(200, snapshot);
  } catch (err) {
    return errorResponse(err);
  }
}
