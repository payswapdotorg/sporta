/**
 * Ingestion resource policy (W101): what the validation-level ingestion
 * boundary accepts, per architecture-lock §13 ("bound resource usage") and
 * `docs/security/rights-security.md` ("cap duration/size/resource use").
 *
 * W101 scope: `allowedContainers` and `maxBytes` are enforced here.
 * `maxDurationMs` is DECLARED but not yet enforced — media duration is only
 * knowable after demux/decode (W102), which will consume this field.
 */
import type { Container } from "./container";

/**
 * Policy for one ingestion boundary. Media is untrusted, so these bounds are
 * checked BEFORE any deeper inspection of the bytes.
 */
export interface IngestionPolicy {
  /** Container families accepted by this boundary (magic-byte level). */
  allowedContainers: readonly Container[];
  /** Maximum accepted source size in bytes; larger input is rejected. */
  maxBytes: number;
  /**
   * Optional maximum source duration in milliseconds. Declared for W102
   * (demux/decode) — duration is unknowable at validation level, so W101
   * accepts it in the policy but does not enforce it.
   */
  maxDurationMs?: number;
}

/** 2 GiB — the default per-source size bound (2 * 1024^3 bytes). */
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024 * 1024;

/**
 * The default ingestion policy: the streaming container family
 * (mp4/webm/mkv/mpegts — deliberately NOT avi), a 2 GiB size bound, and no
 * duration cap. Frozen so the shared module default cannot be mutated by
 * callers.
 */
export const DEFAULT_INGESTION_POLICY: IngestionPolicy = Object.freeze({
  allowedContainers: Object.freeze<readonly Container[]>(["mp4", "webm", "mkv", "mpegts"]),
  maxBytes: DEFAULT_MAX_BYTES,
});
