/**
 * The media-toolchain HTTP CLIENT (R607 lane B — the W914 http compute
 * adapter seam): a {@link MediaToolchainExecutor} whose REAL media
 * operations are dispatched over real HTTP to a toolchain-capable compute
 * worker (the `@sporta/compute-adapter-hosted` media profile — a Bun-served
 * local worker, or the external toolchain worker URL a hosted control
 * plane configures).
 *
 * ## Honesty rules (the hosted-worker client precedent, restated)
 *
 * - the dispatch carries the source bytes INLINE (base64) with the
 *   client-measured claims (sha-256 + byte length) — the worker re-measures
 *   both and refuses lying claims fail-closed;
 * - every response envelope is validated fail-loud (a worker answering a
 *   result that is not a `MediaToolchainResult` is a LYING provider — the
 *   client refuses, never trusts);
 * - on success the delivered bytes are RE-HASHED and must equal the
 *   envelope's content address, and the artifact block's source hash must
 *   equal the hash of the bytes the client SENT (the end-to-end hash chain
 *   verified at the receiving boundary — the provider's claims are never
 *   trusted);
 * - a classified failure envelope maps onto the media platform's OWN typed
 *   errors by the envelope's carried `failureClass` (never guessed);
 * - a transport fault (unreachable worker, non-JSON answer, invalid
 *   envelope) resolves the typed `FfmpegUnavailableError` — the toolchain
 *   is unavailable, the pipeline fails closed, nothing is faked and
 *   nothing is stored.
 */
import {
  FfmpegUnavailableError,
  MediaIntegrityError,
  MediaInvalidError,
  MediaRightsError,
  MediaToolchainResourceError,
} from "./errors";
import type { MediaProbe } from "./ffmpeg";
import { randomMediaId } from "./ids";
import { sha256OfBytes } from "./storage";
import { UPLOAD_CONSTRAINTS } from "./service";
import { MediaToolchainDescriptor, MediaToolchainResult } from "./toolchain";
import type {
  MediaToolchainDescriptor as MediaToolchainDescriptorDoc,
  MediaToolchainDispatchRequest as MediaToolchainDispatchRequestDoc,
  MediaToolchainFailure as MediaToolchainFailureDoc,
  MediaToolchainNormalization,
  MediaToolchainResult as MediaToolchainResultDoc,
  MediaToolchainExecutor,
} from "./toolchain";

/** Options for {@link createHttpMediaToolchain}. */
export interface HttpMediaToolchainOptions {
  /** Override fetch (tests inject; default the global). */
  fetchFn?: typeof fetch;
  /** The whole-job deadline the dispatches carry (default 120 000 ms). */
  deadlineMs?: number;
  /** The media policy the dispatches carry (default: the frozen R101 bound). */
  mediaPolicy?: { maxDurationMs: number };
  /** The idempotency-key prefix for generated dispatch jobs (default "mtjob"). */
  jobIdPrefix?: string;
}

/** The shared error-body shape of every non-2xx answer. */
interface HttpErrorBody {
  error?: { errorClass?: string; message?: string; terminal?: string };
}

/** Maps a classified failure envelope onto the media platform's typed errors. */
function failureToError(failure: MediaToolchainFailureDoc): Error {
  switch (failure.failureClass) {
    case "rights-denied":
      return new MediaRightsError(failure.message);
    case "media-invalid":
      return new MediaInvalidError(failure.message);
    case "resource-limit":
      return new MediaToolchainResourceError(failure.message, {
        errorClass: failure.errorClass,
        terminal: failure.terminal,
      });
    case "internal":
      if (failure.errorClass === "ffmpeg-unavailable") {
        return new FfmpegUnavailableError(failure.message, { errorClass: failure.errorClass });
      }
      return new MediaIntegrityError(failure.message, { errorClass: failure.errorClass });
  }
}

/** Maps a non-2xx HTTP answer (the worker's classified refusal body) onto the typed errors. */
function httpErrorToError(status: number, body: HttpErrorBody | null): Error {
  const errorClass = body?.error?.errorClass ?? `http-${status}`;
  const message = body?.error?.message ?? `the media toolchain worker answered HTTP ${status}`;
  switch (errorClass) {
    case "capacity":
    case "source-too-large":
    case "artifact-too-large":
      return new MediaToolchainResourceError(`${errorClass}: ${message}`, { errorClass, status });
    case "rights-denied":
      return new MediaRightsError(`${errorClass}: ${message}`);
    case "media-invalid":
    case "duration-over-limit":
      return new MediaInvalidError(`${errorClass}: ${message}`);
    case "ffmpeg-unavailable":
      return new FfmpegUnavailableError(`${errorClass}: ${message}`);
    default:
      // An unrecognized refusal class or a transport-level non-2xx: the
      // honest posture is "the toolchain is unavailable", never silence.
      return new FfmpegUnavailableError(`${errorClass}: ${message}`, { status });
  }
}

/**
 * Creates the HTTP {@link MediaToolchainExecutor} against a media-toolchain
 * worker's base URL (e.g. `http://127.0.0.1:3971`): each operation is ONE
 * dispatch (a fresh jobId — the worker's idempotence key), POSTed to the
 * worker's `POST /v1/media/jobs/execute`, answered with the classified
 * result envelope this client validates fail-loud.
 */
export function createHttpMediaToolchain(
  workerUrl: string,
  options: HttpMediaToolchainOptions = {},
): MediaToolchainExecutor {
  const doFetch = options.fetchFn ?? fetch;
  const base = workerUrl.replace(/\/+$/, "");
  const deadlineMs = options.deadlineMs ?? 120_000;
  const maxDurationMs = options.mediaPolicy?.maxDurationMs ?? UPLOAD_CONSTRAINTS.maxDurationMs;
  const jobIdPrefix = options.jobIdPrefix ?? "mtjob";

  /** Dispatches one operation and resolves its validated result envelope. */
  async function dispatch(
    bytes: Uint8Array,
    operation: "probe" | "normalize",
  ): Promise<MediaToolchainResultDoc> {
    const contentHash = sha256OfBytes(bytes);
    const request: MediaToolchainDispatchRequestDoc = {
      job: {
        schemaVersion: "1.0",
        jobId: randomMediaId(jobIdPrefix),
        idempotencyKey: randomMediaId(`${jobIdPrefix}-key`),
        sessionId: "media-platform",
        operation,
        source: { contentHash, byteSize: bytes.byteLength, container: "mp4" },
        rights: {
          policyRef: "media-platform/upload-pipeline",
          canReferenceSourceFrames: true,
        },
        constraints: { deadlineMs, priority: 0 },
        mediaPolicy: { maxDurationMs },
      },
      source: {
        inputId: "source-media",
        kind: "source-media",
        contentBase64: Buffer.from(bytes).toString("base64"),
      },
    };
    let response: Response;
    try {
      response = await doFetch(`${base}/v1/media/jobs/execute`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
      });
    } catch (err) {
      throw new FfmpegUnavailableError(
        `the media toolchain worker at '${base}' is unreachable: ${err instanceof Error ? err.message : String(err)}`,
        { workerUrl: base },
      );
    }
    if (!response.ok) {
      let body: HttpErrorBody | null = null;
      try {
        body = (await response.json()) as HttpErrorBody;
      } catch {
        // keep the generic message
      }
      throw httpErrorToError(response.status, body);
    }
    let parsed: { disposition?: string; result?: unknown } | null = null;
    try {
      parsed = (await response.json()) as { disposition?: string; result?: unknown };
    } catch (err) {
      throw new FfmpegUnavailableError(
        `the media toolchain worker at '${base}' answered a non-JSON body: ${err instanceof Error ? err.message : String(err)}`,
        { workerUrl: base },
      );
    }
    const envelope = MediaToolchainResult.safeParse(parsed?.result);
    if (!envelope.success) {
      // A lying provider: the adapter dead-letters it, never trusts it.
      throw new FfmpegUnavailableError(
        "invalid-envelope: the worker answered a result that is not a MediaToolchainResult: " +
          envelope.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
        { workerUrl: base },
      );
    }
    return envelope.data;
  }

  return {
    async probeMedia(bytes: Uint8Array): Promise<MediaProbe> {
      const result = await dispatch(bytes, "probe");
      if (result.status === "failed") {
        throw failureToError(result.failure!);
      }
      if (result.sourceProbe === undefined) {
        throw new MediaIntegrityError(
          "the worker answered a succeeded probe without the measured source probe",
          { workerUrl: base },
        );
      }
      return result.sourceProbe;
    },

    async normalizeMedia(bytes: Uint8Array): Promise<MediaToolchainNormalization> {
      const result = await dispatch(bytes, "normalize");
      if (result.status === "failed") {
        throw failureToError(result.failure!);
      }
      const normalized = result.normalized;
      const artifact = result.artifact;
      if (normalized === undefined || artifact === undefined) {
        throw new MediaIntegrityError(
          "the worker answered a succeeded normalize without the normalized output or the artifact",
          { workerUrl: base },
        );
      }
      // The hash chain, verified at the RECEIVING boundary (the provider's
      // claims are never trusted):
      const outputBytes = new Uint8Array(Buffer.from(normalized.contentBase64, "base64"));
      const measuredHash = sha256OfBytes(outputBytes);
      if (measuredHash !== normalized.contentHash) {
        throw new MediaIntegrityError(
          `the delivered bytes hash to ${measuredHash}, the envelope claims ${normalized.contentHash}`,
          { workerUrl: base, measured: measuredHash, claimed: normalized.contentHash },
        );
      }
      if (outputBytes.byteLength !== normalized.byteSize) {
        throw new MediaIntegrityError(
          `the delivered bytes measure ${outputBytes.byteLength}, the envelope claims ${normalized.byteSize}`,
          { workerUrl: base, measured: outputBytes.byteLength, claimed: normalized.byteSize },
        );
      }
      const sentSourceHash = sha256OfBytes(bytes);
      if (artifact.sourceContentHash !== sentSourceHash) {
        throw new MediaIntegrityError(
          `the artifact's source hash is ${artifact.sourceContentHash}, but the dispatched bytes hashed to ${sentSourceHash} — the hash chain is broken`,
          { workerUrl: base, claimed: artifact.sourceContentHash, measured: sentSourceHash },
        );
      }
      return {
        outputBytes,
        outputProbe: normalized.probe,
        executionMs: result.metering.executionMs,
      };
    },
  };
}

/** Fetches the worker's media-toolchain descriptor (live — never invented). */
export async function fetchMediaToolchainDescriptor(
  workerUrl: string,
  options: { fetchFn?: typeof fetch } = {},
): Promise<MediaToolchainDescriptorDoc> {
  const doFetch = options.fetchFn ?? fetch;
  const base = workerUrl.replace(/\/+$/, "");
  const response = await doFetch(`${base}/v1/media/adapter`, { method: "GET" });
  if (!response.ok) {
    throw new FfmpegUnavailableError(
      `the media toolchain descriptor fetch failed: HTTP ${response.status}`,
      { workerUrl: base, status: response.status },
    );
  }
  const body = (await response.json()) as unknown;
  const parsed = MediaToolchainDescriptor.safeParse(body);
  if (!parsed.success) {
    throw new MediaIntegrityError(
      "the worker's media-toolchain descriptor is not a MediaToolchainDescriptor: " +
        parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
      { workerUrl: base },
    );
  }
  return parsed.data;
}
