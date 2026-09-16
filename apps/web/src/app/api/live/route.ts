import { getSportaServer } from "@/server/runtime";
import { jsonResponse } from "@/server/http-errors";

export const dynamic = "force-dynamic";

/**
 * GET /api/live — the live sources list (W915): which live-authorized
 * sessions the SSE transport is REALLY serving right now.
 *
 * The answer is the transport's own state — `available` with a
 * `live-network` transport kind ONLY while `SPORTA_LIVE_TRANSPORT=sse` is
 * set AND a registered live source exists; otherwise the honest unavailable
 * answer (never a simulated live badge). Opening a stream additionally
 * requires a valid identity + the session's live-delivery rights (checked
 * fail-closed at `/api/live/[sessionId]` BEFORE any byte).
 */
export async function GET(): Promise<Response> {
  const server = await getSportaServer();
  await server.ready;
  const live = server.live;
  if (live.state() !== "active") {
    return jsonResponse(200, {
      available: false,
      transportKind: "none",
      detail: live.detail(),
      sources: [],
    });
  }
  const sources = live.listSources().map((source) => ({
    sessionId: source.sessionId,
    label: source.label,
    storyKey: source.storyKey,
  }));
  return jsonResponse(200, {
    available: sources.length > 0,
    transportKind: sources.length > 0 ? "live-network" : "none",
    detail: live.detail(),
    sources,
  });
}
