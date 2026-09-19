/**
 * THE BYOC USAGE LEDGER TESTS (R408): transparent account-scoped usage
 * records over the W914 usage vocabulary — proving, deterministically:
 *
 * 1. VERBATIM W914 RECORDS: `record` zod-validates the usage document
 *    and stores it whole inside the account-scoped envelope (timing,
 *    exit states, counts, cost units — forked nothing);
 * 2. IDEMPOTENT DRAIN: re-recording / re-draining is counted duplicates;
 *    a DIFFERENT record for the same (account, provider, job) conflicts
 *    fail-loudly (never silently replaced);
 * 3. HONEST NULLS: `summary().spendUsd` is `null` — a BYOC price is
 *    never fabricated; unknown unit kinds are not invented either;
 * 4. AGGREGATION: per-disposition counts, timing totals, per-unit
 *    totals (sorted, deterministic), per-provider filtering;
 * 5. RESPONSIBILITY: every record carries the execution-ownership
 *    boundary (user-owned-provider vs sporta-managed);
 * 6. W004 STORE SEMANTICS: both store implementations (in-memory +
 *    sqlite) share the validation path — corrupted rows fail loudly,
 *    records persist across instances, bounds reject explicitly.
 */
import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import {
  ByocLedgerConflictError,
  ByocLedgerIntegrityError,
  ByocLedgerLimitError,
  ByocLedgerScopeInvalidError,
  ByocUsageRecord,
  InMemoryByocLedgerStore,
  SqliteByocLedgerStore,
  UsageLedger,
} from "../src/ledger";
import type { ByocLedgerStore, ByocUsageRecord as ByocRecord } from "../src/ledger";
import {
  buildUsageRecord,
  manualClock,
  withTempDir,
  StubVerifiableAdapter,
  makeDescriptor,
} from "./helpers";
import { join } from "node:path";

/** A ledger over one store with a manual clock. */
function ledgerOver(store?: ByocLedgerStore) {
  const clock = manualClock();
  const ledger = new UsageLedger({ ...(store !== undefined ? { store } : {}), nowMs: clock });
  return { ledger, clock };
}

/** Records one synthetic usage doc for (account, provider, job). */
async function recordJob(
  ledger: UsageLedger,
  jobId: string,
  overrides: Record<string, unknown> = {},
  accountId = "account-1",
  providerId = "provider.stub",
) {
  return ledger.record(
    accountId,
    providerId,
    "user-owned-provider",
    buildUsageRecord({ jobId, idempotencyKey: `idem-${jobId}`, ...overrides }),
  );
}

describe("R408 — record: the W914 vocabulary, verbatim + account-scoped", () => {
  test("record validates, wraps, and returns the stored envelope", async () => {
    const { ledger } = ledgerOver();
    const usage = buildUsageRecord({ jobId: "job-1" });
    const outcome = await ledger.record("account-1", "provider.stub", "user-owned-provider", usage);
    expect(outcome.disposition).toBe("recorded");
    expect(outcome.record.accountId).toBe("account-1");
    expect(outcome.record.providerId).toBe("provider.stub");
    expect(outcome.record.executionOwnership).toBe("user-owned-provider");
    expect(outcome.record.usage).toEqual(usage);
    expect(outcome.record.recordedAtMs).toBeGreaterThan(0);
    // The envelope validates against the published schema.
    expect(() => ByocUsageRecord.parse(outcome.record)).not.toThrow();
  });

  test("an INVALID W914 usage record fails loudly (never stored)", async () => {
    const { ledger } = ledgerOver();
    const bad = buildUsageRecord();
    (bad as { timing: unknown }).timing = { queueWaitMs: -1, executionMs: 5 };
    await expect(
      ledger.record("account-1", "provider.stub", "user-owned-provider", bad),
    ).rejects.toBeInstanceOf(ByocLedgerIntegrityError);
    expect(ledger.storeStats().records).toBe(0);
  });

  test("re-recording the SAME record is a counted duplicate", async () => {
    const { ledger } = ledgerOver();
    const usage = buildUsageRecord({ jobId: "job-1" });
    await ledger.record("account-1", "provider.stub", "user-owned-provider", usage);
    const again = await ledger.record("account-1", "provider.stub", "user-owned-provider", usage);
    expect(again.disposition).toBe("duplicate");
    expect(ledger.storeStats().duplicatePuts).toBe(1);
    expect(ledger.storeStats().records).toBe(1);
  });

  test("a DIFFERENT record for the same job conflicts fail-loudly", async () => {
    const { ledger } = ledgerOver();
    await recordJob(ledger, "job-1", { timing: { queueWaitMs: 3, executionMs: 10 } });
    await expect(
      ledger.record(
        "account-1",
        "provider.stub",
        "user-owned-provider",
        buildUsageRecord({ jobId: "job-1", timing: { queueWaitMs: 3, executionMs: 99 } }),
      ),
    ).rejects.toBeInstanceOf(ByocLedgerConflictError);
  });

  test("the same job id under a different provider/account is a SEPARATE record", async () => {
    const { ledger } = ledgerOver();
    await recordJob(ledger, "job-1");
    await recordJob(ledger, "job-1", {}, "account-2");
    await recordJob(ledger, "job-1", {}, "account-1", "provider.other");
    expect(ledger.storeStats().records).toBe(3);
    // The conflict is only within one (account, provider, job) key.
    await expect(
      ledger.record(
        "account-1",
        "provider.stub",
        "user-owned-provider",
        buildUsageRecord({ jobId: "job-1", timing: { queueWaitMs: 1, executionMs: 2 } }),
      ),
    ).rejects.toBeInstanceOf(ByocLedgerConflictError);
  });

  test("NUL-containing scope parts are rejected on every path", async () => {
    const { ledger } = ledgerOver();
    await expect(
      ledger.record("bad\u0000account", "provider.stub", "user-owned-provider", buildUsageRecord()),
    ).rejects.toBeInstanceOf(ByocLedgerScopeInvalidError);
    await expect(ledger.perJob("bad\u0000account", "p", "j")).rejects.toBeInstanceOf(
      ByocLedgerScopeInvalidError,
    );
  });
});

describe("R408 — drain: the W914 metering drain, composed per account", () => {
  test("drain pulls adapter usage() records into the ledger, idempotently", async () => {
    const { ledger } = ledgerOver();
    // A REAL W914 in-memory adapter with metered usage.
    const adapter = new StubVerifiableAdapter({
      descriptor: makeDescriptor({ adapterId: "adapter-drain" }),
      nowMs: manualClock(),
      meterUsage: (input) => [
        { unitId: "compute-ms", quantity: input.executionMs },
        { unitId: "jobs", quantity: 1 },
      ],
    });
    const job = await import("@sporta/compute-adapter").then((m) =>
      m.ComputeJobDescription.parse({
        schemaVersion: "1.0",
        jobId: "drain-job-1",
        idempotencyKey: "drain-idem-1",
        sessionId: "s-drain",
        correlationId: "c-1",
        traceId: "t-1",
        renderer: { rendererId: "anime.prototype" },
        recipe: { styleId: "default", configSchemaVersion: "1.0", config: {} },
        inputs: [{ inputId: "in-1", kind: "swm-snapshot", ref: "swm://s/1" }],
        outputProfile: {
          resolution: { w: 64, h: 64 },
          frameRate: 1,
          codec: "svg",
          container: "svg",
          latencyClass: "offline",
        },
        rights: { policyRef: "p", canReferenceSourceFrames: false },
        constraints: { deadlineMs: 60_000 },
      }),
    );
    await adapter.dispatch(job);
    // Drive the job to terminal through the provider seam.
    adapter.innerProvider?.reportStarted(job.jobId);
    adapter.innerProvider?.reportOutcome(job.jobId, {
      status: "succeeded",
      outputs: [],
      consumedInputIds: [],
    });

    const first = await ledger.drain(
      "account-1",
      "provider.localish",
      "user-owned-provider",
      adapter,
    );
    expect(first.recorded).toBe(1);
    const second = await ledger.drain(
      "account-1",
      "provider.localish",
      "user-owned-provider",
      adapter,
    );
    expect(second.recorded).toBe(0);
    expect(second.duplicates).toBe(1);
    expect(ledger.storeStats().records).toBe(1);
  });
});

describe("R408 — summary: honest aggregation, nulls for unknowns", () => {
  test("summary aggregates dispositions, timing, and units; spendUsd is NULL", async () => {
    const { ledger } = ledgerOver();
    await recordJob(ledger, "job-1", {
      terminalDisposition: "succeeded",
      timing: { queueWaitMs: 3, executionMs: 100 },
      costUnits: [
        { unitId: "compute-ms", quantity: 100 },
        { unitId: "jobs", quantity: 1 },
      ],
    } as never);
    await recordJob(ledger, "job-2", {
      terminalDisposition: "failed",
      timing: { queueWaitMs: 1, executionMs: 50 },
      costUnits: [
        { unitId: "compute-ms", quantity: 50 },
        { unitId: "jobs", quantity: 1 },
      ],
    } as never);
    await recordJob(ledger, "job-3", {
      terminalDisposition: "cancelled",
      timing: { queueWaitMs: 0, executionMs: 0 },
      costUnits: [
        { unitId: "cpu-ms", quantity: 0 },
        { unitId: "jobs", quantity: 1 },
      ],
    } as never);
    const summary = await ledger.summary("account-1");
    expect(summary.jobs.total).toBe(3);
    expect(summary.jobs.perDisposition).toEqual({
      succeeded: 1,
      failed: 1,
      cancelled: 1,
      "dead-lettered": 0,
    });
    expect(summary.timing).toEqual({ totalExecutionMs: 150, totalQueueWaitMs: 4 });
    // Per-unit totals, sorted by unitId (deterministic).
    expect(summary.costUnits).toEqual([
      { unitId: "compute-ms", totalQuantity: 150, jobs: 2 },
      { unitId: "cpu-ms", totalQuantity: 0, jobs: 1 },
      { unitId: "jobs", totalQuantity: 3, jobs: 3 },
    ]);
    // THE honest null: a BYOC price is never fabricated.
    expect(summary.spendUsd).toBeNull();
    expect(JSON.stringify(summary)).toContain('"spendUsd":null');
  });

  test("summary filters per provider; accounts are isolated", async () => {
    const { ledger } = ledgerOver();
    await recordJob(ledger, "job-1", {}, "account-1", "provider.a");
    await recordJob(ledger, "job-2", {}, "account-1", "provider.b");
    await recordJob(ledger, "job-3", {}, "account-2", "provider.a");
    const perProvider = await ledger.summary("account-1", "provider.a");
    expect(perProvider.jobs.total).toBe(1);
    expect(perProvider.providerId).toBe("provider.a");
    const account2 = await ledger.summary("account-2");
    expect(account2.jobs.total).toBe(1);
    const empty = await ledger.summary("account-none");
    expect(empty.jobs.total).toBe(0);
    expect(empty.spendUsd).toBeNull();
  });

  test("history lists per account with provider/since filters; perJob finds one", async () => {
    const { ledger, clock } = ledgerOver();
    await recordJob(ledger, "job-1", {}, "account-1", "provider.a");
    const afterFirst = clock();
    await recordJob(ledger, "job-2", {}, "account-1", "provider.b");
    expect(await ledger.history("account-1")).toHaveLength(2);
    expect(await ledger.history("account-1", { providerId: "provider.a" })).toHaveLength(1);
    expect(await ledger.history("account-1", { sinceRecordedAtMs: afterFirst + 1 })).toHaveLength(
      1,
    );
    const job = await ledger.perJob("account-1", "provider.a", "job-1");
    expect(job).not.toBeNull();
    expect(job!.usage.jobId).toBe("job-1");
    expect(await ledger.perJob("account-1", "provider.a", "nope")).toBeNull();
  });
});

/** Exercises the ledger store contract on one implementation. */
function exerciseLedgerStore(name: string, build: () => ByocLedgerStore): void {
  describe(`the BYOC ledger store — ${name} (W004 repository patterns)`, () => {
    test("put/find/list round-trip; deep-clone on read", async () => {
      const store = build();
      const record: ByocRecord = {
        schemaVersion: "1.0",
        accountId: "account-1",
        providerId: "provider.stub",
        executionOwnership: "user-owned-provider",
        usage: buildUsageRecord({ jobId: "job-1" }),
        recordedAtMs: 1,
      };
      const outcome = await store.putRecord(record);
      expect(outcome.disposition).toBe("recorded");
      const found = await store.findRecord("account-1", "provider.stub", "job-1");
      expect(found).toEqual(record);
      found!.usage.timing.executionMs = 999;
      expect(
        (await store.findRecord("account-1", "provider.stub", "job-1"))!.usage.timing.executionMs,
      ).toBe(42);
      store.close();
    });

    test("the record bound rejects explicitly (never silent eviction)", async () => {
      const store = new InMemoryByocLedgerStore({ maxRecords: 1 });
      const record: ByocRecord = {
        schemaVersion: "1.0",
        accountId: "account-1",
        providerId: "provider.stub",
        executionOwnership: "user-owned-provider",
        usage: buildUsageRecord({ jobId: "job-1" }),
        recordedAtMs: 1,
      };
      await store.putRecord(record);
      await expect(
        store.putRecord({ ...record, usage: buildUsageRecord({ jobId: "job-2" }) }),
      ).rejects.toBeInstanceOf(ByocLedgerLimitError);
      store.close();
      build().close();
    });

    test("a malformed record fails validation on write", async () => {
      const store = build();
      const record: ByocRecord = {
        schemaVersion: "1.0",
        accountId: "",
        providerId: "provider.stub",
        executionOwnership: "user-owned-provider",
        usage: buildUsageRecord({ jobId: "job-1" }),
        recordedAtMs: 1,
      };
      await expect(store.putRecord(record)).rejects.toBeInstanceOf(ByocLedgerScopeInvalidError);
      store.close();
    });
  });
}

exerciseLedgerStore("in-memory", () => new InMemoryByocLedgerStore());
exerciseLedgerStore("sqlite", () => {
  const dir = withTempDir();
  return new SqliteByocLedgerStore(join(dir, "ledger.db"));
});

describe("the sqlite BYOC ledger store — durability specifics", () => {
  test("records persist across instances and stay idempotent", async () => {
    const dir = withTempDir();
    const path = join(dir, "durable.db");
    const store1 = new SqliteByocLedgerStore(path);
    const { ledger } = ledgerOver(store1);
    await recordJob(ledger, "job-1");
    store1.close();
    const store2 = new SqliteByocLedgerStore(path);
    const ledger2 = new UsageLedger({ store: store2, nowMs: manualClock() });
    expect(await ledger2.history("account-1")).toHaveLength(1);
    const again = await recordJob(ledger2, "job-1");
    expect(again.disposition).toBe("duplicate");
    store2.close();
  });

  test("a CORRUPTED payload fails loudly on read (never partial data)", async () => {
    const dir = withTempDir();
    const path = join(dir, "corrupt.db");
    const store = new SqliteByocLedgerStore(path);
    await store.putRecord({
      schemaVersion: "1.0",
      accountId: "account-1",
      providerId: "provider.stub",
      executionOwnership: "user-owned-provider",
      usage: buildUsageRecord({ jobId: "job-1" }),
      recordedAtMs: 1,
    });
    store.close();
    const db = new Database(path);
    db.exec("UPDATE byoc_usage_records SET payload = 'not-json-at-all'");
    db.close();
    const reopened = new SqliteByocLedgerStore(path);
    await expect(reopened.findRecord("account-1", "provider.stub", "job-1")).rejects.toBeInstanceOf(
      ByocLedgerIntegrityError,
    );
    reopened.close();
  });
});
