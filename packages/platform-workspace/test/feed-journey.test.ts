/**
 * REL-031 / Gate REL-A10 in FEED MODE — the end-to-end external feed
 * journey, as ONE tested scenario per batch of a continuous stream:
 *
 * ```
 * feed batch (media references + digests + rights bases)
 *   -> upload per item (submitFeed's corpus path — real digests at birth)
 *   -> auto-select organization (the documented ordering, never hidden)
 *   -> process through the imported FEED executor (per-item checkpoints)
 *   -> the organization-declared quality gate (the executor's own)
 *   -> retrieve the transformed artifact + evidence, per batch
 * ```
 *
 * The simulated external platform client connects once, drives the whole
 * stream, and THE FEED RECORD is verified leg by leg against the authority
 * that owns it: the corpus's digests (the declared digest equals the
 * acquired checksum — the upload(digest) law), the choice model's ordering
 * statement, the durable job's lineage (input digest, checkpoint count),
 * the artifact's content address, and the declared-quality verdict. And
 * the determinism law: the same seed + config on two identically-seeded
 * stacks produces DEEP-EQUAL records — no wall clock anywhere.
 */
import { afterAll, describe, expect, test } from "bun:test";
import {
  buildWorkspaceStack,
  cleanupScratch,
  sha256HexBytes,
  SIMULATED_PLATFORM,
} from "./fixtures";
import type { PlatformWorkspace } from "../src";
import {
  DEFAULT_FEED_BOUNDS,
  DECLARED_QUALITY_GATE_ID,
  FEED_SOURCE_KIND,
  createExternalFeed,
  createSimulatedExternalFeedSource,
  feedSubmissionKey,
} from "../src";
import type {
  ExternalFeedBatchSpec,
  ExternalFeedSource,
  FeedBatchPlanEntry,
  FeedSessionRecord,
} from "../src";

afterAll(() => {
  cleanupScratch();
});

// ---------------------------------------------------------------------------
// The feed builder (the simulated external platform client's wiring)
// ---------------------------------------------------------------------------

/** Builds the deterministic feed over a workspace stack (auto selection). */
async function buildFeed(
  workspace: PlatformWorkspace,
  seed: string,
  plan: readonly FeedBatchPlanEntry[],
): Promise<{
  readonly feed: ReturnType<typeof createExternalFeed>;
  readonly source: ExternalFeedSource;
}> {
  const source = await createSimulatedExternalFeedSource({ seed, plan });
  const feed = createExternalFeed({
    workspace,
    platform: {
      platformId: SIMULATED_PLATFORM.platformId,
      tenantId: SIMULATED_PLATFORM.tenantId,
    },
    source,
    selection: { mode: "auto", query: { domain: "football", task: "match" } },
  });
  return { feed, source };
}

/** Concatenates byte arrays (deterministic order). */
function concat(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

/** The honest v0 transformer's per-item output, re-derived by the test. */
function transformedItemBytes(
  organizationId: string,
  sourceId: string,
  bytes: Uint8Array,
): Uint8Array {
  const header = new TextEncoder().encode(`SPORTA-TRANSFORM/${organizationId}/${sourceId}\n`);
  return concat([header, bytes]);
}

describe("the REL-031 external feed journey (a clean multi-batch session)", () => {
  test("three clean batches end-to-end: the full record, per-item lineage, real digests", async () => {
    const stack = await buildWorkspaceStack("feed-journey-clean");
    const { feed, source } = await buildFeed(stack.workspace, "journey-seed", [
      "clean",
      "clean",
      "clean",
    ]);
    expect(feed.feedSessionId).toBe("feed-1"); // deterministic session identity

    const session = feed.open();
    const record = await session.run();

    // -- the session outcome: completed, untruncated, not cancelled ---------
    expect(record.outcome).toBe("completed");
    expect(record.truncation).toBeNull();
    expect(record.cancellation).toBeNull();
    expect(record.scope).toEqual({
      platformId: SIMULATED_PLATFORM.platformId,
      tenantId: SIMULATED_PLATFORM.tenantId,
    });

    // -- the provenance leg: the declared configuration, recorded -----------
    expect(record.provenance).toEqual({
      sourceKind: FEED_SOURCE_KIND,
      seed: "journey-seed",
      batchCount: 3,
      executorKind: "external.feed-processing",
      serviceVersion: 1,
      requireTransformation: true,
      selection: { mode: "auto", organizationId: null },
      bounds: DEFAULT_FEED_BOUNDS,
    });

    // -- the totals: every item submitted, accepted, processed --------------
    expect(record.totals).toEqual({
      batches: 3,
      batchesSubmitted: 3,
      batchesAccepted: 3,
      batchesCompleted: 3,
      batchesFailed: 0,
      batchesCancelled: 0,
      batchesRefused: 0,
      batchesNotSubmitted: 0,
      itemsSubmitted: 9,
      itemsAccepted: 9,
      itemsRefused: 0,
      itemsProcessed: 9,
      itemsSkipped: 0,
      itemsUnpublished: 0,
      itemsNotSubmitted: 0,
      // org-beta-strong's DECLARED per-run cost (the registry record) x 3
      costUsdAccrued: 3.3,
    });

    // -- per batch: the composition's every stage, verified ------------------
    for (let index = 0; index < 3; index += 1) {
      const batch = record.batches[index];
      const spec: ExternalFeedBatchSpec = source.batchAt(index);
      if (batch === undefined) throw new Error(`batch ${index} missing from the record`);
      expect(batch.family).toBe("clean");
      expect(batch.outcome).toBe("completed");
      expect(batch.jobId).toMatch(/^job-/);

      // The selection leg: the DOCUMENTED ordering, recorded verbatim — the
      // beta organization declares the higher fidelity (8.9) and must win.
      expect(batch.selection).toMatchObject({
        organizationId: stack.secondStrongOrganizationId,
        mode: "auto",
        candidatesConsidered: 3,
      });
      expect(batch.selection?.orderedBy).toContain("quality descending");
      expect(batch.selection?.orderedBy).toContain("fidelity");
      expect(batch.selection?.organizationVersion).toBeGreaterThan(0);

      // The lineage leg: REL-029's meaning projection, per batch.
      expect(batch.lineage).toMatchObject({
        jobId: batch.jobId,
        kind: "external.feed-processing",
        attempts: 1,
        checkpointCount: 3, // the PER-ITEM checkpoints: 3 items -> 3
        codeVersion: null, // the imported executor declares none (honest)
        idempotencyKey: null, // the service-level key governs feeds
      });
      expect(batch.lineage?.inputDigest).toMatch(/^[0-9a-f]{64}$/);
      expect(batch.lineage?.outputArtifactRefs).toHaveLength(1);

      // The quality gate: the organization-DECLARED policy, passed.
      expect(batch.qualityGate?.gateId).toBe(DECLARED_QUALITY_GATE_ID);
      expect(batch.qualityGate?.passed).toBe(true);
      const checkNames = (batch.qualityGate?.checks ?? []).map((check) => check.name);
      expect(checkNames).toContain("output-non-empty");
      expect(checkNames).toContain("lineage-complete");
      expect(checkNames).toContain("no-data-loss");
      expect(checkNames).toContain("declared-quality-present");
      expect(checkNames).toContain("declared-quality-consistent");
      expect(checkNames).toContain("declared-quality-floor");

      // The artifact leg: the content address, the lineage index.
      expect(batch.artifact?.kind).toBe("feed-output");
      expect(batch.artifact?.itemCount).toBe(3);
      expect(batch.artifact?.organizationId).toBe(stack.secondStrongOrganizationId);
      expect(batch.artifact?.checksum).toMatch(/^[0-9a-f]{64}$/);
      expect(batch.artifact?.artifactRef).toBe(`artifact://${batch.artifact?.checksum}`);

      // THE UPLOAD(digest) LAW, per item: the digest the platform client
      // declared IS the checksum the corpus computed (real digests, both
      // sides), and the normalized checksum rides the identity normalizer.
      expect(batch.items).toHaveLength(3);
      for (const item of batch.items) {
        expect(item.outcome).toBe("transformed");
        expect(item.sourceId).toMatch(/^source-/);
        expect(item.declaredDigest).toBe(item.acquiredChecksum);
        expect(item.normalizedChecksum).toBe(item.acquiredChecksum);
        expect(item.artifactChecksum).toMatch(/^[0-9a-f]{64}$/);
        expect(item.checkpointed).toBeNull(); // authoritative outcome exists
      }

      // The per-item OUTPUT digests re-derive from the honest transformer:
      // header(org, sourceId) + the item's bytes — the test recomputes them.
      const expectedPerItem = spec.items.map((item, position) => {
        const sourceId = batch.items[position]?.sourceId;
        if (sourceId === undefined || sourceId === null) {
          throw new Error(`item ${position} of batch ${index} carries no source id`);
        }
        return transformedItemBytes(
          stack.secondStrongOrganizationId,
          sourceId,
          item.bytes ?? new Uint8Array(),
        );
      });
      const expectedPerItemDigests = await Promise.all(
        expectedPerItem.map((bytes) => sha256HexBytes(bytes)),
      );
      expect(batch.items.map((item) => item.artifactChecksum)).toEqual(expectedPerItemDigests);
      // The aggregate artifact checksum is the concat of the per-item bytes.
      const aggregate = concat(expectedPerItem);
      const artifactChecksum = batch.artifact?.checksum;
      if (artifactChecksum === undefined) {
        throw new Error(`batch ${index} carries no artifact checksum`);
      }
      expect(await sha256HexBytes(aggregate)).toBe(artifactChecksum);
      expect(batch.artifact?.byteLength).toBe(aggregate.byteLength);
    }

    // -- the retrieval leg, through the reconnected service surface ---------
    const jobId = record.batches[0]?.jobId;
    if (jobId === undefined) throw new Error("batch 0 carries no job id");
    const output = await stack.workspace.services.getOutput(session.connection, { jobId });
    expect(output.result.artifact.kind).toBe("feed-output");
    expect(output.result.artifact.items).toHaveLength(3);
    const evidence = await stack.workspace.services.getEvidence(session.connection, { jobId });
    expect(evidence.result.evidence.sourceLineage).toHaveLength(3);
    for (const line of evidence.result.evidence.sourceLineage) {
      expect(line.outcome).toBe("transformed");
      expect(line.acquiredChecksum).toMatch(/^[0-9a-f]{64}$/);
      expect(line.normalizedChecksum).toBe(line.acquiredChecksum);
    }
    // The aggregate output bytes re-derive exactly (the honest transformer).
    const spec0 = source.batchAt(0);
    const expectedAggregate = concat(
      spec0.items.map((item, position) => {
        const sourceId = record.batches[0]?.items[position]?.sourceId;
        if (sourceId === undefined || sourceId === null) {
          throw new Error("the record lost a source id");
        }
        return transformedItemBytes(
          stack.secondStrongOrganizationId,
          sourceId,
          item.bytes ?? new Uint8Array(),
        );
      }),
    );
    expect(output.result.bytes).toEqual(expectedAggregate);
  });

  test("determinism: the same seed + config on two identically-seeded stacks ⇒ deep-equal records", async () => {
    const stackA = await buildWorkspaceStack("feed-journey-det-a");
    const stackB = await buildWorkspaceStack("feed-journey-det-b");
    const feedA = await buildFeed(stackA.workspace, "determinism-seed", [
      "clean",
      "mixed-rights",
      "clean",
    ]);
    const feedB = await buildFeed(stackB.workspace, "determinism-seed", [
      "clean",
      "mixed-rights",
      "clean",
    ]);

    const recordA: FeedSessionRecord = await feedA.feed.open().run();
    const recordB: FeedSessionRecord = await feedB.feed.open().run();

    // NO WALL CLOCK anywhere: the records are deep-equal, leg for leg —
    // job ids, digests, lineage, totals, the mixed-rights failure, all of it.
    expect(recordA).toEqual(recordB);
    expect(recordA.batches.map((batch) => batch.jobId)).toEqual(
      recordB.batches.map((batch) => batch.jobId),
    );
    // The mixed-rights batch failed identically on both stacks (typed).
    expect(recordA.batches[1]?.outcome).toBe("failed");
    expect(recordA.batches[1]?.refusal?.code).toBe("platform.job-state");
    expect(recordA.totals.itemsProcessed).toBe(6);
    expect(recordA.totals.itemsUnpublished).toBe(3);
  });

  test("explicit selection rides chooseOrganization through the same composition", async () => {
    const stack = await buildWorkspaceStack("feed-journey-explicit");
    const source = await createSimulatedExternalFeedSource({
      seed: "explicit-seed",
      plan: ["clean"],
    });
    const feed = createExternalFeed({
      workspace: stack.workspace,
      platform: {
        platformId: SIMULATED_PLATFORM.platformId,
        tenantId: SIMULATED_PLATFORM.tenantId,
      },
      source,
      selection: { mode: "explicit", organizationId: stack.strongOrganizationId },
    });
    const record = await feed.open().run();
    expect(record.outcome).toBe("completed");
    const batch = record.batches[0];
    expect(batch?.selection).toMatchObject({
      organizationId: stack.strongOrganizationId,
      mode: "explicit",
      orderedBy: null,
      candidatesConsidered: 1,
    });
    expect(batch?.artifact?.organizationId).toBe(stack.strongOrganizationId);
    expect(batch?.items.every((item) => item.outcome === "transformed")).toBe(true);
    // The production org's declared per-run cost (1.2) accrues.
    expect(record.totals.costUsdAccrued).toBe(1.2);
  });

  test("the exported session contract constants are the documented shapes", () => {
    expect(DEFAULT_FEED_BOUNDS).toEqual({
      maxItemsPerBatch: 8,
      maxSessionItems: 64,
      maxCostUsd: 100,
      maxBatchLatencyMs: 60_000,
    });
    expect(FEED_SOURCE_KIND).toBe("simulated-external-feed/v1");
    expect(feedSubmissionKey("feed-1", 0)).toBe("feed:feed-1:batch-0");
    expect(feedSubmissionKey("feed-7", 12)).toBe("feed:feed-7:batch-12");
  });
});
