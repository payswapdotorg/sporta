import { getSportaServer } from "@/server/runtime";
import { sessionCookie } from "@/server/auth-service";
import { errorResponse, readJsonBody } from "@/server/http-errors";

export const dynamic = "force-dynamic";

/**
 * POST /api/auth/login — verify credentials and issue an opaque session.
 * Failures are generic and timing-equalized (identity's no-enumeration rule).
 * Success sets the HttpOnly SameSite=Lax session cookie and returns the
 * one-time-visible token + account view.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const server = await getSportaServer();
    await server.ready;
    const body = await readJsonBody(request);
    const result = await server.auth.login(body);
    const secure = process.env.NODE_ENV === "production";
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store",
        "set-cookie": sessionCookie(result.token, secure),
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
