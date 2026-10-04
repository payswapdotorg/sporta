/**
 * THE R607 GAP 1 DECODE-PORT SEAM TESTS (the TL-authorized injected decode
 * port): the pipeline's W102 boundary behind the options-injection seam.
 *
 * 1. THE SEAM EQUIVALENCE (the non-degradation law at the seam boundary):
 *    the injected port replaying the EXACT documents the LOCAL
 *    `DecodingService`/`FfmpegDecoderAdapter` path produces (the probe + the
 *    bounded frame batch for the same window) yields a BYTE-IDENTICAL
 *    reconstruction artifact — the same content hash, the same canonical
 *    serialization — as the DEFAULT no-options run (which constructs its own
 *    local adapter, exactly as before the seam).
 * 2. THE DISPATCH MAPPING: the pipeline forwards the session-patched W102
 *    input, the video track's stream index, and the config's decode window
 *    (fromMs/toMs/maxTotalBytes) to the injected port VERBATIM.
 * 3. THE FAIL-CLOSED SEMANTICS: a typed W102 refusal from the port
 *    propagates unchanged; a port that yields zero frames is the honest
 *    admission refusal — never a fake pipeline.
 */
import { describe, expect, test } from "bun:test";
import { DecodingService, FfmpegDecoderAdapter, UnsupportedMediaError } from "@sporta/decoding";
import type {
  DecodeSourceInput,
  DecodeWindow,
  NormalizedVideoFrame,
  ProbeResult,
} from "@sporta/decoding";
import {
  PipelineAdmissionError,
  RealToSwmPipeline,
  buildDecodeSourceInput,
  buildReconstructionArtifact,
  serializeArtifact,
  withSessionId,
} from "../src/index";
import type { RealToSwmDecodePort } from "../src/index";
import { ffmpegAvailable, gatePolicy, loadGateClip } from "./helpers";

const available = await ffmpegAvailable();
if (!available) {
  console.warn("ffmpeg unavailable — skipping the decode-port seam tests");
}

/** The bounded window the seam tests decode (fast, real, measured). */
const WINDOW: { fromMs: number; toMs: number; maxTotalBytes: number } = {
  fromMs: 0,
  toMs: 1000,
  maxTotalBytes: 1024 * 1024 * 1024,
};

/** One recorded dispatch the stub port observed. */
interface RecordedCall {
  op: "probe" | "decodeVideo";
  sessionId: string;
  streamIndex?: number;
  window?: DecodeWindow;
}

describe.skipIf(!available)("the R607 decode-port seam (fx-001, real clip)", () => {
  test("the injected port replaying the local decode documents yields a BYTE-IDENTICAL artifact", async () => {
    const clip = loadGateClip("fx-001");
    const policy = gatePolicy();
    const source = { ...clip.source, authorizationPolicy: policy };
    const config = {
      sessionId: "sess-decode-port-seam",
      decode: { ...WINDOW },
    };

    // Record the LOCAL decode outputs — the exact W102 documents the
    // pre-seam path produces for this clip + window (the same
    // DecodingService/ FfmpegDecoderAdapter construction the default
    // pipeline performs internally).
    const built = buildDecodeSourceInput(source, 0);
    const decodeInput = withSessionId(built.input, config.sessionId);
    const localDecoding = new DecodingService({ adapter: new FfmpegDecoderAdapter() });
    const recordedProbe = await localDecoding.probe(decodeInput);
    const videoTrack = recordedProbe.tracks.find((track) => track.kind === "video")!;
    const recordedFrames: NormalizedVideoFrame[] = [];
    for await (const frame of localDecoding.decodeVideo(
      decodeInput,
      videoTrack.streamIndex,
      WINDOW,
    )) {
      recordedFrames.push(frame);
    }
    expect(recordedFrames.length).toBeGreaterThan(0);

    // (A) The DEFAULT no-options run — the pre-seam local construction.
    const localRun = await new RealToSwmPipeline().run({ source, config });
    const localArtifact = buildReconstructionArtifact(localRun, clip.provenance);

    // (B) The injected-port run: the stub port replays the recorded
    // documents through the seam.
    const calls: RecordedCall[] = [];
    const stubPort: RealToSwmDecodePort = {
      probe: async (input: DecodeSourceInput): Promise<ProbeResult> => {
        calls.push({ op: "probe", sessionId: input.receipt.sessionId });
        return recordedProbe;
      },
      decodeVideo: (
        input: DecodeSourceInput,
        streamIndex: number,
        window?: DecodeWindow,
      ): AsyncIterable<NormalizedVideoFrame> => {
        calls.push({
          op: "decodeVideo",
          sessionId: input.receipt.sessionId,
          streamIndex,
          window,
        });
        return (async function* replay(): AsyncGenerator<NormalizedVideoFrame> {
          for (const frame of recordedFrames) {
            yield frame;
          }
        })();
      },
    };
    const portRun = await new RealToSwmPipeline({ decode: stubPort }).run({ source, config });
    const portArtifact = buildReconstructionArtifact(portRun, clip.provenance);

    // THE SEAM EQUIVALENCE: same content hash, byte-identical serialization.
    expect(portArtifact.contentHash).toBe(localArtifact.contentHash);
    expect(serializeArtifact(portArtifact)).toBe(serializeArtifact(localArtifact));

    // THE DISPATCH MAPPING: the port saw the session-patched input, the
    // video track's stream index, and the config's window VERBATIM.
    expect(calls.length).toBe(2);
    expect(calls[0]!.op).toBe("probe");
    expect(calls[0]!.sessionId).toBe(config.sessionId);
    expect(calls[1]!.op).toBe("decodeVideo");
    expect(calls[1]!.sessionId).toBe(config.sessionId);
    expect(calls[1]!.streamIndex).toBe(videoTrack.streamIndex);
    expect(calls[1]!.window).toEqual({
      fromMs: WINDOW.fromMs,
      toMs: WINDOW.toMs,
      maxTotalBytes: WINDOW.maxTotalBytes,
    });
  }, 120_000);

  test("a typed W102 refusal from the port propagates unchanged (fail-closed)", async () => {
    const clip = loadGateClip("fx-001");
    const policy = gatePolicy();
    const source = { ...clip.source, authorizationPolicy: policy };
    const built = buildDecodeSourceInput(source, 0);
    const localDecoding = new DecodingService({ adapter: new FfmpegDecoderAdapter() });
    const recordedProbe = await localDecoding.probe(
      withSessionId(built.input, "sess-decode-port-refusal"),
    );
    const refusingPort: RealToSwmDecodePort = {
      probe: async () => recordedProbe,
      decodeVideo: (): AsyncIterable<NormalizedVideoFrame> => {
        throw new UnsupportedMediaError(
          "the remote decode boundary refused the stream (test posture)",
          { streamIndex: 0 },
        );
      },
    };
    const pipeline = new RealToSwmPipeline({ decode: refusingPort });
    await expect(
      pipeline.run({
        source,
        config: {
          sessionId: "sess-decode-port-refusal",
          decode: { ...WINDOW },
        },
      }),
    ).rejects.toBeInstanceOf(UnsupportedMediaError);
  });

  test("a port that yields zero frames is the honest admission refusal (never a fake pipeline)", async () => {
    const clip = loadGateClip("fx-001");
    const policy = gatePolicy();
    const source = { ...clip.source, authorizationPolicy: policy };
    const built = buildDecodeSourceInput(source, 0);
    const localDecoding = new DecodingService({ adapter: new FfmpegDecoderAdapter() });
    const recordedProbe = await localDecoding.probe(
      withSessionId(built.input, "sess-decode-port-empty"),
    );
    const emptyPort: RealToSwmDecodePort = {
      probe: async () => recordedProbe,
      decodeVideo: (): AsyncIterable<NormalizedVideoFrame> =>
        (async function* empty(): AsyncGenerator<NormalizedVideoFrame> {})(),
    };
    const pipeline = new RealToSwmPipeline({ decode: emptyPort });
    await expect(
      pipeline.run({
        source,
        config: {
          sessionId: "sess-decode-port-empty",
          decode: { ...WINDOW },
        },
      }),
    ).rejects.toBeInstanceOf(PipelineAdmissionError);
  });
});
