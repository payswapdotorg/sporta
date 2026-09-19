/**
 * SHARED HTTP RANGE PARSING (R504) — the single-range `bytes=` parser the
 * HTML5-playback byte routes use (RFC 9110 §14.2's single-range form, the
 * one every browser issues for `<video>` sources).
 *
 * Extracted from the R104 media-artifact content route so the watch-plane
 * video route (R504) shares EXACTLY the same semantics — behavior there is
 * pinned by its own tests and unchanged.
 */

/** Parsed Range outcome: a bounded range, malformed (ignore → 200), or 416. */
export type RangeParse = { start: number; end?: number } | "malformed" | "unsatisfiable";

/**
 * Parses one `Range` header against the object's total size (RFC 9110's
 * single `bytes=` range; multi-range is treated as malformed → the whole
 * object answers 200 — the honest minimal implementation).
 */
export function parseByteRange(header: string, totalSize: number | null): RangeParse {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (match === null || (match[1] === "" && match[2] === "")) {
    return "malformed";
  }
  const total = totalSize ?? Number.NaN;
  if (match[1] === "") {
    // Suffix form `bytes=-N`: the LAST N bytes.
    const suffix = Number.parseInt(match[2]!, 10);
    if (!Number.isFinite(suffix) || suffix <= 0) return "malformed";
    if (!Number.isFinite(total)) return "malformed";
    if (suffix >= total) {
      return total === 0 ? "unsatisfiable" : { start: 0 };
    }
    return { start: total - suffix };
  }
  const start = Number.parseInt(match[1]!, 10);
  if (!Number.isFinite(start) || start < 0) return "malformed";
  if (Number.isFinite(total) && (total === 0 || start >= total)) {
    return "unsatisfiable";
  }
  const end = match[2] === "" ? undefined : Number.parseInt(match[2]!, 10);
  if (end !== undefined && (!Number.isFinite(end) || end < start)) return "malformed";
  return { start, ...(end !== undefined ? { end } : {}) };
}

/**
 * Builds the response body: an ArrayBuffer-backed copy of the stored view
 * (TS 5.9's `Uint8Array<ArrayBufferLike>` is not a `BlobPart`; the copy
 * narrows to a plain `ArrayBuffer` backing — and the copy is caller-owned
 * anyway, so nothing aliases the store's buffer).
 */
export function bodyOf(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
