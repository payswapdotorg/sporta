import { getSportaServer } from "@/server/runtime";
import { tokenFromRequest } from "@/server/auth-service";
import { errorResponse, jsonResponse } from "@/server/http-errors";

export const dynamic = "force-dynamic";

/**
 * POST /api/account/compute/connections/[providerId]/verify — THE VERIFY
 * ACTION (J005): drives the provider adapter's REAL `verifyCredentials()`
 * call (ONE authenticated provider call: connectivity + credentials) and
 * records the honest answer:
 *
 * - `verified` → the record flips to `connected-verified`;
 * - a provider rejection → `connected-invalid` (the honest observed state);
 * - verification could not complete (network/timeout) →
 *   `connected-unverified` (an unreachable provider proves NOTHING about a
 *   credential — never a fabricated verdict).
 *
 * Requires an authenticated caller (401 anonymous).
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ providerId: string }> },
): Promise<Response> {
  try {
    const server = await getSportaServer();
    await server.ready;
    const token = tokenFromRequest(request);
    if (token === "") {
      const { IdentityUnauthenticatedError } = await import("@sporta/identity");
      throw new IdentityUnauthenticatedError();
    }
    const { providerId } = await context.params;
    const record = await server.computeCenter.verify(token, providerId);
    return jsonResponse(200, { outcome: "verified", record });
  } catch (err) {
    return errorResponse(err);
  }
}
