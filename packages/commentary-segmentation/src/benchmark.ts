/**
 * Segmentation benchmark (W208) — the "speech is segmented into synchronized
 * commentary units" acceptance evidence.
 *
 * Per scenario: run the deterministic segmenter over the scenario's W207
 * units and COUNT. Every metric is an exact integer or an exact ratio of
 * counted quantities — no sampled estimates, no tolerances. Deterministic:
 * the same scenarios always produce a deep-equal report array (tested).
 *
 * ## Metric definitions (documented exactly)
 *
 * - `units`: input `TranscriptionUnit` count (all units, including
 *   whitespace-only ones — they are input the segmenter saw and skipped).
 * - `commentaryUnits`: emitted {@link CommentaryUnit} count.
 * - `meanUnitMs`: mean span `endMs - startMs` over the EMITTED commentary
 *   units (window-level granularity; 0 when none were emitted).
 * - `multiWindowSentences`: units spanning more than one source window
 *   (`sourceWindowIds.length > 1`).
 * - `speakerSwitches` / `channelSwitches` / `gapSplits` / `terminatorSplits`:
 *   commentary units whose documented close cause was a speaker change /
 *   channel change / window gap / sentence terminator. Every unit closes for
 *   exactly one cause; end-of-input flushes are counted in none of the four.
 * - `textCharsIn`: sum of the raw `text` lengths of ALL input units.
 * - `textCharsOut`: sum over emitted units of `text.length` MINUS the join
 *   spaces the segmenter inserted (`sourceWindowIds.length - 1` per unit).
 *   The single-space joins between consecutive windows are the ONLY
 *   characters the segmenter ever adds; excluding them makes every counted
 *   output character traceable to an input character, giving the exact
 *   identity `textCharsOut = textCharsIn - (trimmed/dropped whitespace)`
 *   — so `characterConservation` is mathematically ≤ 1 and exceeds 0.9
 *   unless more than 10% of input characters are dropped whitespace.
 * - `characterConservation`: `textCharsOut / textCharsIn` — 1 for an empty
 *   scenario (nothing to lose; keeps the ≤ 1 and > 0.9 invariant meaningful).
 */
import type { TranscriptionUnit } from "@sporta/asr";
import { segmentWithCloseCauses } from "./segment";

/** One benchmark scenario: a named batch of W207 transcription units. */
export interface SegmentationScenario {
  /** The scenario's label (names the fixture in tests; identifies the scenario on failure). */
  readonly name: string;
  /** The W207 transcription units to segment. */
  readonly units: TranscriptionUnit[];
}

/** Per-scenario segmentation benchmark report (see module docs for metrics). */
export interface SegmentationBenchmarkReport {
  /** Input transcription units (including whitespace-only ones). */
  units: number;
  /** Emitted commentary units. */
  commentaryUnits: number;
  /** Mean span (ms) of the emitted commentary units (0 when none). */
  meanUnitMs: number;
  /** Units spanning more than one source window. */
  multiWindowSentences: number;
  /** Units closed by a speaker change. */
  speakerSwitches: number;
  /** Units closed by a channel change. */
  channelSwitches: number;
  /** Units closed by an inter-window gap beyond `maxGapMs`. */
  gapSplits: number;
  /** Units closed by a sentence terminator. */
  terminatorSplits: number;
  /** Sum of raw input text lengths (all units). */
  textCharsIn: number;
  /** Output text characters excluding inserted join spaces (see module docs). */
  textCharsOut: number;
  /** textCharsOut / textCharsIn (1 for an empty scenario). */
  characterConservation: number;
}

/** Per-scenario counters accumulated in one pass over the segmentation result. */
interface ScenarioCounts {
  totalSpanMs: number;
  multiWindow: number;
  speaker: number;
  channel: number;
  gap: number;
  terminator: number;
  charsOut: number;
}

/**
 * Runs the segmentation benchmark over the scenarios: segment each scenario's
 * units (default `maxGapMs`) and report the counted metrics. Reports come
 * back in scenario order. Pure and deterministic (see module docs).
 */
export function runSegmentationBenchmark(
  scenarios: readonly SegmentationScenario[],
): SegmentationBenchmarkReport[] {
  return scenarios.map((scenario) => {
    const entries = segmentWithCloseCauses(scenario.units);

    const counts: ScenarioCounts = {
      totalSpanMs: 0,
      multiWindow: 0,
      speaker: 0,
      channel: 0,
      gap: 0,
      terminator: 0,
      charsOut: 0,
    };
    for (const { unit, closeCause } of entries) {
      counts.totalSpanMs += unit.endMs - unit.startMs;
      if (unit.sourceWindowIds.length > 1) counts.multiWindow += 1;
      counts.charsOut += unit.text.length - (unit.sourceWindowIds.length - 1);
      switch (closeCause) {
        case "speaker":
          counts.speaker += 1;
          break;
        case "channel":
          counts.channel += 1;
          break;
        case "gap":
          counts.gap += 1;
          break;
        case "terminator":
          counts.terminator += 1;
          break;
        // "input-end" closes the stream without splitting mid-sentence:
        // counted in none of the four split categories (documented).
      }
    }

    const textCharsIn = scenario.units.reduce((sum, unit) => sum + unit.text.length, 0);
    return {
      units: scenario.units.length,
      commentaryUnits: entries.length,
      meanUnitMs: entries.length > 0 ? counts.totalSpanMs / entries.length : 0,
      multiWindowSentences: counts.multiWindow,
      speakerSwitches: counts.speaker,
      channelSwitches: counts.channel,
      gapSplits: counts.gap,
      terminatorSplits: counts.terminator,
      textCharsIn,
      textCharsOut: counts.charsOut,
      characterConservation: textCharsIn === 0 ? 1 : counts.charsOut / textCharsIn,
    };
  });
}
