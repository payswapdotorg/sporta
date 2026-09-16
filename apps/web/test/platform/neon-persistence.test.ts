/**
 * W911 INTEGRATION TESTS — the REAL Neon PostgreSQL identity persistence.
 *
 * ENV-GATED, LOUD: these tests run ONLY when `DATABASE_URL` is set (the
 * hosted/beta environment — see docs/deployment/DEPLOYMENT.md §Neon). Without
 * the env, the suite SKIPS with a banner so the root `bun test` battery stays
 * green in every environment that has no database (the honest local posture).
 *
 * What is proven (W911 acceptance — hosted auth/session state persists):
 * 1. register → persist → LOGIN FROM A FRESH STORE: a brand-new postgres
 *    client + brand-new stores (simulating a restart/redeploy) finds the
 *    account and verifies the password.
 * 2. the issued session SURVIVES STORE RECREATION: a fresh SessionService
 *    over a fresh client resolves the token.
 * 3. tokens are stored HASHED (table inspection): `sporta_sessions.token_hash`
 *    is exactly `sha256(token)` — the opaque token itself appears nowhere, and
 *    account password hashes are scrypt-formatted, never plaintext.
 * 4. EXPIRED sessions are rejected (fail-closed resolve → null).
 * 5. REVOKED sessions stay revoked across store recreation (logout persists).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { SessionService, defaultEntropySource, sha256Hex } from "@sporta/identity";
import { AuthService } from "../../src/server/auth-service";
import { applyPlatformMigrations } from "../../src/server/platform/db/migrate";
import { createPostgresClient } from "../../src/server/platform/db/pg";
import type { PostgresSql } from "../../src/server/platform/db/pg";
import { PgAccountStore, PgSessionStore } from "../../src/server/platform/identity/pg-stores";
import {
  isNodeScryptHash,
  nodeScryptPasswordHasher,
} from "../../src/server/platform/identity/node-scrypt-hasher";

/**
 * The gate: run ONLY against the REAL hosted database — a `DATABASE_URL`
 * whose host is a Neon endpoint (`*.neon.tech`). A missing (or non-Neon, e.g.
 * a local dev placeholder) URL SKIPS the suite loudly, so the root battery
 * stays green wherever the real database is not wired up.
 */
function neonDatabaseUrl(): string | null {
  const url = process.env["DATABASE_URL"];
  if (typeof url !== "string" || url.length === 0) return null;
  try {
    const host = new URL(url).hostname;
    return host.endsWith(".neon.tech") ? url : null;
  } catch {
    return null;
  }
}

const DATABASE_URL = neonDatabaseUrl();
const HAS_DATABASE = DATABASE_URL !== null;

if (!HAS_DATABASE) {
  console.warn(
    [
      "",
      "==================================================================",
      " SKIP neon-persistence.test.ts — no Neon DATABASE_URL.",
      " These are the W911 REAL-Neon integration tests. To run them:",
      "   . ~/.secrets/env.sh  # or export DATABASE_URL=postgres://…*.neon.tech/…",
      "   bun test apps/web/test/platform/neon-persistence.test.ts",
      " (The connection string never appears in output, files, or commits.)",
      "==================================================================",
      "",
    ].join("\n"),
  );
}

/** Unique per-run prefix so re-runs against the same database never 409. */
const RUN_TAG = crypto.randomUUID().slice(0, 8);
const USERNAME_A = `neon-it-${RUN_TAG}-alice`;
const USERNAME_B = `neon-it-${RUN_TAG}-bob`;
const USERNAME_C = `neon-it-${RUN_TAG}-carol`;
const PASSWORD = "neon-integration-password";

/** A hosted-faithful auth service over FRESH postgres-backed stores. */
function pgAuth(ttlMs?: number): { auth: AuthService; sql: PostgresSql } {
  const sql = createPostgresClient(DATABASE_URL!);
  const sessions = new SessionService({
    store: new PgSessionStore(sql),
    nowMs: Date.now,
    entropy: defaultEntropySource,
    ...(ttlMs !== undefined ? { ttlMs } : {}),
  });
  const auth = new AuthService({
    accounts: new PgAccountStore(sql),
    sessions,
    passwordHasher: nodeScryptPasswordHasher,
    nowMs: Date.now,
  });
  return { auth, sql };
}

const clients: PostgresSql[] = [];
const createdUserIds: string[] = [];

function trackClient(sql: PostgresSql): PostgresSql {
  clients.push(sql);
  return sql;
}

(HAS_DATABASE ? describe : describe.skip)("W911 Neon identity persistence (real database)", () => {
  let aliceUserId = "";

  beforeAll(async () => {
    // The migration runner is the deployed procedure (platform:migrate) —
    // running it here also proves the schema applies cleanly to the real db.
    const sql = trackClient(createPostgresClient(DATABASE_URL!));
    await applyPlatformMigrations(sql);
  });

  // Per-test timeout: these hit the REAL Neon endpoint over the WAN (TLS
  // handshakes + cross-region RTT can exceed bun's 5s default by a wide
  // margin — e.g. a sandbox in Asia-Pacific against a us-east-1 database).
  const WAN_TIMEOUT_MS = 30_000;

  test(
    "register → persist → login from a FRESH store (simulated restart)",
    async () => {
      const first = pgAuth();
      trackClient(first.sql);
      const view = await first.auth.register({
        username: USERNAME_A,
        password: PASSWORD,
        roles: ["viewer", "analyst"],
      });
      aliceUserId = view.userId;
      createdUserIds.push(view.userId);
      expect(view.username).toBe(USERNAME_A);
      expect([...view.roles].sort()).toEqual(["analyst", "viewer"]);

      // A BRAND-NEW client + brand-new stores over the SAME database — exactly
      // what a redeployed/cold-started server process sees.
      const fresh = pgAuth();
      trackClient(fresh.sql);
      const login = await fresh.auth.login({ username: USERNAME_A, password: PASSWORD });
      expect(login.account.userId).toBe(view.userId);
      expect(login.tokenKind).toBe("bearer");
      expect(login.token.length).toBeGreaterThan(0);
    },
    WAN_TIMEOUT_MS,
  );

  test(
    "session survives store recreation (fresh client resolves the token)",
    async () => {
      const issuer = pgAuth();
      trackClient(issuer.sql);
      const login = await issuer.auth.login({ username: USERNAME_A, password: PASSWORD });

      const fresh = pgAuth();
      trackClient(fresh.sql);
      const resolved = await fresh.auth.resolve(login.token);
      expect(resolved).not.toBeNull();
      expect(resolved!.account.userId).toBe(aliceUserId);
      expect(resolved!.account.username).toBe(USERNAME_A);
    },
    WAN_TIMEOUT_MS,
  );

  test(
    "tokens are stored HASHED — the opaque token never reaches the table",
    async () => {
      const issuer = pgAuth();
      trackClient(issuer.sql);
      const login = await issuer.auth.login({ username: USERNAME_A, password: PASSWORD });
      const expectedHash = await sha256Hex(login.token);

      // Inspect the REAL table rows for this user.
      const rows = await issuer.sql`
      SELECT token_hash, user_id FROM sporta_sessions WHERE user_id = ${aliceUserId}
    `;
      expect(rows.length).toBeGreaterThan(0);
      const hashes: string[] = rows.map((row) => row["token_hash"] as string);
      expect(hashes).toContain(expectedHash);
      // The plaintext token is never a stored hash…
      expect(hashes).not.toContain(login.token);
      // …and no row anywhere stores the raw token as its hash.
      const plaintext = await issuer.sql`
      SELECT count(*)::int AS n FROM sporta_sessions WHERE token_hash = ${login.token}
    `;
      expect(plaintext[0]!["n"]).toBe(0);

      // Account rows store a scrypt hash, never the password.
      const accountRows = await issuer.sql`
      SELECT password_hash FROM sporta_accounts WHERE user_id = ${aliceUserId}
    `;
      const passwordHash = accountRows[0]!["password_hash"] as string;
      expect(passwordHash).not.toBe(PASSWORD);
      expect(passwordHash).not.toContain(PASSWORD);
      expect(isNodeScryptHash(passwordHash)).toBe(true);
    },
    WAN_TIMEOUT_MS,
  );

  test(
    "expired sessions are rejected (fail-closed)",
    async () => {
      const short = pgAuth(1); // 1 ms TTL
      trackClient(short.sql);
      const registered = await short.auth.register({
        username: USERNAME_B,
        password: PASSWORD,
      });
      createdUserIds.push(registered.userId);
      const login = await short.auth.login({ username: USERNAME_B, password: PASSWORD });
      expect(login.token.length).toBeGreaterThan(0);

      await new Promise((resolve) => setTimeout(resolve, 50)); // real clock passes expiry
      const resolved = await short.auth.resolve(login.token);
      expect(resolved).toBeNull();
    },
    WAN_TIMEOUT_MS,
  );

  test(
    "revocation persists across store recreation (logout survives restarts)",
    async () => {
      const issuer = pgAuth();
      trackClient(issuer.sql);
      const registered = await issuer.auth.register({
        username: USERNAME_C,
        password: PASSWORD,
      });
      createdUserIds.push(registered.userId);
      const login = await issuer.auth.login({ username: USERNAME_C, password: PASSWORD });
      await issuer.auth.logout(login.token);

      const fresh = pgAuth();
      trackClient(fresh.sql);
      const resolved = await fresh.auth.resolve(login.token);
      expect(resolved).toBeNull();
    },
    WAN_TIMEOUT_MS,
  );

  afterAll(async () => {
    // Best-effort cleanup of THIS run's rows (the database is shared state).
    if (clients.length > 0) {
      const cleaner = clients[0]!;
      try {
        for (const userId of createdUserIds) {
          await cleaner`DELETE FROM sporta_sessions WHERE user_id = ${userId}`;
          await cleaner`DELETE FROM sporta_accounts WHERE user_id = ${userId}`;
        }
      } catch {
        // Cleanup is best-effort; the assertions above already ran.
      }
    }
    await Promise.all(clients.map((sql) => sql.end({ timeout: 5 })));
  });
});
