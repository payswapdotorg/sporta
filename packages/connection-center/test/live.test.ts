/**
 * THE LIVE PRODUCT-PLANE TIER (R406-R409 composed): local execution is
 * always available in the sandbox, so this suite drives the WHOLE
 * connection-center product plane over the REAL `provider.local` adapter
 * (R405 — REAL `Bun.spawn` subprocesses, the REAL nvidia-smi GPU probe,
 * the REAL wall clock for measured execution):
 *
 * connect (no credential — the local plane) → status (honest postures) →
 * verify (not-applicable) → the account's broker composed from
 * `connectedAdapters()` → the selection director's sporta-auto choice →
 * a REAL dispatch (echo subprocess) → `awaitCompletion` → the W914
 * metering drain → the BYOC usage ledger (transparent summary, honest
 * nulls) → AND the managed seam over the same broker (entitlement →
 * admit → dispatch → settle with the REAL measured usage → the jobs
 * allowance closes exactly when consumed).
 *
 * The Golden-path assertion: every layer answers with the frozen
 * vocabularies and every number is MEASURED (never invented).
 */
import { describe, expect, test } from "bun:test";
import { InMemoryComputeBroker, awaitCompletion } from "@sporta/compute-adapter";
import { LocalComputeAdapter } from "@sporta/compute-provider-adapters";
import { ConnectionCenter } from "../src/connections";
import type { ConnectionPlaneProvider } from "../src/connections";
import { SelectionDirector } from "../src/selection";
import type { ProviderSelectionFacts } from "../src/selection";
import { UsageLedger } from "../src/ledger";
import { ManagedComputeSeam, ManagedComputeEntitlement } from "../src/managed";

/** The REAL wall clock (the composition decision for the live tier). */
const realClock = (): number => Date.now();

/** A trivial REAL command table (the R405 live-tier precedent). */
const LIVE_COMMANDS = {
  "local.echo": { command: "echo", args: ["sporta-cc-live-ok"] },
} as const;

/** Builds the REAL local provider entry (the plane's DATA + factory). */
function localPlaneProvider(): ConnectionPlaneProvider {
  return {
    providerId: "provider.local",
    supportedCredentialKinds: [],
    requiresCredential: false,
    createAdapter: () =>
      new LocalComputeAdapter({
        commands: LIVE_COMMANDS,
        nowMs: realClock,
        pollIntervalMs: 5,
      }),
  };
}

/** The provider facts for the local plane (the operator's declarations). */
const LOCAL_FACTS: ProviderSelectionFacts = {
  providerId: "provider.local",
  privacyZone: "user-controlled",
  capabilityClasses: ["self-hosted"],
};

describe("R406-R409 — the LIVE product plane over the REAL local provider", () => {
  test("the full BYOC path: connect → verify → select → REAL dispatch → drain → ledger", async () => {
    const center = new ConnectionCenter({
      providers: [localPlaneProvider()],
      nowMs: realClock,
    });

    // R406: connect the local plane (no credential — not-applicable).
    const record = await center.connect("account-live", "provider.local", null);
    expect(record.state).toBe("connected-verified");
    expect(record.lastVerifiedState).toBe("not-applicable");

    // R406: the honest status report.
    const status = await center.status("account-live");
    expect(status).toHaveLength(1);
    expect(status[0]!.posture).toBe("connected-verified");
    // The descriptor derives from the REAL command table.
    expect(status[0]!.descriptor.supportedRenderers).toEqual(["local.echo"]);

    // R406: verify rides the adapter's honest not-applicable answer.
    const verified = await center.verify("account-live", "provider.local");
    expect(verified.state).toBe("connected-verified");

    // R407: the account's broker over the CONNECTED adapters (the bridge).
    const entries = center.connectedAdapters("account-live");
    expect(entries).toHaveLength(1);
    expect(entries[0]!.providerId).toBe("provider.local");
    const broker = new InMemoryComputeBroker({ providers: entries, nowMs: realClock });

    // R407: the selection director — privacy-local-only prefers exactly
    // this plane; the explanation is auditable.
    const director = new SelectionDirector({
      broker,
      facts: new Map([[LOCAL_FACTS.providerId, LOCAL_FACTS]]),
      nowMs: realClock,
    });
    const job = {
      schemaVersion: "1.0" as const,
      jobId: "cc-live-job-1",
      idempotencyKey: "cc-live-job-1",
      sessionId: "cc-live-session",
      correlationId: "cc-live-corr",
      traceId: "cc-live-trace",
      renderer: { rendererId: "local.echo" },
      recipe: { styleId: "style.default", configSchemaVersion: "1.0", config: {} },
      inputs: [
        { inputId: "input-snapshot-1", kind: "swm-snapshot" as const, ref: "sporta://swm/1" },
      ],
      outputProfile: {
        resolution: { w: 64, h: 64 },
        frameRate: 1,
        codec: "av1",
        container: "mp4",
        latencyClass: "offline" as const,
      },
      rights: { policyRef: "sporta://policy/dev", canReferenceSourceFrames: true },
      constraints: { deadlineMs: 60_000 },
    };
    const { selection, explanation } = await director.explain(
      {
        schemaVersion: "1.0",
        rendererId: "local.echo",
        latencyClass: "offline",
        deadlineMs: 60_000,
      },
      { mode: "sporta-auto", preference: { privacyPosture: "privacy-local-only" } },
    );
    expect(selection.providerId).toBe("provider.local");
    expect(explanation.considered).toHaveLength(1);
    expect(explanation.considered[0]!.quote).toBeDefined();
    // Honest nulls: the local plane cannot estimate cost/queue.
    expect(explanation.considered[0]!.quote!.estimatedCostUsd).toBeNull();
    expect(explanation.considered[0]!.quote!.estimatedQueueSeconds).toBeNull();

    // The REAL dispatch through the R401 broker (a REAL subprocess runs).
    const outcome = await broker.dispatch(selection.providerId, job);
    expect(outcome.disposition).toBe("admitted");

    // awaitCompletion: the REAL echo subprocess succeeded.
    const completion = await awaitCompletion(entries[0]!.adapter, job.jobId);
    expect(completion.status).toBe("succeeded");
    expect(completion.usage.timing.executionMs).toBeGreaterThanOrEqual(0);
    expect(completion.usage.timing.executionMs).toBeLessThan(10_000);
    expect(completion.usage.costUnits).toEqual([
      { unitId: "cpu-ms", quantity: completion.usage.timing.executionMs },
    ]);

    // R408: the metering drain into the BYOC ledger (user-owned provider).
    const ledger = new UsageLedger({ nowMs: realClock });
    const drain = await ledger.drain(
      "account-live",
      "provider.local",
      "user-owned-provider",
      entries[0]!.adapter,
    );
    expect(drain.recorded).toBe(1);
    const summary = await ledger.summary("account-live");
    expect(summary.jobs.perDisposition.succeeded).toBe(1);
    expect(summary.costUnits).toEqual([
      { unitId: "cpu-ms", totalQuantity: completion.usage.timing.executionMs, jobs: 1 },
    ]);
    // The honest null (never a fabricated price).
    expect(summary.spendUsd).toBeNull();

    // R406: disconnect ends the plane for this account.
    const removed = await center.disconnect("account-live", "provider.local");
    expect(removed.state).toBe("connected-verified");
    expect((await center.status("account-live"))[0]!.posture).toBe("disconnected");
  });

  test("the full MANAGED path over the same broker: entitlement → admit → dispatch → settle", async () => {
    const center = new ConnectionCenter({
      providers: [localPlaneProvider()],
      nowMs: realClock,
    });
    await center.connect("account-managed", "provider.local", null);
    const broker = new InMemoryComputeBroker({
      providers: center.connectedAdapters("account-managed"),
      nowMs: realClock,
    });

    // R409: a 1-job, 1-concurrency entitlement (abstract units — no
    // provider currency, no provider name in the entitlement).
    const seam = new ManagedComputeSeam({ broker, nowMs: realClock });
    const entitlement = ManagedComputeEntitlement.parse({
      schemaVersion: "1.0",
      accountId: "account-managed",
      planId: "plan.free-tier",
      periodStartMs: realClock() - 1_000,
      periodEndMs: realClock() + 3_600_000,
      allowances: [{ unitId: "jobs", limit: 1 }],
      maxConcurrentJobs: 1,
    });
    await seam.grantEntitlement(entitlement);

    // Admit → dispatch (a REAL subprocess) → settle with the REAL usage.
    const job = {
      schemaVersion: "1.0" as const,
      jobId: "cc-managed-job-1",
      idempotencyKey: "cc-managed-job-1",
      sessionId: "cc-managed-session",
      correlationId: "cc-managed-corr",
      traceId: "cc-managed-trace",
      renderer: { rendererId: "local.echo" },
      recipe: { styleId: "style.default", configSchemaVersion: "1.0", config: {} },
      inputs: [
        { inputId: "input-snapshot-1", kind: "swm-snapshot" as const, ref: "sporta://swm/1" },
      ],
      outputProfile: {
        resolution: { w: 64, h: 64 },
        frameRate: 1,
        codec: "av1",
        container: "mp4",
        latencyClass: "offline" as const,
      },
      rights: { policyRef: "sporta://policy/dev", canReferenceSourceFrames: true },
      constraints: { deadlineMs: 60_000 },
    };
    const admission = await seam.admit("account-managed", job);
    expect(admission.allowances).toEqual([{ unitId: "jobs", limit: 1, consumed: 0, remaining: 1 }]);

    const outcome = await seam.dispatch("account-managed", "provider.local", job);
    expect(outcome.disposition).toBe("admitted");

    // Await the REAL subprocess's terminal completion, then drain its usage.
    const adapter = center.adapterOf("account-managed", "provider.local")!;
    const completion = await awaitCompletion(adapter, job.jobId);
    expect(completion.status).toBe("succeeded");
    const usages = await adapter.usage();
    expect(usages).toHaveLength(1);
    const settlement = await seam.settle("account-managed", "provider.local", usages[0]!);
    expect(settlement.ledger.disposition).toBe("recorded");
    expect(settlement.consumption).toEqual([
      { unitId: "jobs", limit: 1, consumed: 1, remaining: 0 },
    ]);
    // The 1-job allowance crosses ALL three policy thresholds at once
    // (0.5, 0.8, and 1.0 of limit 1) — the honest alarm trail.
    expect(settlement.alarms.map((alarm) => alarm.threshold)).toEqual([0.5, 0.8, 1.0]);

    // Fail-closed: the allowance is consumed — the next admission refuses.
    const closed = await seam.status("account-managed");
    expect(closed.admission.open).toBe(false);
    expect(closed.admission.closedBound).toBe("unit-exhausted");
    await expect(seam.admit("account-managed", job)).rejects.toMatchObject({
      bound: "unit-exhausted",
    });

    // The settlement rode the R408 ledger (managed responsibility).
    const record = await seam.usageLedger.perJob("account-managed", "provider.local", job.jobId);
    expect(record?.executionOwnership).toBe("sporta-managed");
  });

  test("the REAL nvidia-smi probe answers honestly (CPU-only here is the truth)", async () => {
    const { detectLocalGpu } = await import("@sporta/compute-provider-adapters");
    const probe = await detectLocalGpu();
    expect(probe.probe).toBe("nvidia-smi");
    const adapter = localPlaneProvider().createAdapter(null);
    expect(adapter.describe().providerKind).toBe(probe.available ? "gpu-worker" : "cpu-worker");
  });
});
