/**
 * The capability service (W904) — builds the REAL W901 capability response
 * for one request from the composition's live state.
 *
 * Every input is real: the identity session comes from the presented cookie
 * token (fail-closed — a presented-but-unusable token is `invalid-session`,
 * never silently anonymous), the renderer registry snapshot comes from the
 * REAL control plane, the live transport is reported as what it is (W915:
 * `live-network` ONLY while the SSE transport is env-active and genuinely
 * serving over real HTTP — otherwise the honest in-process/unavailable
 * state, Simulation F), and the provider health feeds describe the REAL
 * in-process backing. The queue-cache provider feed exists ONLY while the
 * live transport is active (the transport's real bounded frame buffers);
 * without it the queue-cache kind surfaces `unknown`/`health-feed-missing`
 * (fail-closed, never invented).
 *
 * There is no account-scoped rights decision in this wave (rights are
 * per-session policies in the control plane), so `rights` is omitted — the
 * frozen contracts rule: a missing decision denies. W915 EXCEPTS exactly
 * one case, documented: while the live transport is ACTIVE, the live mode's
 * rights evidence is the AUTHORIZED LIVE SOURCE's policy-derived
 * capabilities (the real identity-attested policy the transport serves —
 * `canDeliverLive` from a real policy, derived with the real clock). The
 * per-viewer authorization happens at the stream open (the route's
 * fail-closed 401/403/404 — before any byte), never in this response.
 */
import { buildCapabilityResponse } from "@sporta/capability";
import type { CapabilityResponse } from "@sporta/capability";
import { deriveRightsCapabilities } from "@sporta/contracts";
import type { SportaServer } from "./composition";
import { tokenFromRequest } from "./auth-service";

/** The in-process backing's provider feeds (verbatim operational detail). */
const PROVIDER_FEEDS = [
  {
    kind: "control-plane" as const,
    health: "ok" as const,
    detail: "in-process control app (dev composition root; no hosted provider configured yet)",
  },
  {
    kind: "storage" as const,
    health: "ok" as const,
    detail: "in-process W504 render-output store (segment + artifact stores)",
  },
  {
    kind: "compute" as const,
    health: "ok" as const,
    detail:
      "in-process renderer execution through the real registry (hosted compute adapter is W914)",
  },
  // queue-cache deliberately omitted when live is INACTIVE: no live queue
  // exists then → unknown / health-feed-missing in the response
  // (fail-closed). While the SSE transport is ACTIVE, the feed below is
  // real: the transport's bounded per-subscriber frame buffers.
];

/** The live transport's real queue-cache provider feed (active state only). */
function liveQueueCacheFeed(detail: string) {
  return { kind: "queue-cache" as const, health: "ok" as const, detail };
}

/**
 * Builds the capability response for one request. `requestId` (the caller's
 * correlation id, echoed verbatim) is optional, like the contract says.
 */
export async function capabilityForRequest(
  server: SportaServer,
  request: Request,
  requestId?: string,
): Promise<CapabilityResponse> {
  // 1. Resolve the presented session (fail-closed presentation state).
  const token = tokenFromRequest(request);
  let session: {
    authenticated: boolean;
    valid: boolean;
    userId?: string;
    activeRole?: string | null;
  };
  if (token.length === 0) {
    session = { authenticated: false, valid: false };
  } else {
    const resolved = await server.auth.resolve(token);
    if (resolved === null) {
      // A token was presented but is unusable: invalid-session (re-authenticate,
      // never silently anonymous — the W901 contract's fail-closed rule).
      session = { authenticated: true, valid: false };
    } else {
      session = {
        authenticated: true,
        valid: true,
        userId: resolved.account.userId,
        activeRole: resolved.activeRole,
      };
    }
  }

  // 2. The REAL renderer registry snapshot from the real control plane.
  const renderers = (await server.control.listRenderers()).renderers.map((capability) => ({
    rendererId: capability.rendererId,
    rendererVersion: capability.rendererVersion,
    rendererClass: capability.rendererClass,
    requiresSourceFrames: capability.requiresSourceFrames,
    registryStatus: "registered" as const,
  }));

  // 3. The live transport evidence (W915): `live-network` ONLY while the SSE
  //    transport is env-active and genuinely serving; otherwise the honest
  //    in-process state (Simulation F). The rights evidence in the active
  //    case is the authorized live source's REAL policy-derived capability
  //    (see the module docs — the per-viewer gate is the stream open).
  const live = server.live;
  const liveActive = live.state() === "active";
  const liveSource = liveActive ? live.listSources()[0] : undefined;
  if (liveActive && liveSource === undefined) {
    // Active but no registered source: honest unavailable (nothing to
    // serve) — never a claimed live-network mode with no source behind it.
    return buildCapabilityResponse({
      ...(requestId !== undefined && requestId.length > 0 ? { requestContext: { requestId } } : {}),
      session,
      ...(session.authenticated && session.valid && session.userId !== undefined
        ? { account: { userId: session.userId, roles: await rolesOf(server, session.userId) } }
        : {}),
      renderers,
      liveTransport: { kind: "none" },
      providers: [...PROVIDER_FEEDS, liveQueueCacheFeed(live.detail())],
    });
  }

  // 4. Compose (the pure W901 builder validates its own output).
  return buildCapabilityResponse({
    ...(requestId !== undefined && requestId.length > 0 ? { requestContext: { requestId } } : {}),
    session,
    ...(session.authenticated && session.valid && session.userId !== undefined
      ? { account: { userId: session.userId, roles: await rolesOf(server, session.userId) } }
      : {}),
    renderers,
    ...(liveActive && liveSource !== undefined
      ? {
          liveTransport: { kind: "live-network" as const },
          rights: deriveRightsCapabilities(liveSource.policy, new Date(server.nowMs())),
        }
      : { liveTransport: { kind: "in-process" as const } }),
    providers: liveActive ? [...PROVIDER_FEEDS, liveQueueCacheFeed(live.detail())] : PROVIDER_FEEDS,
  });
}

/** The account's grants (an unresolvable account is impossible here — the session resolved). */
async function rolesOf(server: SportaServer, userId: string): Promise<string[]> {
  const account = await server.accounts.findByUserId(userId);
  return account === null ? [] : [...account.roles];
}
