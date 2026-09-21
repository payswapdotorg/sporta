import { getSportaServer } from "@/server/runtime";
import { errorResponse, jsonResponse } from "@/server/http-errors";
import { tokenFromRequest } from "@/server/auth-service";
import { SSE_KEEPALIVE, SSE_KEEPALIVE_INTERVAL_MS } from "@/lib/live-sse";

export const dynamic = "force-dynamic";

/**
 * GET /api/live/[sessionId] — THE LIVE SSE STREAM (W915): one really
 * authorized live source, streamed over the real HTTP network as
 * Server-Sent-Events — the genuine live-network transport for SVG-frame
 * streams (WebRTC needs a media server this deployment does not have; SSE
 * is the honest real-time HTTP transport for frame documents, browser-native
 * through `EventSource`).
 *
 * AUTHORIZED PLAYBACK, FAIL-CLOSED BEFORE BYTES — not one SSE byte leaves
 * the process before EVERY check below passes (each answers its honest
 * JSON error instead of opening the stream):
 *
 * 1. the transport is env-active (`SPORTA_LIVE_TRANSPORT=sse`) — else the
 *    typed 503 (`live-transport-not-configured`);
 * 2. the W902 identity surface: a valid session token (cookie or bearer) —
 *    else 401 (a presented-but-unusable token is 401 too, never anonymous
 *    live);
 * 3. the session exists in the REAL control plane — else its own typed 404;
 * 4. the W704 live-delivery rights: the session's policy-derived
 *    `canDeliverLive` — else 403 `rights-denied`;
 * 5. the transport has a registered live source for it — else 404
 *    `live-source-unknown`.
 *
 * THEN the stream opens: `hello` (the real session meta), one `frame`
 * event per real cadence tick (each a FRESH real render — see
 * `src/server/live/producer.ts`), a `: keepalive` comment every 15 s of
 * silence, and a terminal `close` event with the honest accounting. Every
 * frame carries `generatedAtMs` (the server's real clock read AFTER the
 * render) — the consumer measures the end-to-end latency against its own
 * real receipt clock (never a promise; the clocks are unsynchronized, which
 * the UI documents wherever the number is shown).
 *
 * L014: a FINITE live source ends its window with the `live-window-complete`
 * close reason — after that this route answers 410 Gone and points at the
 * replay record (the recorded world frames, replayable through the same
 * views at `/api/live/[sessionId]/replay`).
 *
 * Vercel boundary (honest): the hosted Hobby deployment does NOT enable
 * this transport (serverless request-duration caps would cut streams);
 * it serves on any real HTTP host (local, bare-metal, an edge worker
 * later). The env flag is never set just to light the UI up.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
): Promise<Response> {
  const server = await getSportaServer();
  await server.ready;
  const { sessionId } = await context.params;
  const live = server.live;

  // 1. The transport's own state (env-gated) — typed 503, no bytes.
  if (live.state() !== "active") {
    return jsonResponse(503, {
      error: {
        failureClass: "live-transport-not-configured",
        message:
          "the live transport is not configured on this deployment (SPORTA_LIVE_TRANSPORT is not set to sse) — live stays honestly unavailable",
      },
    });
  }

  // 2. The W902 identity surface: a valid session token (cookie or bearer).
  //    EventSource cannot set headers, so the browser path is the cookie.
  const token = tokenFromRequest(request);
  if (token.length === 0) {
    return jsonResponse(401, {
      error: {
        failureClass: "auth-required",
        message: "live playback requires an authenticated session",
      },
    });
  }
  const identity = await server.auth.resolve(token);
  if (identity === null) {
    return jsonResponse(401, {
      error: {
        failureClass: "auth-invalid",
        message: "the presented session token is not usable — re-authenticate for live playback",
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

  // 4. The W704 live-delivery rights (fail-closed).
  if (!rightsCapabilities.canDeliverLive) {
    return jsonResponse(403, {
      error: {
        failureClass: "rights-denied",
        message:
          "this session's policy does not authorize live delivery (canDeliverLive is false) — the stream is refused before any byte",
      },
    });
  }

  // 5. The transport's registered live source for this session. L014: a
  //    COMPLETED finite live window is the honest terminal answer — the
  //    stream is over (410 Gone) and the replay record is the continuation
  //    (the same session, the same world versions/timecodes, replayable
  //    through the same views).
  const replay = live.replayRecord(sessionId);
  if (replay !== null && replay.state === "complete") {
    return jsonResponse(410, {
      error: {
        failureClass: "live-window-complete",
        message:
          "this session's live window has completed — the stream is over, and the recorded session state replays through the same views",
        replayPath: `/api/live/${encodeURIComponent(sessionId)}/replay`,
        deliveredFrames: replay.meta?.deliveredFrames ?? 0,
        worldVersionLast: replay.meta?.worldVersionLast ?? 0,
      },
    });
  }
  const subscriber = live.subscribe(sessionId);
  if (subscriber === null) {
    return jsonResponse(404, {
      error: {
        failureClass: "live-source-unknown",
        message:
          "no live source is registered for this session (the dev seed registers live-authorized sessions; this one is not one)",
      },
    });
  }

  // 6. The stream itself: SSE bytes over the real network. The pump pulls
  //    the transport's pre-encoded event blocks and enqueues them; the
  //    keepalive defeats idle proxies; the abort/cancel paths close the
  //    subscriber (the channel stops ticking when its last subscriber
  //    leaves — no orphaned generation loops).
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const cleanup = (): void => {
        if (closed) return;
        closed = true;
        subscriber.close();
        try {
          controller.close();
        } catch {
          // Already closed by the consumer — nothing to do.
        }
      };
      request.signal.addEventListener("abort", cleanup);

      const pump = async (): Promise<void> => {
        try {
          let pending: string | null = await subscriber.nextEvent();
          while (!closed && pending !== null) {
            controller.enqueue(encoder.encode(pending));
            // Race the next event against the keepalive interval; the
            // pending pull is NEVER abandoned (it resolves eventually and
            // the loop continues with its result).
            const next = subscriber.nextEvent();
            const keepalive = sleep(SSE_KEEPALIVE_INTERVAL_MS);
            const winner = await Promise.race([next, keepalive.promise]);
            if (winner === KEEPALIVE_SENTINEL) {
              controller.enqueue(encoder.encode(SSE_KEEPALIVE));
              pending = await next;
              continue;
            }
            keepalive.cancel();
            pending = winner as string | null;
          }
        } catch {
          // A broken pipe (consumer gone): close the subscriber.
        } finally {
          cleanup();
        }
      };
      void pump();
    },
    cancel() {
      subscriber.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}

const KEEPALIVE_SENTINEL = Symbol("keepalive");

/** A cancellable sleep that races the pending event pull. */
function sleep(ms: number): { promise: Promise<typeof KEEPALIVE_SENTINEL>; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const promise = new Promise<typeof KEEPALIVE_SENTINEL>((resolve) => {
    timer = setTimeout(() => resolve(KEEPALIVE_SENTINEL), ms);
  });
  return {
    promise,
    cancel: () => {
      if (timer !== undefined) clearTimeout(timer);
    },
  };
}
