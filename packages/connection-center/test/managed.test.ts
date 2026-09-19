/**
 * THE MANAGED COMPUTE SEAM TESTS (R409): the provider-INDEPENDENT
 * allowance/concurrency controls — proving, deterministically (injected
 * clock, in-memory broker over the REAL W914 in-memory adapter):
 *
 * 1. FAIL-CLOSED ADMISSION: no entitlement, spent period, full
 *    concurrency, exhausted count-unit, and (one-step-late, documented)
 *    exhausted metered unit → the typed `ManagedAdmissionRefusalError`
 *    BEFORE any dispatch, with the R401 `quota-exhausted` vocabulary
 *    member reused VERBATIM (never an invented reason string);
 * 2. SEQUENCING: dispatch without admission is the typed sequence error;
 *    a broker-side dispatch refusal releases the admission (the
 *    allowance was never consumed);
 * 3. VERBATIM DELEGATION: the seam's dispatch is the broker's dispatch,
 *    byte-for-byte semantics (the chosen provider's adapter executes);
 * 4. SETTLEMENT: the W914 usage record lands in the R408 ledger with
 *    the `sporta-managed` responsibility label, the in-flight slot is
 *    freed, every declared allowance unit is metered, and the policy's
 *    threshold alarms fire exactly when crossed (the W919 posture);
 * 5. PROVIDER INDEPENDENCE: no provider id appears in any refusal
 *    reason/bound; entitlements carry abstract units only;
 * 6. RESTART SAFETY: a fresh seam over the same durable LEDGER store
 *    re-derives consumption (the ledger is the truth, the cache is not).
 */
import { describe, expect, test } from "bun:test";
import { COMPUTE_BROKER_REFUSALS, InMemoryComputeBroker } from "@sporta/compute-adapter";
import {
  EntitlementConflictError,
  InMemoryEntitlementStore,
  ManagedAdmissionRefusalError,
  ManagedComputeEntitlement,
  ManagedComputeSeam,
  ManagedSequenceError,
  SqliteEntitlementStore,
} from "../src/managed";
import { SqliteByocLedgerStore, UsageLedger } from "../src/ledger";
import type { ManagedComputeEntitlement as EntitlementDoc } from "../src/managed";
import {
  buildJob,
  buildUsageRecord,
  makeDescriptor,
  manualClock,
  StubVerifiableAdapter,
  withTempDir,
  TEST_EPOCH_MS,
} from "./helpers";
import { join } from "node:path";

/** A valid entitlement (overridable). */
function makeEntitlement(overrides: Partial<EntitlementDoc> = {}): EntitlementDoc {
  return ManagedComputeEntitlement.parse({
    schemaVersion: "1.0",
    accountId: "account-1",
    planId: "plan.studio",
    periodStartMs: TEST_EPOCH_MS,
    periodEndMs: TEST_EPOCH_MS + 3_600_000,
    allowances: [
      { unitId: "jobs", limit: 10 },
      { unitId: "compute-ms", limit: 1_000 },
    ],
    maxConcurrentJobs: 2,
    ...overrides,
  });
}

/** A broker over one stub adapter (the R401 seam, real code). */
function brokerWith(adapterId = "provider.managed-a") {
  const adapter = new StubVerifiableAdapter({
    descriptor: makeDescriptor({ adapterId, providerKind: "managed-actor" }),
    nowMs: manualClock(),
    meterUsage: (input) => [
      { unitId: "compute-ms", quantity: input.executionMs },
      { unitId: "jobs", quantity: 1 },
    ],
  });
  const broker = new InMemoryComputeBroker({
    providers: [{ providerId: adapterId, adapter }],
    nowMs: manualClock(),
  });
  return { broker, adapter, providerId: adapterId };
}

/** A seam over one broker (entitlement granted separately per test). */
function seamWith(overrides: Record<string, unknown> = {}) {
  const clock = manualClock();
  const plane = brokerWith();
  const seam = new ManagedComputeSeam({
    broker: plane.broker,
    nowMs: clock,
    ...overrides,
  });
  return { seam, clock, ...plane };
}

describe("R409 — entitlements (grant / re-grant / revoke)", () => {
  test("grant stores, duplicate re-grant counts, conflicting re-grant fails", async () => {
    const { seam } = seamWith();
    const first = await seam.grantEntitlement(makeEntitlement());
    expect(first.disposition).toBe("granted");
    const again = await seam.grantEntitlement(makeEntitlement());
    expect(again.disposition).toBe("duplicate");
    await expect(
      seam.grantEntitlement(makeEntitlement({ maxConcurrentJobs: 5 })),
    ).rejects.toBeInstanceOf(EntitlementConflictError);
    // Revoke then re-grant a different one is legal.
    await seam.revokeEntitlement("account-1");
    const changed = await seam.grantEntitlement(makeEntitlement({ maxConcurrentJobs: 5 }));
    expect(changed.disposition).toBe("granted");
  });

  test("an invalid entitlement document fails validation loudly", async () => {
    const { seam } = seamWith();
    const valid = makeEntitlement();
    // Raw invalid documents (built WITHOUT the parse-first helper) — the
    // seam's grant validates and refuses them.
    const badWindow = { ...valid, periodEndMs: valid.periodStartMs - 1 };
    const badLimit = {
      ...valid,
      allowances: [{ unitId: "jobs", limit: 0 }],
    };
    const dupUnits = {
      ...valid,
      allowances: [
        { unitId: "jobs", limit: 1 },
        { unitId: "jobs", limit: 2 },
      ],
    };
    await expect(seam.grantEntitlement(badWindow as never)).rejects.toThrow(/validation/);
    await expect(seam.grantEntitlement(badLimit as never)).rejects.toThrow(/validation/);
    await expect(seam.grantEntitlement(dupUnits as never)).rejects.toThrow(/validation/);
  });
});

describe("R409 — fail-closed admission (every bound refuses BEFORE dispatch)", () => {
  test("no entitlement → the typed refusal (R401 vocabulary reused verbatim)", async () => {
    const { seam } = seamWith();
    let thrown: unknown;
    try {
      await seam.admit("account-1", buildJob());
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ManagedAdmissionRefusalError);
    const refusal = thrown as ManagedAdmissionRefusalError;
    // The refusal reason REUSES the R401 closed vocabulary, verbatim.
    expect(COMPUTE_BROKER_REFUSALS).toContain(refusal.refusalReason);
    expect(refusal.refusalReason).toBe("quota-exhausted");
    expect(refusal.bound).toBe("no-entitlement");
    expect(refusal.failureClass).toBe("resource-limit");
    // Nothing was admitted.
    expect((await seam.status("account-1")).inFlight).toBe(0);
  });

  test("outside the allowance window → period-exhausted", async () => {
    const { seam, clock } = seamWith();
    await seam.grantEntitlement(
      makeEntitlement({
        periodStartMs: clock() + 10_000,
        periodEndMs: clock() + 20_000,
      }),
    );
    await expect(seam.admit("account-1", buildJob())).rejects.toMatchObject({
      bound: "period-exhausted",
    });
  });

  test("concurrency bound → concurrency-full", async () => {
    const { seam } = seamWith();
    await seam.grantEntitlement(makeEntitlement({ maxConcurrentJobs: 1 }));
    await seam.admit("account-1", buildJob({ jobId: "job-1" }));
    await expect(seam.admit("account-1", buildJob({ jobId: "job-2" }))).rejects.toMatchObject({
      bound: "concurrency-full",
    });
    // Settle the first job → the slot frees.
    await seam.settle("account-1", "provider.managed-a", buildUsageRecord({ jobId: "job-1" }));
    await expect(seam.admit("account-1", buildJob({ jobId: "job-3" }))).resolves.toBeDefined();
  });

  test("the jobs count-unit → unit-exhausted (in-flight counts)", async () => {
    const { seam } = seamWith();
    await seam.grantEntitlement(
      makeEntitlement({ allowances: [{ unitId: "jobs", limit: 2 }], maxConcurrentJobs: 5 }),
    );
    await seam.admit("account-1", buildJob({ jobId: "job-1" }));
    await seam.admit("account-1", buildJob({ jobId: "job-2" }));
    // consumed(0) + in-flight(2) >= limit(2) → refused (concurrency is NOT
    // the binding bound here — maxConcurrentJobs is 5).
    await expect(seam.admit("account-1", buildJob({ jobId: "job-3" }))).rejects.toMatchObject({
      bound: "unit-exhausted",
    });
  });

  test("a metered unit exhausted at settle time fails-closes the NEXT admission (documented one-step-late)", async () => {
    const { seam } = seamWith();
    await seam.grantEntitlement(
      makeEntitlement({
        allowances: [
          { unitId: "compute-ms", limit: 100 },
          { unitId: "jobs", limit: 10 },
        ],
      }),
    );
    await seam.admit("account-1", buildJob({ jobId: "job-1" }));
    // A settlement consuming 150ms of a 100ms allowance.
    await seam.settle(
      "account-1",
      "provider.managed-a",
      buildUsageRecord({
        jobId: "job-1",
        timing: { queueWaitMs: 1, executionMs: 150 },
        costUnits: [{ unitId: "compute-ms", quantity: 150 }],
      }),
    );
    // The overage is recorded (transparent) and the NEXT admission fails closed.
    const status = await seam.status("account-1");
    expect(status.consumption.find((u) => u.unitId === "compute-ms")!.consumed).toBe(150);
    expect(status.admission.open).toBe(false);
    expect(status.admission.closedBound).toBe("unit-exhausted");
    await expect(seam.admit("account-1", buildJob({ jobId: "job-2" }))).rejects.toMatchObject({
      bound: "unit-exhausted",
    });
  });
});

describe("R409 — dispatch: verbatim delegation + fail-closed sequencing", () => {
  test("dispatch without admission is the typed sequence error", async () => {
    const { seam } = seamWith();
    await expect(
      seam.dispatch("account-1", "provider.managed-a", buildJob()),
    ).rejects.toBeInstanceOf(ManagedSequenceError);
  });

  test("admit → dispatch → the broker's adapter REALLY executes the job", async () => {
    const { seam, adapter } = seamWith();
    await seam.grantEntitlement(makeEntitlement());
    const job = buildJob({ jobId: "job-live-1" });
    const admission = await seam.admit("account-1", job);
    expect(admission.inFlight).toBe(0);
    expect(admission.allowances).toEqual([
      { unitId: "jobs", limit: 10, consumed: 0, remaining: 10 },
      { unitId: "compute-ms", limit: 1_000, consumed: 0, remaining: 1_000 },
    ]);
    const outcome = await seam.dispatch("account-1", "provider.managed-a", job);
    expect(outcome.disposition).toBe("admitted");
    // The adapter behind the broker is the one executing (verbatim routing).
    const snapshot = await adapter.getJobOrFail("job-live-1");
    expect(snapshot.jobId).toBe("job-live-1");
    expect((await seam.status("account-1")).inFlight).toBe(1);
  });

  test("a broker-side dispatch refusal releases the admission (allowance unconsumed)", async () => {
    const clock = manualClock();
    // A provider whose descriptor serves 'anime.prototype' — dispatching a
    // job for an UNSUPPORTED renderer makes the adapter throw its typed
    // admission error (the real pre-execution refusal path).
    const adapter = new StubVerifiableAdapter({
      descriptor: makeDescriptor({
        adapterId: "provider.picky",
        supportedRenderers: [{ rendererId: "anime.prototype" }],
      }),
      nowMs: clock,
    });
    const broker = new InMemoryComputeBroker({
      providers: [{ providerId: "provider.picky", adapter }],
      nowMs: clock,
    });
    const seam = new ManagedComputeSeam({ broker, nowMs: clock });
    await seam.grantEntitlement(makeEntitlement({ allowances: [{ unitId: "jobs", limit: 1 }] }));
    const job = buildJob({ jobId: "job-refused-1", rendererId: "renderer.unsupported" });
    await seam.admit("account-1", job);
    await expect(seam.dispatch("account-1", "provider.picky", job)).rejects.toThrow();
    // The admission was released: the slot is free again.
    expect((await seam.status("account-1")).inFlight).toBe(0);
    await expect(
      seam.admit("account-1", buildJob({ jobId: "job-refused-2" })),
    ).resolves.toBeDefined();
  });
});

describe("R409 — settlement: ledger record + metering + alarms", () => {
  test("settle records the W914 usage into the R408 ledger (sporta-managed)", async () => {
    const { seam } = seamWith();
    await seam.grantEntitlement(makeEntitlement());
    const job = buildJob({ jobId: "job-settle-1" });
    await seam.admit("account-1", job);
    await seam.dispatch("account-1", "provider.managed-a", job);
    const usage = buildUsageRecord({ jobId: "job-settle-1" });
    const settlement = await seam.settle("account-1", "provider.managed-a", usage);
    expect(settlement.ledger.disposition).toBe("recorded");
    // The ledger record carries the managed responsibility label.
    const record = await seam.usageLedger.perJob("account-1", "provider.managed-a", "job-settle-1");
    expect(record?.executionOwnership).toBe("sporta-managed");
    expect(record?.usage).toEqual(usage);
    // The in-flight slot is freed.
    expect((await seam.status("account-1")).inFlight).toBe(0);
  });

  test("re-settling the same record is idempotent (a counted duplicate)", async () => {
    const { seam } = seamWith();
    await seam.grantEntitlement(makeEntitlement());
    await seam.admit("account-1", buildJob({ jobId: "job-settle-2" }));
    const usage = buildUsageRecord({ jobId: "job-settle-2" });
    const first = await seam.settle("account-1", "provider.managed-a", usage);
    const second = await seam.settle("account-1", "provider.managed-a", usage);
    expect(second.ledger.disposition).toBe("duplicate");
    // Consumption did NOT double-count.
    expect(second.consumption.find((u) => u.unitId === "jobs")!.consumed).toBe(1);
    expect(first.consumption.find((u) => u.unitId === "jobs")!.consumed).toBe(1);
  });

  test("threshold alarms fire exactly when crossed (the W919 spend alarms)", async () => {
    const { seam } = seamWith();
    await seam.grantEntitlement(
      makeEntitlement({ allowances: [{ unitId: "compute-ms", limit: 100 }] }),
    );
    // 50ms: crosses 0.5 → one alarm.
    await seam.admit("account-1", buildJob({ jobId: "job-a" }));
    const first = await seam.settle(
      "account-1",
      "provider.managed-a",
      buildUsageRecord({
        jobId: "job-a",
        timing: { queueWaitMs: 0, executionMs: 50 },
        costUnits: [{ unitId: "compute-ms", quantity: 50 }],
      }),
    );
    expect(first.alarms).toHaveLength(1);
    expect(first.alarms[0]!.threshold).toBe(0.5);
    // 90ms total: crosses 0.8 → one alarm.
    await seam.admit("account-1", buildJob({ jobId: "job-b" }));
    const second = await seam.settle(
      "account-1",
      "provider.managed-a",
      buildUsageRecord({
        jobId: "job-b",
        timing: { queueWaitMs: 0, executionMs: 40 },
        costUnits: [{ unitId: "compute-ms", quantity: 40 }],
      }),
    );
    expect(second.alarms).toHaveLength(1);
    expect(second.alarms[0]!.threshold).toBe(0.8);
    // 105ms total: crosses 1.0 → one alarm (the exhausted alarm).
    await seam.admit("account-1", buildJob({ jobId: "job-c" }));
    const third = await seam.settle(
      "account-1",
      "provider.managed-a",
      buildUsageRecord({
        jobId: "job-c",
        timing: { queueWaitMs: 0, executionMs: 15 },
        costUnits: [{ unitId: "compute-ms", quantity: 15 }],
      }),
    );
    expect(third.alarms).toHaveLength(1);
    expect(third.alarms[0]!.threshold).toBe(1.0);
    // The alarm history is queryable per account.
    const alarms = seam.recentAlarms("account-1");
    expect(alarms.map((alarm) => alarm.threshold)).toEqual([1.0, 0.8, 0.5]);
  });

  test("settlement with an invalid W914 record fails loudly", async () => {
    const { seam } = seamWith();
    await seam.grantEntitlement(makeEntitlement());
    const bad = buildUsageRecord();
    (bad as { timing: unknown }).timing = { queueWaitMs: -5, executionMs: 1 };
    await expect(seam.settle("account-1", "provider.managed-a", bad)).rejects.toThrow(
      /W914 validation/,
    );
  });
});

describe("R409 — provider independence (the seam never couples)", () => {
  test("no provider id appears in any refusal reason, bound, or entitlement field", async () => {
    const { seam } = seamWith();
    let refusal: ManagedAdmissionRefusalError | undefined;
    try {
      await seam.admit("account-1", buildJob());
    } catch (error) {
      refusal = error as ManagedAdmissionRefusalError;
    }
    const vendorNames = ["modal", "lightning", "runpod", "aws", "azure", "gcp"];
    const scanned = [
      refusal!.message,
      refusal!.refusalReason,
      refusal!.bound,
      JSON.stringify(makeEntitlement()),
    ].join(" ");
    for (const vendor of vendorNames) {
      expect(scanned.toLowerCase()).not.toContain(vendor);
    }
    // The refusal vocabulary is the R401 closed set, verbatim members.
    expect([...COMPUTE_BROKER_REFUSALS]).toEqual([
      "no-compatible-gpu",
      "quota-exhausted",
      "credential-invalid",
      "budget-exceeded",
      "provider-unavailable",
    ]);
  });

  test("the seam composes ANY broker (a second plane, same seam)", async () => {
    const clock = manualClock();
    const planeA = brokerWith("provider.managed-a");
    const planeB = brokerWith("provider.managed-b");
    const seam = new ManagedComputeSeam({ broker: planeA.broker, nowMs: clock });
    await seam.grantEntitlement(makeEntitlement());
    const job = buildJob({ jobId: "job-plane-b" });
    await seam.admit("account-1", job);
    // The seam's dispatch goes through ITS broker — the seam itself never
    // names a provider; the caller routes per selection.
    await seam.dispatch("account-1", "provider.managed-a", job);
    expect(await planeA.adapter.getJobOrFail("job-plane-b")).toBeDefined();
    expect(await planeB.adapter.getJob("job-plane-b")).toBeNull();
  });
});

describe("R409 — restart safety (the ledger is the truth)", () => {
  test("a fresh seam over the same durable ledger re-derives consumption", async () => {
    const dir = withTempDir();
    const ledgerPath = join(dir, "ledger.db");
    const entitlementPath = join(dir, "entitlements.db");
    const clock1 = manualClock();
    const ledgerStore1 = new SqliteByocLedgerStore(ledgerPath);
    const entitlementStore1 = new SqliteEntitlementStore(entitlementPath);
    const plane1 = brokerWith();
    const seam1 = new ManagedComputeSeam({
      broker: plane1.broker,
      ledger: new UsageLedger({ store: ledgerStore1, nowMs: clock1 }),
      entitlementStore: entitlementStore1,
      nowMs: clock1,
    });
    await seam1.grantEntitlement(makeEntitlement({ allowances: [{ unitId: "jobs", limit: 2 }] }));
    await seam1.admit("account-1", buildJob({ jobId: "job-r1" }));
    await seam1.settle("account-1", "provider.managed-a", buildUsageRecord({ jobId: "job-r1" }));
    ledgerStore1.close();
    entitlementStore1.close();

    // "Restart": fresh seam, FRESH broker, the SAME durable stores.
    const clock2 = manualClock();
    const ledgerStore2 = new SqliteByocLedgerStore(ledgerPath);
    const entitlementStore2 = new SqliteEntitlementStore(entitlementPath);
    const plane2 = brokerWith();
    const seam2 = new ManagedComputeSeam({
      broker: plane2.broker,
      ledger: new UsageLedger({ store: ledgerStore2, nowMs: clock2 }),
      entitlementStore: entitlementStore2,
      nowMs: clock2,
    });
    // Consumption is re-derived from the ledger: 1 of 2 jobs used.
    const status = await seam2.status("account-1");
    expect(status.consumption.find((u) => u.unitId === "jobs")!.consumed).toBe(1);
    expect(status.admission.open).toBe(true);
    // The last admission slot works, then closes.
    await seam2.admit("account-1", buildJob({ jobId: "job-r2" }));
    await seam2
      .settle("account-2", "provider.managed-a", buildUsageRecord({ jobId: "never" }))
      .catch(() => undefined);
    await seam2.settle("account-1", "provider.managed-a", buildUsageRecord({ jobId: "job-r2" }));
    const closed = await seam2.status("account-1");
    expect(closed.admission.open).toBe(false);
    expect(closed.admission.closedBound).toBe("unit-exhausted");
    ledgerStore2.close();
    entitlementStore2.close();
  });
});

describe("R409 — status: the honest live view", () => {
  test("status answers open/closed postures for every bound", async () => {
    const { seam } = seamWith();
    // No entitlement → closed.
    expect((await seam.status("account-1")).admission.closedBound).toBe("no-entitlement");
    await seam.grantEntitlement(
      makeEntitlement({ allowances: [{ unitId: "jobs", limit: 1 }], maxConcurrentJobs: 1 }),
    );
    expect((await seam.status("account-1")).admission.open).toBe(true);
    await seam.admit("account-1", buildJob({ jobId: "job-s1" }));
    // Concurrency full → closed.
    const busy = await seam.status("account-1");
    expect(busy.inFlight).toBe(1);
    expect(busy.admission.closedBound).toBe("concurrency-full");
    await seam.settle("account-1", "provider.managed-a", buildUsageRecord({ jobId: "job-s1" }));
    // Jobs unit exhausted (1 consumed of 1) → closed.
    const done = await seam.status("account-1");
    expect(done.admission.closedBound).toBe("unit-exhausted");
  });

  test("storeStats exposes the honest counters", async () => {
    const { seam } = seamWith();
    await seam.grantEntitlement(makeEntitlement());
    const stats = seam.storeStats();
    expect(stats.entitlements.entitlements).toBe(1);
    expect(stats.ledger.records).toBe(0);
  });

  test("the default stores are in-memory; a shared entitlement store composes", async () => {
    const store = new InMemoryEntitlementStore();
    const clock = manualClock();
    const plane = brokerWith();
    const seam = new ManagedComputeSeam({
      broker: plane.broker,
      entitlementStore: store,
      nowMs: clock,
    });
    await seam.grantEntitlement(makeEntitlement());
    // A second seam sharing the store sees the entitlement.
    const seam2 = new ManagedComputeSeam({
      broker: brokerWith().broker,
      entitlementStore: store,
      nowMs: manualClock(),
    });
    expect(await seam2.entitlementOf("account-1")).not.toBeNull();
  });
});
