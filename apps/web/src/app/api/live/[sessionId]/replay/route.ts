import { getSportaServer } from "@/server/runtime";
import { errorResponse, jsonResponse } from "@/server/http-errors";
import { tokenFromRequest } from "@/server/auth-service";

export const dynamic = "force-dynamic";

/**
 * GET /api/live/[sessionId]/replay — THE LIVE/REPLAY CONTINUITY RECORD
 * (L014, presentation side): the completed live window's RECORDED world
 * frames, served verbatim so the SAME tactical/3D surfaces replay the
 * recorded session state through the SAME view-model contracts after the
 * live window (no second presentation path, no re-stamped versions).
 *
 * WHAT THIS SERVES (the frozen live-reality.md §8 replay-continuity rule as
 * the presentation layer delivers it): the exact `LiveWorldFrameDoc`s the
 * live surface rendered — ordinals, world versions, watermarks and event
 * times UNCHANGED. The client-side continuity derivations
 * (`apps/web/src/lib/live-replay.ts`) assert the alignment (monotone world
 * versions, ascending ordinals, non-decreasing event times + watermarks) and
 * the replay UI shows them — the continuity is VISIBLE, never asserted
 * blindly.
 *
 * AUTHORIZED, FAIL-CLOSED BEFORE BYTES (the live route's own posture):
 *
 * 1. the transport is env-active — else the typed 503;
 * 2. a valid identity token — else 401;
 * 3. the session exists in the REAL control plane — else its typed 404;
 * 4. the session's policy-derived `canDeliverLive` — else 403 (the replay
 *    serves the LIVE-delivery content after the window; the same delivery
 *    right governs it at this seam — the platform-side replay rights
 *    refinement is Worker B's L014 lane, recorded as the boundary);
 * 5. the transport's replay record answers:
 *    - `complete` → 200 with the record (the frames + the honest meta);
 *    - `live-window-open` → 409 (the window has not ended — replay is not
 *      available yet, honestly);
 *    - `no-record` → 200 with the empty record (no finite window has run on
 *      this transport instance — the client falls back to the live view);
 *    - no registered source at all → the typed 404 `live-source-unknown`.
 *
 * HONEST BOUNDARY (the platform seam): the record is the transport's own
 * in-memory record of THIS instance's live window — durable persistence and
 * cross-restart recovery of live observations/world versions is Worker B's
 * L014 platform lane. A restart honestly answers `no-record` until a new
 * window runs.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
): Promise<Response> {
  const server = await getSportaServer();
  await server.ready;
  const { sessionId } = await context.params;
  const live = server.live;

  // 1. The transport's own state (env-gated) — typed 503.
  if (live.state() !== "active") {
    return jsonResponse(503, {
      error: {
        failureClass: "live-transport-not-configured",
        message:
          "the live transport is not configured on this deployment (SPORTA_LIVE_TRANSPORT is not set to sse) — live replay stays honestly unavailable",
      },
    });
  }

  // 2. The W902 identity surface: a valid session token (cookie or bearer).
  const token = tokenFromRequest(request);
  if (token.length === 0) {
    return jsonResponse(401, {
      error: {
        failureClass: "auth-required",
        message: "live replay requires an authenticated session",
      },
    });
  }
  const identity = await server.auth.resolve(token);
  if (identity === null) {
    return jsonResponse(401, {
      error: {
        failureClass: "auth-invalid",
        message: "the presented session token is not usable — re-authenticate for live replay",
      },
    });
  }

  // 3. The session exists (the control plane's own typed 404).
  let rightsCapabilities: { canDeliverLive: boolean };
  try {
    const session = await server.control.getSession(sessionId);
    rightsCapabilities = session.rightsCapabilities;
  } catch (err) {
    return await errorResponse(err);
  }

  // 4. The live-delivery rights (fail-closed — the recorded live content is
  //    governed by the same delivery right at this presentation seam).
  if (!rightsCapabilities.canDeliverLive) {
    return jsonResponse(403, {
      error: {
        failureClass: "rights-denied",
        message:
          "this session's policy does not authorize live delivery (canDeliverLive is false) — the recorded live window is refused",
      },
    });
  }

  // 5. The transport's replay record (the honest state machine answer).
  const record = live.replayRecord(sessionId);
  if (record === null) {
    return jsonResponse(404, {
      error: {
        failureClass: "live-source-unknown",
        message:
          "no live source is registered for this session — there is no live window to replay",
      },
    });
  }
  if (record.state === "live-window-open") {
    return jsonResponse(409, {
      error: {
        failureClass: "live-window-open",
        message:
          "this session's live window is still open — replay becomes available when the window completes (watch it live first)",
        deliveredFrames: record.frames.length,
      },
    });
  }
  return jsonResponse(200, record);
}
