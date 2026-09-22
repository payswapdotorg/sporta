import { getSportaServer } from "@/server/runtime";
import { tokenFromRequest } from "@/server/auth-service";
import { errorResponse, jsonResponse, readJsonBody } from "@/server/http-errors";

export const dynamic = "force-dynamic";

/**
 * GET /api/annotations/markers?session=<id> — the J010 revisit seam: the
 * session's saved media-time markers (moments + clip intervals — time ranges
 * and backing references ONLY, never clip bytes) plus the session's REAL
 * timeline state (the durable SourceAsset's durationMs, or the honest
 * no-timeline state for sessions without real media).
 *
 * Access is the domain seam's own rule (the `analyst-annotation.read`
 * identity action): the session's owner, an operator, or the analyst grant.
 * Anonymous callers get the real 401; other callers the uniform 403 (no
 * existence oracle).
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const server = await getSportaServer();
    await server.ready;
    const sessionId = new URL(request.url).searchParams.get("session");
    if (sessionId === null || sessionId.length === 0) {
      return jsonResponse(400, {
        error: {
          failureClass: "validation",
          message: "the markers list requires a ?session= parameter",
        },
      });
    }
    const model = await server.annotations.listMarkers(tokenFromRequest(request), sessionId);
    return jsonResponse(200, model);
  } catch (err) {
    return errorResponse(err);
  }
}

/**
 * POST /api/annotations/markers — saves ONE media-time marker through the
 * J010 domain seam (the `analyst-annotation.write` identity action — the
 * session's owner, an operator, or the analyst grant). Body:
 * `{ sessionId, kind: "moment" | "clip", atMs? | startMs?+endMs?, label?,
 * backing? }` (an omitted backing rides the session's own real timeline).
 *
 * The domain seam performs the REAL backing checks and answers the closed
 * refusal vocabulary typed: `session-unknown`, `no-timeline` (the session
 * has no real media timeline), `out-of-range`, `render-unknown`,
 * `render-lookup-unavailable` — each carrying a useful next action. A saved
 * marker is a TIME RANGE + backing reference: there are NO clip bytes (a
 * later rendering lane would cut them from the real media; this seam never
 * fabricates media).
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const server = await getSportaServer();
    await server.ready;
    const body = await readJsonBody(request);
    const marker = await server.annotations.saveMarker(tokenFromRequest(request), body);
    return jsonResponse(201, marker);
  } catch (err) {
    return errorResponse(err);
  }
}
