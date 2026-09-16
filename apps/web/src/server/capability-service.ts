/**
 * The capability service (W904 + W913 + W919) — builds the REAL W901
 * capability response for one request from the composition's live state.
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
 * W919 guardrail wiring: the caller's `quotas[]` ALSO carries their per-user
 * daily metered-compute quotas (`compute.cpu-ms-day`,
 * `compute.artifact-bytes-day` — the admission quotas the studio's ladder
 * enforces; exhausted ones degrade the overall state through the same
 * `quota-exhausted` reason code, Simulation E). The PROVIDER-side free-tier
 * limits (R2 storage, the Upstash command budget) ride the `providers[]`
 * feeds — the W901 provider vocabulary has no provider-scoped quota entry,
 * so a REACHED global limit degrades its provider feed (`feed-reported-
 * degraded` → `provider-degraded` in the overall reason codes, with the
 * usage-vs-threshold detail + what the degraded state means) and an
 * APPROACHING one carries the warning in the feed's detail line.
 *
 * The small cache (W913, documented): ONLY the ANONYMOUS capability input
 * snapshot (renderer catalog + live-transport evidence + provider feeds)
 * is cached, 60s TTL, keyed by the live-source state. Session resolution and
 * quota counters are NEVER cached (logout revocation and admission decisions
 * must be immediate; a cached rights/quota state could admit work the live
 * counter would refuse — the fail-closed posture forbids it). Anonymous
 * snapshots carry no identity, no rights decision, and no quota state, so
 * serving one is safe: the worst staleness is a minute-old renderer list or
 * provider-health line (the anonymous snapshot's provider-limit states are
 * minute-fresh the same way).
 */
import { buildCapabilityResponse } from "@sporta/capability";
import type { CapabilityResponse } from "@sporta/capability";
import { deriveRightsCapabilities } from "@sporta/contracts";
import type { SportaServer } from "./composition";
import { tokenFromRequest } from "./auth-service";
import { RENDER_REQUESTS_QUOTA } from "./platform/upstash/hosted";
import type { PlatformQuotaState } from "./platform/upstash/quotas";
import type { LimitEvaluation } from "./platform/guardrails";

/** The in-process control-plane + compute feeds (verbatim operational detail). */
const STATIC_PROVIDER_FEEDS = [
  {
    kind: "control-plane" as const,
    health: "ok" as const,
    detail: "in-process control app (dev composition root; no hosted provider configured yet)",
  },
  {
    kind: "compute" as const,
    health: "ok" as const,
    detail:
      "in-process renderer execution through the real registry (hosted compute adapter is W914)",
  },
] as const;

/** The storage feed's honest backing line. */
function storageBackingDetail(server: SportaServer): string {
  return server.artifacts !== null
    ? "R2-backed render-output store (private bucket, presigned delivery)"
    : "in-process W504 render-output store (segment + artifact stores)";
}

/**
 * The storage feed with the W919 R2 storage-limit state: a REACHED/EXCEEDED
 * allowance degrades the feed with the usage-vs-threshold detail + what the
 * degraded state means; APPROACHING carries the warning in the detail; an
 * unmeasured/unconfigured allowance keeps the plain honest backing line.
 */
function storageFeed(server: SportaServer, evaluation: LimitEvaluation | undefined) {
  const detail = storageBackingDetail(server);
  if (
    evaluation === undefined ||
    evaluation.state === "unmeasured" ||
    evaluation.state === "under" ||
    evaluation.used === null
  ) {
    return { kind: "storage" as const, health: "ok" as const, detail };
  }
  if (evaluation.state === "reached" || evaluation.state === "exceeded") {
    return {
      kind: "storage" as const,
      health: "degraded" as const,
      detail: `${detail} — R2 storage ${evaluation.state}: ${evaluation.used} of ${evaluation.limit} bytes used (W919 ledger, ${evaluation.source})`,
      degradedMeaning:
        "new render admission is refused until stored bytes fall back under the free-tier allowance (Simulation E); existing playback stays available",
    };
  }
  return {
    kind: "storage" as const,
    health: "ok" as const,
    detail: `${detail} — R2 storage approaching the free-tier allowance (${evaluation.used} of ${evaluation.limit} bytes used)`,
  };
}

/**
 * The transient state's REAL queue-cache provider feed (W913 + W919): the
 * bounded render queue + quota counters + TTL cache behind the transient-state
 * port, with the W919 Upstash command-budget state.
 *
 * - in-memory backing: honest `ok` with the per-instance boundary in the
 *   detail (it works, per process — the same posture the other in-process
 *   feeds carry);
 * - Upstash backing: a LIVE `PING`, with the verdict cached 60s in the small
 *   cache (a capability read costs at most one probe command per minute).
 *   A failed probe is reported `down` with the fail-closed meaning spelled
 *   out — never `unknown` (that is the derived missing-feed state);
 * - W919: a REACHED/EXCEEDED command budget degrades the feed (the shared
 *   admission state is out of budget — admission refuses); APPROACHING
 *   carries the warning in the detail line.
 */
async function transientStateFeed(
  server: SportaServer,
  commandsEvaluation: LimitEvaluation | undefined,
) {
  const base = await transientReachability(server);
  if (
    commandsEvaluation === undefined ||
    commandsEvaluation.state === "unmeasured" ||
    commandsEvaluation.state === "under" ||
    commandsEvaluation.used === null
  ) {
    return base;
  }
  if (commandsEvaluation.state === "reached" || commandsEvaluation.state === "exceeded") {
    return {
      ...base,
      health: "degraded" as const,
      detail: `${base.detail} — the monthly command budget is ${commandsEvaluation.state} (${commandsEvaluation.used} of ${commandsEvaluation.limit} commands, W919 ledger)`,
      degradedMeaning:
        "new render admission is refused until the command window rolls over (Simulation E); existing playback stays available",
    };
  }
  return {
    ...base,
    detail: `${base.detail} — the monthly command budget is approaching (${commandsEvaluation.used} of ${commandsEvaluation.limit} commands)`,
  };
}

/** The W913 reachability verdict of the transient-state backing. */
async function transientReachability(server: SportaServer) {
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
        degradedMeaning:
          "render admission and rate limits refuse new work while the shared state is unreachable",
      };
}

/**
 * The full provider-feeds array over the W919 ledger evaluation: the static
 * control-plane/compute feeds, the storage feed with its R2 limit state, and
 * the queue-cache feed with the command-budget state.
 */
async function providerFeedsOf(server: SportaServer, evaluation: {
  limits: LimitEvaluation[];
}): Promise<unknown[]> {
  const storage = evaluation.limits.find((limit) => limit.limitId === "r2.storage-bytes");
  const commands = evaluation.limits.find((limit) => limit.limitId === "upstash.commands");
  return [
    ...STATIC_PROVIDER_FEEDS,
    storageFeed(server, storage),
    await transientStateFeed(server, commands),
  ];
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
  // W919: the ledger evaluation for the GLOBAL provider limits (no user
  // scope for anonymous snapshots — no quota state is cached, ever).
  const evaluation = await server.guardrails.evaluateLimits();
  const providers = await providerFeedsOf(server, evaluation);
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
      providers,
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
    providers,
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
  //    state (render-requests counter — the admission the studio enforces)
  //    plus their W919 per-user daily metered-compute quotas, and the
  //    provider feeds carrying the global limit states.
  const renderers = await rendererViewsOf(server);
  const live = server.live;
  const liveActive = live.state() === "active";
  const liveSource = liveActive ? live.listSources()[0] : undefined;

  let renderQuota: PlatformQuotaState | null = null;
  let usageQuotas: PlatformQuotaState[] = [];
  if (session.valid && session.userId !== undefined) {
    try {
      renderQuota = await server.transientState.quotas.peek(RENDER_REQUESTS_QUOTA, session.userId);
    } catch {
      renderQuota = null;
    }
    try {
      usageQuotas = await server.guardrails.userQuotaStates(session.userId);
    } catch {
      usageQuotas = [];
    }
  }
  // The provider feeds need only the GLOBAL limit states (storage + command
  // budget), and the compute rows must stay plane-scoped here: the per-user
  // quota surfacing rides `userQuotaStates` above (the W901 `quotas[]`
  // vocabulary), so evaluating WITHOUT a user keeps the shared window alarm
  // key written by one consistent writer class (the plane view) — the
  // per-user exhaustion signal reaches the caller through their quotas[].
  const evaluation = await server.guardrails.evaluateLimits();
  const providers = await providerFeedsOf(server, evaluation);

  const quotaInputs = [
    ...(renderQuota !== null ? [quotaCounterInput(renderQuota)] : []),
    ...usageQuotas.map(quotaCounterInput),
  ];

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
    providers,
    ...(quotaInputs.length > 0 ? { quotas: quotaInputs } : {}),
  });
}

/** The account's grants (an unresolvable account is impossible here — the session resolved). */
async function rolesOf(server: SportaServer, userId: string): Promise<string[]> {
  const account = await server.accounts.findByUserId(userId);
  return account === null ? [] : [...account.roles];
}
