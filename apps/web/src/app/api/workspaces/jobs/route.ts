import { getSportaServer } from "@/server/runtime";
import { tokenFromRequest } from "@/server/auth-service";
import { buildJobsOverview } from "@/server/workspace-service";
import { errorResponse, jsonResponse } from "@/server/http-errors";

export const dynamic = "force-dynamic";

/**
 * GET /api/workspaces/jobs — the Jobs workspace (Creator + Operator): the
 * account's sessions with their dispatched jobs' REAL compute state (every
 * session re-read through the studio's owner/operator rule — the active role
 * is never consulted). Anonymous callers get the real 401; accounts without
 * a creator or operator grant get the REAL 403 with the explanation.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const server = await getSportaServer();
    await server.ready;
    const model = await buildJobsOverview(server, tokenFromRequest(request));
    return jsonResponse(200, model);
  } catch (err) {
    return errorResponse(err);
  }
}
