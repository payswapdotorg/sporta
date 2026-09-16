import { getSportaServer } from "@/server/runtime";
import { tokenFromRequest } from "@/server/auth-service";
import { errorResponse, jsonResponse } from "@/server/http-errors";

export const dynamic = "force-dynamic";

/**
 * POST /api/operations/jobs/[jobId]/cancel — the console's SAFE remediation
 * for an admitted job (W918).
 *
 * Runs the compute adapter's REAL `cancel` (idempotent, never loses a job —
 * a racing provider report is accounted superseded) and returns the
 * bounded-queue admission slot immediately. A terminal job is an honest
 * counted no-op answering the existing disposition (both outcomes
 * audit-logged). OPERATOR GRANT REQUIRED.
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
    const result = await server.operations.cancelAdmittedJob(token, jobId);
    return jsonResponse(200, result);
  } catch (err) {
    return errorResponse(err);
  }
}
