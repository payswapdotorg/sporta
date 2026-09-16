import { getSportaServer } from "@/server/runtime";
import { tokenFromRequest } from "@/server/auth-service";
import { errorResponse, jsonResponse } from "@/server/http-errors";

export const dynamic = "force-dynamic";

/**
 * GET /api/rights/audit — the caller's policy-change audit trail: every
 * recorded change (who/what/when) on sessions in their scope (owned;
 * attested, with the rights-holder grant; all, with the operator grant).
 * Anonymous callers get the real 401.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const server = await getSportaServer();
    await server.ready;
    const model = await server.rights.auditTrail(tokenFromRequest(request));
    return jsonResponse(200, model);
  } catch (err) {
    return errorResponse(err);
  }
}
