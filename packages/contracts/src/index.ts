/**
 * @sporta/contracts — shared domain contracts for the Sporta platform.
 *
 * Zod v4 schemas are the source of truth; TypeScript types are inferred
 * (`z.infer`) and JSON Schemas are exported via `z.toJSONSchema` (run
 * `bun run export-schemas` in this package). Module map:
 *
 * - `versioning`: schema version constants and compatibility helpers
 * - `timestamps`: canonical timestamp, interval, and watermark contracts
 * - `identity`: session-local subject identity contracts
 * - `rights`: media rights/authorization contracts (fail-closed) and the
 *   derived rights capabilities passed to renderers
 * - `uncertainty`: the `UncertainValue` pattern (kept in its own module so
 *   `football` and `world-model` share it without a circular dependency)
 * - `media-session`: media session, source, timeline, and processing state
 * - `observation`: raw observations with provenance/confidence and the
 *   discriminated payload union (detection/track/transcription/field-mapping/generic)
 * - `event`: versioned event envelopes with evidence and correction semantics
 * - `football`: football sport extension (pitch frame, clock, score, taxonomy)
 * - `world-model`: SWM entities, snapshots, and the event stream
 * - `renderer`: renderer requests, results, and capability contracts
 * - `streaming`: stage messages/results and backpressure policy
 *
 * Compatibility policy: docs/contracts/COMPATIBILITY.md. Golden JSON-Schema
 * snapshots: fixtures/schemas-golden/ (enforced by
 * test/schema-compatibility.test.ts).
 */
import { z } from "zod";

// Re-exports below carry both the schema (value) and inferred-type meanings of
// each name. Type-only names use `export type`.
export {
  SCHEMA_MAJOR,
  SCHEMA_MINOR,
  SCHEMA_VERSION,
  SchemaVersioned,
  isCompatibleVersion,
  schemaVersionField,
} from "./versioning";
export type { SchemaVersionString } from "./versioning";

export { IngestedAt, Interval, TimelinePoint, Watermark } from "./timestamps";

export {
  ENTITY_ID_PATTERN,
  ENTITY_KINDS,
  EntityId,
  EntityKind,
  ExternalIdentityMapping,
  LocalEntityRef,
} from "./identity";

export {
  AllowedOperation,
  AuthorizationPolicy,
  RightsCapabilities,
  SharingScope,
  deriveRightsCapabilities,
} from "./rights";

export {
  MediaSession,
  ProcessingState,
  SessionStatus,
  SessionTimeline,
  SourceMedia,
  SourceMediaKind,
  TerminalFailureClass,
} from "./media-session";

export {
  DetectionPayload,
  FieldMappingPayload,
  GenericPayload,
  Observation,
  ObservationPayload,
  ProvenanceKind,
  SourceModality,
  TrackPayload,
  TranscriptionPayload,
} from "./observation";

export { EventEnvelope, EventEvidence } from "./event";

export {
  FOOTBALL_EVENT_TYPES,
  FootballEventType,
  MatchClock,
  MatchPeriod,
  PITCH_AXES,
  PITCH_LENGTH_AXIS_METERS,
  PITCH_ORIGIN,
  PITCH_WIDTH_AXIS_METERS,
  PitchFrame,
  PitchPoint,
  Score,
  ScoreStatusValue,
} from "./football";

export {
  UncertainValue,
  UncertaintyStatus,
  WorldEntity,
  WorldEventStreamEntry,
  WorldSnapshot,
  uncertainValue,
} from "./world-model";

export {
  OutputLatencyClass,
  OutputProfile,
  OutputSegment,
  RenderRequest,
  RenderResult,
  RendererCapability,
  RendererClass,
  RendererHealth,
} from "./renderer";

export {
  BackpressurePolicy,
  ResourceBudget,
  StageMessage,
  StageResult,
  StageStatus,
} from "./streaming";

export {
  AdapterTaskKind,
  FailureClassRecord,
  LicenseComponent,
  LicenseComponentStatus,
  ResourceRequirements,
  TechnologyCandidate,
  TechnologyLicenseRecord,
  TechnologyProfile,
  TechnologyStatus,
  TECHNOLOGY_TRANSITIONS,
  blockingLicenseIssues,
  isLegalTechnologyTransition,
} from "./technology";
export {
  BenchmarkRun,
  EvaluationRecommendation,
  EvaluationReport,
  PromotionRecord,
  missingPromotionEvidence,
} from "./technology-evaluation";
export {
  PERCEPTION_TASK_BINDINGS,
  PerceptionAdapterDescriptor,
  PerceptionTaskKind,
  isPerceptionTask,
  perceptionBindingIssues,
} from "./perception-adapter";
export {
  ContentAddress,
  MediaManifest,
  NormalizedAudioStream,
  NormalizedVideoStream,
  RealityKind,
  RenderArtifactManifest,
  SourceAsset,
  SourceAssetUploadState,
  SwmProvenance,
  manifestProvenanceIssues,
} from "./media-artifact";
export {
  GameEngineDescriptor,
  GameEngineEncodedOutput,
  GameEngineEncodedSegment,
  GameEngineFrameOutput,
  GameEngineRenderOutput,
  GameEngineRenderTelemetry,
  GameEngineRenderingStyle,
  GameSceneBuildRequest,
  GameSceneHandle,
  GameSceneOutputProfile,
  GameSceneRenderRequest,
  GameSceneRenderResult,
  GameSceneUpdateResult,
} from "./game-engine";
export type { GameEngineAdapter, MaybePromise } from "./game-engine";

import { ExternalIdentityMapping } from "./identity";
import { MediaSession } from "./media-session";
import { Observation } from "./observation";
import {
  TechnologyCandidate as TechnologyCandidateSchema,
  TechnologyProfile,
  TechnologyLicenseRecord,
} from "./technology";
import { BenchmarkRun, EvaluationReport, PromotionRecord } from "./technology-evaluation";
import { PerceptionAdapterDescriptor } from "./perception-adapter";
import { SourceAsset, MediaManifest, RenderArtifactManifest } from "./media-artifact";
import { EventEnvelope } from "./event";
import { WorldEventStreamEntry, WorldSnapshot } from "./world-model";
import { RenderRequest, RenderResult, RendererCapability } from "./renderer";
import { AuthorizationPolicy, RightsCapabilities } from "./rights";
import { StageMessage, StageResult } from "./streaming";

/**
 * Registry of every exportable contract schema, keyed by kebab-case contract
 * name. This registry drives the JSON-Schema export
 * (`scripts/export-schemas.ts`) and the golden-snapshot and fixture tests.
 * Adding an entry requires regenerating `fixtures/schemas-golden/`.
 */
export const CONTRACT_SCHEMAS: Record<string, z.ZodType> = {
  "media-session": MediaSession,
  observation: Observation,
  event: EventEnvelope,
  "world-snapshot": WorldSnapshot,
  "world-event-stream-entry": WorldEventStreamEntry,
  "render-request": RenderRequest,
  "render-result": RenderResult,
  "renderer-capability": RendererCapability,
  "stage-message": StageMessage,
  "stage-result": StageResult,
  "authorization-policy": AuthorizationPolicy,
  "rights-capabilities": RightsCapabilities,
  "external-identity-mapping": ExternalIdentityMapping,
  "technology-candidate": TechnologyCandidateSchema,
  "technology-profile": TechnologyProfile,
  "technology-license-record": TechnologyLicenseRecord,
  "benchmark-run": BenchmarkRun,
  "evaluation-report": EvaluationReport,
  "promotion-record": PromotionRecord,
  "perception-adapter-descriptor": PerceptionAdapterDescriptor,
  "source-asset": SourceAsset,
  "media-manifest": MediaManifest,
  "render-artifact-manifest": RenderArtifactManifest,
};

/** Package version of @sporta/contracts. */
export const CONTRACTS_PACKAGE_VERSION = "0.1.0";
