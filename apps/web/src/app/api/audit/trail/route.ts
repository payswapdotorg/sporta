import { getSportaServer } from "@/server/runtime";
import { tokenFromRequest } from "@/server/auth-service";
import { errorResponse, jsonResponse } from "@/server/http-errors";

export const dynamic = "force-dynamic";

/**
 * GET /api/audit/trail — the J009 rights-audit discoverability surface: the
 * caller's REAL rights audit trail through the role-gated domain query seam
 * (`@sporta/session`'s rights-audit-query — the append-only log's
 * domain-vocabulary entries with the J008 editKind classification).
 *
 * - `?session=<id>` focuses on ONE session's trail (`auditTrailFor`: the
 *   session's owner and operators reach it; everyone else the uniform 403 —
 *   no existence oracle);
 * - without the parameter the answer is the caller's WORKSPACE scope
 *   (`auditTrailInScope`: a rights holder reaches their OWN sessions'
 *   trails, an operator every trail, every other role the honest 403).
 *
 * Anonymous callers get the real 401. Publication-visibility events are not
 * in this trail (they are W916 publication decisions — the Rights Center's
 * policy console trail carries them, and the audit surface links there).
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const server = await getSportaServer();
    await server.ready;
    const sessionId = new URL(request.url).searchParams.get("session");
    const model =
      sessionId === null
        ? await server.rightsAuditTrail.trail(tokenFromRequest(request))
        : await server.rightsAuditTrail.trailFor(tokenFromRequest(request), sessionId);
    return jsonResponse(200, model);
  } catch (err) {
    return errorResponse(err);
  }
}
