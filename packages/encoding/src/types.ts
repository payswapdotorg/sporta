/**
 * THE types of the encoding plane (R306): the vendor-neutral
 * `FrameEncoderPort` seam, its request/result documents, and the
 * `EncodedArtifact` + container-manifest shapes every bridge produces.
 *
 * The port (the `@sporta/decoding` two-tier precedent): a MECHANICAL seam
 * — staged/in-memory rgb24 frame sequences in, encoded bytes out. Policy
 * (admission, verification, storage) lives in the bridges and the store
 * modules, never in the adapters.
 */
import type { GameEngineFrameOutput } from "@sporta/contracts";

/** A staged raw RGB24 frame-sequence file (the engine's `stagingRef` stream). */
export interface Rgb24FileSource {
  kind: "rgb24-file";
  /** The staged file: exactly `frameCount × width × height × 3` bytes. */
  path: string;
  frameCount: number;
  width: number;
  height: number;
}

/** In-memory decoded RGB frames (each exactly `width × height × 3` bytes). */
export interface Rgb24FramesSource {
  kind: "rgb24-frames";
  frames: readonly Uint8Array[];
  width: number;
  height: number;
}

/** The typed frame sequence an encoder consumes. */
export type FrameSequenceSource = Rgb24FileSource | Rgb24FramesSource;

/** Which renderer bridge a frame stream originates from (closed vocabulary). */
export type EncoderBridge = "tactical" | "game-3d" | "anime-npr" | "raw-frames";

/** The provenance of a frame stream (carried into every manifest). */
export interface EncodeOrigin {
  /** The source renderer's id (e.g. "tactical.prototype"). */
  rendererId: string;
  /** The source renderer's version. */
  rendererVersion: string;
  /** The bridge that produced/adapted the stream. */
  bridge: EncoderBridge;
  /** The game-engine id behind the render (game bridges only). */
  engineId?: string;
  /** The game-engine version behind the render (game bridges only). */
  engineVersion?: string;
}

/** One encode request (fail-closed admission in the adapters + bridges). */
export interface FrameEncodeRequest {
  source: FrameSequenceSource;
  /** Frames per second (may be fractional, e.g. 12.5). */
  fps: number;
  /** The stream's provenance. */
  origin: EncodeOrigin;
}

/** The pinned codec parameters actually used for one encode (recorded honestly). */
export interface EncodedCodecParams {
  /** The container identity ("mp4" for the real adapter; "fixture" for the fixture tier). */
  container: string;
  /** The video codec identity ("avc1.42E01E" for the real adapter; "fixture-bytes" for the fixture tier). */
  videoCodec: string;
  /** The encoder argv/derivation summary (human-readable, deterministic). */
  encoder: string;
  preset: string;
  tune: string | null;
  profile: string;
  level: string;
  crf: number | null;
  pixFmt: string;
  gop: number | null;
  threads: number;
  bitexact: boolean;
}

/** One encode's result: the REAL encoded bytes + their measured identity. */
export interface FrameEncodeResult {
  /** The encoded bytes (a real MP4 for the ffmpeg tier — never SVG, never a stand-in). */
  bytes: Uint8Array;
  byteSize: number;
  /** sha-256 of `bytes` (the content address, 64 lowercase hex). */
  contentHash: string;
  frameCount: number;
  width: number;
  height: number;
  fps: number;
  /** The clip duration: `round(frameCount · 1000 / fps)` ms. */
  durationMs: number;
  /** The adapter's identity ("ffmpeg-libx264" | "fixture-encoder"). */
  encoderKind: string;
  /** The adapter's probed version (null before a successful probe). */
  encoderVersion: string | null;
  /** The codec parameters actually used. */
  codec: EncodedCodecParams;
}

/**
 * THE vendor-neutral encoder seam (the `DecoderAdapter` posture): a
 * mechanical frame-sequence → encoded-bytes adapter. Implementations MUST
 * be side-effect-bounded to their input and MUST NOT enforce policy —
 * the bridges and store modules own admission, verification, and storage.
 */
export interface FrameEncoderPort {
  /** The adapter identity (e.g. "ffmpeg-libx264", "fixture-encoder"). */
  readonly kind: string;
  /** True when the adapter was probed and responds (the typed skip guard). */
  available(): boolean;
  /** The probed adapter version string (null before a successful probe). */
  version(): string | null;
  /**
   * Encodes the frame sequence. Throws `EncodingError` on any failure —
   * never partial bytes, never a fabricated artifact.
   */
  encode(request: FrameEncodeRequest): FrameEncodeResult;
}

/** The per-frame output timing recorded in every container manifest. */
export interface EncodedFrameTiming {
  /** The frame's index (gap-free, 0-based). */
  frameIndex: number;
  /** The frame's output timestamp: `round(frameIndex · 1000 / fps)` ms. */
  frameMs: number;
}

/**
 * THE container manifest (the W504 pattern: the encoded document's own
 * identity, geometry, codec parameters, per-frame timing, content hash,
 * and the RENDERER'S OWN MANIFEST VERBATIM).
 */
export interface EncodedContainerManifest {
  schemaVersion: string;
  /** The identity-derived manifest id (`enc-<fnv1a32-hex8>`). */
  manifestId: string;
  sessionId: string;
  bridge: EncoderBridge;
  source: {
    rendererId: string;
    rendererVersion: string;
    engineId?: string;
    engineVersion?: string;
  };
  /** The SWM provenance of the encoded reality (null for raw streams without SWM ties). */
  swm: { snapshotVersion: number; lastEventSequence: number } | null;
  encoder: {
    kind: string;
    version: string | null;
    codec: EncodedCodecParams;
  };
  geometry: {
    widthPx: number;
    heightPx: number;
    fps: number;
    frameCount: number;
    durationMs: number;
  };
  /** sha-256 of the encoded bytes (64 lowercase hex). */
  contentHash: string;
  byteSize: number;
  frames: EncodedFrameTiming[];
  /** The renderer's own manifest, VERBATIM (the W504 sourceManifest pattern). */
  rendererManifest: unknown;
  /** True only after the bytes were re-hashed to `contentHash`. */
  integrity: { algorithm: "sha256"; verified: boolean };
  /** The deterministic generation time (injected clock, never ambient). */
  generatedAtMs: number;
}

/**
 * One encoded artifact: the REAL encoded bytes plus the container
 * manifest. `kind` distinguishes the REAL MP4 plane from the fixture tier
 * (the fixture adapter's bytes are a deterministic stand-in for tests —
 * never video, never claimed as video).
 */
export interface EncodedArtifact {
  kind: "mp4" | "fixture";
  manifestId: string;
  sessionId: string;
  /** sha-256 of `bytes` (must equal `manifest.contentHash`). */
  contentHash: string;
  byteSize: number;
  bytes: Uint8Array;
  manifest: EncodedContainerManifest;
}

/** A structural game-engine frame output (the contracts `GameEngineFrameOutput` shape). */
export type { GameEngineFrameOutput };
