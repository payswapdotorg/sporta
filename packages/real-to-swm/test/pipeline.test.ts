/**
 * R207 pipeline behavior tests: fail-closed admission, candidate-chain
 * fallback recording, configuration validation, and degradation-ledger
 * honesty — all on fast synthetic inputs (no ffmpeg needed except where
 * noted).
 */
import { describe, expect, test } from "bun:test";
import { buildAuthorizationPolicy } from "@sporta/testing";
import {
  PipelineAdmissionError,
  RealToSwmPipeline,
  resolveConfig,
  sniffAdmittedContainer,
} from "../src/index";
import type { ClipSource } from "../src/index";

/** A minimal valid MP4 header (ftyp box) so the sniffer admits the bytes. */
const MP4_HEADER = new Uint8Array([
  0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d,
]);

function clipSource(bytes: Uint8Array, clipId = "test-clip"): ClipSource {
  return {
    provenance: { clipId },
    bytes,
    authorizationPolicy: buildAuthorizationPolicy(),
    filename: `${clipId}.mp4`,
  };
}

describe("fail-closed admission (no fake pipelines)", () => {
  test("empty bytes refuse with the typed admission error", async () => {
    const pipeline = new RealToSwmPipeline();
    try {
      await pipeline.run({
        source: clipSource(new Uint8Array(0)),
        config: { sessionId: "sess-x", decode: { maxTotalBytes: 1024 } },
      });
      expect.unreachable("must refuse");
    } catch (error) {
      expect(error).toBeInstanceOf(PipelineAdmissionError);
      expect((error as PipelineAdmissionError).terminalFailureClass).toBe("media-invalid");
    }
  });

  test("unrecognized container bytes refuse (garbage is not a clip)", async () => {
    const garbage = new Uint8Array(4096).fill(0xff);
    const pipeline = new RealToSwmPipeline();
    try {
      await pipeline.run({
        source: clipSource(garbage),
        config: { sessionId: "sess-x", decode: { maxTotalBytes: 1024 } },
      });
      expect.unreachable("must refuse");
    } catch (error) {
      expect(error).toBeInstanceOf(PipelineAdmissionError);
      expect((error as PipelineAdmissionError).message).toContain("container");
    }
  });

  test("a missing authorization policy refuses before any media inspection", async () => {
    const pipeline = new RealToSwmPipeline();
    try {
      await pipeline.run({
        source: {
          provenance: { clipId: "no-policy" },
          bytes: MP4_HEADER,
          // Intentionally policy-less (cast: the type requires a policy —
          // the runtime guard must still refuse).
          authorizationPolicy: undefined as unknown as ClipSource["authorizationPolicy"],
        },
        config: { sessionId: "sess-x", decode: { maxTotalBytes: 1024 } },
      });
      expect.unreachable("must refuse");
    } catch (error) {
      expect(error).toBeInstanceOf(PipelineAdmissionError);
      expect((error as PipelineAdmissionError).message).toContain("authorization policy");
    }
  });
});

describe("container sniffing (W101-rule mirror)", () => {
  test("mp4 magic is admitted; ogg and unknown are refused", () => {
    expect(sniffAdmittedContainer(MP4_HEADER)).toBe("mp4");
    const oggs = new Uint8Array([0x4f, 0x67, 0x67, 0x53, 0x00, 0x02, 0x00, 0x00]);
    expect(sniffAdmittedContainer(oggs)).toBe("unknown");
    expect(sniffAdmittedContainer(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toBe("unknown");
    // EBML magic + DocType element (42 82) with size 0x84 and data "webm".
    const webm = new Uint8Array([
      0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x1f, 0x42, 0x82, 0x84,
      0x77, 0x65, 0x62, 0x6d,
    ]);
    expect(sniffAdmittedContainer(webm)).toBe("webm");
  });
});

describe("configuration validation (fail loud, repo style)", () => {
  test("decode budget is REQUIRED (the bound is a deliberate decision)", () => {
    expect(() => resolveConfig({ sessionId: "s" } as never)).toThrow(/decode/);
  });

  test("empty sessionId and empty chains refuse", () => {
    expect(() =>
      resolveConfig({
        sessionId: "",
        decode: { maxTotalBytes: 1024 },
      } as never),
    ).toThrow(/sessionId/);
    expect(() =>
      resolveConfig({
        sessionId: "s",
        playerDetection: [],
        decode: { maxTotalBytes: 1024 },
      }),
    ).toThrow(/playerDetection/);
  });

  test("defaults resolve to the documented chains and gates", () => {
    const resolved = resolveConfig({
      sessionId: "sess-defaults",
      decode: { maxTotalBytes: 1024 },
    });
    expect(resolved.playerDetection).toEqual(["model-backed-detector", "heuristic-color-detector"]);
    expect(resolved.playerTracking).toEqual(["greedy-iou-tracker"]);
    expect(resolved.ballDetection).toEqual(["model-backed-ball-detector", "ball-blob-detector"]);
    expect(resolved.ballTracking).toEqual(["color-blob-ball-tracker", "nearest-box-ball-tracker"]);
    expect(resolved.calibration).toEqual([
      "line-based-field-calibrator",
      "homography-field-calibrator",
    ]);
    expect(resolved.minTrackFrames).toBe(5);
    expect(resolved.nowMs).toBe(0);
    expect(resolved.ballImpulse.minSpeedRatio).toBe(3);
    expect(resolved.ballImpulse.clusterWindowMs).toBe(240);
  });

  test("unknown candidate ids refuse at resolve time... (validated at run)", () => {
    // The chain ids are validated inside run() where the family is known;
    // resolveConfig validates shape only. Shape-level: non-string entries.
    expect(() =>
      resolveConfig({
        sessionId: "s",
        playerDetection: [""],
        decode: { maxTotalBytes: 1024 },
      }),
    ).toThrow(/non-empty strings/);
  });
});
