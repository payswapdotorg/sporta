import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { manifestProvenanceIssues } from "@sporta/contracts";
import { RendererContractError } from "@sporta/renderer-contract";
import { TacticalArtifactError } from "../src/artifact";
import { createFfmpegH264Codec } from "../src/codec";
import { createTacticalRenderer, type TacticalRenderer } from "../src/plugin";
import type { TacticalVideoCodec } from "../src/codec";
import {
  buildSyntheticTacticalEvents,
  buildSyntheticTacticalSnapshot,
  buildTacticalRenderRequest,
} from "./helpers";

const ffmpegOk = createFfmpegH264Codec() !== null;

let staging: string;
let renderer: TacticalRenderer;

beforeAll(() => {
  staging = mkdtempSync(join(tmpdir(), "tactical-plugin-"));
  renderer = createTacticalRenderer({ stagingDir: staging });
});

afterAll(() => {
  rmSync(staging, { recursive: true, force: true });
});

const snapshot = buildSyntheticTacticalSnapshot();
const events = buildSyntheticTacticalEvents();
const request = () => buildTacticalRenderRequest();

/** A codec stub: fails or returns canned bytes (for the honest-failure paths). */
function stubCodec(behavior: "fail" | "empty"): TacticalVideoCodec {
  return {
    kind: "stub",
    available: () => true,
    version: () => "stub-1",
    encode: () => {
      if (behavior === "fail") {
        throw new Error("stub codec failure");
      }
      return Buffer.alloc(0);
    },
  };
}

/** Counts staged objects under a staging root (0 when the dir is absent). */
function countStagedObjects(root: string): number {
  try {
    return readdirSync(join(root, "objects")).length;
  } catch {
    return 0;
  }
}

describe("createTacticalRenderer construction", () => {
  test("fails loud without a staging dir", () => {
    expect(() => createTacticalRenderer({ stagingDir: "" })).toThrow(RendererContractError);
  });

  test.skipIf(!ffmpegOk)("constructs with the real ffmpeg codec", () => {
    expect(() => createTacticalRenderer({ stagingDir: staging })).not.toThrow();
  });
});

describe("validateRequest gates (R2/R3 + style config)", () => {
  test("accepts the fixture request", () => {
    expect(renderer.validateRequest(request()).ok).toBe(true);
  });

  test("rejects a request targeted at another renderer identity (media-invalid)", () => {
    const verdict = renderer.validateRequest({ ...request(), rendererId: "some.other.renderer" });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.failureClass).toBe("media-invalid");
    }
  });

  test("rejects an off-list output profile (media-invalid)", () => {
    const verdict = renderer.validateRequest({
      ...request(),
      outputProfile: { ...request().outputProfile, codec: "vp9" },
    });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.failureClass).toBe("media-invalid");
    }
  });

  test("rejects a snapshotVersion below the minimum (media-invalid)", () => {
    const verdict = renderer.validateRequest({ ...request(), snapshotVersion: -1 });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.failureClass).toBe("media-invalid");
    }
  });

  test("rejects malformed style configs (media-invalid)", () => {
    const notAnObject = renderer.validateRequest({
      ...request(),
      styleConfig: { ...request().styleConfig, config: "nope" },
    });
    expect(notAnObject.ok).toBe(false);
    const tooShort = renderer.validateRequest({
      ...request(),
      styleConfig: { ...request().styleConfig, config: { durationMs: 10 } },
    });
    expect(tooShort.ok).toBe(false);
  });

  test("capability() is schema-valid, tactical-class, and deep-equal (R1)", () => {
    const a = renderer.capability();
    const b = renderer.capability();
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
    expect(a.rendererClass).toBe("tactical");
    expect(a.requiresSourceFrames).toBe(false);
    expect(a.supportedOutputProfiles.length).toBeGreaterThanOrEqual(1);
  });
});

describe("render over the synthetic-diagnostic SWM (real encode)", () => {
  test.skipIf(!ffmpegOk)(
    "produces a REAL staged MP4 with a contract-valid result + frozen manifest",
    () => {
      const { result, details } = renderer.renderDetailed(request(), { snapshot, events });

      // Contract result honesty.
      expect(result.sessionId).toBe("sess-tactical-synthetic");
      expect(result.rendererId).toBe("tactical.prototype");
      expect(result.provenance).toEqual({ snapshotVersion: 21, lastEventSequence: 25 });
      expect(result.watermarkAfter).toEqual({ watermarkMs: 34_000, sequence: 25 });
      expect(result.outputSegments).toHaveLength(1);
      const segment = result.outputSegments[0]!;
      expect(segment.segmentId).toBe("tac-0");
      expect(segment.startMs).toBe(30_000);
      expect(segment.endMs).toBe(34_000);
      expect(segment.artifactRef).toMatch(/^tactical-artifact:\/\/[0-9a-f]{64}$/);
      expect(result.rendererHealth.degraded).toBe(false);

      // The staged artifact: a real MP4 on disk, content-addressed.
      const artifact = details.artifact;
      expect(artifact.manifest.reality).toBe("tactical");
      expect(artifact.manifest.contentHash).toMatch(/^[0-9a-f]{64}$/);
      expect(artifact.manifest.swm).toEqual({ snapshotVersion: 21, lastEventSequence: 25 });
      expect(artifact.manifest.integrity.verified).toBe(true);
      expect(artifact.manifest.durationMs).toBe(4_000);
      expect(artifact.manifest.audioCodec).toBeNull();
      expect(artifact.manifest.videoCodec).toBe("avc1.42E01E");
      expect(manifestProvenanceIssues(artifact.manifest)).toEqual([]);
      expect(artifact.byteSize).toBeGreaterThan(1000);
      const onDisk = readFileSync(artifact.artifactPath);
      expect(onDisk.length).toBe(artifact.byteSize);
      expect(artifact.contentHash).toBe(
        new Bun.CryptoHasher("sha256").update(onDisk).digest("hex"),
      );

      // The artifact reference in the contract result IS the content address.
      expect(segment.artifactRef.endsWith(artifact.contentHash)).toBe(true);

      // The manifest sidecar parses back through the frozen schema.
      expect(artifact.manifest.artifactId).toMatch(/^tactical-[0-9a-f]{8}$/);
    },
  );

  test.skipIf(!ffmpegOk)(
    "with no events: provenance baseline 0 + snapshot watermark sequence (R5/R6)",
    () => {
      const { result } = renderer.renderDetailed(request(), { snapshot, events: [] });
      expect(result.provenance.lastEventSequence).toBe(0);
      expect(result.watermarkAfter.sequence).toBe(snapshot.watermark.sequence);
      expect(result.watermarkAfter.watermarkMs).toBe(34_000);
    },
  );

  test.skipIf(!ffmpegOk)("simulated degradation is explicit with a reason (R7)", () => {
    const { result } = renderer.renderDetailed(
      {
        ...request(),
        styleConfig: { ...request().styleConfig, config: { simulateDegradation: true } },
      },
      { snapshot, events },
    );
    expect(result.rendererHealth.degraded).toBe(true);
    expect(result.rendererHealth.degradationReason).toBe("simulated-degradation");
  });

  test.skipIf(!ffmpegOk)(
    "the frame accounting is exact: durationMs x fps frames, true duration",
    () => {
      const { details } = renderer.renderDetailed(
        { ...request(), styleConfig: { ...request().styleConfig, config: { durationMs: 1000 } } },
        { snapshot, events },
      );
      expect(details.frameCount).toBe(13); // 1000ms * 12.5fps rounded
      expect(details.durationMs).toBe(1040); // 13 frames at 12.5fps
    },
  );

  test.skipIf(!ffmpegOk)(
    "re-render of the same identity into the same root is an idempotent duplicate",
    () => {
      const first = renderer.renderDetailed(request(), { snapshot, events });
      const second = renderer.renderDetailed(request(), { snapshot, events });
      expect(second.details.artifact.duplicate).toBe(true);
      expect(second.details.artifact.contentHash).toBe(first.details.artifact.contentHash);
      expect(second.details.artifact.artifactPath).toBe(first.details.artifact.artifactPath);
    },
  );

  test("render re-runs the gates in defense in depth (throws, never half-renders)", () => {
    expect(() =>
      renderer.render(
        { ...request(), outputProfile: { ...request().outputProfile, codec: "vp9" } },
        { snapshot, events },
      ),
    ).toThrow(RendererContractError);
  });

  test("render refuses after dispose (R4, internal)", () => {
    const disposed = createTacticalRenderer({ stagingDir: staging });
    disposed.dispose();
    expect(() => disposed.render(request(), { snapshot, events })).toThrow(RendererContractError);
    // idempotent dispose
    expect(() => disposed.dispose()).not.toThrow();
  });
});

describe("honest encode failures (never fabricated video)", () => {
  test("a failing codec surfaces as a typed error, no artifact is staged", () => {
    const failingStaging = mkdtempSync(join(tmpdir(), "tactical-fail-"));
    try {
      const failing = createTacticalRenderer({
        stagingDir: failingStaging,
        codec: stubCodec("fail"),
      });
      expect(() => failing.render(request(), { snapshot, events })).toThrow(/stub codec failure/);
      expect(countStagedObjects(failingStaging)).toBe(0);
    } finally {
      rmSync(failingStaging, { recursive: true, force: true });
    }
  });

  test("an empty codec result is refused (no empty artifacts)", () => {
    const emptyStaging = mkdtempSync(join(tmpdir(), "tactical-empty-"));
    try {
      const empty = createTacticalRenderer({ stagingDir: emptyStaging, codec: stubCodec("empty") });
      expect(() => empty.render(request(), { snapshot, events })).toThrow(TacticalArtifactError);
      expect(countStagedObjects(emptyStaging)).toBe(0);
    } finally {
      rmSync(emptyStaging, { recursive: true, force: true });
    }
  });

  test("a construction without a working codec fails loud (no half-plugin)", () => {
    expect(() =>
      createTacticalRenderer({
        stagingDir: staging,
        codec: {
          kind: "unavailable",
          available: () => false,
          version: () => null,
          encode: () => {
            throw new Error("unreachable");
          },
        },
      }),
    ).toThrow(/requires a working video encoder/);
  });
});

describe("the artifact staging store (W504 conventions)", () => {
  test.skipIf(!ffmpegOk)("manifest sidecars read back through the frozen schema", () => {
    const { details } = renderer.renderDetailed(request(), { snapshot, events });
    const sidecarText = readFileSync(details.artifact.manifestPath, "utf8");
    const parsed = JSON.parse(sidecarText) as Record<string, unknown>;
    expect(parsed.artifactId).toBe(details.artifact.artifactId);
    expect(parsed.contentHash).toBe(details.artifact.contentHash);
    expect(parsed.reality).toBe("tactical");
    expect(parsed.swm).toEqual({ snapshotVersion: 21, lastEventSequence: 25 });
  });
});
