import { getSportaServer } from "@/server/runtime";
import { tokenFromRequest } from "@/server/auth-service";
import { errorResponse, jsonResponse } from "@/server/http-errors";

export const dynamic = "force-dynamic";

/**
 * GET /api/create/url-sources/[registrationId] — the owner's registration
 * read (W6 Worker B): the URL verbatim, the honest oEmbed record, the
 * acquisition state machine's live truth (PENDING_TRANSFER / ACQUIRING /
 * ACQUIRED + the seam-measured integrity / FAILED + the reason), the
 * session join once the transfer ingested. This is the poll the Create
 * Studio's transfer step runs — every state shown is the machine's own
 * record, never an interpolated one.
 *
 * Owner-only: any other caller (or an unknown id) answers the SAME uniform
 * 404 — no existence oracle.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ registrationId: string }> },
): Promise<Response> {
  try {
    const server = await getSportaServer();
    await server.ready;
    const token = tokenFromRequest(request);
    if (token === "") {
      const { IdentityUnauthenticatedError } = await import("@sporta/identity");
      throw new IdentityUnauthenticatedError();
    }
    const { registrationId } = await context.params;
    const registration = await server.urlSources.registration(token, registrationId);
    return jsonResponse(200, registration);
  } catch (err) {
    return errorResponse(err);
  }
}
