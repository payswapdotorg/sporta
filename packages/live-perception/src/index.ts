/**
 * @sporta/live-perception — THE BROADCAST-PERCEPTION → LIVE-OBSERVATION
 * RUNTIME SEAM (L011).
 *
 * Broadcast perception feeds the SAME live observation contract: per-frame
 * perception outputs (tracked player boxes, optional ball detections, the
 * pitch calibration) become frozen `LiveObservation` batches with
 * `sourceType: "BROADCAST_PERCEPTION"`, flowing through the SAME
 * composition — `TemporalBufferEngine` (L004) → `LiveSwmUpdater` (L003) →
 * the ONE canonical `WorldModelEngine` — with NO renderer changes and NO
 * second SWM (the acceptance pins, proven by the integration test over a
 * real decoded clip).
 *
 * CONSTITUTION (pinned by tests):
 * - the position projection is `bridgedPosition` IMPORTED from
 *   `@sporta/real-to-swm` — the exact batch-bridge arithmetic (no forked
 *   semantics: confidence discounted by the calibration confidence,
 *   off-pitch projections flagged + counted, infinite projections dropped +
 *   counted);
 * - track ids pass through VERBATIM (the batch convention — a clip processed
 *   through batch and through this seam yields the same entity ids);
 * - positions are PITCH METERS by contract (a calibration is required; the
 *   seam refuses image-space positions);
 * - no velocity is ever invented; a missing ball is an honest missing row;
 * - every emitted batch parses against the STRICT frozen LiveObservation
 *   contract (any perception-field leak refuses loudly).
 */
// The seam (the pure per-frame transformer)
export {
  BROADCAST_PERCEPTION_ADAPTER_ID,
  BROADCAST_PERCEPTION_ADAPTER_VERSION,
  BROADCAST_PERCEPTION_DEFAULT_BASE_LATENCY_MS,
  BROADCAST_PERCEPTION_DEFAULT_SOURCE_ID,
  createBroadcastPerceptionSeam,
} from "./seam";
export type {
  BroadcastPerceptionFrame,
  BroadcastPerceptionSeam,
  BroadcastPerceptionSeamConfig,
  BroadcastPerceptionSeamStats,
} from "./seam";
// The clip-driven source (decode → detect → track → the seam, incrementally)
export { BroadcastPerceptionClipSource, createBroadcastPerceptionClipSource } from "./source";
export type { BroadcastPerceptionClipSourceConfig, BroadcastPerceptionSourceStats } from "./source";
