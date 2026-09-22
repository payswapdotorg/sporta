import { getSportaServer } from "@/server/runtime";
import { tokenFromRequest } from "@/server/auth-service";
import { errorResponse, jsonResponse, readJsonBody } from "@/server/http-errors";

export const dynamic = "force-dynamic";

/**
 * POST /api/annotations/notes — attaches ONE note to a saved marker through
 * the J010 domain seam (the `analyst-annotation.write` identity action over
 * the marker's session). Body: `{ markerId, text }` (non-empty, at most 4000
 * characters — the domain's own bound).
 *
 * The note is first-class and persisted: the author is the VERIFIED account
 * id (never a caller claim), the timestamp is the composition's clock. An
 * unknown marker answers the honest 404 (marker-unknown); a caller without
 * the owner/operator/analyst standing the uniform 403; anonymous callers the
 * real 401.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const server = await getSportaServer();
    await server.ready;
    const body = await readJsonBody(request);
    const note = await server.annotations.attachNote(tokenFromRequest(request), body);
    return jsonResponse(201, note);
  } catch (err) {
    return errorResponse(err);
  }
}
