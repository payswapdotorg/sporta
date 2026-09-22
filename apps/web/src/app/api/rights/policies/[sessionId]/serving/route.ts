import { getSportaServer } from "@/server/runtime";
import { tokenFromRequest } from "@/server/auth-service";
import { errorResponse, jsonResponse } from "@/server/http-errors";

export const dynamic = "force-dynamic";

/**
 * GET /api/rights/policies/[sessionId]/serving — the J008 serving-state
 * check (the revocation's end-to-end proof, run from the Rights Center's
 * UI): the watch surface's CURRENT playback verdict (the rights-governed
 * control plane's re-derivation) PLUS the J008 revocation-aware serving
 * seam's answer for a caller still holding the CREATION-TIME policy —
 * after a revocation the read throws the REAL `PlaybackRightsDeniedError`
 * (the message rides verbatim), before one the seam serves.
 *
 * Requires policy access for the session (owner / attesting rights holder /
 * operator — the same rule every other rights route applies); anonymous
 * callers get the real 401.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
): Promise<Response> {
  try {
    const server = await getSportaServer();
    await server.ready;
    const { sessionId } = await context.params;
    const model = await server.rights.checkServing(tokenFromRequest(request), sessionId);
    return jsonResponse(200, model);
  } catch (err) {
    return errorResponse(err);
  }
}
