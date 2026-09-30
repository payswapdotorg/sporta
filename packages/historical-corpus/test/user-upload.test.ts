/**
 * REL-009 user-fed upload tests: the same normalization, provenance and
 * benchmark pipeline as provider-acquired sources (contract §User-fed
 * historical matches) — bytes are test fixtures.
 */
import { describe, expect, test } from "bun:test";
import { createBenchmarkFixture, createCorpusStore } from "../src";
import { sha256HexBytes } from "../src";
import {
  fixtureBytes,
  uploadMetadata,
  upperCaseNormalizer,
  userOwnedBasis,
  youtubeMetadata,
} from "./fixtures";

describe("the user-fed upload path", () => {
  test("upload -> normalize with checksums (a real recorded transformation)", async () => {
    const store = createCorpusStore();
    const bytes = fixtureBytes("user-normalize");
    const acquired = await store.ingestUserUpload({
      bytes,
      declaredBasis: userOwnedBasis(),
      metadata: uploadMetadata(),
    });

    const normalized = await store.normalizeSource(acquired.sourceId, {
      normalizer: upperCaseNormalizer,
    });
    expect(normalized.state).toBe("normalized");
    expect(normalized.normalized?.pipeline).toBe("upper-case");
    expect(normalized.normalized?.pipelineVersion).toBe("1");
    expect(normalized.normalized?.normalizedChecksum).toBe(await sha256HexBytes(upperCase(bytes)));
    expect(await store.getBytes(acquired.sourceId, "normalized")).toEqual(upperCase(bytes));
    // The acquired checksum is untouched by normalization.
    expect(normalized.acquiredChecksum).toBe(await sha256HexBytes(bytes));
  });

  test("upload -> normalize -> benchmark with a content-addressed fixture", async () => {
    const store = createCorpusStore();
    const bytes = fixtureBytes("user-benchmark");
    const acquired = await store.ingestUserUpload({
      bytes,
      declaredBasis: userOwnedBasis(),
      metadata: uploadMetadata(),
    });
    const normalized = await store.normalizeSource(acquired.sourceId);

    const fixture = await createBenchmarkFixture({
      sourceRef: {
        sourceId: acquired.sourceId,
        provider: acquired.provider,
        providerContentId: null,
        canonicalUrl: acquired.canonicalUrl,
      },
      acquiredByteChecksum: acquired.acquiredChecksum,
      normalizedByteChecksum: normalized.normalized?.normalizedChecksum ?? "",
      timeWindow: { startMs: 1_700_000_100_000, endMs: 1_700_000_160_000 },
      versions: [{ name: "optical-flow", kind: "feature", version: "1.2.0" }],
    });
    const benchmarked = await store.markBenchmarked(acquired.sourceId, fixture);
    expect(benchmarked.state).toBe("benchmarked");
    expect(benchmarked.benchmarkedWith).toBe(fixture.fixtureId);
  });

  test("uploads and provider references coexist in one corpus", async () => {
    const store = createCorpusStore();
    const reference = await store.registerReference(youtubeMetadata());
    const upload = await store.ingestUserUpload({
      bytes: fixtureBytes("coexist"),
      declaredBasis: userOwnedBasis(),
      metadata: uploadMetadata(),
    });
    expect((await store.list()).map((record) => record.sourceId)).toEqual([
      reference.sourceId,
      upload.sourceId,
    ]);
    expect(
      (await store.list({ provider: "user-upload" })).map((record) => record.sourceId),
    ).toEqual([upload.sourceId]);
  });

  test("a reference-only restricted upload carries the restriction as recorded data (access already legitimately occurred)", async () => {
    const store = createCorpusStore();
    const acquired = await store.ingestUserUpload({
      bytes: fixtureBytes("ref-only-upload"),
      declaredBasis: userOwnedBasis(),
      metadata: uploadMetadata({ restrictions: ["reference-only"] }),
    });
    // The upload itself succeeded (bytes + declared basis arrived together
    // from the owner). `reference-only` gates ACCESS to provider bytes — for
    // an upload the access already legitimately happened, so the
    // restriction rides the record as data; only `no-transformation`
    // would refuse the normalization step.
    const normalized = await store.normalizeSource(acquired.sourceId);
    expect(normalized.state).toBe("normalized");
    expect(normalized.restrictions).toEqual(["reference-only"]);
  });
});

/** The uppercasing transformation, as raw bytes. */
function upperCase(bytes: Uint8Array): Uint8Array {
  const upper = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i += 1) {
    const byte = bytes[i] ?? 0;
    upper[i] = byte >= 97 && byte <= 122 ? byte - 32 : byte;
  }
  return upper;
}
