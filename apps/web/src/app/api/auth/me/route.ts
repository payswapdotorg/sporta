import { getSportaServer } from "@/server/runtime";
import { tokenFromRequest } from "@/server/auth-service";
import { AuthFlowError } from "@/server/auth-service";
import { errorResponse, jsonResponse } from "@/server/http-errors";

export const dynamic = "force-dynamic";

/**
 * GET /api/auth/me — the signed-in account view (summary + role grants +
 * the session's active role). 401 with a generic body when no live session
 * is presented.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const server = await getSportaServer();
    await server.ready;
    const resolved = await server.auth.resolve(tokenFromRequest(request));
    if (resolved === null) {
      throw new AuthFlowError(401, "unauthenticated", "no valid session was presented");
    }
    return jsonResponse(200, server.auth.view(resolved.account, resolved.activeRole));
  } catch (err) {
    return errorResponse(err);
  }
}
