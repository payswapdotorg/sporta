/**
 * REL-031 — THE PHASE-5 DURABILITY LAW over the external feed session,
 * proven end-to-end on the accelerated clock (the repo's durability-test
 * discipline):
 *
 * - DISCONNECT + CRASH + RESUME: the client drops while its batch is
 *   mid-flight; the worker crashes after item 1's durable checkpoint (the
 *   release-gate trick); the lease expires on the manual clock; a
 *   RECONNECTED session handle (a new connection over the same canonical
 *   stores) re-submits the batch — the at-least-once re-affirmation
 *   CONVERGES by idempotency (REL-029's keys: the same envelope, the same
 *   durable job) — and the resumed drive takes over the lease and completes
 *   from the per-item checkpoints EXACTLY ONCE. The recovered session's
 *   record is DEEP-EQUAL to an uninterrupted run's record: the
 *   authoritative outcome is history-independent.
 *
 * - CANCEL: a cancellation requested mid-flight (honored at the executor's
 *   next per-item checkpoint) leaves NO partial authoritative output — the
 *   feed record is the typed-refusal record only.
 *
 * - THE KEY LAW: the same idempotency key with a DIFFERENT request refuses
 *   typed at the platform boundary (never silently re-run).
 */
import { afterAll, describe, expect, test } from "bun:test";
import { createWorkerRuntime } from "@sporta/durable-jobs";
import type { JobExecutor } from "@sporta/durable-jobs";
import { buildWorkspaceStack, cleanupScratch, SIMULATED_PLATFORM } from "./fixtures";
import { createExternalFeed, createSimulatedExternalFeedSource, feedSubmissionKey } from "../src";
import type { PlatformWorkspace } from "../src";

afterAll(() => {
  cleanupScratch();
});

// ---------------------------------------------------------------------------
// The crash-injection helpers (the repo's durability-test precedent, local)
// ---------------------------------------------------------------------------

/** A promise resolved when the Nth checkpoint has landed. */
function checkpointSignal(count: number) {
  let observed = 0;
  let release!: () => void;
  const promise = new Promise<void>((done) => {
    release = done;
  });
  return {
    promise,
    notify: () => {
      observed += 1;
      if (observed >= count) release();
    },
  };
}

/** A gate the crashing worker waits on forever (it never writes again). */
function releaseGate(): { gate: Promise<void>; release: () => void } {
  let release!: () => void;
  const gate = new Promise<void>((done) => {
    release = done;
  });
  return { gate, release };
}

/**
 * Wraps the workspace's executors so the given kind stalls at the Nth
 * durable checkpoint (the simulated crash — the worker never writes again).
 */
function wrapWithStall(
  executors: readonly JobExecutor[],
  kind: string,
  stallAfterCheckpoints: number,
  gate: Promise<void>,
  afterCheckpoint?: () => void,
): JobExecutor[] {
  return executors.map((executor) => {
    if (executor.kind !== kind) return executor;
    return {
      kind: executor.kind,
      async execute(ctx) {
        let observed = 0;
        const wrappedCtx = {
          ...ctx,
          async checkpoint(state: unknown): Promise<void> {
            await ctx.checkpoint(state);
            observed += 1;
            afterCheckpoint?.();
            if (observed >= stallAfterCheckpoints) {
              await gate; // the crash point
            }
          },
        };
        return executor.execute(wrappedCtx as typeof ctx);
      },
    };
  });
}

/** Builds a three-clean-batch feed over a stack (auto selection). */
async function buildFeed(workspace: PlatformWorkspace, seed: string) {
  const source = await createSimulatedExternalFeedSource({
    seed,
    plan: ["clean", "clean", "clean"],
  });
  const feed = createExternalFeed({
    workspace,
    platform: {
      platformId: SIMULATED_PLATFORM.platformId,
      tenantId: SIMULATED_PLATFORM.tenantId,
    },
    source,
    selection: { mode: "auto", query: { domain: "football", task: "match" } },
  });
  return feed;
}

describe("the Phase-5 durability law over the feed session", () => {
  test("disconnect + crash + lease expiry + reconnect: convergence, takeover, exactly once, deep-equal", async () => {
    const stack = await buildWorkspaceStack("feed-recovery-resume");
    const feed = await buildFeed(stack.workspace, "recovery-seed");
    const session1 = feed.open();

    // The client submits batch 0 — then drops while it is mid-flight.
    const submitted = await session1.submitNext();
    const jobId = submitted?.jobId;
    if (jobId === undefined) throw new Error("the first submission returned no job");
    expect(submitted?.convergentResubmission).toBe(false);
    expect(submitted?.itemCount).toBe(3);
    expect(submitted?.organizationId).toBe(stack.secondStrongOrganizationId);

    // Worker 1 crashes after item 1's checkpoint (the release-gate trick).
    const seen = checkpointSignal(1);
    const { gate, release } = releaseGate();
    const crashed = createWorkerRuntime({
      store: stack.jobs,
      workerId: "w-crashed",
      leaseTtlMs: 500,
      executors: wrapWithStall(stack.workspace.executors, "external.feed-processing", 1, gate, () =>
        seen.notify(),
      ),
    });
    const abandoned = crashed.runAttempt(jobId);
    await seen.promise; // item 1 durable — the client disconnects here

    // The lease expires on the accelerated clock (the crash gap).
    stack.clock.advance(1_000);

    // RECONNECT: a new handle — a new connection over the same canonical
    // stores. The at-least-once re-affirmation re-submits the batch.
    const session2 = feed.open();
    const resubmitted = await session2.submitNext();
    // CONVERGENCE (REL-029's keys): the same key + the identical request
    // resolved to the SAME envelope — the SAME durable job.
    expect(resubmitted?.convergentResubmission).toBe(true);
    expect(resubmitted?.jobId).toBe(jobId);
    expect(resubmitted?.itemCount).toBe(3);

    // The resumed session drives everything to completion (the takeover
    // resumes from the per-item checkpoints; batches 1-2 flow behind it).
    const record = await session2.run();
    expect(record.outcome).toBe("completed");
    expect(record.truncation).toBeNull();
    expect(record.totals).toMatchObject({
      batchesCompleted: 3,
      itemsProcessed: 9,
    });

    // EXACTLY ONCE: one feed job per batch (the re-submit enqueued nothing),
    // one completion event per job, one attempt per job (the takeover
    // CONTINUED the interrupted attempt), and 3 per-item checkpoints.
    const feedJobs = await stack.jobs.list({ kind: "external.feed-processing" });
    expect(feedJobs).toHaveLength(3);
    const events = await stack.jobs.readJournal();
    expect(
      events.filter((event) => event.type === "patched" && event.op === "complete").length,
    ).toBe(3);
    const firstJob = await stack.jobs.get(jobId);
    expect(firstJob.state).toBe("completed");
    expect(firstJob.attempts).toBe(1);
    expect(firstJob.checkpoints).toHaveLength(3);
    expect(firstJob.outputArtifactRefs).toHaveLength(1);

    // The crashed worker's late writes never land a terminal state.
    release();
    await abandoned.then(
      (final) => {
        expect(final.state === "completed").toBe(false);
      },
      () => {
        // a lease-law refusal is honest too
      },
    );

    // The reconnected client retrieves the authoritative output + evidence.
    const output = await stack.workspace.services.getOutput(session2.connection, { jobId });
    expect(output.result.artifact.kind).toBe("feed-output");
    expect(output.result.artifact.items).toHaveLength(3);
    const evidence = await stack.workspace.services.getEvidence(session2.connection, { jobId });
    expect(evidence.result.evidence.qualityGate.passed).toBe(true);
    expect(evidence.result.evidence.sourceLineage).toHaveLength(3);

    // THE STRONG CLAIM: the recovered session's record is DEEP-EQUAL to an
    // uninterrupted run's record — the authoritative outcome (jobs, digests,
    // lineage, totals) is history-independent; only the checkpoints' hidden
    // wall-clock instants differ, and the record carries none.
    const stackB = await buildWorkspaceStack("feed-recovery-uninterrupted");
    const feedB = await buildFeed(stackB.workspace, "recovery-seed");
    const recordB = await feedB.open().run();
    expect(record).toEqual(recordB);
  });

  test("a cancellation honored mid-flight leaves NO partial authoritative output (the typed-refusal record only)", async () => {
    const stack = await buildWorkspaceStack("feed-recovery-cancel");
    const feed = await buildFeed(stack.workspace, "cancel-seed");
    const session = feed.open();

    // The client submits batch 0 (a 3-item clean batch).
    const submitted = await session.submitNext();
    const jobId = submitted?.jobId;
    if (jobId === undefined) throw new Error("the submission returned no job");

    // The worker drives to item 1's checkpoint, then stalls (the cancel
    // window: the request lands between two checkpoints, deterministically).
    const seen = checkpointSignal(1);
    const { gate, release } = releaseGate();
    const worker = createWorkerRuntime({
      store: stack.jobs,
      workerId: "w-cancel",
      leaseTtlMs: 60_000,
      executors: wrapWithStall(stack.workspace.executors, "external.feed-processing", 1, gate, () =>
        seen.notify(),
      ),
    });
    const running = worker.runAttempt(jobId);
    await seen.promise; // item 1 durable — the cancel window is open

    // CANCEL through the session (the platform service path).
    await session.cancel();
    expect(session.state).toBe("cancelled");

    // Release: the executor proceeds to item 2's checkpoint — the request is
    // honored THERE (before any publication), and the job ends cancelled.
    release();
    const final = await running;
    expect(final.state).toBe("cancelled");
    expect(final.checkpoints).toHaveLength(2); // items 1-2 checkpointed, then honored

    // FAIL-CLOSED: no authoritative output, no evidence, no artifact refs.
    await expect(
      stack.workspace.services.getOutput(session.connection, { jobId }),
    ).rejects.toMatchObject({ code: "platform.job-state", failureClass: "job-state" });
    await expect(
      stack.workspace.services.getEvidence(session.connection, { jobId }),
    ).rejects.toMatchObject({ code: "platform.job-state" });
    const jobRecord = await stack.jobs.get(jobId);
    expect(jobRecord.outputArtifactRefs).toEqual([]);

    // THE TYPED-REFUSAL RECORD ONLY: the session record shows the cancelled
    // batch (per-item checkpointed truth, the typed output refusal), the
    // remaining batches NOT submitted, and nothing partial published.
    const record = await session.record();
    expect(record.outcome).toBe("cancelled");
    expect(record.cancellation).toEqual({ inFlightJobId: jobId });
    expect(record.truncation).toBeNull();
    expect(record.batches).toHaveLength(3);
    expect(record.batches[0]).toMatchObject({
      outcome: "cancelled",
      jobId,
      refusal: { code: "platform.job-state", stage: "output", failureClass: "job-state" },
      jobFailure: null,
    });
    // Items 1-2 reached a durable checkpoint; item 3 never did — none has an
    // authoritative outcome, and the record says exactly that.
    expect(record.batches[0]?.items.map((item) => [item.outcome, item.checkpointed])).toEqual([
      ["unpublished", true],
      ["unpublished", true],
      ["unpublished", false],
    ]);
    // The remaining batches were never submitted (nothing partial).
    expect(record.batches[1]?.outcome).toBe("not-submitted");
    expect(record.batches[2]?.outcome).toBe("not-submitted");
    expect(record.totals).toEqual({
      batches: 3,
      batchesSubmitted: 1,
      batchesAccepted: 1,
      batchesCompleted: 0,
      batchesFailed: 0,
      batchesCancelled: 1,
      batchesRefused: 0,
      batchesNotSubmitted: 2,
      itemsSubmitted: 3,
      itemsAccepted: 3,
      itemsRefused: 0,
      itemsProcessed: 0,
      itemsSkipped: 0,
      itemsUnpublished: 3,
      itemsNotSubmitted: 6,
      costUsdAccrued: 0,
    });

    // A later run() on the cancelled session is an idempotent no-op: the
    // record is the record (nothing new is submitted or driven).
    const again = await session.run();
    expect(again).toEqual(record);
  });

  test("the same idempotency key with a DIFFERENT request refuses typed (never silently re-run)", async () => {
    const stack = await buildWorkspaceStack("feed-recovery-conflict");
    const feed = await buildFeed(stack.workspace, "conflict-seed");
    const session = feed.open();
    const submitted = await session.submitNext();
    const jobId = submitted?.jobId;
    if (jobId === undefined) throw new Error("the submission returned no job");

    // The deterministic key of batch 0's submission, replayed with a
    // DIFFERENT request (another item, another canonical reference).
    const bytes = new Uint8Array([1, 2, 3, 4]);
    await expect(
      stack.workspace.services.submitFeed(session.connection, {
        items: [
          {
            metadata: {
              provider: "platform-feed",
              providerContentId: "conflicting-item",
              canonicalUrl: "https://platform.example/feeds/conflicting-item",
              ownerRef: "platform:video-platform",
              observedAt: 1_700_000_000_000,
              availability: "publicly-listed",
              restrictions: [],
              title: "A different request under the same key",
              description: "the typed conflict probe",
            },
            bytes,
            declaredBasis: {
              basisType: "authorized-feed",
              grantRef: "agreement:conflict-seed-feed",
              scope: "acquisition for normalization and transformation",
              declaredBy: "platform:video-platform",
            },
          },
        ],
        organization: { organizationId: stack.strongOrganizationId },
        idempotencyKey: feedSubmissionKey("feed-1", 0),
      }),
    ).rejects.toMatchObject({ code: "platform.conflict", failureClass: "conflict" });

    // The original submission is untouched (exactly one job, still queued).
    const feedJobs = await stack.jobs.list({ kind: "external.feed-processing" });
    expect(feedJobs).toHaveLength(1);
    expect(feedJobs[0]?.jobId).toBe(jobId);
  });
});
