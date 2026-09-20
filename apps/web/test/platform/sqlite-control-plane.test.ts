/**
 * THE SQLITE CONTROL-PLANE RECORD STORE TESTS (J007) — the port's semantics
 * over the real `bun:sqlite` engine, mirroring the Neon integration test's
 * assertions (the same adapter contract, the local durable substitute):
 * round-trip verbatim reads across SEPARATE store instances (a second
 * instance / a redeploy), idempotent render records, visibility
 * persistence, the unknown-session flip refusal, and fail-closed parsing
 * on a corrupted row.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteControlPlaneRecordStore } from "../../src/server/platform/control/sqlite-records";
import type { ControlRenderRecord, ControlSessionRecord } from "../../src/server/platform/control/records";

let scratch = "";
let dbPath = "";

const SESSION: ControlSessionRecord = {
  sessionId: "sess-u-sqlite0001aaaa",
  ownerUserId: "user-sqlite-test",
  sourceKey: "derby",
  label: "sqlite local-durability session",
  rightsDeclaration: {
    policyId: "policy-sqlite-test",
    allowedOperations: ["analysis", "transformation"],
    assertedBy: "user-sqlite-test",
  },
  visibility: { kind: "private", roles: [] },
  status: "active",
  publishedAtMs: null,
  createdAtIso: "2026-09-20T00:00:00.000Z",
  updatedAtMs: 1_000,
};

function renderOf(ordinal: number, renderId: string): ControlRenderRecord {
  return {
    sessionId: SESSION.sessionId,
    renderOrdinal: ordinal,
    renderId,
    rendererId: "anime.prototype",
    recipe: { styleConfig: { styleId: "sqlite-test" } },
    result: {
      sessionId: SESSION.sessionId,
      rendererId: "anime.prototype",
      outputSegments: [],
      watermarkAfter: { watermarkMs: 1_000, sequence: 1 },
      rendererHealth: { state: "healthy" },
      provenance: { kind: "OBSERVED" },
    } as unknown as ControlRenderRecord["result"],
    storedSegmentIds: ["seg-sqlite-1"],
    createdAtMs: 1_500,
  };
}

beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), "sporta-sqlite-control-"));
  dbPath = join(scratch, "control-plane.db");
});

afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

describe("SqliteControlPlaneRecordStore (J007 — the port semantics, local engine)", () => {
  test("upsertSession → a SEPARATE store instance reads the SAME record (verbatim)", async () => {
    const writer = new SqliteControlPlaneRecordStore(dbPath, () => 1_000);
    await writer.upsertSession(SESSION);
    // A brand-new store over the same file (a second instance / a redeploy).
    const reader = new SqliteControlPlaneRecordStore(dbPath, () => 2_000);
    const record = await reader.findSession(SESSION.sessionId);
    expect(record).not.toBeNull();
    expect(record!.sessionId).toBe(SESSION.sessionId);
    expect(record!.ownerUserId).toBe(SESSION.ownerUserId);
    expect(record!.sourceKey).toBe("derby");
    expect(record!.label).toBe(SESSION.label);
    expect(record!.rightsDeclaration.policyId).toBe("policy-sqlite-test");
    expect(record!.visibility).toEqual({ kind: "private", roles: [] });
    expect(record!.createdAtIso).toBe(SESSION.createdAtIso);
    expect((await reader.listSessions()).map((entry) => entry.sessionId)).toContain(
      SESSION.sessionId,
    );
  });

  test("recordRender is idempotent per render id + readable verbatim", async () => {
    const writer = new SqliteControlPlaneRecordStore(dbPath, () => 1_000);
    await writer.recordRender(renderOf(1, "r-u-sqlite0001bbbb"));
    await writer.recordRender(renderOf(1, "r-u-sqlite0001bbbb")); // counted no-op
    const reader = new SqliteControlPlaneRecordStore(dbPath, () => 2_000);
    const renders = await reader.findRenders(SESSION.sessionId);
    expect(renders.length).toBe(1);
    expect(renders[0]!.renderId).toBe("r-u-sqlite0001bbbb");
    expect(renders[0]!.rendererId).toBe("anime.prototype");
    expect(renders[0]!.storedSegmentIds).toEqual(["seg-sqlite-1"]);
    expect(renders[0]!.recipe.styleConfig?.styleId).toBe("sqlite-test");
  });

  test("setVisibility persists (a separate instance reads the flip); unknown flips throw", async () => {
    const writer = new SqliteControlPlaneRecordStore(dbPath, () => 3_000);
    await writer.setVisibility(SESSION.sessionId, { kind: "public", roles: [] });
    const reader = new SqliteControlPlaneRecordStore(dbPath, () => 4_000);
    const record = await reader.findSession(SESSION.sessionId);
    expect(record!.visibility.kind).toBe("public");
    expect(record!.publishedAtMs).toBe(3_000);
    // The fail-closed scope-less role record degrades to private.
    await writer.setVisibility(SESSION.sessionId, { kind: "role-scoped", roles: [] });
    expect(
      (await reader.findSession(SESSION.sessionId))!.visibility.kind,
    ).toBe("private");
    // An unknown session's flip is a typed refusal, never a silent no-op.
    await expect(writer.setVisibility("sess-u-never-recorded", { kind: "public", roles: [] })).rejects.toThrow(
      /unknown session/,
    );
  });

  test("a corrupted row fails CLOSED on read (never partial data served)", async () => {
    // Corrupt the stored rights declaration directly in the file.
    const { Database } = await import("bun:sqlite");
    const raw = new Database(dbPath);
    raw.run("UPDATE sporta_control_sessions SET rights_declaration = 'not-json{' WHERE session_id = ?", [
      SESSION.sessionId,
    ]);
    raw.close();
    const reader = new SqliteControlPlaneRecordStore(dbPath, () => 5_000);
    await expect(reader.findSession(SESSION.sessionId)).rejects.toThrow(/not valid JSON/);
  });

  test("providerName is the structural sqlite marker (health labels read it)", () => {
    const store = new SqliteControlPlaneRecordStore(":memory:");
    expect(store.providerName).toBe("sqlite");
  });
});
