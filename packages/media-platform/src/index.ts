/**
 * @sporta/media-platform — the real-media loop (R101-R104): browser upload →
 * server-side validation → durable hash-verified SourceAsset → REAL ffmpeg
 * normalization → the `original` reality artifact, over a job lifecycle in
 * the W914 compute vocabulary with stage-tied (never fake) progress.
 *
 * Module map:
 *
 * - `errors`: typed boundary errors (contracts `TerminalFailureClass`
 *   vocabulary: rights-denied / media-invalid / resource-limit / internal);
 * - `storage`: the provider-neutral `MediaStoragePort` (async,
 *   range-aware, content-verifying) + the local-filesystem adapter and the
 *   in-memory adapter — an R2 adapter drops in behind the same port;
 * - `ffmpeg`: the typed ffmpeg/ffprobe subprocess wrapper (probe, canonical
 *   H.264/AAC faststart transcode, availability detection, the in-test
 *   tiny-MP4 generator);
 * - `repositories`: durable record stores (SourceAsset / MediaManifest /
 *   RenderArtifactManifest / the media-job ledger) — in-memory and
 *   `bun:sqlite` implementations, the session-repository pattern;
 * - `jobs`: the `MediaJobService` — the W914 lifecycle vocabulary with
 *   `assertComputeTransition` on every change and stage-tied progress;
 * - `normalize`: the `MediaNormalizationService` (R102) + the
 *   original-reality artifact builder (R104);
 * - `service`: the `MediaPlatformService` — the upload boundary (R101) and
 *   the real pipeline executor;
 * - `toolchain` + `toolchain-executor` + `toolchain-http` + `toolchain-env`
 *   (R607 lane B): the media toolchain execution seam — the W914 http
 *   compute adapter contract against a REAL toolchain worker. The wire
 *   schemas (dispatch request, classified result envelope, honest
 *   descriptor), the fail-closed budgets, the in-process DEFAULT (the
 *   REAL `FfmpegTool`, byte-identical), the HTTP client (the seam a hosted
 *   control plane routes the SAME operations through), and the
 *   env-driven composition root.
 */
export {
  FfmpegUnavailableError,
  MediaIntegrityError,
  MediaInvalidError,
  MediaNotFoundError,
  MediaPlatformError,
  MediaRightsError,
  MediaToolchainResourceError,
  UploadRejectedError,
  isMediaPlatformError,
} from "./errors";
export type { MediaFailureClass, MediaPlatformErrorDetails } from "./errors";
export { InMemoryStorage, LocalFilesystemStorage, assertSafeKey, sha256OfBytes } from "./storage";
export type {
  ByteRange,
  MediaStoragePort,
  PutOutcome,
  StoredObjectInfo,
  StoredObjectView,
} from "./storage";
export { FfmpegTool, generateTestMp4 } from "./ffmpeg";
export type { FfprobeJson, FfprobeStreamJson, FfmpegToolOptions, MediaProbe } from "./ffmpeg";
export {
  InMemoryMediaJobRepository,
  InMemoryMediaManifestRepository,
  InMemoryRenderArtifactRepository,
  InMemorySourceAssetRepository,
  MediaDocumentValidationError,
  MediaJobConflictError,
  MediaJobNotFoundError,
  MediaManifestConflictError,
  RenderArtifactConflictError,
  SourceAssetConflictError,
  SourceAssetNotFoundError,
  SqliteMediaPlatformStore,
} from "./repositories";
export type {
  MediaJobRepository,
  MediaManifestRepository,
  RenderArtifactRepository,
  SourceAssetRepository,
} from "./repositories";
export {
  MEDIA_JOB_FAILURE_CLASSES,
  MEDIA_JOB_STAGES,
  MediaJobRecordSchema,
  MediaJobService,
  STAGE_FRACTIONS,
} from "./jobs";
export type {
  MediaJobFailureClass,
  MediaJobRecord,
  MediaJobStage,
  MediaJobStageEvent,
  MediaJobState,
  MediaJobView,
  RestartPolicy,
} from "./jobs";
export {
  NORMALIZATION_RENDERER_ID,
  NORMALIZATION_RENDERER_VERSION,
  MediaNormalizationService,
  normalizedMediaKey,
  sourceAssetKey,
} from "./normalize";
export type { MediaNormalizationServiceOptions, NormalizationOutcome } from "./normalize";
export { UPLOAD_CONSTRAINTS, MediaPlatformService } from "./service";
export type { MediaPlatformServiceOptions, RightsPolicyResolver, UploadOutcome } from "./service";
export { randomMediaId } from "./ids";
// The media toolchain execution seam (R607 lane B — the W914 http compute
// adapter against a REAL toolchain worker):
export {
  DEFAULT_MEDIA_TOOLCHAIN_BUDGETS,
  MEDIA_TOOLCHAIN_ADAPTER_ID,
  MEDIA_TOOLCHAIN_ADAPTER_VERSION,
  MEDIA_TOOLCHAIN_COST_UNITS,
  MEDIA_TOOLCHAIN_ERROR_CLASSES,
  MEDIA_TOOLCHAIN_PROVIDER_ID,
  MEDIA_TOOLCHAIN_SCHEMA_VERSION,
  MediaToolchainArtifact,
  MediaToolchainDescriptor,
  MediaToolchainDispatchRequest,
  MediaToolchainFailure,
  MediaToolchainJobDescription,
  MediaToolchainMaterializedSource,
  MediaToolchainMediaPolicy,
  MediaToolchainMetering,
  MediaToolchainNormalizedOutput,
  MediaToolchainOperation,
  MediaToolchainProbe,
  MediaToolchainProbeRaw,
  MediaToolchainProbeStream,
  MediaToolchainResolution,
  MediaToolchainResult,
  MediaToolchainSourceClaims,
  resolveMediaToolchainBudgets,
} from "./toolchain";
export type {
  MediaToolchainArtifact as MediaToolchainArtifactDoc,
  MediaToolchainBudgets,
  MediaToolchainDescriptor as MediaToolchainDescriptorDoc,
  MediaToolchainDispatchRequest as MediaToolchainDispatchRequestDoc,
  MediaToolchainErrorClass,
  MediaToolchainFailure as MediaToolchainFailureDoc,
  MediaToolchainJobDescription as MediaToolchainJobDescriptionDoc,
  MediaToolchainMaterializedSource as MediaToolchainMaterializedSourceDoc,
  MediaToolchainMediaPolicy as MediaToolchainMediaPolicyDoc,
  MediaToolchainMetering as MediaToolchainMeteringDoc,
  MediaToolchainNormalization,
  MediaToolchainNormalizedOutput as MediaToolchainNormalizedOutputDoc,
  MediaToolchainOperation as MediaToolchainOperationDoc,
  MediaToolchainExecutor,
  MediaToolchainProbe as MediaToolchainProbeDoc,
  MediaToolchainProbeRaw as MediaToolchainProbeRawDoc,
  MediaToolchainProbeStream as MediaToolchainProbeStreamDoc,
  MediaToolchainResolution as MediaToolchainResolutionDoc,
  MediaToolchainResult as MediaToolchainResultDoc,
  MediaToolchainSourceClaims as MediaToolchainSourceClaimsDoc,
} from "./toolchain";
export { InProcessMediaToolchain, executeMediaToolchainJob } from "./toolchain-executor";
export type {
  InProcessMediaToolchainOptions,
  MediaToolchainExecutorDeps,
} from "./toolchain-executor";
export { createHttpMediaToolchain, fetchMediaToolchainDescriptor } from "./toolchain-http";
export type { HttpMediaToolchainOptions } from "./toolchain-http";
export { mediaToolchainSelectionOf, resolveMediaToolchainFromEnv } from "./toolchain-env";
export type {
  MediaToolchainSelection,
  ResolvedMediaToolchain,
  ResolveMediaToolchainOptions,
} from "./toolchain-env";
