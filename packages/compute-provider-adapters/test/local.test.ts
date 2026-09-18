/**
 * The `provider.local` adapter (R405) — the FULL LIVE TIER: local execution
 * is always available in the sandbox, so every test here runs REAL
 * subprocesses (`Bun.spawn`) end-to-end through the W914 vocabulary —
 * status, events, accounting, usage — with the REAL wall clock injected
 * (measured subprocess durations are the honest evidence; no fabricated
 * numbers) and the REAL nvidia-smi GPU probe (honestly CPU-only in this
 * sandbox — the GPU path is exercised through the injected probe).
 */
import { describe, expect, test } from "bun:test";
import type { ComputeJobSnapshot } from "@sporta/compute-adapter";
import { LocalComputeAdapter, createLocalComputeAdapter } from "../src/local/adapter";
import { LOCAL_ADAPTER_ID } from "../src/local/adapter";
import { detectLocalGpu } from "../src/local/gpu";
import { ProviderRefusalError } from "../src/common/refusal";
import { buildProviderJob, controlledClock, until } from "./helpers";

/** The REAL wall clock (injected by the test — the composition decision). */
const realClock = (): number => Date.now();

/** A trivial command table for the live tier (REAL executables). */
const LIVE_COMMANDS = {
  "local.echo": { command: "echo", args: ["sporta-local-ok"] },
  "local.cat": { command: "cat" },
  "local.exit3": { command: "bun", args: ["-e", "process.stderr.write('boom'); process.exit(3)"] },
  "local.sleep": { command: "sleep", args: ["30"] },
  "local.noise": { command: "bun", args: ["-e", "process.stdout.write('x'.repeat(4096))"] },
} as const;

/** Builds a live adapter over the trivial table (real sleep pacing). */
function liveAdapter(
  overrides: Parameters<typeof LocalComputeAdapter.prototype.describe> extends never
    ? never
    : {
        gpu?: { available: boolean; probe: "nvidia-smi" };
        maxOutputBytes?: number;
        nowMs?: () => number;
      } = {},
): LocalComputeAdapter {
  return new LocalComputeAdapter({
    commands: LIVE_COMMANDS,
    nowMs: overrides.nowMs ?? realClock,
    pollIntervalMs: 5,
    ...(overrides.gpu !== undefined ? { gpu: overrides.gpu } : {}),
    ...(overrides.maxOutputBytes !== undefined ? { maxOutputBytes: overrides.maxOutputBytes } : {}),
  });
}

/** Awaits a terminal snapshot of one job. */
async function terminalOf(
  adapter: LocalComputeAdapter,
  jobId: string,
): Promise<ComputeJobSnapshot> {
  return until(
    () => adapter.getJob(jobId),
    (snap): snap is ComputeJobSnapshot => snap !== null && snap.completion !== undefined,
    15_000,
  );
}

describe("R405 LocalComputeAdapter (provider.local) — the LIVE tier", () => {
  test("the REAL nvidia-smi probe answers honestly (CPU-only here is the truth)", async () => {
    const probe = await detectLocalGpu();
    expect(probe.probe).toBe("nvidia-smi");
    // Whatever the machine says is the honest answer; the sandbox has no
    // GPU, so the descriptor below must say cpu-worker.
    expect(typeof probe.available).toBe("boolean");
    const adapter = await createLocalComputeAdapter({ commands: LIVE_COMMANDS, nowMs: realClock });
    expect(adapter.gpu()).toEqual(probe);
    expect(adapter.describe().providerKind).toBe(probe.available ? "gpu-worker" : "cpu-worker");
    expect(adapter.describe().adapterId).toBe(LOCAL_ADAPTER_ID);
  });

  test("a trivial REAL workload end-to-end: echo → content-addressed artifact + the W914 trail", async () => {
    const adapter = liveAdapter();
    const job = buildProviderJob({
      jobId: "local-live-echo-1",
      idempotencyKey: "local-live-echo-1",
      rendererId: "local.echo",
    });
    const outcome = await adapter.dispatch(job);
    expect(outcome.disposition).toBe("admitted");
    const terminal = await terminalOf(adapter, job.jobId);
    expect(terminal.state).toBe("succeeded");
    expect(terminal.events.map((e) => e.type)).toEqual([
      "submitted",
      "dispatched",
      "claimed",
      "succeeded",
    ]);
    const completion = terminal.completion!;
    expect(completion.outputs).toHaveLength(1);
    const artifact = completion.outputs[0]!;
    // The stdout artifact is content-addressed (sha-256 of "sporta-local-ok\n").
    expect(artifact.delivery).toEqual({ mode: "inline", content: "sporta-local-ok\n" });
    expect(artifact.artifactId).toBe(artifact.contentHash);
    expect(artifact.artifactId).toMatch(/^[0-9a-f]{64}$/);
    expect(artifact.contentType).toBe("text/plain");
    expect(artifact.byteLength).toBe(new TextEncoder().encode("sporta-local-ok\n").length);
    // Honest accounting: a subprocess cannot observe input consumption.
    expect(completion.accounting.consumedInputIds).toEqual([]);
    expect(completion.accounting.unconsumedInputs).toEqual([
      { inputId: "input-snapshot-1", reason: "provider did not consume this manifested input" },
    ]);
    // Honest metering: the MEASURED wall clock (real clock, > 0, sane).
    const usage = completion.usage;
    expect(usage.costUnits).toEqual([{ unitId: "cpu-ms", quantity: usage.timing.executionMs }]);
    expect(usage.timing.executionMs).toBeGreaterThanOrEqual(0);
    expect(usage.timing.executionMs).toBeLessThan(10_000);
    expect(usage.attempts).toBe(1);
    expect(usage.claims).toBe(1);
    // The accounting identities hold.
    const stats = adapter.stats();
    expect(stats.succeeded).toBe(1);
    expect(stats.inFlight).toBe(0);
    expect(stats.usageRecords).toBe(1);
  });

  test("the job JSON rides STDIN: a REAL `cat` workload echoes it back", async () => {
    const adapter = liveAdapter();
    const job = buildProviderJob({
      jobId: "local-live-cat-1",
      idempotencyKey: "local-live-cat-1",
      rendererId: "local.cat",
    });
    await adapter.dispatch(job);
    const terminal = await terminalOf(adapter, job.jobId);
    expect(terminal.state).toBe("succeeded");
    const content = terminal.completion!.outputs[0]!.delivery;
    expect(content).toEqual({
      mode: "inline",
      content: expect.stringContaining("local-live-cat-1"),
    });
  });

  test("a nonzero exit code fails honestly with the REAL code + stderr tail", async () => {
    const adapter = liveAdapter();
    const job = buildProviderJob({
      jobId: "local-live-exit3-1",
      idempotencyKey: "local-live-exit3-1",
      rendererId: "local.exit3",
    });
    await adapter.dispatch(job);
    const terminal = await terminalOf(adapter, job.jobId);
    expect(terminal.state).toBe("failed");
    const failure = terminal.completion!.failure!;
    expect(failure.errorClass).toBe("local-process-exit-3");
    expect(failure.message).toContain("exited with code 3");
    expect(failure.message).toContain("boom");
    expect(failure.terminal).toBe("non-retryable");
  });

  test("a missing command fails honestly with the REAL spawn cause", async () => {
    const adapter = new LocalComputeAdapter({
      commands: { "local.ghost": { command: "definitely-not-a-real-binary-xyz" } },
      nowMs: realClock,
      pollIntervalMs: 5,
    });
    const job = buildProviderJob({
      jobId: "local-live-ghost-1",
      idempotencyKey: "local-live-ghost-1",
      rendererId: "local.ghost",
    });
    await adapter.dispatch(job);
    const terminal = await terminalOf(adapter, job.jobId);
    expect(terminal.state).toBe("failed");
    const failure = terminal.completion!.failure!;
    expect(failure.errorClass).toBe("local-process-spawn-failed");
    expect(failure.message).toContain("Executable not found in $PATH");
  });

  test("an over-budget stdout fails honestly (no artifact handed back)", async () => {
    const adapter = liveAdapter({ maxOutputBytes: 64 });
    const job = buildProviderJob({
      jobId: "local-live-noise-1",
      idempotencyKey: "local-live-noise-1",
      rendererId: "local.noise",
    });
    await adapter.dispatch(job);
    const terminal = await terminalOf(adapter, job.jobId);
    expect(terminal.state).toBe("failed");
    const failure = terminal.completion!.failure!;
    expect(failure.errorClass).toBe("local-output-over-budget");
    expect(failure.terminal).toBe("non-retryable");
  });

  test("cancel kills a REAL long-running subprocess (the ledger cancel wins)", async () => {
    const adapter = liveAdapter();
    const job = buildProviderJob({
      jobId: "local-live-sleep-1",
      idempotencyKey: "local-live-sleep-1",
      rendererId: "local.sleep",
    });
    await adapter.dispatch(job);
    // Wait until the process is genuinely executing, then cancel.
    await until(
      () => adapter.getJob(job.jobId),
      (snap) => snap !== null && snap.state === "in-flight",
      15_000,
    );
    const outcome = await adapter.cancel(job.jobId);
    expect(outcome).toEqual({ cancelled: true, jobId: job.jobId });
    const terminal = await terminalOf(adapter, job.jobId);
    expect(terminal.state).toBe("cancelled");
    expect(terminal.completion!.status).toBe("cancelled");
    expect(adapter.stats().cancelled).toBe(1);
  });

  test("the whole-job deadline disposes + kills a stuck REAL subprocess", async () => {
    const clock = controlledClock();
    const adapter = liveAdapter({ nowMs: clock.nowMs });
    const job = buildProviderJob({
      jobId: "local-live-sleep-2",
      idempotencyKey: "local-live-sleep-2",
      rendererId: "local.sleep",
      deadlineMs: 10_000, // the local adapter's honest floor
    });
    await adapter.dispatch(job);
    await until(
      () => adapter.getJob(job.jobId),
      (snap) => snap !== null && snap.state === "in-flight",
      15_000,
    );
    clock.advance(10_001);
    const terminal = await terminalOf(adapter, job.jobId);
    expect(terminal.state).toBe("failed");
    expect(terminal.events.map((e) => e.type)).toContain("deadline-timeout");
    expect(terminal.completion!.failure!.terminal).toBe("timeout");
  });

  test("the GPU gate: a GPU-requiring workload against a CPU-only probe refuses typed", async () => {
    const adapter = liveAdapter({ gpu: { available: false, probe: "nvidia-smi" } });
    expect(adapter.describe().providerKind).toBe("cpu-worker");
    let thrown: unknown;
    try {
      await adapter.dispatch(
        buildProviderJob({
          jobId: "local-gpu-1",
          idempotencyKey: "local-gpu-1",
          rendererId: "local.echo",
          computeClass: "gpu",
        }),
      );
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(ProviderRefusalError);
    const refusal = thrown as ProviderRefusalError;
    expect(refusal.refusalReason).toBe("no-compatible-gpu");
    expect(refusal.terminalFailureClass).toBe("resource-limit");
    expect(refusal.message).toContain("no local GPU was detected");
    // A GPU probe that says yes admits the same workload (descriptor honesty).
    const gpuAdapter = liveAdapter({ gpu: { available: true, probe: "nvidia-smi" } });
    expect(gpuAdapter.describe().providerKind).toBe("gpu-worker");
    const outcome = await gpuAdapter.dispatch(
      buildProviderJob({
        jobId: "local-gpu-2",
        idempotencyKey: "local-gpu-2",
        rendererId: "local.echo",
        computeClass: "gpu",
      }),
    );
    expect(outcome.disposition).toBe("admitted");
    await terminalOf(gpuAdapter, "local-gpu-2");
  });

  test("credentials are honestly not-applicable (no call, no network)", async () => {
    const adapter = liveAdapter();
    expect(adapter.credentialStatus()).toEqual({
      state: "not-applicable",
      detail: "the local self-hosted adapter needs no credentials",
    });
    const verified = await adapter.verifyCredentials();
    expect(verified.state).toBe("not-applicable");
  });

  test("the descriptor derives from the command table (never declares an unmapped renderer)", () => {
    const adapter = liveAdapter();
    const descriptor = adapter.describe();
    expect(descriptor.supportedRenderers.map((r) => r.rendererId)).toEqual(
      Object.keys(LIVE_COMMANDS),
    );
    expect(descriptor.supportedLatencyClasses).toEqual(["offline", "near-live"]);
    // Deep-equal stable.
    expect(adapter.describe()).toEqual(descriptor);
    // An empty table is a fail-loud constructor error (descriptor honesty).
    expect(
      () =>
        new LocalComputeAdapter({
          commands: {},
          nowMs: realClock,
        }),
    ).toThrow(/at least one mapped renderer command/);
  });

  test("the ledger posture holds locally too (duplicates, collisions, admission)", async () => {
    const adapter = liveAdapter();
    const job = buildProviderJob({
      jobId: "local-ledger-1",
      idempotencyKey: "local-ledger-1",
      rendererId: "local.echo",
    });
    await adapter.dispatch(job);
    const duplicate = await adapter.dispatch(
      buildProviderJob({ idempotencyKey: "local-ledger-1", rendererId: "local.echo" }),
    );
    expect(duplicate.disposition).toBe("duplicate");
    let thrown: unknown;
    try {
      await adapter.dispatch(
        buildProviderJob({
          jobId: "local-ledger-1", // the SAME id under a NEW key: the collision
          idempotencyKey: "fresh-key-1",
          rendererId: "local.echo",
        }),
      );
    } catch (err) {
      thrown = err;
    }
    expect((thrown as Error).name).toBe("ComputeValidationError"); // job-id collision
    thrown = undefined;
    try {
      await adapter.dispatch(
        buildProviderJob({ idempotencyKey: "fresh-key-2", rendererId: "no.such.local" }),
      );
    } catch (err) {
      thrown = err;
    }
    expect((thrown as Error).name).toBe("ComputeAdmissionError");
    // Wait for the live job to settle so the identities hold at the end.
    await terminalOf(adapter, job.jobId);
    const stats = adapter.stats();
    expect(stats.jobsDispatched).toBe(stats.admitted + stats.duplicates);
    expect(stats.inFlight).toBe(0);
  });
});
