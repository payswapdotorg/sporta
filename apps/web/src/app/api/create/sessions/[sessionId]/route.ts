import { getSportaServer } from "@/server/runtime";
import { tokenFromRequest } from "@/server/auth-service";
import { errorResponse, jsonResponse } from "@/server/http-errors";

export const dynamic = "force-dynamic";

/**
 * GET /api/create/sessions/[sessionId] — the studio's session state
 * (W906): the real session document, the fail-closed rights re-derived at
 * request time, the render list with stored-output availability and the
 * real renderer health, the studio-dispatched compute jobs, and the
 * publication state. Owner/operator only (the identity resource rule);
 * everyone else sees the uniform denial.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
): Promise<Response> {
  try {
    const server = await getSportaServer();
    await server.ready;
    const token = tokenFromRequest(request);
    if (token === null) {
      const { IdentityUnauthenticatedError } = await import("@sporta/identity");
      throw new IdentityUnauthenticatedError();
    }
    const { sessionId } = await context.params;
    const state = await server.studio.sessionState(token, sessionId);
    return jsonResponse(200, state);
  } catch (err) {
    return errorResponse(err);
  }
}
