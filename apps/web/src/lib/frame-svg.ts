/**
 * FRAME-SVG PREPARATION (W905) — displaying ONE real frame of a stored
 * animated-SVG output inside the watch page's player.
 *
 * The W504 encoder emits ONE self-contained animated SVG per output
 * segment: every frame is a `<g data-frame-index="N" display="none">`
 * carrying the frame's graphics, made visible for its real window by a
 * single SMIL `<set begin="…" dur="…">` (the document's own real timing —
 * see `packages/output-pipeline/src/encode.ts`).
 *
 * For frame-accurate display under the player's control (play/pause/seek),
 * the player inlines the document and displays exactly the selected frame:
 * the SMIL `<set>` elements are removed (the player's clock — the manifest
 * — drives frame selection instead) and the selected frame group's base
 * `display` attribute is switched to `inline`. UNSELECTED frames keep the
 * encoder's own `display="none"` base — the document never shows two frames.
 *
 * HONESTY + SAFETY (fail-closed, tested):
 * - The transform is PURE string surgery over the artifact's real bytes —
 *   the same input always yields the same output (pinned by tests), and the
 *   raw artifact stays untouched behind its content hash.
 * - The transform REFUSES (throws {@link FrameSvgError}) any document that
 *   carries scripts, event-handler attributes, or non-fragment references —
 *   the player displays the artifact's graphics only, and if a future
 *   renderer ever emitted anything else, the display fails closed instead
 *   of executing it.
 */

/** The transform's fail-closed refusal (the player shows a failed state). */
export class FrameSvgError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FrameSvgError";
  }
}

/** A frame-group opening tag (`<g data-frame-index="N" display="…">`). */
const FRAME_GROUP_OPEN = /<g data-frame-index="(\d+)" display="(none|inline)">/g;

/** A SMIL `<set … />` element (the encoder emits exactly one per frame group). */
const SMIL_SET = /<set\b[^>]*\/>/g;

/** Event-handler attributes (`onclick=`, `onload=` …) — refuse, always. */
const EVENT_HANDLER = /\son[a-z]+\s*=\s*["'a-zA-Z0-9]/i;

/** Any `href`/`xlink:href` that is not a same-document fragment (`#…`). */
const EXTERNAL_HREF = /\b(?:xlink:)?href\s*=\s*"(?!#)[^"]*"/i;

/** Script elements of any flavor — refuse, always. */
const SCRIPT_ELEMENT = /<\s*script\b/i;

/**
 * Prepares the stored output's SVG for inline single-frame display.
 *
 * @param content  The stored segment document (the real SVG bytes).
 * @param frameIndex The REAL frame to display (must exist in the document).
 * @returns The display document (no SMIL; only `frameIndex` visible).
 * @throws {@link FrameSvgError} when the document carries executable
 *   content, external references, or no such frame group.
 */
export function prepareFrameForDisplay(content: string, frameIndex: number): string {
  if (SCRIPT_ELEMENT.test(content)) {
    throw new FrameSvgError("the stored output carries a script element — refusing to display");
  }
  if (EVENT_HANDLER.test(content)) {
    throw new FrameSvgError("the stored output carries an event handler — refusing to display");
  }
  if (EXTERNAL_HREF.test(content)) {
    throw new FrameSvgError(
      "the stored output references an external resource — refusing to display",
    );
  }
  if (!Number.isInteger(frameIndex) || frameIndex < 0) {
    throw new FrameSvgError(`frame index ${frameIndex} is not a real frame position`);
  }

  // 1. Remove every SMIL <set> — the player's own clock (the manifest's
  //    real timing, advanced by the frame-display model) selects frames.
  const withoutSmil = content.replace(SMIL_SET, "");

  // 2. Switch exactly the selected frame group's base display to inline;
  //    every other group keeps the encoder's own display="none".
  let selectedSeen = false;
  const prepared = withoutSmil.replace(
    FRAME_GROUP_OPEN,
    (match, index: string, display: string) => {
      if (Number(index) !== frameIndex) return match;
      selectedSeen = true;
      return display === "none" ? match.replace('display="none"', 'display="inline"') : match;
    },
  );

  if (!selectedSeen) {
    throw new FrameSvgError(`the stored output has no frame group for frame index ${frameIndex}`);
  }
  return prepared;
}

/** The frame indices the artifact's document really carries. */
export function frameIndicesOf(content: string): number[] {
  const indices: number[] = [];
  for (const match of content.matchAll(/<g data-frame-index="(\d+)" display="(?:none|inline)">/g)) {
    indices.push(Number(match[1]));
  }
  return indices;
}

// ---------------------------------------------------------------------------
// W915: standalone live frames (the live SSE transport's per-tick SVGs)
// ---------------------------------------------------------------------------

/**
 * Prepares ONE STANDALONE live frame for inline display (W915). The live
 * transport's frames are complete self-contained SVG documents (one per
 * real tick — not the encoder's multi-frame clip), so there is no frame
 * group or SMIL surgery to do; the SAME fail-closed refusals apply:
 * scripts, event handlers, and non-fragment references never display.
 *
 * @throws {@link FrameSvgError} on executable/external content, or when
 * the document is not an SVG root (the live frames always are).
 */
export function prepareLiveFrameForDisplay(content: string): string {
  if (SCRIPT_ELEMENT.test(content)) {
    throw new FrameSvgError("the live frame carries a script element — refusing to display");
  }
  if (EVENT_HANDLER.test(content)) {
    throw new FrameSvgError("the live frame carries an event handler — refusing to display");
  }
  if (EXTERNAL_HREF.test(content)) {
    throw new FrameSvgError(
      "the live frame references an external resource — refusing to display",
    );
  }
  if (!/^<svg\b/.test(content.trimStart())) {
    throw new FrameSvgError("the live frame is not an SVG document — refusing to display");
  }
  return content;
}
