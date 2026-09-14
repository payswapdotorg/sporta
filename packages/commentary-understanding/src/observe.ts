/**
 * Commentary-evidence emission (W209).
 *
 * Architecture-lock §3/§7 and the observation contract: extracted event
 * candidates enter the pipeline as contract `Observation` records — one
 * per {@link EventCandidate} — with provenance and confidence preserved:
 *
 * - `observationId = "ceu-<candidateId>"` (stable: derived from the
 *   candidate's own post-ordering id, so re-extracting the same units
 *   yields the same observation ids);
 * - `eventTimeMs = candidate.eventTimeMs` — the unit's `startMs`
 *   passthrough (session timeline);
 * - `modality: "commentary"`, `provenance: "DERIVED"` — pattern-based
 *   INFERENCE over segmented commentary, not a raw world observation;
 * - `confidence = candidate.confidence` — ALWAYS present: the extraction
 *   computes an honest per-candidate value (unlike W208, which passed
 *   through ASR confidence only when the windows carried one);
 * - payload `kind: "generic"` — the documented escape hatch for
 *   provisional producer output (contracts `observation.ts`): the payload
 *   `data` carries `{ eventType, eventPhrase, subjects, emphasis, unitId }`.
 *   A TYPED `event-candidate` payload variant is a FUTURE minor contracts
 *   bump (TL-gated, with the exported shape frozen here as the source for
 *   it) — recorded as an architectural concern in the W209 report;
 * - `subjectEntityRefs: []` — commentary subject mentions are NOT yet
 *   entities: mapping a spoken name to a session-local entity id is W401's
 *   multimodal fusion job (identity resolution needs vision
 *   corroboration), so this package makes NO entity claims;
 * - `schemaVersion` from the contracts constants.
 *
 * `ingestTimeMs` is deliberately NOT set: wall-clock ingestion time
 * belongs to the pipeline that actually ingests the records, and this
 * package is deterministic (no clock reads — docs/testing/HARNESS.md).
 */
import { Observation as ObservationSchema, SCHEMA_VERSION } from "@sporta/contracts";
import type { Observation } from "@sporta/contracts";
import type { EventCandidate } from "./types";

/** Input for {@link emitEventCandidateObservations}. */
export interface EmitEventCandidatesInput {
  /** Session the observations belong to (observations are session-scoped). */
  readonly sessionId: string;
  /** Producing component id (the understanding stage's component). */
  readonly componentId: string;
  /** The extracted candidates to emit, in extraction order. */
  readonly candidates: readonly EventCandidate[];
}

/**
 * Emits one contract `Observation` per event candidate (see module docs
 * for the exact field contract). Deterministic: no clock, no randomness,
 * no ids minted beyond the `ceu-<candidateId>` derivation.
 */
export function emitEventCandidateObservations(input: EmitEventCandidatesInput): Observation[] {
  return input.candidates.map((candidate) => ({
    observationId: `ceu-${candidate.candidateId}`,
    sessionId: input.sessionId,
    schemaVersion: SCHEMA_VERSION,
    eventTimeMs: candidate.eventTimeMs,
    modality: "commentary",
    componentId: input.componentId,
    provenance: "DERIVED",
    confidence: candidate.confidence,
    payload: {
      kind: "generic" as const,
      data: {
        eventType: candidate.eventType,
        eventPhrase: candidate.eventPhrase,
        subjects: candidate.subjects,
        emphasis: candidate.emphasis,
        unitId: candidate.unitId,
      },
    },
    subjectEntityRefs: [],
  }));
}

/**
 * Zod-parse helper: `true` iff `obs` parses against the contracts
 * `Observation` schema. Tests use it to prove every emitted record is
 * contract-valid; production callers may use it as a cheap boundary check.
 */
export function validateObservation(obs: unknown): boolean {
  return ObservationSchema.safeParse(obs).success;
}
