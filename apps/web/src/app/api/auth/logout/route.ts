import { getSportaServer } from "@/server/runtime";
import { clearedSessionCookie, tokenFromRequest } from "@/server/auth-service";
import { AuthFlowError } from "@/server/auth-service";
import { errorResponse } from "@/server/http-errors";

export const dynamic = "force-dynamic";

/**
 * POST /api/auth/logout — revoke the presented session (idempotent) and
 * clear the cookie. An absent token is a 401 (a logout needs a session).
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const server = await getSportaServer();
    await server.ready;
    const token = tokenFromRequest(request);
    if (token.length === 0) {
      throw new AuthFlowError(401, "unauthenticated", "a session token is required to log out");
    }
    const result = await server.auth.logout(token);
    const secure = process.env.NODE_ENV === "production";
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store",
        "set-cookie": clearedSessionCookie(secure),
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
