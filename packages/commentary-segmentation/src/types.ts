/**
 * Core W208 types: the commentary unit that leaves this package.
 *
 * W207 transcribes fixed 5-second audio windows; W208 stitches those windows
 * into COMMENTARY UNITS — sentence-level, speaker/channel-aware, exactly
 * time-stamped — which are the input format W209 (football commentary
 * understanding) consumes. This is DETERMINISTIC rule-based segmentation:
 * every output character is traceable to W207 input characters (only
 * whitespace may be lost to trimming, and the only characters the segmenter
 * ever inserts are the single join spaces between consecutive windows' text),
 * and every timestamp is derived by documented arithmetic from the contributing
 * windows' own `startMs`/`endMs` (architecture-lock §3/§4: commentary is a
 * first-class semantic input and the pipeline must never drop text, merge
 * speakers silently, or invent timing).
 */

/**
 * One segmented commentary unit: a sentence (or an unterminated flush — see
 * `segmentCommentary`) built from one or more W207 {@link TranscriptionUnit}s.
 */
export interface CommentaryUnit {
  /**
   * Unit id: `"cu-<seq>"` where `<seq>` is the global emission sequence
   * starting at 1 (the first unit a `segmentCommentary` call emits is
   * `"cu-1"`). Dropped sentences (empty after trim) consume no sequence
   * number, so the ids of emitted units are gap-free per call.
   */
  unitId: string;
  /**
   * Session-timeline start (milliseconds) — PASSTHROUGH of the `startMs` of
   * the FIRST contributing W207 unit (the timeline the caller handed W207:
   * session time when a W103 mapper was supplied, source time otherwise).
   * Intra-unit character timing is NOT modeled: a sentence that begins
   * mid-window keeps the whole window's start (window-level granularity —
   * honest about what STT provides).
   */
  startMs: number;
  /**
   * Session-timeline end (milliseconds) — passthrough of the `endMs` of the
   * LAST contributing W207 unit (its actual covered span end; never beyond
   * the audio that is there).
   */
  endMs: number;
  /** The unit's text: contributing windows' trimmed text joined by single spaces, itself trimmed. Never empty. */
  text: string;
  /**
   * Speaker label passthrough. Present exactly when the contributing units
   * carry one: a speaker change is a hard segmentation boundary, so every
   * contributing unit of one commentary unit carries the SAME label (never
   * silently merged across speakers). Absence means no diarization was
   * available — it is never invented.
   */
  speakerLabel?: string;
  /**
   * Channel label passthrough (e.g. `"main"` / `"intl"`). Same rule as
   * `speakerLabel`: a channel change is a hard boundary, so the value is
   * consistent across the unit's contributing windows.
   */
  channel?: string;
  /**
   * ASR confidence passthrough in [0, 1], aggregated as the MINIMUM over the
   * contributing windows that carry one — a sentence is only as reliable as
   * its least-reliable window, and the minimum is always one of the input
   * values (never invented; an absent window confidence does not lower it).
   * OMITTED when no contributing window carries one.
   */
  asrConfidence?: number;
  /**
   * Provenance: the W207 unit ids (`"tu-<windowIndex>"`) of the windows whose
   * text contributed to this unit, in contribution order. A window that
   * contributes to two sentences (a mid-window sentence close) appears in
   * BOTH units' lists.
   */
  sourceWindowIds: string[];
}
