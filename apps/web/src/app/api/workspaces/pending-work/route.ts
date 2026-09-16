import { getSportaServer } from "@/server/runtime";
import { tokenFromRequest } from "@/server/auth-service";
import { buildPendingWork } from "@/server/workspace-service";
import { errorResponse, jsonResponse } from "@/server/http-errors";

export const dynamic = "force-dynamic";

/**
 * GET /api/workspaces/pending-work — the role switcher's pending-work badges,
 * computed from the REAL data planes (creator: jobs in flight across the
 * account's own sessions; operator: failed jobs). ONLY roles the account
 * holds ever carry a badge — there is no viewer/analyst/rights-holder
 * pending-work data plane, so those roles carry none (honest absence).
 * Anonymous callers get the real 401.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const server = await getSportaServer();
    await server.ready;
    const model = await buildPendingWork(server, tokenFromRequest(request));
    return jsonResponse(200, model);
  } catch (err) {
    return errorResponse(err);
  }
}
