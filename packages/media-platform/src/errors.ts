/**
 * Typed media-platform boundary errors (R101-R104), in the repo-wide error
 * style (the ingestion/decoding/compute-adapter precedent): every classified
 * boundary refusal carries a `terminalFailureClass` from the contracts
 * `TerminalFailureClass` enum (`"rights-denied" | "media-invalid" |
 * "resource-limit" | "internal"`), plus a structured, JSON-safe `details`
 * object. Nothing here is ever a silent failure.
 */

/** The contracts `TerminalFailureClass` members this layer refuses with. */
export type MediaFailureClass = "rights-denied" | "media-invalid" | "resource-limit" | "internal";

/** Structured, JSON-safe details carried on every classified error. */
export type MediaPlatformErrorDetails = Record<string, unknown>;

/** The classified base: a deliberate media-platform boundary refusal. */
export class MediaPlatformError extends Error {
  readonly terminalFailureClass: MediaFailureClass;
  /** Alias of {@link MediaPlatformError.terminalFailureClass}. */
  readonly failureClass: MediaFailureClass;
  readonly details: MediaPlatformErrorDetails;

  constructor(
    message: string,
    failureClass: MediaFailureClass,
    details: MediaPlatformErrorDetails = {},
  ) {
    super(message);
    this.name = "MediaPlatformError";
    this.terminalFailureClass = failureClass;
    this.failureClass = failureClass;
    this.details = details;
  }
}

/**
 * The upload request violates a declared constraint (size over the bound,
 * wrong container, over-duration, no video stream, missing rights
 * declaration). Classified `media-invalid` (the decoding precedent) or
 * `resource-limit` when the violation is a resource bound. Nothing is
 * stored: the bytes never reach the durable store.
 */
export class UploadRejectedError extends MediaPlatformError {
  /** The machine-readable constraint that was violated. */
  readonly constraint: string;

  constructor(
    constraint: string,
    message: string,
    failureClass: Extract<MediaFailureClass, "media-invalid" | "resource-limit">,
    details: MediaPlatformErrorDetails = {},
  ) {
    super(message, failureClass, { constraint, ...details });
    this.name = "UploadRejectedError";
    this.constraint = constraint;
  }
}

/**
 * The declared rights policy does not authorize the upload/normalization
 * pipeline (missing session, unknown policy id, mismatched id, or derived
 * capabilities that deny source-frame reference). Classified
 * `rights-denied`, fail-closed BEFORE any bytes are revealed or stored.
 */
export class MediaRightsError extends MediaPlatformError {
  constructor(message: string, details: MediaPlatformErrorDetails = {}) {
    super(message, "rights-denied", details);
    this.name = "MediaRightsError";
  }
}

/**
 * The stored bytes failed integrity verification (a re-read hash mismatch)
 * — classified `internal`: the storage layer is untrustworthy and the
 * artifact NEVER reports `checksumVerified`/`integrity.verified` true.
 */
export class MediaIntegrityError extends MediaPlatformError {
  constructor(message: string, details: MediaPlatformErrorDetails = {}) {
    super(message, "internal", details);
    this.name = "MediaIntegrityError";
  }
}

/**
 * ffmpeg/ffprobe are not usable in this environment (absent, or fail their
 * version probe). Normalization FAILS LOUD — this platform never fakes a
 * normalization (R102's honesty rule).
 */
export class FfmpegUnavailableError extends MediaPlatformError {
  constructor(message: string, details: MediaPlatformErrorDetails = {}) {
    super(message, "internal", details);
    this.name = "FfmpegUnavailableError";
  }
}

/**
 * The media itself is unsupported/corrupt/oversized for normalization
 * (unparseable probe output, zero-duration, unmeasurable frame rate).
 * Classified `media-invalid` with bounded stderr evidence.
 */
export class MediaInvalidError extends MediaPlatformError {
  constructor(message: string, details: MediaPlatformErrorDetails = {}) {
    super(message, "media-invalid", details);
    this.name = "MediaInvalidError";
  }
}

/** A referenced record (asset/manifest/artifact/job) does not exist. */
export class MediaNotFoundError extends MediaPlatformError {
  readonly kind: "asset" | "manifest" | "artifact" | "job";

  constructor(kind: "asset" | "manifest" | "artifact" | "job", id: string) {
    super(`media ${kind} '${id}' was not found`, "media-invalid", { kind, id });
    this.name = "MediaNotFoundError";
    this.kind = kind;
  }
}

/** Narrow type guard for the classified media-platform error family. */
export function isMediaPlatformError(err: unknown): err is MediaPlatformError {
  return err instanceof MediaPlatformError;
}
