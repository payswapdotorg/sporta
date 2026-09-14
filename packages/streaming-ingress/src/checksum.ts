/**
 * Canonical segment checksum (W301) — the idempotency substance behind the
 * W101 posture: re-delivering the SAME content under the SAME upstream
 * segment id is an idempotent duplicate (tolerated, counted); re-using an id
 * with DIFFERENT content is an idempotency-key conflict (malformed,
 * `media-invalid`, fail-loud).
 *
 * The encoding is deterministic and documented (a change to it changes every
 * checksum, which tests would catch):
 *
 * - video: the UTF-8 prefix `"v1|<segmentId>|<frameId>|<streamIndex>|" +
 *   "<presentationMs>|<decodeOrder>|<width>|<height>|<pixelFormat>|"`
 *   followed by the raw frame bytes;
 * - audio: the UTF-8 prefix `"a1|<segmentId>|<chunkId>|<streamIndex>|" +
 *   "<startMs>|<sampleRate>|<channels>|"` followed by the raw float32 sample
 *   bytes.
 *
 * Hashing uses Bun's built-in `CryptoHasher` (sha-256) — zero dependencies,
 * exactly like the W101 ingestion checksum.
 */
import type { LiveSegment } from "./types";

/** sha-256 of the canonical segment encoding, as lowercase hex. */
export function checksumLiveSegment(segment: LiveSegment): string {
  const hasher = new Bun.CryptoHasher("sha256");
  if (segment.kind === "video") {
    const { frame } = segment;
    hasher.update(
      `v1|${segment.segmentId}|${frame.frameId}|${frame.streamIndex}|` +
        `${frame.presentationMs}|${frame.decodeOrder}|${frame.width}|` +
        `${frame.height}|${frame.pixelFormat}|`,
    );
    hasher.update(frame.bytes);
  } else {
    const { chunk } = segment;
    hasher.update(
      `a1|${segment.segmentId}|${chunk.chunkId}|${chunk.streamIndex}|` +
        `${chunk.startMs}|${chunk.sampleRate}|${chunk.channels}|`,
    );
    hasher.update(chunk.samples);
  }
  return hasher.digest("hex");
}
