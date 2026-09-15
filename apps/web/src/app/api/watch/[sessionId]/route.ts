import { getSportaServer } from "@/server/composition";
import { buildWatchModel } from "@/server/catalog-service";
import { errorResponse, jsonResponse } from "@/server/http-errors";

export const dynamic = "force-dynamic";

/**
 * GET /api/watch/[sessionId] — the playback-session acquisition: the real
 * session info, the REAL fail-closed playback-rights decision, the render
 * list with stored-output availability, and (for seeded sessions) the
 * labeled dev-seed story data. Unknown sessions answer the control plane's
 * own 404.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ sessionId: string }> },
): Promise<Response> {
  try {
    const server = await getSportaServer();
    await server.ready;
    const { sessionId } = await context.params;
    const model = await buildWatchModel(server, sessionId);
    return jsonResponse(200, model);
  } catch (err) {
    return errorResponse(err);
  }
}
