import { getSportaServer } from "@/server/runtime";
import { tokenFromRequest } from "@/server/auth-service";
import { errorResponse, jsonResponse } from "@/server/http-errors";

export const dynamic = "force-dynamic";

/**
 * GET /api/create/options — the Create Studio's opening document (W906):
 * the authorized sources (the checked-in fixture library the dev seed
 * drives — real engine inputs), the REAL renderer registry (honestly
 * annotated for the compute path's artifact handoff), the rights-declaration
 * vocabulary (the W701/W902 policy shape), the honest upload answer, and the
 * compute plane the async renders dispatch through.
 *
 * Session-authorized: creation requires a verified identity, so the options
 * are served to authenticated callers only (401 otherwise — the UI shows
 * the sign-in state, never a fake studio).
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const server = await getSportaServer();
    await server.ready;
    const token = tokenFromRequest(request);
    if (token === "") {
      // The uniform unauthenticated answer (identity's own class → 401).
      const { IdentityUnauthenticatedError } = await import("@sporta/identity");
      throw new IdentityUnauthenticatedError();
    }
    await server.gate.requireAccount(token);
    const options = await server.studio.listOptions(token);
    return jsonResponse(200, options);
  } catch (err) {
    return errorResponse(err);
  }
}
