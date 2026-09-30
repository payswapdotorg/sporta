/**
 * REL-009 ReferenceAdapter v0 tests: pure metadata discovery against
 * INJECTED fixture metadata — no network, no provider SDKs (by
 * construction: the fixture store is the only dependency).
 */
import { describe, expect, test } from "bun:test";
import {
  CorpusBytesUnavailableError,
  createReferenceAdapter,
  createCorpusStore,
  acquireSourceFromAdapter,
} from "../src";
import { fixtureBytes, providerPermittedBasis, youtubeMetadata } from "./fixtures";

describe("discoverMetadata (metadata only, never bytes)", () => {
  test("finds fixtures by free text over title/description", async () => {
    const adapter = createReferenceAdapter({
      metadata: [
        youtubeMetadata(),
        youtubeMetadata({
          providerContentId: "vid-002",
          canonicalUrl: "https://www.youtube.com/watch?v=vid-002",
          title: "Tactical Analysis — Week 12",
          description: "coach tape",
        }),
      ],
    });
    const hits = await adapter.discoverMetadata({ text: "tactical" });
    expect(hits.map((hit) => hit.providerContentId)).toEqual(["vid-002"]);
  });

  test("filters by provider, content id and canonical URL; limit applies", async () => {
    const adapter = createReferenceAdapter({
      metadata: [
        youtubeMetadata(),
        youtubeMetadata({
          providerContentId: "vid-002",
          canonicalUrl: "https://www.youtube.com/watch?v=vid-002",
        }),
        {
          ...youtubeMetadata(),
          provider: "vimeo",
          providerContentId: "vm-001",
          canonicalUrl: "https://vimeo.com/vm-001",
        },
      ],
    });

    expect(
      (await adapter.discoverMetadata({ provider: "vimeo" })).map((hit) => hit.providerContentId),
    ).toEqual(["vm-001"]);
    expect(
      (await adapter.discoverMetadata({ providerContentId: "vid-002" })).map((hit) => hit.provider),
    ).toEqual(["youtube"]);
    expect(
      await adapter.discoverMetadata({ canonicalUrl: youtubeMetadata().canonicalUrl }),
    ).toHaveLength(1);
    expect((await adapter.discoverMetadata({ limit: 2 })).length).toBeLessThanOrEqual(2);
  });

  test("discovery is deterministic (two runs deep-equal, sorted by canonical URL)", async () => {
    const adapter = createReferenceAdapter({
      metadata: [
        youtubeMetadata(),
        {
          ...youtubeMetadata(),
          provider: "vimeo",
          providerContentId: "vm-001",
          canonicalUrl: "https://vimeo.com/vm-001",
        },
      ],
    });
    const first = await adapter.discoverMetadata({});
    const second = await adapter.discoverMetadata({});
    expect(first).toEqual(second);
    expect(first.map((hit) => hit.canonicalUrl)).toEqual([
      "https://vimeo.com/vm-001",
      "https://www.youtube.com/watch?v=vid-001",
    ]);
  });

  test("discovered entries carry metadata only — no bytes field exists", async () => {
    const adapter = createReferenceAdapter({ metadata: [youtubeMetadata()] });
    const hits = await adapter.discoverMetadata({});
    for (const hit of hits) {
      expect(Object.keys(hit).sort()).toEqual([
        "availability",
        "canonicalUrl",
        "description",
        "observedAt",
        "ownerRef",
        "provider",
        "providerContentId",
        "restrictions",
        "title",
      ]);
    }
  });
});

describe("toCanonicalReference", () => {
  test("reduces metadata to the retained reference (display fields dropped)", async () => {
    const metadata = youtubeMetadata();
    const adapter = createReferenceAdapter({ metadata: [metadata] });
    const reference = await adapter.toCanonicalReference(metadata);
    expect(reference).toEqual({
      provider: "youtube",
      providerContentId: "vid-001",
      canonicalUrl: metadata.canonicalUrl,
      ownerRef: "channel:league-official",
      availability: "publicly-listed",
      restrictions: [],
    });
  });
});

describe("retrieveBytes (only through the authorization hook)", () => {
  test("refuses honestly when the fixture store holds no bytes", async () => {
    const metadata = youtubeMetadata();
    const adapter = createReferenceAdapter({ metadata: [metadata] });
    const store = createCorpusStore();
    const registered = await store.registerReference(metadata);
    const access = await store.authorizeAccess(registered.sourceId, providerPermittedBasis());
    const reference = await adapter.toCanonicalReference(metadata);

    await expect(adapter.retrieveBytes(reference, access)).rejects.toThrow(
      CorpusBytesUnavailableError,
    );
  });

  test("serves the exact fixture bytes to a valid store-minted token", async () => {
    const metadata = youtubeMetadata();
    const bytes = fixtureBytes("served");
    const adapter = createReferenceAdapter({
      metadata: [metadata],
      bytes: { [metadata.canonicalUrl]: bytes },
    });
    const store = createCorpusStore();
    const registered = await store.registerReference(metadata);
    const access = await store.authorizeAccess(registered.sourceId, providerPermittedBasis());
    const reference = await adapter.toCanonicalReference(metadata);

    expect(await adapter.retrieveBytes(reference, access)).toEqual(bytes);
  });

  test("the end-to-end driver acquires the exact fixture bytes", async () => {
    const metadata = youtubeMetadata();
    const bytes = fixtureBytes("end-to-end");
    const adapter = createReferenceAdapter({
      metadata: [metadata],
      bytes: { [metadata.canonicalUrl]: bytes },
    });
    const store = createCorpusStore();
    const registered = await store.registerReference(metadata);
    const acquired = await acquireSourceFromAdapter(store, registered.sourceId, adapter, {
      basis: providerPermittedBasis(),
    });
    expect(acquired.state).toBe("acquired");
    expect(await store.getBytes(registered.sourceId, "acquired")).toEqual(bytes);
  });
});

describe("adapter isolation (no global state between instances)", () => {
  test("two adapters over disjoint fixture stores never see each other's fixtures", async () => {
    const a = createReferenceAdapter({ metadata: [youtubeMetadata()] });
    const b = createReferenceAdapter({ metadata: [] });
    expect(await a.discoverMetadata({})).toHaveLength(1);
    expect(await b.discoverMetadata({})).toHaveLength(0);
    // And the first adapter still sees exactly its own fixture afterwards.
    expect(await a.discoverMetadata({})).toHaveLength(1);
  });
});
