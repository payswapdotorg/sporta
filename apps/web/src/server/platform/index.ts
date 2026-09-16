/**
 * The hosted-platform composition root barrel (W910-W913, Worker B lane).
 *
 * Everything under `src/server/platform/` is SERVER-ONLY (never imported
 * from client components — the W903 shell boundary). Worker A's
 * `src/server/` product composition composes THESE factories when the
 * env-driven providers are needed; the module filenames here are distinct
 * by construction so the Wave-2 branches merge cleanly.
 */
export {
  PLATFORM_ENV_VARS,
  deployMarker,
  neonDatabaseUrl,
  platformEnv,
  providerAvailability,
  r2BucketName,
  r2Configured,
  r2Endpoint,
  sessionCookieDomain,
  upstashConfigured,
  upstashRedisUrl,
} from "./env";
export { neonClient, createPostgresClient } from "./db/pg";
export {
  applyPlatformMigrations,
  appliedPlatformMigrations,
  PLATFORM_MIGRATIONS,
} from "./db/migrate";
export { getHostedIdentity, identityReady } from "./identity/hosted";
export { nodeScryptPasswordHasher, isNodeScryptHash } from "./identity/node-scrypt-hasher";
export { PgAccountStore, PgSessionStore, PgMediaOwnershipStore } from "./identity/pg-stores";
export {
  HOSTED_STORE_DEFAULT_LIMITS,
  R2RenderOutputStore,
  PlaybackRightsDeniedError,
  PlatformStoreError,
  SegmentConflictError,
  SegmentIntegrityError,
  SegmentStoreLimitError,
  SegmentValidationError,
} from "./r2/r2-store";
export { getHostedRenderOutputStore } from "./r2/hosted";
export { InMemoryRedis, UpstashRestRedis, getHostedTransientState } from "./upstash/redis";
export type { RedisLike } from "./upstash/redis";
export { BoundedJobQueue } from "./upstash/queue";
export type { QueuedJob, QueuedJobView, AdmissionOutcome } from "./upstash/queue";
export { TtlCache } from "./upstash/cache";
export { QuotaGuard } from "./upstash/quotas";
export type {
  PlatformQuotaState,
  QuotaConsumeOutcome,
  QuotaDefinition,
} from "./upstash/quotas";
export {
  RateLimitedError,
  QueueFullError,
  attemptSubject,
  retryAfterSeconds,
} from "./upstash/guards";
export {
  HOSTED_ADMISSION_LEASE_MS,
  HOSTED_CACHE_TTL_SECONDS,
  HOSTED_QUEUE_KEY,
  HOSTED_QUEUE_MAX_DEPTH,
  LOGIN_ATTEMPTS_ACCOUNT_QUOTA,
  LOGIN_ATTEMPTS_IP_QUOTA,
  REGISTER_ATTEMPTS_ACCOUNT_QUOTA,
  REGISTER_ATTEMPTS_IP_QUOTA,
  RENDER_REQUESTS_QUOTA,
  getHostedCache,
  getHostedJobQueue,
  getHostedQuotaGuard,
  requestSubject,
} from "./upstash/hosted";
