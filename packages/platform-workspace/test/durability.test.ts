/**
 * REL-024 — the durable job surface is the REAL one (imported, never
 * re-implemented): the workspace's processing rides @sporta/durable-jobs'
 * file-backed journal with real lease/checkpoint discipline, and a worker
 * crash mid-execution resumes from the durable checkpoints and completes
 * EXACTLY ONCE.
 *
 * The feed path (the multi-item processing job, per-item checkpoints) is
 * driven through the WORKSPACE'S OWN exposed services + executors — the
 * same composition the video journey rides — proving the job surface is
 * shared, canonical, and durable:
 *
 * - a crashed worker (the release-gate trick) leaves the job mid-flight
 *   with its first checkpoint DURABLE;
 * - a RECONNECTED session (a new connection over the same canonical
 *   stores) observes the mid-flight state — exactly Gate REL-A7's
 *   reconnect semantics over the workspace;
 * - after the lease expires, a second worker takes over, resumes from the
 *   checkpoints, and completes exactly once (no duplicate completion, no
 *   lost lineage — 3 items -> exactly 3 checkpoints);
 * - the journal re-folds to the completed record (the canonical state IS
 *   the journal) — for the feed job AND the video journey's media job.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { createWorkerRuntime, foldJournal } from "@sporta/durable-jobs";
import type { JobExecutor } from "@sporta/durable-jobs";
import {
  buildWorkspaceStack,
  cleanupScratch,
  fixtureBytes,
  platformUploadBasis,
  SIMULATED_PLATFORM,
  uploadMetadata,
} from "./fixtures";

afterAll(() => {
  cleanupScratch();
});

// ---------------------------------------------------------------------------
// The crash-injection helpers (the external-platform test precedent)
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

/** A two-item byte feed request through the workspace's service surface. */
function feedRequest(organizationId: string) {
  return {
    items: ["feed-a", "feed-b", "feed-c"].map((id) => ({
      metadata: {
        provider: "platform-feed",
        providerContentId: id,
        canonicalUrl: `https://platform.example/feeds/${id}`,
        ownerRef: "platform:video-platform",
        observedAt: 1_700_000_000_000,
        availability: "publicly-listed" as const,
        restrictions: [],
        title: `Feed item ${id}`,
        description: "platform feed item",
      },
      bytes: fixtureBytes(id, 48),
      declaredBasis: {
        basisType: "authorized-feed" as const,
        grantRef: "agreement:platform-feed-77",
        scope: "acquisition for normalization and transformation",
        declaredBy: "platform:video-platform",
      },
    })),
    organization: { organizationId },
  };
}

describe("the durable job surface is the real one (imported machinery)", () => {
  test("a crashed feed worker resumes from the durable checkpoints and completes exactly once", async () => {
    const stack = await buildWorkspaceStack("durability-resume");
    const session = stack.workspace.connect({ ...SIMULATED_PLATFORM });
    const submitted = await stack.workspace.services.submitFeed(
      session.connection,
      feedRequest(stack.strongOrganizationId),
    );
    const jobId = submitted.result.jobId;
    expect(submitted.result.kind).toBe("external.feed-processing");
    expect(submitted.result.itemCount).toBe(3);
    expect(submitted.result.organizationId).toBe(stack.strongOrganizationId);

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
    await seen.promise; // item 1 durable

    // The RECONNECTED session (a new connection over the same canonical
    // stores) observes the mid-flight state.
    const reconnected = stack.workspace.connect({ ...SIMULATED_PLATFORM });
    const midFlight = await reconnected.job({ jobId });
    expect(midFlight.job.state).toBe("running");
    expect(midFlight.job.checkpointCount).toBe(1);

    // The lease expires; worker 2 (the workspace's own executors) takes
    // over and finishes from the checkpoints.
    stack.clock.advance(1_000);
    const worker2 = createWorkerRuntime({
      store: stack.jobs,
      workerId: "w2",
      leaseTtlMs: 5_000,
      executors: stack.workspace.executors,
    });
    const done = await worker2.runAttempt(jobId);
    expect(done.state).toBe("completed");
    // No duplicate work: 3 items -> exactly 3 checkpoints total (1 + 2).
    expect(done.checkpoints.length).toBe(3);
    // The takeover CONTINUED the interrupted attempt (the attempts law).
    expect(done.attempts).toBe(1);
    expect(done.outputArtifactRefs.length).toBe(1);

    release();
    await abandoned.then(
      (record) => {
        // The crashed worker's write is refused or lands nowhere terminal.
        expect(record.state === "completed").toBe(false);
      },
      () => {
        // A lease-law refusal is honest too.
        expect(true).toBe(true);
      },
    );

    // The reconnected session retrieves the authoritative output + evidence.
    const output = await reconnected.output({ jobId });
    expect(output.artifact.kind).toBe("feed-output");
    expect(output.artifact.items).toHaveLength(3);
    const evidence = await reconnected.evidence({ jobId });
    expect(evidence.evidence.sourceLineage).toHaveLength(3);
    expect(evidence.evidence.qualityGate.passed).toBe(true);
  });

  test("the journal re-folds to the completed records (canonical state is the file journal)", async () => {
    const stack = await buildWorkspaceStack("durability-journal");
    const session = stack.workspace.connect({ ...SIMULATED_PLATFORM });

    // One video journey (media job) + one feed job — both on the shared store.
    const upload = await session.uploadVideo({
      bytes: fixtureBytes("journal-media", 56),
      declaredBasis: platformUploadBasis(),
      metadata: uploadMetadata(),
    });
    const processing = await session.processVideo({
      sourceId: upload.sourceId,
      organizationId: stack.strongOrganizationId,
    });
    await session.runJob({ jobId: processing.jobId });
    const feed = await stack.workspace.services.submitFeed(
      session.connection,
      feedRequest(stack.strongOrganizationId),
    );
    await stack.workspace.runtime.runAttempt(feed.result.jobId);

    // The journal is the canonical state: re-folding it reproduces both
    // completed records exactly (the fold is the record).
    const events = await stack.jobs.readJournal();
    const folded = foldJournal(events);
    const mediaRecord = folded.get(processing.jobId);
    const feedRecord = folded.get(feed.result.jobId);
    if (mediaRecord === undefined || feedRecord === undefined) {
      throw new Error("fixture invariant broken: the journal fold lost a completed job");
    }
    expect(mediaRecord.state).toBe("completed");
    expect(mediaRecord.kind).toBe("external.media-processing");
    expect(mediaRecord.attempts).toBe(1);
    expect(mediaRecord.outputArtifactRefs.length).toBe(1);
    expect(feedRecord.state).toBe("completed");
    expect(feedRecord.kind).toBe("external.feed-processing");
    expect(feedRecord.checkpoints.length).toBe(3);
    // The live store's records deep-equal the re-folded journal records.
    const liveMedia = await stack.jobs.get(processing.jobId);
    expect(liveMedia).toEqual(mediaRecord);
    const liveFeed = await stack.jobs.get(feed.result.jobId);
    expect(liveFeed).toEqual(feedRecord);
    // The evidence chain still resolves for the completed media journey.
    const chain = await session.evidenceChain({ jobId: processing.jobId });
    expect(chain.job.state).toBe("completed");
    expect(chain.evidence.qualityGate.passed).toBe(true);
  });
});
