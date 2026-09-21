import { getSportaServer } from "@/server/runtime";
import { tokenFromRequest } from "@/server/auth-service";
import { errorResponse, jsonResponse } from "@/server/http-errors";

export const dynamic = "force-dynamic";

/**
 * GET /api/operations/live-telemetry — THE LIVE TELEMETRY SURFACE (L006):
 * the frozen live-reality.md §9 counters for every instrumented live
 * session, collected at the REAL pipeline seams (the live source → the
 * ingest seam → the world-state stage → the frame render → the transport
 * delivery boundary), with dropped/extrapolated updates and renderer frame
 * drops VISIBLE as counted facts.
 *
 * The answer is the telemetry service's own §9 snapshots — one per live
 * session that carries a telemetry probe (the tactical tracking path).
 * Story-timeline channels carry no probe and answer no entry (the honest
 * absence, never an invented measurement). The transport's own state line
 * rides alongside so the operator sees which delivery lane is serving.
 *
 * OPERATOR GRANT REQUIRED (the identity layer's `provider-health.read`
 * action — the console's one access rule): non-operators get the real
 * typed 403, anonymous callers the typed 401.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const server = await getSportaServer();
    await server.ready;
    const token = tokenFromRequest(request);
    if (token === "") {
      const { IdentityUnauthenticatedError } = await import("@sporta/identity");
      throw new IdentityUnauthenticatedError();
    }
    await server.operations.requireOperator(token);
    const sessions = server.liveTelemetry.snapshots();
    return jsonResponse(200, {
      /** Which §9 vocabulary this surface serves (the frozen contract's own list). */
      counters: [
        "source-to-ingest-latency",
        "ingest-to-swm-latency",
        "swm-to-render-latency",
        "end-to-end-presentation-latency",
        "watermark-lag",
        "dropped-observations",
        "extrapolated-observations",
        "identity-switches",
        "reconnects",
        "renderer-frame-drops",
        "effective-update-rate",
      ],
      /** The delivery lane's own honest state (the transport's line). */
      transport: { state: server.live.state(), detail: server.live.detail() },
      /** One §9 snapshot per instrumented live session. */
      sessions,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
