/**
 * REL-009 THE INVARIANT, tested explicitly: a URL is a source reference,
 * NOT proof of transformation rights.
 *
 * The law, in full:
 * - reference-only sources can be indexed and used for metadata discovery
 *   without acquiring bytes;
 * - the transition `referenced -> authorized-for-access` REQUIRES an
 *   explicit rights/policy basis record — without it the store refuses
 *   with the typed error `corpus.rights-basis-required`;
 * - NO BYPASS PATH EXISTS: forged tokens are refused at runtime, the
 *   token type cannot be constructed outside the package (compile-time),
 *   scope mismatches are refused, and the user-fed upload path pays the
 *   same basis discipline at birth.
 */
import { describe, expect, test } from "bun:test";
import {
  CorpusAccessInvalidError,
  CorpusRestrictionError,
  CorpusRightsBasisRequiredError,
  createCorpusStore,
  createReferenceAdapter,
  isCorpusError,
  isAuthorizedByteAccess,
  type AuthorizedByteAccess,
} from "../src";
import {
  fixtureBytes,
  providerPermittedBasis,
  referenceOnlyMetadata,
  uploadMetadata,
  userOwnedBasis,
  youtubeMetadata,
} from "./fixtures";

describe("a URL is a source reference, not proof of transformation rights", () => {
  test("reference-only sources are indexed and metadata-discoverable WITHOUT acquiring bytes", async () => {
    const store = createCorpusStore();
    const registered = await store.registerReference(referenceOnlyMetadata());
    expect(registered.state).toBe("referenced");

    // Indexed: get, list and URL lookup all see it.
    expect((await store.get(registered.sourceId)).sourceId).toBe(registered.sourceId);
    expect((await store.list({ state: "referenced" })).map((record) => record.sourceId)).toEqual([
      registered.sourceId,
    ]);
    expect(await store.getByCanonicalUrl(registered.canonicalUrl)).not.toBeNull();

    // Metadata discovery works over the registered reference.
    const hits = await store.searchMetadata({ canonicalUrl: registered.canonicalUrl });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.sourceId).toBe(registered.sourceId);

    // And no bytes were ever acquired (the accessor refuses, honestly).
    await expect(store.getBytes(registered.sourceId, "acquired")).rejects.toThrow();
  });

  test("authorizeAccess WITHOUT a basis refuses with corpus.rights-basis-required, fail-closed", async () => {
    const store = createCorpusStore();
    const registered = await store.registerReference(youtubeMetadata());

    let caught: unknown;
    try {
      await store.authorizeAccess(registered.sourceId);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(CorpusRightsBasisRequiredError);
    const typed = caught as CorpusRightsBasisRequiredError;
    expect(typed.code).toBe("corpus.rights-basis-required");
    expect(typed.failureClass).toBe("rights");
    expect(typed.message).toContain("not proof of transformation rights");

    // Fail-closed: the record is untouched — still referenced, no basis.
    const after = await store.get(registered.sourceId);
    expect(after.state).toBe("referenced");
    expect(after.rightsBasis).toBeNull();
  });

  test("a MALFORMED basis (empty grant ref) refuses with the same typed error", async () => {
    const store = createCorpusStore();
    const registered = await store.registerReference(youtubeMetadata());

    await expect(
      store.authorizeAccess(registered.sourceId, { ...providerPermittedBasis(), grantRef: "" }),
    ).rejects.toMatchObject({ code: "corpus.rights-basis-required" });
    expect((await store.get(registered.sourceId)).state).toBe("referenced");
  });

  test("a VALID basis authorizes access and mints the branded token", async () => {
    const store = createCorpusStore();
    const registered = await store.registerReference(youtubeMetadata());
    const basis = providerPermittedBasis();

    const access = await store.authorizeAccess(registered.sourceId, basis);

    // The token is a real store-minted grant.
    expect(isAuthorizedByteAccess(access)).toBe(true);
    expect(access.sourceId).toBe(registered.sourceId);
    expect(access.canonicalUrl).toBe(registered.canonicalUrl);

    const after = await store.get(registered.sourceId);
    expect(after.state).toBe("authorized-for-access");
    expect(after.rightsBasis).toEqual(basis);
  });

  test("a reference-only restriction cannot be lifted by ANY basis — access is refused", async () => {
    const store = createCorpusStore();
    const registered = await store.registerReference(referenceOnlyMetadata());

    let caught: unknown;
    try {
      await store.authorizeAccess(registered.sourceId, providerPermittedBasis());
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(CorpusRestrictionError);
    const typed = caught as CorpusRestrictionError;
    expect(typed.code).toBe("corpus.restriction-forbidden");
    expect(typed.details.restriction).toBe("reference-only");
    expect((await store.get(registered.sourceId)).state).toBe("referenced");
  });
});

describe("no bypass path exists (the token law)", () => {
  test("recordAcquiredBytes refuses a FORGED token at runtime (brand check)", async () => {
    const store = createCorpusStore();
    const registered = await store.registerReference(youtubeMetadata());

    // A structurally similar object WITHOUT the module-private brand.
    const forged = {
      sourceId: registered.sourceId,
      provider: registered.provider,
      providerContentId: null,
      canonicalUrl: registered.canonicalUrl,
      basisDigest: "0".repeat(64),
      grantedAt: 0,
    } as unknown as AuthorizedByteAccess;

    await expect(
      store.recordAcquiredBytes(registered.sourceId, forged, fixtureBytes("forged")),
    ).rejects.toMatchObject({
      code: "corpus.access-invalid",
      name: "CorpusAccessInvalidError",
    });
    expect((await store.get(registered.sourceId)).state).toBe("referenced");
  });

  test("recordAcquiredBytes refuses a valid token scoped to ANOTHER source", async () => {
    const store = createCorpusStore();
    const a = await store.registerReference(youtubeMetadata());
    const b = await store.registerReference(
      youtubeMetadata({
        providerContentId: "vid-002",
        canonicalUrl: "https://www.youtube.com/watch?v=vid-002",
      }),
    );
    const accessForA = await store.authorizeAccess(a.sourceId, providerPermittedBasis());

    // The token minted for A is presented against B.
    await expect(
      store.recordAcquiredBytes(b.sourceId, accessForA, fixtureBytes("b-bytes")),
    ).rejects.toMatchObject({ code: "corpus.access-invalid" });
    expect((await store.get(b.sourceId)).state).toBe("referenced");
  });

  test("the token cannot be constructed outside the package (compile-time)", async () => {
    // @ts-expect-error — AuthorizedByteAccess is branded: an object literal
    // without the module-private unique symbol is not assignable. The
    // compile gate (tsc --noEmit over test/) enforces the no-bypass law at
    // the type level; if the brand ever disappears this line fails.
    const forged: AuthorizedByteAccess = {
      sourceId: "source-1",
      provider: "youtube",
      providerContentId: null,
      canonicalUrl: "https://www.youtube.com/watch?v=vid-001",
      basisDigest: "0".repeat(64),
      grantedAt: 0,
    };
    // Runtime double-check: the brand guard refuses it too.
    expect(isAuthorizedByteAccess(forged)).toBe(false);
  });

  test("the provider adapter refuses bytes to a forged token", async () => {
    const bytes = fixtureBytes("provider-bytes");
    const adapter = createReferenceAdapter({
      metadata: [youtubeMetadata()],
      bytes: { [youtubeMetadata().canonicalUrl]: bytes },
    });
    const reference = await adapter.toCanonicalReference(youtubeMetadata());

    const forged = {
      sourceId: "source-1",
      provider: "youtube",
      providerContentId: "vid-001",
      canonicalUrl: youtubeMetadata().canonicalUrl,
      basisDigest: "0".repeat(64),
      grantedAt: 0,
    } as unknown as AuthorizedByteAccess;

    await expect(adapter.retrieveBytes(reference, forged)).rejects.toMatchObject({
      code: "corpus.access-invalid",
    });
    await expect(adapter.retrieveBytes(reference, forged)).rejects.toThrow(
      CorpusAccessInvalidError,
    );
  });

  test("the provider adapter refuses bytes to a token scoped to a different reference", async () => {
    const adapter = createReferenceAdapter({
      metadata: [youtubeMetadata()],
      bytes: { [youtubeMetadata().canonicalUrl]: fixtureBytes("provider-bytes") },
    });
    const store = createCorpusStore();
    const other = await store.registerReference(
      youtubeMetadata({
        providerContentId: "vid-002",
        canonicalUrl: "https://www.youtube.com/watch?v=vid-002",
      }),
    );
    const tokenForOther = await store.authorizeAccess(other.sourceId, providerPermittedBasis());
    const reference = await adapter.toCanonicalReference(youtubeMetadata());

    await expect(adapter.retrieveBytes(reference, tokenForOther)).rejects.toMatchObject({
      code: "corpus.access-invalid",
    });
  });

  test("acquiring without authorizing is structurally impossible (the state machine refuses)", async () => {
    const store = createCorpusStore();
    const registered = await store.registerReference(youtubeMetadata());
    const adapter = createReferenceAdapter({ metadata: [] });

    // The pipeline driver without a basis surfaces the gate's refusal —
    // it never improvises one.
    await expect(
      (async () => {
        const access = await store.authorizeAccess(registered.sourceId);
        const record = await store.get(registered.sourceId);
        const reference = await adapter.toCanonicalReference({
          provider: record.provider,
          providerContentId: record.providerContentId,
          canonicalUrl: record.canonicalUrl,
          ownerRef: record.ownerRef,
          observedAt: record.observedAt,
          availability: record.availability,
          restrictions: [...record.restrictions],
          title: null,
          description: null,
        });
        return adapter.retrieveBytes(reference, access);
      })(),
    ).rejects.toMatchObject({ code: "corpus.rights-basis-required" });
  });
});

describe("the user-fed upload path pays the same law", () => {
  test("ingestUserUpload WITHOUT a declared basis refuses with corpus.rights-basis-required", async () => {
    const store = createCorpusStore();

    let caught: unknown;
    try {
      await store.ingestUserUpload({
        bytes: fixtureBytes("upload-1"),
        metadata: uploadMetadata(),
        // no declaredBasis — the user path shares the one law
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(CorpusRightsBasisRequiredError);
    expect((caught as CorpusRightsBasisRequiredError).code).toBe("corpus.rights-basis-required");
    // Nothing was recorded.
    expect(await store.list()).toEqual([]);
  });

  test("ingestUserUpload WITH a declared basis is born acquired, basis recorded", async () => {
    const store = createCorpusStore();
    const basis = userOwnedBasis();
    const record = await store.ingestUserUpload({
      bytes: fixtureBytes("upload-2"),
      declaredBasis: basis,
      metadata: uploadMetadata(),
    });

    expect(record.state).toBe("acquired");
    expect(record.rightsBasis).toEqual(basis);
    expect(record.acquisitionMethod).toBe("user-upload:v0");
    expect(record.acquiredChecksum).toMatch(/^[0-9a-f]{64}$/);
    expect(record.acquiredAt).not.toBeNull();
    // The bytes are retained for the pipeline (test fixtures this slice).
    expect(await store.getBytes(record.sourceId, "acquired")).toEqual(fixtureBytes("upload-2"));
  });
});

describe("access and transformation are separate rights", () => {
  test("a no-transformation source can be acquired but never normalized", async () => {
    const store = createCorpusStore();
    const bytes = fixtureBytes("no-transform-bytes");
    const metadata = youtubeMetadata({ restrictions: ["no-transformation"] });
    const registered = await store.registerReference(metadata);
    const adapter = createReferenceAdapter({
      metadata: [metadata],
      bytes: { [metadata.canonicalUrl]: bytes },
    });

    // Access: authorized + acquired through the adapter (access is granted by the basis).
    const access = await store.authorizeAccess(registered.sourceId, providerPermittedBasis());
    const reference = await adapter.toCanonicalReference(metadata);
    const retrieved = await adapter.retrieveBytes(reference, access);
    const acquired = await store.recordAcquiredBytes(registered.sourceId, access, retrieved);
    expect(acquired.state).toBe("acquired");

    // Transformation: refused — the restriction is law, the basis cannot lift it.
    let caught: unknown;
    try {
      await store.normalizeSource(registered.sourceId);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(CorpusRestrictionError);
    expect((caught as CorpusRestrictionError).details).toMatchObject({
      restriction: "no-transformation",
      operation: "normalize",
    });
    expect((await store.get(registered.sourceId)).state).toBe("acquired");
  });

  test("isCorpusError classifies the typed family", () => {
    const error = new CorpusRightsBasisRequiredError("test");
    expect(isCorpusError(error)).toBe(true);
    expect(isCorpusError(new Error("plain"))).toBe(false);
  });
});
