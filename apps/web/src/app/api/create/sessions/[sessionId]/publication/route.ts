import { getSportaServer } from "@/server/runtime";
import { tokenFromRequest } from "@/server/auth-service";
import { errorResponse, jsonResponse, readJsonBody } from "@/server/http-errors";

export const dynamic = "force-dynamic";

/**
 * POST /api/create/sessions/[sessionId]/publication — the studio's
 * publish/private step (W906): sets the REAL visibility flag on the session.
 *
 * Effects (enforced, tested): `public` sessions appear in the public
 * catalog and are watchable by anyone; `private` sessions disappear from
 * the catalog and are watchable only by their owner or an operator — every
 * other caller receives the same answer as for an unknown session. The
 * flag is stored with the composition's control-plane state (in-memory this
 * wave — documented honestly; the durable seam is the hosted persistence
 * wave).
 *
 * Owner/operator only. Body: `{ visibility: "public" | "private" }`.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
): Promise<Response> {
  try {
    const server = await getSportaServer();
    await server.ready;
    const token = tokenFromRequest(request);
    if (token === "") {
      const { IdentityUnauthenticatedError } = await import("@sporta/identity");
      throw new IdentityUnauthenticatedError();
    }
    const { sessionId } = await context.params;
    const body = await readJsonBody(request);
    const visibility =
      body !== null && typeof body === "object" && !Array.isArray(body)
        ? (body as Record<string, unknown>).visibility
        : undefined;
    if (visibility !== "public" && visibility !== "private") {
      const { IdentityValidationError } = await import("@sporta/identity");
      throw new IdentityValidationError('visibility must be "public" or "private"');
    }
    const result = await server.studio.setPublication({ token, sessionId, visibility });
    return jsonResponse(200, result);
  } catch (err) {
    return errorResponse(err);
  }
}
