/**
 * @sporta/real-to-swm — the R207 real-to-SWM pipeline + the R208
 * reconstruction gate.
 *
 * ONE deterministic composition (R207): real MP4 clip → W102 decode →
 * perception adapter families (R201-R206 candidate chains with recorded
 * fallbacks) → W005 observation bridge → W401 fusion → W006 world-model
 * snapshots/events — with a typed, append-only degradation ledger for every
 * stage (decode, detect, track, ball, calibrate, team, bridge, fuse, emit):
 * frame counts in/out, confidence summaries, every dropped frame, every
 * fallback, every candidate-unavailable event. NO silent skips.
 *
 * The replayable reconstruction artifact (R208): the emitted SWM timeline +
 * the full ledger + per-entity provenance + the clip's verbatim provenance
 * (source URL, sha256, license) + a content hash (sha-256 over the canonical
 * serialization). Replay reconstructs the SWM view from the artifact alone —
 * no re-perception.
 *
 * Module map:
 * - `errors`: the typed error taxonomy (fail-closed admission, artifact
 *   integrity/validation)
 * - `ledger`: `PipelineStageRecord`, `DegradationEntry`, `DegradationLedger`
 * - `canonical`: canonical (key-sorted, undefined-stripped) JSON + sha-256
 * - `clip`: the clip source, honest receipt construction, magic-byte
 *   container admission
 * - `config`: the pipeline configuration + resolved-config echo
 * - `pipeline`: `RealToSwmPipeline` — the composition
 * - `bridge`: perception outputs → observation packets (frozen payload
 *   shapes, consumed never re-declared)
 * - `events`: vision-derived event candidates (canonical possession-change
 *   where pitch evidence exists; pipeline-level ball-impulse candidates)
 * - `artifact`: `ReconstructionArtifact`, content hash, parse/serialize,
 *   replay
 */
export {
  ArtifactIntegrityError,
  ArtifactValidationError,
  PipelineAdmissionError,
  RealToSwmError,
  isRealToSwmError,
} from "./errors";
export {
  DEGRADATION_EVIDENCE_LIMIT,
  DEGRADATION_KINDS,
  PIPELINE_STAGE_IDS,
  StageRecordBuilder,
  buildLedger,
  buildLedgerSummary,
  summarizeConfidence,
} from "./ledger";
export type {
  AttemptedCandidate,
  ConfidenceSummary,
  DegradationCount,
  DegradationEntry,
  DegradationKind,
  DegradationLedger,
  PipelineStageId,
  PipelineStageRecord,
} from "./ledger";
export { canonicalJson, sha256Hex, sha256HexOfString } from "./canonical";
export { buildDecodeSourceInput, sniffAdmittedContainer, withSessionId } from "./clip";
export type { AdmittedContainer, ClipProvenance, ClipSource } from "./clip";
export {
  DEFAULT_BALL_DETECTION_CHAIN,
  DEFAULT_BALL_IMPULSE_GATES,
  DEFAULT_BALL_TRACKING_CHAIN,
  DEFAULT_CALIBRATION_CHAIN,
  DEFAULT_PLAYER_DETECTION_CHAIN,
  DEFAULT_PLAYER_TRACKING_CHAIN,
  resolveConfig,
} from "./config";
export type {
  BallImpulseGates,
  CandidateChain,
  DecodeWindowConfig,
  RealToSwmPipelineConfig,
  ResolvedPipelineConfig,
} from "./config";
export { RealToSwmPipeline } from "./pipeline";
export type {
  EntityProvenance,
  PipelineHooks,
  PipelineResult,
  RealToSwmPipelineInput,
  ResolvedCandidate,
} from "./pipeline";
export {
  bridgeBallTracks,
  bridgeDetections,
  bridgeFieldMapping,
  bridgePlayerTracks,
  bridgeTeamAssignments,
  bridgedPosition,
  projectToPitch,
} from "./bridge";
export type { BridgedTrackPosition, BridgeSummary } from "./bridge";
export {
  clusterImpulseCandidates,
  deriveBallImpulseCandidates,
  derivePossessionChangeInputs,
  samplePossession,
} from "./events";
export type { BallPointEvidence, EventCandidateRecord, PossessionSample } from "./events";
export {
  artifactContentHash,
  buildReconstructionArtifact,
  parseArtifact,
  replayReconstruction,
  serializeArtifact,
} from "./artifact";
export type { ArtifactSwmTimeline, ReconstructionArtifact, ReconstructedView } from "./artifact";
