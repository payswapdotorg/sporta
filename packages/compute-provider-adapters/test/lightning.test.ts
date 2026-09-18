/**
 * The `provider.lightning` adapter (R403) — the recorded-fixture tier: the
 * SHARED credential/failure matrix over the pinned fixtures in
 * fixtures/lightning/ (see ./remote-suite.ts), plus the Lightning-specific
 * pins (the account-key bearer header, the machines/studios endpoint
 * families, the honest not-configured studio refusal).
 *
 * The conditional integration tier lives in ./lightning.integration.test.ts
 * (guard: `LIGHTNING_API_KEY`).
 */
import { describe, expect, test } from "bun:test";
import type { ComputeJobSnapshot } from "@sporta/compute-adapter";
import { LightningComputeAdapter } from "../src/lightning/adapter";
import { LIGHTNING_API_BASE_DEFAULT, LightningRestClient } from "../src/lightning/api";
import { suiteRemoteAdapter } from "./remote-suite";
import {
  FixtureTransport,
  buildProviderJob,
  loadFixture,
  manualClock,
  microtaskSleep,
  until,
} from "./helpers";

suiteRemoteAdapter({
  label: "R403 LightningComputeAdapter (provider.lightning)",
  fixtureDir: "lightning",
  expectedAdapterId: "provider.lightning",
  expectedProviderKind: "gpu-worker",
  expectedAuthHeader: "Authorization",
  deadLetterClassFor404: "provider-job-not-found",
  succeededExecutionMs: 8765,
  runningReportsProgress: true,
  cancelMethod: "POST",
  createAdapter: (options) =>
    new LightningComputeAdapter({
      apiKey: options.withCredentials ? "lightning-api-key-fixture" : "",
      studioId: "studio-fixture-1",
      nowMs: options.nowMs,
      fetchFn: options.fetchFn,
      ...(options.sleep !== undefined ? { sleep: options.sleep } : {}),
      ...(options.pollIntervalMs !== undefined ? { pollIntervalMs: options.pollIntervalMs } : {}),
      ...(options.callTimeoutMs !== undefined ? { callTimeoutMs: options.callTimeoutMs } : {}),
    }),
});

describe("R403 LightningComputeAdapter — provider-specific pins", () => {
  test("the account API key travels as the documented bearer header", async () => {
    const transport = new FixtureTransport([loadFixture("lightning", "verify-credentials-ok")]);
    const adapter = new LightningComputeAdapter({
      apiKey: "lightning-api-key-fixture",
      nowMs: manualClock(),
      fetchFn: transport.fetch,
      callTimeoutMs: 250,
    });
    await adapter.verifyCredentials();
    expect(transport.calls[0]!.headers["Authorization"]).toBe("***");
    expect(transport.calls[0]!.url).toBe(`${LIGHTNING_API_BASE_DEFAULT}/api/v1/machines`);
  });

  test("job calls without a studio target answer the honest not-configured refusal", async () => {
    const transport = new FixtureTransport([loadFixture("lightning", "verify-credentials-ok")]);
    const adapter = new LightningComputeAdapter({
      apiKey: "lightning-api-key-fixture",
      studioId: "",
      nowMs: manualClock(),
      fetchFn: transport.fetch,
      sleep: microtaskSleep,
      pollIntervalMs: 0,
      callTimeoutMs: 250,
    });
    const job = buildProviderJob({});
    await adapter.dispatch(job);
    // Verification still works (the machines endpoint needs no studio)…
    const status = await adapter.verifyCredentials();
    expect(status.state).toBe("verified");
    // …but the job honestly failed: the studios surface is unaddressable.
    const terminal = await until(
      () => adapter.getJob(job.jobId),
      (snap): snap is ComputeJobSnapshot => snap !== null && snap.state === "failed",
    );
    expect(terminal.completion!.failure!.errorClass).toBe("provider-unavailable");
    expect(terminal.completion!.failure!.message).toContain("LIGHTNING_STUDIO_ID");
    // Only the verification call touched the network — the job refusal
    // happened client-side (the honest pre-call configuration answer).
    expect(transport.callCount).toBe(1);
  });

  test("the studios job surface targets the documented endpoint family", async () => {
    const transport = new FixtureTransport([
      loadFixture("lightning", "submit-accepted"),
      loadFixture("lightning", "status-running"),
      loadFixture("lightning", "status-succeeded"),
    ]);
    const adapter = new LightningComputeAdapter({
      apiKey: "lightning-api-key-fixture",
      studioId: "studio-fixture-1",
      nowMs: manualClock(),
      fetchFn: transport.fetch,
      sleep: microtaskSleep,
      pollIntervalMs: 0,
      callTimeoutMs: 250,
    });
    const job = buildProviderJob({});
    await adapter.dispatch(job);
    await until(
      () => adapter.getJob(job.jobId),
      (snap) => snap !== null && snap.state === "succeeded",
    );
    expect(transport.calls[0]!.url).toBe(
      `${LIGHTNING_API_BASE_DEFAULT}/api/v1/studios/studio-fixture-1/jobs`,
    );
    expect(transport.calls[1]!.url).toContain("/jobs/job-0001");
  });

  test("the standalone REST client is exported for composition (plain fetch only)", () => {
    const client = new LightningRestClient({
      apiKey: "lightning-api-key-fixture",
      fetchFn: (() => undefined) as unknown as typeof fetch,
    });
    expect(client.endpointFamily).toBe("lightning:studios");
    expect(client.providerInstanceId).toBe("lightning:unconfigured");
  });
});
