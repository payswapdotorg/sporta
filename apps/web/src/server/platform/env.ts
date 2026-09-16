/**
 * Hosted-platform environment bindings (W910-W913).
 *
 * The composition root reads provider configuration EXCLUSIVELY through this
 * module. Rules (deployment-architecture.md + the credentials discipline):
 *
 * - Values are read from `process.env` and NEVER logged, echoed, or serialized
 *   into responses. Only *availability booleans* and non-secret descriptors
 *   (bucket name, region names, provider kinds) are ever surfaced.
 * - Every provider is OPTIONAL: the hosted app degrades honestly ("not
 *   configured") instead of crashing when a binding is absent — the local dev
 *   environment has none of them, `preview` may have some, and
 *   `beta-personal` has all.
 * - Names are the documented ones (DEPLOYMENT.md owns the list).
 */

/** Names of the environment variables this module reads (docs surface). */
export const PLATFORM_ENV_VARS = [
  "SPORTA_DEPLOY_ENV",
  "SPORTA_DEPLOY_MARKER",
  "SPORTA_SESSION_COOKIE_DOMAIN",
  "DATABASE_URL",
  "R2_BUCKET_NAME",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_S3_ENDPOINT",
  "R2_BUCKET_REGION",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
] as const;

/** The deployment environment tier (`docs/architecture/deployment-architecture.md`). */
export type PlatformEnv = "local" | "preview" | "beta-personal";

function readEnv(name: string): string | undefined {
  const value = process.env[name];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** The tier the deployment declares for itself (default: `local`). */
export function platformEnv(): PlatformEnv {
  const declared = readEnv("SPORTA_DEPLOY_ENV");
  return declared === "preview" || declared === "beta-personal" ? declared : "local";
}

/**
 * A non-secret deployment marker. Used by the platform health route so that
 * deployment/rollback evidence is curl-visible (which deployment is serving
 * traffic). Set per deployment from the runbook — never a secret.
 */
export function deployMarker(): string | null {
  return readEnv("SPORTA_DEPLOY_MARKER") ?? null;
}

/** Cookie domain override for the session cookie (set only for named hosts). */
export function sessionCookieDomain(): string | undefined {
  return readEnv("SPORTA_SESSION_COOKIE_DOMAIN");
}

/** Neon PostgreSQL connection string (secret — presence only is ever logged). */
export function neonDatabaseUrl(): string | undefined {
  return readEnv("DATABASE_URL");
}

/** R2 S3-compatible endpoint base URL (e.g. `https://<account>.r2.cloudflarestorage.com`). */
export function r2Endpoint(): string | undefined {
  return readEnv("R2_S3_ENDPOINT");
}

/** R2 access key id (secret — presence only is ever logged). */
export function r2AccessKeyId(): string | undefined {
  return readEnv("R2_ACCESS_KEY_ID");
}

/** R2 secret access key (secret — presence only is ever logged). */
export function r2SecretAccessKey(): string | undefined {
  return readEnv("R2_SECRET_ACCESS_KEY");
}

/** R2 bucket name (not a secret; surfaced in health output). */
export function r2BucketName(): string | undefined {
  return readEnv("R2_BUCKET_NAME");
}

/** R2 location constraint for bucket creation/requests (auto or region id). */
export function r2BucketRegion(): string | undefined {
  return readEnv("R2_BUCKET_REGION");
}

/** Upstash Redis REST URL (e.g. `https://<db>.upstash.io`) — the REST client target. */
export function upstashRedisUrl(): string | undefined {
  return readEnv("UPSTASH_REDIS_REST_URL");
}

/** Upstash Redis REST token (secret — presence only is ever logged). */
export function upstashRedisToken(): string | undefined {
  return readEnv("UPSTASH_REDIS_REST_TOKEN");
}

/** Whether all three R2 bindings needed to talk to the bucket are present. */
export function r2Configured(): boolean {
  return (
    r2Endpoint() !== undefined && r2AccessKeyId() !== undefined && r2SecretAccessKey() !== undefined
  );
}

/** Whether the Neon binding is present. */
export function neonConfigured(): boolean {
  return neonDatabaseUrl() !== undefined;
}

/** Whether BOTH Upstash bindings are present (URL + token). */
export function upstashConfigured(): boolean {
  return upstashRedisUrl() !== undefined && upstashRedisToken() !== undefined;
}

/** A provider-availability snapshot (non-secret; safe to serialize). */
export interface ProviderAvailability {
  identity: { provider: "neon" | "in-memory"; configured: boolean };
  artifacts: { provider: "r2" | "in-memory"; configured: boolean };
  transientState: { provider: "upstash" | "in-memory"; configured: boolean };
  controlPlane: { provider: "neon" | "in-memory"; configured: boolean };
}

/** The availability snapshot for the health route (never includes values). */
export function providerAvailability(): ProviderAvailability {
  return {
    identity: { provider: neonConfigured() ? "neon" : "in-memory", configured: neonConfigured() },
    artifacts: { provider: r2Configured() ? "r2" : "in-memory", configured: r2Configured() },
    transientState: {
      provider: upstashConfigured() ? "upstash" : "in-memory",
      configured: upstashConfigured(),
    },
    // W921: the durable control-plane record store rides the SAME Neon gate
    // as identity (migration 0002); unconfigured → the per-instance
    // in-memory control state, honestly reported.
    controlPlane: {
      provider: neonConfigured() ? "neon" : "in-memory",
      configured: neonConfigured(),
    },
  };
}
