/**
 * The `provider.modal` adapter (R402) — the recorded-fixture tier: the
 * SHARED credential/failure matrix over the pinned fixtures in
 * fixtures/modal/ (see ./remote-suite.ts for the matrix), plus the
 * Modal-specific surface pins (scoped-token header names, the
 * functions-endpoint paths, the managed-actor kind).
 *
 * The conditional integration tier lives in ./modal.integration.test.ts
 * (guard: `MODAL_TOKEN_ID`).
 */
import { describe, expect, test } from "bun:test";
import { ModalComputeAdapter } from "../src/modal/adapter";
import {
  MODAL_API_BASE_DEFAULT,
  MODAL_WORKER_FUNCTION_DEFAULT,
  ModalRestClient,
} from "../src/modal/api";
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
  label: "R402 ModalComputeAdapter (provider.modal)",
  fixtureDir: "modal",
  expectedAdapterId: "provider.modal",
  expectedProviderKind: "managed-actor",
  expectedAuthHeader: "Modal-Token-Id",
  deadLetterClassFor404: "provider-job-not-found",
  succeededExecutionMs: 4321,
  runningReportsProgress: true,
  cancelMethod: "POST",
  createAdapter: (options) =>
    new ModalComputeAdapter({
      tokenId: options.withCredentials ? "modal-token-id-fixture" : "",
      tokenSecret: options.withCredentials ? "modal-token-secret-fixture" : "",
      nowMs: options.nowMs,
      fetchFn: options.fetchFn,
      ...(options.sleep !== undefined ? { sleep: options.sleep } : {}),
      ...(options.pollIntervalMs !== undefined ? { pollIntervalMs: options.pollIntervalMs } : {}),
      ...(options.callTimeoutMs !== undefined ? { callTimeoutMs: options.callTimeoutMs } : {}),
    }),
});

describe("R402 ModalComputeAdapter — provider-specific pins", () => {
  test("the scoped-token pair travels as the documented Modal header pair (never a master key)", async () => {
    const transport = new FixtureTransport([loadFixture("modal", "verify-credentials-ok")]);
    const adapter = new ModalComputeAdapter({
      tokenId: "ak-fixture-id",
      tokenSecret: "af-fixture-secret",
      nowMs: manualClock(),
      fetchFn: transport.fetch,
      callTimeoutMs: 250,
    });
    await adapter.verifyCredentials();
    expect(transport.calls[0]!.headers["Modal-Token-Id"]).toBe("***");
    expect(transport.calls[0]!.headers["Modal-Token-Secret"]).toBe("***");
    // The recorded body never echoes a credential value.
    expect(JSON.stringify(transport.calls)).not.toContain("af-fixture-secret");
  });

  test("the REST surface targets the documented functions endpoint family", async () => {
    const transport = new FixtureTransport([
      loadFixture("modal", "submit-accepted"),
      loadFixture("modal", "status-queued"),
      loadFixture("modal", "status-succeeded"),
    ]);
    const adapter = new ModalComputeAdapter({
      tokenId: "ak-fixture-id",
      tokenSecret: "af-fixture-secret",
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
    const submitCall = transport.calls[0]!;
    expect(submitCall.url).toBe(
      `${MODAL_API_BASE_DEFAULT}/v1/functions/${encodeURIComponent(MODAL_WORKER_FUNCTION_DEFAULT)}/invoke`,
    );
    // The W914 dispatch request rides the submit body verbatim.
    expect((submitCall.body as Record<string, unknown>)["job"]).toMatchObject({
      jobId: job.jobId,
      schemaVersion: "1.0",
    });
    const statusCall = transport.calls[1]!;
    expect(statusCall.url).toContain("/invocations/iv-0001");
  });

  test("the standalone REST client is exported for composition (plain fetch only)", () => {
    const client = new ModalRestClient({
      tokenId: "ak-fixture-id",
      tokenSecret: "af-fixture-secret",
      fetchFn: (() => undefined) as unknown as typeof fetch,
    });
    expect(client.endpointFamily).toBe("modal:functions");
    expect(client.providerInstanceId).toBe(`modal:${MODAL_WORKER_FUNCTION_DEFAULT}`);
  });
});
