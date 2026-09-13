/**
 * Magic-byte container sniffing at the ingestion boundary (W101).
 *
 * Validation-level detection ONLY: fixed byte signatures, never decoding or
 * demuxing — that is W102. Media bytes are untrusted input
 * (architecture-lock §13), so every access is bounds-checked and a buffer too
 * short to carry a complete signature gracefully classifies as `unknown`
 * instead of throwing. All functions are pure: no I/O, no clock, no
 * randomness — `sniffContainer` on the same bytes always returns the same
 * answer.
 */

/** Container families recognizable by magic bytes at this boundary. */
export type Container = "mp4" | "webm" | "mkv" | "mpegts" | "avi" | "unknown";

/** Result of sniffing one buffer. */
export interface ContainerInfo {
  /** Detected container family (`unknown` when no signature matched). */
  container: Container;
  /** Canonical MIME type for the detected container. */
  mimeType: string;
  /** Human-readable description of the rule that produced the decision. */
  detectedBy: string;
}

/**
 * Bounds-safe fixed-byte-pattern match: `pattern` must appear at exactly
 * `offset`. Returns `false` (never throws) when the buffer is too short.
 */
function matchesPattern(bytes: Uint8Array, offset: number, pattern: readonly number[]): boolean {
  if (offset < 0 || offset + pattern.length > bytes.length) return false;
  for (let i = 0; i < pattern.length; i += 1) {
    if (bytes[offset + i] !== pattern[i]) return false;
  }
  return true;
}

/** "ftyp" — the ISO-BMFF file-type box header that opens MP4 files. */
const FTYPE_BYTES: readonly number[] = [0x66, 0x74, 0x79, 0x70];
/** EBML magic `1A 45 DF A3` — opens every Matroska/WebM file. */
const EBML_MAGIC: readonly number[] = [0x1a, 0x45, 0xdf, 0xa3];
/** "RIFF" — the RIFF chunk header that opens AVI (and also WAV) files. */
const RIFF_BYTES: readonly number[] = [0x52, 0x49, 0x46, 0x46];
/** "AVI " — the RIFF form type that distinguishes AVI from other RIFF files. */
const AVI_FORM_BYTES: readonly number[] = [0x41, 0x56, 0x49, 0x20];

/** MPEG-TS packet size in bytes; every packet starts with sync byte 0x47. */
const MPEGTS_PACKET_BYTES = 188;

/** How far past the EBML magic we scan for the DocType element. */
const EBML_DOCTYPE_SCAN_LIMIT = 64;

/**
 * Reads the EBML DocType string (`"webm"` or `"matroska"`) that distinguishes
 * WebM from Matroska inside the EBML header following the magic.
 *
 * Bounded, forgiving scan — NOT a full EBML parse: the DocType element
 * (id `0x42 0x82`, one-byte vint size, ASCII data) is searched within the
 * first {@link EBML_DOCTYPE_SCAN_LIMIT} bytes. Any malformed, truncated, or
 * absent DocType returns `undefined` and the caller falls back to the
 * Matroska-family default.
 */
function readEbmlDocType(bytes: Uint8Array): "webm" | "matroska" | undefined {
  const limit = Math.min(bytes.length, EBML_DOCTYPE_SCAN_LIMIT);
  for (let i = EBML_MAGIC.length; i + 3 <= limit; i += 1) {
    if (bytes[i] !== 0x42 || bytes[i + 1] !== 0x82) continue;
    const sizeByte = bytes[i + 2];
    // One-byte EBML vint: 0x80 | length; lengths 1..15 cover both doc types
    // ("webm" = 4 chars, "matroska" = 8 chars).
    if (sizeByte === undefined || sizeByte < 0x81 || sizeByte > 0x8f) continue;
    const length = sizeByte & 0x0f;
    const dataStart = i + 3;
    if (dataStart + length > bytes.length) continue;
    let docType = "";
    for (let j = 0; j < length; j += 1) {
      docType += String.fromCharCode(bytes[dataStart + j] ?? 0);
    }
    if (docType === "webm") return "webm";
    if (docType === "matroska") return "matroska";
  }
  return undefined;
}

/**
 * Sniffs the container family of `bytes` from magic-byte signatures.
 *
 * Rules (in check order):
 *
 * 1. **mp4** — bytes 4..8 spell `"ftyp"` (the file-type box). Bytes 0..4 hold
 *    the big-endian box size; sniffing is magic-byte level only, so the size
 *    is noted in documentation but deliberately NOT validated.
 * 2. **webm / mkv** — the EBML magic `1A 45 DF A3`. The DocType element
 *    distinguishes `"webm"` from `"matroska"` when it can be read; otherwise
 *    the buffer classifies as the Matroska-family default (`mkv`).
 * 3. **mpegts** — sync byte `0x47` at offset 0 AND at offset 188, confirming
 *    188-byte packet alignment.
 * 4. **avi** — `"RIFF"` at 0..4 with the `"AVI "` form type at 8..12.
 * 5. Anything else — including empty, garbage, and too-short buffers — is
 *    `unknown`.
 */
export function sniffContainer(bytes: Uint8Array): ContainerInfo {
  // Rule 1: mp4 — "ftyp" box type at offset 4 (size box occupies 0..4).
  if (matchesPattern(bytes, 4, FTYPE_BYTES)) {
    return {
      container: "mp4",
      mimeType: "video/mp4",
      detectedBy: "'ftyp' box type at offset 4 (ISO base media file format)",
    };
  }

  // Rule 2: webm / mkv — EBML magic at offset 0, DocType distinguishes them.
  if (matchesPattern(bytes, 0, EBML_MAGIC)) {
    const docType = readEbmlDocType(bytes);
    if (docType === "webm") {
      return {
        container: "webm",
        mimeType: "video/webm",
        detectedBy: "EBML magic 1A45DFA3 + DocType 'webm'",
      };
    }
    if (docType === "matroska") {
      return {
        container: "mkv",
        mimeType: "video/x-matroska",
        detectedBy: "EBML magic 1A45DFA3 + DocType 'matroska'",
      };
    }
    // TODO(W102): replace with full EBML header parsing if the demux/decode
    // stage needs the exact DocType. Until then the EBML family defaults to
    // Matroska, which also covers rare DocTypes (e.g. live WebM profiles).
    return {
      container: "mkv",
      mimeType: "video/x-matroska",
      detectedBy: "EBML magic 1A45DFA3 (DocType unreadable; defaulted to matroska)",
    };
  }

  // Rule 3: mpegts — 0x47 sync byte at offsets 0 and 188 (packet alignment).
  if (
    bytes.length >= MPEGTS_PACKET_BYTES + 1 &&
    bytes[0] === 0x47 &&
    bytes[MPEGTS_PACKET_BYTES] === 0x47
  ) {
    return {
      container: "mpegts",
      mimeType: "video/mp2t",
      detectedBy: "0x47 sync bytes at offsets 0 and 188 (188-byte packet alignment)",
    };
  }

  // Rule 4: avi — RIFF header with the "AVI " form type at offset 8.
  if (matchesPattern(bytes, 0, RIFF_BYTES) && matchesPattern(bytes, 8, AVI_FORM_BYTES)) {
    return {
      container: "avi",
      mimeType: "video/x-msvideo",
      detectedBy: "'RIFF' header with 'AVI ' form type at offset 8",
    };
  }

  // Rule 5: no known signature.
  return {
    container: "unknown",
    mimeType: "application/octet-stream",
    detectedBy: "no known container signature (mp4/webm/mkv/mpegts/avi)",
  };
}
