import { getSportaServer } from "@/server/composition";
import { tokenFromRequest } from "@/server/auth-service";
import { AuthFlowError } from "@/server/auth-service";
import { buildLibrary } from "@/server/catalog-service";
import { errorResponse, jsonResponse } from "@/server/http-errors";

export const dynamic = "force-dynamic";

/**
 * GET /api/catalog/library — the SIGNED-IN user's own sessions (by the
 * identity gate's ownership records). Requires a live session; anonymous
 * callers get a 401 (the Library surface's authentication-required state).
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const server = await getSportaServer();
    await server.ready;
    const resolved = await server.auth.resolve(tokenFromRequest(request));
    if (resolved === null) {
      throw new AuthFlowError(401, "unauthenticated", "the library requires a signed-in account");
    }
    const sessions = await buildLibrary(server, resolved.account.userId);
    return jsonResponse(200, { sessions, ownerId: resolved.account.userId });
  } catch (err) {
    return errorResponse(err);
  }
}
