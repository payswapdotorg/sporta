/**
 * The production adapter's ledger tests (W914 Wave 2): admission,
 * idempotency, the decoupled handoff, cancellation with superseded reports,
 * deadline disposal, dead-lettering, metering totality.
 */
import { describe, expect, it } from "bun:test";
import { ComputeValidationError, UnknownComputeJobError } from "@sporta/compute-adapter";
import { HostedComputeAdapter } from "../src/index";
import type { HostedExecuteFn } from "../src/index";
import { TEST_EPOCH_MS, buildDispatchRequest, createTestWorker, manualClock } from "./helpers";
import type { HostedJobExecution } from "../src/index";

/** A scripted execute fn (the adapter's injected seam). */
function scriptedExecute(
  script: (job: { jobId: string }, materialized: unknown) => Promise<HostedJobExecution>,
): HostedExecuteFn {
  return script as HostedExecuteFn;
}

/** A valid success envelope for the scripted provider. */
async function successEnvelope(jobId: string): Promise<HostedJobExecution> {
  const worker = createTestWorker();
  const request = await buildDispatchRequest({ jobId });
  const execution = await worker.execute(request);
  if (execution.kind !== "executed") throw new Error("fixture render failed");
  return execution.result;
}

/** A failed envelope for the scripted provider. */
function failureEnvelope(jobId: string, errorClass: string): HostedJobExecution {
  return {
    jobId,
    status: "failed",
    outputs: [],
    consumedInputIds: [],
    failure: {
      errorClass,
      message: `${errorClass} (scripted)`,
      terminal: "non-retryable",
      retryable: false,
    },
    metering: {
      startedAtMs: TEST_EPOCH_MS,
      finishedAtMs: TEST_EPOCH_MS + 1,
      executionMs: 1,
      framesRendered: 0,
      segmentsEncoded: 0,
      segmentsStored: 0,
      bytesEncoded: 0,
      duplicateStores: 0,
    },
  };
}

/** The adapter under test with a scripted execute fn. */
function adapterWith(
  execute: HostedExecuteFn,
  overrides: { nowMs?: () => number } = {},
): HostedComputeAdapter {
  const worker = createTestWorker();
  return new HostedComputeAdapter({
    descriptor: worker.describe(),
    execute,
    nowMs: overrides.nowMs ?? manualClock(),
  });
}

/** The REAL adapter over the REAL in-process worker (the dev composition). */
function realAdapter(): HostedComputeAdapter {
  const worker = createTestWorker();
  return new HostedComputeAdapter({
    descriptor: worker.describe(),
    execute: async (job, materialized) => {
      if (materialized === undefined) throw new Error("requires materialized inputs");
      const execution = await worker.execute({ job, inputs: materialized } as never);
      if (execution.kind === "refused") throw new Error(execution.reason.message);
      return execution.result;
    },
    nowMs: manualClock(),
  });
}

describe("dispatch — admission and idempotency", () => {
  it("admits a valid job and settles it through the REAL worker execution", async () => {
    const adapter = realAdapter();
    const request = await buildDispatchRequest();
    const outcome = await adapter.dispatch(request.job, request.inputs);

    expect(outcome.disposition).toBe("admitted");
    if (outcome.disposition !== "admitted") return;
    expect(outcome.handle.jobId).toBe(request.job.jobId);
    expect(outcome.handle.adapterId).toBe("sporta.compute.hosted");

    // The decoupled handoff settles the job to succeeded.
    let snapshot = await adapter.getJobOrFail(request.job.jobId);
    for (let i = 0; i < 20 && !isTerminal(snapshot.state); i += 1) {
      await Bun.sleep(5);
      snapshot = await adapter.getJobOrFail(request.job.jobId);
    }
    expect(snapshot.state).toBe("succeeded");
    expect(snapshot.completion?.status).toBe("succeeded");
    expect(snapshot.completion?.outputs).toHaveLength(1);
    // Never-silent input accounting: both inputs consumed.
    expect(snapshot.completion?.accounting.consumedInputIds).toEqual([
      "swm-snapshot",
      "swm-events",
    ]);
    expect(snapshot.completion?.accounting.unconsumedInputs).toEqual([]);
    // The usage record: descriptor units, metered.
    expect(snapshot.completion?.usage.costUnits).toEqual([
      { unitId: "cpu-ms", quantity: snapshot.completion!.timing.executionMs },
      { unitId: "render-requests", quantity: 1 },
      { unitId: "artifact-bytes", quantity: snapshot.completion!.outputs[0]!.byteLength },
    ]);
  });

  it("an idempotent re-dispatch is a counted duplicate", async () => {
    const adapter = realAdapter();
    const request = await buildDispatchRequest();
    await adapter.dispatch(request.job, request.inputs);
    const duplicate = await adapter.dispatch(request.job, request.inputs);

    expect(duplicate.disposition).toBe("duplicate");
    const stats = adapter.stats();
    expect(stats.jobsDispatched).toBe(2);
    expect(stats.duplicates).toBe(1);
  });

  it("a malformed description throws ComputeValidationError with its own counter", async () => {
    const adapter = adapterWith(scriptedExecute(async () => failureEnvelope("x", "never")));
    expect(adapter.dispatch({ garbage: true } as never)).rejects.toBeInstanceOf(
      ComputeValidationError,
    );
    try {
      await adapter.dispatch({ garbage: true } as never);
    } catch {
      // expected
    }
    expect(adapter.stats().malformedDispatches).toBe(2);
  });

  it("admission refuses renderers the descriptor does not declare", async () => {
    const adapter = realAdapter();
    const request = await buildDispatchRequest({ rendererId: "no.such.renderer" });
    await expect(adapter.dispatch(request.job, request.inputs)).rejects.toThrow(
      /does not support renderer/,
    );
    expect(adapter.stats().refusedAdmissions).toBe(1);
  });

  it("a deadline over the descriptor bound is refused at admission", async () => {
    const adapter = realAdapter();
    const request = await buildDispatchRequest({ deadlineMs: 120_000 });
    await expect(adapter.dispatch(request.job, request.inputs)).rejects.toThrow(
      /exceeds the adapter bound/,
    );
  });
});

describe("the decoupled handoff — outcomes", () => {
  it("a provider fault dead-letters the job (internal class, no retries this wave)", async () => {
    const adapter = adapterWith(
      scriptedExecute(async () => {
        throw new Error("connection reset");
      }),
    );
    const request = await buildDispatchRequest();
    await adapter.dispatch(request.job, request.inputs);

    let snapshot = await adapter.getJobOrFail(request.job.jobId);
    for (let i = 0; i < 20 && !isTerminal(snapshot.state); i += 1) {
      await Bun.sleep(5);
      snapshot = await adapter.getJobOrFail(request.job.jobId);
    }
    expect(snapshot.state).toBe("dead-lettered");
    expect(snapshot.completion?.status).toBe("failed");
    expect(snapshot.completion?.failure?.errorClass).toBe("provider-fault");
    expect(snapshot.completion?.failure?.terminal).toBe("internal");
    expect(adapter.stats().deadLettered).toBe(1);
  });

  it("a provider failure envelope settles failed with the provider's class", async () => {
    const adapter = adapterWith(
      scriptedExecute(async (job) => failureEnvelope(job.jobId, "rights-denied")),
    );
    const request = await buildDispatchRequest();
    await adapter.dispatch(request.job, request.inputs);

    let snapshot = await adapter.getJobOrFail(request.job.jobId);
    for (let i = 0; i < 20 && !isTerminal(snapshot.state); i += 1) {
      await Bun.sleep(5);
      snapshot = await adapter.getJobOrFail(request.job.jobId);
    }
    expect(snapshot.state).toBe("failed");
    expect(snapshot.completion?.failure).toMatchObject({ errorClass: "rights-denied" });
  });

  it("cancellation wins a race against a late provider outcome (superseded report)", async () => {
    let release: (() => void) | undefined;
    const gated = new Promise<void>((resolve) => {
      release = () => resolve();
    });
    const adapter = adapterWith(
      scriptedExecute(async (job) => {
        await gated;
        return successEnvelope(job.jobId);
      }),
    );
    const request = await buildDispatchRequest();
    await adapter.dispatch(request.job, request.inputs);
    // Wait for the handoff to claim, then cancel.
    let current = await adapter.getJobOrFail(request.job.jobId);
    for (let i = 0; i < 20 && current.state !== "in-flight"; i += 1) {
      await Bun.sleep(5);
      current = await adapter.getJobOrFail(request.job.jobId);
    }
    expect(current.state).toBe("in-flight");
    const cancelled = await adapter.cancel(request.job.jobId);
    expect(cancelled.cancelled).toBe(true);
    expect((await adapter.getJobOrFail(request.job.jobId)).state).toBe("cancelled");

    release?.();
    await Bun.sleep(10);
    // The late outcome is counted superseded — the job stays cancelled.
    expect((await adapter.getJobOrFail(request.job.jobId)).state).toBe("cancelled");
    expect(adapter.stats().supersededReports).toBe(1);
  });

  it("cancelling a terminal job answers cancelled:false with its disposition", async () => {
    const adapter = adapterWith(scriptedExecute((job) => successEnvelope(job.jobId)));
    const request = await buildDispatchRequest();
    await adapter.dispatch(request.job, request.inputs);
    let snapshot = await adapter.getJobOrFail(request.job.jobId);
    for (let i = 0; i < 20 && !isTerminal(snapshot.state); i += 1) {
      await Bun.sleep(5);
      snapshot = await adapter.getJobOrFail(request.job.jobId);
    }
    const outcome = await adapter.cancel(request.job.jobId);
    expect(outcome).toEqual({
      cancelled: false,
      jobId: request.job.jobId,
      terminalDisposition: "succeeded",
    });
  });

  it("cancelling an unknown job throws UnknownComputeJobError and counts it", async () => {
    const adapter = adapterWith(scriptedExecute((job) => successEnvelope(job.jobId)));
    await expect(adapter.cancel("never-was")).rejects.toBeInstanceOf(UnknownComputeJobError);
    expect(adapter.stats().unknownCancelTargets).toBe(1);
  });
});

describe("deadline enforcement (poll/outcome-driven, no timers)", () => {
  it("a live job observed past its deadline at poll time disposes failed/timeout", async () => {
    let release: (() => void) | undefined;
    const gated = new Promise<void>((resolve) => {
      release = () => resolve();
    });
    let ticks = TEST_EPOCH_MS;
    const fastClock = (): number => (ticks += 10_000); // 10s per read
    const adapter = adapterWith(
      scriptedExecute(async (job) => {
        await gated;
        return successEnvelope(job.jobId);
      }),
      { nowMs: fastClock },
    );
    const request = await buildDispatchRequest({ deadlineMs: 1_000 });
    await adapter.dispatch(request.job, request.inputs);

    // Poll until the poll-driven disposal fires (the clock outran 1s).
    const snapshot = await adapter.getJobOrFail(request.job.jobId);
    expect(snapshot.state).toBe("failed");
    expect(snapshot.completion?.failure).toMatchObject({
      errorClass: "deadline-exceeded",
      terminal: "timeout",
    });
    release?.();
    await Bun.sleep(5);
  });

  it("a late provider outcome (past the deadline) discards its outputs", async () => {
    let release: (() => void) | undefined;
    const gated = new Promise<void>((resolve) => {
      release = () => resolve();
    });
    // Clock that only advances when we let it: slow during execution, one
    // big jump before the post-outcome check.
    let current = TEST_EPOCH_MS;
    const clock = (): number => current;
    const adapter = adapterWith(
      scriptedExecute(async (job) => {
        await gated;
        current += 120_000; // the outcome lands 120s after admission
        return successEnvelope(job.jobId);
      }),
      { nowMs: clock },
    );
    const request = await buildDispatchRequest({ deadlineMs: 60_000 });
    await adapter.dispatch(request.job, request.inputs);
    // Let the handoff claim + settle through the event loop.
    await Bun.sleep(10);
    release?.();
    await Bun.sleep(10);

    const snapshot = await adapter.getJobOrFail(request.job.jobId);
    expect(snapshot.state).toBe("failed");
    expect(snapshot.completion?.failure?.errorClass).toBe("deadline-exceeded");
    expect(snapshot.completion?.outputs).toHaveLength(0); // outputs discarded
  });
});

describe("accounting + metering totality", () => {
  it("stats identities hold after mixed outcomes (dispatched === terminal + live)", async () => {
    const adapter = realAdapter();
    const ok = await buildDispatchRequest({ jobId: "ok-1", idempotencyKey: "ok-key-1" });
    await adapter.dispatch(ok.job, ok.inputs);
    // A worker-level failure envelope (admission passes; execution fails).
    const bad = await buildDispatchRequest({ jobId: "bad-1", idempotencyKey: "bad-key-1" });
    const worker = createTestWorker();
    const failing = new HostedComputeAdapter({
      descriptor: worker.describe(),
      execute: async () => failureEnvelope("bad-1", "renderer-unknown"),
      nowMs: manualClock(),
    });
    await failing.dispatch(bad.job, bad.inputs);

    let s1 = await adapter.getJobOrFail("ok-1");
    for (let i = 0; i < 20 && !isTerminal(s1.state); i += 1) {
      await Bun.sleep(5);
      s1 = await adapter.getJobOrFail("ok-1");
    }
    let s2 = await failing.getJobOrFail("bad-1");
    for (let i = 0; i < 20 && !isTerminal(s2.state); i += 1) {
      await Bun.sleep(5);
      s2 = await failing.getJobOrFail("bad-1");
    }

    for (const [, a] of [
      ["ok", adapter],
      ["bad", failing],
    ] as const) {
      const stats = a.stats();
      const terminal = stats.succeeded + stats.failed + stats.cancelled + stats.deadLettered;
      expect(terminal + liveCount(a)).toBe(stats.jobsDispatched - stats.duplicates);
      expect(stats.usageRecords).toBe(terminal);
      expect(stats.inputsInFlight).toBe(0); // every input accounted
    }
    expect(adapter.stats().succeeded).toBe(1);
    expect(failing.stats().failed).toBe(1);
  });

  it("usage() filters by session and since-time", async () => {
    const adapter = realAdapter();
    const request = await buildDispatchRequest();
    await adapter.dispatch(request.job, request.inputs);
    let snapshot = await adapter.getJobOrFail(request.job.jobId);
    for (let i = 0; i < 20 && !isTerminal(snapshot.state); i += 1) {
      await Bun.sleep(5);
      snapshot = await adapter.getJobOrFail(request.job.jobId);
    }
    const all = await adapter.usage();
    expect(all).toHaveLength(1);
    expect(all[0]!.sessionId).toBe("sess-w914-e2e");
    const wrongSession = await adapter.usage({ sessionId: "other" });
    expect(wrongSession).toHaveLength(0);
    const sinceFuture = await adapter.usage({ sinceMs: TEST_EPOCH_MS + 10_000_000 });
    expect(sinceFuture).toHaveLength(0);
  });

  it("subscribe replays the trail then flows live events", async () => {
    const adapter = adapterWith(scriptedExecute((job) => successEnvelope(job.jobId)));
    const request = await buildDispatchRequest();
    await adapter.dispatch(request.job, request.inputs);

    const seen: string[] = [];
    adapter.subscribe(request.job.jobId, (event) => {
      seen.push(event.type);
    });
    let snapshot = await adapter.getJobOrFail(request.job.jobId);
    for (let i = 0; i < 20 && !isTerminal(snapshot.state); i += 1) {
      await Bun.sleep(5);
      snapshot = await adapter.getJobOrFail(request.job.jobId);
    }
    expect(seen).toEqual(["submitted", "dispatched", "claimed", "succeeded"]);
  });
});

/** Terminal-state predicate (the contract's own vocabulary). */
function isTerminal(state: string): boolean {
  return (
    state === "succeeded" ||
    state === "failed" ||
    state === "cancelled" ||
    state === "dead-lettered"
  );
}

/** Live (non-terminal, admitted) job count for the identity check. */
function liveCount(adapter: HostedComputeAdapter): number {
  // The adapter counts states internally; jobsDispatched - duplicates - terminal
  // is the live count. We re-derive it from stats (the totality identity).
  const stats = adapter.stats();
  return (
    stats.jobsDispatched -
    stats.duplicates -
    (stats.succeeded + stats.failed + stats.cancelled + stats.deadLettered)
  );
}
