/**
 * Deterministic commentary segmentation (W208).
 *
 * Turns the W207 {@link TranscriptionUnit} stream (one unit per transcribed
 * 5-second window) into sentence-level {@link CommentaryUnit}s — the input
 * format W209 consumes. Purely rule-based: punctuation, speaker/channel
 * changes, window gaps. NO language model, NO invented content.
 *
 * ## Algorithm (documented in full — the tests assert each rule)
 *
 * 1. **Order**: units are processed sorted by `startMs`. W207 emits them
 *    already-ordered, but the sort is applied anyway; ties break on `unitId`
 *    by plain code-unit (lexicographic) string comparison — `"tu-10"`
 *    sorts before `"tu-2"` — which is fully deterministic (determinism, not
 *    numeric aesthetics, is the requirement). Units identical in both keys
 *    keep their input order (the underlying sort is stable).
 * 2. **Empty units**: units whose text is empty or whitespace-only are
 *    skipped ENTIRELY — they emit no unit and force no boundary. Their time
 *    span is not credited as coverage either: the silence they represent is
 *    visible to the gap rule below through the surrounding contributing
 *    units' own times (a hole between real speech can still split).
 * 3. **Sentence accumulation**: each contributing unit's text (trimmed at
 *    both ends; internal whitespace preserved verbatim) is appended to the
 *    open sentence's buffer, joined to the previous piece by a SINGLE space —
 *    STT windows mid-sentence continue the sentence across the window
 *    boundary. A sentence CLOSES at the FIRST terminator (`.` `!` `?`)
 *    followed by end-of-buffer or whitespace — including a terminator at
 *    the very end of a window's text, so a window ending in `"..."` closes
 *    even with no trailing whitespace. Terminators inside numbers or
 *    abbreviations ("3.5", "Dr.Smith") do not close (no whitespace/end
 *    follows); "Dr. Smith" DOES close — a documented limitation: no
 *    abbreviation dictionary, simplicity and determinism over linguistics.
 * 4. **Hard boundaries** flush the open sentence even without a terminator,
 *    checked in this documented order (the first match is the flush's
 *    attributed cause): speaker change (`speakerLabel` differs, where
 *    undefined→defined and defined→undefined count as changes), channel
 *    change (same rule), or a GAP `next.startMs - prev.endMs > maxGapMs`
 *    (default {@link DEFAULT_MAX_GAP_MS} — STT silence).
 * 5. **Timing**: `startMs` = first contributing unit's `startMs`, `endMs` =
 *    last contributing unit's `endMs` (passthrough, session timeline when
 *    W207 was configured with the W103 mapper). A window whose text is split
 *    by a mid-window sentence close keeps the WHOLE-unit window on BOTH
 *    sides — intra-unit character timing is NOT modeled (window-level
 *    granularity only, honest about what STT provides).
 * 6. **Emission**: the sentence text is trimmed (leading/trailing
 *    terminators kept). A sentence that is empty after trim is DROPPED
 *    (defensive: with rule 2's filter it cannot occur, since every buffer
 *    starts with a non-whitespace character or a terminator).
 *
 * Determinism contract: no RNG, no clock, no I/O — the same
 * `(units, options)` always produce a deep-equal result.
 */
import type { TranscriptionUnit } from "@sporta/asr";
import type { CommentaryUnit } from "./types";

/** Default inter-unit silence that closes a sentence (milliseconds). */
export const DEFAULT_MAX_GAP_MS = 1500;

/** Options for {@link segmentCommentary}. */
export interface SegmenterOptions {
  /**
   * Maximum inter-unit silence (milliseconds) that keeps one sentence open:
   * a contributing-unit gap `next.startMs - prev.endMs` strictly greater than
   * this flushes the open sentence. Default: {@link DEFAULT_MAX_GAP_MS}.
   * `0` means every positive gap splits; must be finite and non-negative.
   */
  readonly maxGapMs?: number;
}

/** Why a commentary unit closed — segmentation-cause accounting (benchmark). */
export type CloseCause = "terminator" | "speaker" | "channel" | "gap" | "input-end";

/** A commentary unit plus the documented cause that closed it. */
export interface CommentaryUnitWithCause {
  /** The emitted unit. */
  readonly unit: CommentaryUnit;
  /** The close cause: terminator hit, speaker/channel change, gap, or input end. */
  readonly closeCause: CloseCause;
}

/** One open (not yet closed) sentence under construction. */
interface OpenSentence {
  /** Trimmed text pieces, one per contributing unit (parallel to windowIds). */
  readonly pieces: string[];
  /** Contributing unit ids, one per piece. */
  readonly windowIds: string[];
  /** startMs of the FIRST contributing unit (commentary-unit startMs). */
  readonly firstStartMs: number;
  /** endMs of the LAST contributing unit (commentary-unit endMs, gap rule input). */
  lastEndMs: number;
  /** Speaker label of the contributing units (identical across them: changes flush). */
  readonly speakerLabel: string | undefined;
  /** Channel label of the contributing units (identical across them: changes flush). */
  readonly channel: string | undefined;
  /** asrConfidence values of the contributing units that carry one (min wins). */
  readonly confidences: number[];
}

/** Whitespace test for the terminator-follows rule (ECMAScript `\s`). */
const WS = /\s/;

/** Index of the first sentence terminator followed by whitespace or end, else -1. */
function findClose(buffer: string): number {
  for (let index = 0; index < buffer.length; index += 1) {
    const ch = buffer[index];
    if (ch === "." || ch === "!" || ch === "?") {
      const next = buffer[index + 1];
      if (next === undefined || WS.test(next)) return index;
    }
  }
  return -1;
}

/** Deterministic unit-order comparator: startMs, then unitId (code-unit order). */
function compareUnits(a: TranscriptionUnit, b: TranscriptionUnit): number {
  if (a.startMs !== b.startMs) return a.startMs - b.startMs;
  if (a.unitId < b.unitId) return -1;
  if (a.unitId > b.unitId) return 1;
  return 0;
}

/** Minimum of a non-empty list (an empty list has no confidence to report). */
function minOf(values: readonly number[]): number {
  let min = values[0];
  if (min === undefined) throw new Error("minOf requires a non-empty list");
  for (let index = 1; index < values.length; index += 1) {
    const value = values[index];
    if (value !== undefined && value < min) min = value;
  }
  return min;
}

/** Builds the emitted commentary unit from the open sentence and its text. */
function buildUnit(seq: number, open: OpenSentence, text: string): CommentaryUnit {
  return {
    unitId: `cu-${seq}`,
    startMs: open.firstStartMs,
    endMs: open.lastEndMs,
    text,
    ...(open.speakerLabel !== undefined ? { speakerLabel: open.speakerLabel } : {}),
    ...(open.channel !== undefined ? { channel: open.channel } : {}),
    ...(open.confidences.length > 0 ? { asrConfidence: minOf(open.confidences) } : {}),
    sourceWindowIds: [...open.windowIds],
  };
}

/**
 * Segments W207 transcription units into commentary units, carrying the
 * documented close cause per unit (the segmentation benchmark counts these;
 * `segmentCommentary` is the public projection that drops them). Pure and
 * deterministic; see the module docs for the full algorithm.
 */
export function segmentWithCloseCauses(
  units: readonly TranscriptionUnit[],
  options: SegmenterOptions = {},
): CommentaryUnitWithCause[] {
  const maxGapMs = options.maxGapMs ?? DEFAULT_MAX_GAP_MS;
  if (!Number.isFinite(maxGapMs) || maxGapMs < 0) {
    throw new RangeError(
      `maxGapMs must be a finite non-negative number of milliseconds (got ${String(maxGapMs)})`,
    );
  }

  // Rule 1: deterministic order (input is expected pre-sorted from W207; sort anyway).
  const ordered = [...units].sort(compareUnits);
  // Rule 2: whitespace-only units are skipped entirely (no unit, no boundary).
  const contributing = ordered.filter((unit) => unit.text.trim() !== "");

  const out: CommentaryUnitWithCause[] = [];
  let seq = 0;
  let open: OpenSentence | null = null;

  /** Rule 4/6: flush the open sentence (if any) for `cause`; drop if empty. */
  const flush = (cause: CloseCause): void => {
    if (open === null) return;
    const text = open.pieces.join(" ").trim();
    if (text !== "") {
      seq += 1;
      out.push({ unit: buildUnit(seq, open, text), closeCause: cause });
    }
    open = null;
  };

  for (const unit of contributing) {
    // Rule 4: hard boundaries, in documented order (speaker, channel, gap).
    if (open !== null) {
      if (unit.speakerLabel !== open.speakerLabel) {
        flush("speaker");
      } else if (unit.channel !== open.channel) {
        flush("channel");
      } else if (unit.startMs - open.lastEndMs > maxGapMs) {
        flush("gap");
      }
    }

    // Rule 3: append the unit's trimmed text to the open sentence.
    const text = unit.text.trim();
    if (open === null) {
      open = {
        pieces: [text],
        windowIds: [unit.unitId],
        firstStartMs: unit.startMs,
        lastEndMs: unit.endMs,
        speakerLabel: unit.speakerLabel,
        channel: unit.channel,
        confidences: unit.asrConfidence !== undefined ? [unit.asrConfidence] : [],
      };
    } else {
      open.pieces.push(text);
      open.windowIds.push(unit.unitId);
      open.lastEndMs = unit.endMs;
      if (unit.asrConfidence !== undefined) open.confidences.push(unit.asrConfidence);
    }

    // Rule 3/5: close sentences at terminators. Invariant: before this
    // append the open buffer held no closeable terminator (the previous pass
    // closed through the last one), and the buffer cannot end in a
    // terminator without having closed — so every close found here has its
    // terminator inside the just-appended text, and each remainder is a
    // suffix of that text. A non-empty remainder re-opens on the SAME unit's
    // whole window (intra-unit timing is not modeled); an empty remainder
    // leaves nothing open.
    for (;;) {
      const current = open as OpenSentence;
      const buffer = current.pieces.join(" ");
      const cut = findClose(buffer);
      if (cut === -1) break;
      const sentence = buffer.slice(0, cut + 1).trim();
      const remainder = buffer.slice(cut + 1).trimStart();
      if (sentence !== "") {
        seq += 1;
        out.push({ unit: buildUnit(seq, current, sentence), closeCause: "terminator" });
      }
      if (remainder === "") {
        open = null;
        break;
      }
      open = {
        pieces: [remainder],
        windowIds: [unit.unitId],
        firstStartMs: unit.startMs,
        lastEndMs: unit.endMs,
        speakerLabel: unit.speakerLabel,
        channel: unit.channel,
        confidences: unit.asrConfidence !== undefined ? [unit.asrConfidence] : [],
      };
    }
  }

  // Rule 6: whatever is still open flushes at input end (no terminator needed).
  flush("input-end");
  return out;
}

/**
 * Segments W207 transcription units into commentary units — see the module
 * docs for the full documented algorithm. Empty input yields `[]`. Pure:
 * same `(units, options)` → deep-equal output.
 */
export function segmentCommentary(
  units: readonly TranscriptionUnit[],
  options?: SegmenterOptions,
): CommentaryUnit[] {
  return segmentWithCloseCauses(units, options).map((entry) => entry.unit);
}
