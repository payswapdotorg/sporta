/**
 * @sporta/commentary-segmentation — deterministic commentary segmentation
 * (work item W208).
 *
 * The second commentary-chain stage (architecture-lock §3 and §7, ADR-002):
 * W207 transcription units in; sentence-level, speaker-aware, exactly
 * time-stamped COMMENTARY UNITS out — the input format W209 (football
 * commentary understanding) consumes. Module map:
 *
 * - `types`: `CommentaryUnit` — the segmented unit with passthrough
 *   speaker/channel/confidence metadata and `sourceWindowIds` provenance
 * - `segment`: `segmentCommentary` — the deterministic rule-based segmenter
 *   (punctuation, speaker/channel changes, window gaps; no language model,
 *   no invented content), plus `DEFAULT_MAX_GAP_MS` and `SegmenterOptions`
 * - `benchmark`: `runSegmentationBenchmark` — the counted per-scenario
 *   report (in/out unit counts, split causes, character conservation)
 * - `observe`: `emitCommentaryObservations` — one contract `Observation` per
 *   unit (commentary modality / DERIVED provenance, confidence only when the
 *   units carried one), plus the `validateObservation` zod-parse helper
 *
 * Architecture-lock conformance: commentary is a first-class semantic input
 * — segmentation never drops text (character conservation is asserted by the
 * benchmark), never merges speakers silently (a label change is a hard
 * boundary), never invents timing (every timestamp is a passthrough of the
 * W207 unit times; intra-unit character timing is documented as unmodeled).
 */
export type { CommentaryUnit } from "./types";
export { DEFAULT_MAX_GAP_MS, segmentCommentary } from "./segment";
export type { SegmenterOptions } from "./segment";
export { runSegmentationBenchmark } from "./benchmark";
export type { SegmentationBenchmarkReport, SegmentationScenario } from "./benchmark";
export { emitCommentaryObservations, validateObservation } from "./observe";
export type { EmitCommentaryInput } from "./observe";
