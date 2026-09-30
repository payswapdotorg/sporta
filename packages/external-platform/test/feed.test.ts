/**
 * REL-016 feed-processing tests — the contract's feed pipeline end to end
 * on fixtures: periodic submission -> source validation (the corpus rights
 * gate) -> organization selection (the eligible catalog) -> processing via
 * durable jobs -> quality gate -> transformed output artifact + evidence
 * bundle. Plus the three laws:
 * - CANCEL mid-processing -> NO partial authoritative output (fail-closed);
 * - RESUME after a simulated disconnect (worker crash + takeover) ->
 *   completes exactly once, no lost lineage;
 * - reference-submitted items refuse typed under requireTransformation.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { JobExecutor } from "@sporta/durable-jobs";
import { createWorkerRuntime } from "@sporta/durable-jobs";
import { buildStack, feedItemMetadata, fixtureBytes, platformFeedBasis } from "./fixtures";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let dir = "";
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "sporta-external-feed-"));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Local test gates (the durable-jobs helpers pattern, carried locally)
// ---------------------------------------------------------------------------

/** A test gate: resolves when `count` checkpoints have been persisted. */
function checkpointSignal(count: number): { promise: Promise<void>; notify: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  let seen = 0;
  return {
    promise,
    notify: () => {
      seen += 1;
      if (seen >= count) resolve();
    },
  };
}

/** A never-resolving-until-released gate (the abandoned worker's blocker). */
function releaseGate(): { gate: Promise<void>; release: () => void } {
  let release!: () => void;
  const gate = new Promise<void>((done) => {
    release = done;
  });
  return { gate, release };
}

/**
 * Wraps a platform executor so that after the Nth durable checkpoint it
 * awaits `gate` (the simulated crash) — or, with no gate, it just notifies
 * `afterCheckpoint` and continues (the cancel window).
 */
function wrapWithStall(
  executors: readonly JobExecutor[],
  kind: string,
  stallAfterCheckpoints: number,
  gate?: Promise<void>,
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
            if (observed >= stallAfterCheckpoints && gate !== undefined) {
              await gate; // the crash point: this worker never writes again
            }
          },
        };
        return executor.execute(wrappedCtx as typeof ctx);
      },
    };
  });
}

/** A three-item byte feed request. */
function feedRequest(overrides: Record<string, unknown> = {}) {
  return {
    items: ["feed-a", "feed-b", "feed-c"].map((id) => ({
      metadata: feedItemMetadata(id),
      bytes: fixtureBytes(id),
      declaredBasis: platformFeedBasis(),
    })),
    organization: { organizationId: "org-alpha" },
    ...overrides,
  };
}

describe("the full feed pipeline on fixtures", () => {
  test("submit -> validate -> select -> process -> gate -> artifact + evidence", async () => {
    const stack = await buildStack(dir, "feed-full");
    const connection = stack.platform.connect({
      platformId: "platform:video-platform",
      tenantId: "tenant-1",
    });
    const submitted = await stack.platform.services.submitFeed(connection, feedRequest());
    expect(submitted.result.kind).toBe("external.feed-processing");
    expect(submitted.result.itemCount).toBe(3);
    expect(submitted.result.transformableItemCount).toBe(3);
    expect(submitted.result.organizationId).toBe("org-alpha");
    expect(submitted.result.orderedBy).toBeNull(); // explicit selection: no ordering claim

    const worker = createWorkerRuntime({
      store: stack.jobs,
      workerId: "w1",
      leaseTtlMs: 5_000,
      executors: stack.platform.executors,
    });
    const done = await worker.runAttempt(submitted.result.jobId);
    expect(done.state).toBe("completed");
    // Per-item checkpoints: the resume boundaries.
    expect(done.checkpoints.length).toBe(3);
    expect(done.outputArtifactRefs.length).toBe(1);

    const output = await stack.platform.services.getOutput(connection, {
      jobId: submitted.result.jobId,
    });
    expect(output.result.artifact.kind).toBe("feed-output");
    expect(output.result.artifact.items.length).toBe(3);
    expect(output.result.artifact.items.map((item) => item.sourceId)).toEqual([
      "source-1",
      "source-2",
      "source-3",
    ]);
    // The output covers every item's transformed bytes (headers grew it).
    const expectedLength = ["feed-a", "feed-b", "feed-c"].reduce(
      (total, id) => total + fixtureBytes(id).byteLength,
      0,
    );
    expect(output.result.bytes.byteLength).toBeGreaterThan(expectedLength);

    const evidence = await stack.platform.services.getEvidence(connection, {
      jobId: submitted.result.jobId,
    });
    expect(evidence.result.evidence.qualityGate.passed).toBe(true);
    expect(evidence.result.evidence.sourceLineage.map((line) => line.outcome)).toEqual([
      "transformed",
      "transformed",
      "transformed",
    ]);
    // The lineage carries the REAL corpus checksums (rights + provenance).
    for (const line of evidence.result.evidence.sourceLineage) {
      expect(line.acquiredChecksum).toMatch(/^[0-9a-f]{64}$/);
      expect(line.normalizedChecksum).toMatch(/^[0-9a-f]{64}$/);
      expect(line.canonicalUrl).toContain("https://platform.example/feeds/");
    }
    expect(evidence.result.evidence.organizationId).toBe("org-alpha");
  });

  test("selection by query rides the DECLARED ordering (no hidden ranking)", async () => {
    const stack = await buildStack(dir, "feed-select");
    const connection = stack.platform.connect({
      platformId: "platform:video-platform",
      tenantId: "tenant-1",
    });
    const submitted = await stack.platform.services.submitFeed(connection, {
      items: ["select-a", "select-b"].map((id) => ({
        metadata: feedItemMetadata(id),
        bytes: fixtureBytes(id),
        declaredBasis: platformFeedBasis(),
      })),
      organization: { query: { domain: "football" }, ordering: { kind: "cost-ascending" } },
    });
    expect(submitted.result.organizationId).toBe("org-alpha");
    expect(submitted.result.orderedBy).toContain("cost ascending");
    // An empty catalog selection refuses typed.
    await expect(
      stack.platform.services.submitFeed(connection, {
        items: [
          {
            metadata: feedItemMetadata("select-none"),
            bytes: fixtureBytes("select-none"),
            declaredBasis: platformFeedBasis(),
          },
        ],
        organization: { query: { domain: "basketball" } },
      }),
    ).rejects.toMatchObject({
      code: "platform.organization-not-selectable",
      failureClass: "policy",
    });
  });

  test("THE RIGHTS LAW: a byte item without a declared basis refuses typed at submission", async () => {
    const stack = await buildStack(dir, "feed-rights");
    const connection = stack.platform.connect({
      platformId: "platform:video-platform",
      tenantId: "tenant-1",
    });
    await expect(
      stack.platform.services.submitFeed(connection, {
        items: [
          {
            metadata: feedItemMetadata("no-basis"),
            bytes: fixtureBytes("no-basis"),
          },
        ],
        organization: { organizationId: "org-alpha" },
      }),
    ).rejects.toMatchObject({
      code: "corpus.rights-basis-required",
      failureClass: "rights",
    });
  });

  test("a no-transformation feed item fails the job AT NORMALIZATION (the corpus refuses)", async () => {
    const stack = await buildStack(dir, "feed-no-transform");
    const connection = stack.platform.connect({
      platformId: "platform:video-platform",
      tenantId: "tenant-1",
    });
    const submitted = await stack.platform.services.submitFeed(connection, {
      items: [
        {
          metadata: feedItemMetadata("restricted", { restrictions: ["no-transformation"] }),
          bytes: fixtureBytes("restricted"),
          declaredBasis: platformFeedBasis(),
        },
      ],
      organization: { organizationId: "org-alpha" },
    });
    const worker = createWorkerRuntime({
      store: stack.jobs,
      workerId: "w1",
      leaseTtlMs: 5_000,
      executors: stack.platform.executors,
    });
    const done = await worker.runAttempt(submitted.result.jobId);
    expect(done.state).toBe("failed");
    expect(done.failure?.message).toContain("no-transformation");
    await expect(
      stack.platform.services.getOutput(connection, { jobId: submitted.result.jobId }),
    ).rejects.toMatchObject({ code: "platform.job-state" });
  });
});

describe("reference items and requireTransformation", () => {
  test("a reference item under requireTransformation FAILS the feed job fail-closed", async () => {
    const stack = await buildStack(dir, "feed-ref-strict");
    const connection = stack.platform.connect({
      platformId: "platform:video-platform",
      tenantId: "tenant-1",
    });
    const submitted = await stack.platform.services.submitFeed(connection, {
      items: [
        {
          metadata: feedItemMetadata("byte-item"),
          bytes: fixtureBytes("byte-item"),
          declaredBasis: platformFeedBasis(),
        },
        { metadata: feedItemMetadata("ref-item") }, // no bytes: a reference
      ],
      organization: { organizationId: "org-alpha" },
    });
    expect(submitted.result.transformableItemCount).toBe(1);
    const worker = createWorkerRuntime({
      store: stack.jobs,
      workerId: "w1",
      leaseTtlMs: 5_000,
      executors: stack.platform.executors,
    });
    const done = await worker.runAttempt(submitted.result.jobId);
    expect(done.state).toBe("failed");
    expect(done.failure?.message).toContain("transformation requires acquired+normalized bytes");
    // NO authoritative output.
    await expect(
      stack.platform.services.getOutput(connection, { jobId: submitted.result.jobId }),
    ).rejects.toMatchObject({ code: "platform.job-state" });
  });

  test("requireTransformation false: reference items are INDEXED and recorded as skipped", async () => {
    const stack = await buildStack(dir, "feed-ref-lenient");
    const connection = stack.platform.connect({
      platformId: "platform:video-platform",
      tenantId: "tenant-1",
    });
    const submitted = await stack.platform.services.submitFeed(connection, {
      items: [
        {
          metadata: feedItemMetadata("byte-item-2"),
          bytes: fixtureBytes("byte-item-2"),
          declaredBasis: platformFeedBasis(),
        },
        { metadata: feedItemMetadata("ref-item-2") },
      ],
      organization: { organizationId: "org-alpha" },
      requireTransformation: false,
    });
    const worker = createWorkerRuntime({
      store: stack.jobs,
      workerId: "w1",
      leaseTtlMs: 5_000,
      executors: stack.platform.executors,
    });
    const done = await worker.runAttempt(submitted.result.jobId);
    expect(done.state).toBe("completed");

    const output = await stack.platform.services.getOutput(connection, {
      jobId: submitted.result.jobId,
    });
    expect(output.result.artifact.items.length).toBe(1); // only the byte item
    const evidence = await stack.platform.services.getEvidence(connection, {
      jobId: submitted.result.jobId,
    });
    const outcomes = evidence.result.evidence.sourceLineage.map((line) => line.outcome).sort();
    expect(outcomes).toEqual(["skipped-reference", "transformed"]);
  });

  test("an all-reference feed refuses at submission processing (no output possible)", async () => {
    const stack = await buildStack(dir, "feed-all-ref");
    const connection = stack.platform.connect({
      platformId: "platform:video-platform",
      tenantId: "tenant-1",
    });
    const submitted = await stack.platform.services.submitFeed(connection, {
      items: [{ metadata: feedItemMetadata("only-ref") }],
      organization: { organizationId: "org-alpha" },
      requireTransformation: false,
    });
    const worker = createWorkerRuntime({
      store: stack.jobs,
      workerId: "w1",
      leaseTtlMs: 5_000,
      executors: stack.platform.executors,
    });
    const done = await worker.runAttempt(submitted.result.jobId);
    expect(done.state).toBe("failed");
    expect(done.failure?.message).toContain("no transformable items");
  });

  test("duplicate canonical references refuse typed at submission", async () => {
    const stack = await buildStack(dir, "feed-dup");
    const connection = stack.platform.connect({
      platformId: "platform:video-platform",
      tenantId: "tenant-1",
    });
    await expect(
      stack.platform.services.submitFeed(connection, {
        items: [{ metadata: feedItemMetadata("dup") }, { metadata: feedItemMetadata("dup") }],
        organization: { organizationId: "org-alpha" },
        requireTransformation: false,
      }),
    ).rejects.toMatchObject({ code: "platform.validation" });
  });
});

describe("CANCEL mid-processing: no partial authoritative output", () => {
  test("a cancellation honored at a checkpoint leaves the job cancelled with NO artifact", async () => {
    const stack = await buildStack(dir, "feed-cancel");
    const connection = stack.platform.connect({
      platformId: "platform:video-platform",
      tenantId: "tenant-1",
    });
    const submitted = await stack.platform.services.submitFeed(connection, feedRequest());
    const jobId = submitted.result.jobId;

    // The worker stalls AFTER the first item's checkpoint (item 1 durable,
    // items 2-3 pending) — then the platform cancels mid-processing.
    const seen = checkpointSignal(1);
    const runtime = createWorkerRuntime({
      store: stack.jobs,
      workerId: "w1",
      leaseTtlMs: 60_000,
      executors: wrapWithStall(
        stack.platform.executors,
        "external.feed-processing",
        1,
        undefined,
        () => seen.notify(),
      ),
    });
    const running = runtime.runAttempt(jobId);
    await seen.promise;

    // CANCEL through the platform service (the application path).
    const cancelled = await stack.platform.services.cancelJob(connection, { jobId });
    expect(cancelled.result.cancellationRequested).toBe(true); // honored at the next checkpoint

    const final = await running;
    expect(final.state).toBe("cancelled");
    expect(final.checkpoints.length).toBeGreaterThanOrEqual(1);

    // FAIL-CLOSED: no authoritative output, no evidence.
    await expect(stack.platform.services.getOutput(connection, { jobId })).rejects.toMatchObject({
      code: "platform.job-state",
      failureClass: "job-state",
    });
    await expect(stack.platform.services.getEvidence(connection, { jobId })).rejects.toMatchObject({
      code: "platform.job-state",
    });
    // And the job record itself carries no output refs.
    const record = await stack.jobs.get(jobId);
    expect(record.outputArtifactRefs).toEqual([]);
    expect(record.state).toBe("cancelled");
  });
});

describe("RESUME after a simulated disconnect (worker crash + takeover)", () => {
  test("a crashed feed worker resumes from the per-item checkpoints and completes exactly once", async () => {
    const stack = await buildStack(dir, "feed-resume");
    const connection = stack.platform.connect({
      platformId: "platform:video-platform",
      tenantId: "tenant-1",
    });
    const submitted = await stack.platform.services.submitFeed(connection, feedRequest());
    const jobId = submitted.result.jobId;

    // Worker 1 crashes after item 1's checkpoint (the release-gate trick).
    const seen = checkpointSignal(1);
    const { gate, release } = releaseGate();
    const crashed = createWorkerRuntime({
      store: stack.jobs,
      workerId: "w-crashed",
      leaseTtlMs: 500,
      executors: wrapWithStall(stack.platform.executors, "external.feed-processing", 1, gate, () =>
        seen.notify(),
      ),
    });
    const abandoned = crashed.runAttempt(jobId);
    await seen.promise; // item 1 durable

    // "Disconnect": the platform RECONNECTS (a new connection over the same
    // canonical stores) and sees the mid-flight state.
    const reconnected = stack.platform.connect({
      platformId: "platform:video-platform",
      tenantId: "tenant-1",
    });
    const midFlight = await stack.platform.services.getJob(reconnected, { jobId });
    expect(midFlight.result.job.state).toBe("running");
    expect(midFlight.result.job.checkpointCount).toBe(1);

    // The lease expires; worker 2 takes over and finishes.
    stack.clock.advance(1_000);
    const worker2 = createWorkerRuntime({
      store: stack.jobs,
      workerId: "w2",
      leaseTtlMs: 5_000,
      executors: stack.platform.executors,
    });
    const done = await worker2.runAttempt(jobId);
    expect(done.state).toBe("completed");
    // No duplicate work: 3 items -> exactly 3 checkpoints total (1 + 2).
    expect(done.checkpoints.length).toBe(3);
    expect(done.attempts).toBe(1); // the takeover CONTINUED the attempt
    expect(done.outputArtifactRefs.length).toBe(1);

    release();
    await abandoned.then(
      (record) => {
        expect(record.state === "completed").toBe(false); // never a second completion
      },
      () => {
        expect(true).toBe(true); // a lease-law refusal is honest too
      },
    );

    // Exactly one completion in the journal; the reconnect retrieves the
    // authoritative output + evidence.
    const events = await stack.jobs.readJournal();
    expect(
      events.filter((event) => event.type === "patched" && event.op === "complete").length,
    ).toBe(1);
    const output = await stack.platform.services.getOutput(reconnected, { jobId });
    expect(output.result.artifact.items.length).toBe(3);
    const evidence = await stack.platform.services.getEvidence(reconnected, { jobId });
    expect(evidence.result.evidence.qualityGate.passed).toBe(true);
    // And a THIRD connection (the platform's periodic poller) sees the same.
    const poller = stack.platform.connect({
      platformId: "platform:video-platform",
      tenantId: "tenant-1",
    });
    const status = await stack.platform.services.getJob(poller, { jobId });
    expect(status.result.job.state).toBe("completed");
    expect(status.result.job.completedAt).not.toBeNull();
  });
});
