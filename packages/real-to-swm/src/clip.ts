/**
 * Clip source handling (R207): the real MP4 clip bytes + verbatim provenance
 * (source URL, source sha256, license) + the construction of the W102
 * `DecodeSourceInput`.
 *
 * WHY the receipt is constructed here rather than through `@sporta/ingestion`:
 * this package's sanctioned dependency surface (the R207 work item) is the
 * decode plane, the adapter plane, the observation bridge, fusion, the world
 * model, contracts, observability, and testing — NOT the W101 ingestion
 * package. The decode boundary re-asserts the analysis rights gate
 * fail-closed on every call (defense in depth, W102 §1), so constructing the
 * receipt structurally keeps the rights enforcement while staying inside the
 * dependency surface. The receipt's checksum is the TRUE sha-256 of the
 * bytes (never trusted input), the container family is magic-byte sniffed
 * (mirroring the documented W101 rules), and `ingestedAtMs` is the injected
 * deterministic clock — never wall-clock.
 */
import type { DecodeSourceInput } from "@sporta/decoding";
import type { AuthorizationPolicy } from "@sporta/contracts";
import { PipelineAdmissionError } from "./errors";

/** The container families this pipeline admits (magic-byte level). */
export type AdmittedContainer = "mp4" | "webm" | "mkv" | "mpegts" | "avi";

/** The verbatim provenance record carried into the reconstruction artifact. */
export interface ClipProvenance {
  /** Stable clip id (e.g. "fx-001"). */
  readonly clipId: string;
  /** Canonical source URL of the ORIGINAL clip (verbatim from the manifest). */
  readonly sourceUrl?: string;
  /** sha-256 of the ORIGINAL source bytes (pre-normalization), verbatim. */
  readonly sourceSha256?: string;
  /** The source license id (e.g. "CC0-1.0", "CC-BY-SA-3.0-nl"). */
  readonly licenseId?: string;
  /** Attribution the license requires (carried verbatim; required for BY-SA). */
  readonly licenseAttribution?: string;
  /** Documented normalization note (the exact transform applied upstream). */
  readonly normalizationNote?: string;
}

/** A real clip: the bytes plus their provenance. */
export interface ClipSource {
  /** The clip's provenance record (carried verbatim into the artifact). */
  readonly provenance: ClipProvenance;
  /** The clip bytes (UNTRUSTED — architecture-lock §13). */
  readonly bytes: Uint8Array;
  /**
   * The session's authorization policy (the rights gate input). REQUIRED —
   * a missing policy is a fail-closed admission refusal here (the decode
   * boundary would deny it anyway; refusing earlier says why).
   */
  readonly authorizationPolicy: AuthorizationPolicy;
  /** Original filename (informational only). */
  readonly filename?: string;
}

/**
 * Bounds-safe fixed-byte-pattern match at `offset` (mirrors the W101 rule).
 */
function matchesPattern(bytes: Uint8Array, offset: number, pattern: readonly number[]): boolean {
  if (offset < 0 || offset + pattern.length > bytes.length) return false;
  for (let i = 0; i < pattern.length; i += 1) {
    if (bytes[offset + i] !== pattern[i]) return false;
  }
  return true;
}

const FTYPE_BYTES = [0x66, 0x74, 0x79, 0x70] as const;
const EBML_MAGIC = [0x1a, 0x45, 0xdf, 0xa3] as const;
const OGG_MAGIC = [0x4f, 0x67, 0x67, 0x53] as const; // "OggS"
const RIFF_BYTES = [0x52, 0x49, 0x46, 0x46] as const; // "RIFF"
const AVI_FORM_BYTES = [0x41, 0x56, 0x49, 0x20] as const; // "AVI "

/**
 * Magic-byte container sniffing (W101-rule mirror): mp4 (`ftyp`), webm/mkv
 * (EBML; DocType distinguishes), avi (RIFF+AVI ), mpegts (0x47 sync spacing).
 * The Ogg family is deliberately NOT admitted: the W101 boundary classifies
 * it `unknown` and this pipeline's admission contract is the normalized MP4
 * rail (documented in the fixtures README) — an honest, typed refusal, never
 * a best-effort guess.
 */
export function sniffAdmittedContainer(bytes: Uint8Array): AdmittedContainer | "unknown" {
  if (matchesPattern(bytes, 4, FTYPE_BYTES)) return "mp4";
  if (matchesPattern(bytes, 0, EBML_MAGIC)) {
    // DocType scan (bounded, forgiving — the W101 rule).
    const limit = Math.min(bytes.length, 64);
    for (let i = 4; i + 3 <= limit; i += 1) {
      if (bytes[i] !== 0x42 || bytes[i + 1] !== 0x82) continue;
      const sizeByte = bytes[i + 2];
      if (sizeByte === undefined || sizeByte < 0x81 || sizeByte > 0x8f) continue;
      const length = sizeByte & 0x0f;
      const dataStart = i + 3;
      if (dataStart + length > bytes.length) continue;
      let docType = "";
      for (let j = 0; j < length; j += 1) {
        docType += String.fromCharCode(bytes[dataStart + j] ?? 0);
      }
      if (docType === "webm") return "webm";
      return "mkv";
    }
    return "mkv";
  }
  if (matchesPattern(bytes, 0, OGG_MAGIC)) return "unknown";
  if (matchesPattern(bytes, 0, RIFF_BYTES) && matchesPattern(bytes, 8, AVI_FORM_BYTES)) {
    return "avi";
  }
  // MPEG-TS: repeated 0x47 sync bytes at 188-byte spacing.
  if (bytes.length >= 188 * 2 && bytes[0] === 0x47 && bytes[188] === 0x47) return "mpegts";
  return "unknown";
}

/**
 * Builds the W102 `DecodeSourceInput` for a real clip: fail-closed admission
 * first (non-empty bytes + recognized container family), then the honest
 * receipt (true sha-256 checksum, sniffed container, injected clock) and the
 * lazy byte provider.
 */
export function buildDecodeSourceInput(
  source: ClipSource,
  nowMs: number,
): { input: DecodeSourceInput; container: AdmittedContainer; contentSha256: string } {
  if (source.bytes.byteLength === 0) {
    throw new PipelineAdmissionError("clip bytes are empty — refusing to run a fake pipeline", {
      clipId: source.provenance.clipId,
      byteLength: 0,
    });
  }
  if (source.authorizationPolicy === null || source.authorizationPolicy === undefined) {
    throw new PipelineAdmissionError(
      "clip source carries no authorization policy — the rights gate denies (fail closed) " +
        "before any media inspection",
      { clipId: source.provenance.clipId },
    );
  }
  const container = sniffAdmittedContainer(source.bytes);
  if (container === "unknown") {
    throw new PipelineAdmissionError(
      "clip container family not recognized (magic-byte sniff: mp4/webm/mkv/mpegts/avi " +
        "admitted; the gate rail normalizes to MP4) — refusing to run a fake pipeline",
      { clipId: source.provenance.clipId, byteLength: source.bytes.byteLength },
    );
  }
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(source.bytes);
  const checksum = hasher.digest("hex");
  const input: DecodeSourceInput = {
    receipt: {
      sessionId: "", // patched by the caller (pipeline owns the session id)
      sourceId: `src-${checksum.slice(0, 12)}`,
      checksum,
      container,
      byteLength: source.bytes.byteLength,
      ingestedAtMs: nowMs,
      sourceKind: "file",
      ...(source.filename !== undefined ? { filename: source.filename } : {}),
    },
    // The rights gate re-asserts this policy fail-closed on every decode call.
    authorizationPolicy: source.authorizationPolicy,
    openBytes: async () => source.bytes,
  };
  return { input, container, contentSha256: checksum };
}

/** Patches the session id onto a built decode input (the pipeline owns it). */
export function withSessionId(input: DecodeSourceInput, sessionId: string): DecodeSourceInput {
  return {
    ...input,
    receipt: { ...input.receipt, sessionId },
  };
}
