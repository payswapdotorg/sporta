import { getSportaServer } from "@/server/runtime";
import { tokenFromRequest } from "@/server/auth-service";
import { buildRightsCenter } from "@/server/workspace-service";
import { errorResponse, jsonResponse } from "@/server/http-errors";

export const dynamic = "force-dynamic";

/**
 * GET /api/rights/center — the Rights Holder workspace's Rights Center: the
 * REAL rights-policy state of the sessions the account owns (operators: the
 * sessions the account controls), each read through the identity control
 * gate's owner/operator rule. Anonymous callers get the real 401; accounts
 * without the rights-holder (or operator) grant get the REAL 403 with the
 * explanation — the denied state the Rights Center surface renders.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const server = await getSportaServer();
    await server.ready;
    const model = await buildRightsCenter(server, tokenFromRequest(request));
    return jsonResponse(200, model);
  } catch (err) {
    return errorResponse(err);
  }
}
