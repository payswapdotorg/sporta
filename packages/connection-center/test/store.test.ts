/**
 * THE CONNECTION STORE TESTS (R406 substrate — the W004 repository
 * patterns): both implementations (in-memory + `bun:sqlite`) prove the
 * SAME semantics, because the repo's storage constitution is identical
 * across substrates:
 *
 * - idempotent put with conflict semantics (same fingerprint → counted
 *   duplicate; different fingerprint → fail-loud, never replaced);
 * - update requires an existing record and an advancing revision (stale
 *   writes fail loudly; the update path never replaces a credential);
 * - validation on write AND on read (a corrupted sqlite payload fails
 *   with `ConnectionStoreIntegrityError`, never partial data);
 * - deep-clone-on-read and clone-on-write (mutating a handed-out record
 *   or the input after a write never leaks into the store);
 * - NUL-free scope ids on every path (the composite key stays
 *   unambiguous);
 * - bounded sizes with explicit limit errors (never silent eviction);
 * - durable persistence across instances (reopen the same file);
 * - idempotent `close()`.
 */
import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import {
  ConnectionConflictError,
  ConnectionRecordAbsentError,
  ConnectionScopeInvalidError,
  ConnectionStoreError,
  ConnectionStoreIntegrityError,
  ConnectionStoreLimitError,
  ConnectionStaleWriteError,
  InMemoryConnectionStore,
  SqliteConnectionStore,
} from "../src/store";
import type { ConnectionRecord, ConnectionStore } from "../src/store";
import { ConnectionRecordSchema } from "../src/schema";
import { manualClock, withTempDir } from "./helpers";
import { join } from "node:path";

/** A valid record (the W914-shaped fixture, overridable). */
function makeRecord(overrides: Partial<ConnectionRecord> = {}): ConnectionRecord {
  const base: ConnectionRecord = {
    schemaVersion: "1.0",
    accountId: "account-1",
    providerId: "provider.stub",
    state: "connected-unverified",
    credential: {
      kind: "scoped-api-key",
      fingerprint: "a".repeat(16),
      presentedAtMs: 1_700_000_000_001,
    },
    connectedAtMs: 1_700_000_000_001,
    revision: 1,
    history: [{ type: "connected", atMs: 1_700_000_000_001 }],
  };
  const merged = { ...base, ...overrides };
  return ConnectionRecordSchema.parse(merged);
}

/** Exercises one store implementation against the W004 semantics. */
function exerciseStore(name: string, build: () => ConnectionStore): void {
  describe(`the connection store — ${name} (W004 repository patterns)`, () => {
    test("insert → find → list round-trips a valid record (deep-cloned)", async () => {
      const store = build();
      const record = makeRecord();
      const outcome = await store.insertRecord(record);
      expect(outcome.disposition).toBe("created");
      const found = await store.findRecord("account-1", "provider.stub");
      expect(found).toEqual(record);
      // Deep-clone-on-read: mutating the handed-out record never leaks in.
      found!.state = "connected-verified";
      expect((await store.findRecord("account-1", "provider.stub"))!.state).toBe(
        "connected-unverified",
      );
      // Clone-on-write: mutating the INPUT after insert never leaks in.
      record.history.push({ type: "verified", atMs: 99 });
      expect((await store.findRecord("account-1", "provider.stub"))!.history).toHaveLength(1);
      store.close();
    });

    test("the same credential re-inserted is a COUNTED duplicate", async () => {
      const store = build();
      await store.insertRecord(makeRecord());
      const outcome = await store.insertRecord(makeRecord());
      expect(outcome.disposition).toBe("duplicate");
      if (outcome.disposition === "duplicate") {
        expect(outcome.duplicates).toBe(1);
      }
      expect(store.stats().duplicatePuts).toBe(1);
      expect(store.stats().records).toBe(1);
      store.close();
    });

    test("a DIFFERENT credential for the same scope conflicts fail-loudly", async () => {
      const store = build();
      await store.insertRecord(makeRecord());
      let thrown: unknown;
      try {
        await store.insertRecord(
          makeRecord({
            credential: {
              kind: "scoped-api-key",
              fingerprint: "b".repeat(16),
              presentedAtMs: 1_700_000_000_002,
            },
          }),
        );
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(ConnectionConflictError);
      expect(store.stats().records).toBe(1);
      store.close();
    });

    test("a credential-ful record over a credential-less one conflicts too", async () => {
      const store = build();
      await store.insertRecord(
        makeRecord({
          state: "connected-verified",
          credential: null,
          lastVerifiedAtMs: 1,
          lastVerifiedState: "not-applicable",
        }),
      );
      await expect(store.insertRecord(makeRecord())).rejects.toBeInstanceOf(
        ConnectionConflictError,
      );
      store.close();
    });

    test("update requires an existing record (never a silent create)", async () => {
      const store = build();
      await expect(store.updateRecord(makeRecord())).rejects.toBeInstanceOf(
        ConnectionRecordAbsentError,
      );
      store.close();
    });

    test("update requires revision to advance exactly (stale writes fail)", async () => {
      const store = build();
      const created = await store.insertRecord(makeRecord());
      const record = created.record;
      // A same-revision rewrite is stale.
      await expect(
        store.updateRecord({
          ...record,
          history: [...record.history, { type: "connect-duplicate", atMs: 99 }],
        }),
      ).rejects.toBeInstanceOf(ConnectionStaleWriteError);
      // A jumping revision is stale too.
      await expect(
        store.updateRecord({ ...record, revision: 5, state: "connected-invalid" }),
      ).rejects.toBeInstanceOf(ConnectionStaleWriteError);
      // The honest +1 update lands and is counted.
      const updated = await store.updateRecord({
        ...record,
        revision: 2,
        state: "connected-verified",
        lastVerifiedAtMs: 1_700_000_000_010,
        lastVerifiedState: "verified",
        history: [...record.history, { type: "verified", atMs: 1_700_000_000_010 }],
      });
      expect(updated.disposition).toBe("updated");
      expect(store.stats().updates).toBe(1);
      // The update path never replaces a credential.
      await expect(
        store.updateRecord({
          ...record,
          revision: 3,
          credential: {
            kind: "scoped-api-key",
            fingerprint: "c".repeat(16),
            presentedAtMs: 1,
          },
        }),
      ).rejects.toBeInstanceOf(ConnectionConflictError);
      store.close();
    });

    test("a malformed record fails validation on WRITE (integrity)", async () => {
      const store = build();
      const bad = makeRecord();
      (bad as { state: string }).state = "connected-sorta";
      await expect(store.insertRecord(bad)).rejects.toBeInstanceOf(ConnectionStoreIntegrityError);
      store.close();
    });

    test("NUL-containing scope ids are rejected on EVERY path", async () => {
      const store = build();
      const bad = makeRecord({ accountId: "bad\u0000account" });
      await expect(store.insertRecord(bad)).rejects.toBeInstanceOf(ConnectionScopeInvalidError);
      await expect(store.findRecord("bad\u0000account", "provider.stub")).rejects.toBeInstanceOf(
        ConnectionScopeInvalidError,
      );
      await expect(store.deleteRecord("", "provider.stub")).rejects.toBeInstanceOf(
        ConnectionScopeInvalidError,
      );
      await expect(store.listRecords("bad\u0000account")).rejects.toBeInstanceOf(
        ConnectionScopeInvalidError,
      );
      store.close();
    });

    test("the record bound rejects loudly (never silent eviction)", async () => {
      const tight = new InMemoryConnectionStore({ maxRecords: 1, nowMs: manualClock() });
      await tight.insertRecord(makeRecord());
      await expect(
        tight.insertRecord(makeRecord({ providerId: "provider.other" })),
      ).rejects.toBeInstanceOf(ConnectionStoreLimitError);
      tight.close();
    });

    test("history over the bound rejects loudly (never silent truncation)", async () => {
      const store = new InMemoryConnectionStore({
        maxHistoryEntries: 2,
        nowMs: manualClock(),
      });
      const record = makeRecord({
        history: [
          { type: "connected", atMs: 1 },
          { type: "verified", atMs: 2 },
          { type: "connect-duplicate", atMs: 3 },
        ],
      });
      await expect(store.insertRecord(record)).rejects.toBeInstanceOf(ConnectionStoreLimitError);
      store.close();
    });

    test("audit append/list round-trip newest-first, bounded", async () => {
      const store = build();
      await store.appendAudit({
        schemaVersion: "1.0",
        accountId: "account-1",
        providerId: "provider.stub",
        outcome: "connected",
        atMs: 1,
      });
      await store.appendAudit({
        schemaVersion: "1.0",
        accountId: "account-1",
        providerId: "provider.stub",
        outcome: "verified",
        atMs: 2,
      });
      await store.appendAudit({
        schemaVersion: "1.0",
        accountId: "account-2",
        providerId: "provider.stub",
        outcome: "connected",
        atMs: 3,
      });
      const audit = await store.listAudit("account-1");
      expect(audit.map((entry) => entry.outcome)).toEqual(["verified", "connected"]);
      expect(await store.listAudit("account-1", 1)).toHaveLength(1);
      expect(await store.listAudit("account-2")).toHaveLength(1);
      expect(store.stats().auditEntries).toBe(3);
      store.close();
    });

    test("a malformed audit entry fails validation on write", async () => {
      const store = build();
      await expect(
        store.appendAudit({
          schemaVersion: "1.0",
          accountId: "account-1",
          providerId: "provider.stub",
          outcome: "connected-ish",
          atMs: 1,
        } as unknown as Parameters<ConnectionStore["appendAudit"]>[0]),
      ).rejects.toBeInstanceOf(ConnectionStoreIntegrityError);
      store.close();
    });

    test("delete removes and returns; absent deletes answer null", async () => {
      const store = build();
      const created = await store.insertRecord(makeRecord());
      const removed = await store.deleteRecord("account-1", "provider.stub");
      expect(removed).toEqual(created.record);
      expect(await store.deleteRecord("account-1", "provider.stub")).toBeNull();
      expect(await store.findRecord("account-1", "provider.stub")).toBeNull();
      store.close();
    });

    test("close is idempotent; a closed store fails loudly", async () => {
      const store = build();
      store.close();
      store.close();
      expect(() => store.stats()).toThrow(ConnectionStoreError);
      await expect(store.findRecord("account-1", "provider.stub")).rejects.toBeInstanceOf(
        ConnectionStoreError,
      );
    });

    test("account isolation at the store level", async () => {
      const store = build();
      await store.insertRecord(makeRecord());
      await store.insertRecord(makeRecord({ accountId: "account-2" }));
      expect((await store.listRecords("account-1")).map((r) => r.accountId)).toEqual(["account-1"]);
      expect((await store.listRecords("account-2")).map((r) => r.accountId)).toEqual(["account-2"]);
      expect(store.stats().records).toBe(2);
      store.close();
    });
  });
}

exerciseStore("in-memory", () => new InMemoryConnectionStore({ nowMs: manualClock() }));

exerciseStore("sqlite (file-backed)", () => {
  const dir = withTempDir();
  return new SqliteConnectionStore(join(dir, "store.db"), { nowMs: manualClock() });
});

describe("the sqlite connection store — durability specifics", () => {
  test("records and audit persist across instances (reopen the same file)", async () => {
    const dir = withTempDir();
    const path = join(dir, "durable.db");
    const store1 = new SqliteConnectionStore(path, { nowMs: manualClock() });
    await store1.insertRecord(makeRecord());
    await store1.appendAudit({
      schemaVersion: "1.0",
      accountId: "account-1",
      providerId: "provider.stub",
      outcome: "connected",
      atMs: 1,
    });
    store1.close();
    const store2 = new SqliteConnectionStore(path, { nowMs: manualClock() });
    expect(await store2.findRecord("account-1", "provider.stub")).not.toBeNull();
    expect(await store2.listAudit("account-1")).toHaveLength(1);
    // Duplicates still count across instances.
    const outcome = await store2.insertRecord(makeRecord());
    expect(outcome.disposition).toBe("duplicate");
    store2.close();
  });

  test("a CORRUPTED payload fails loudly on read (never partial data)", async () => {
    const dir = withTempDir();
    const path = join(dir, "corrupt.db");
    const store = new SqliteConnectionStore(path, { nowMs: manualClock() });
    await store.insertRecord(makeRecord());
    store.close();
    // Corrupt the row directly (the integrity-on-read guard's adversary).
    const db = new Database(path);
    db.exec('UPDATE connection_records SET payload = \'{"schemaVersion": "1.0", "bogus":\'');
    db.close();
    const reopened = new SqliteConnectionStore(path, { nowMs: manualClock() });
    await expect(reopened.findRecord("account-1", "provider.stub")).rejects.toBeInstanceOf(
      ConnectionStoreIntegrityError,
    );
    reopened.close();
  });

  test("a payload whose scope does not match its row fails loudly (key-space ambiguity)", async () => {
    const dir = withTempDir();
    const path = join(dir, "scope-swap.db");
    const store = new SqliteConnectionStore(path, { nowMs: manualClock() });
    await store.insertRecord(makeRecord());
    await store.insertRecord(makeRecord({ accountId: "account-2", providerId: "provider.two" }));
    store.close();
    // Swap the two payloads (same schema, wrong rows).
    const db = new Database(path);
    const rows = db
      .query("SELECT scope, payload FROM connection_records ORDER BY scope")
      .all() as Array<{ scope: string; payload: string }>;
    db.query("UPDATE connection_records SET payload = ? WHERE scope = ?").run(
      rows[1]!.payload,
      rows[0]!.scope,
    );
    db.close();
    const reopened = new SqliteConnectionStore(path, { nowMs: manualClock() });
    await expect(reopened.findRecord("account-1", "provider.stub")).rejects.toBeInstanceOf(
      ConnectionStoreIntegrityError,
    );
    reopened.close();
  });

  test("an open Database can be handed in (owned vs borrowed)", async () => {
    const dir = withTempDir();
    const path = join(dir, "shared.db");
    const db = new Database(path);
    const borrowed = new SqliteConnectionStore(db, { nowMs: manualClock() });
    await borrowed.insertRecord(makeRecord());
    borrowed.close();
    expect(() => db.query("SELECT 1 AS ok").get()).not.toThrow(); // borrowed: close() must not close the caller's handle
    db.close();
    const owned = new SqliteConnectionStore(path, { nowMs: manualClock() });
    expect(await owned.findRecord("account-1", "provider.stub")).not.toBeNull();
    owned.close();
  });
});
