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
import type { QuotaDefinition } from "./quotas";

/**
 * The default hosted job-queue bound. Free-tier boundedness: jobs must never
 * queue without limit (Upstash free = 256 MB data / 500K commands per month;
 * a beta-sized render queue with explicit refusal is the safe shape).
 */
export const HOSTED_QUEUE_MAX_DEPTH = 256;

/**
 * The admission lease: a queued admission record older than this is swept at
 * the next `offer` (abandoned clients cannot pin the queue full). Deliberately
 * far longer than any legitimate render — the sweep is the leak guard, not
 * the render timeout.
 */
export const HOSTED_ADMISSION_LEASE_MS = 900_000;

/** The hosted render queue's Redis key (one queue for this wave's compute lane). */
export const HOSTED_QUEUE_KEY = "sporta:jobs:render";

/** The default cache TTL (capability/catalog snapshots are minute-fresh). */
export const HOSTED_CACHE_TTL_SECONDS = 60;

/**
 * The per-user render-request quota (Simulation E's admission stop at the
 * product boundary): renders admitted per user per hour before the studio
 * refuses further dispatches.
 */
export const RENDER_REQUESTS_QUOTA: QuotaDefinition = {
  quotaId: "render-requests",
  scope: "user",
  limit: 20,
  windowSeconds: 3600,
};

/** Login attempts per source IP per hour (a beta-honesty guard, not a security control). */
export const LOGIN_ATTEMPTS_IP_QUOTA: QuotaDefinition = {
  quotaId: "login-attempts-ip",
  scope: "user",
  limit: 30,
  windowSeconds: 3600,
};

/** Login attempts per attempted account handle per hour (slower than the IP bound). */
export const LOGIN_ATTEMPTS_ACCOUNT_QUOTA: QuotaDefinition = {
  quotaId: "login-attempts-account",
  scope: "user",
  limit: 10,
  windowSeconds: 3600,
};

/** Registrations per source IP per hour. */
export const REGISTER_ATTEMPTS_IP_QUOTA: QuotaDefinition = {
  quotaId: "register-attempts-ip",
  scope: "user",
  limit: 10,
  windowSeconds: 3600,
};

/** Registration attempts per attempted account handle per hour. */
export const REGISTER_ATTEMPTS_ACCOUNT_QUOTA: QuotaDefinition = {
  quotaId: "register-attempts-account",
  scope: "user",
  limit: 10,
  windowSeconds: 3600,
};

/** The hosted job queue (single named queue for this wave's compute lane). */
export function getHostedJobQueue(): BoundedJobQueue {
  const { redis } = getHostedTransientState();
  return new BoundedJobQueue({
    redis,
    key: HOSTED_QUEUE_KEY,
    maxDepth: HOSTED_QUEUE_MAX_DEPTH,
    admissionLeaseMs: HOSTED_ADMISSION_LEASE_MS,
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
