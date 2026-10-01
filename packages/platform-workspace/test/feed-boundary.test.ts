/**
 * REL-031 — THE BOUNDS + THE TYPED REFUSALS of the external feed session.
 *
 * Every fixture family of the simulated stream meets the boundary that owns
 * its refusal, and the feed RECORD carries the refusal typed (the owning
 * boundary's own code — never re-wrapped, never swallowed):
 *
 * - malformed item (bytes WITHOUT a declared basis) -> the corpus's typed
 *   `corpus.rights-basis-required` at submission — the feed CONTINUES;
 * - malformed batch (duplicate canonical references) / empty batch -> the
 *   platform's typed `platform.validation`;
 * - mixed rights (a reference-only item) under requireTransformation -> the
 *   feed job FAILS FAIL-CLOSED at that item (the rights law, never
 *   bypassed); under requireTransformation false -> the reference is indexed
 *   and recorded as skipped;
 * - an OVERSIZED batch -> the session's own typed `feed.bounds` refusal AND
 *   an honest stop (enforced, never advisory);
 * - the session-wide bounds (max accepted items, max accrued cost, the
 *   per-batch latency ceiling on the durable clock) -> a breach STOPS the
 *   session and records the truncation honestly;
 * - an empty selection catalog -> the workspace's own typed
 *   `workspace.organization-selection` refusal, recorded per batch;
 * - the session contract's own shape violations -> the feed family's typed
 *   `feed.validation` (options, source, bounds).
 */
import { afterAll, describe, expect, test } from "bun:test";
import { createWorkerRuntime } from "@sporta/durable-jobs";
import type { JobExecutor } from "@sporta/durable-jobs";
import { buildWorkspaceStack, cleanupScratch, SIMULATED_PLATFORM } from "./fixtures";
import {
  DEFAULT_FEED_BOUNDS,
  FeedApiError,
  FeedBoundsError,
  FeedConflictError,
  FeedValidationError,
  createExternalFeed,
  createSimulatedExternalFeedSource,
  isFeedError,
} from "../src";
import type { ExternalFeedOptions, FeedBatchPlanEntry, FeedSessionRecord } from "../src";

afterAll(() => {
  cleanupScratch();
});

// ---------------------------------------------------------------------------
// The wiring helpers
// ---------------------------------------------------------------------------

/** The simulated platform identity, as the feed options carry it. */
const PLATFORM = {
  platformId: SIMULATED_PLATFORM.platformId,
  tenantId: SIMULATED_PLATFORM.tenantId,
} as const;

/** Builds a feed over a stack with a plan + optional overrides. */
async function buildFeed(
  workspace: Parameters<typeof createExternalFeed>[0]["workspace"],
  seed: string,
  plan: readonly FeedBatchPlanEntry[],
  overrides: Partial<ExternalFeedOptions> = {},
) {
  const source = await createSimulatedExternalFeedSource({ seed, plan });
  return createExternalFeed({
    workspace,
    platform: PLATFORM,
    source,
    selection: { mode: "auto", query: { domain: "football", task: "match" } },
    ...overrides,
  });
}

/** A test gate: resolves when the Nth checkpoint has landed. */
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

/** A never-resolving-until-released gate (the stalled worker's blocker). */
function releaseGate(): { gate: Promise<void>; release: () => void } {
  let release!: () => void;
  const gate = new Promise<void>((done) => {
    release = done;
  });
  return { gate, release };
}

/** Wraps the executors so the kind stalls at the Nth checkpoint. */
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
              await gate;
            }
          },
        };
        return executor.execute(wrappedCtx as typeof ctx);
      },
    };
  });
}

describe("the malformed item family (the corpus is the authority)", () => {
  test("bytes without a declared basis -> the typed rights refusal, recorded; the feed continues", async () => {
    const stack = await buildWorkspaceStack("feed-boundary-malformed");
    const feed = await buildFeed(stack.workspace, "malformed-seed", [
      "clean",
      "malformed-item",
      "clean",
    ]);
    const record = await feed.open().run();

    // The feed CONTINUED past the refused batch (a continuous feed records
    // per-batch refusals honestly; only bounds breaches stop it).
    expect(record.outcome).toBe("completed");
    expect(record.truncation).toBeNull();
    expect(record.batches[0]?.outcome).toBe("completed");
    expect(record.batches[2]?.outcome).toBe("completed");

    // The malformed batch: the corpus's OWN typed code, recorded verbatim.
    const refused = record.batches[1];
    expect(refused?.outcome).toBe("refused");
    expect(refused?.jobId).toBeNull();
    expect(refused?.refusal).toMatchObject({
      code: "corpus.rights-basis-required",
      failureClass: "rights",
      stage: "submission",
    });
    expect(refused?.refusal?.message).toContain("not proof of transformation rights");
    expect(refused?.items).toHaveLength(3);
    expect(refused?.items.every((item) => item.outcome === "refused")).toBe(true);

    // The totals: all three batches attempted; six items processed.
    expect(record.totals).toMatchObject({
      batchesSubmitted: 3,
      batchesAccepted: 2,
      batchesRefused: 1,
      itemsSubmitted: 9,
      itemsAccepted: 6,
      itemsRefused: 3,
      itemsProcessed: 6,
    });
  });
});

describe("the mixed-rights family (the rights law, never bypassed)", () => {
  test("a reference-only item under requireTransformation FAILS the feed job fail-closed", async () => {
    const stack = await buildWorkspaceStack("feed-boundary-mixed");
    const feed = await buildFeed(stack.workspace, "mixed-seed", ["mixed-rights"]);
    const session = feed.open();
    const record = await session.run();

    // The submission LANDED (two transformable items), the job refused to
    // transform the reference — the failure is the record's truth.
    const batch = record.batches[0];
    expect(batch?.outcome).toBe("failed");
    expect(batch?.transformableItemCount).toBe(2);
    expect(batch?.jobFailure).toContain("transformation requires acquired+normalized bytes");
    expect(batch?.jobFailure).toContain("is in state referenced");
    expect(batch?.refusal).toMatchObject({
      code: "platform.job-state",
      failureClass: "job-state",
      stage: "output",
    });
    // No authoritative output exists (fail-closed), asserted directly too.
    const jobId = batch?.jobId;
    if (jobId === undefined) throw new Error("the failed batch carries no job id");
    await expect(
      stack.workspace.services.getOutput(session.connection, { jobId }),
    ).rejects.toMatchObject({ code: "platform.job-state" });

    // The per-item truth: the two byte items reached durable checkpoints
    // (work done, NOTHING published); the reference item never did.
    expect(batch?.items.map((item) => [item.outcome, item.checkpointed, item.itemKind])).toEqual([
      ["unpublished", true, "authorized-media"],
      ["unpublished", true, "authorized-media"],
      ["unpublished", false, "reference-only"],
    ]);
    expect(batch?.items[2]?.sourceId).toMatch(/^source-/); // indexed by the corpus
    expect(batch?.items[2]?.declaredDigest).toBeNull(); // a reference carries no bytes

    expect(record.totals).toMatchObject({
      itemsAccepted: 3,
      itemsProcessed: 0,
      itemsUnpublished: 3,
      itemsSkipped: 0,
    });
  });

  test("requireTransformation false: the reference is indexed and recorded as skipped", async () => {
    const stack = await buildWorkspaceStack("feed-boundary-lenient");
    const feed = await buildFeed(stack.workspace, "lenient-seed", ["mixed-rights"], {
      requireTransformation: false,
    });
    const record = await feed.open().run();
    const batch = record.batches[0];
    expect(batch?.outcome).toBe("completed");
    expect(record.provenance.requireTransformation).toBe(false);
    // The artifact covers the two byte items only.
    expect(batch?.artifact?.itemCount).toBe(2);
    expect(batch?.items.map((item) => item.outcome)).toEqual([
      "transformed",
      "transformed",
      "skipped-reference",
    ]);
    expect(batch?.qualityGate?.passed).toBe(true);
    expect(record.totals).toMatchObject({
      itemsProcessed: 2,
      itemsSkipped: 1,
      itemsUnpublished: 0,
    });
  });
});

describe("the malformed batch families (the platform boundary is the authority)", () => {
  test("duplicate canonical references refuse typed at submission", async () => {
    const stack = await buildWorkspaceStack("feed-boundary-duplicate");
    const feed = await buildFeed(stack.workspace, "duplicate-seed", ["malformed-batch"]);
    const record = await feed.open().run();
    const batch = record.batches[0];
    expect(batch?.outcome).toBe("refused");
    expect(batch?.refusal).toMatchObject({
      code: "platform.validation",
      failureClass: "validation",
      stage: "submission",
    });
    expect(batch?.refusal?.message).toContain("duplicate canonical references");
    expect(record.totals).toMatchObject({ batchesRefused: 1, itemsRefused: 2 });
  });

  test("an empty batch refuses typed (items min 1)", async () => {
    const stack = await buildWorkspaceStack("feed-boundary-empty");
    const feed = await buildFeed(stack.workspace, "empty-seed", ["empty-batch"]);
    const record = await feed.open().run();
    const batch = record.batches[0];
    expect(batch?.outcome).toBe("refused");
    expect(batch?.itemCount).toBe(0);
    expect(batch?.items).toEqual([]);
    expect(batch?.refusal).toMatchObject({ code: "platform.validation", stage: "submission" });
    expect(record.totals).toMatchObject({ batchesRefused: 1, itemsRefused: 0 });
  });
});

describe("the bounds (enforced, never advisory — a breach stops and records)", () => {
  test("an oversized batch refuses typed AND stops the session through run()", async () => {
    const stack = await buildWorkspaceStack("feed-boundary-oversized-run");
    const feed = await buildFeed(stack.workspace, "oversized-run-seed", [
      "clean",
      "oversized",
      "clean",
    ]);
    const record = await feed.open().run();

    expect(record.outcome).toBe("truncated");
    expect(record.batches[0]?.outcome).toBe("completed");
    const refused = record.batches[1];
    expect(refused?.outcome).toBe("refused");
    expect(refused?.refusal).toMatchObject({ code: "feed.bounds", stage: "bounds" });
    expect(refused?.items).toHaveLength(12);
    // The truncation record: honest, with the breached ceiling named.
    expect(record.truncation).toMatchObject({
      kind: "max-items-per-batch",
      atBatchIndex: 1,
      limit: DEFAULT_FEED_BOUNDS.maxItemsPerBatch,
      observed: 12,
      unit: "items-per-batch",
      batchesNotSubmitted: 1,
      itemsNotSubmitted: 3,
    });
    expect(record.truncation?.detail).toContain("oversized batch");
    expect(record.batches[2]?.outcome).toBe("not-submitted");
    expect(record.totals).toMatchObject({
      batchesCompleted: 1,
      batchesRefused: 1,
      batchesNotSubmitted: 1,
      itemsProcessed: 3,
      itemsNotSubmitted: 3,
    });
  });

  test("the submission wave surface re-throws the typed bounds refusal after recording it", async () => {
    const stack = await buildWorkspaceStack("feed-boundary-oversized-wave");
    const feed = await buildFeed(stack.workspace, "oversized-wave-seed", ["oversized", "clean"]);
    const session = feed.open();
    // The FIRST batch is oversized: the wave surface records the refusal AND
    // re-throws it typed (caller-visible — the boundary that owns it throws it).
    let caught: unknown;
    try {
      await session.submitNext();
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(FeedBoundsError);
    expect(isFeedError(caught)).toBe(true);
    expect((caught as FeedBoundsError).code).toBe("feed.bounds");
    expect((caught as FeedBoundsError).failureClass).toBe("bounds");
    expect((caught as FeedBoundsError).details).toMatchObject({ itemCount: 12, limit: 8 });
    // The session is honestly truncated, and the record carries both legs.
    expect(session.state).toBe("truncated");
    const record = await session.record();
    expect(record.truncation).toMatchObject({
      kind: "max-items-per-batch",
      atBatchIndex: 0,
      observed: 12,
      batchesNotSubmitted: 1,
      itemsNotSubmitted: 3,
    });
    expect(record.batches[0]?.refusal?.code).toBe("feed.bounds");
    expect(record.batches[1]?.outcome).toBe("not-submitted");
    // No further submission happens on a truncated session.
    expect(await session.submitNext()).toBeNull();
  });

  test("the session-wide accepted-items ceiling stops the feed honestly", async () => {
    const stack = await buildWorkspaceStack("feed-boundary-max-items");
    const feed = await buildFeed(
      stack.workspace,
      "max-items-seed",
      ["clean", "clean", "clean", "clean"],
      { bounds: { maxItemsPerBatch: 3, maxSessionItems: 7 } },
    );
    const record = await feed.open().run();
    expect(record.outcome).toBe("truncated");
    // Batches 0-1 accepted (6 items); batch 2 would take the session to 9.
    expect(record.batches[0]?.outcome).toBe("completed");
    expect(record.batches[1]?.outcome).toBe("completed");
    expect(record.truncation).toMatchObject({
      kind: "max-items",
      atBatchIndex: 2,
      limit: 7,
      observed: 6,
      unit: "items",
      batchesNotSubmitted: 2,
      itemsNotSubmitted: 6,
    });
    expect(record.provenance.bounds).toEqual({
      ...DEFAULT_FEED_BOUNDS,
      maxItemsPerBatch: 3,
      maxSessionItems: 7,
    });
    expect(record.totals).toMatchObject({
      itemsAccepted: 6,
      itemsProcessed: 6,
      itemsNotSubmitted: 6,
    });
  });

  test("the session cost ceiling stops the feed before a breaching run starts", async () => {
    const stack = await buildWorkspaceStack("feed-boundary-max-cost");
    const feed = await buildFeed(stack.workspace, "max-cost-seed", ["clean", "clean", "clean"], {
      bounds: { maxCostUsd: 2.0 },
    });
    const record = await feed.open().run();
    expect(record.outcome).toBe("truncated");
    // org-beta-strong declares $1.1 per run: batch 0 accrues it; batch 1's
    // prospective 2.2 breaches the 2.0 ceiling — never started.
    expect(record.batches[0]?.outcome).toBe("completed");
    expect(record.batches[1]?.outcome).toBe("not-submitted");
    expect(record.truncation).toMatchObject({
      kind: "max-cost",
      atBatchIndex: 1,
      limit: 2.0,
      observed: 1.1,
      unit: "usd",
      batchesNotSubmitted: 2,
      itemsNotSubmitted: 6,
    });
    expect(record.totals.costUsdAccrued).toBe(1.1);
  });

  test("the per-batch latency ceiling on the durable clock stops the feed after a slow batch", async () => {
    const stack = await buildWorkspaceStack("feed-boundary-latency");
    const feed = await buildFeed(stack.workspace, "latency-seed", ["clean", "clean"], {
      bounds: { maxBatchLatencyMs: 500 },
    });
    const session = feed.open();
    const submitted = await session.submitNext();
    const jobId = submitted?.jobId;
    if (jobId === undefined) throw new Error("the submission returned no job");

    // The worker stalls mid-batch; the accelerated clock advances 2s while
    // the batch is in flight; the release completes it — 2000ms late.
    const seen = checkpointSignal(1);
    const { gate, release } = releaseGate();
    const worker = createWorkerRuntime({
      store: stack.jobs,
      workerId: "w-slow",
      leaseTtlMs: 60_000,
      executors: wrapWithStall(stack.workspace.executors, "external.feed-processing", 1, gate, () =>
        seen.notify(),
      ),
    });
    const running = worker.runAttempt(jobId);
    await seen.promise;
    stack.clock.advance(2_000);
    release();
    const final = await running;
    expect(final.state).toBe("completed");

    // The resumed session observes the completed batch and the breached
    // ceiling: it records the batch honestly and STOPS (never advisory).
    const record: FeedSessionRecord = await session.run();
    expect(record.outcome).toBe("truncated");
    expect(record.batches[0]?.outcome).toBe("completed"); // honest: it did complete
    expect(record.batches[1]?.outcome).toBe("not-submitted");
    expect(record.truncation).toMatchObject({
      kind: "latency-ceiling",
      atBatchIndex: 0,
      limit: 500,
      observed: 2_000,
      unit: "ms",
      batchesNotSubmitted: 1,
      itemsNotSubmitted: 3,
    });
    expect(record.totals).toMatchObject({ batchesCompleted: 1, itemsProcessed: 3 });
  });
});

describe("the selection boundary (the choice model's honest empty answer)", () => {
  test("no eligible organization -> the workspace's typed refusal, recorded per batch, feed continues", async () => {
    const stack = await buildWorkspaceStack("feed-boundary-no-org");
    const source = await createSimulatedExternalFeedSource({
      seed: "no-org-seed",
      plan: ["clean", "clean"],
    });
    const feed = createExternalFeed({
      workspace: stack.workspace,
      platform: PLATFORM,
      source,
      selection: { mode: "auto", query: { domain: "basketball" } }, // nothing eligible
    });
    const record = await feed.open().run();
    expect(record.outcome).toBe("completed"); // the stream ran to its end
    for (const batch of record.batches) {
      expect(batch.outcome).toBe("refused");
      expect(batch.jobId).toBeNull();
      expect(batch.refusal).toMatchObject({
        code: "workspace.organization-selection",
        failureClass: "policy",
        stage: "selection",
      });
    }
    expect(record.totals).toMatchObject({
      batchesSubmitted: 0,
      itemsSubmitted: 0,
      itemsRefused: 6,
      itemsProcessed: 0,
    });
  });
});

describe("the feed session contract's own typed validation (fail-closed)", () => {
  test("a malformed selection spec refuses typed", async () => {
    const stack = await buildWorkspaceStack("feed-boundary-bad-selection");
    const source = await createSimulatedExternalFeedSource({
      seed: "bad-selection",
      plan: ["clean"],
    });
    let caught: unknown;
    try {
      createExternalFeed({
        workspace: stack.workspace,
        platform: PLATFORM,
        source,
        selection: { mode: "auto" } as never, // the query is missing
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(FeedValidationError);
    expect(isFeedError(caught)).toBe(true);
    expect((caught as FeedValidationError).code).toBe("feed.validation");
    expect((caught as FeedValidationError).details.issues).toHaveLength(1);
  });

  test("a self-inconsistent bounds override refuses typed (the session cap dominates)", async () => {
    const stack = await buildWorkspaceStack("feed-boundary-bad-bounds");
    const source = await createSimulatedExternalFeedSource({ seed: "bad-bounds", plan: ["clean"] });
    let caught: unknown;
    try {
      createExternalFeed({
        workspace: stack.workspace,
        platform: PLATFORM,
        source,
        selection: { mode: "auto", query: { domain: "football" } },
        bounds: { maxSessionItems: 2 }, // below the default per-batch ceiling 8
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(FeedValidationError);
    expect((caught as FeedValidationError).code).toBe("feed.validation");
  });

  test("a malformed feed platform identity refuses typed", async () => {
    const stack = await buildWorkspaceStack("feed-boundary-bad-platform");
    const source = await createSimulatedExternalFeedSource({
      seed: "bad-platform",
      plan: ["clean"],
    });
    let caught: unknown;
    try {
      createExternalFeed({
        workspace: stack.workspace,
        platform: { platformId: "", tenantId: "tenant" },
        source,
        selection: { mode: "auto", query: { domain: "football" } },
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(FeedValidationError);
  });

  test("the source contract violations refuse typed (seed, plan, batchAt range)", async () => {
    await expect(
      createSimulatedExternalFeedSource({ seed: "", plan: ["clean"] }),
    ).rejects.toMatchObject({ code: "feed.validation" });
    await expect(
      createSimulatedExternalFeedSource({ seed: "s", plan: [] as readonly FeedBatchPlanEntry[] }),
    ).rejects.toMatchObject({ code: "feed.validation" });
    const source = await createSimulatedExternalFeedSource({ seed: "range-seed", plan: ["clean"] });
    expect(() => source.batchAt(1)).toThrow(FeedValidationError);
    expect(() => source.batchAt(-1)).toThrow(FeedValidationError);
  });

  test("the feed error family's typed contract (codes + guards, stable)", () => {
    const validation = new FeedValidationError("shape", [{ path: "x" }]);
    const bounds = new FeedBoundsError("ceiling", { limit: 8 });
    const conflict = new FeedConflictError("convergence", { batchIndex: 0 });
    for (const error of [validation, bounds, conflict]) {
      expect(isFeedError(error)).toBe(true);
      expect(error).toBeInstanceOf(FeedApiError);
      expect(error).toBeInstanceOf(Error);
      expect(typeof error.message).toBe("string");
    }
    expect(validation.code).toBe("feed.validation");
    expect(validation.failureClass).toBe("validation");
    expect(bounds.code).toBe("feed.bounds");
    expect(bounds.failureClass).toBe("bounds");
    expect(conflict.code).toBe("feed.conflict");
    expect(conflict.failureClass).toBe("conflict");
    // The guard refuses foreign errors (the authorities' families).
    expect(isFeedError(new Error("plain"))).toBe(false);
  });
});
