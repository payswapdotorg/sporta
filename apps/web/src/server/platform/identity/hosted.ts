/**
 * The hosted identity composition root (W910/W911).
 *
 * Constructs the REAL `@sporta/identity` services from environment bindings:
 *
 * - `DATABASE_URL` present → Neon PostgreSQL stores (`Pg*Store`) and schema
 *   migrations are ensured ONCE per runtime instance (advisory-locked, so
 *   concurrent serverless instances cannot race).
 * - Absent → the W902 in-memory stores (local dev / unconfigured preview —
 *   the honest state surfaced by `/api/platform/health`).
 *
 * In BOTH cases the password hasher is the Node `scrypt` implementation
 * (`node-scrypt-hasher`): the hosted runtime is Node (Vercel), where the
 * engine's Bun argon2id default cannot run. The W902 `PasswordHasher` port
 * exists precisely for this swap; auth semantics (verify dispatch, stored
 * format versioning) are unchanged.
 *
 * The injected clock is the REAL wall clock and the entropy source is the
 * REAL platform entropy — production callers must inject real time
 * (`@sporta/identity` constitution) and this IS the production caller.
 */
import {
  InMemoryAccountStore,
  InMemoryMediaOwnershipStore,
  InMemorySessionStore,
  SessionService,
  defaultEntropySource,
  type AccountStore,
  type MediaOwnershipStore,
  type PasswordHasher,
} from "@sporta/identity";
import { neonClient } from "../db/pg";
import { applyPlatformMigrations } from "../db/migrate";
import { nodeScryptPasswordHasher } from "./node-scrypt-hasher";
import { PgAccountStore, PgMediaOwnershipStore, PgSessionStore } from "./pg-stores";

/** What the hosted identity composition exposes to the route layer. */
export interface HostedIdentity {
  accounts: AccountStore;
  sessions: SessionService;
  ownership: MediaOwnershipStore;
  /** The Node-compatible hasher (scrypt) — the W902 port, injected. */
  hasher: PasswordHasher;
  /** `neon` or `in-memory` — never a secret. */
  provider: "neon" | "in-memory";
}

let hosted: HostedIdentity | null = null;
let migrateOnce: Promise<unknown> | null = null;

/** Ensures the schema exists (once per runtime instance; advisory-locked). */
function ensureMigrated(): Promise<unknown> {
  migrateOnce ??= applyPlatformMigrations(neonClient()!).catch((err) => {
    // Reset so a later request can retry after a transient Neon outage.
    migrateOnce = null;
    throw err;
  });
  return migrateOnce;
}

/** The process-wide hosted identity (built lazily from the environment). */
export function getHostedIdentity(): HostedIdentity {
  if (hosted !== null) return hosted;
  const sql = neonClient();
  if (sql === null) {
    hosted = {
      accounts: new InMemoryAccountStore(),
      sessions: new SessionService({
        store: new InMemorySessionStore(),
        nowMs: Date.now,
        entropy: defaultEntropySource,
      }),
      ownership: new InMemoryMediaOwnershipStore(),
      hasher: nodeScryptPasswordHasher,
      provider: "in-memory",
    };
    return hosted;
  }
  hosted = {
    accounts: new PgAccountStore(sql),
    sessions: new SessionService({
      store: new PgSessionStore(sql),
      nowMs: Date.now,
      entropy: defaultEntropySource,
    }),
    ownership: new PgMediaOwnershipStore(sql),
    hasher: nodeScryptPasswordHasher,
    provider: "neon",
  };
  return hosted;
}

/**
 * Resolves once the Neon schema is current (no-op on the in-memory provider).
 * Route handlers `await` this before touching identity state so the very
 * first request after a schema change can never hit missing tables.
 */
export async function identityReady(): Promise<void> {
  getHostedIdentity();
  if (neonClient() === null) return;
  await ensureMigrated();
}
