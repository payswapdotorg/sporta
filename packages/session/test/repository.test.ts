import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import type { MediaSession } from "@sporta/contracts";
import { SCHEMA_VERSION } from "@sporta/contracts";
import {
  InMemorySessionRepository,
  SessionConflictError,
  SessionDocumentValidationError,
  SessionNotFoundError,
  SqliteSessionRepository,
  newSession,
} from "../src/index";
import type { MediaSessionRepository } from "../src/index";
import { fixtureSource, fullPolicy, invalidSessionDoc } from "./fixtures/load";

const CREATED_AT = "2025-06-01T12:00:00Z";

function makeSession(sessionId: string): MediaSession {
  return newSession({
    sessionId,
    authorizationPolicyId: fullPolicy.policyId,
    sources: [fixtureSource],
    createdAtIso: CREATED_AT,
  });
}

/** Exercises the full round-trip contract against a repository factory. */
function roundTripSuite(makeRepo: () => MediaSessionRepository) {
  describe("round-trips", () => {
    test("create + get returns the stored document", () => {
      const repo = makeRepo();
      repo.create(makeSession("sess-rt-1"));
      const stored = repo.get("sess-rt-1");
      expect(stored).not.toBeNull();
      expect(stored?.sessionId).toBe("sess-rt-1");
      expect(stored?.status).toBe("created");
      expect(stored?.schemaVersion).toBe(SCHEMA_VERSION);
      expect(stored?.sources).toEqual([fixtureSource]);
    });

    test("get of a missing session returns null", () => {
      const repo = makeRepo();
      expect(repo.get("sess-nope")).toBeNull();
    });

    test("create with a duplicate id conflicts", () => {
      const repo = makeRepo();
      repo.create(makeSession("sess-dup"));
      expect(() => repo.create(makeSession("sess-dup"))).toThrow(SessionConflictError);
    });

    test("create rejects invalid documents (fail loudly on write)", () => {
      const repo = makeRepo();
      expect(() => repo.create(invalidSessionDoc as MediaSession)).toThrow(
        SessionDocumentValidationError,
      );
    });

    test("update replaces the stored document", () => {
      const repo = makeRepo();
      let session = repo.create(makeSession("sess-upd"));
      session = {
        ...session,
        status: "authorized",
        processingState: { ...session.processingState, stage: "authorized" },
      };
      repo.update(session);
      expect(repo.get("sess-upd")?.status).toBe("authorized");
    });

    test("update of a missing session throws", () => {
      const repo = makeRepo();
      expect(() => repo.update(makeSession("sess-ghost"))).toThrow(SessionNotFoundError);
    });

    test("update rejects invalid documents", () => {
      const repo = makeRepo();
      const session = repo.create(makeSession("sess-upd-bad"));
      expect(() =>
        repo.update({ ...session, status: "not-a-status" as MediaSession["status"] }),
      ).toThrow(SessionDocumentValidationError);
    });

    test("listByStatus returns only matching sessions", () => {
      const repo = makeRepo();
      repo.create(makeSession("sess-a"));
      repo.create(makeSession("sess-b"));
      const done = makeSession("sess-c");
      repo.create(done);
      repo.update({ ...done, status: "completed", processingState: { stage: "completed" } });

      const created = repo.listByStatus("created");
      expect(created.map((s) => s.sessionId).sort()).toEqual(["sess-a", "sess-b"]);
      expect(repo.listByStatus("completed").map((s) => s.sessionId)).toEqual(["sess-c"]);
      expect(repo.listByStatus("failed")).toEqual([]);
    });

    test("delete removes the session and is idempotent", () => {
      const repo = makeRepo();
      repo.create(makeSession("sess-del"));
      repo.delete("sess-del");
      expect(repo.get("sess-del")).toBeNull();
      expect(() => repo.delete("sess-del")).not.toThrow(); // idempotent
      expect(() => repo.delete("never-existed")).not.toThrow();
    });

    test("returned documents are deep clones of the store", () => {
      const repo = makeRepo();
      const created = repo.create(makeSession("sess-immutable"));
      created.status = "completed";
      created.processingState.stage = "hacked";
      const source = created.sources[0];
      if (source !== undefined) source.videoStreams = 99;
      const reread = repo.get("sess-immutable");
      expect(reread?.status).toBe("created");
      expect(reread?.processingState.stage).toBe("created");
      expect(reread?.sources[0]?.videoStreams).toBe(fixtureSource.videoStreams);
    });

    test("mutating the store input after create/update does not leak in", () => {
      const repo = makeRepo();
      const input = makeSession("sess-leak");
      repo.create(input);
      input.status = "delivering";
      const source = input.sources[0];
      if (source !== undefined) source.declaredRightsPolicyId = "pol-hacked";
      expect(repo.get("sess-leak")?.status).toBe("created");
      expect(repo.get("sess-leak")?.sources[0]?.declaredRightsPolicyId).toBe(
        fixtureSource.declaredRightsPolicyId,
      );
    });
  });
}

describe("InMemorySessionRepository", () => {
  roundTripSuite(() => new InMemorySessionRepository());
});

describe("SqliteSessionRepository", () => {
  let tempDir: string;
  let roundTripSeq = 0;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "sporta-session-test-"));
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  // Each round-trip test gets its own database file for isolation.
  roundTripSuite(
    () => new SqliteSessionRepository(join(tempDir, `roundtrip-${roundTripSeq++}.sqlite`)),
  );

  test("creates the media_sessions table with a status index", () => {
    const repo = new SqliteSessionRepository(join(tempDir, "schema.sqlite"));
    const db = new Database(join(tempDir, "schema.sqlite"));
    const tables = db
      .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'media_sessions'")
      .all();
    const indexes = db
      .query(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'media_sessions' AND name NOT LIKE 'sqlite_autoindex%'",
      )
      .all();
    db.close();
    repo.close();
    expect(tables).toHaveLength(1);
    expect((indexes[0] as { name: string } | undefined)?.name).toBe("media_sessions_status_idx");
  });

  test("documents survive close and reopen (durable persistence)", () => {
    const path = join(tempDir, "reopen.sqlite");
    const repo = new SqliteSessionRepository(path);
    const session = repo.create(makeSession("sess-reopen"));
    repo.update({ ...session, status: "authorized", processingState: { stage: "authorized" } });
    repo.close();

    const reopened = new SqliteSessionRepository(path);
    const stored = reopened.get("sess-reopen");
    expect(stored?.status).toBe("authorized");
    expect(reopened.listByStatus("authorized").map((s) => s.sessionId)).toEqual(["sess-reopen"]);
    reopened.close();
  });

  test("constructor accepts a Database instance", () => {
    const path = join(tempDir, "instance.sqlite");
    const db = new Database(path);
    const repo = new SqliteSessionRepository(db);
    repo.create(makeSession("sess-instance"));
    expect(repo.get("sess-instance")?.sessionId).toBe("sess-instance");
    repo.close();
    expect(() => repo.get("sess-instance")).toThrow(); // closed
    expect(() => repo.close()).not.toThrow(); // idempotent close
  });

  test("updated_at is stamped and advances on update", () => {
    const path = join(tempDir, "timestamps.sqlite");
    const repo = new SqliteSessionRepository(path);
    const session = repo.create(makeSession("sess-ts"));
    const db = new Database(path);
    const first = (
      db.query("SELECT updated_at FROM media_sessions WHERE session_id = ?").get("sess-ts") as {
        updated_at: number;
      }
    ).updated_at;
    repo.update({ ...session, status: "ingesting", processingState: { stage: "ingesting" } });
    const second = (
      db.query("SELECT updated_at FROM media_sessions WHERE session_id = ?").get("sess-ts") as {
        updated_at: number;
      }
    ).updated_at;
    db.close();
    repo.close();
    expect(first).toBeGreaterThan(0);
    expect(second).toBeGreaterThanOrEqual(first);
  });

  describe("schema validation on read catches corrupted rows", () => {
    test("malformed JSON in document_json throws on get", () => {
      const path = join(tempDir, "corrupt-json.sqlite");
      const repo = new SqliteSessionRepository(path);
      repo.create(makeSession("sess-corrupt-json"));
      repo.close();

      const db = new Database(path);
      db.run("UPDATE media_sessions SET document_json = '{not-valid-json' WHERE session_id = ?", [
        "sess-corrupt-json",
      ]);
      db.close();

      const reopened = new SqliteSessionRepository(path);
      expect(() => reopened.get("sess-corrupt-json")).toThrow(SessionDocumentValidationError);
      reopened.close();
    });

    test("schema-violating JSON in document_json throws on get", () => {
      const path = join(tempDir, "corrupt-schema.sqlite");
      const repo = new SqliteSessionRepository(path);
      repo.create(makeSession("sess-corrupt-schema"));
      repo.close();

      const db = new Database(path);
      const badDoc = { ...makeSession("sess-corrupt-schema"), status: "hijacked", sources: [] };
      db.run("UPDATE media_sessions SET document_json = ? WHERE session_id = ?", [
        JSON.stringify(badDoc),
        "sess-corrupt-schema",
      ]);
      db.close();

      const reopened = new SqliteSessionRepository(path);
      expect(() => reopened.get("sess-corrupt-schema")).toThrow(SessionDocumentValidationError);
      reopened.close();
    });

    test("listByStatus fails loudly when a matching row is corrupted", () => {
      const path = join(tempDir, "corrupt-list.sqlite");
      const repo = new SqliteSessionRepository(path);
      repo.create(makeSession("sess-corrupt-list"));
      repo.close();

      const db = new Database(path);
      db.run("UPDATE media_sessions SET document_json = 'null' WHERE session_id = ?", [
        "sess-corrupt-list",
      ]);
      db.close();

      const reopened = new SqliteSessionRepository(path);
      expect(() => reopened.listByStatus("created")).toThrow(SessionDocumentValidationError);
      reopened.close();
    });
  });
});
