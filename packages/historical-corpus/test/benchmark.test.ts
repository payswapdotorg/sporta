/**
 * REL-011 benchmark registration tests — the immutable, content-addressed,
 * reusable entries over normalized sources + the query API:
 * - registration over a normalized source binds a content-addressed fixture
 *   through the state machine (record advances to `benchmarked`);
 * - immutability: identical content is idempotent, a different registration
 *   over a benchmarked source is a typed conflict;
 * - the eligibility law: reference-only and not-yet-normalized sources
 *   refuse typed (`corpus.benchmark-ineligible`);
 * - list/lookup by source, overlapping window, component version.
 */
import { describe, expect, test } from "bun:test";
import type { ComponentVersion } from "../src";
import {
  createBenchmarkRegistrar,
  createCorpusStore,
  createReferenceOnlyConnector,
  identityNormalizer,
} from "../src";
import type { TimeWindow } from "../src";
import { fixtureBytes, uploadMetadata, userOwnedBasis, youtubeMetadata } from "./fixtures";

/** The feature/decoder versions the test registrations pin. */
function versions(): ComponentVersion[] {
  return [
    { name: "optical-flow", kind: "feature", version: "1.2.0" },
    { name: "h264-decoder", kind: "decoder", version: "3.0.1" },
  ];
}

/** A match-minute-style window. */
function window(): TimeWindow {
  return { startMs: 1_700_000_000_000, endMs: 1_700_006_000_000 };
}

/** Uploads, normalizes and returns the sourceId of a ready-to-benchmark source. */
async function normalizedSource(store: ReturnType<typeof createCorpusStore>, seed: string) {
  const record = await store.ingestUserUpload({
    bytes: fixtureBytes(seed),
    declaredBasis: userOwnedBasis(),
    metadata: uploadMetadata({ title: `Match ${seed}` }),
  });
  const normalized = await store.normalizeSource(record.sourceId, {
    normalizer: identityNormalizer,
  });
  expect(normalized.state).toBe("normalized");
  return record.sourceId;
}

describe("registration over a normalized source", () => {
  test("binds a content-addressed fixture and advances the record to benchmarked", async () => {
    const store = createCorpusStore();
    const registrar = createBenchmarkRegistrar(store);
    const sourceId = await normalizedSource(store, "bench-1");
    const entry = await registrar.register({
      sourceId,
      timeWindow: window(),
      versions: versions(),
    });
    const record = await store.get(sourceId);
    expect(record.state).toBe("benchmarked");
    expect(record.benchmarkedWith).toBe(entry.registrationId);
    // Content addressing: the registration id IS the fixture's content address.
    expect(entry.registrationId).toBe(entry.fixture.fixtureId);
    expect(entry.fixture.acquiredByteChecksum).toBe(record.acquiredChecksum);
    expect(record.normalized?.normalizedChecksum).toBe(entry.fixture.normalizedByteChecksum);
    expect(entry.source.sourceId).toBe(sourceId);
    expect(entry.source.canonicalUrl).toBe(record.canonicalUrl);
    // Reusable derived feature bundles ride along as references.
    const secondSourceId = await normalizedSource(store, "bench-1b");
    const withBundles = await registrar.register({
      sourceId: secondSourceId,
      timeWindow: window(),
      versions: versions(),
      featureBundles: [
        {
          bundleId: "bundle-1",
          kind: "optical-flow-vectors",
          producer: "feature-pipeline",
          producerVersion: "0.3",
          artifactRef: "artifact://features/bundle-1",
        },
      ],
    });
    expect(withBundles.featureBundles.map((bundle) => bundle.bundleId)).toEqual(["bundle-1"]);
    expect(
      (await store.get(secondSourceId)).featureBundles.map((bundle) => bundle.artifactRef),
    ).toEqual(["artifact://features/bundle-1"]);
  });

  test("a second normalized source registers independently (per-source binding)", async () => {
    const store = createCorpusStore();
    const registrar = createBenchmarkRegistrar(store);
    const first = await normalizedSource(store, "bench-2a");
    const second = await normalizedSource(store, "bench-2b");
    const entryA = await registrar.register({
      sourceId: first,
      timeWindow: window(),
      versions: versions(),
    });
    const entryB = await registrar.register({
      sourceId: second,
      timeWindow: window(),
      versions: versions(),
    });
    expect(entryA.registrationId).not.toBe(entryB.registrationId); // different source refs
    expect((await registrar.list()).length).toBe(2);
  });

  test("the entry is deeply frozen (immutable evidence)", async () => {
    const store = createCorpusStore();
    const registrar = createBenchmarkRegistrar(store);
    const sourceId = await normalizedSource(store, "bench-3");
    const entry = await registrar.register({
      sourceId,
      timeWindow: window(),
      versions: versions(),
    });
    expect(Object.isFrozen(entry)).toBe(true);
    expect(Object.isFrozen(entry.fixture)).toBe(true);
    expect(Object.isFrozen(entry.source)).toBe(true);
    expect(() => {
      (entry as unknown as { registeredAt: number }).registeredAt = 0;
    }).toThrow();
  });
});

describe("immutability + content addressing", () => {
  test("identical content re-registers idempotently (the same entry object)", async () => {
    const store = createCorpusStore();
    const registrar = createBenchmarkRegistrar(store);
    const sourceId = await normalizedSource(store, "bench-4");
    const first = await registrar.register({
      sourceId,
      timeWindow: window(),
      versions: versions(),
    });
    const again = await registrar.register({
      sourceId,
      timeWindow: window(),
      versions: versions(),
    });
    expect(again).toBe(first); // the identical entry, not a copy
    expect((await registrar.list()).length).toBe(1);
  });

  test("a DIFFERENT registration over a benchmarked source is a typed conflict", async () => {
    const store = createCorpusStore();
    const registrar = createBenchmarkRegistrar(store);
    const sourceId = await normalizedSource(store, "bench-5");
    await registrar.register({ sourceId, timeWindow: window(), versions: versions() });
    await expect(
      registrar.register({
        sourceId,
        timeWindow: { startMs: 1_700_010_000_000, endMs: 1_700_016_000_000 },
        versions: versions(),
      }),
    ).rejects.toMatchObject({
      code: "corpus.conflict",
      failureClass: "conflict",
    });
    // And a different version pin conflicts the same way.
    await expect(
      registrar.register({
        sourceId,
        timeWindow: window(),
        versions: [{ name: "optical-flow", kind: "feature", version: "9.9.9" }],
      }),
    ).rejects.toMatchObject({ code: "corpus.conflict" });
    expect((await registrar.list()).length).toBe(1); // nothing added
  });
});

describe("the eligibility law (typed refusals)", () => {
  test("a reference-only source refuses typed: benchmarks require acquired+normalized bytes", async () => {
    const store = createCorpusStore();
    const registrar = createBenchmarkRegistrar(store);
    const connector = createReferenceOnlyConnector({ metadata: [youtubeMetadata()] });
    const record = await connector.registerReference(store, youtubeMetadata());
    await expect(
      registrar.register({ sourceId: record.sourceId, timeWindow: window(), versions: versions() }),
    ).rejects.toMatchObject({
      code: "corpus.benchmark-ineligible",
      failureClass: "restriction",
      details: { sourceId: record.sourceId, restriction: "reference-only" },
    });
  });

  test("an acquired-but-not-normalized source refuses typed naming its state", async () => {
    const store = createCorpusStore();
    const registrar = createBenchmarkRegistrar(store);
    const record = await store.ingestUserUpload({
      bytes: fixtureBytes("not-normalized"),
      declaredBasis: userOwnedBasis(),
      metadata: uploadMetadata(),
    });
    expect(record.state).toBe("acquired");
    await expect(
      registrar.register({ sourceId: record.sourceId, timeWindow: window(), versions: versions() }),
    ).rejects.toMatchObject({
      code: "corpus.benchmark-ineligible",
      details: { sourceId: record.sourceId, state: "acquired" },
    });
  });

  test("a merely-referenced (non-reference-only) source refuses typed as well", async () => {
    const store = createCorpusStore();
    const registrar = createBenchmarkRegistrar(store);
    const record = await store.registerReference(youtubeMetadata());
    await expect(
      registrar.register({ sourceId: record.sourceId, timeWindow: window(), versions: versions() }),
    ).rejects.toMatchObject({ code: "corpus.benchmark-ineligible" });
  });

  test("an unknown source is the typed not-found", async () => {
    const store = createCorpusStore();
    const registrar = createBenchmarkRegistrar(store);
    await expect(
      registrar.register({ sourceId: "source-404", timeWindow: window(), versions: versions() }),
    ).rejects.toMatchObject({ code: "corpus.not-found" });
  });
});

describe("the query API (list/lookup by source, window, feature version)", () => {
  async function seeded() {
    const store = createCorpusStore();
    const registrar = createBenchmarkRegistrar(store);
    const a = await normalizedSource(store, "query-a");
    const b = await normalizedSource(store, "query-b");
    const c = await normalizedSource(store, "query-c");
    const entryA = await registrar.register({
      sourceId: a,
      timeWindow: { startMs: 1_000, endMs: 2_000 },
      versions: versions(),
    });
    const entryB = await registrar.register({
      sourceId: b,
      timeWindow: { startMs: 5_000, endMs: 6_000 },
      versions: [{ name: "optical-flow", kind: "feature", version: "2.0.0" }],
    });
    const entryC = await registrar.register({
      sourceId: c,
      timeWindow: { startMs: 10_000, endMs: 20_000 },
      versions: versions(),
    });
    return { registrar, entryA, entryB, entryC, a, b, c };
  }

  test("get() by content address; unknown ids refuse typed", async () => {
    const { registrar, entryA } = await seeded();
    expect(await registrar.get(entryA.registrationId)).toBe(entryA);
    await expect(registrar.get("deadbeef")).rejects.toMatchObject({ code: "corpus.not-found" });
  });

  test("list() by source and by canonical URL", async () => {
    const { registrar, entryA, a } = await seeded();
    expect(await registrar.list({ sourceId: a })).toEqual([entryA]);
    expect(await registrar.list({ canonicalUrl: entryA.source.canonicalUrl })).toEqual([entryA]);
    expect((await registrar.list({ sourceId: "source-404" })).length).toBe(0);
  });

  test("list() by OVERLAPPING window (inclusive edges)", async () => {
    const { registrar, entryA, entryB, entryC } = await seeded();
    // A window overlapping only A.
    expect(await registrar.list({ overlappingWindow: { startMs: 0, endMs: 1_000 } })).toEqual([
      entryA,
    ]);
    // A window spanning A..B but not C.
    expect(await registrar.list({ overlappingWindow: { startMs: 1_500, endMs: 5_500 } })).toEqual([
      entryA,
      entryB,
    ]);
    // A window inside C.
    expect(await registrar.list({ overlappingWindow: { startMs: 12_000, endMs: 13_000 } })).toEqual(
      [entryC],
    );
    // No overlap at all.
    expect(
      await registrar.list({ overlappingWindow: { startMs: 100_000, endMs: 200_000 } }),
    ).toEqual([]);
  });

  test("list() by pinned component version (feature or decoder)", async () => {
    const { registrar, entryA, entryB, entryC } = await seeded();
    expect(await registrar.list({ component: { name: "optical-flow", version: "1.2.0" } })).toEqual(
      [entryA, entryC],
    );
    expect(await registrar.list({ component: { name: "optical-flow", version: "2.0.0" } })).toEqual(
      [entryB],
    );
    expect(await registrar.list({ component: { name: "h264-decoder", version: "3.0.1" } })).toEqual(
      [entryA, entryC],
    );
    expect(await registrar.list({ component: { name: "optical-flow", version: "0.0.1" } })).toEqual(
      [],
    );
  });

  test("combined filters intersect", async () => {
    const { registrar, entryC, c } = await seeded();
    expect(
      await registrar.list({
        sourceId: c,
        overlappingWindow: { startMs: 15_000, endMs: 16_000 },
        component: { name: "h264-decoder", version: "3.0.1" },
      }),
    ).toEqual([entryC]);
    expect(
      await registrar.list({
        sourceId: c,
        component: { name: "optical-flow", version: "2.0.0" }, // B's pin, not C's
      }),
    ).toEqual([]);
  });
});
