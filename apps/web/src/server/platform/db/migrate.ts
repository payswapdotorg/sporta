/**
 * The versioned migration runner (W911).
 *
 * Applies pending migrations (one transaction per migration, version recorded
 * in `sporta_schema_migrations`) and is idempotent: already-applied versions
 * are skipped; a partially-applied migration cannot be recorded (the
 * transaction rolls back). Order is the `version` field — never the import
 * order in this file (the registry below is sorted and asserted).
 */
import type { PostgresSql } from "./pg";
import { MIGRATION_0001_IDENTITY, type PlatformMigration } from "./migrations/0001-identity";
import { MIGRATION_0002_CONTROL_PLANE } from "./migrations/0002-control-plane";

/** Every migration, in ascending version order (pinned by test). */
export const PLATFORM_MIGRATIONS: readonly PlatformMigration[] = [
  MIGRATION_0001_IDENTITY,
  MIGRATION_0002_CONTROL_PLANE,
]
  .slice()
  .sort((a, b) => a.version - b.version);

/** A migration that was applied (as recorded in the database). */
export interface AppliedMigration {
  version: number;
  name: string;
}

/** Advisory-lock key: concurrent instances (serverless) serialize here. */
const MIGRATION_ADVISORY_LOCK_KEY = 0x530911;

/** Applies every pending migration. Returns the versions applied (in order). */
export async function applyPlatformMigrations(sql: PostgresSql): Promise<AppliedMigration[]> {
  await sql`CREATE TABLE IF NOT EXISTS sporta_schema_migrations (
    version    INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  const applied: AppliedMigration[] = [];
  for (const migration of PLATFORM_MIGRATIONS) {
    const existing = await sql`SELECT version, name FROM sporta_schema_migrations
      WHERE version = ${migration.version}`;
    if (existing.length > 0) continue;
    await sql.begin(async (tx) => {
      // Serialize concurrent instances (a serverless runtime may run several).
      await tx`SELECT pg_advisory_xact_lock(${MIGRATION_ADVISORY_LOCK_KEY})`;
      const raced = await tx`SELECT version FROM sporta_schema_migrations
        WHERE version = ${migration.version}`;
      if (raced.length > 0) return;
      for (const statement of migration.statements) {
        await tx.unsafe(statement);
      }
      await tx`INSERT INTO sporta_schema_migrations (version, name)
        VALUES (${migration.version}, ${migration.name})`;
    });
    applied.push({ version: migration.version, name: migration.name });
  }
  return applied;
}

/** Lists the applied versions (for health/ops surfaces). */
export async function appliedPlatformMigrations(sql: PostgresSql): Promise<AppliedMigration[]> {
  const rows = await sql`SELECT version, name FROM sporta_schema_migrations ORDER BY version`;
  return rows.map((row) => ({ version: row.version as number, name: row.name as string }));
}
