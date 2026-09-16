import { getSportaServer } from "@/server/runtime";
import { tokenFromRequest } from "@/server/auth-service";
import { errorResponse, jsonResponse, readJsonBody } from "@/server/http-errors";

export const dynamic = "force-dynamic";

/**
 * POST /api/rights/policies/[sessionId]/revocation — REVOKES the session's
 * rights (the core W917 acceptance). Optional body: `{ reason?: string }`
 * (audited with the revocation).
 *
 * The revocation takes the effective policy out of force (its
 * `expiresAtIso` = the revocation moment — the contracts' own time-bound, so
 * every later `deriveRightsCapabilities` answers DENY_ALL) AND sets the
 * publication decision to `private` (the catalog, search and the anonymous
 * watch surface stop serving the session). Playback, rendering and live
 * delivery stop immediately, fail-closed, enforced by the EXISTING gates —
 * one audit entry records both effects.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
): Promise<Response> {
  try {
    const server = await getSportaServer();
    await server.ready;
    const { sessionId } = await context.params;
    const body = await readJsonBody(request);
    let reason: string | undefined;
    if (body !== null) {
      if (typeof body !== "object" || Array.isArray(body) || !("reason" in body)) {
        const { IdentityValidationError } = await import("@sporta/identity");
        throw new IdentityValidationError("request body must be { reason?: string }");
      }
      const raw = (body as Record<string, unknown>).reason;
      if (raw !== undefined && raw !== null) {
        if (typeof raw !== "string" || raw.length > 500) {
          const { IdentityValidationError } = await import("@sporta/identity");
          throw new IdentityValidationError("reason must be a string of at most 500 characters");
        }
        reason = raw;
      }
    }
    const model = await server.rights.revoke(tokenFromRequest(request), sessionId, reason);
    return jsonResponse(200, model);
  } catch (err) {
    return errorResponse(err);
  }
}
