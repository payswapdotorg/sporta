/**
 * W504 content-addressed artifact-store tests: the full store contract
 * exercised against BOTH backends through one shared suite, plus on-disk
 * layout/persistence/integrity tests.
 *
 * Shared suite (in-memory + on-disk): content-addressed puts (same content
 * = same sha-256 id), idempotent duplicates (counted, never re-written),
 * byte-identical gets (integrity-verified), listing with metadata in
 * insertion order, bounded size with explicit rejects, deep-clone-on-read
 * and on-write, idempotent deletes, and put-input validation.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { renderAnimeClip } from "@sporta/renderer-anime";
import { TEST_EPOCH_MS } from "@sporta/testing";
import {
  InMemoryArtifactStore,
  ON_DISK_LAYOUT,
  OnDiskArtifactStore,
  SegmentIntegrityError,
  SegmentStoreLimitError,
  SegmentValidationError,
  contentHashOf,
  encodeAnimeClip,
  parseArtifactMetadata,
} from "../src/index";
import type { ArtifactStore, ArtifactStoreLimits, PutArtifactInput } from "../src/index";
import {
  RENDER_ID,
  SESSION_ID,
  buildClipRequest,
  buildFixtureOutput,
  buildFixtureSteps,
} from "./helpers";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/** The canonical encoded fixture segment (deterministic). */
function fixtureSegment(): ReturnType<typeof encodeAnimeClip> {
  return encodeAnimeClip(buildFixtureOutput());
}

/** The put input of the fixture segment under the canonical scope. */
function fixturePut(): PutArtifactInput {
  const segment = fixtureSegment();
  return {
    content: segment.content,
    contentType: segment.contentType,
    metadata: {
      sessionId: SESSION_ID,
      renderId: RENDER_ID,
      segmentId: segment.segmentId,
      snapshotVersion: segment.manifest.sourceManifest.session.snapshotVersion,
      frameCount: segment.manifest.frameCount,
      totalDurationMs: segment.manifest.totalDurationMs,
    },
  };
}

/**
 * A second, genuinely different artifact: the same fixture re-encoded with
 * shifted frame content (player-7 moved +5m in the helpers fixture steps —
 * the same construction the encode tests use for the conflict path).
 */
function secondPut(): PutArtifactInput {
  const shiftedSteps = buildFixtureSteps().map((step) => {
    const clone = structuredClone(step);
    const player7 = clone.snapshot.entities[0]!;
    const slot = player7.state.pitchPosition!;
    slot.value = { x: (slot.value as { x: number; y: number }).x + 5, y: 34 };
    return clone;
  });
  const segment = encodeAnimeClip(renderAnimeClip(buildClipRequest(), shiftedSteps));
  return {
    content: segment.content,
    contentType: segment.contentType,
    metadata: {
      sessionId: SESSION_ID,
      renderId: "r-clip-2",
      segmentId: segment.segmentId,
      snapshotVersion: segment.manifest.sourceManifest.session.snapshotVersion,
      frameCount: segment.manifest.frameCount,
      totalDurationMs: segment.manifest.totalDurationMs,
    },
  };
}

/** A third distinct artifact (player-7 moved +9m — different bytes again). */
function thirdPut(): PutArtifactInput {
  const shiftedSteps = buildFixtureSteps().map((step) => {
    const clone = structuredClone(step);
    const player7 = clone.snapshot.entities[0]!;
    const slot = player7.state.pitchPosition!;
    slot.value = { x: (slot.value as { x: number; y: number }).x + 9, y: 34 };
    return clone;
  });
  const segment = encodeAnimeClip(renderAnimeClip(buildClipRequest(), shiftedSteps));
  return {
    content: segment.content,
    contentType: segment.contentType,
    metadata: {
      sessionId: SESSION_ID,
      renderId: "r-clip-3",
      segmentId: segment.segmentId,
      snapshotVersion: segment.manifest.sourceManifest.session.snapshotVersion,
      frameCount: segment.manifest.frameCount,
      totalDurationMs: segment.manifest.totalDurationMs,
    },
  };
}

// ---------------------------------------------------------------------------
// The shared artifact-store contract suite
// ---------------------------------------------------------------------------

type StoreFactory = (limits?: Partial<ArtifactStoreLimits>) => ArtifactStore;

function artifactContractSuite(makeStore: StoreFactory) {
  describe("content-addressed put + get", () => {
    test("the artifact id IS the sha-256 of the content; get is byte-identical", () => {
      const store = makeStore();
      const put = fixturePut();
      const outcome = store.putArtifact(put);
      expect(outcome.outcome).toBe("stored");
      const artifactId = contentHashOf(put.content);
      expect(outcome.record.artifactId).toBe(artifactId);
      const artifact = store.getArtifact(artifactId);
      expect(artifact).not.toBeNull();
      expect(artifact!.content).toBe(put.content);
      expect(artifact!.byteLength).toBe(new TextEncoder().encode(put.content).length);
      expect(artifact!.contentType).toBe(put.contentType);
      expect(artifact!.metadata).toEqual(put.metadata);
      expect(artifact!.storeSequence).toBe(1);
      expect(artifact!.duplicateCount).toBe(0);
    });

    test("storedAtMs comes from the injected (deterministic) clock", () => {
      const store = makeStore();
      const { record } = store.putArtifact(fixturePut()) as Extract<
        ReturnType<ArtifactStore["putArtifact"]>,
        { outcome: "stored" }
      >;
      expect(record.storedAtMs).toBe(TEST_EPOCH_MS + 1); // first tick
    });

    test("get of an absent id returns null", () => {
      const store = makeStore();
      expect(store.getArtifact("0".repeat(64))).toBeNull();
    });

    test("returned artifacts are deep clones (mutating them never leaks in)", () => {
      const store = makeStore();
      const put = fixturePut();
      store.putArtifact(put);
      const artifact = store.getArtifact(contentHashOf(put.content))!;
      artifact.content = "<svg>hacked</svg>";
      artifact.metadata.frameCount = 99;
      const reread = store.getArtifact(contentHashOf(put.content))!;
      expect(reread.content).toBe(put.content);
      expect(reread.metadata.frameCount).toBe(6);
    });

    test("mutating the put input after putArtifact never leaks in", () => {
      const store = makeStore();
      const put = fixturePut();
      const artifactId = contentHashOf(put.content);
      store.putArtifact(put);
      put.content = "<svg>hacked</svg>";
      put.metadata.frameCount = 99;
      const artifact = store.getArtifact(artifactId)!;
      expect(artifact.content).not.toBe("<svg>hacked</svg>");
      expect(artifact.content).toBe(fixturePut().content);
      expect(artifact.metadata.frameCount).toBe(6);
    });
  });

  describe("idempotent puts (never silent, never re-written)", () => {
    test("same content (any scope metadata) → same id, counted duplicate", () => {
      const store = makeStore();
      const put = fixturePut();
      const first = store.putArtifact(put);
      expect(first.outcome).toBe("stored");
      // The same content under a DIFFERENT scope: still the same artifact id
      // (content addressing) — counted duplicate, nothing re-stored.
      const second = store.putArtifact({
        ...put,
        metadata: { ...put.metadata, renderId: "r-other" },
      });
      expect(second.outcome).toBe("duplicate");
      if (second.outcome === "duplicate") {
        expect(second.duplicateCount).toBe(1);
        expect(second.record.artifactId).toBe(first.record.artifactId);
      }
      const third = store.putArtifact(put);
      expect(third.outcome).toBe("duplicate");
      const stats = store.stats();
      expect(stats.artifacts).toBe(1); // never re-stored
      expect(stats.totalBytes).toBe(new TextEncoder().encode(put.content).length);
      expect(stats.duplicatePuts).toBe(2); // but counted
    });

    test("different content → different id, both stored and listed", () => {
      const store = makeStore();
      const a = fixturePut();
      const b = secondPut();
      expect(a.content).not.toBe(b.content);
      const first = store.putArtifact(a);
      const second = store.putArtifact(b);
      expect(first.record.artifactId).not.toBe(second.record.artifactId);
      expect(store.stats().artifacts).toBe(2);
      const listed = store.listArtifacts();
      expect(listed).toHaveLength(2);
      expect(new Set(listed.map((entry) => entry.artifactId)).size).toBe(2);
    });
  });

  describe("listing with metadata", () => {
    test("insertion order + full metadata", () => {
      const store = makeStore();
      const a = fixturePut();
      const b = secondPut();
      store.putArtifact(a);
      store.putArtifact(b);
      const listed = store.listArtifacts();
      expect(listed.map((entry) => entry.artifactId)).toEqual([
        contentHashOf(a.content),
        contentHashOf(b.content),
      ]);
      expect(listed[0]!.metadata).toEqual(a.metadata);
      expect(listed[1]!.metadata).toEqual(b.metadata);
    });
  });

  describe("bounded size — explicit reject, never silent eviction", () => {
    test("maxArtifacts: the (n+1)-th distinct artifact is rejected, nothing evicted", () => {
      const store = makeStore({ maxArtifacts: 1 });
      store.putArtifact(fixturePut());
      expect(() => store.putArtifact(secondPut())).toThrow(SegmentStoreLimitError);
      expect(store.stats().artifacts).toBe(1);
    });

    test("maxArtifactBytes: an oversized single artifact is rejected", () => {
      const store = makeStore({ maxArtifactBytes: 8 });
      try {
        store.putArtifact(fixturePut());
        expect.unreachable();
      } catch (err) {
        expect(err instanceof SegmentStoreLimitError).toBe(true);
        if (err instanceof SegmentStoreLimitError) {
          expect(err.failureClass).toBe("resource-limit");
          expect(err.details.limit).toBe("maxArtifactBytes");
        }
      }
      expect(store.stats().artifacts).toBe(0);
    });

    test("maxTotalBytes: the put that would exceed the total is rejected", () => {
      const put = fixturePut();
      const store = makeStore({ maxTotalBytes: put.content.length - 1 });
      expect(() => store.putArtifact(put)).toThrow(SegmentStoreLimitError);
      expect(store.stats().artifacts).toBe(0);
    });

    test("duplicate puts never hit the limits (a no-op stores nothing)", () => {
      const store = makeStore({ maxArtifacts: 1 });
      store.putArtifact(fixturePut());
      const again = store.putArtifact(fixturePut());
      expect(again.outcome).toBe("duplicate");
    });
  });

  describe("put-input validation (fail-loud)", () => {
    test("empty content / empty contentType / bad metadata are rejected", () => {
      const store = makeStore();
      const put = fixturePut();
      expect(() => store.putArtifact({ ...put, content: "" })).toThrow(SegmentValidationError);
      expect(() => store.putArtifact({ ...put, contentType: "" })).toThrow(SegmentValidationError);
      expect(() =>
        store.putArtifact({ ...put, metadata: { ...put.metadata, sessionId: "" } }),
      ).toThrow(SegmentValidationError);
      expect(() =>
        store.putArtifact({ ...put, metadata: { ...put.metadata, frameCount: 0 } }),
      ).toThrow(SegmentValidationError);
      expect(() =>
        store.putArtifact({ ...put, metadata: { ...put.metadata, snapshotVersion: -1 } }),
      ).toThrow(SegmentValidationError);
      expect(() =>
        store.putArtifact({ ...put, metadata: { ...put.metadata, totalDurationMs: 0 } }),
      ).toThrow(SegmentValidationError);
      expect(store.stats().artifacts).toBe(0);
    });

    test("non-object input is rejected", () => {
      const store = makeStore();
      expect(() => store.putArtifact(null as unknown as PutArtifactInput)).toThrow(
        SegmentValidationError,
      );
    });
  });

  describe("deletion + stats", () => {
    test("deleteArtifact removes the artifact and is idempotent", () => {
      const store = makeStore();
      const put = fixturePut();
      store.putArtifact(put);
      const artifactId = contentHashOf(put.content);
      store.deleteArtifact(artifactId);
      expect(store.getArtifact(artifactId)).toBeNull();
      expect(() => store.deleteArtifact(artifactId)).not.toThrow();
      expect(() => store.deleteArtifact("0".repeat(64))).not.toThrow();
      expect(store.stats().artifacts).toBe(0);
      expect(store.stats().totalBytes).toBe(0);
    });

    test("an empty artifactId is rejected (never a wildcard)", () => {
      const store = makeStore();
      expect(() => store.getArtifact("")).toThrow(SegmentValidationError);
      expect(() => store.deleteArtifact("")).toThrow(SegmentValidationError);
    });
  });

  describe("determinism", () => {
    test("two fresh stores fed the same sequence produce deep-equal artifacts", () => {
      const storeA = makeStore();
      const storeB = makeStore();
      const recordA = storeA.putArtifact(fixturePut()).record;
      const recordB = storeB.putArtifact(fixturePut()).record;
      expect(recordA).toEqual(recordB);
      expect(storeA.stats()).toEqual(storeB.stats());
    });
  });
}

// ---------------------------------------------------------------------------
// parseArtifactMetadata unit pins
// ---------------------------------------------------------------------------

describe("parseArtifactMetadata (structural validation)", () => {
  const valid = fixturePut().metadata;

  test("accepts the fixture metadata", () => {
    expect(parseArtifactMetadata(valid).ok).toBe(true);
  });

  test("rejects non-objects and missing/empty fields", () => {
    expect(parseArtifactMetadata(null).ok).toBe(false);
    expect(parseArtifactMetadata("nope").ok).toBe(false);
    expect(parseArtifactMetadata({ ...valid, renderId: "" }).ok).toBe(false);
    expect(parseArtifactMetadata({ ...valid, segmentId: 42 }).ok).toBe(false);
    expect(parseArtifactMetadata({ ...valid, frameCount: 1.5 }).ok).toBe(false);
    expect(parseArtifactMetadata({ ...valid, snapshotVersion: "1" }).ok).toBe(false);
    expect(parseArtifactMetadata({ ...valid, totalDurationMs: Number.NaN }).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// In-memory implementation
// ---------------------------------------------------------------------------

describe("InMemoryArtifactStore", () => {
  artifactContractSuite((limits) => new InMemoryArtifactStore({ limits }));
});

// ---------------------------------------------------------------------------
// On-disk implementation
// ---------------------------------------------------------------------------

describe("OnDiskArtifactStore", () => {
  let tempDir: string;
  let dirSeq = 0;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "sporta-artifacts-test-"));
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  /** Each contract test gets its own root directory for isolation. */
  function diskFactory(limits?: Partial<ArtifactStoreLimits>): OnDiskArtifactStore {
    return new OnDiskArtifactStore(join(tempDir, `root-${dirSeq++}`), { limits });
  }

  artifactContractSuite((limits) => diskFactory(limits));

  describe("deterministic paths (declared root)", () => {
    test("the document is at <root>/objects/<artifactId>, the sidecar at <root>/meta/<artifactId>.json", () => {
      const root = join(tempDir, "layout-root");
      const store = new OnDiskArtifactStore(root);
      const put = fixturePut();
      store.putArtifact(put);
      const artifactId = contentHashOf(put.content);
      const objectPath = ON_DISK_LAYOUT.objectPath(root, artifactId);
      const metaPath = ON_DISK_LAYOUT.metaPath(root, artifactId);
      expect(existsSync(objectPath)).toBe(true);
      expect(existsSync(metaPath)).toBe(true);
      // The document is the verbatim content.
      expect(readFileSync(objectPath, "utf8")).toBe(put.content);
      // The sidecar is deterministic JSON carrying the metadata.
      const sidecar = JSON.parse(readFileSync(metaPath, "utf8")) as Record<string, unknown>;
      expect(sidecar.artifactId).toBe(artifactId);
      expect(sidecar.contentType).toBe(put.contentType);
      expect(sidecar.metadata).toEqual(put.metadata);
      expect(sidecar.storeSequence).toBe(1);
      expect(sidecar.duplicateCount).toBe(0);
    });

    test("two fresh roots fed the same put write byte-identical files", () => {
      const rootA = join(tempDir, "det-a");
      const rootB = join(tempDir, "det-b");
      const put = fixturePut();
      new OnDiskArtifactStore(rootA).putArtifact(put);
      new OnDiskArtifactStore(rootB).putArtifact(put);
      const artifactId = contentHashOf(put.content);
      for (const path of [
        ON_DISK_LAYOUT.objectPath(rootA, artifactId),
        ON_DISK_LAYOUT.metaPath(rootA, artifactId),
      ]) {
        const twin = path.replace("det-a", "det-b");
        expect(readFileSync(path, "utf8")).toBe(readFileSync(twin, "utf8"));
      }
    });
  });

  describe("durable persistence", () => {
    test("artifacts survive reopen (deep-equal, verbatim content + metadata)", () => {
      const root = join(tempDir, "reopen-root");
      const store = new OnDiskArtifactStore(root);
      const put = fixturePut();
      const record = store.putArtifact(put).record;

      const reopened = new OnDiskArtifactStore(root);
      const artifact = reopened.getArtifact(record.artifactId);
      expect(artifact).toEqual(record);
      expect(artifact!.content).toBe(put.content);
    });

    test("duplicate counts persist and continue after reopen", () => {
      const root = join(tempDir, "duplicates-root");
      const store = new OnDiskArtifactStore(root);
      const put = fixturePut();
      store.putArtifact(put);
      store.putArtifact(put);
      expect(store.stats().duplicatePuts).toBe(1);

      const reopened = new OnDiskArtifactStore(root);
      expect(reopened.stats().duplicatePuts).toBe(1);
      const again = reopened.putArtifact(put);
      expect(again.outcome).toBe("duplicate");
      if (again.outcome === "duplicate") expect(again.duplicateCount).toBe(2);
      expect(reopened.stats().duplicatePuts).toBe(2);
    });

    test("store_sequence continues after reopen (insertion order preserved)", () => {
      const root = join(tempDir, "sequence-root");
      const a = fixturePut();
      const b = secondPut();
      const store = new OnDiskArtifactStore(root);
      const first = store.putArtifact(a).record;
      const second = store.putArtifact(b).record;
      expect(first.storeSequence).toBe(1);
      expect(second.storeSequence).toBe(2);

      const reopened = new OnDiskArtifactStore(root);
      const third = reopened.putArtifact(thirdPut()).record;
      expect(third.storeSequence).toBe(3); // continued, not restarted
      const listed = reopened.listArtifacts();
      expect(listed.map((entry) => entry.artifactId)).toEqual([
        first.artifactId,
        second.artifactId,
        third.artifactId,
      ]);
    });
  });

  describe("integrity verification on read (corruption fails loud)", () => {
    test("content drift (hash mismatch) → SegmentIntegrityError", () => {
      const root = join(tempDir, "corrupt-content-root");
      const store = new OnDiskArtifactStore(root);
      const put = fixturePut();
      store.putArtifact(put);
      const artifactId = contentHashOf(put.content);
      writeFileSync(ON_DISK_LAYOUT.objectPath(root, artifactId), `${put.content} `);
      expect(() => store.getArtifact(artifactId)).toThrow(SegmentIntegrityError);
    });

    test("byte-length drift (sidecar lie) → SegmentIntegrityError", () => {
      const root = join(tempDir, "corrupt-bytes-root");
      const store = new OnDiskArtifactStore(root);
      const put = fixturePut();
      store.putArtifact(put);
      const artifactId = contentHashOf(put.content);
      const metaPath = ON_DISK_LAYOUT.metaPath(root, artifactId);
      const sidecar = JSON.parse(readFileSync(metaPath, "utf8")) as Record<string, unknown>;
      writeFileSync(
        metaPath,
        JSON.stringify({ ...sidecar, byteLength: (sidecar.byteLength as number) + 1 }),
      );
      expect(() => store.getArtifact(artifactId)).toThrow(SegmentIntegrityError);
    });

    test("unparsable / mismatched sidecar → SegmentIntegrityError", () => {
      const root = join(tempDir, "corrupt-json-root");
      const store = new OnDiskArtifactStore(root);
      const put = fixturePut();
      store.putArtifact(put);
      const artifactId = contentHashOf(put.content);
      const metaPath = ON_DISK_LAYOUT.metaPath(root, artifactId);
      writeFileSync(metaPath, "{not-valid-json");
      expect(() => store.getArtifact(artifactId)).toThrow(SegmentIntegrityError);
      expect(() => store.listArtifacts()).toThrow(SegmentIntegrityError);
    });

    test("an unindexed document file (no sidecar) is invisible, never listed or served", () => {
      const root = join(tempDir, "orphan-root");
      const store = new OnDiskArtifactStore(root);
      const put = fixturePut();
      store.putArtifact(put);
      const artifactId = contentHashOf(put.content);
      // A second document WITHOUT a sidecar (simulating an interrupted put):
      const orphanId = "1".repeat(64);
      writeFileSync(ON_DISK_LAYOUT.objectPath(root, orphanId), put.content);
      expect(store.getArtifact(orphanId)).toBeNull();
      expect(store.listArtifacts().map((entry) => entry.artifactId)).toEqual([artifactId]);
      expect(store.stats().artifacts).toBe(1);
    });

    test("an indexed-but-missing document fails with a TYPED error (never a raw filesystem error)", () => {
      const root = join(tempDir, "missing-document-root");
      const store = new OnDiskArtifactStore(root);
      const put = fixturePut();
      store.putArtifact(put);
      const artifactId = contentHashOf(put.content);
      // The sidecar stays, the document disappears (external tampering):
      rmSync(ON_DISK_LAYOUT.objectPath(root, artifactId));
      try {
        store.getArtifact(artifactId);
        expect.unreachable();
      } catch (err) {
        expect(err instanceof SegmentIntegrityError).toBe(true);
        if (err instanceof SegmentIntegrityError) {
          expect(err.failureClass).toBe("internal");
          expect(err.message).toContain("document is missing");
        }
      }
      // The duplicate-put path fails identically (it re-reads the stored
      // document to compare content — also typed, never a raw ENOENT).
      try {
        store.putArtifact(put);
        expect.unreachable();
      } catch (err) {
        expect(err instanceof SegmentIntegrityError).toBe(true);
      }
    });
  });
});
