/**
 * `encodeAnimeClip` — the W504 encoder: one W502 `AnimeRenderOutput` (SVG
 * frame sequence + per-frame manifest) becomes ONE self-contained
 * **animated SVG document** plus a deterministic **container manifest**.
 *
 * The encoded document is a genuinely playable "encoded segment": a browser
 * renders it natively (SVG + SMIL; no JavaScript inside the SVG, no external
 * resources). HONEST SCOPE: this is an SVG-timeline segment, not raster
 * video — raster codecs are out of scope for W504 (see ENCODING.md).
 *
 * Timing is NEVER invented: each frame's `<set begin="…" dur="…">` is
 * derived EXACTLY from the W502 render manifest (`frames[i].windowMs`), and
 * the container manifest records the same numbers. Provenance is carried
 * VERBATIM: the complete W502 render manifest (per-frame output windows,
 * source watermarks, applied event sequences, captions, entity dispositions,
 * skipped events, degradation state) is embedded unchanged — the output
 * pipeline never rewrites, summarizes, or augments it.
 *
 * PURITY: no clocks, no RNG, no I/O — the same `AnimeRenderOutput` yields a
 * byte-identical document and a deep-equal manifest on every call (pinned by
 * tests). Malformed render output fails LOUD with {@link SegmentEncodingError}:
 * frames/manifest mismatches, non-contiguous output windows, or malformed
 * SVG frame documents are never silently tolerated.
 */
import { escapeXml, fnv1a32 } from "@sporta/renderer-anime";
import type { AnimeRenderOutput } from "@sporta/renderer-anime";
import { SegmentEncodingError } from "./errors";
import { ANIME_SEGMENT_CONTENT_TYPE } from "./types";
import type {
  AnimeSegmentFormat,
  AnimeSegmentFrameTiming,
  AnimeSegmentManifest,
  EncodedAnimeSegment,
} from "./types";

/** The container format identity of this encoder (see ENCODING.md). */
export const ANIME_SEGMENT_FORMAT: AnimeSegmentFormat = { kind: "animated-svg", version: 1 };

/** The prefix of every segment id produced by this encoder. */
export const SEGMENT_ID_PREFIX = "anime-clip-";

/** The SVG root tag closing marker of a W502 frame document. */
const SVG_CLOSE = "</svg>";

/** The XML namespace every composed document declares (fixed). */
const SVG_NS = "http://www.w3.org/2000/svg";

// ---------------------------------------------------------------------------
// Structural helpers (JSON-space)
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describeValue(value: unknown): string {
  if (typeof value === "string") return "string";
  if (typeof value === "number") return "number";
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

/** Requires a finite number; returns it (fail-loud helper). */
function requireFiniteNumber(
  value: unknown,
  field: string,
  options: { min?: number; integer?: boolean } = {},
): number {
  const { min = -Number.POSITIVE_INFINITY, integer = false } = options;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new SegmentEncodingError(
      `${field} must be a finite number (got ${describeValue(value)})`,
      {
        field,
      },
    );
  }
  if (value < min) {
    throw new SegmentEncodingError(`${field} must be >= ${min} (got ${value})`, { field });
  }
  if (integer && !Number.isInteger(value)) {
    throw new SegmentEncodingError(`${field} must be an integer (got ${value})`, { field });
  }
  return value;
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length < 1) {
    throw new SegmentEncodingError(
      `${field} must be a non-empty string (got ${describeValue(value)})`,
      { field },
    );
  }
  return value;
}

// ---------------------------------------------------------------------------
// SMIL clock serialization (deterministic, pinned by tests)
// ---------------------------------------------------------------------------

/**
 * Serializes milliseconds as a SMIL clock value: seconds with up to
 * 6 decimals (microsecond precision), trailing zeros trimmed, `s` suffix —
 * e.g. 0 → `0s`, 1000 → `1s`, 1500 → `1.5s`, 1 → `0.001s`. `toFixed` is
 * used deliberately (it never produces exponent notation). W502 emits
 * integer-millisecond windows, so serialization is exact there.
 */
export function formatSmilClock(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) {
    throw new SegmentEncodingError(
      `SMIL clock value must be a finite number >= 0 (got ${describeValue(ms)})`,
      { value: String(ms) },
    );
  }
  const seconds = ms / 1000;
  return `${seconds.toFixed(6).replace(/0+$/, "").replace(/\.$/, "")}s`;
}

/**
 * sha-256 of the UTF-8 bytes of `content`, as 64 lowercase hex digits, via
 * Bun's built-in `CryptoHasher` (no deps — the W101 ingestion checksum
 * precedent). This hash is the CONTENT-ADDRESSED artifact id: the same
 * content always yields the same id, everywhere.
 */
export function contentHashOf(content: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(new TextEncoder().encode(content));
  return hasher.digest("hex");
}

/** UTF-8 byte length of a string (measured, never asserted). */
export function byteLengthOf(content: string): number {
  return new TextEncoder().encode(content).length;
}

// ---------------------------------------------------------------------------
// Segment identity (deterministic, NOT content-derived — see ENCODING.md)
// ---------------------------------------------------------------------------

/**
 * The canonical identity string of a W502 render output: the fields that
 * identify the RENDER (renderer identity, style, session scope, snapshot
 * version, event tail, output window, frame count) joined with `|` in a
 * fixed order. Deliberately NOT a function of the frame CONTENT: re-encoding
 * the same logical render with different content keeps the segment id (the
 * store then fails loud with a conflict instead of silently storing a second
 * copy under a new id).
 */
export function segmentIdentityOf(manifest: AnimeRenderOutput["manifest"]): string {
  return [
    manifest.renderer.rendererId,
    manifest.renderer.rendererVersion,
    manifest.renderer.styleId,
    manifest.renderer.configSchemaVersion,
    manifest.session.sessionId,
    manifest.session.snapshotVersion,
    manifest.session.eventsSinceSequence,
    manifest.output.startMs,
    manifest.output.durationMs,
    manifest.frames.length,
  ]
    .map(String)
    .join("|");
}

/** The deterministic segment id: `anime-clip-<fnv1a32-hex8>` of the identity. */
export function segmentIdOf(manifest: AnimeRenderOutput["manifest"]): string {
  return `${SEGMENT_ID_PREFIX}${(fnv1a32(segmentIdentityOf(manifest)) >>> 0)
    .toString(16)
    .padStart(8, "0")}`;
}

// ---------------------------------------------------------------------------
// Render-output validation (fail-loud on malformed W502 output)
// ---------------------------------------------------------------------------

/** The inner content of a frame document: between the root tag and `</svg>`. */
function frameInner(svg: string): string {
  const openEnd = svg.indexOf(">");
  if (openEnd === -1) {
    throw new SegmentEncodingError("frame document has no root tag end", {});
  }
  return svg.slice(openEnd + 1, svg.length - SVG_CLOSE.length);
}

/**
 * Validates the W502 render output against the encoding contract:
 *
 * - `frames` non-empty and count-equal to `manifest.frames`;
 * - `frames[i].frameIndex === i` and timestamps equal on both sides;
 * - every frame is an `<svg …>` document whose ROOT TAG carries the
 *   `viewBox` declared by the output profile resolution, and whose inner
 *   content carries no embedded `</svg>` (the splice would break the
 *   composed document);
 * - the first frame starts exactly at `manifest.output.startMs`;
 * - frame output windows are contiguous
 *   (`window[i].endMs === window[i+1].startMs`), strictly positive, and
 *   anchored at each frame's output timestamp;
 * - the LAST window ends exactly at `startMs + durationMs`.
 *
 * Both W502 render paths (snapshot + clip) produce exactly this shape; any
 * drift is a malformed output and fails loud — never a guessed encoding.
 */
function validateRenderOutput(output: AnimeRenderOutput): void {
  if (!isRecord(output) || !Array.isArray(output.frames) || !isRecord(output.manifest)) {
    throw new SegmentEncodingError(
      "render output must be an AnimeRenderOutput object (frames array + manifest)",
      {},
    );
  }
  const frames = output.frames;
  const manifest = output.manifest;
  if (frames.length === 0) {
    throw new SegmentEncodingError("render output contains no frames", {});
  }
  if (!Array.isArray(manifest.frames) || manifest.frames.length !== frames.length) {
    throw new SegmentEncodingError(
      `manifest.frames must have the same length as frames (${manifest.frames?.length ?? "n/a"} vs ${frames.length})`,
      { frameCount: frames.length },
    );
  }
  const resolution = isRecord(manifest.output) ? manifest.output.profile?.resolution : undefined;
  const width = requireFiniteNumber(
    isRecord(resolution) ? resolution.w : undefined,
    "manifest.output.profile.resolution.w",
    { min: 1, integer: true },
  );
  const height = requireFiniteNumber(
    isRecord(resolution) ? resolution.h : undefined,
    "manifest.output.profile.resolution.h",
    { min: 1, integer: true },
  );
  const viewBox = `viewBox="0 0 ${width} ${height}"`;
  requireFiniteNumber(manifest.output?.durationMs, "manifest.output.durationMs", { min: 1 });
  requireFiniteNumber(manifest.output?.frameIntervalMs, "manifest.output.frameIntervalMs", {
    min: 1,
  });
  const startMs = requireFiniteNumber(manifest.output?.startMs, "manifest.output.startMs", {
    min: 0,
  });
  requireNonEmptyString(manifest.session?.sessionId, "manifest.session.sessionId");
  requireNonEmptyString(manifest.renderer?.rendererId, "manifest.renderer.rendererId");
  requireNonEmptyString(manifest.renderer?.rendererVersion, "manifest.renderer.rendererVersion");

  let previousWindowEnd: number | undefined;
  for (let i = 0; i < frames.length; i += 1) {
    const frame = frames[i]!;
    const entry = manifest.frames[i]!;
    const frameField = (name: string) => `frames[${i}].${name}`;
    const manifestField = (name: string) => `manifest.frames[${i}].${name}`;
    if (!isRecord(frame) || !isRecord(entry)) {
      throw new SegmentEncodingError(`frames[${i}] and manifest.frames[${i}] must be objects`, {
        index: i,
      });
    }
    if (frame.frameIndex !== i || entry.frameIndex !== i) {
      throw new SegmentEncodingError(
        `${frameField("frameIndex")} and ${manifestField("frameIndex")} must both be ${i}`,
        { index: i },
      );
    }
    const timestampMs = requireFiniteNumber(
      frame.outputTimestampMs,
      frameField("outputTimestampMs"),
      { min: 0 },
    );
    const manifestTimestampMs = requireFiniteNumber(
      entry.outputTimestampMs,
      manifestField("outputTimestampMs"),
      { min: 0 },
    );
    if (timestampMs !== manifestTimestampMs) {
      throw new SegmentEncodingError(
        `${frameField("outputTimestampMs")} (${timestampMs}) does not match ${manifestField("outputTimestampMs")} (${manifestTimestampMs})`,
        { index: i, frameTimestampMs: timestampMs, manifestTimestampMs },
      );
    }
    if (i === 0 && timestampMs !== startMs) {
      throw new SegmentEncodingError(
        `the first frame's outputTimestampMs (${timestampMs}) must equal manifest.output.startMs (${startMs})`,
        { timestampMs, startMs },
      );
    }
    const window = isRecord(entry.windowMs) ? entry.windowMs : undefined;
    const windowStartMs = requireFiniteNumber(
      window?.startMs,
      `${manifestField("windowMs.startMs")}`,
      {
        min: 0,
      },
    );
    const windowEndMs = requireFiniteNumber(window?.endMs, `${manifestField("windowMs.endMs")}`, {
      min: 0,
    });
    if (windowStartMs !== timestampMs) {
      throw new SegmentEncodingError(
        `${manifestField("windowMs.startMs")} (${windowStartMs}) must equal the frame's outputTimestampMs (${timestampMs})`,
        { index: i, windowStartMs, timestampMs },
      );
    }
    if (windowEndMs <= windowStartMs) {
      throw new SegmentEncodingError(
        `${manifestField("windowMs.endMs")} (${windowEndMs}) must be > windowMs.startMs (${windowStartMs})`,
        { index: i, windowStartMs, windowEndMs },
      );
    }
    if (previousWindowEnd !== undefined && windowStartMs !== previousWindowEnd) {
      throw new SegmentEncodingError(
        `frame output windows must be contiguous (frames[${i - 1}].windowMs.endMs ${previousWindowEnd} != frames[${i}].windowMs.startMs ${windowStartMs})`,
        { index: i, previousWindowEnd, windowStartMs },
      );
    }
    previousWindowEnd = windowEndMs;
    if (
      typeof frame.svg !== "string" ||
      !frame.svg.startsWith("<svg") ||
      !frame.svg.endsWith(SVG_CLOSE)
    ) {
      throw new SegmentEncodingError(
        `${frameField("svg")} must be a complete <svg …>…</svg> document (got ${describeValue(frame.svg)})`,
        { index: i },
      );
    }
    // The inner content is spliced into the composed document, so an
    // embedded `</svg>` before the trailing close would corrupt the
    // composed document's structure — fail loud, never emit broken XML.
    if (frame.svg.slice(0, frame.svg.length - SVG_CLOSE.length).includes(SVG_CLOSE)) {
      throw new SegmentEncodingError(
        `${frameField("svg")} contains an embedded "${SVG_CLOSE}" before its trailing close`,
        { index: i },
      );
    }
    const openTag = frame.svg.slice(0, frame.svg.indexOf(">") + 1);
    if (!openTag.includes(viewBox)) {
      throw new SegmentEncodingError(
        `${frameField("svg")} root tag does not declare the output profile viewBox "${viewBox}"`,
        { index: i, viewBox },
      );
    }
  }
  const totalEnd = startMs + manifest.output.durationMs;
  if (previousWindowEnd !== undefined && previousWindowEnd !== totalEnd) {
    throw new SegmentEncodingError(
      `the last frame's windowMs.endMs (${previousWindowEnd}) must equal manifest.output.startMs + durationMs (${totalEnd})`,
      { lastWindowEnd: previousWindowEnd, expectedEnd: totalEnd },
    );
  }
}

// ---------------------------------------------------------------------------
// The encoder
// ---------------------------------------------------------------------------

/**
 * Encodes one W502 `AnimeRenderOutput` into a single self-contained animated
 * SVG segment. Structure (byte-pinned by tests; see ENCODING.md):
 *
 * ```xml
 * <svg xmlns="…" viewBox="0 0 W H" width="W" height="H">
 *   <title>anime.prototype@0.1.0 animated clip</title>
 *   <desc>segmentId=anime-clip-1a2b3c4d frameCount=6 totalDurationMs=6000</desc>
 *   <g data-frame-index="0" display="none">
 *     <set attributeName="display" to="inline" begin="0s" dur="1s" fill="remove"/>
 *     …frame 0 inner content…
 *   </g>
 *   … one group per frame …
 *   <g data-frame-index="N" display="none">
 *     <set attributeName="display" to="inline" begin="…" dur="…" fill="freeze"/>
 *     …frame N inner content…
 *   </g>
 * </svg>
 * ```
 *
 * Semantics: every frame group is `display="none"`; its single `<set>` makes
 * it visible for exactly `[begin, begin + dur)` on the document timeline
 * (`fill="remove"` restores the hidden base value). The LAST frame freezes
 * (`fill="freeze"`) — the clip ends showing its final frame. `begin` is the
 * frame's output timestamp relative to the first frame; `dur` is the frame's
 * W502 output window length. Both are recorded in the container manifest, so
 * the SVG timeline and the manifest agree exactly.
 *
 * Pure: the same input yields byte-identical `content` and a deep-equal
 * `manifest` on every call.
 */
export function encodeAnimeClip(output: AnimeRenderOutput): EncodedAnimeSegment {
  validateRenderOutput(output);
  const { frames, manifest } = output;
  const width = manifest.output.profile.resolution.w;
  const height = manifest.output.profile.resolution.h;
  const startMs = manifest.output.startMs;
  const totalDurationMs = manifest.output.durationMs;

  // Timing: derived EXACTLY from the (validated) W502 windows.
  const timings: AnimeSegmentFrameTiming[] = frames.map((frame, index) => {
    const window = manifest.frames[index]!.windowMs;
    return {
      frameIndex: index,
      outputTimestampMs: frame.outputTimestampMs,
      beginMs: frame.outputTimestampMs - startMs,
      durMs: window.endMs - window.startMs,
    };
  });

  // The deterministic segment id (identity-derived, NOT content-derived).
  const segmentId = segmentIdOf(manifest);

  // Compose the one self-contained animated SVG document.
  const title = `${escapeXml(`${manifest.renderer.rendererId}@${manifest.renderer.rendererVersion} animated clip`)}`;
  const desc = `segmentId=${segmentId} frameCount=${frames.length} totalDurationMs=${totalDurationMs}`;
  const parts: string[] = [
    `<svg xmlns="${SVG_NS}" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">`,
    `<title>${title}</title>`,
    `<desc>${desc}</desc>`,
  ];
  for (let index = 0; index < frames.length; index += 1) {
    const timing = timings[index]!;
    const fill = index === frames.length - 1 ? "freeze" : "remove";
    parts.push(
      `<g data-frame-index="${index}" display="none">` +
        `<set attributeName="display" to="inline" begin="${formatSmilClock(timing.beginMs)}" dur="${formatSmilClock(timing.durMs)}" fill="${fill}"/>` +
        frameInner(frames[index]!.svg) +
        `</g>`,
    );
  }
  parts.push(SVG_CLOSE);
  const content = parts.join("");

  const contentHash = contentHashOf(content);
  const segmentManifest: AnimeSegmentManifest = {
    format: { ...ANIME_SEGMENT_FORMAT },
    segmentId,
    sessionId: manifest.session.sessionId,
    frameCount: frames.length,
    totalDurationMs,
    contentHash,
    frames: timings,
    sourceManifest: manifest,
  };
  return {
    segmentId,
    contentType: ANIME_SEGMENT_CONTENT_TYPE,
    content,
    byteLength: byteLengthOf(content),
    contentHash,
    manifest: segmentManifest,
  };
}
