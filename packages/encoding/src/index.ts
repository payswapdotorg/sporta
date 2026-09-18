/**
 * @sporta/encoding — the R306 real video encoding plane: the
 * vendor-neutral `FrameEncoderPort` seam, the REAL ffmpeg/libx264
 * adapter, the deterministic fixture adapter, and the three renderer
 * bridges (tactical adopt/verify; game-3d + anime-npr frame streams →
 * MP4), with every artifact registerable in the W504 content-addressed
 * store.
 *
 * Work item R306: "Deliver actual MP4 outputs and manifests" for the
 * tactical (R301), 3D (R303) and anime (R304) renderers.
 *
 * - `types`: the `FrameEncoderPort` seam + the `EncodedArtifact` /
 *   container-manifest documents (the W504 pattern: source renderer id +
 *   version, frame count, duration, codec params, sha-256 content hash,
 *   per-frame timing, and the renderer's own manifest VERBATIM)
 * - `ffmpeg`: `FfmpegFrameEncoder` — the REAL h264/MP4 adapter following
 *   `renderer-tactical/src/codec.ts` EXACTLY on every determinism knob
 *   (`-threads 1`, `+bitexact`, `-map_metadata -1`, pinned
 *   preset/tune/profile/level/crf/pix_fmt/gop), bounded (`maxBuffer` +
 *   timeout + SIGKILL — no zombies, no hangs), fail-loud (typed errors,
 *   honest exit codes)
 * - `fixture`: `FixtureFrameEncoder` — the deterministic zero-I/O test
 *   tier (the @sporta/decoding two-tier precedent); its bytes are clearly
 *   labeled fixture documents, NEVER claimed as video
 * - `bridges`: the three renderer bridges (thin, additive — the renderers
 *   stay untouched)
 * - `store`: registration in the W504 content-addressed artifact store
 *   (REUSED, never forked: idempotent puts, counted duplicates,
 *   integrity-verified reads; the honest base64 representation over the
 *   store's string seam — both hashes recorded)
 * - `verify`: `probeEncodedArtifact` (ffprobe) + `decodeEncodedFrames`
 *   (full-frame rawvideo decode) — the honest foundation for the R307
 *   visual-correctness measurements
 *
 * MP4 honesty: the ffmpeg tier produces REAL raster video outputs — no
 * SVG-only stand-ins at this plane. Determinism is PER BUILD (the x264
 * core-version SEI): three runs of the same frames produce one sha-256
 * (test-pinned per run); cross-build byte-stability is NOT claimed.
 */
export type {
  EncoderBridge,
  EncodeOrigin,
  EncodedArtifact,
  EncodedCodecParams,
  EncodedContainerManifest,
  EncodedFrameTiming,
  FrameEncodeRequest,
  FrameEncodeResult,
  FrameEncoderPort,
  FrameSequenceSource,
  GameEngineFrameOutput,
  Rgb24FileSource,
  Rgb24FramesSource,
} from "./types";
export { EncodingError } from "./errors";
export type { EncodingErrorKind, EncodingFailureClass } from "./errors";
export {
  DEFAULT_ENCODE_TIMEOUT_MS,
  ENCODED_CONTAINER,
  ENCODED_VIDEO_CODEC,
  FFMPEG_ENCODER_KIND,
  FfmpegFrameEncoder,
  REAL_ENCODE_CODEC_PARAMS,
  createFfmpegFrameEncoder,
  probeFfmpegEncoder,
} from "./ffmpeg";
export type { FfmpegEncoderAvailability, FfmpegFrameEncoderOptions } from "./ffmpeg";
export {
  FIXTURE_ENCODE_CODEC_PARAMS,
  FIXTURE_ENCODE_MAGIC,
  FIXTURE_ENCODER_KIND,
  FIXTURE_ENCODER_VERSION,
  FixtureFrameEncoder,
} from "./fixture";
export {
  ENCODED_MANIFEST_SCHEMA_VERSION,
  buildEncodedArtifact,
  encodedIdentityOf,
  frameTimingsOf,
  validateEncodedManifest,
} from "./manifest";
export type { BuildEncodedArtifactOptions, EncodedManifestValidation } from "./manifest";
export {
  bridgeGameFrameOutput,
  bridgeRgbFrames,
  bridgeTacticalRenderer,
} from "./bridges";
export type {
  BridgeGameFrameOptions,
  BridgeRgbFramesOptions,
  BridgeTacticalOptions,
  TacticalRendererLike,
  TacticalStagedArtifactLike,
} from "./bridges";
export {
  ENCODED_ARTIFACT_CONTENT_TYPE,
  base64Of,
  encodedArtifactMetadataOf,
  loadEncodedArtifact,
  registerEncodedArtifact,
} from "./store";
export type { LoadedEncodedArtifact, RegisteredEncodedArtifact } from "./store";
export {
  ENCODE_METRIC_NAMES,
  countEncode,
  countEncodeFailure,
  logEncode,
  noopObservability,
} from "./observability";
export type { EncodingObservability } from "./observability";
export {
  DEFAULT_VERIFY_TIMEOUT_MS,
  decodeEncodedFrames,
  probeEncodedArtifact,
} from "./verify";
export type {
  DecodeEncodedFramesOptions,
  ProbeEncodedArtifactOptions,
  ProbedEncodedArtifact,
} from "./verify";
export { isRecord, isFiniteNumber, isNonEmptyString, sha256Of } from "./internal";
