import { getSportaServer } from "@/server/runtime";
import { tokenFromRequest } from "@/server/auth-service";
import { errorResponse, jsonResponse } from "@/server/http-errors";

export const dynamic = "force-dynamic";

/**
 * GET /api/account/compute — THE COMPUTE CENTER STATUS (J005): the
 * account's compute destination document over the REAL connection-center
 * plane:
 *
 * - `sportaPlane` — the deployment's Sporta-managed compute (the same
 *   plane the Create Studio's "Let the platform choose" mode uses);
 * - `providers` — every BYOC provider in the connection plane with its
 *   honest posture (`connected-verified | connected-unverified |
 *   connected-invalid | disconnected | never-connected`), its abstract
 *   descriptor summary, its accepted scoped-credential kinds, and its
 *   execution-zone framing (the Sporta-vs-BYOC distinction);
 * - `goals` — the goal-oriented selection language (no infrastructure
 *   jargon required to choose);
 * - `credentialPolicy` — the honest master-password refusal posture;
 * - `quotas`/`usage` — the caller's compute allowance states and the
 *   plane's metered usage totals (the SAME R506 seams the Create Studio's
 *   compute step reads — one consistent UX, no second truth).
 *
 * Requires an authenticated caller (401 anonymous — the account surface's
 * own rule).
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const server = await getSportaServer();
    await server.ready;
    const token = tokenFromRequest(request);
    if (token === "") {
      const { IdentityUnauthenticatedError } = await import("@sporta/identity");
      throw new IdentityUnauthenticatedError();
    }
    const status = await server.computeCenter.status(token);
    return jsonResponse(200, status);
  } catch (err) {
    return errorResponse(err);
  }
}
