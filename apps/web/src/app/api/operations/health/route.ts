import { getSportaServer } from "@/server/runtime";
import { tokenFromRequest } from "@/server/auth-service";
import { errorResponse, jsonResponse } from "@/server/http-errors";

export const dynamic = "force-dynamic";

/**
 * GET /api/operations/health — the OPERATIONS CONSOLE's health board (W918).
 *
 * The honest platform snapshot the operator acts on: the environment tier +
 * deploy marker, the live provider checks (Neon/R2/Upstash — `unconfigured`
 * and `error` are reported as exactly that, never as healthy), the compute
 * provider selection, the live transport state and the bounded render
 * queue's depth. OPERATOR GRANT REQUIRED (the identity layer's
 * `provider-health.read` action): non-operators get the real typed 403,
 * anonymous callers the typed 401.
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
    const snapshot = await server.operations.healthSnapshot(token);
    return jsonResponse(200, snapshot);
  } catch (err) {
    return errorResponse(err);
  }
}
