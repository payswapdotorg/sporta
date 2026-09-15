import { getSportaServer } from "@/server/composition";
import { tokenFromRequest } from "@/server/auth-service";
import { errorResponse, jsonResponse, readJsonBody } from "@/server/http-errors";

export const dynamic = "force-dynamic";

/**
 * POST /api/auth/switch-role — switch the session's ACTIVE ROLE (workspace
 * presentation only). The switch is refused unless the account holds the
 * role: switching never grants authority (the architecture-lock rule); the
 * available choices are exactly the account's grants.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const server = await getSportaServer();
    await server.ready;
    const body = await readJsonBody(request);
    const account = await server.auth.switchRole(tokenFromRequest(request), body);
    return jsonResponse(200, account);
  } catch (err) {
    return errorResponse(err);
  }
}
