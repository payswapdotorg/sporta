import { getSportaServer } from "@/server/runtime";
import { tokenFromRequest } from "@/server/auth-service";
import { AuthFlowError } from "@/server/auth-service";
import { buildOperations } from "@/server/operations-service";
import { errorResponse, jsonResponse } from "@/server/http-errors";
import { authorize } from "@sporta/identity";

export const dynamic = "force-dynamic";

/**
 * GET /api/operations — the Operator workspace's Operations document: REAL
 * platform health, providers, compute, live-transport state and failed jobs
 * (queues honestly unavailable until a surface exists).
 *
 * ACCESS IS THE REAL IDENTITY POLICY — the frozen operator-gated action
 * `provider-health.read`, decided from the account's GRANTS (never the
 * session's active role, which is presentation context only): anonymous
 * callers get the real 401, non-operators the policy's own 403 with the
 * `role-not-granted` reason surfaced as the explanation.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const server = await getSportaServer();
    await server.ready;
    const token = tokenFromRequest(request);
    const resolved = await server.auth.resolve(token);
    if (resolved === null) {
      throw new AuthFlowError(401, "unauthenticated", "operations requires a signed-in account");
    }
    const decision = authorize(resolved.account, "provider-health.read");
    if (!decision.allowed) {
      throw new AuthFlowError(
        403,
        "permission-denied",
        "operations requires the operator grant (the identity policy denied provider-health.read)",
        { action: "provider-health.read", reason: decision.reason },
      );
    }
    const model = await buildOperations(server, token);
    return jsonResponse(200, model);
  } catch (err) {
    return errorResponse(err);
  }
}
