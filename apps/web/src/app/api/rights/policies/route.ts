import { getSportaServer } from "@/server/runtime";
import { tokenFromRequest } from "@/server/auth-service";
import { errorResponse, jsonResponse } from "@/server/http-errors";

export const dynamic = "force-dynamic";

/**
 * GET /api/rights/policies — the W917 policy INSPECTION list: every
 * session's rights + publication state in the CALLER's scope (sessions they
 * own; with the rights-holder grant, sessions whose rights they attested;
 * with the operator grant, the full operational view). No other user's
 * policies are ever included. Anonymous callers get the real 401.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const server = await getSportaServer();
    await server.ready;
    const model = await server.rights.listPolicies(tokenFromRequest(request));
    return jsonResponse(200, model);
  } catch (err) {
    return errorResponse(err);
  }
}
