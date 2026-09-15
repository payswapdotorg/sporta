/**
 * Migration 0001 — identity persistence (W911).
 *
 * Scope is HONEST: this wave's composition root persists exactly the identity
 * state the hosted app uses — accounts (argon2id/scrypt password hashes,
 * never plaintext), sessions (SHA-256 token hashes — the token itself is
 * never stored), and media-session ownership (the control gate's record of
 * who created a media session). Control-plane render records and the world of
 * `@sporta/control-api` remain in-memory until their hosted consumers land
 * (W914 hosted compute / W904-W905 product surfaces) — see DEPLOYMENT.md.
 *
 * Conventions mirrored from the W504/W004 sqlite precedents: DDL is
 * idempotent-by-runner (each migration runs exactly once, tracked in
 * `sporta_schema_migrations`), bounds are validated in code, and stored
 * documents are re-validated on read.
 */
export interface PlatformMigration {
  /** Monotonic version — the order in the runner. */
  readonly version: number;
  /** Human name (recorded with the version). */
  readonly name: string;
  /** Statements run inside ONE transaction. */
  readonly statements: readonly string[];
}

export const MIGRATION_0001_IDENTITY: PlatformMigration = {
  version: 1,
  name: "identity-accounts-sessions-ownership",
  statements: [
    `CREATE TABLE IF NOT EXISTS sporta_accounts (
       user_id        TEXT PRIMARY KEY,
       username       TEXT NOT NULL UNIQUE
                      CONSTRAINT sporta_accounts_username_lowercase CHECK (username = lower(username)),
       email          TEXT,
       password_hash  TEXT NOT NULL,
       roles          TEXT NOT NULL,
       created_at_iso TEXT NOT NULL
     )`,
    `CREATE TABLE IF NOT EXISTS sporta_sessions (
       token_hash    TEXT PRIMARY KEY,
       user_id       TEXT NOT NULL,
       issued_at_ms  BIGINT NOT NULL,
       expires_at_ms BIGINT NOT NULL,
       active_role   TEXT,
       revoked_at_ms BIGINT
     )`,
    `CREATE INDEX IF NOT EXISTS sporta_sessions_user_id_idx ON sporta_sessions (user_id)`,
    `CREATE TABLE IF NOT EXISTS sporta_media_ownership (
       session_id    TEXT PRIMARY KEY,
       owner_id      TEXT NOT NULL,
       recorded_at_ms BIGINT NOT NULL
     )`,
  ],
};
