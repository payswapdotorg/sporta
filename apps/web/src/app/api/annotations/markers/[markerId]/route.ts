import { getSportaServer } from "@/server/runtime";
import { tokenFromRequest } from "@/server/auth-service";
import { errorResponse, jsonResponse } from "@/server/http-errors";

export const dynamic = "force-dynamic";

/**
 * GET /api/annotations/markers/[markerId] — the J010 revisit drill-down: one
 * saved marker WITH its attached notes (the author + timestamp on each).
 * Access is the domain seam's own rule over the marker's session (the
 * `analyst-annotation.read` identity action); an unknown marker answers the
 * honest 404 (marker-unknown, the closed vocabulary). The answer carries the
 * marker's time range + backing reference and the notes' text — never any
 * media bytes.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ markerId: string }> },
): Promise<Response> {
  try {
    const server = await getSportaServer();
    await server.ready;
    const { markerId } = await context.params;
    const model = await server.annotations.getMarker(tokenFromRequest(request), markerId);
    return jsonResponse(200, model);
  } catch (err) {
    return errorResponse(err);
  }
}
