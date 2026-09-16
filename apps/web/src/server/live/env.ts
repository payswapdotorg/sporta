/**
 * The live transport's ENV CONTRACT (W915) — the composition-root reads
 * (documented, the only env access in this lane; tests inject the transport
 * directly through the composition options instead).
 *
 * - `SPORTA_LIVE_TRANSPORT=sse` → the live transport is ACTIVE: the
 *   `/api/live/*` routes serve REAL SSE streams over the real HTTP network,
 *   and the capability response reports `modes.live` available with
 *   `transportKind: "live-network"` — because it genuinely is.
 * - Absent (or any other value) → the transport is UNAVAILABLE: routes
 *   answer the typed 503, capability reports the honest unavailable state,
 *   and NOTHING anywhere is labelled live (Simulation F holds).
 *
 * DEPLOYMENT BOUNDARY (honest): the hosted Vercel Hobby deployment does
 * NOT set this variable this wave — Vercel's serverless functions cap
 * request duration (Hobby: 60s), which would cut every live stream off;
 * the transport serves long-lived streams on any real HTTP host (local,
 * bare-metal, an edge worker later). Deployed-live validation with a
 * suitable host is a later wave; this flag is never set just to make the
 * UI light up.
 *
 * - `SPORTA_LIVE_CADENCE_MS` — the real emission cadence (default 500 ms,
 *   bounds 100..5000). One real renderer execution per tick.
 */

/** Whether the SSE live transport is env-active. */
export function liveTransportActive(): boolean {
  return process.env.SPORTA_LIVE_TRANSPORT === "sse";
}

/** The configured real emission cadence (ms), clamped to 100..5000. */
export function liveCadenceMs(): number {
  const raw = Number(process.env.SPORTA_LIVE_CADENCE_MS);
  if (!Number.isFinite(raw) || raw <= 0) return 500;
  return Math.min(5000, Math.max(100, Math.round(raw)));
}
