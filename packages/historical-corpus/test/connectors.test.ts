/**
 * REL-010 connector tests — the three `ConnectorAdapter` v0 implementations
 * over the ProviderAdapter seam, with THE RIGHTS-BASIS INVARIANT re-tested
 * through every connector:
 * - the user-upload path (bytes + declared basis -> acquired; no basis ->
 *   the SAME typed `corpus.rights-basis-required` refusal as the store);
 * - the authorized-feed path (fixture feed store + the authorization hook
 *   the caller must satisfy; acquisition routes the canonical order);
 * - the reference-only path (metadata indexing ONLY; the byte acquisition
 *   is a typed refusal at the connector AND the store refuses
 *   independently — the double law).
 */
import { describe, expect, test } from "bun:test";
import type { RightsBasis, SourceMetadata } from "../src";
import {
  createAuthorizedFeedConnector,
  createCorpusStore,
  createReferenceOnlyConnector,
  createUserUploadConnector,
} from "../src";
import {
  fixtureBytes,
  providerPermittedBasis,
  referenceOnlyMetadata,
  uploadMetadata,
  userOwnedBasis,
  youtubeMetadata,
} from "./fixtures";

// ---------------------------------------------------------------------------
// Fixture builders local to the connector tests
// ---------------------------------------------------------------------------

/** An authorized-feed basis (the class 4 -> basis mapping). */
function authorizedFeedBasis(overrides: Partial<RightsBasis> = {}): RightsBasis {
  return {
    basisType: "authorized-feed",
    grantRef: "agreement:feed-77",
    scope: "acquisition for normalization and benchmarking",
    declaredBy: "system:feed-connector",
    ...overrides,
  };
}

/** Feed item metadata (a tracking-stats feed item). */
function feedItemMetadata(overrides: Partial<SourceMetadata> = {}): SourceMetadata {
  return youtubeMetadata({
    provider: "feed:tracking-stats",
    providerContentId: "feed-item-001",
    canonicalUrl: "https://feeds.example/items/feed-item-001",
    title: "Tracking stats item 1",
    ...overrides,
  });
}

describe("the user-upload connector (contract class 1)", () => {
  test("bytes + declared basis -> an acquired record through the store's user-fed path", async () => {
    const store = createCorpusStore();
    const connector = createUserUploadConnector();
    const bytes = fixtureBytes("upload-a");
    const record = await connector.acquire(store, {
      kind: "user-upload",
      bytes,
      declaredBasis: userOwnedBasis(),
      metadata: uploadMetadata(),
    });
    expect(record.state).toBe("acquired");
    expect(record.provider).toBe("user-upload");
    expect(record.rightsBasis).toEqual(userOwnedBasis());
    expect(record.acquiredChecksum).not.toBeNull();
    expect(record.acquisitionMethod).toBe("user-upload:v0");
    expect(await store.getBytes(record.sourceId, "acquired")).toEqual(bytes);
  });

  test("THE INVARIANT through connector 1: no declared basis -> the store's typed rights refusal", async () => {
    const store = createCorpusStore();
    const connector = createUserUploadConnector();
    const refusal = connector.acquire(store, {
      kind: "user-upload",
      bytes: fixtureBytes("upload-b"),
      metadata: uploadMetadata(),
    });
    await expect(refusal).rejects.toMatchObject({
      code: "corpus.rights-basis-required",
      failureClass: "rights",
    });
    // Fail-closed: nothing was recorded.
    expect(await store.list()).toEqual([]);
  });

  test("a basis of the wrong type is a typed caller error (the class -> basis mapping is law)", async () => {
    const store = createCorpusStore();
    const connector = createUserUploadConnector();
    await expect(
      connector.acquire(store, {
        kind: "user-upload",
        bytes: fixtureBytes("upload-c"),
        declaredBasis: authorizedFeedBasis(), // wrong class
        metadata: uploadMetadata(),
      }),
    ).rejects.toMatchObject({
      code: "corpus.validation",
      failureClass: "validation",
    });
  });

  test("a request of the wrong kind is refused typed; registerReference enforces provider", async () => {
    const store = createCorpusStore();
    const connector = createUserUploadConnector();
    await expect(
      connector.acquire(store, { kind: "authorized-feed", canonicalUrl: "https://x.example/1" }),
    ).rejects.toMatchObject({ code: "corpus.validation" });
    await expect(connector.registerReference(store, youtubeMetadata())).rejects.toMatchObject({
      code: "corpus.validation",
    });
    const registered = await connector.registerReference(store, {
      ...youtubeMetadata(),
      provider: "user-upload",
      canonicalUrl: "corpus://user-upload/declared-1",
    });
    expect(registered.state).toBe("referenced");
    expect(registered.provider).toBe("user-upload");
    // The honest capability flags.
    expect(connector.sourceClass).toBe("user-fed-upload");
    expect(connector.capabilities).toEqual({ byteAcquisition: true, discovery: false });
    expect(connector.discover).toBeUndefined();
  });
});

describe("the authorized-feed connector (contract class 4)", () => {
  function buildFeed(
    hook: (canonicalUrl: string) => Promise<RightsBasis | null> = async () => authorizedFeedBasis(),
  ) {
    const items = [
      { metadata: feedItemMetadata(), bytes: fixtureBytes("feed-1") },
      {
        metadata: feedItemMetadata({
          providerContentId: "feed-item-002",
          canonicalUrl: "https://feeds.example/items/feed-item-002",
          title: "Tracking stats item 2",
        }),
        // no bytes: honest unavailability at retrieval time
      },
      {
        metadata: feedItemMetadata({
          providerContentId: "feed-item-003",
          canonicalUrl: "https://feeds.example/items/feed-item-003",
          restrictions: ["reference-only"],
          title: "Feed item declared reference-only",
        }),
        bytes: fixtureBytes("feed-3"),
      },
    ];
    const connector = createAuthorizedFeedConnector({
      feedId: "feed:tracking-stats",
      items,
      authorizationHook: async ({ canonicalUrl }) => hook(canonicalUrl),
    });
    return { connector, items };
  }

  test("discovery filters the fixture feed store", async () => {
    const { connector } = buildFeed();
    const hits = await connector.discover?.({ text: "item 1" });
    expect(hits?.map((metadata) => metadata.providerContentId)).toEqual(["feed-item-001"]);
    expect(connector.capabilities).toEqual({ byteAcquisition: true, discovery: true });
    expect(connector.sourceClass).toBe("authorized-feed");
  });

  test("acquisition routes the canonical order: register -> hook -> authorize -> retrieve -> record", async () => {
    const store = createCorpusStore();
    const { connector } = buildFeed();
    const record = await connector.acquire(store, {
      kind: "authorized-feed",
      canonicalUrl: "https://feeds.example/items/feed-item-001",
    });
    expect(record.state).toBe("acquired");
    expect(record.provider).toBe("feed:tracking-stats");
    expect(record.rightsBasis).toEqual(authorizedFeedBasis());
    expect(record.acquisitionMethod).toBe("authorized-feed:v0");
    expect(record.canonicalUrl).toBe("https://feeds.example/items/feed-item-001");
    expect(await store.getBytes(record.sourceId, "acquired")).toEqual(fixtureBytes("feed-1"));
  });

  test("acquisition is resumable-safe across an existing reference (idempotent registration)", async () => {
    const store = createCorpusStore();
    const { connector, items } = buildFeed();
    const first = await connector.registerReference(store, items[0]!.metadata);
    expect(first.state).toBe("referenced");
    const acquired = await connector.acquire(store, {
      kind: "authorized-feed",
      canonicalUrl: first.canonicalUrl,
    });
    expect(acquired.sourceId).toBe(first.sourceId);
    expect(acquired.state).toBe("acquired");
  });

  test("THE INVARIANT through connector 4: an unsatisfied hook -> the typed rights refusal, state untouched", async () => {
    const store = createCorpusStore();
    const { connector } = buildFeed(async () => null); // the caller cannot satisfy
    const registered = await connector.registerReference(store, feedItemMetadata());
    await expect(
      connector.acquire(store, {
        kind: "authorized-feed",
        canonicalUrl: registered.canonicalUrl,
      }),
    ).rejects.toMatchObject({
      code: "corpus.rights-basis-required",
      failureClass: "rights",
    });
    expect((await store.get(registered.sourceId)).state).toBe("referenced"); // fail-closed
  });

  test("a hook basis of the wrong type is a typed caller error", async () => {
    const store = createCorpusStore();
    const { connector } = buildFeed(async () => providerPermittedBasis()); // wrong class
    await expect(
      connector.acquire(store, {
        kind: "authorized-feed",
        canonicalUrl: "https://feeds.example/items/feed-item-001",
      }),
    ).rejects.toMatchObject({ code: "corpus.validation" });
  });

  test("a malformed hook basis is the typed rights refusal (never improvised)", async () => {
    const store = createCorpusStore();
    const { connector } = buildFeed(async () => ({
      basisType: "authorized-feed",
      grantRef: "", // malformed: an empty grant reference is not a basis
      scope: "s",
      declaredBy: "system:feed-connector",
    }));
    await expect(
      connector.acquire(store, {
        kind: "authorized-feed",
        canonicalUrl: "https://feeds.example/items/feed-item-001",
      }),
    ).rejects.toMatchObject({ code: "corpus.rights-basis-required" });
  });

  test("a feed item with no bytes refuses honestly (bytes-unavailable, availability never fabricated)", async () => {
    const store = createCorpusStore();
    const { connector } = buildFeed();
    await expect(
      connector.acquire(store, {
        kind: "authorized-feed",
        canonicalUrl: "https://feeds.example/items/feed-item-002",
      }),
    ).rejects.toMatchObject({ code: "corpus.bytes-unavailable" });
  });

  test("a feed item declared reference-only: the STORE refuses authorization (restrictions are law)", async () => {
    const store = createCorpusStore();
    const { connector } = buildFeed();
    await expect(
      connector.acquire(store, {
        kind: "authorized-feed",
        canonicalUrl: "https://feeds.example/items/feed-item-003",
      }),
    ).rejects.toMatchObject({
      code: "corpus.restriction-forbidden",
      failureClass: "restriction",
    });
  });

  test("an unknown feed item / wrong request kind refuse typed", async () => {
    const store = createCorpusStore();
    const { connector } = buildFeed();
    await expect(
      connector.acquire(store, {
        kind: "authorized-feed",
        canonicalUrl: "https://feeds.example/items/unknown",
      }),
    ).rejects.toMatchObject({ code: "corpus.not-found" });
    await expect(
      connector.acquire(store, {
        kind: "user-upload",
        bytes: new Uint8Array(1),
        metadata: uploadMetadata(),
      }),
    ).rejects.toMatchObject({ code: "corpus.validation" });
    await expect(
      connector.registerReference(store, youtubeMetadata()), // not a feed item
    ).rejects.toMatchObject({ code: "corpus.not-found" });
  });
});

describe("the reference-only discovery connector (contract class 5)", () => {
  function buildReferenceOnly() {
    return createReferenceOnlyConnector({
      metadata: [youtubeMetadata({ title: "Public clip A" }), referenceOnlyMetadata()],
    });
  }

  test("discovery is metadata-only over the fixture store", async () => {
    const connector = buildReferenceOnly();
    expect(connector.sourceClass).toBe("reference-only");
    expect(connector.capabilities).toEqual({ byteAcquisition: false, discovery: true });
    const hits = await connector.discover?.({ text: "public clip" });
    expect(hits?.map((metadata) => metadata.title)).toEqual(["Public clip A"]);
  });

  test("registration indexes the reference AND forces the reference-only restriction (the class law)", async () => {
    const store = createCorpusStore();
    const connector = buildReferenceOnly();
    const record = await connector.registerReference(store, youtubeMetadata());
    expect(record.state).toBe("referenced");
    expect(record.restrictions).toContain("reference-only"); // forced by construction
    // The already-restricted metadata is not duplicated.
    const second = await connector.registerReference(store, referenceOnlyMetadata());
    expect(second.restrictions.filter((restriction) => restriction === "reference-only")).toEqual([
      "reference-only",
    ]);
  });

  test("THE TYPED REFUSAL: the connector has NO byte acquisition path at all", async () => {
    const store = createCorpusStore();
    const connector = buildReferenceOnly();
    for (const request of [
      { kind: "reference-only", canonicalUrl: "https://www.youtube.com/watch?v=vid-001" },
      { kind: "authorized-feed", canonicalUrl: "https://feeds.example/items/feed-item-001" },
    ] as const) {
      await expect(connector.acquire(store, request)).rejects.toMatchObject({
        code: "corpus.restriction-forbidden",
        failureClass: "restriction",
      });
    }
    // Fail-closed: nothing was acquired, the corpus holds only references.
    expect(await store.list({ state: "acquired" })).toEqual([]);
  });

  test("THE DOUBLE LAW: the store ALSO refuses authorization of a reference-only-registered source", async () => {
    const store = createCorpusStore();
    const connector = buildReferenceOnly();
    const record = await connector.registerReference(store, youtubeMetadata());
    await expect(
      store.authorizeAccess(record.sourceId, providerPermittedBasis()),
    ).rejects.toMatchObject({
      code: "corpus.restriction-forbidden",
    });
  });
});
