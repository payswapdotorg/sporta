/**
 * The generic RECORDED-FIXTURE suite every remote provider adapter runs
 * (R402-R403-R404): the SAME credential/failure mapping matrix, replayed
 * against each provider's pinned fixtures — so the matrix provably holds
 * identically for `provider.modal`, `provider.lightning`, and
 * `provider.runpod`, while each adapter's own test file pins its
 * provider-specific surface (paths, kinds, the pod-not-found posture).
 *
 * The matrix (every cell a test):
 *
 * - credentials missing → dispatch throws the typed `provider-unavailable`
 *   refusal with the SandboxFallback hint BEFORE ANY NETWORK CALL;
 * - credentials present → `present-unverified`; a real 200 → `verified`;
 *   a real 401 → `invalid` (then dispatch refuses pre-network with
 *   `credential-invalid`); a network fault → honestly unverifiable;
 * - submit: accepted → queued → running (progress) → terminal; 401 →
 *   failed `credential-invalid`; 429 → failed `quota-exhausted`; network
 *   error → failed `provider-unavailable` (transport evidence); timeout →
 *   failed `provider-unavailable` (timeout evidence); NO submit retries;
 * - status: transient network fault retries ONCE inside the transport
 *   (idempotent GET); a 404 → PERMANENT (dead-lettered `internal` with the
 *   real cause); a lying terminal envelope → dead-lettered
 *   `invalid-provider-report`;
 * - cancel: provider cancel fired, ledger cancel wins, a late submit
 *   acceptance is counted `superseded-report` + best-effort cancelled;
 * - deadline: poll-driven disposal `failed`/`timeout`;
 * - ledger: idempotent duplicates, job-id collisions, descriptor
 *   admission, rights, measured usage, and the accounting identities.
 */
import { describe, expect, test } from "bun:test";
import type { ComputeAdapterPort, ComputeJobSnapshot } from "@sporta/compute-adapter";
import {
  ComputeAdmissionError,
  ComputeRightsError,
  ComputeValidationError,
} from "@sporta/compute-adapter";
import type { ProviderCredentialStatus } from "../src/common/credentials";
import { ProviderRefusalError } from "../src/common/refusal";
import type { ProviderRefusalReason } from "../src/common/refusal";
import {
  FixtureTransport,
  buildProviderJob,
  controlledClock,
  hangingFetch,
  loadFixture,
  manualClock,
  microtaskSleep,
  realSleep,
  until,
} from "./helpers";

/** The adapter surface under test (the port + the credential surface). */
export interface AdapterUnderTest extends ComputeAdapterPort {
  credentialStatus(): ProviderCredentialStatus;
  verifyCredentials(): Promise<ProviderCredentialStatus>;
}

/** How a suite builds the adapter under test (credentials on/off). */
export type AdapterFactory = (options: {
  fetchFn: import("../src/common/http").FetchLike;
  nowMs: () => number;
  withCredentials: boolean;
  /** The injected poll sleep (the fixture tier uses a microtask sleep). */
  sleep?: (ms: number) => Promise<void>;
  /** The status poll interval (the fixture tier uses 0). */
  pollIntervalMs?: number;
  /** The per-call REST timeout (tests shorten it for the timeout mapping). */
  callTimeoutMs?: number;
}) => AdapterUnderTest;

/** The per-provider profile a suite runs against. */
export interface RemoteSuiteProfile {
  /** The provider label (test names). */
  label: string;
  /** The fixtures/ subdirectory holding this provider's pins. */
  fixtureDir: string;
  /** The expected adapter id (DATA — asserted against describe()). */
  expectedAdapterId: string;
  /** The expected abstract provider kind (never a vendor name). */
  expectedProviderKind: "managed-actor" | "gpu-worker";
  /** The expected auth header NAME the client sends (values never asserted). */
  expectedAuthHeader: string;
  /** The dead-letter errorClass a 404 status poll produces. */
  deadLetterClassFor404: string;
  /** The provider-reported executionMs in the succeeded fixture. */
  succeededExecutionMs: number;
  /** Whether the provider's running status carries a progress fraction. */
  runningReportsProgress: boolean;
  /** The HTTP method the provider's cancel call uses. */
  cancelMethod: "POST" | "DELETE";
  /** Builds the adapter under test. */
  createAdapter: AdapterFactory;
}

/** The shared matrix suite (invoked by each provider's test file). */
export function suiteRemoteAdapter(profile: RemoteSuiteProfile): void {
  const F = (scenario: string) => loadFixture(profile.fixtureDir, scenario);

  /** An adapter + its replaying transport, credentials on by default. */
  function makeAdapter(
    scenarios: string[],
    options: { withCredentials?: boolean; nowMs?: () => number } = {},
  ): { adapter: AdapterUnderTest; transport: FixtureTransport } {
    const transport = new FixtureTransport(scenarios.map((s) => F(s)));
    const adapter = profile.createAdapter({
      fetchFn: transport.fetch as typeof fetch,
      nowMs: options.nowMs ?? manualClock(),
      withCredentials: options.withCredentials ?? true,
      sleep: microtaskSleep,
      pollIntervalMs: 0,
      callTimeoutMs: 250,
    });
    return { adapter, transport };
  }

  describe(`${profile.label} — recorded-fixture tier (the shared matrix)`, () => {
    // -----------------------------------------------------------------
    // Descriptor honesty
    // -----------------------------------------------------------------
    test("describe() is deep-equal stable and honestly typed", () => {
      const { adapter } = makeAdapter([]);
      const first = adapter.describe();
      const second = adapter.describe();
      expect(first).toEqual(second);
      expect(first.adapterId).toBe(profile.expectedAdapterId);
      expect(first.providerKind).toBe(profile.expectedProviderKind);
      expect(first.supportedLatencyClasses).toEqual(["offline"]);
      expect(first.costUnits.map((unit) => unit.unitId)).toEqual(["compute-ms"]);
      expect(first.supportedRenderers.map((r) => r.rendererId)).toEqual([
        "anime.prototype",
        "sporta.testcard",
      ]);
      expect(first.maxJobDeadlineMs).toBeGreaterThanOrEqual(first.minJobDeadlineMs ?? 0);
    });

    // -----------------------------------------------------------------
    // The SandboxFallback credential gate (pre-network, fail-loud)
    // -----------------------------------------------------------------
    test("SandboxFallback: missing credentials refuse dispatch BEFORE any network call", async () => {
      const { adapter, transport } = makeAdapter([], { withCredentials: false });
      const status = adapter.credentialStatus();
      expect(status.state).toBe("missing");
      expect(status.devModeHint).toBeDefined();
      expect(status.devModeHint).toContain("SandboxFallback");
      expect(() => status.devModeHint).not.toThrow();

      let thrown: unknown;
      try {
        await adapter.dispatch(buildProviderJob({}));
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(ProviderRefusalError);
      const refusal = thrown as ProviderRefusalError;
      expect(refusal.refusalReason).toBe<ProviderRefusalReason>("provider-unavailable");
      expect(refusal.terminalFailureClass).toBe("resource-limit");
      expect(refusal.message).toContain("SandboxFallback");
      expect((refusal.details as Record<string, unknown>)["credentialState"]).toBe("missing");
      // THE pre-network pin: zero transport calls.
      expect(transport.callCount).toBe(0);
      const stats = adapter.stats();
      expect(stats.resourceRefusals).toBe(1);
      expect(stats.admitted).toBe(0);
    });

    test("credentialStatus: present-unverified when configured, not-applicable never", () => {
      const { adapter } = makeAdapter([]);
      const status = adapter.credentialStatus();
      expect(status.state).toBe("present-unverified");
      expect(status.devModeHint).toBeUndefined();
    });

    test("verifyCredentials: a real 200 → verified (one authenticated GET)", async () => {
      const { adapter, transport } = makeAdapter(["verify-credentials-ok"]);
      const status = await adapter.verifyCredentials();
      expect(status.state).toBe("verified");
      expect(status.detail).toContain("HTTP 200");
      expect(transport.callCount).toBe(1);
      const call = transport.calls[0]!;
      expect(call.method).toBe("GET");
      // The auth header NAME rides the request (its VALUE is redacted).
      expect(Object.keys(call.headers)).toContain(profile.expectedAuthHeader);
      expect(call.headers[profile.expectedAuthHeader]).toBe("***");
    });

    test("verifyCredentials: a real 401 → invalid; the NEXT dispatch refuses pre-network", async () => {
      const { adapter, transport } = makeAdapter(["verify-credentials-401"]);
      const status = await adapter.verifyCredentials();
      expect(status.state).toBe("invalid");
      expect(transport.callCount).toBe(1);

      let thrown: unknown;
      try {
        await adapter.dispatch(buildProviderJob({}));
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(ProviderRefusalError);
      const refusal = thrown as ProviderRefusalError;
      expect(refusal.refusalReason).toBe<ProviderRefusalReason>("credential-invalid");
      expect(refusal.terminalFailureClass).toBe("internal");
      // Still exactly ONE call (the verification) — the gate fired first.
      expect(transport.callCount).toBe(1);
    });

    test("verifyCredentials: a network fault proves nothing (honest unverifiable)", async () => {
      const { adapter } = makeAdapter([
        "verify-credentials-network-error",
        "verify-credentials-network-error",
      ]);
      const status = await adapter.verifyCredentials();
      expect(status.state).toBe("present-unverified");
      expect(status.detail).toContain("verification attempted");
    });

    // -----------------------------------------------------------------
    // The happy path (the full W914 vocabulary trail)
    // -----------------------------------------------------------------
    test("happy path: submit → running (progress) → succeeded end-to-end", async () => {
      const { adapter, transport } = makeAdapter([
        "submit-accepted",
        "status-running",
        "status-succeeded",
      ]);
      const job = buildProviderJob({ sessionId: "sess-r40x-1" });
      const outcome = await adapter.dispatch(job);
      expect(outcome.disposition).toBe("admitted");
      if (outcome.disposition !== "admitted") throw new Error("unreachable");
      expect(outcome.handle.adapterId).toBe(profile.expectedAdapterId);

      const terminal = await until(
        () => adapter.getJob(job.jobId),
        (snap): snap is ComputeJobSnapshot =>
          snap !== null && snap.state === "succeeded" && snap.completion !== undefined,
      );
      // The event trail through the W914 vocabulary.
      expect(terminal.events.map((e) => e.type)).toEqual(
        profile.runningReportsProgress
          ? ["submitted", "dispatched", "claimed", "progress", "succeeded"]
          : ["submitted", "dispatched", "claimed", "succeeded"],
      );
      const completion = terminal.completion!;
      expect(completion.status).toBe("succeeded");
      expect(completion.outputs).toHaveLength(1);
      expect(completion.outputs[0]!.artifactId).toBe(completion.outputs[0]!.contentHash);
      expect(completion.accounting.consumedInputIds).toEqual(["input-snapshot-1"]);
      expect(completion.accounting.unconsumedInputs).toEqual([]);
      // Honest metering: the provider-reported execution duration.
      expect(completion.usage.costUnits).toEqual([
        { unitId: "compute-ms", quantity: profile.succeededExecutionMs },
      ]);
      expect(completion.usage.providerId).toBeDefined();
      // Exactly the pinned calls: submit + two status polls.
      expect(transport.callCount).toBe(3);
      // The accounting identities hold.
      const stats = adapter.stats();
      expect(stats.admitted).toBe(1);
      expect(stats.succeeded).toBe(1);
      expect(stats.inFlight).toBe(0);
      expect(stats.usageRecords).toBe(1);
      expect(stats.jobsDispatched).toBe(stats.admitted + stats.duplicates);
    });

    // -----------------------------------------------------------------
    // The submit-time failure mapping (typed reasons as errorClasses)
    // -----------------------------------------------------------------
    test("submit 401 → the job fails credential-invalid AND the adapter flips to invalid", async () => {
      const { adapter, transport } = makeAdapter(["submit-401"]);
      const job = buildProviderJob({});
      await adapter.dispatch(job);
      const terminal = await until(
        () => adapter.getJob(job.jobId),
        (snap): snap is ComputeJobSnapshot =>
          snap !== null && snap.state === "failed" && snap.completion !== undefined,
      );
      const failure = terminal.completion!.failure!;
      expect(failure.errorClass).toBe("credential-invalid");
      expect(failure.terminal).toBe("non-retryable");
      expect(adapter.credentialStatus().state).toBe("invalid");
      // A 401 at submit does not retry (ONE POST).
      expect(transport.callCount).toBe(1);
      expect(transport.calls[0]!.method).toBe("POST");
    });

    test("submit 429 → the job fails quota-exhausted (a bounded resource refused)", async () => {
      const { adapter } = makeAdapter(["submit-429"]);
      const job = buildProviderJob({});
      await adapter.dispatch(job);
      const terminal = await until(
        () => adapter.getJob(job.jobId),
        (snap): snap is ComputeJobSnapshot =>
          snap !== null && snap.state === "failed" && snap.completion !== undefined,
      );
      const failure = terminal.completion!.failure!;
      expect(failure.errorClass).toBe("quota-exhausted");
      expect(failure.terminal).toBe("non-retryable");
      // The credential state is untouched by a quota refusal.
      expect(adapter.credentialStatus().state).toBe("present-unverified");
    });

    test("submit network error → the job fails provider-unavailable (transport evidence)", async () => {
      const { adapter, transport } = makeAdapter(["submit-network-error"]);
      const job = buildProviderJob({});
      await adapter.dispatch(job);
      const terminal = await until(
        () => adapter.getJob(job.jobId),
        (snap): snap is ComputeJobSnapshot =>
          snap !== null && snap.state === "failed" && snap.completion !== undefined,
      );
      const failure = terminal.completion!.failure!;
      expect(failure.errorClass).toBe("provider-unavailable");
      expect(failure.message).toContain("network error");
      expect(failure.terminal).toBe("non-retryable");
      // The no-retry-storm pin: a dispatch POST never retries (ONE call).
      expect(transport.callCount).toBe(1);
    });

    test("submit timeout (a hanging provider) → provider-unavailable with timeout evidence", async () => {
      const transport = new FixtureTransport([]);
      const adapter = profile.createAdapter({
        fetchFn: hangingFetch,
        nowMs: manualClock(),
        withCredentials: true,
        sleep: microtaskSleep,
        pollIntervalMs: 0,
        callTimeoutMs: 60,
      });
      void transport; // the hanging transport records nothing by design
      const job = buildProviderJob({});
      await adapter.dispatch(job);
      const terminal = await until(
        () => adapter.getJob(job.jobId),
        (snap): snap is ComputeJobSnapshot =>
          snap !== null && snap.state === "failed" && snap.completion !== undefined,
      );
      const failure = terminal.completion!.failure!;
      expect(failure.errorClass).toBe("provider-unavailable");
      expect(failure.message).toContain("timed out");
    });

    test("the retry posture: an idempotent GET retries ONCE; a dispatch POST never", async () => {
      // The verification GET: network fault, then success (2 transport
      // calls = ONE retry, the bounded budget).
      const { adapter, transport } = makeAdapter([
        "verify-credentials-network-error",
        "verify-credentials-ok",
      ]);
      const status = await adapter.verifyCredentials();
      expect(status.state).toBe("verified");
      expect(transport.callCount).toBe(2);
      // The submit POST: no retry (already pinned in the network-error test).
    });

    // -----------------------------------------------------------------
    // The status-poll mapping
    // -----------------------------------------------------------------
    test("a 404 status poll is PERMANENT: dead-lettered internal with the real cause", async () => {
      const { adapter } = makeAdapter(["submit-accepted", "status-404"]);
      const job = buildProviderJob({});
      await adapter.dispatch(job);
      const terminal = await until(
        () => adapter.getJob(job.jobId),
        (snap): snap is ComputeJobSnapshot =>
          snap !== null && snap.state === "dead-lettered" && snap.completion !== undefined,
      );
      const failure = terminal.completion!.failure!;
      expect(failure.errorClass).toBe(profile.deadLetterClassFor404);
      expect(failure.terminal).toBe("internal");
      expect(failure.message.length).toBeGreaterThan(0);
      expect(adapter.stats().deadLettered).toBe(1);
    });

    test("a lying terminal envelope → dead-lettered invalid-provider-report", async () => {
      const { adapter } = makeAdapter(["submit-accepted", "status-lying-envelope"]);
      const job = buildProviderJob({});
      await adapter.dispatch(job);
      const terminal = await until(
        () => adapter.getJob(job.jobId),
        (snap): snap is ComputeJobSnapshot =>
          snap !== null && snap.state === "dead-lettered" && snap.completion !== undefined,
      );
      const failure = terminal.completion!.failure!;
      expect(failure.errorClass).toBe("invalid-provider-report");
      expect(failure.terminal).toBe("internal");
      expect(adapter.stats().invalidProviderReports).toBe(1);
    });

    test("a provider-reported failure maps to the failed bucket with its class", async () => {
      const { adapter } = makeAdapter(["submit-accepted", "status-failed"]);
      const job = buildProviderJob({});
      await adapter.dispatch(job);
      const terminal = await until(
        () => adapter.getJob(job.jobId),
        (snap): snap is ComputeJobSnapshot =>
          snap !== null && snap.state === "failed" && snap.completion !== undefined,
      );
      const failure = terminal.completion!.failure!;
      expect(failure.terminal).toBe("non-retryable");
      expect(failure.message.length).toBeGreaterThan(0);
    });

    // -----------------------------------------------------------------
    // Cancellation (the ledger cancel wins; late reports are superseded)
    // -----------------------------------------------------------------
    test("cancel while the submit is in flight: ledger cancel wins, the acceptance is superseded + best-effort cancelled", async () => {
      const transport = new FixtureTransport([F("submit-accepted"), F("cancel-ok")]);
      // Gate the FIRST call (the submit POST) until the test releases it.
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let firstCall = true;
      const gatedFetch = async (input: string | URL | Request, init?: RequestInit) => {
        if (firstCall) {
          firstCall = false;
          await gate;
        }
        return transport.fetch(input, init);
      };
      const adapter = profile.createAdapter({
        fetchFn: gatedFetch as typeof fetch,
        nowMs: manualClock(),
        withCredentials: true,
        sleep: microtaskSleep,
        pollIntervalMs: 0,
        callTimeoutMs: 250,
      });
      const job = buildProviderJob({});
      await adapter.dispatch(job);
      // Cancel BEFORE the submit answers (no provider job id yet).
      const cancelOutcome = await adapter.cancel(job.jobId);
      expect(cancelOutcome).toEqual({ cancelled: true, jobId: job.jobId });
      release();
      // The late acceptance is counted superseded and best-effort cancelled.
      await until(
        () => Promise.resolve(adapter.stats().supersededReports),
        (count) => count === 1,
      );
      const methods = transport.calls.map((call) => call.method);
      // The submit POST + the provider's own cancel call (its method). No
      // status poll ever ran — the cancel won before any poll could fire.
      expect(methods).toEqual(["POST", profile.cancelMethod]);
      const stats = adapter.stats();
      expect(stats.cancelled).toBe(1);
      expect(stats.inFlight).toBe(0);
    });

    test("cancel of a terminal job is an idempotent no-op", async () => {
      const { adapter } = makeAdapter(["submit-accepted", "status-succeeded"]);
      const job = buildProviderJob({});
      await adapter.dispatch(job);
      await until(
        () => adapter.getJob(job.jobId),
        (snap) => snap !== null && snap.state === "succeeded",
      );
      const outcome = await adapter.cancel(job.jobId);
      expect(outcome).toEqual({
        cancelled: false,
        jobId: job.jobId,
        terminalDisposition: "succeeded",
      });
    });

    // -----------------------------------------------------------------
    // The whole-job deadline (poll-driven disposal, no timers)
    // -----------------------------------------------------------------
    test("a live job past its deadline is disposed failed/timeout at poll", async () => {
      const clock = controlledClock();
      const transport = new FixtureTransport([F("submit-accepted"), F("cancel-ok")]);
      const adapter = profile.createAdapter({
        fetchFn: transport.fetch as typeof fetch,
        nowMs: clock.nowMs,
        withCredentials: true,
        sleep: microtaskSleep,
        pollIntervalMs: 0,
        callTimeoutMs: 250,
      });
      const job = buildProviderJob({ deadlineMs: 60_000 });
      await adapter.dispatch(job);
      // Deterministic ordering: advance the clock IN THE SAME continuation
      // the dispatch resolved in — the provider submit is still pending, so
      // the driver's first poll-loop deadline check fires BEFORE any status
      // call (no status fixture needed; the disposal is poll-driven).
      clock.advance(60_001);
      const terminal = await until(
        () => adapter.getJob(job.jobId),
        (snap): snap is ComputeJobSnapshot =>
          snap !== null && snap.state === "failed" && snap.completion !== undefined,
      );
      expect(terminal.events.map((e) => e.type)).toContain("deadline-timeout");
      const failure = terminal.completion!.failure!;
      expect(failure.errorClass).toBe("deadline-exceeded");
      expect(failure.terminal).toBe("timeout");
      // The disposal best-effort cancels at the provider (the in-flight
      // submit resolves after the disposal — the late acceptance is
      // superseded and the provider job is cancelled; wait for THAT call,
      // not the submit POST).
      const cancelCallHappened = () =>
        transport.calls.some(
          (call) =>
            (call.method === "POST" && call.url.includes("cancel")) || call.method === "DELETE",
        );
      await until(
        () => Promise.resolve(cancelCallHappened()),
        (has) => has,
      );
      expect(cancelCallHappened()).toBe(true);
    });

    // -----------------------------------------------------------------
    // The ledger posture (idempotency, admission, rights)
    // -----------------------------------------------------------------
    test("idempotency: a known key is a counted duplicate; a job-id collision is malformed", async () => {
      const { adapter } = makeAdapter([
        "submit-accepted",
        "status-succeeded",
        "submit-accepted",
        "status-succeeded",
      ]);
      const job = buildProviderJob({});
      await adapter.dispatch(job);
      await until(
        () => adapter.getJob(job.jobId),
        (snap) => snap !== null && snap.state === "succeeded",
      );
      const duplicate = await adapter.dispatch(
        buildProviderJob({ idempotencyKey: job.idempotencyKey }),
      );
      expect(duplicate.disposition).toBe("duplicate");
      let thrown: unknown;
      try {
        await adapter.dispatch(buildProviderJob({ idempotencyKey: "a-fresh-key" }));
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(ComputeValidationError);
      expect(adapter.stats().duplicates).toBe(1);
      expect(adapter.stats().malformedDispatches).toBe(1);
    });

    test("admission: an undeclared renderer and a source-media rights violation refuse loudly", async () => {
      const { adapter, transport } = makeAdapter([]);
      let thrown: unknown;
      try {
        await adapter.dispatch(buildProviderJob({ rendererId: "no.such.renderer" }));
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(ComputeAdmissionError);
      try {
        thrown = undefined;
        await adapter.dispatch(
          buildProviderJob({ sourceMediaInput: true, canReferenceSourceFrames: false }),
        );
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(ComputeRightsError);
      // Refusals never touched the network.
      expect(transport.callCount).toBe(0);
    });

    test("usage(): one measured record per terminal job, filterable by session", async () => {
      const { adapter } = makeAdapter(["submit-accepted", "status-succeeded"]);
      const job = buildProviderJob({ sessionId: "sess-usage-1" });
      await adapter.dispatch(job);
      await until(
        () => adapter.getJob(job.jobId),
        (snap) => snap !== null && snap.state === "succeeded",
      );
      const all = await adapter.usage();
      expect(all).toHaveLength(1);
      expect(all[0]!.sessionId).toBe("sess-usage-1");
      const filtered = await adapter.usage({ sessionId: "sess-other" });
      expect(filtered).toHaveLength(0);
    });

    test("getJobOrFail on an unknown job is the typed unknown error", async () => {
      const { adapter } = makeAdapter([]);
      let thrown: unknown;
      try {
        await adapter.getJobOrFail("never-admitted");
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(Error);
      expect((thrown as Error).name).toBe("UnknownComputeJobError");
    });
  });
}

/** Re-exported for the per-adapter files (the local live tier uses realSleep). */
export { microtaskSleep, realSleep };
