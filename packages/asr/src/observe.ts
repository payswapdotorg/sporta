/**
 * Transcription observation emission (W207).
 *
 * Architecture-lock §3/§6 and ADR-002: commentary is a first-class semantic
 * input, and STT output enters the pipeline as OBSERVATIONS with provenance
 * and confidence preserved. This module turns {@link TranscriptionUnit}s into
 * contract `Observation` records — one per unit — exactly the W201/W202
 * emission pattern applied to audio:
 *
 * - `observationId = "stt-<unitId>"` (stable: derived from the unit's own id,
 *   so re-emitting the same units yields the same observation ids);
 * - `eventTimeMs = unit.startMs` — the timeline position the unit carries
 *   (session timeline when the adapter was given a W103-derived mapper, else
 *   source time passed through);
 * - `modality: "audio"` — RAW STT output. The `"commentary"` modality is
 *   W209's: football-language interpretation is what upgrades audio into
 *   commentary, and this module must not anticipate it;
 * - `provenance: "OBSERVED"`;
 * - `confidence = unit.asrConfidence` when present, else OMITTED entirely —
 *   never invented (architecture-lock §4). The payload mirrors the same
 *   value as `asrConfidence`;
 * - payload `kind: "transcription"` with `text` verbatim plus
 *   `speakerLabel`/`channel` passthrough when present;
 * - `subjectEntityRefs: []` — speaker identity/diarization is W208's
 *   territory, never invented here;
 * - `schemaVersion` from the contracts constants.
 *
 * `ingestTimeMs` is deliberately NOT set: wall-clock ingestion time belongs
 * to the pipeline that actually ingests the records, and this package is
 * deterministic (no clock reads — docs/testing/HARNESS.md).
 */
import { Observation as ObservationSchema, SCHEMA_VERSION } from "@sporta/contracts";
import type { Observation } from "@sporta/contracts";
import type { TranscriptionUnit } from "./types";

/** Input for {@link emitTranscriptionObservations}. */
export interface EmitTranscriptionInput {
  /** Session the observations belong to (observations are session-scoped). */
  readonly sessionId: string;
  /** Producing component id (typically the ASR backend's `backendId`). */
  readonly componentId: string;
  /** The transcription units to emit, in emission order. */
  readonly units: readonly TranscriptionUnit[];
}

/**
 * Emits one contract `Observation` per transcription unit (see module docs
 * for the exact field contract). Deterministic: no clock, no randomness, no
 * ids minted beyond the `stt-<unitId>` derivation.
 */
export function emitTranscriptionObservations(input: EmitTranscriptionInput): Observation[] {
  return input.units.map((unit) => ({
    observationId: `stt-${unit.unitId}`,
    sessionId: input.sessionId,
    schemaVersion: SCHEMA_VERSION,
    eventTimeMs: unit.startMs,
    modality: "audio",
    componentId: input.componentId,
    provenance: "OBSERVED",
    ...(unit.asrConfidence !== undefined ? { confidence: unit.asrConfidence } : {}),
    payload: {
      kind: "transcription",
      text: unit.text,
      ...(unit.speakerLabel !== undefined ? { speakerLabel: unit.speakerLabel } : {}),
      ...(unit.channel !== undefined ? { channel: unit.channel } : {}),
      ...(unit.asrConfidence !== undefined ? { asrConfidence: unit.asrConfidence } : {}),
    },
    subjectEntityRefs: [],
  }));
}

/**
 * Zod-parse helper: `true` iff `obs` parses against the contracts
 * `Observation` schema. Tests use it to prove every emitted record is
 * contract-valid; production callers may use it as a cheap boundary check.
 */
export function validateTranscriptionObservation(obs: unknown): boolean {
  return ObservationSchema.safeParse(obs).success;
}
