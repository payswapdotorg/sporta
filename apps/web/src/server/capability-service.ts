/**
 * The capability service (W904) — builds the REAL W901 capability response
 * for one request from the composition's live state.
 *
 * Every input is real: the identity session comes from the presented cookie
 * token (fail-closed — a presented-but-unusable token is `invalid-session`,
 * never silently anonymous), the renderer registry snapshot comes from the
 * REAL control plane, the live transport is reported as what it is
 * (`in-process` — Simulation F: the control plane runs in this process, so
 * live is honestly unavailable), and the provider health feeds describe the
 * REAL in-process backing. The queue-cache provider has NO feed this wave —
 * it surfaces `unknown`/`health-feed-missing` (fail-closed, never invented).
 *
 * There is no account-scoped rights decision in this wave (rights are
 * per-session policies in the control plane), so `rights` is omitted — the
 * frozen contracts rule: a missing decision denies. No registered renderer
 * requires source frames this wave, so nothing visible changes; the day one
 * does, it answers `rights-denied` honestly.
 */
import { buildCapabilityResponse } from "@sporta/capability";
import type { CapabilityResponse } from "@sporta/capability";
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
    detail: "in-process renderer execution through the real registry (hosted compute adapter is W914)",
  },
  // queue-cache deliberately omitted: no queue/cache exists this wave →
  // unknown / health-feed-missing in the response (fail-closed).
];

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
  let session: { authenticated: boolean; valid: boolean; userId?: string; activeRole?: string | null };
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

  // 3. Compose (the pure W901 builder validates its own output).
  return buildCapabilityResponse({
    ...(requestId !== undefined && requestId.length > 0 ? { requestContext: { requestId } } : {}),
    session,
    ...(session.authenticated && session.valid && session.userId !== undefined
      ? { account: { userId: session.userId, roles: await rolesOf(server, session.userId) } }
      : {}),
    renderers,
    liveTransport: { kind: "in-process" },
    providers: PROVIDER_FEEDS,
  });
}

/** The account's grants (an unresolvable account is impossible here — the session resolved). */
async function rolesOf(server: SportaServer, userId: string): Promise<string[]> {
  const account = await server.accounts.findByUserId(userId);
  return account === null ? [] : [...account.roles];
}
