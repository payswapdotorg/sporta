import { getSportaServer } from "@/server/runtime";
import { tokenFromRequest } from "@/server/auth-service";
import { errorResponse, jsonResponse } from "@/server/http-errors";

export const dynamic = "force-dynamic";

/**
 * GET /api/create/sessions/[sessionId]/jobs/[jobId] — the studio's PROGRESS
 * surface (W906): the control plane's own `getComputeJob` projection — the
 * REAL job state (admitted/dispatched/queued/in-flight/succeeded/failed/
 * cancelled/dead-lettered), the decision/progress event trail, and once
 * terminal the never-silent input accounting, the metered usage record, the
 * measured timing, and the ingested render id. No invented progress.
 *
 * Owner/operator only; a job id from another session answers the control
 * plane's session-scoped 404 (no cross-session probing).
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ sessionId: string; jobId: string }> },
): Promise<Response> {
  try {
    const server = await getSportaServer();
    await server.ready;
    const token = tokenFromRequest(request);
    if (token === null) {
      const { IdentityUnauthenticatedError } = await import("@sporta/identity");
      throw new IdentityUnauthenticatedError();
    }
    const { sessionId, jobId } = await context.params;
    const job = await server.studio.jobState(token, sessionId, jobId);
    return jsonResponse(200, job);
  } catch (err) {
    return errorResponse(err);
  }
}
