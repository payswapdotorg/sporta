/**
 * Migration 0002 — durable control-plane records (W921).
 *
 * Scope is the W921 work order's: the control-plane state that was per-instance
 * in-memory on serverless (the W920 gate finding) becomes durable in Neon —
 * user-created media sessions (id, owner, source, rights declaration,
 * publication state) and their renders. Identity (0001) and artifacts (R2)
 * were already durable; the dev-seed sessions stay deterministic per-boot and
 * are NOT recorded here (their sess-1/2/3 namespace is untouched).
 *
 * AUDIT DEVIATION FROM THE ORDER'S SKETCH (documented, additive either way):
 * `sporta_control_renders` additionally carries `render_id` and `result` —
 * the control plane's render-sequence counter is PER-INSTANCE, so a
 * through-the-seam replay on another instance CANNOT re-derive the creating
 * instance's `r-<seq>` id; the record is therefore the source of truth for
 * the id AND the render-result document (served verbatim), while the OUTPUT
 * BYTES are re-materialized deterministically through the real renderer +
 * pipeline seams (content-addressed, idempotent).
 *
 * Conventions mirrored from 0001: DDL is additive and idempotent-by-runner
 * (tracked in `sporta_schema_migrations`), and stored documents are
 * re-validated on read.
 */
import type { PlatformMigration } from "./0001-identity";

export const MIGRATION_0002_CONTROL_PLANE: PlatformMigration = {
  version: 2,
  name: "control-plane-sessions-renders",
  statements: [
    `CREATE TABLE IF NOT EXISTS sporta_control_sessions (
       session_id        TEXT PRIMARY KEY,
       owner_user_id     TEXT NOT NULL,
       source_key        TEXT NOT NULL,
       label             TEXT NOT NULL,
       rights_declaration JSONB NOT NULL,
       visibility        JSONB NOT NULL,
       status            TEXT NOT NULL,
       published_at_ms   BIGINT,
       created_at_iso    TEXT NOT NULL,
       updated_at_ms     BIGINT NOT NULL
     )`,
    `CREATE INDEX IF NOT EXISTS sporta_control_sessions_owner_idx
       ON sporta_control_sessions (owner_user_id)`,
    `CREATE TABLE IF NOT EXISTS sporta_control_renders (
       session_id        TEXT NOT NULL,
       render_ordinal    INTEGER NOT NULL,
       render_id         TEXT NOT NULL,
       renderer_id       TEXT NOT NULL,
       recipe            JSONB NOT NULL,
       result            JSONB NOT NULL,
       stored_segment_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
       created_at_ms     BIGINT NOT NULL,
       PRIMARY KEY (session_id, render_ordinal)
     )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS sporta_control_renders_id_idx
       ON sporta_control_renders (session_id, render_id)`,
  ],
};
