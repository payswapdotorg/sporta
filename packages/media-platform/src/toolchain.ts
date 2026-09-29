/**
 * THE MEDIA TOOLCHAIN SEAM CONTRACT (R607 lane B — the W914 http compute
 * adapter against a REAL toolchain worker): the typed, JSON-safe wire shapes
 * ONE media-toolchain dispatch crosses, plus the execution port the
 * media platform routes its REAL ffmpeg/ffprobe operations through.
 *
 * ## Why this seam exists (the measured blocker it closes)
 *
 * The R607 hosted acceptance proved the control plane (identity, session,
 * library, watch, artifacts — recovered byte-identical across a redeploy)
 * and measured-blocked the MEDIA half: the hosted Node serverless runtime
 * ships no ffmpeg/ffprobe, so upload is refused at admission with the typed
 * ffprobe-absent class (nothing faked, nothing stored). Closing it requires
 * "the W914 http compute adapter against a real toolchain worker" — this
 * module is that seam's CONTRACT: the SAME real media operations
 * (ffprobe admission probing, ffmpeg normalization) execute either
 * in-process (the default — byte-identical behavior, `./toolchain-executor.ts`)
 * or behind real HTTP on a toolchain-capable worker
 * (`./toolchain-http.ts` — the composition's configuration decides, never
 * the domain).
 *
 * ## Vocabulary discipline (behind the compute-adapter contract, ADDITIVE)
 *
 * The dispatch reuses the Wave-1 `@sporta/compute-adapter` contract
 * VERBATIM wherever a live precedent exists — `ComputeRightsPosture` (the
 * fail-closed rights posture that travels with the job),
 * `ComputeJobConstraints` (deadlineMs + the advisory scheduling fields),
 * `ComputeCostUnit` (the metering currency a descriptor declares) — and the
 * envelope vocabulary follows the hosted worker's precedent
 * (`./compute-adapter-hosted/src/envelope.ts`): every outcome is a
 * classified value, never a thrown error across the wire, never silence.
 * The media-specific additions (`operation`, the `source-media` materialized
 * input, the measured probe/artifact documents) are the documented
 * media-toolchain profile of the same contract — additive, typed, strict.
 *
 * The Wave-1 materialized-input layer deliberately refuses `source-media`
 * payloads ("no source-frame transport" — its frozen honesty); this module
 * defines the media profile's OWN dispatch request carrying the source
 * bytes inline (base64) alongside the job description, so the frozen
 * contract package is left untouched.
 */
import { z } from "zod";
import { ComputeJobConstraints, ComputeRightsPosture, ComputeCostUnit } from "@sporta/compute-adapter";
import type { ComputeCostUnit as ComputeCostUnitDoc } from "@sporta/compute-adapter";
import type { MediaProbe } from "./ffmpeg";

/** The media-toolchain wire schema version (closed "MAJOR.MINOR" format). */
export const MEDIA_TOOLCHAIN_SCHEMA_VERSION = "1.0";

/** Non-empty string helper. */
const nonEmpty = z.string().min(1);

/** sha-256 helper: 64 lowercase hex digits (the repo-wide content address). */
const sha256Hex = z.string().regex(/^[0-9a-f]{64}$/);

/** The schema-version field (the compute-adapter convention). */
const schemaVersionField = z.literal(MEDIA_TOOLCHAIN_SCHEMA_VERSION);

// ---------------------------------------------------------------------------
// The dispatch request (job description + the materialized source-media input)
// ---------------------------------------------------------------------------

/** The closed set of REAL media operations this profile executes. */
export const MediaToolchainOperation = z.enum(["probe", "normalize"]);
export type MediaToolchainOperation = z.infer<typeof MediaToolchainOperation>;

/**
 * The measured claims the dispatching side makes about the source bytes it
 * is sending. The worker NEVER trusts them: the received bytes are
 * re-measured (byte length, then sha-256) and a lying claim is a typed
 * refusal (fail-closed — a corrupt or lying dispatch is never interpreted).
 */
export const MediaToolchainSourceClaims = z
  .object({
    /** sha-256 of the source bytes (64 lowercase hex; re-measured at the worker). */
    contentHash: sha256Hex,
    /** The source's byte length (re-measured at the worker). */
    byteSize: z.number().int().min(1),
    /** The only accepted container (magic-byte checked at the dispatching side). */
    container: z.literal("mp4"),
  })
  .strict();
export type MediaToolchainSourceClaims = z.infer<typeof MediaToolchainSourceClaims>;

/**
 * The media policy that travels with the job (fail-closed, re-enforced at
 * the worker against the PRODUCED media — defense in depth over the
 * dispatching side's own admission checks).
 */
export const MediaToolchainMediaPolicy = z
  .object({
    /** Maximum accepted media duration in ms (re-measured on the OUTPUT probe). */
    maxDurationMs: z.number().int().positive(),
  })
  .strict();
export type MediaToolchainMediaPolicy = z.infer<typeof MediaToolchainMediaPolicy>;

/**
 * THE transport-safe media-toolchain job description: what the dispatching
 * side hands the toolchain worker. Identity (jobId + idempotencyKey),
 * session linkage, the operation, the measured source claims, the rights
 * posture (`ComputeRightsPosture` VERBATIM — a job that references source
 * frames without `canReferenceSourceFrames` is refused fail-closed), the
 * whole-job constraints (`ComputeJobConstraints` VERBATIM — `deadlineMs`
 * bounds the measured execution), and the media policy. No in-memory
 * object references, no implicit session state.
 */
export const MediaToolchainJobDescription = z
  .object({
    schemaVersion: schemaVersionField,
    /** Per-job identity (caller-authored, non-empty, unique per worker). */
    jobId: nonEmpty,
    /** Dedupe/claim-once identity — the worker's jobId idempotence key. */
    idempotencyKey: nonEmpty,
    /** The session the source media belongs to. */
    sessionId: nonEmpty,
    /** Which REAL media operation this job executes. */
    operation: MediaToolchainOperation,
    /** The measured claims about the source bytes (re-verified at the worker). */
    source: MediaToolchainSourceClaims,
    /** The rights posture traveling with the job (fail-closed at the worker). */
    rights: ComputeRightsPosture,
    /** Whole-job constraints (deadlineMs bounds the measured execution). */
    constraints: ComputeJobConstraints,
    /** The media policy re-enforced against the produced media. */
    mediaPolicy: MediaToolchainMediaPolicy,
  })
  .strict();
export type MediaToolchainJobDescription = z.infer<typeof MediaToolchainJobDescription>;

/**
 * The materialized `source-media` input: the bytes themselves, inline
 * (base64). The Wave-1 materialized layer refuses this kind honestly
 * ("no source-frame transport"); the media-toolchain profile carries the
 * bytes inline because a stateless toolchain worker cannot resolve
 * in-memory refs — exactly the stateless-worker shape
 * `ComputeDispatchRequest` established for the swm kinds.
 */
export const MediaToolchainMaterializedSource = z
  .object({
    /** The manifest-style identity of this input (convention: "source-media"). */
    inputId: nonEmpty,
    /** The input kind (closed: the only materializable media kind). */
    kind: z.literal("source-media"),
    /** The source bytes, base64-encoded (standard alphabet, no wrapping). */
    contentBase64: z.string().min(1),
  })
  .strict();
export type MediaToolchainMaterializedSource = z.infer<typeof MediaToolchainMaterializedSource>;

/**
 * The wire request of one media-toolchain dispatch: the transport-safe job
 * description PLUS its materialized source input.
 */
export const MediaToolchainDispatchRequest = z
  .object({
    job: MediaToolchainJobDescription,
    source: MediaToolchainMaterializedSource,
  })
  .strict();
export type MediaToolchainDispatchRequest = z.infer<typeof MediaToolchainDispatchRequest>;

// ---------------------------------------------------------------------------
// The measured probe document (structurally pinned to ffmpeg.ts's MediaProbe)
// ---------------------------------------------------------------------------

/**
 * One ffprobe stream entry — EXTERNAL data (the real ffprobe JSON), so the
 * schema mirrors only the fields this contract reads and STRIPS the rest
 * (zod's default): the measured evidence fields are preserved verbatim.
 */
export const MediaToolchainProbeStream = z
  .object({
    index: z.number().int().optional(),
    codec_type: z.string().optional(),
    codec_name: z.string().optional(),
    profile: z.string().optional(),
    width: z.number().int().optional(),
    height: z.number().int().optional(),
    avg_frame_rate: z.string().optional(),
    r_frame_rate: z.string().optional(),
    nb_frames: z.string().optional(),
    duration: z.union([z.number(), z.string()]).optional(),
    bit_rate: z.string().optional(),
    channels: z.number().int().optional(),
    sample_rate: z.string().optional(),
    sample_rate_hz: z.number().optional(),
  });
export type MediaToolchainProbeStream = z.infer<typeof MediaToolchainProbeStream>;

/** The raw ffprobe document — EXTERNAL data, same read-and-strip posture. */
export const MediaToolchainProbeRaw = z
  .object({
    streams: z.array(MediaToolchainProbeStream).optional(),
    format: z
      .object({
        duration: z.union([z.number(), z.string()]).optional(),
        format_name: z.string().optional(),
      })
      .optional(),
  });
export type MediaToolchainProbeRaw = z.infer<typeof MediaToolchainProbeRaw>;

/**
 * A MEASURED media probe over the wire. Structurally identical to
 * `./ffmpeg.ts`'s `MediaProbe` (every field MEASURED via the real ffprobe —
 * the client's `probeMedia(): Promise<MediaProbe>` return type is the
 * compile-time pin; the executor's envelope self-check is the runtime pin).
 */
export const MediaToolchainProbe = z
  .object({
    /** Container duration in ms (measured, rounded; > 0 enforced by callers). */
    durationMs: z.number().finite().positive(),
    /** Video streams (>= 1 for a valid media job — enforced by callers). */
    videoStreams: z.array(MediaToolchainProbeStream),
    /** Audio streams (may be empty — audio is optional). */
    audioStreams: z.array(MediaToolchainProbeStream),
    /** The primary video stream's measured average frame rate (fps). */
    frameRateFps: z.number().finite().positive(),
    /** The primary video stream's measured frame count (>= 1). */
    frameCount: z.number().finite().min(1),
    /** The raw ffprobe document (bounded evidence for error paths). */
    raw: MediaToolchainProbeRaw,
  })
  .strict();
export type MediaToolchainProbe = z.infer<typeof MediaToolchainProbe>;

// ---------------------------------------------------------------------------
// The result envelope (classified values — never a throw across the wire)
// ---------------------------------------------------------------------------

/**
 * The worker-measured failure of one executed media-toolchain job. The
 * terminal classification follows the hosted worker's envelope precedent;
 * `failureClass` additionally carries the media platform's four-class
 * vocabulary (`media-invalid` / `resource-limit` / `rights-denied` /
 * `internal`) so the dispatching side maps the refusal onto its OWN typed
 * errors without guessing.
 */
export const MediaToolchainFailure = z
  .object({
    /** Machine-readable failure class (the closed set is documented below). */
    errorClass: nonEmpty,
    /** Human-readable failure message (bounded, evidence-carrying). */
    message: nonEmpty,
    /** The terminal classification (the hosted-worker vocabulary). */
    terminal: z.enum(["non-retryable", "timeout", "internal"]),
    /** The media platform's four-class vocabulary of this refusal. */
    failureClass: z.enum(["media-invalid", "resource-limit", "rights-denied", "internal"]),
    /** Whether a retry could succeed (always false — determinate failures). */
    retryable: z.boolean(),
  })
  .strict();
export type MediaToolchainFailure = z.infer<typeof MediaToolchainFailure>;

/**
 * The original-reality artifact block the normalize operation produces: the
 * content-addressed identity of the normalized MP4, the HASH CHAIN back to
 * the source (the dispatch's verified source claim), and the frozen
 * renderer identity of the normalization pipeline — the measured fields of
 * the `RenderArtifactManifest` the dispatching side assembles and lands in
 * its own repositories (`./normalize.ts`).
 */
export const MediaToolchainArtifact = z
  .object({
    /** The reality this artifact belongs to (the normalization pipeline's own). */
    reality: z.literal("original"),
    /** sha-256 of the normalized MP4 bytes (MEASURED by the producer). */
    contentHash: sha256Hex,
    /** sha-256 of the SOURCE bytes (the verified dispatch claim — the chain). */
    sourceContentHash: sha256Hex,
    /** The normalized MP4's byte length (equals the delivered content's). */
    byteSize: z.number().int().min(1),
    /** The artifact container (the canonical faststart MP4). */
    container: z.literal("mp4"),
    /** The measured output video codec (e.g. "h264"). */
    videoCodec: z.string(),
    /** The measured output audio codec (null when the source carried no audio). */
    audioCodec: z.string().nullable(),
    /** The OUTPUT's measured duration in ms. */
    durationMs: z.number().int().positive(),
    /** The normalization pipeline's frozen renderer identity. */
    rendererId: z.string(),
    /** The normalization pipeline's frozen renderer version. */
    rendererVersion: z.string(),
    /** Protocol-clock reading when the artifact was produced. */
    generatedAtMs: z.number().finite(),
    /** The earned integrity mark (the producer re-measured the hash). */
    integrity: z.object({ algorithm: z.literal("sha256"), verified: z.literal(true) }).strict(),
  })
  .strict();
export type MediaToolchainArtifact = z.infer<typeof MediaToolchainArtifact>;

/**
 * The normalize operation's measured output: the content-addressed identity
 * (sha-256 MEASURED by the producer over the bytes it produced), the
 * OUTPUT's measured probe (the `MediaManifest`'s source of truth — the
 * manifest is derived from what was PRODUCED, never from what was
 * requested), and the inline delivery of the canonical faststart MP4.
 */
export const MediaToolchainNormalizedOutput = z
  .object({
    /** sha-256 of the normalized bytes (64 lowercase hex; re-measured at the worker). */
    contentHash: sha256Hex,
    /** The normalized MP4's byte length. */
    byteSize: z.number().int().min(1),
    /** The OUTPUT's measured probe. */
    probe: MediaToolchainProbe,
    /** The normalized MP4 bytes, base64-encoded (inline delivery mode). */
    contentBase64: z.string().min(1),
  })
  .strict();
export type MediaToolchainNormalizedOutput = z.infer<typeof MediaToolchainNormalizedOutput>;

/** The worker's per-job metering counters (the "metered" of the acceptance). */
export const MediaToolchainMetering = z
  .object({
    /** Protocol-clock reading when execution started (injected clock). */
    startedAtMs: z.number().finite(),
    /** Protocol-clock reading when execution finished (injected clock). */
    finishedAtMs: z.number().finite(),
    /** Measured execution duration in ms (finishedAtMs - startedAtMs). */
    executionMs: z.number().finite().min(0),
    /** REAL ffprobe invocations (the admission probes + the tool's own probes). */
    ffprobeRuns: z.number().int().min(0),
    /** REAL ffmpeg invocations (the canonical transcodes). */
    ffmpegRuns: z.number().int().min(0),
    /** Source bytes measured inbound (the verified claim). */
    inputBytes: z.number().int().min(0),
    /** Normalized bytes measured outbound (0 for probe-only jobs). */
    outputBytes: z.number().int().min(0),
  })
  .strict();
export type MediaToolchainMetering = z.infer<typeof MediaToolchainMetering>;

/**
 * The result envelope of one executed media-toolchain job: success carries
 * the operation's MEASURED outcome (the probe for `probe`, the normalized
 * output + the original-reality artifact for `normalize`); failure carries
 * the classified refusal. Both carry the worker's metering counters. The
 * envelope NEVER throws across the wire and is never silent.
 */
export const MediaToolchainResult = z
  .object({
    /** The job this envelope answers (echoed identity). */
    jobId: nonEmpty,
    /** The submitter-facing execution status. */
    status: z.enum(["succeeded", "failed"]),
    /** The operation that executed (echoed). */
    operation: MediaToolchainOperation,
    /** Present iff operation === "probe" AND status === "succeeded". */
    sourceProbe: MediaToolchainProbe.optional(),
    /** Present iff operation === "normalize" AND status === "succeeded". */
    normalized: MediaToolchainNormalizedOutput.optional(),
    /** Present iff operation === "normalize" AND status === "succeeded". */
    artifact: MediaToolchainArtifact.optional(),
    /** Present iff status === "failed". */
    failure: MediaToolchainFailure.optional(),
    /** The worker's metering counters for this job. */
    metering: MediaToolchainMetering,
  })
  .strict()
  .superRefine((envelope, ctx) => {
    if (envelope.status === "failed" && envelope.failure === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["failure"],
        message: 'status "failed" requires failure details',
      });
    }
    if (envelope.status !== "failed" && envelope.failure !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["failure"],
        message: `failure details are only legal when status is "failed" (got "${envelope.status}")`,
      });
    }
    if (envelope.operation === "probe" && (envelope.normalized !== undefined || envelope.artifact !== undefined)) {
      ctx.addIssue({
        code: "custom",
        path: ["normalized"],
        message: "a probe job must not carry normalized output or an artifact",
      });
    }
    if (envelope.operation === "probe" && envelope.status === "succeeded" && envelope.sourceProbe === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["sourceProbe"],
        message: "a succeeded probe job must carry the measured source probe",
      });
    }
    if (envelope.operation === "normalize") {
      if (envelope.sourceProbe !== undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["sourceProbe"],
          message: "a normalize job must not carry a source probe (the output probe is the manifest's source)",
        });
      }
      if (envelope.status === "succeeded") {
        if (envelope.normalized === undefined || envelope.artifact === undefined) {
          ctx.addIssue({
            code: "custom",
            path: ["normalized"],
            message: "a succeeded normalize job must carry the normalized output and the artifact",
          });
        } else {
          if (envelope.normalized.contentHash !== envelope.artifact.contentHash) {
            ctx.addIssue({
              code: "custom",
              path: ["artifact"],
              message: "the artifact's contentHash must equal the normalized output's (the content address)",
            });
          }
          if (envelope.normalized.byteSize !== envelope.artifact.byteSize) {
            ctx.addIssue({
              code: "custom",
              path: ["artifact"],
              message: "the artifact's byteSize must equal the normalized output's",
            });
          }
          if (envelope.normalized.probe.durationMs !== envelope.artifact.durationMs) {
            ctx.addIssue({
              code: "custom",
              path: ["artifact"],
              message: "the artifact's durationMs must be the output probe's measured duration",
            });
          }
        }
      }
    }
  });
export type MediaToolchainResult = z.infer<typeof MediaToolchainResult>;

// ---------------------------------------------------------------------------
// The adapter descriptor (honest capability discovery)
// ---------------------------------------------------------------------------

/**
 * The toolchain resolution record — the DESCRIPTOR HONESTY core: the worker
 * reports the ACTUALLY resolved ffmpeg/ffprobe paths and the measured
 * `ffmpeg -version` line. When the binaries do not resolve, `resolved` is
 * false and the worker advertises NO operations (nothing it cannot
 * execute), and every dispatch refuses with the typed `ffmpeg-unavailable`
 * class — the R607 boundary class, honest at the worker boundary.
 */
export const MediaToolchainResolution = z
  .object({
    /** The resolved ffmpeg binary path (null when unresolvable). */
    ffmpegPath: z.string().nullable(),
    /** The resolved ffprobe binary path (null when unresolvable). */
    ffprobePath: z.string().nullable(),
    /** The measured first `ffmpeg -version` line (null when unusable). */
    ffmpegVersion: z.string().nullable(),
    /** Whether the REAL toolchain is usable on this worker. */
    resolved: z.boolean(),
  })
  .strict();
export type MediaToolchainResolution = z.infer<typeof MediaToolchainResolution>;

/**
 * The media-toolchain worker's capability descriptor: the honest toolchain
 * resolution, the operations it can ACTUALLY execute (empty when the
 * toolchain is unresolved — never advertised beyond resolution), the
 * fail-closed budgets it enforces, and the cost units its metering reports
 * (the `ComputeCostUnit` contract VERBATIM).
 */
export const MediaToolchainDescriptor = z
  .object({
    schemaVersion: schemaVersionField,
    /** The adapter identity of this media-toolchain worker. */
    adapterId: nonEmpty,
    /** The adapter version ("MAJOR.MINOR" — the descriptor convention). */
    adapterVersion: nonEmpty,
    /** The provider identity this worker executes as (abstract, never a vendor). */
    providerId: nonEmpty,
    /** The provider kind (the compute-adapter closed vocabulary). */
    providerKind: z.enum(["in-memory", "cpu-worker", "gpu-worker", "managed-actor"]),
    /** The operations this worker can ACTUALLY execute (resolution-honest). */
    operations: z.array(MediaToolchainOperation),
    /** The honest toolchain resolution (see MediaToolchainResolution). */
    toolchain: MediaToolchainResolution,
    /** The fail-closed budgets (mirrored from the worker's resolved budgets). */
    budgets: z
      .object({
        maxExecutionMs: z.number().int().positive(),
        maxSourceBytes: z.number().int().positive(),
        maxArtifactBytes: z.number().int().positive(),
        maxConcurrentJobs: z.number().int().min(1),
      })
      .strict(),
    /** The metering currency (the W919 raw material). */
    costUnits: z.array(ComputeCostUnit).min(1),
  })
  .strict();
export type MediaToolchainDescriptor = z.infer<typeof MediaToolchainDescriptor>;

// ---------------------------------------------------------------------------
// The execution port (the seam the media platform routes through)
// ---------------------------------------------------------------------------

/** The measured outcome of one normalization execution. */
export interface MediaToolchainNormalization {
  /** The canonical normalized MP4 bytes (H.264/AAC faststart — real ffmpeg). */
  outputBytes: Uint8Array;
  /** The OUTPUT's measured probe (the manifest's source of truth). */
  outputProbe: MediaProbe;
  /** The worker-measured execution duration in ms (honest latency evidence). */
  executionMs: number;
}

/**
 * THE media toolchain execution seam: the two REAL media operations of the
 * upload→normalize pipeline, routed by configuration.
 *
 * - `InProcessMediaToolchain` (default — `./toolchain-executor.ts`): the
 *   REAL `FfmpegTool` in this process (`Bun.which`-resolved — the
 *   byte-identical default; the non-degradation law);
 * - `createHttpMediaToolchain` (`./toolchain-http.ts`): the SAME operations
 *   dispatched over real HTTP to a toolchain-capable compute worker
 *   (`@sporta/compute-adapter-hosted`'s media profile) — the seam the
 *   hosted control plane uses with an external toolchain worker URL.
 *
 * Failure honesty: both implementations fail with the media platform's
 * TYPED errors (`FfmpegUnavailableError`, `MediaInvalidError`,
 * `MediaRightsError`, ...). An absent toolchain (no ffmpeg resolvable
 * in-process, or an unreachable/unresolved worker) refuses with the typed
 * `FfmpegUnavailableError` — the admission boundary stays honest, nothing
 * is faked, nothing is stored.
 */
export interface MediaToolchainExecutor {
  /**
   * Probes media bytes through the REAL ffprobe (the R101 admission
   * validation): duration, stream inventory, measured frame rate/count.
   */
  probeMedia(bytes: Uint8Array): Promise<MediaProbe>;

  /**
   * Normalizes media bytes through the REAL ffmpeg to the canonical
   * H.264/AAC faststart MP4, returning the OUTPUT's measured probe (the
   * manifest is derived from what was PRODUCED, never from the request).
   */
  normalizeMedia(bytes: Uint8Array): Promise<MediaToolchainNormalization>;
}

// ---------------------------------------------------------------------------
// The fail-closed budgets (documented derivation)
// ---------------------------------------------------------------------------

/**
 * The fail-closed budgets of the media-toolchain worker profile. Defaults
 * derive from the media platform's own frozen bounds (R101): source bytes
 * ≤ 200 MB (`UPLOAD_CONSTRAINTS.maxBytes`), the media duration bound's
 * 120 s scale for execution (a canonical transcode of a bounded clip),
 * and ONE concurrent ffmpeg at a time (the memory discipline — a real
 * ffmpeg process holds the source, the encoder, and the output; the
 * worker refuses determinately rather than queue silently).
 */
export interface MediaToolchainBudgets {
  /** Maximum measured execution per job in ms (fail-closed; outputs discarded). */
  maxExecutionMs: number;
  /** Maximum accepted source byte length per dispatch (fail-closed). */
  maxSourceBytes: number;
  /** Maximum normalized artifact byte length (fail-closed; never handed back). */
  maxArtifactBytes: number;
  /** Maximum simultaneously executing jobs (integer >= 1; the memory discipline). */
  maxConcurrentJobs: number;
}

/** The default budgets (see MediaToolchainBudgets for the derivation). */
export const DEFAULT_MEDIA_TOOLCHAIN_BUDGETS: MediaToolchainBudgets = Object.freeze({
  maxExecutionMs: 120_000,
  maxSourceBytes: 200 * 1024 * 1024,
  maxArtifactBytes: 200 * 1024 * 1024,
  maxConcurrentJobs: 1,
});

/** Resolves caller-supplied partial budgets over the defaults. */
export function resolveMediaToolchainBudgets(
  overrides?: Partial<MediaToolchainBudgets>,
): MediaToolchainBudgets {
  return { ...DEFAULT_MEDIA_TOOLCHAIN_BUDGETS, ...overrides };
}

// ---------------------------------------------------------------------------
// The closed failure-class vocabulary (documented, additive)
// ---------------------------------------------------------------------------

/**
 * The media-toolchain profile's closed error-class vocabulary (the
 * `errorClass` of {@link MediaToolchainFailure}):
 *
 * - `invalid-dispatch` — the request is not a valid
 *   `MediaToolchainDispatchRequest` (non-retryable, internal);
 * - `source-size-mismatch` / `source-hash-mismatch` — the dispatch's
 *   measured claims LIE about the received bytes (non-retryable, internal
 *   — a corrupt dispatch is never interpreted);
 * - `source-too-large` — the source exceeds `maxSourceBytes`
 *   (non-retryable, resource-limit);
 * - `rights-denied` — the posture denies `canReferenceSourceFrames`
 *   (non-retryable, rights-denied — the pipeline references source frames);
 * - `ffmpeg-unavailable` — the REAL toolchain is not resolvable/usable on
 *   the worker (internal — the R607 boundary class, honest);
 * - `media-invalid` — the REAL ffprobe/ffmpeg refused the media (corrupt,
 *   unmeasurable, no video stream — non-retryable, media-invalid);
 * - `duration-over-limit` — the PRODUCED media exceeds the policy bound
 *   (non-retryable, media-invalid);
 * - `artifact-too-large` — the normalized artifact exceeds
 *   `maxArtifactBytes` (non-retryable, resource-limit; outputs discarded);
 * - `budget-exceeded` — the measured execution exceeded
 *   `min(maxExecutionMs, deadlineMs)` (timeout, resource-limit; outputs
 *   discarded);
 * - `invalid-envelope` — the constructed envelope failed its own schema
 *   (internal — fail-loud on a construction bug, never handed back).
 */
export const MEDIA_TOOLCHAIN_ERROR_CLASSES = [
  "invalid-dispatch",
  "source-size-mismatch",
  "source-hash-mismatch",
  "source-too-large",
  "rights-denied",
  "ffmpeg-unavailable",
  "media-invalid",
  "duration-over-limit",
  "artifact-too-large",
  "budget-exceeded",
  "invalid-envelope",
] as const;
export type MediaToolchainErrorClass = (typeof MEDIA_TOOLCHAIN_ERROR_CLASSES)[number];

/**
 * The worker's default cost units (the descriptor's currency, in the
 * `ComputeCostUnit` contract's shape — the W919 raw material).
 */
export const MEDIA_TOOLCHAIN_COST_UNITS: ComputeCostUnitDoc[] = [
  { unitId: "cpu-ms", unitKind: "time-ms", description: "measured media-toolchain execution time" },
  { unitId: "media-jobs", unitKind: "count", description: "executed media-toolchain jobs" },
  { unitId: "artifact-bytes", unitKind: "bytes", description: "normalized artifact bytes produced" },
];

/** The media-toolchain adapter identity (names logs and usage records). */
export const MEDIA_TOOLCHAIN_ADAPTER_ID = "sporta.compute.hosted.media";

/** The provider identity this profile executes as. */
export const MEDIA_TOOLCHAIN_PROVIDER_ID = "sporta-media-toolchain-worker-1";

/** The adapter version of this worker implementation. */
export const MEDIA_TOOLCHAIN_ADAPTER_VERSION = "0.1";
