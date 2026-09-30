/**
 * REL-009 corpus-store tests: registration + indexing, immutability, the
 * full legal lifecycle with checksums, feature-bundle references and the
 * benchmark binding's verification bar.
 */
import { describe, expect, test } from "bun:test";
import {
  CorpusConflictError,
  CorpusFixtureMismatchError,
  CorpusIllegalTransitionError,
  CorpusNotFoundError,
  CorpusValidationError,
  createBenchmarkFixture,
  createCorpusStore,
  createReferenceAdapter,
  acquireSourceFromAdapter,
} from "../src";
import {
  fixtureBytes,
  providerPermittedBasis,
  uploadMetadata,
  userOwnedBasis,
  youtubeMetadata,
} from "./fixtures";
import { sha256HexBytes } from "../src";

describe("registerReference", () => {
  test("creates a referenced record with every contract field", async () => {
    const store = createCorpusStore();
    const metadata = youtubeMetadata();
    const record = await store.registerReference(metadata);

    expect(record.sourceId).toBe("source-1");
    expect(record.provider).toBe("youtube");
    expect(record.providerContentId).toBe("vid-001");
    expect(record.canonicalUrl).toBe(metadata.canonicalUrl);
    expect(record.ownerRef).toBe("channel:league-official");
    expect(record.observedAt).toBe(1_700_000_000_000);
    expect(record.acquiredAt).toBeNull();
    expect(record.rightsBasis).toBeNull();
    expect(record.acquisitionMethod).toBeNull();
    expect(record.availability).toBe("publicly-listed");
    expect(record.acquiredChecksum).toBeNull();
    expect(record.metadataDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(record.featureBundles).toEqual([]);
    expect(record.restrictions).toEqual([]);
    expect(record.state).toBe("referenced");
    expect(record.normalized).toBeNull();
    expect(record.benchmarkedWith).toBeNull();
  });

  test("malformed metadata refuses with the typed validation error", async () => {
    const store = createCorpusStore();
    const bad = { ...youtubeMetadata(), canonicalUrl: "" };
    await expect(store.registerReference(bad)).rejects.toThrow(CorpusValidationError);
  });

  test("re-registration of the same reference is idempotent", async () => {
    const store = createCorpusStore();
    const first = await store.registerReference(youtubeMetadata());
    const second = await store.registerReference(youtubeMetadata());
    expect(second.sourceId).toBe(first.sourceId);
    expect(await store.list()).toHaveLength(1);
  });

  test("re-registration with different metadata is a typed conflict (immutability)", async () => {
    const store = createCorpusStore();
    await store.registerReference(youtubeMetadata());
    await expect(
      store.registerReference(youtubeMetadata({ ownerRef: "channel:someone-else" })),
    ).rejects.toThrow(CorpusConflictError);
  });

  test("records handed out are deeply frozen", async () => {
    const store = createCorpusStore();
    const record = await store.registerReference(youtubeMetadata());
    expect(Object.isFrozen(record)).toBe(true);
    expect(Object.isFrozen(record.restrictions)).toBe(true);
    expect(() => {
      (record as unknown as { state: string }).state = "acquired";
    }).toThrow();
  });
});

describe("the full legal lifecycle (reference -> benchmarked)", () => {
  test("authorize -> acquire -> normalize -> benchmark with verified checksums", async () => {
    const store = createCorpusStore();
    const bytes = fixtureBytes("lifecycle");
    const metadata = youtubeMetadata();
    const registered = await store.registerReference(metadata);
    const adapter = createReferenceAdapter({
      metadata: [metadata],
      bytes: { [metadata.canonicalUrl]: bytes },
    });

    // The canonical driver: authorize -> retrieve -> record.
    const acquired = await acquireSourceFromAdapter(store, registered.sourceId, adapter, {
      basis: providerPermittedBasis(),
    });
    expect(acquired.state).toBe("acquired");
    expect(acquired.acquiredChecksum).toBe(await sha256HexBytes(bytes));
    expect(acquired.acquisitionMethod).toBe("reference-fixture-v0:v0");
    expect(await store.getBytes(registered.sourceId, "acquired")).toEqual(bytes);

    // Normalize through the identity default.
    const normalized = await store.normalizeSource(registered.sourceId);
    expect(normalized.state).toBe("normalized");
    expect(normalized.normalized).toEqual({
      normalizedChecksum: await sha256HexBytes(bytes),
      pipeline: "identity",
      pipelineVersion: "0",
      at: expect.any(Number),
    });
    expect(await store.getBytes(registered.sourceId, "normalized")).toEqual(bytes);

    // Bind a matching content-addressed fixture.
    const fixture = await createBenchmarkFixture({
      sourceRef: {
        sourceId: registered.sourceId,
        provider: metadata.provider,
        providerContentId: metadata.providerContentId,
        canonicalUrl: metadata.canonicalUrl,
      },
      acquiredByteChecksum: acquired.acquiredChecksum,
      normalizedByteChecksum: normalized.normalized?.normalizedChecksum ?? "",
      timeWindow: { startMs: 1_700_000_000_000, endMs: 1_700_000_060_000 },
      versions: [
        { name: "optical-flow", kind: "feature", version: "1.2.0" },
        { name: "h264-decoder", kind: "decoder", version: "9" },
      ],
    });
    const benchmarked = await store.markBenchmarked(registered.sourceId, fixture);
    expect(benchmarked.state).toBe("benchmarked");
    expect(benchmarked.benchmarkedWith).toBe(fixture.fixtureId);
  });

  test("every illegal jump through the STORE refuses typed", async () => {
    const store = createCorpusStore();
    const registered = await store.registerReference(youtubeMetadata());

    // referenced -> normalized directly: illegal skip.
    await expect(store.normalizeSource(registered.sourceId)).rejects.toThrow(
      CorpusIllegalTransitionError,
    );

    // referenced -> benchmarked directly: illegal skip.
    const fixture = await createBenchmarkFixture({
      sourceRef: {
        sourceId: registered.sourceId,
        provider: "youtube",
        providerContentId: null,
        canonicalUrl: registered.canonicalUrl,
      },
      acquiredByteChecksum: null,
      normalizedByteChecksum: "0".repeat(64),
      timeWindow: { startMs: 0, endMs: 1 },
      versions: [{ name: "optical-flow", kind: "feature", version: "1" }],
    });
    await expect(store.markBenchmarked(registered.sourceId, fixture)).rejects.toThrow(
      CorpusIllegalTransitionError,
    );
    expect((await store.get(registered.sourceId)).state).toBe("referenced");
  });

  test("unknown source ids refuse typed not-found", async () => {
    const store = createCorpusStore();
    await expect(store.get("source-404")).rejects.toThrow(CorpusNotFoundError);
    await expect(store.authorizeAccess("source-404", providerPermittedBasis())).rejects.toThrow(
      CorpusNotFoundError,
    );
  });
});

describe("the benchmark binding verifies the reproducibility bar", () => {
  async function setup() {
    const store = createCorpusStore();
    const bytes = fixtureBytes("benchmark-bar");
    const metadata = youtubeMetadata();
    const registered = await store.registerReference(metadata);
    const adapter = createReferenceAdapter({
      metadata: [metadata],
      bytes: { [metadata.canonicalUrl]: bytes },
    });
    const acquired = await acquireSourceFromAdapter(store, registered.sourceId, adapter, {
      basis: providerPermittedBasis(),
    });
    const normalized = await store.normalizeSource(registered.sourceId);
    return { store, metadata, registered, acquired, normalized };
  }

  test("a fixture for a DIFFERENT source refuses", async () => {
    const { store, registered, acquired, normalized } = await setup();
    const fixture = await createBenchmarkFixture({
      sourceRef: {
        sourceId: registered.sourceId,
        provider: "youtube",
        providerContentId: null,
        canonicalUrl: "https://www.youtube.com/watch?v=someone-else",
      },
      acquiredByteChecksum: acquired.acquiredChecksum,
      normalizedByteChecksum: normalized.normalized?.normalizedChecksum ?? "",
      timeWindow: { startMs: 0, endMs: 1 },
      versions: [{ name: "optical-flow", kind: "feature", version: "1" }],
    });
    await expect(store.markBenchmarked(registered.sourceId, fixture)).rejects.toThrow(
      CorpusFixtureMismatchError,
    );
  });

  test("a fixture with a mismatched acquired checksum refuses", async () => {
    const { store, registered, normalized } = await setup();
    const fixture = await createBenchmarkFixture({
      sourceRef: {
        sourceId: registered.sourceId,
        provider: "youtube",
        providerContentId: "vid-001",
        canonicalUrl: registered.canonicalUrl,
      },
      acquiredByteChecksum: "a".repeat(64),
      normalizedByteChecksum: normalized.normalized?.normalizedChecksum ?? "",
      timeWindow: { startMs: 0, endMs: 1 },
      versions: [{ name: "optical-flow", kind: "feature", version: "1" }],
    });
    await expect(store.markBenchmarked(registered.sourceId, fixture)).rejects.toThrow(
      CorpusFixtureMismatchError,
    );
    expect((await store.get(registered.sourceId)).state).toBe("normalized");
  });

  test("a fixture with a mismatched normalized checksum refuses", async () => {
    const { store, registered, acquired } = await setup();
    const fixture = await createBenchmarkFixture({
      sourceRef: {
        sourceId: registered.sourceId,
        provider: "youtube",
        providerContentId: "vid-001",
        canonicalUrl: registered.canonicalUrl,
      },
      acquiredByteChecksum: acquired.acquiredChecksum,
      normalizedByteChecksum: "b".repeat(64),
      timeWindow: { startMs: 0, endMs: 1 },
      versions: [{ name: "optical-flow", kind: "feature", version: "1" }],
    });
    await expect(store.markBenchmarked(registered.sourceId, fixture)).rejects.toThrow(
      CorpusFixtureMismatchError,
    );
  });
});

describe("derived feature bundles (recorded as references, never fetched)", () => {
  test("bundles register idempotently and travel on the record", async () => {
    const store = createCorpusStore();
    const registered = await store.registerReference(youtubeMetadata());

    const first = await store.registerFeatureBundle(registered.sourceId, {
      bundleId: "flow-v1",
      kind: "optical-flow-vectors",
      producer: "feature-pipeline",
      producerVersion: "0.3.1",
      artifactRef: "corpus-blob://flow-v1/sha256:9f2c",
    });
    expect(first.featureBundles).toHaveLength(1);
    expect(first.featureBundles[0]).toMatchObject({
      bundleId: "flow-v1",
      kind: "optical-flow-vectors",
      artifactRef: "corpus-blob://flow-v1/sha256:9f2c",
    });

    // Idempotent re-registration of the identical reference.
    const again = await store.registerFeatureBundle(registered.sourceId, {
      bundleId: "flow-v1",
      kind: "optical-flow-vectors",
      producer: "feature-pipeline",
      producerVersion: "0.3.1",
      artifactRef: "corpus-blob://flow-v1/sha256:9f2c",
    });
    expect(again.featureBundles).toHaveLength(1);

    // A conflicting re-registration of the same bundleId refuses.
    await expect(
      store.registerFeatureBundle(registered.sourceId, {
        bundleId: "flow-v1",
        kind: "optical-flow-vectors",
        producer: "feature-pipeline",
        producerVersion: "0.4.0",
        artifactRef: "corpus-blob://flow-v1/sha256:9f2c",
      }),
    ).rejects.toThrow(CorpusConflictError);

    // Bundle registration does not advance the acquisition state.
    expect((await store.get(registered.sourceId)).state).toBe("referenced");
  });

  test("metadata discovery finds sources by their bundle kinds", async () => {
    const store = createCorpusStore();
    const registered = await store.registerReference(youtubeMetadata());
    await store.registerFeatureBundle(registered.sourceId, {
      bundleId: "flow-v1",
      kind: "optical-flow-vectors",
      producer: "feature-pipeline",
      producerVersion: "0.3.1",
      artifactRef: "corpus-blob://flow-v1/sha256:9f2c",
    });
    const hits = await store.searchMetadata({ text: "optical-flow" });
    expect(hits.map((record) => record.sourceId)).toEqual([registered.sourceId]);
  });
});

describe("user uploads are content-addressed and immutable", () => {
  test("identical bytes + metadata re-ingest idempotently", async () => {
    const store = createCorpusStore();
    const first = await store.ingestUserUpload({
      bytes: fixtureBytes("same-bytes"),
      declaredBasis: userOwnedBasis(),
      metadata: uploadMetadata(),
    });
    const second = await store.ingestUserUpload({
      bytes: fixtureBytes("same-bytes"),
      declaredBasis: userOwnedBasis(),
      metadata: uploadMetadata(),
    });
    expect(second.sourceId).toBe(first.sourceId);
    expect(await store.list()).toHaveLength(1);
    expect(first.canonicalUrl).toContain("corpus://user-upload/");
  });

  test("identical bytes with different declared metadata is a typed conflict", async () => {
    const store = createCorpusStore();
    await store.ingestUserUpload({
      bytes: fixtureBytes("same-bytes-2"),
      declaredBasis: userOwnedBasis(),
      metadata: uploadMetadata(),
    });
    await expect(
      store.ingestUserUpload({
        bytes: fixtureBytes("same-bytes-2"),
        declaredBasis: userOwnedBasis(),
        metadata: uploadMetadata({ title: "A different declared title" }),
      }),
    ).rejects.toThrow(CorpusConflictError);
  });

  test("different bytes produce distinct sources", async () => {
    const store = createCorpusStore();
    const a = await store.ingestUserUpload({
      bytes: fixtureBytes("bytes-a"),
      declaredBasis: userOwnedBasis(),
      metadata: uploadMetadata(),
    });
    const b = await store.ingestUserUpload({
      bytes: fixtureBytes("bytes-b"),
      declaredBasis: userOwnedBasis(),
      metadata: uploadMetadata(),
    });
    expect(a.sourceId).not.toBe(b.sourceId);
    expect(a.canonicalUrl).not.toBe(b.canonicalUrl);
  });
});
