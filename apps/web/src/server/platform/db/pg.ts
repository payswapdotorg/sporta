/**
 * The Neon PostgreSQL client seam (W911).
 *
 * DEVIATION FROM THE ENGINE'S ZERO-DEP RULE (documented, productization
 * boundary): `apps/web` is the HOSTED composition root, not an engine package
 * — it may use infrastructure clients. The engine packages under `packages/*`
 * stay dependency-free; the `postgres` (postgres.js) driver is added to
 * `apps/web` alone and lives ONLY behind this module (the W504/W004
 * port-and-adapter pattern).
 *
 * The client is lazily created from `DATABASE_URL` (Neon), process-wide, and
 * reused across requests: postgres.js pools connections, and a Next.js server
 * runtime instance must not open a pool per request.
 */
import postgres from "postgres";

/** A resolved postgres.js sql tag (the type is structural — no re-export of the dep). */
export type PostgresSql = ReturnType<typeof postgres>;

let singleton: PostgresSql | null = null;

/**
 * The process-wide Neon client (or null when `DATABASE_URL` is absent — the
 * honest local/preview state; callers degrade to in-memory adapters).
 */
export function neonClient(): PostgresSql | null {
  if (singleton !== null) return singleton;
  const url = process.env["DATABASE_URL"];
  if (typeof url !== "string" || url.length === 0) return null;
  // Neon requires TLS; postgres.js negotiates it from the connection string.
  // Idle timeouts keep the free-tier connection count tiny.
  singleton = postgres(url, {
    max: 3,
    idle_timeout: 20,
    connect_timeout: 10,
    onnotice: () => undefined,
  });
  return singleton;
}

/** Creates a FRESH client for a caller-managed lifecycle (tests, migration CLI). */
export function createPostgresClient(url: string): PostgresSql {
  return postgres(url, {
    max: 3,
    idle_timeout: 20,
    connect_timeout: 10,
    onnotice: () => undefined,
  });
}
