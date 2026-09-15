/**
 * Migration CLI (W911): applies pending platform migrations to the database
 * named by `DATABASE_URL`.
 *
 * Usage (from `apps/web`, with DATABASE_URL exported):
 *   bun run src/server/platform/db/run-migrations.ts
 *
 * Prints ONLY non-secret progress (versions and names) — never the
 * connection string. Exit code 0 = success (including "nothing to apply").
 */
import { applyPlatformMigrations } from "./migrate";
import { createPostgresClient } from "./pg";

async function main(): Promise<number> {
  const url = process.env["DATABASE_URL"];
  if (typeof url !== "string" || url.length === 0) {
    console.error("DATABASE_URL is not set — nothing to migrate (local dev has no database).");
    return 1;
  }
  const sql = createPostgresClient(url);
  try {
    const applied = await applyPlatformMigrations(sql);
    if (applied.length === 0) {
      console.log("no pending migrations (schema is current)");
    } else {
      for (const migration of applied) {
        console.log(`applied ${migration.version}: ${migration.name}`);
      }
    }
    return 0;
  } catch (err) {
    console.error(`migration failed: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

process.exit(await main());
