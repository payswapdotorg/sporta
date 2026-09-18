/**
 * The deterministic FIXTURE adapter (R306): the `@sporta/decoding`
 * `FixtureDecoderAdapter` precedent — a pure-TS, deterministic, zero-I/O
 * test substrate behind the same `FrameEncoderPort` seam.
 *
 * HONESTY BOUND (never crossed): this adapter does NOT produce video. Its
 * bytes are a small deterministic binary document (a fixed magic header +
 * a canonical JSON descriptor of the encode identity, including the
 * sha-256 of the frame stream) so that:
 *
 * - identical inputs → byte-identical outputs (deterministic, testable
 *   without ffmpeg);
 * - different frame CONTENT → different bytes (the stream hash is in the
 *   document);
 * - the artifact it yields is labeled `kind: "fixture"` with codec
 *   `container: "fixture"` — a fixture-tier stand-in for the encode
 *   contract, NEVER claimed as an MP4 (the R307 gate treats a
 *   fixture-tier artifact as NOT-RUNNABLE for decode-based checks).
 */
import { EncodingError } from "./errors";
import { sha256Of } from "./internal";
import type {
  EncodedCodecParams,
  FrameEncodeRequest,
  FrameEncodeResult,
  FrameEncoderPort,
} from "./types";

/** The adapter identity. */
export const FIXTURE_ENCODER_KIND = "fixture-encoder";

/** The magic header of every fixture-tier document (never an MP4 signature). */
export const FIXTURE_ENCODE_MAGIC = "SPORTA-FIXTURE-ENCODE\x00";

/** The pinned (non-video) codec parameters of the fixture tier. */
export const FIXTURE_ENCODE_CODEC_PARAMS: EncodedCodecParams = {
  container: "fixture",
  videoCodec: "fixture-bytes",
  encoder: "fixture: deterministic document = magic + canonical JSON of (origin, geometry, fps, stream sha-256)",
  preset: "fixture",
  tune: null,
  profile: "fixture",
  level: "fixture",
  crf: null,
  pixFmt: "fixture",
  gop: null,
  threads: 1,
  bitexact: true,
};

/** The fixture adapter's version (the package version, pinned by test). */
export const FIXTURE_ENCODER_VERSION = "0.1.0";

/** The staged/in-memory stream's concatenated bytes (for the stream hash). */
function concatStream(source: FrameEncodeRequest["source"]): Uint8Array {
  if (source.kind === "rgb24-frames") {
    const total = source.frames.reduce((sum, frame) => sum + frame.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const frame of source.frames) {
      out.set(frame, offset);
      offset += frame.length;
    }
    return out;
  }
  // The fixture adapter never reads files (the decoding precedent: input
  // bytes IGNORED) — the staged-file identity is the stream's descriptor.
  return new Uint8Array(0);
}

/** The deterministic fixture adapter (always available; zero I/O). */
export class FixtureFrameEncoder implements FrameEncoderPort {
  readonly kind = FIXTURE_ENCODER_KIND;

  available(): boolean {
    return true;
  }

  version(): string | null {
    return FIXTURE_ENCODER_VERSION;
  }

  encode(request: FrameEncodeRequest): FrameEncodeResult {
    const width = request.source.width;
    const height = request.source.height;
    const frameCount =
      request.source.kind === "rgb24-file" ? request.source.frameCount : request.source.frames.length;
    const fps = request.fps;
    if (!Number.isInteger(width) || width < 16 || !Number.isInteger(height) || height < 16) {
      throw new EncodingError("media-invalid", "frames-invalid", "encode dimensions must be integers >= 16", {
        width,
        height,
      });
    }
    if (!Number.isFinite(fps) || fps <= 0) {
      throw new EncodingError("media-invalid", "frames-invalid", "encode fps must be finite > 0", { fps });
    }
    if (!Number.isInteger(frameCount) || frameCount < 1) {
      throw new EncodingError("media-invalid", "frames-invalid", "encode frameCount must be an integer >= 1", {
        frameCount,
      });
    }
    const streamBytes = concatStream(request.source);
    const streamHash = sha256Of(streamBytes);
    const descriptor = {
      magic: FIXTURE_ENCODE_MAGIC.slice(0, -1),
      origin: request.origin,
      width,
      height,
      fps,
      frameCount,
      streamHash,
    };
    const bytes = new TextEncoder().encode(
      `${FIXTURE_ENCODE_MAGIC}${JSON.stringify(descriptor)}\n`,
    );
    const contentHash = sha256Of(bytes);
    return {
      bytes,
      byteSize: bytes.length,
      contentHash,
      frameCount,
      width,
      height,
      fps,
      durationMs: Math.round((frameCount * 1_000) / fps),
      encoderKind: this.kind,
      encoderVersion: this.version(),
      codec: { ...FIXTURE_ENCODE_CODEC_PARAMS },
    };
  }
}
