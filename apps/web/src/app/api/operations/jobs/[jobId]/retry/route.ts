import { getSportaServer } from "@/server/runtime";
import { tokenFromRequest } from "@/server/auth-service";
import { errorResponse, jsonResponse } from "@/server/http-errors";

export const dynamic = "force-dynamic";

/**
 * POST /api/operations/jobs/[jobId]/retry — the console's SAFE remediation
 * for a FAILED job (W918).
 *
 * Re-dispatches the job through the REAL studio dispatch path: a NEW job
 * id (never a status flip — the failed job stays in the ledger), the full
 * W913 admission ladder (the operator's own per-user render quota is
 * charged, bounded-queue admission enforced — an exhausted quota or a full
 * queue answers the honest 429/503, there is no bypass), and the same
 * identity gate as any dispatch. The action is audit-logged in BOTH
 * outcomes. OPERATOR GRANT REQUIRED.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ jobId: string }> },
): Promise<Response> {
  try {
    const server = await getSportaServer();
    await server.ready;
    const token = tokenFromRequest(request);
    if (token === "") {
      const { IdentityUnauthenticatedError } = await import("@sporta/identity");
      throw new IdentityUnauthenticatedError();
    }
    const { jobId } = await context.params;
    const result = await server.operations.retryFailedJob(token, jobId);
    return jsonResponse(200, result);
  } catch (err) {
    return errorResponse(err);
  }
}
