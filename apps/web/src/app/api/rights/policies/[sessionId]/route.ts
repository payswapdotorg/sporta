import { getSportaServer } from "@/server/runtime";
import { tokenFromRequest } from "@/server/auth-service";
import { errorResponse, jsonResponse, readJsonBody } from "@/server/http-errors";

export const dynamic = "force-dynamic";

/**
 * GET /api/rights/policies/[sessionId] — inspects ONE session's rights +
 * publication state and its policy-change audit trail. Requires rights
 * access for that session (owner / attesting rights holder / operator);
 * everyone else receives the uniform 403 whether or not the session exists
 * (no existence oracle). Anonymous callers get the real 401.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
): Promise<Response> {
  try {
    const server = await getSportaServer();
    await server.ready;
    const { sessionId } = await context.params;
    const model = await server.rights.inspectPolicy(tokenFromRequest(request), sessionId);
    return jsonResponse(200, model);
  } catch (err) {
    return errorResponse(err);
  }
}

/**
 * PATCH /api/rights/policies/[sessionId] — EDITS the session's rights
 * policy. Body: `{ authorizationPolicy: { policyId, allowedOperations,
 * assertedBy?, expiresAtIso?, storageDurationDays?, sharingScope? } }`.
 *
 * The policy is validated by the REAL `AuthorizationPolicy` contract schema
 * (malformed → 400, never applied), re-attested with the EDITOR's verified
 * account id (a caller never asserts `assertedBy`), stored as the session's
 * policy override, and audited. Narrowing edits take effect on every
 * subsequent rights read (fail-closed re-derivation); an edit can never
 * WIDEN access past the control plane's creation-time attestation.
 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
): Promise<Response> {
  try {
    const server = await getSportaServer();
    await server.ready;
    const { sessionId } = await context.params;
    const body = await readJsonBody(request);
    if (
      body === null ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      !("authorizationPolicy" in body)
    ) {
      const { IdentityValidationError } = await import("@sporta/identity");
      throw new IdentityValidationError(
        "request body must be { authorizationPolicy: AuthorizationPolicy }",
      );
    }
    const model = await server.rights.setPolicy(
      tokenFromRequest(request),
      sessionId,
      (body as Record<string, unknown>).authorizationPolicy,
    );
    return jsonResponse(200, model);
  } catch (err) {
    return errorResponse(err);
  }
}
