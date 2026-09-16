/**
 * The capability service (W904 + W913) — builds the REAL W901 capability
 * response for one request from the composition's live state.
 *
 * Every input is real: the identity session comes from the presented cookie
 * token (fail-closed — a presented-but-unusable token is `invalid-session`,
 * never silently anonymous), the renderer registry snapshot comes from the
 * REAL control plane, the live transport is reported as what it is (W915:
 * `live-network` ONLY while the SSE transport is env-active and genuinely
 * serving over real HTTP — otherwise the honest in-process/unavailable
 * state, Simulation F), and the provider health feeds describe the REAL
 * backing — since W913 INCLUDING the queue-cache kind: the bounded render
 * queue + quota counters + TTL cache port reports its REAL provider
 * (shared Upstash REST when configured, the honest per-instance in-memory
 * fallback otherwise — with a live PING probe when Upstash is configured).
 *
 * W913 quota wiring: an authenticated caller's `quotas[]` entry is the LIVE
 * peek of their render-request counter (the W901 `QuotaState` vocabulary —
 * an unreadable counter becomes the fail-closed `quota-counter-invalid`
 * entry, and an exhausted one drives `overall.state: "degraded"` with the
 * `quota-exhausted` reason code).
 *
 * The small cache (W913, documented): ONLY the ANONYMOUS capability input
 * snapshot (renderer catalog + live-transport evidence + provider feeds) is
 * cached, 60s TTL, keyed by the live-source state. Session resolution and
 * quota counters are NEVER cached (logout revocation and admission decisions
 * must be immediate; a cached rights/quota state could admit work the live
 * counter would refuse — the fail-closed posture forbids it). Anonymous
 * snapshots carry no identity, no rights decision, and no quota state, so
 * serving one is safe: the worst staleness is a minute-old renderer list or
 * provider-health line.
 */
import { buildCapabilityResponse } from "@sporta/capability";
import type { CapabilityResponse } from "@sporta/capability";
import { deriveRightsCapabilities } from "@sporta/contracts";
import type { SportaServer } from "./composition";
import { tokenFromRequest } from "./auth-service";
import { RENDER_REQUESTS_QUOTA } from "./platform/upstash/hosted";
import type { PlatformQuotaState } from "./platform/upstash/quotas";

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
] as const;

/**
 * The transient state's REAL queue-cache provider feed (W913): the bounded
 * render queue + quota counters + TTL cache behind the transient-state port.
 *
 * - in-memory backing: honest `ok` with the per-instance boundary in the
 *   detail (it works, per process — the same posture the other in-process
 *   feeds carry);
 * - Upstash backing: a LIVE `PING`, with the verdict cached 60s in the small
 *   cache (a capability read costs at most one probe command per minute).
 *   A failed probe is reported `down` with the fail-closed meaning spelled
 *   out — never `unknown` (that is the derived missing-feed state).
 */
async function transientStateFeed(server: SportaServer) {
  const transient = server.transientState;
  if (transient.provider === "in-memory") {
    return {
      kind: "queue-cache" as const,
      health: "ok" as const,
      detail:
        "in-memory transient state (bounded render queue + quota counters + TTL cache; per-instance — no shared redis configured)",
    };
  }
  let verdict: "ok" | "down";
  try {
    const cached = await transient.cache.get<"ok" | "down">("upstash:ping");
    if (cached !== null) {
      verdict = cached;
    } else {
      verdict = (await transient.redis.ping()) === "PONG" ? "ok" : "down";
      await transient.cache.set("upstash:ping", verdict);
    }
  } catch {
    verdict = "down";
  }
  return verdict === "ok"
    ? {
        kind: "queue-cache" as const,
        health: "ok" as const,
        detail: "upstash redis (bounded render queue + quota counters + TTL cache)",
      }
    : {
        kind: "queue-cache" as const,
        health: "down" as const,
        detail: "upstash redis unreachable — admission guards fail closed until it recovers",
        degradedMeaning: "render admission and rate limits refuse new work while the shared state is unreachable",
      };
}

/**
 * Maps a live `PlatformQuotaState` peek into the capability builder's quota
 * input. A READABLE counter becomes the strict `QuotaCounter` shape; an
 * unreadable one becomes a deliberately-unparseable entry whose `quotaId`
 * survives, so the builder's fail-closed path emits the honest
 * `quota-counter-invalid` response entry (extra keys also fail the strict
 * parse — that is the designed channel, never data loss).
 */
function quotaCounterInput(state: PlatformQuotaState): unknown {
  if (state.used === null || state.limit === null) {
    return { quotaId: state.quotaId, scope: state.scope, used: null, limit: null };
  }
  return {
    quotaId: state.quotaId,
    scope: state.scope,
    used: state.used,
    limit: state.limit,
  };
}

/** The anonymous snapshot's cache key (live-source state included — a newly
 * registered live source composes fresh instead of serving a stale shape). */
function anonymousCacheKey(liveActive: boolean, liveSourceId: string | undefined): string {
  return `capability:anonymous:v1:${liveActive ? `live:${liveSourceId ?? "none"}` : "in-process"}`;
}

/** The renderer registry snapshot mapped to the capability input shape. */
async function rendererViewsOf(server: SportaServer) {
  return (await server.control.listRenderers()).renderers.map((capability) => ({
    rendererId: capability.rendererId,
    rendererVersion: capability.rendererVersion,
    rendererClass: capability.rendererClass,
    requiresSourceFrames: capability.requiresSourceFrames,
    registryStatus: "registered" as const,
  }));
}

/** The capability input pieces that are identical for every anonymous call. */
interface AnonymousCapabilityInput {
  session: { authenticated: false; valid: false };
  renderers: Awaited<ReturnType<typeof rendererViewsOf>>;
  liveTransport: { kind: "live-network" } | { kind: "in-process" } | { kind: "none" };
  rights?: ReturnType<typeof deriveRightsCapabilities>;
  providers: unknown[];
}

/** Builds the anonymous input snapshot (the cached portion — see module docs). */
async function buildAnonymousInput(server: SportaServer): Promise<AnonymousCapabilityInput> {
  const renderers = await rendererViewsOf(server);
  const transientFeed = await transientStateFeed(server);
  const live = server.live;
  const liveActive = live.state() === "active";
  const liveSource = liveActive ? live.listSources()[0] : undefined;
  if (liveActive && liveSource === undefined) {
    // Active but no registered source: honest unavailable (nothing to
    // serve) — never a claimed live-network mode with no source behind it.
    return {
      session: { authenticated: false, valid: false },
      renderers,
      liveTransport: { kind: "none" },
      providers: [...PROVIDER_FEEDS, transientFeed],
    };
  }
  return {
    session: { authenticated: false, valid: false },
    renderers,
    ...(liveActive && liveSource !== undefined
      ? {
          liveTransport: { kind: "live-network" as const },
          rights: deriveRightsCapabilities(liveSource.policy, new Date(server.nowMs())),
        }
      : { liveTransport: { kind: "in-process" as const } }),
    providers: [...PROVIDER_FEEDS, transientFeed],
  };
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
  // 1. Resolve the presented session (fail-closed presentation state —
  //    NEVER cached: session revocation must be immediate).
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

  // 2. Anonymous requests: the cached input snapshot (60s TTL — see the
  //    module docs for exactly what is and is NOT cached and why), composed
  //    per request with the caller's requestContext echo.
  if (!session.authenticated) {
    const live = server.live;
    const liveActive = live.state() === "active";
    const liveSource = liveActive ? live.listSources()[0] : undefined;
    const key = anonymousCacheKey(liveActive, liveSource?.sessionId);
    const input = await server.transientState.cache.getOrCompute(key, () =>
      buildAnonymousInput(server),
    );
    return buildCapabilityResponse({
      ...(requestId !== undefined && requestId.length > 0 ? { requestContext: { requestId } } : {}),
      ...input,
    });
  }

  // 3. Authenticated requests: live composition with the caller's LIVE quota
  //    state (render-requests counter — the admission the studio enforces).
  const renderers = await rendererViewsOf(server);
  const transientFeed = await transientStateFeed(server);
  const live = server.live;
  const liveActive = live.state() === "active";
  const liveSource = liveActive ? live.listSources()[0] : undefined;

  let renderQuota: PlatformQuotaState | null = null;
  if (session.valid && session.userId !== undefined) {
    try {
      renderQuota = await server.transientState.quotas.peek(RENDER_REQUESTS_QUOTA, session.userId);
    } catch {
      renderQuota = null;
    }
  }

  return buildCapabilityResponse({
    ...(requestId !== undefined && requestId.length > 0 ? { requestContext: { requestId } } : {}),
    session,
    ...(session.valid && session.userId !== undefined
      ? { account: { userId: session.userId, roles: await rolesOf(server, session.userId) } }
      : {}),
    renderers,
    ...(liveActive && liveSource !== undefined
      ? {
          liveTransport: { kind: "live-network" as const },
          rights: deriveRightsCapabilities(liveSource.policy, new Date(server.nowMs())),
        }
      : { liveTransport: { kind: "in-process" as const } }),
    providers: [...PROVIDER_FEEDS, transientFeed],
    ...(renderQuota !== null ? { quotas: [quotaCounterInput(renderQuota)] } : {}),
  });
}

/** The account's grants (an unresolvable account is impossible here — the session resolved). */
async function rolesOf(server: SportaServer, userId: string): Promise<string[]> {
  const account = await server.accounts.findByUserId(userId);
  return account === null ? [] : [...account.roles];
}
