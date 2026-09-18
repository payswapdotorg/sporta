/**
 * The manifest + store tests: the container-manifest shape (identity,
 * per-frame timing, integrity, the verbatim renderer manifest), the
 * fail-closed manifest validation, and the W504 store registration
 * (idempotent puts, counted duplicates, integrity-verified reads, the
 * honest base64 representation).
 */
import { describe, expect, test } from "bun:test";
import { InMemoryArtifactStore, OnDiskArtifactStore } from "@sporta/output-pipeline";
import { TEST_EPOCH_MS } from "@sporta/testing";
import {
  EncodingError,
  ENCODED_ARTIFACT_CONTENT_TYPE,
  FixtureFrameEncoder,
  buildEncodedArtifact,
  encodedIdentityOf,
  frameTimingsOf,
  loadEncodedArtifact,
  registerEncodedArtifact,
  sha256Of,
  validateEncodedManifest,
} from "../src/index";
import type { EncodedArtifact } from "../src/index";
import {
  FRAME_FPS,
  FRAME_HEIGHT,
  FRAME_WIDTH,
  SESSION_ID,
  cleanDir,
  syntheticFrames,
  tempDir,
} from "./helpers";

const encoder = new FixtureFrameEncoder();

/** A canonical fixture-tier artifact (deterministic; store-agnostic). */
function canonicalArtifact(): EncodedArtifact {
  return buildEncodedArtifact(
    encoder.encode({
      source: {
        kind: "rgb24-frames",
        frames: syntheticFrames(6),
        width: FRAME_WIDTH,
        height: FRAME_HEIGHT,
      },
      fps: FRAME_FPS,
      origin: { rendererId: "test-renderer", rendererVersion: "0.1.0", bridge: "raw-frames" },
    }),
    { rendererId: "test-renderer", rendererVersion: "0.1.0", bridge: "raw-frames" },
    {
      sessionId: SESSION_ID,
      swm: { snapshotVersion: 7, lastEventSequence: 23 },
      rendererManifest: { marker: "verbatim" },
    },
  );
}

describe("buildEncodedArtifact (the container manifest)", () => {
  test("carries the full W504-pattern manifest with per-frame timing", () => {
    const artifact = canonicalArtifact();
    expect(artifact.manifest.schemaVersion).toBe("1.0");
    expect(artifact.manifest.manifestId).toMatch(/^enc-[0-9a-f]{8}$/);
    expect(artifact.manifest.sessionId).toBe(SESSION_ID);
    expect(artifact.manifest.source).toEqual({
      rendererId: "test-renderer",
      rendererVersion: "0.1.0",
    });
    expect(artifact.manifest.swm).toEqual({ snapshotVersion: 7, lastEventSequence: 23 });
    expect(artifact.manifest.geometry).toEqual({
      widthPx: FRAME_WIDTH,
      heightPx: FRAME_HEIGHT,
      fps: FRAME_FPS,
      frameCount: 6,
      durationMs: 240,
    });
    expect(artifact.manifest.frames).toEqual(frameTimingsOf(6, FRAME_FPS));
    expect(artifact.manifest.frames[5]).toEqual({ frameIndex: 5, frameMs: 200 });
    expect(artifact.manifest.contentHash).toBe(artifact.contentHash);
    expect(artifact.manifest.integrity).toEqual({ algorithm: "sha256", verified: true });
    expect(artifact.manifest.rendererManifest).toEqual({ marker: "verbatim" });
  });

  test("the identity-derived manifest id is stable for the same identity, distinct for others", () => {
    const identity = encodedIdentityOf({
      sessionId: SESSION_ID,
      origin: { rendererId: "r", rendererVersion: "1", bridge: "raw-frames" },
      frameCount: 6,
      width: FRAME_WIDTH,
      height: FRAME_HEIGHT,
      fps: FRAME_FPS,
    });
    const same = encodedIdentityOf({
      sessionId: SESSION_ID,
      origin: { rendererId: "r", rendererVersion: "1", bridge: "raw-frames" },
      frameCount: 6,
      width: FRAME_WIDTH,
      height: FRAME_HEIGHT,
      fps: FRAME_FPS,
    });
    const other = encodedIdentityOf({
      sessionId: "sess-other",
      origin: { rendererId: "r", rendererVersion: "1", bridge: "raw-frames" },
      frameCount: 6,
      width: FRAME_WIDTH,
      height: FRAME_HEIGHT,
      fps: FRAME_FPS,
    });
    expect(identity).toBe(same);
    expect(identity).not.toBe(other);
  });

  test("the default clock is the deterministic TEST_EPOCH_MS constant (byte-identical builds)", () => {
    expect(canonicalArtifact().manifest.generatedAtMs).toBe(TEST_EPOCH_MS);
    expect(canonicalArtifact().manifest.generatedAtMs).toBe(TEST_EPOCH_MS);
  });

  test("an injected clock is honored (production hosts inject a real one)", () => {
    const artifact = buildEncodedArtifact(
      encoder.encode({
        source: {
          kind: "rgb24-frames",
          frames: syntheticFrames(2),
          width: FRAME_WIDTH,
          height: FRAME_HEIGHT,
        },
        fps: FRAME_FPS,
        origin: { rendererId: "r", rendererVersion: "1", bridge: "raw-frames" },
      }),
      { rendererId: "r", rendererVersion: "1", bridge: "raw-frames" },
      { sessionId: SESSION_ID, nowMs: () => 1_000 },
    );
    expect(artifact.manifest.generatedAtMs).toBe(1_000);
  });

  test("a result whose bytes do not re-hash to its declared hash is refused", () => {
    const result = encoder.encode({
      source: {
        kind: "rgb24-frames",
        frames: syntheticFrames(2),
        width: FRAME_WIDTH,
        height: FRAME_HEIGHT,
      },
      fps: FRAME_FPS,
      origin: { rendererId: "r", rendererVersion: "1", bridge: "raw-frames" },
    });
    const lying = { ...result, contentHash: sha256Of(new Uint8Array([1, 2, 3])) };
    expect(() =>
      buildEncodedArtifact(
        lying,
        { rendererId: "r", rendererVersion: "1", bridge: "raw-frames" },
        { sessionId: SESSION_ID },
      ),
    ).toThrow(EncodingError);
  });
});

describe("validateEncodedManifest (fail-closed)", () => {
  test("the canonical manifest validates", () => {
    expect(validateEncodedManifest(canonicalArtifact().manifest).ok).toBe(true);
  });

  test("each defect class is refused with a path", () => {
    const base = canonicalArtifact().manifest as unknown as Record<string, unknown>;
    const cases: Array<[string, unknown, string]> = [
      ["schemaVersion", "9.9", "manifest.schemaVersion"],
      ["manifestId", "", "manifest.manifestId"],
      ["contentHash", "nothash", "manifest.contentHash"],
      ["bridge", "nope", "manifest.bridge"],
      ["integrity", { algorithm: "md5", verified: true }, "manifest.integrity"],
    ];
    for (const [field, value, expectedPrefix] of cases) {
      const mutated = { ...base, [field]: value };
      const result = validateEncodedManifest(mutated);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.issues.some((issue) => issue.startsWith(expectedPrefix))).toBe(true);
      }
    }
  });

  test("a frames array that disagrees with geometry.frameCount is refused", () => {
    const base = canonicalArtifact().manifest;
    const mutated = { ...base, frames: base.frames.slice(0, 2) };
    expect(validateEncodedManifest(mutated).ok).toBe(false);
  });
});

describe("the W504 store registration (reused, never forked)", () => {
  test("registers + loads back with verified integrity (in-memory)", () => {
    const store = new InMemoryArtifactStore();
    const artifact = canonicalArtifact();
    const registration = registerEncodedArtifact(store, artifact);
    expect(registration.outcome).toBe("stored");
    expect(registration.artifactId).toMatch(/^[0-9a-f]{64}$/);
    const loaded = loadEncodedArtifact(store, registration.artifactId, artifact.contentHash);
    expect(loaded.contentHash).toBe(artifact.contentHash);
    expect(Buffer.compare(Buffer.from(loaded.bytes), Buffer.from(artifact.bytes))).toBe(0);
    expect(loaded.record.contentType).toBe(ENCODED_ARTIFACT_CONTENT_TYPE);
  });

  test("identical puts are IDEMPOTENT with counted duplicates (the store's own semantics)", () => {
    const store = new InMemoryArtifactStore();
    const artifact = canonicalArtifact();
    const first = registerEncodedArtifact(store, artifact);
    const second = registerEncodedArtifact(store, artifact);
    expect(first.outcome).toBe("stored");
    expect(second.outcome).toBe("duplicate");
    expect(second.duplicateCount).toBe(1);
    expect(second.artifactId).toBe(first.artifactId);
  });

  test("the store metadata carries the W504 six-field shape", () => {
    const store = new InMemoryArtifactStore();
    const registration = registerEncodedArtifact(store, canonicalArtifact());
    expect(registration.metadata).toEqual({
      sessionId: SESSION_ID,
      renderId: "test-renderer",
      segmentId: canonicalArtifact().manifest.manifestId,
      snapshotVersion: 7,
      frameCount: 6,
      totalDurationMs: 240,
    });
  });

  test("loads are integrity-verified against the expected hash (a mismatch refuses)", () => {
    const store = new InMemoryArtifactStore();
    const registration = registerEncodedArtifact(store, canonicalArtifact());
    expect(() => loadEncodedArtifact(store, registration.artifactId, "0".repeat(64))).toThrow(
      EncodingError,
    );
  });

  test("an absent artifact loads as a typed refusal", () => {
    const store = new InMemoryArtifactStore();
    expect(() => loadEncodedArtifact(store, "f".repeat(64))).toThrow(EncodingError);
  });

  test("durable registration (on-disk store) survives a fresh instance (reopen)", () => {
    const root = tempDir("sporta-encoding-store-");
    try {
      const artifact = canonicalArtifact();
      const first = registerEncodedArtifact(new OnDiskArtifactStore(root), artifact);
      const reopened = new OnDiskArtifactStore(root);
      const loaded = loadEncodedArtifact(reopened, first.artifactId, artifact.contentHash);
      expect(Buffer.compare(Buffer.from(loaded.bytes), Buffer.from(artifact.bytes))).toBe(0);
      const second = registerEncodedArtifact(reopened, artifact);
      expect(second.outcome).toBe("duplicate");
    } finally {
      cleanDir(root);
    }
  });
});
