import { getSportaServer } from "@/server/runtime";
import { tokenFromRequest } from "@/server/auth-service";
import { errorResponse, jsonResponse } from "@/server/http-errors";

export const dynamic = "force-dynamic";

/**
 * GET /api/operations/audit — the OPERATIONS CONSOLE's audit trail (W918).
 *
 * Every remediation action the console executed or REFUSED, with actor,
 * target job, outcome and reason (refusals are recorded too — an audit
 * trail that only records successes would be a lie). In-memory with the
 * composition's control-plane state; the durable seam is W919/W920.
 * OPERATOR GRANT REQUIRED.
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
    const snapshot = await server.operations.auditTrail(token);
    return jsonResponse(200, snapshot);
  } catch (err) {
    return errorResponse(err);
  }
}
