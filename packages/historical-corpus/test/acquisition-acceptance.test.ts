/**
 * REL-026 — the historical acquisition ACCEPTANCE scenario: a real journey
 * "reference-only discovery -> rights declaration -> authorized acquisition
 * -> corpus registration, with the digest + basis queryable afterwards"
 * (the Worker B packet's own acceptance wording), driven end-to-end through
 * the journey driver over the REAL store + adapter + pipeline + registrar.
 *
 * The provider rule is exercised as the journey's spine: discovery is
 * metadata-only (the pre-authorization probe refuses and is RECORDED), the
 * bytes are only fetched through the gate-minted token against the declared
 * basis, and the registered chain answers the acceptance questions — which
 * basis, which digest, which benchmark binding — long after the fact.
 *
 * Gate REL-A1's item sweep rides the same file: the user-fed upload path
 * (bytes + declared basis), the source-URL reference path, byte acquisition
 * only when permitted, normalization, and benchmark window/feature
 * registration.
 */
import { describe, expect, test } from "bun:test";
import {
  createBenchmarkRegistrar,
  createCorpusStore,
  createReferenceAdapter,
  createSequentialIdSource,
  provenanceOf,
  runAcquisitionJourney,
  sha256HexBytes,
} from "../src";
import {
  fixtureBytes,
  providerPermittedBasis,
  uploadMetadata,
  userOwnedBasis,
  youtubeMetadata,
} from "./fixtures";

/** A YouTube-like fixture adapter with REAL fixture bytes behind its urls. */
function journeyAdapter() {
  const metadata = [
    youtubeMetadata(),
    youtubeMetadata({
      providerContentId: "vid-002",
      canonicalUrl: "https://www.youtube.com/watch?v=vid-002",
      title: "Full Match — Week 13",
    }),
  ];
  const bytes = {
    [metadata[0]!.canonicalUrl]: fixtureBytes("rel026-journey"),
    [metadata[1]!.canonicalUrl]: fixtureBytes("rel026-journey-2"),
  };
  return createReferenceAdapter({ metadata, bytes }, { provider: "youtube-fixture" });
}

const WINDOW = { startMs: 1_700_000_000_000, endMs: 1_700_003_600_000 };
const VERSIONS = [
  { name: "optical-flow", kind: "feature" as const, version: "1.2.0" },
  { name: "h264-decoder", kind: "decoder" as const, version: "0.9.1" },
];

describe("the acceptance journey (reference-only discovery -> declaration -> acquisition -> registration)", () => {
  test("every stage leaves evidence and the digest + basis stay queryable afterwards", async () => {
    const adapter = journeyAdapter();
    const bytes = fixtureBytes("rel026-journey");
    const basis = providerPermittedBasis();

    const outcome = await runAcquisitionJourney({
      adapter,
      declaredBasis: basis,
      benchmark: { timeWindow: WINDOW, versions: VERSIONS },
    });

    // -- Stage 1: reference-only discovery -----------------------------------
    const { discovery } = outcome;
    expect(discovery.discovered).toHaveLength(2); // metadata only, no bytes
    expect(discovery.references.map((record) => record.state)).toEqual([
      "referenced",
      "referenced",
    ]);
    // The pre-authorization probe refused typed AND was recorded.
    expect(discovery.preAuthorizationRefusal.code).toBe("corpus.rights-basis-required");
    expect(discovery.preAuthorizationRefusal.failureClass).toBe("rights");
    expect(discovery.preAuthorizationRefusal.operation).toBe("pre-authorization-probe");
    expect(discovery.preAuthorizationRefusal.subject).toMatchObject({
      sourceId: outcome.sourceId,
    });
    // Fail-closed at probe time: the refusal left the reference untouched
    // (observed immediately after the probe, inside the journey) — no
    // basis, no digest, no bytes (discovery fetched nothing).
    expect(discovery.postProbeState).toEqual({
      state: "referenced",
      rightsBasis: null,
      acquiredChecksum: null,
    });

    // -- Stage 2: the declaration rides the acquisition ----------------------
    expect(outcome.declaration.basis).toEqual(basis);

    // -- Stage 3: authorized acquisition (digest + method recorded) ----------
    const { acquisition } = outcome;
    expect(acquisition.record.state).toBe("acquired");
    expect(acquisition.acquiredChecksum).toBe(await sha256HexBytes(bytes));
    expect(acquisition.record.acquisitionMethod).toBe("youtube-fixture:v0");
    expect(acquisition.record.rightsBasis).toEqual(basis);
    expect(await outcome.store.getBytes(outcome.sourceId, "acquired")).toEqual(bytes);

    // -- Stage 4: corpus registration (benchmarked + queryable) --------------
    const { registration } = outcome;
    expect(registration.record.state).toBe("benchmarked");
    expect(registration.record.benchmarkedWith).toBe(registration.registrationId);

    // THE QUERYABLE CHAIN (afterwards, through the provenance view):
    const chain = outcome.provenance;
    expect(chain.sourceId).toBe(outcome.sourceId);
    expect(chain.canonicalUrl).toBe(youtubeMetadata().canonicalUrl);
    expect(chain.state).toBe("benchmarked");
    // ... the basis leg: the full declaration + its audit digest.
    expect(chain.basis).not.toBeNull();
    expect(chain.basis?.basisType).toBe("provider-permitted-terms");
    expect(chain.basis?.grantRef).toBe(basis.grantRef);
    expect(chain.basis?.scope).toBe(basis.scope);
    expect(chain.basis?.declaredBy).toBe(basis.declaredBy);
    expect(chain.basis?.digest).toMatch(/^[0-9a-f]{64}$/);
    // ... the digest leg: the checksum of the bytes actually acquired.
    expect(chain.acquiredChecksum).toBe(await sha256HexBytes(bytes));
    expect(chain.acquisitionMethod).toBe("youtube-fixture:v0");
    // ... the normalization + benchmark legs.
    expect(chain.normalization).toMatchObject({ pipeline: "identity", pipelineVersion: "0" });
    expect(chain.benchmarkedWith).toBe(registration.registrationId);

    // The chain re-derives from the record at any later time (queryable
    // afterwards — not a snapshot baked into the journey).
    const rederived = await provenanceOf(await outcome.store.get(outcome.sourceId));
    expect(rederived).toEqual(chain);

    // The registrar answers the reproducibility queries afterwards.
    const byId = await outcome.registrar.get(registration.registrationId);
    expect(byId.source.sourceId).toBe(outcome.sourceId);
    expect(byId.fixture.acquiredByteChecksum).toBe(chain.acquiredChecksum);
    expect(
      (await outcome.registrar.list({ sourceId: outcome.sourceId })).map(
        (entry) => entry.registrationId,
      ),
    ).toEqual([registration.registrationId]);
    expect(
      (await outcome.registrar.list({ canonicalUrl: outcome.canonicalUrl })).map(
        (entry) => entry.registrationId,
      ),
    ).toEqual([registration.registrationId]);
    expect(
      await outcome.registrar.list({
        overlappingWindow: { startMs: WINDOW.endMs, endMs: WINDOW.endMs + 1 },
      }),
    ).toHaveLength(1); // inclusive-edge overlap
    expect(
      await outcome.registrar.list({ component: { name: "optical-flow", version: "1.2.0" } }),
    ).toHaveLength(1);
    expect(
      await outcome.registrar.list({ component: { name: "optical-flow", version: "9.9.9" } }),
    ).toHaveLength(0);

    // The happy path recorded exactly one refusal: the probe. No silent drops.
    expect(outcome.ledger.count()).toBe(1);
    expect(outcome.ledger.list()[0]?.code).toBe("corpus.rights-basis-required");
  });

  test("a journey over a source whose bytes are unavailable refuses typed (never fabricated)", async () => {
    const metadata = [youtubeMetadata()];
    // The adapter has NO bytes behind the url — availability is honest.
    const adapter = createReferenceAdapter({ metadata }, { provider: "youtube-fixture" });
    let caught: unknown;
    try {
      await runAcquisitionJourney({
        adapter,
        declaredBasis: providerPermittedBasis(),
        benchmark: { timeWindow: WINDOW, versions: VERSIONS },
      });
    } catch (error) {
      caught = error;
    }
    expect((caught as { code?: string })?.code).toBe("corpus.bytes-unavailable");
  });
});

describe("the user-fed upload path completes the same acceptance shape (REL-A1)", () => {
  test("upload + declared basis -> acquired -> normalized -> benchmarked, chain queryable", async () => {
    const store = createCorpusStore({ idSource: createSequentialIdSource("upload-src") });
    const registrar = createBenchmarkRegistrar(store);
    const bytes = fixtureBytes("rel026-upload");
    const basis = userOwnedBasis();

    // 1. upload the permitted historical clip WITH the declared basis.
    const uploaded = await store.ingestUserUpload({
      bytes,
      declaredBasis: basis,
      metadata: uploadMetadata(),
    });
    expect(uploaded.state).toBe("acquired"); // born acquired: bytes + basis arrived together
    expect(uploaded.acquiredChecksum).toBe(await sha256HexBytes(bytes));

    // 2. normalize (the same pipeline as provider-acquired sources).
    const normalized = await store.normalizeSource(uploaded.sourceId);
    expect(normalized.state).toBe("normalized");
    expect(normalized.normalized?.pipeline).toBe("identity");

    // 3. register the benchmark window + versions (+ a feature bundle).
    const registration = await registrar.register({
      sourceId: uploaded.sourceId,
      timeWindow: WINDOW,
      versions: VERSIONS,
      featureBundles: [
        {
          bundleId: "bundle-rel026",
          kind: "optical-flow-vectors",
          producer: "feature-pipeline",
          producerVersion: "1.0.0",
          artifactRef: "artifact://features/bundle-rel026",
        },
      ],
    });
    const benchmarked = await store.get(uploaded.sourceId);
    expect(benchmarked.state).toBe("benchmarked");
    expect(benchmarked.featureBundles.map((bundle) => bundle.bundleId)).toEqual(["bundle-rel026"]);

    // 4. the chain answers afterwards: basis + digest + binding.
    const chain = await provenanceOf(benchmarked);
    expect(chain.basis?.basisType).toBe("user-declared-ownership");
    expect(chain.basis?.grantRef).toBe(basis.grantRef);
    expect(chain.acquiredChecksum).toBe(await sha256HexBytes(bytes));
    expect(chain.acquisitionMethod).toBe("user-upload:v0");
    expect(chain.benchmarkedWith).toBe(registration.registrationId);
    expect(await registrar.get(registration.registrationId)).toMatchObject({
      registrationId: registration.registrationId,
    });
  });

  test("a reference-only URL is indexed and discoverable without ever acquiring bytes (the class-5 law)", async () => {
    const store = createCorpusStore();
    const metadata = youtubeMetadata({
      providerContentId: "vid-ref-5",
      canonicalUrl: "https://www.youtube.com/watch?v=vid-ref-5",
      restrictions: ["reference-only"],
    });
    const registered = await store.registerReference(metadata);
    expect(registered.state).toBe("referenced");
    // Indexed + discoverable...
    expect(
      (await store.searchMetadata({ canonicalUrl: metadata.canonicalUrl })).map(
        (record) => record.sourceId,
      ),
    ).toEqual([registered.sourceId]);
    // ...but NO basis can ever authorize bytes for it.
    await expect(
      store.authorizeAccess(registered.sourceId, providerPermittedBasis()),
    ).rejects.toMatchObject({ code: "corpus.restriction-forbidden" });
    // And the chain says so honestly: null basis, null digest.
    const chain = await provenanceOf(await store.get(registered.sourceId));
    expect(chain.basis).toBeNull();
    expect(chain.acquiredChecksum).toBeNull();
    expect(chain.state).toBe("referenced");
  });
});
