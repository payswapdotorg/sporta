/**
 * Frame-window construction and integrity verification (W305) — pure
 * functions, no clocks, no I/O, no state: the same emission yields a
 * byte-identical window document.
 *
 * Hashing follows the W504/W705 precedent exactly: sha-256 over UTF-8 bytes
 * via `Bun.CryptoHasher` (the platform hasher — zero external deps), 64
 * lowercase hex digits. The per-frame hash covers each frame document's own
 * bytes; the window-level hash covers the ordered frame documents
 * concatenated — both recomputed by the viewer at delivery (the
 * fail-closed integrity boundary: a mismatch is a typed
 * `integrity-violation`, never a presented corrupted frame).
 */
import { LIVE_OUTPUT_PROTOCOL_VERSION, type LiveFrameWindow } from "./types";
import type {
  LiveFrameDescriptor,
  LiveFrameWindowEnvelope,
  LiveOutputEmission,
  LiveOutputPayload,
} from "./types";

/** sha-256 of the UTF-8 bytes of `text`, as 64 lowercase hex digits. */
export function sha256Hex(text: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(text);
  return hasher.digest("hex");
}

/** UTF-8 byte length of `text` (the declared payload-size evidence). */
export function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

/**
 * The idempotency key for one frame window, derived from the source
 * watermark (the streaming contract's Recovery rule — the same watermark
 * NEVER double-delivers; a re-delivery is a counted duplicate at the
 * viewer): `liveout-<streamId>-wm-<watermarkMs>-seq-<sequence>`.
 */
export function frameWindowId(
  streamId: string,
  watermark: { watermarkMs: number; sequence: number },
): string {
  return `liveout-${streamId}-wm-${watermark.watermarkMs}-seq-${watermark.sequence}`;
}

/**
 * Structural validation of an emission payload (fail-loud, typed reasons).
 * A payload must carry at least one frame document and the manifest fields
 * the window document needs (renderer identity + output profile/timing).
 */
export function validateLiveOutputPayload(
  payload: unknown,
): { ok: true } | { ok: false; reason: string } {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return { ok: false, reason: "emission.output must be an object" };
  }
  const candidate = payload as Partial<LiveOutputPayload>;
  if (!Array.isArray(candidate.frames) || candidate.frames.length < 1) {
    return { ok: false, reason: "emission.output.frames must be a non-empty array" };
  }
  for (const frame of candidate.frames) {
    if (
      typeof frame !== "object" ||
      frame === null ||
      typeof frame.frameIndex !== "number" ||
      typeof frame.outputTimestampMs !== "number" ||
      typeof frame.svg !== "string" ||
      frame.svg.length === 0
    ) {
      return { ok: false, reason: "every frame must carry frameIndex, outputTimestampMs, svg" };
    }
  }
  const output = candidate.manifest?.output;
  if (
    typeof candidate.manifest !== "object" ||
    candidate.manifest === null ||
    typeof candidate.manifest.renderer !== "object" ||
    candidate.manifest.renderer === null ||
    typeof candidate.manifest.renderer.rendererId !== "string" ||
    typeof candidate.manifest.renderer.rendererVersion !== "string" ||
    typeof output !== "object" ||
    output === null ||
    typeof output.profile !== "object" ||
    output.profile === null ||
    typeof output.frameIntervalMs !== "number"
  ) {
    return {
      ok: false,
      reason: "emission.output.manifest must carry renderer identity and output timing",
    };
  }
  return { ok: true };
}

/**
 * Builds one frame-window envelope from a W304-style emission: descriptors
 * derived from the payload's OWN frame timestamps (verbatim — never
 * re-stamped), content hashes over the payload's own bytes, the profile
 * carried VERBATIM from the payload's manifest, and the W304 emission
 * provenance copied field-for-field. Pure and deterministic: the same
 * emission and inputs yield a deep-equal document.
 */
export function buildLiveFrameWindow(
  emission: LiveOutputEmission,
  options: {
    streamId: string;
    /** The delivery ordinal (assigned by the transport at admission). */
    ordinal: number;
    /** Host-declared emission timestamp (injected protocol clock). */
    emittedAtMs: number;
  },
): LiveFrameWindowEnvelope {
  const payloadCheck = validateLiveOutputPayload(emission.output);
  if (!payloadCheck.ok) {
    throw new TypeError(`buildLiveFrameWindow: ${payloadCheck.reason}`);
  }
  const frames: LiveFrameDescriptor[] = [];
  let byteSize = 0;
  let concatenated = "";
  for (const frame of emission.output.frames) {
    const byteLength = utf8ByteLength(frame.svg);
    frames.push({
      frameIndex: frame.frameIndex,
      presentationTimestampMs: frame.outputTimestampMs,
      byteSize: byteLength,
      contentHash: sha256Hex(frame.svg),
    });
    byteSize += byteLength;
    concatenated += frame.svg;
  }
  const window: LiveFrameWindow = {
    protocolVersion: LIVE_OUTPUT_PROTOCOL_VERSION,
    streamId: options.streamId,
    sessionId: emission.provenance.sessionId,
    ordinal: options.ordinal,
    windowId: frameWindowId(options.streamId, emission.provenance.sourceWatermark),
    watermark: { ...emission.provenance.sourceWatermark },
    frames,
    frameCount: frames.length,
    byteSize,
    contentHash: sha256Hex(concatenated),
    profile: emission.output.manifest.output.profile,
    provenance: {
      sessionId: emission.provenance.sessionId,
      batchId: emission.provenance.batchId,
      batchOrdinal: emission.provenance.batchOrdinal,
      sourceWatermark: { ...emission.provenance.sourceWatermark },
      jobId: emission.provenance.jobId,
      rendererId: emission.provenance.rendererId,
      rendererVersion: emission.provenance.rendererVersion,
    },
    emittedAtMs: options.emittedAtMs,
  };
  return { window, payload: emission.output };
}

/**
 * Verifies one frame-window envelope's integrity: recomputes every frame
 * hash and the window-level hash from the payload's own bytes and compares
 * against the declared ones (plus descriptor consistency — frame count,
 * byte size, timestamps VERBATIM). Pure; the delivery boundary calls it on
 * every hand-over.
 *
 * DIAGNOSTIC CONTRACT (the reason taxonomy is load-bearing, not cosmetic):
 *
 * - `content hash mismatch` — the PAYLOAD's own bytes were tampered with
 *   (the recomputed hash of the frame document disagrees with the declared
 *   one). This fires FIRST per frame: a tampered document is a content
 *   mismatch whether or not its byte length changed, so the hash — the
 *   integrity proof — is checked before any declared-metadata consistency.
 * - `byte size mismatch` — the CONTENT is intact (its hash verified) but the
 *   descriptor LIES about its length: reserved exclusively for corrupted
 *   descriptors over untampered content.
 * - `missing descriptor for frame N` — the descriptor table is SHORTER than
 *   the payload's frames: the exact index of the missing descriptor is
 *   reported (never a bare count mismatch that hides which entry dropped).
 * - `frame count mismatch` — the DECLARED frame count disagrees with the
 *   payload's actual frame count (the envelope's own headline fields lie).
 * - `descriptor table mismatch` — the descriptor table disagrees with the
 *   payload length in the OTHER direction (descriptors beyond the payload's
 *   frames — extra entries are never silently ignored).
 */
export function verifyFrameWindowIntegrity(
  envelope: LiveFrameWindowEnvelope,
): { ok: true } | { ok: false; reason: string; frameIndex?: number } {
  const { window, payload } = envelope;
  // The declared count must match the payload's own frames (a window whose
  // headline frame count lies is rejected before any per-frame work — a
  // SHORT descriptor table is NOT this case: it reaches the per-frame loop
  // so the exact missing index is reported).
  if (payload.frames.length !== window.frameCount) {
    return {
      ok: false,
      reason: `frame count mismatch: declared ${window.frameCount}, payload ${payload.frames.length}`,
    };
  }
  let byteSize = 0;
  let concatenated = "";
  for (let i = 0; i < payload.frames.length; i += 1) {
    const frame = payload.frames[i]!;
    const declared = window.frames[i];
    if (declared === undefined) {
      return { ok: false, reason: `missing descriptor for frame ${i}`, frameIndex: i };
    }
    // The integrity proof FIRST: the hash is recomputed from the payload's
    // own bytes, so ANY content tampering — with or without a byte-length
    // change — is diagnosed as a content mismatch (never mislabeled as a
    // byte-size problem by a length-changing tamper).
    const hash = sha256Hex(frame.svg);
    if (declared.contentHash !== hash) {
      return {
        ok: false,
        reason: `content hash mismatch at frame ${i}: declared ${declared.contentHash}, recomputed ${hash}`,
        frameIndex: i,
      };
    }
    if (declared.frameIndex !== frame.frameIndex) {
      return {
        ok: false,
        reason: `frame index mismatch at ${i}: declared ${declared.frameIndex}, payload ${frame.frameIndex}`,
        frameIndex: i,
      };
    }
    if (declared.presentationTimestampMs !== frame.outputTimestampMs) {
      return {
        ok: false,
        reason:
          `presentation timestamp mismatch at frame ${i}: declared ${declared.presentationTimestampMs}, ` +
          `payload ${frame.outputTimestampMs} (timestamps are carried verbatim — never re-stamped)`,
        frameIndex: i,
      };
    }
    // Descriptor consistency over VERIFIED content: a byte-size mismatch
    // here means the descriptor lies about intact bytes — a distinct
    // corruption class from tampered content.
    const byteLength = utf8ByteLength(frame.svg);
    if (declared.byteSize !== byteLength) {
      return {
        ok: false,
        reason: `byte size mismatch at frame ${i}: declared ${declared.byteSize}, payload ${byteLength}`,
        frameIndex: i,
      };
    }
    byteSize += byteLength;
    concatenated += frame.svg;
  }
  // The descriptor table must correspond 1:1 with the payload's frames in
  // the other direction too: extra descriptors beyond the payload are never
  // silently ignored (fail-closed in both directions).
  if (window.frames.length !== payload.frames.length) {
    return {
      ok: false,
      reason:
        `descriptor table mismatch: ${window.frames.length} descriptors for ` +
        `${payload.frames.length} payload frames`,
    };
  }
  if (window.byteSize !== byteSize) {
    return {
      ok: false,
      reason: `window byte size mismatch: declared ${window.byteSize}, recomputed ${byteSize}`,
    };
  }
  const windowHash = sha256Hex(concatenated);
  if (window.contentHash !== windowHash) {
    return {
      ok: false,
      reason: `window content hash mismatch: declared ${window.contentHash}, recomputed ${windowHash}`,
    };
  }
  return { ok: true };
}
