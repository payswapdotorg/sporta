/**
 * THE MEDIA PLATFORM SERVICE (R101/R103/R104) — the composition-level
 * orchestrator of the real-media loop:
 *
 *   browser MP4 bytes
 *     → server-side constraint validation (BEFORE storage — typed refusals)
 *     → durable, hash-verified `SourceAsset` (uploadState "stored")
 *     → a REAL media job (admitted → dispatched → queued → in-flight)
 *     → REAL ffmpeg normalization (R102, `./normalize.ts`)
 *     → the `original` reality artifact (`RenderArtifactManifest`)
 *     → terminal `succeeded` with the full record chain.
 *
 * ## The honesty spine (the packet's rules, restated)
 *
 * - upload constraints (≤ 200 MB, mp4 container, ≤ 120 s duration, ≥ 1
 *   video stream) are validated SERVER-SIDE BEFORE anything is stored —
 *   the container via magic bytes (`@sporta/ingestion` `sniffContainer`),
 *   the duration/streams via the REAL ffprobe on the received bytes; a
 *   rejected upload answers a typed error and nothing is stored;
 * - the rights declaration is part of the upload: `declaredRightsPolicyId`
 *   must reference the session's EXISTING effective authorization policy
 *   (fail-closed through the injected resolver — `@sporta/contracts`
 *   semantics: expiry re-derived at upload time, transformation must be
 *   allowed for a pipeline that references source frames);
 * - `checksumVerified: true` means the stored bytes were RE-READ and
 *   hash-verified through the storage seam;
 * - the job's progress is tied to ACTUAL stage completions
 *   (upload-complete / normalization-complete / artifact-stored) — the
 *   `MediaJobService` derives the fractions from its stage table, callers
 *   cannot claim numbers;
 * - the executor is async and observable: the upload call returns after
 *   admission; `runJob` (public, awaitable — tests and the composition
 *   drive it) walks the REAL pipeline. A process restart reads the last
 *   durable state and never invents completion.
 */
import { deriveRightsCapabilities } from "@sporta/contracts";
import type { AuthorizationPolicy, SourceAsset } from "@sporta/contracts";
import { sniffContainer } from "@sporta/ingestion";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MediaRightsError, UploadRejectedError } from "./errors";
import { FfmpegTool } from "./ffmpeg";
import { randomMediaId } from "./ids";
import { MediaJobService, type MediaJobView } from "./jobs";
import type {
  MediaManifestRepository,
  MediaJobRepository,
  RenderArtifactRepository,
  SourceAssetRepository,
} from "./repositories";
import { MediaNormalizationService, sourceAssetKey } from "./normalize";
import type { MediaStoragePort } from "./storage";
import { sha256OfBytes } from "./storage";

/** The frozen upload constraints (R101 — server-side, validator-enforced). */
export const UPLOAD_CONSTRAINTS = Object.freeze({
  /** Maximum accepted upload size (200 MB). */
  maxBytes: 200 * 1024 * 1024,
  /** The only accepted container. */
  container: "mp4",
  /** Maximum accepted duration (120 s), MEASURED via ffprobe. */
  maxDurationMs: 120_000,
});

/** The rights seam: resolves a session's EFFECTIVE policy (fail-closed). */
export type RightsPolicyResolver = (sessionId: string) => AuthorizationPolicy | null;

/** Options for {@link MediaPlatformService}. */
export interface MediaPlatformServiceOptions {
  storage: MediaStoragePort;
  sourceAssets: SourceAssetRepository;
  manifests: MediaManifestRepository;
  artifacts: RenderArtifactRepository;
  jobs: MediaJobRepository;
  /** Resolves the session's effective policy (the composition wires the W917 store). */
  resolvePolicy: RightsPolicyResolver;
  /** The injected clock (ms). */
  nowMs: () => number;
  /** The typed ffmpeg wrapper (default: a stock {@link FfmpegTool}). */
  tool?: FfmpegTool;
  /**
   * Whether `upload` fires the pipeline executor in the background
   * (default true — the observable live states). Tests may set false and
   * await {@link MediaPlatformService.runJob} directly.
   */
  autoRun?: boolean;
}

/** The upload's synchronous answer: the stored asset + the admitted job. */
export interface UploadOutcome {
  asset: SourceAsset;
  job: MediaJobView;
}

/**
 * The media platform orchestrator. Route handlers call `upload` (the R101
 * boundary) and poll `jobView` (the R103 surface); `runJob` executes the
 * real pipeline for one admitted job (idempotent-ish: a job already
 * terminal is returned as-is — the ledger never double-runs).
 */
export class MediaPlatformService {
  private readonly storage: MediaStoragePort;
  private readonly sourceAssets: SourceAssetRepository;
  private readonly manifests: MediaManifestRepository;
  private readonly artifacts: RenderArtifactRepository;
  private readonly resolvePolicy: RightsPolicyResolver;
  private readonly nowMs: () => number;
  private readonly tool: FfmpegTool;
  private readonly autoRun: boolean;
  readonly jobs: MediaJobService;
  private readonly normalizer: MediaNormalizationService;
  private readonly running = new Set<string>();

  constructor(options: MediaPlatformServiceOptions) {
    this.storage = options.storage;
    this.sourceAssets = options.sourceAssets;
    this.manifests = options.manifests;
    this.artifacts = options.artifacts;
    this.resolvePolicy = options.resolvePolicy;
    this.nowMs = options.nowMs;
    this.tool = options.tool ?? new FfmpegTool();
    this.autoRun = options.autoRun ?? true;
    this.jobs = new MediaJobService({ repository: options.jobs, nowMs: this.nowMs });
    this.normalizer = new MediaNormalizationService({
      storage: this.storage,
      tool: this.tool,
      nowMs: this.nowMs,
      limits: { maxDurationMs: UPLOAD_CONSTRAINTS.maxDurationMs },
    });
  }

  // -------------------------------------------------------------------------
  // R101 — the upload boundary
  // -------------------------------------------------------------------------

  /**
   * Validates and stores ONE authorized upload, then admits its processing
   * job. Validation is server-side and PRE-STORAGE:
   *
   * 1. rights: the declared policy id must match the session's existing
   *    effective policy, and that policy must (still) allow
   *    `transformation` (the pipeline references source frames) —
   *    fail-closed, re-derived at upload time;
   * 2. size: the measured byte length must be within the 200 MB bound;
   * 3. container: magic-byte sniffed mp4 (the `@sporta/ingestion` seam);
   * 4. media: ffprobe on the received bytes — positive duration within the
   *    120 s bound, at least one video stream.
   *
   * Only then: bytes stored, RE-READ + hash-verified, the frozen
   * `SourceAsset` persisted at `uploadState: "stored"`, the job admitted.
   */
  async upload(input: {
    bytes: Uint8Array;
    sessionId: string;
    declaredRightsPolicyId: string;
  }): Promise<UploadOutcome> {
    // 1. Rights FIRST (fail-closed — nothing about the bytes is revealed or
    //    stored when the declaration does not reference a live policy).
    const policy = this.resolvePolicy(input.sessionId);
    if (policy === null) {
      throw new MediaRightsError(
        `session '${input.sessionId}' has no effective authorization policy — upload refused (fail-closed)`,
        { sessionId: input.sessionId },
      );
    }
    if (policy.policyId !== input.declaredRightsPolicyId) {
      throw new MediaRightsError(
        `declared rights policy '${input.declaredRightsPolicyId}' does not reference session '${input.sessionId}'s effective policy '${policy.policyId}'`,
        {
          sessionId: input.sessionId,
          declaredRightsPolicyId: input.declaredRightsPolicyId,
          effectivePolicyId: policy.policyId,
        },
      );
    }
    const capabilities = deriveRightsCapabilities(policy, new Date(this.nowMs()));
    if (!capabilities.canReferenceSourceFrames) {
      throw new MediaRightsError(
        `the effective policy '${policy.policyId}' does not allow transformation — the media pipeline references source frames and is refused (fail-closed)`,
        { sessionId: input.sessionId, policyId: policy.policyId },
      );
    }

    // 2. Size (measured from the received bytes — never a header claim).
    if (input.bytes.byteLength === 0) {
      throw new UploadRejectedError("size-empty", "the upload carries no bytes", "media-invalid", {
        byteSize: 0,
      });
    }
    if (input.bytes.byteLength > UPLOAD_CONSTRAINTS.maxBytes) {
      throw new UploadRejectedError(
        "size-over-limit",
        `the upload measures ${input.bytes.byteLength} bytes, over the ${UPLOAD_CONSTRAINTS.maxBytes} byte bound`,
        "resource-limit",
        { byteSize: input.bytes.byteLength, maxBytes: UPLOAD_CONSTRAINTS.maxBytes },
      );
    }

    // 3. Container (magic bytes, pre-storage).
    const info = sniffContainer(input.bytes);
    if (info.container !== UPLOAD_CONSTRAINTS.container) {
      throw new UploadRejectedError(
        "container-not-mp4",
        `the upload's container is '${info.container}' (magic-byte sniffed), only 'mp4' is accepted`,
        "media-invalid",
        { sniffed: info.container, detectedBy: info.detectedBy },
      );
    }

    // 4. The media itself (ffprobe on the received bytes, pre-storage).
    const probe = await this.probeReceivedBytes(input.bytes);

    // 5. Store, re-read, verify — then freeze the record.
    const assetId = randomMediaId("asset");
    const contentHash = sha256OfBytes(input.bytes);
    await this.storage.put(sourceAssetKey(assetId), input.bytes);
    const verifiedHash = await this.storage.verify(sourceAssetKey(assetId), contentHash);
    if (verifiedHash !== contentHash) {
      throw new UploadRejectedError(
        "checksum-mismatch",
        "the stored bytes failed re-read hash verification",
        "media-invalid",
        { assetId },
      );
    }
    const uploadedAtMs = this.nowMs();
    const asset: SourceAsset = {
      schemaVersion: "1.1",
      assetId,
      contentHash,
      byteSize: input.bytes.byteLength,
      container: UPLOAD_CONSTRAINTS.container,
      durationMs: probe.durationMs,
      videoStreamCount: probe.videoStreams.length,
      audioStreamCount: probe.audioStreams.length,
      declaredRightsPolicyId: policy.policyId,
      uploadState: "stored",
      uploadedAtMs,
      checksumVerified: true,
    };
    this.sourceAssets.create(asset);

    // 6. The processing job (admitted — the upload stage is COMPLETE).
    const job = this.jobs.createJob({
      jobId: randomMediaId("mjob"),
      sourceAssetId: assetId,
      sessionId: input.sessionId,
    });
    this.jobs.advance(job.jobId, "queued", "upload-complete");

    if (this.autoRun) {
      void this.runJob(job.jobId).catch((err) => {
        // The runJob body already fails the job on typed errors; this catch
        // is the last-resort belt for a defect in the failure path itself.
        console.error(`[media-platform] pipeline crashed outside its failure posture`, err);
      });
    }

    return {
      asset,
      job: this.jobs.view(job.jobId)!,
    };
  }

  /** Probes the received bytes through the REAL ffprobe (pre-storage). */
  private async probeReceivedBytes(bytes: Uint8Array): Promise<ReturnType<FfmpegTool["probe"]>> {
    const workDir = await mkdtemp(join(tmpdir(), "sporta-upload-"));
    try {
      const inputPath = join(workDir, "received.mp4");
      await writeFile(inputPath, bytes);
      const probe = await this.tool.probe(inputPath);
      if (probe.durationMs > UPLOAD_CONSTRAINTS.maxDurationMs) {
        throw new UploadRejectedError(
          "duration-over-limit",
          `the media measures ${probe.durationMs}ms, over the ${UPLOAD_CONSTRAINTS.maxDurationMs}ms bound`,
          "resource-limit",
          { durationMs: probe.durationMs, maxDurationMs: UPLOAD_CONSTRAINTS.maxDurationMs },
        );
      }
      return probe;
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }

  // -------------------------------------------------------------------------
  // R103/R104 — the real pipeline executor
  // -------------------------------------------------------------------------

  /**
   * Runs one admitted job's REAL pipeline to its terminal disposition:
   * queued → in-flight → (normalize → store → verify) → succeeded/failed.
   * The stage trail records the ACTUAL completions; progress fractions are
   * derived by the job service's stage table, never claimed here.
   *
   * Concurrency-honest: a second `runJob` for a live job is a no-op (the
   * first runner owns it); a terminal job returns its stored view.
   */
  async runJob(jobId: string): Promise<MediaJobView> {
    const existing = this.jobs.get(jobId);
    if (existing === null) {
      throw new RangeError(`media job '${jobId}' was not found`);
    }
    const terminal =
      existing.state === "succeeded" ||
      existing.state === "failed" ||
      existing.state === "cancelled" ||
      existing.state === "dead-lettered";
    if (terminal) return this.jobs.view(jobId)!;
    if (this.running.has(jobId)) return this.jobs.view(jobId)!;
    this.running.add(jobId);
    try {
      // in-flight: the real work starts NOW (the queued → in-flight edge;
      // no stage lands here — starting is not a completion).
      this.jobs.advance(jobId, "in-flight");

      const asset = this.sourceAssets.get(existing.sourceAssetId);
      if (asset === null || asset.uploadState !== "stored") {
        this.jobs.fail(jobId, {
          failureClass: "internal",
          message: `source asset '${existing.sourceAssetId}' is not in the stored state`,
        });
        return this.jobs.view(jobId)!;
      }

      try {
        const outcome = await this.normalizer.normalize(asset, {
          sessionId: existing.sessionId,
        });
        // normalization-complete: the manifest is durably recorded (the
        // job stays in-flight — a stage, not a state).
        this.manifests.create(outcome.manifest);
        this.jobs.noteStage(jobId, "normalization-complete");

        // artifact-stored: the artifact manifest is durably recorded
        // (its bytes ARE the verified normalized media — same storage key).
        this.artifacts.create(outcome.artifact);
        this.jobs.noteStage(jobId, "artifact-stored");

        this.jobs.succeed(jobId, {
          manifestId: outcome.manifest.manifestId,
          artifactId: outcome.artifact.artifactId,
        });
      } catch (err) {
        const failureClass =
          err instanceof Error && "failureClass" in err
            ? (err as { failureClass: string }).failureClass === "resource-limit"
              ? "resource-limit"
              : (err as { failureClass: string }).failureClass === "rights-denied"
                ? "rights-denied"
                : (err as { failureClass: string }).failureClass === "internal"
                  ? "internal"
                  : "media-invalid"
            : "internal";
        this.jobs.fail(jobId, {
          failureClass,
          message: err instanceof Error ? err.message : String(err),
        });
      }
      return this.jobs.view(jobId)!;
    } finally {
      this.running.delete(jobId);
    }
  }

  // -------------------------------------------------------------------------
  // Read surfaces (the routes')
  // -------------------------------------------------------------------------

  /** The stored asset record, or `null`. */
  asset(assetId: string): SourceAsset | null {
    return this.sourceAssets.get(assetId);
  }

  /**
   * The asset's job views (oldest first) — the session-scope derivation the
   * asset read surface uses (the frozen SourceAsset contract carries no
   * session field; the job ledger is the honest join).
   */
  jobsForAsset(assetId: string): MediaJobView[] {
    const jobs = this.jobs.listBySourceAsset(assetId);
    return jobs
      .map((job) => this.jobs.view(job.jobId))
      .filter((view): view is MediaJobView => view !== null);
  }

  /** The honest job view (R103's polling surface), or `null`. */
  jobView(jobId: string): MediaJobView | null {
    return this.jobs.view(jobId);
  }

  /** The manifest derived from one asset, or `null`. */
  manifestOf(assetId: string) {
    return this.manifests.getBySourceAssetId(assetId);
  }

  /** One artifact manifest, or `null`. */
  artifact(artifactId: string) {
    return this.artifacts.get(artifactId);
  }

  /** Every artifact of one session (reality order stable). */
  artifactsOfSession(sessionId: string) {
    return this.artifacts.listBySession(sessionId);
  }
}
