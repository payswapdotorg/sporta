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
import {
  ComputeJobConstraints,
  ComputeRightsPosture,
  ComputeCostUnit,
} from "@sporta/compute-adapter";
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

/**
 * The closed set of REAL media operations this profile executes. The
 * `decode-probe`/`decode-frames` pair is the R607 Gap 1 ADDITIVE extension
 * (the TL-authorized seam): the R207 real-to-SWM decode dispatched over
 * the same wire — `decode-probe` answers the demux-level probe document the
 * R207 pipeline consumes, `decode-frames` answers ONE bounded frame batch
 * for a `[fromMs, toMs)` window (the pipeline's `decodeVideo` iteration
 * becomes a single bounded fetch, which its own decode budget
 * `STUDIO_UPLOAD_DECODE_BUDGET_BYTES` already implies). The `encode-frames`
 * operation is the R306 ENCODE-SEAM ADDITIVE extension (the same seam-class,
 * the G12 walk's named next gap): the derived-reality plane's mechanical
 * rgb24-frame-sequence → h264/MP4 encode, executed by the SAME
 * `FfmpegFrameEncoder` the local path runs (the exact argv, the exact
 * determinism knobs) — one operation serves BOTH encode surfaces (the R306
 * `FrameEncoderPort` AND the R301 `TacticalVideoCodec`, whose mechanical
 * legs are the identical rawvideo → libx264 transcode). The existing
 * `probe`/`normalize` operations are untouched.
 */
export const MediaToolchainOperation = z.enum([
  "probe",
  "normalize",
  "decode-probe",
  "decode-frames",
  "encode-frames",
]);
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
    /**
     * The bytes' container family. "mp4": an MP4 container (magic-byte
     * checked at the dispatching side — the upload/decode rail). "rgb24":
     * a packed raw RGB24 frame sequence (`frameCount × width × height × 3`
     * bytes — the encode-frames rail; the R306 encode seam's source family).
     * ADDITIVE enum growth — every pre-extension dispatch carries "mp4".
     */
    container: z.enum(["mp4", "rgb24"]),
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
 * THE decode-frames window (the R607 Gap 1 bounded-window shape): the
 * video stream to decode (the pipeline selects it from the decode-probe's
 * track inventory), the `[fromMs, toMs)` media-timeline slice, and the
 * cumulative decoded-byte budget — the same `DecodeWindow` semantics the
 * W102 boundary enforces (`exceeding it terminates the iteration with a
 * `resource-limit` error`). Rides the job description of a
 * `decode-frames` dispatch ONLY (enforced below).
 */
export const MediaToolchainDecodeWindow = z
  .object({
    /** The demuxer stream index to decode (from the decode-probe inventory). */
    streamIndex: z.number().int().min(0),
    /** Inclusive window start in ms (default 0 — the W102 semantics). */
    fromMs: z.number().finite().min(0).optional(),
    /** Exclusive window end in ms (default: end of stream). */
    toMs: z.number().finite().positive().optional(),
    /** Cumulative decoded-frame byte budget for this fetch (fail-closed). */
    maxTotalBytes: z.number().int().positive(),
  })
  .strict();
export type MediaToolchainDecodeWindow = z.infer<typeof MediaToolchainDecodeWindow>;

/**
 * THE encode-frames spec (the R306 encode seam's mechanical frame-sequence
 * description): the geometry + frame rate of the packed rgb24 byte
 * sequence riding the dispatch — the exact fields the local
 * `FfmpegFrameEncoder`'s `admitGeometry`/`admitSource` re-validate against
 * the bytes (the byte-math `byteSize === frameCount × width × height × 3`
 * is enforced by the REAL adapter at the worker, fail-closed). Rides the
 * job description of an `encode-frames` dispatch ONLY (enforced below).
 */
export const MediaToolchainEncodeSpec = z
  .object({
    /** The frame count of the packed sequence (integer >= 1). */
    frameCount: z.number().int().min(1),
    /** Frame width in pixels (integer >= 16 — the local adapter's own bound). */
    width: z.number().int().min(16),
    /** Frame height in pixels (integer >= 16 — the local adapter's own bound). */
    height: z.number().int().min(16),
    /** Frames per second (may be fractional, e.g. 12.5; finite > 0). */
    fps: z.number().finite().positive(),
  })
  .strict();
export type MediaToolchainEncodeSpec = z.infer<typeof MediaToolchainEncodeSpec>;

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
    /**
     * The decode-frames window (present iff operation === "decode-frames";
     * enforced). ADDITIVE — absent on every probe/normalize dispatch.
     */
    decodeWindow: MediaToolchainDecodeWindow.optional(),
    /**
     * The encode-frames spec (present iff operation === "encode-frames";
     * enforced). ADDITIVE — absent on every probe/normalize/decode dispatch.
     */
    encodeSpec: MediaToolchainEncodeSpec.optional(),
  })
  .strict()
  .superRefine((job, ctx) => {
    if (job.operation !== "decode-frames" && job.decodeWindow !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["decodeWindow"],
        message: `decodeWindow is only legal on a decode-frames dispatch (got "${job.operation}")`,
      });
    }
    if (job.operation === "decode-frames" && job.decodeWindow === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["decodeWindow"],
        message: "a decode-frames dispatch must carry its bounded window (decodeWindow)",
      });
    }
    if (job.operation !== "encode-frames" && job.encodeSpec !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["encodeSpec"],
        message: `encodeSpec is only legal on an encode-frames dispatch (got "${job.operation}")`,
      });
    }
    if (job.operation === "encode-frames" && job.encodeSpec === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["encodeSpec"],
        message: "an encode-frames dispatch must carry its frame-sequence spec (encodeSpec)",
      });
    }
    if (job.operation === "encode-frames" && job.source.container !== "rgb24") {
      ctx.addIssue({
        code: "custom",
        path: ["source", "container"],
        message: `an encode-frames dispatch's source claims must carry the rgb24 container family (got "${job.source.container}")`,
      });
    }
    if (job.operation !== "encode-frames" && job.source.container !== "mp4") {
      ctx.addIssue({
        code: "custom",
        path: ["source", "container"],
        message: `a ${job.operation} dispatch's source claims must carry the mp4 container family (got "${job.source.container}")`,
      });
    }
  });
export type MediaToolchainJobDescription = z.infer<typeof MediaToolchainJobDescription>;

/**
 * The materialized source input: the bytes themselves, inline
 * (base64). The Wave-1 materialized layer refuses this kind honestly
 * ("no source-frame transport"); the media-toolchain profile carries the
 * bytes inline because a stateless toolchain worker cannot resolve
 * in-memory refs — exactly the stateless-worker shape
 * `ComputeDispatchRequest` established for the swm kinds.
 *
 * The input kind is CLOSED and PAIRED to the operation (enforced on the
 * dispatch request): `source-media` for the probe/normalize/decode rail
 * (convention inputId "source-media"), `rgb24-frames` for the encode-frames
 * rail (convention inputId "frame-sequence" — the R306 encode seam's
 * packed frame sequence). ADDITIVE enum growth — every pre-extension
 * dispatch carries "source-media".
 */
export const MediaToolchainMaterializedSource = z
  .object({
    /** The manifest-style identity of this input (convention: "source-media" / "frame-sequence"). */
    inputId: nonEmpty,
    /** The input kind (closed: the two materializable media kinds). */
    kind: z.enum(["source-media", "rgb24-frames"]),
    /** The source bytes, base64-encoded (standard alphabet, no wrapping). */
    contentBase64: z.string().min(1),
  })
  .strict();
export type MediaToolchainMaterializedSource = z.infer<typeof MediaToolchainMaterializedSource>;

/**
 * The wire request of one media-toolchain dispatch: the transport-safe job
 * description PLUS its materialized source input. The input kind is paired
 * fail-closed to the operation (an encode-frames dispatch carries its
 * rgb24 frame sequence; every other operation carries source media).
 */
export const MediaToolchainDispatchRequest = z
  .object({
    job: MediaToolchainJobDescription,
    source: MediaToolchainMaterializedSource,
  })
  .strict()
  .superRefine((dispatch, ctx) => {
    const wantsFrames = dispatch.job.operation === "encode-frames";
    const carriesFrames = dispatch.source.kind === "rgb24-frames";
    if (wantsFrames !== carriesFrames) {
      ctx.addIssue({
        code: "custom",
        path: ["source", "kind"],
        message:
          `the materialized input kind must match the operation (operation "${dispatch.job.operation}" ` +
          `carries input kind "${dispatch.source.kind}" — an encode-frames dispatch carries its rgb24 frame sequence, every other operation carries source media)`,
      });
    }
  });
export type MediaToolchainDispatchRequest = z.infer<typeof MediaToolchainDispatchRequest>;

// ---------------------------------------------------------------------------
// The measured probe document (structurally pinned to ffmpeg.ts's MediaProbe)
// ---------------------------------------------------------------------------

/**
 * One ffprobe stream entry — EXTERNAL data (the real ffprobe JSON), so the
 * schema mirrors only the fields this contract reads and STRIPS the rest
 * (zod's default): the measured evidence fields are preserved verbatim.
 */
export const MediaToolchainProbeStream = z.object({
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
export const MediaToolchainProbeRaw = z.object({
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

// ---------------------------------------------------------------------------
// The decode-probe / decode-frames results (R607 Gap 1 — the ADDITIVE wire
// shapes the R207 real-to-SWM decode consumes)
// ---------------------------------------------------------------------------

/**
 * One demuxed track of the decode-probe document — the W102 `TrackInfo`
 * shape (`@sporta/decoding`'s `ProbeResult.tracks`) mirrored on the wire:
 * every field MEASURED by the real ffprobe at the worker, structurally
 * pinned to the exact document the R207 pipeline's track selection
 * consumes (`probe.tracks.find(track => track.kind === "video")`).
 */
export const MediaToolchainDecodeTrack = z
  .object({
    /** Stable track id: `t-<streamIndex>-<kind>` (the W102 convention). */
    trackId: nonEmpty,
    /** The demuxer stream index (the decode-frames window's selector). */
    streamIndex: z.number().int(),
    /** The track kind (the two first-class media track kinds). */
    kind: z.enum(["video", "audio"]),
    /** Codec short name as reported by the demuxer. */
    codec: z.string(),
    /** ISO 639 language tag when the container declares one. */
    language: z.string().optional(),
    /** Stream start offset on the media timeline (ms, rounded). */
    startTimeMs: z.number().int(),
    /** Stream duration in ms (rounded; container fallback already applied). */
    durationMs: z.number().int(),
  })
  .strict();
export type MediaToolchainDecodeTrack = z.infer<typeof MediaToolchainDecodeTrack>;

/**
 * The decode-probe document — the W102 `ProbeResult` mirrored on the wire:
 * the video/audio track inventory, the container family, and the
 * whole-source duration. The SAME document the R207 pipeline consumes from
 * its local `DecodingService.probe` (the design record's "the probe
 * document the R207 pipeline consumes"); the client-side port hands it to
 * the pipeline's unchanged track selection.
 */
export const MediaToolchainDecodeProbe = z
  .object({
    /** Every video/audio track (data/subtitle streams skipped — the W102 rule). */
    tracks: z.array(MediaToolchainDecodeTrack),
    /** The container family (mirrored from the source receipt). */
    container: z.enum(["mp4", "webm", "mkv", "mpegts", "avi"]),
    /** Whole-source duration in ms. */
    durationMs: z.number().int(),
  })
  .strict();
export type MediaToolchainDecodeProbe = z.infer<typeof MediaToolchainDecodeProbe>;

/**
 * One decoded video frame of the bounded batch — the W102
 * `NormalizedVideoFrame` mirrored on the wire with the pixels carried as
 * base64 (`rgb24` packed, `byteLength === width * height * 3` — re-validated
 * at the RECEIVING boundary by the same W102 output-validation discipline;
 * a lying frame is a typed refusal, never interpreted).
 */
export const MediaToolchainDecodedFrame = z
  .object({
    /** Frame id: `f-<streamIndex>-<decodeOrder>` (the W102 convention). */
    frameId: nonEmpty,
    /** The stream the frame was decoded from. */
    streamIndex: z.number().int(),
    /** Presentation position on the media timeline (ms). */
    presentationMs: z.number().finite(),
    /** Decode-order position within this batch, starting at 0. */
    decodeOrder: z.number().int().min(0),
    /** Frame width in pixels. */
    width: z.number().int().min(1),
    /** Frame height in pixels. */
    height: z.number().int().min(1),
    /** The fixed normalized pixel format (packed RGB, 3 bytes per pixel). */
    pixelFormat: z.literal("rgb24"),
    /** The frame pixels, base64-encoded (`width * height * 3` bytes). */
    contentBase64: z.string().min(1),
  })
  .strict();
export type MediaToolchainDecodedFrame = z.infer<typeof MediaToolchainDecodedFrame>;

/**
 * The decode-frames result: ONE bounded base64 frame batch for the
 * dispatch's window — the single bounded fetch the R207 pipeline's
 * `decodeVideo` iteration becomes over this seam (the design's own words).
 * The batch is bounded fail-closed by the request's `maxTotalBytes` AND the
 * worker's `maxDecodedFrameBytes` budget (defense in depth — the W914
 * budget doctrine); an over-budget batch is refused `resource-limit`,
 * never truncated silently.
 */
export const MediaToolchainDecodedFrames = z
  .object({
    /** The decoded frames, in decode order (may be empty — the window's honest answer). */
    frames: z.array(MediaToolchainDecodedFrame),
    /** The measured total decoded bytes of the batch (the budget's meter). */
    totalBytes: z.number().int().min(0),
  })
  .strict();
export type MediaToolchainDecodedFrames = z.infer<typeof MediaToolchainDecodedFrames>;

// ---------------------------------------------------------------------------
// The encode-frames result (R306 — the ADDITIVE wire shape the derived-reality
// plane's encode consumes; the R306 FrameEncodeResult mirrored on the wire)
// ---------------------------------------------------------------------------

/**
 * The pinned codec parameters of one REAL encode — `@sporta/encoding`'s
 * `EncodedCodecParams` mirrored on the wire (every field MEASURED by the
 * worker's own `FfmpegFrameEncoder`: the container/codec identities, the
 * deterministic argv summary, the pinned preset/tune/profile/level/crf/
 * pix_fmt/gop/threads, and the bitexact flag). Structurally pinned to the
 * exact document the R306 bridges record in every container manifest.
 */
export const MediaToolchainEncodedCodecParams = z
  .object({
    /** The container identity ("mp4" for the real adapter). */
    container: nonEmpty,
    /** The video codec identity ("avc1.42E01E" for the real adapter). */
    videoCodec: nonEmpty,
    /** The encoder argv/derivation summary (deterministic, human-readable). */
    encoder: nonEmpty,
    preset: nonEmpty,
    tune: z.string().nullable(),
    profile: nonEmpty,
    level: nonEmpty,
    crf: z.number().nullable(),
    pixFmt: nonEmpty,
    gop: z.number().int().nullable(),
    threads: z.number().int().min(1),
    bitexact: z.boolean(),
  })
  .strict();
export type MediaToolchainEncodedCodecParams = z.infer<typeof MediaToolchainEncodedCodecParams>;

/**
 * The encode-frames result — the R306 `FrameEncodeResult` mirrored on the
 * wire: the REAL encoded MP4 bytes (inline, base64) plus their MEASURED
 * identity (the content address re-hashed at BOTH boundaries, the geometry,
 * the clip duration `round(frameCount · 1000 / fps)` — enforced below — and
 * the worker's own adapter identity: the kind, the probed version, and the
 * pinned codec parameters actually used). The dispatching side re-measures
 * every claim at the receiving boundary (the same discipline the decode
 * batch carries): a lying hash, byte count, or geometry is a typed refusal,
 * never interpreted.
 */
export const MediaToolchainEncodedOutput = z
  .object({
    /** sha-256 of the encoded MP4 bytes (64 lowercase hex; re-measured at the worker AND the client). */
    contentHash: sha256Hex,
    /** The encoded MP4's byte length (equals the delivered content's). */
    byteSize: z.number().int().min(1),
    /** The encoded frame count (equals the dispatch's encodeSpec.frameCount — enforced). */
    frameCount: z.number().int().min(1),
    /** Frame width in pixels (equals the dispatch's encodeSpec.width — enforced). */
    width: z.number().int().min(16),
    /** Frame height in pixels (equals the dispatch's encodeSpec.height — enforced). */
    height: z.number().int().min(16),
    /** Frames per second (equals the dispatch's encodeSpec.fps — enforced). */
    fps: z.number().finite().positive(),
    /** The clip duration: `round(frameCount · 1000 / fps)` ms (enforced). */
    durationMs: z.number().int().positive(),
    /** The worker adapter's identity ("ffmpeg-libx264" — the SAME kind the local path records). */
    encoderKind: nonEmpty,
    /** The worker adapter's probed version (the REMOTE build's measured line). */
    encoderVersion: z.string().nullable(),
    /** The pinned codec parameters actually used (MEASURED by the worker's adapter). */
    codec: MediaToolchainEncodedCodecParams,
    /** The encoded MP4 bytes, base64-encoded (inline delivery mode). */
    contentBase64: z.string().min(1),
  })
  .strict()
  .superRefine((output, ctx) => {
    if (output.durationMs !== Math.round((output.frameCount * 1000) / output.fps)) {
      ctx.addIssue({
        code: "custom",
        path: ["durationMs"],
        message: `durationMs must be round(frameCount · 1000 / fps) = ${Math.round(
          (output.frameCount * 1000) / output.fps,
        )} (got ${output.durationMs})`,
      });
    }
  });
export type MediaToolchainEncodedOutput = z.infer<typeof MediaToolchainEncodedOutput>;

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
    /** REAL ffmpeg invocations (the canonical transcodes / rawvideo decodes). */
    ffmpegRuns: z.number().int().min(0),
    /** Source bytes measured inbound (the verified claim). */
    inputBytes: z.number().int().min(0),
    /** Normalized bytes measured outbound (0 for probe-only jobs). */
    outputBytes: z.number().int().min(0),
    /**
     * Decoded frames delivered (decode-frames jobs ONLY). ADDITIVE —
     * optional so every pre-extension probe/normalize envelope stays valid.
     */
    decodedFrames: z.number().int().min(0).optional(),
    /**
     * Decoded frame bytes delivered (decode-frames jobs ONLY; equals
     * `decodedFrames` output). ADDITIVE — optional, same compat rule.
     */
    decodedFrameBytes: z.number().int().min(0).optional(),
  })
  .strict();
export type MediaToolchainMetering = z.infer<typeof MediaToolchainMetering>;

/**
 * The result envelope of one executed media-toolchain job: success carries
 * the operation's MEASURED outcome (the probe for `probe`, the normalized
 * output + the original-reality artifact for `normalize`, the encoded
 * output for `encode-frames`); failure carries the classified refusal.
 * Both carry the worker's metering counters. The envelope NEVER throws
 * across the wire and is never silent.
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
    /** Present iff operation === "decode-probe" AND status === "succeeded". */
    decodeProbe: MediaToolchainDecodeProbe.optional(),
    /** Present iff operation === "decode-frames" AND status === "succeeded". */
    decodedFrames: MediaToolchainDecodedFrames.optional(),
    /** Present iff operation === "encode-frames" AND status === "succeeded". ADDITIVE. */
    encoded: MediaToolchainEncodedOutput.optional(),
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
    if (
      envelope.operation === "probe" &&
      (envelope.normalized !== undefined ||
        envelope.artifact !== undefined ||
        envelope.decodeProbe !== undefined ||
        envelope.decodedFrames !== undefined ||
        envelope.encoded !== undefined)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["normalized"],
        message: "a probe job must not carry normalized output, an artifact, or decode results",
      });
    }
    if (
      envelope.operation === "probe" &&
      envelope.status === "succeeded" &&
      envelope.sourceProbe === undefined
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["sourceProbe"],
        message: "a succeeded probe job must carry the measured source probe",
      });
    }
    if (envelope.operation === "normalize") {
      if (
        envelope.sourceProbe !== undefined ||
        envelope.decodeProbe !== undefined ||
        envelope.decodedFrames !== undefined ||
        envelope.encoded !== undefined
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["sourceProbe"],
          message:
            "a normalize job must not carry a source probe or decode results (the output probe is the manifest's source)",
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
              message:
                "the artifact's contentHash must equal the normalized output's (the content address)",
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
    if (envelope.operation === "decode-probe") {
      if (
        envelope.sourceProbe !== undefined ||
        envelope.normalized !== undefined ||
        envelope.artifact !== undefined ||
        envelope.decodedFrames !== undefined ||
        envelope.encoded !== undefined
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["decodeProbe"],
          message: "a decode-probe job must carry ONLY its decode probe document",
        });
      }
      if (envelope.status === "succeeded" && envelope.decodeProbe === undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["decodeProbe"],
          message: "a succeeded decode-probe job must carry the measured decode probe document",
        });
      }
    }
    if (envelope.operation === "decode-frames") {
      if (
        envelope.sourceProbe !== undefined ||
        envelope.normalized !== undefined ||
        envelope.artifact !== undefined ||
        envelope.decodeProbe !== undefined ||
        envelope.encoded !== undefined
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["decodedFrames"],
          message: "a decode-frames job must carry ONLY its bounded frame batch",
        });
      }
      if (envelope.status === "succeeded" && envelope.decodedFrames === undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["decodedFrames"],
          message: "a succeeded decode-frames job must carry the measured bounded frame batch",
        });
      }
      if (
        envelope.decodedFrames !== undefined &&
        envelope.metering.decodedFrames !== undefined &&
        envelope.metering.decodedFrames !== envelope.decodedFrames.frames.length
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["metering"],
          message: "the metering's decodedFrames must equal the delivered batch's frame count",
        });
      }
      if (
        envelope.decodedFrames !== undefined &&
        envelope.metering.decodedFrameBytes !== undefined &&
        envelope.metering.decodedFrameBytes !== envelope.decodedFrames.totalBytes
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["metering"],
          message: "the metering's decodedFrameBytes must equal the delivered batch's totalBytes",
        });
      }
    }
    if (envelope.operation === "encode-frames") {
      if (
        envelope.sourceProbe !== undefined ||
        envelope.normalized !== undefined ||
        envelope.artifact !== undefined ||
        envelope.decodeProbe !== undefined ||
        envelope.decodedFrames !== undefined
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["encoded"],
          message: "an encode-frames job must carry ONLY its encoded output",
        });
      }
      if (envelope.status === "succeeded" && envelope.encoded === undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["encoded"],
          message: "a succeeded encode-frames job must carry the measured encoded output",
        });
      }
      if (
        envelope.encoded !== undefined &&
        envelope.metering.outputBytes !== envelope.encoded.byteSize
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["metering"],
          message: "the metering's outputBytes must equal the encoded output's byteSize",
        });
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
        /**
         * The decode-frames batch bound (R607 Gap 1 — the frame-budget
         * axis; ADDITIVE alongside the existing four).
         */
        maxDecodedFrameBytes: z.number().int().positive(),
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
  /**
   * Maximum decoded-frame batch byte length per decode-frames dispatch
   * (fail-closed; the request's own `maxTotalBytes` bound applies FIRST —
   * the R607 Gap 1 frame-budget axis, the W914 budget doctrine: the batch
   * is refused `resource-limit`, never truncated silently).
   */
  maxDecodedFrameBytes: number;
}

/** The default budgets (see MediaToolchainBudgets for the derivation). */
export const DEFAULT_MEDIA_TOOLCHAIN_BUDGETS: MediaToolchainBudgets = Object.freeze({
  maxExecutionMs: 120_000,
  maxSourceBytes: 200 * 1024 * 1024,
  maxArtifactBytes: 200 * 1024 * 1024,
  maxConcurrentJobs: 1,
  // The R207 studio upload path's own deliberate decode budget
  // (STUDIO_UPLOAD_DECODE_BUDGET_BYTES = 1 GiB) — the frame-budget axis
  // default derives from the consuming pipeline's recorded bound so the
  // worker budget never silently degrades a compliant dispatch; the
  // REQUEST's window bound is always the tighter authority.
  maxDecodedFrameBytes: 1024 * 1024 * 1024,
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
 * - `frame-budget-exceeded` — the decoded frame batch exceeded the
 *   fail-closed frame budget `min(decodeWindow.maxTotalBytes,
 *   maxDecodedFrameBytes)` (non-retryable, resource-limit; outputs
 *   discarded — the R607 Gap 1 frame-budget axis, the same class the local
 *   W102 boundary's `DecodeWindow.maxTotalBytes` enforcement produces);
 * - `frames-invalid` — the encode-frames dispatch's packed frame sequence
 *   is malformed (geometry below the local adapter's own bounds, or the
 *   byte-math `byteSize === frameCount × width × height × 3` disagrees —
 *   the R306 encode seam's admission axis, the same class the LOCAL
 *   `FfmpegFrameEncoder`'s `admitGeometry`/`admitSource` produce)
 *   (non-retryable, media-invalid);
 * - `encode-failed` — the REAL ffmpeg encode failed at the worker (spawn
 *   fault, non-zero exit, timeout kill, no output — the local
 *   `encode-failed` class carried over the wire) (internal; outputs
 *   discarded — never partial bytes, never a fabricated artifact);
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
  "frame-budget-exceeded",
  "frames-invalid",
  "encode-failed",
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
  {
    unitId: "artifact-bytes",
    unitKind: "bytes",
    description: "normalized artifact bytes produced",
  },
];

/** The media-toolchain adapter identity (names logs and usage records). */
export const MEDIA_TOOLCHAIN_ADAPTER_ID = "sporta.compute.hosted.media";

/** The provider identity this profile executes as. */
export const MEDIA_TOOLCHAIN_PROVIDER_ID = "sporta-media-toolchain-worker-1";

/** The adapter version of this worker implementation. */
export const MEDIA_TOOLCHAIN_ADAPTER_VERSION = "0.1";
