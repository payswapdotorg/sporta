/**
 * The hosted transient-state composition (W913): the single place the
 * platform's queue/cache/quota objects are constructed for the deployment.
 *
 * Backing selection lives in `./redis.ts` (real Upstash REST when both
 * bindings exist; in-memory fallback otherwise — an HONEST per-instance
 * boundary until a shared Redis URL is provisioned).
 *
 * The defaults encode the free-tier posture (docs/deployment/free-tier-matrix.md):
 * bounded queue depth, small cache TTLs, and hard per-user quota limits. They
 * are constants here (no invented runtime knobs) — W919 moves them onto
 * measured provider usage.
 */
import { getHostedTransientState } from "./redis";
import { BoundedJobQueue } from "./queue";
import { QuotaGuard } from "./quotas";
import { TtlCache } from "./cache";

/**
 * The default hosted job-queue bound. Free-tier boundedness: jobs must never
 * queue without limit (Upstash free = 256 MB data / 500K commands per month;
 * a beta-sized render queue with explicit refusal is the safe shape).
 */
export const HOSTED_QUEUE_MAX_DEPTH = 256;

/** The default cache TTL (capability/catalog snapshots are minute-fresh). */
export const HOSTED_CACHE_TTL_SECONDS = 60;

/**
 * The beta registration quota: registrations per subject (IP) per hour.
 * A beta-honesty guard (not a security control — the security controls are
 * the auth semantics + rate layers owned upstream by W919).
 */
export const REGISTRATION_QUOTA: import("./quotas").QuotaDefinition = {
  quotaId: "register-attempts",
  scope: "user",
  limit: 10,
  windowSeconds: 3600,
};

/** The beta login-attempt quota per subject per hour. */
export const LOGIN_QUOTA: import("./quotas").QuotaDefinition = {
  quotaId: "login-attempts",
  scope: "user",
  limit: 30,
  windowSeconds: 3600,
};

/** The hosted job queue (single named queue for this wave's compute lane). */
export function getHostedJobQueue(): BoundedJobQueue {
  const { redis } = getHostedTransientState();
  return new BoundedJobQueue({
    redis,
    key: "sporta:jobs:render",
    maxDepth: HOSTED_QUEUE_MAX_DEPTH,
  });
}

/** The hosted capability/cache layer. */
export function getHostedCache(namespace = "sporta:cache"): TtlCache {
  const { redis } = getHostedTransientState();
  return new TtlCache({ redis, namespace, ttlSeconds: HOSTED_CACHE_TTL_SECONDS });
}

/** The hosted quota guard. */
export function getHostedQuotaGuard(): QuotaGuard {
  const { redis } = getHostedTransientState();
  return new QuotaGuard({ redis });
}

/** The caller-subject for a request's quota (IP, or "unknown" when absent). */
export function requestSubject(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  if (first !== undefined && first.length > 0) return first;
  return "unknown";
}
