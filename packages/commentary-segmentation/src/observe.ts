/**
 * Commentary observation emission (W208).
 *
 * Architecture-lock §3/§4 and the observation contract: segmented commentary
 * enters the pipeline as contract `Observation` records — one per
 * {@link CommentaryUnit} — with provenance and confidence preserved:
 *
 * - `observationId = "seg-<unitId>"` (stable: derived from the unit's own id,
 *   so re-emitting the same units yields the same observation ids);
 * - `eventTimeMs = unit.startMs` — the session-timeline passthrough the
 *   segmenter derived from the W207 unit times;
 * - `modality: "commentary"` — W207 emitted `"audio"` for its raw STT
 *   windows; the segmented stream is already commentary-domain structure
 *   (sentence-level, speaker-aware units), so it carries the commentary
 *   modality. (Full football-language interpretation stays W209's territory —
 *   this emission claims segmentation, not understanding.)
 * - `provenance: "DERIVED"` — segmentation is deterministic INFERENCE over
 *   observed transcriptions (sentence boundaries, speaker attribution across
 *   windows), not a raw observation of the world;
 * - `confidence = unit.asrConfidence` when present, else OMITTED entirely —
 *   never invented (architecture-lock §4). The payload mirrors the same
 *   value as `asrConfidence`;
 * - payload `kind: "transcription"` with `text` plus `speakerLabel`/`channel`
 *   passthrough, keys present ONLY when the unit carries them;
 * - `subjectEntityRefs: []` — no entity claims yet; W209 extracts subjects;
 * - `schemaVersion` from the contracts constants.
 *
 * `ingestTimeMs` is deliberately NOT set: wall-clock ingestion time belongs
 * to the pipeline that actually ingests the records, and this package is
 * deterministic (no clock reads — docs/testing/HARNESS.md).
 */
import { Observation as ObservationSchema, SCHEMA_VERSION } from "@sporta/contracts";
import type { Observation } from "@sporta/contracts";
import type { CommentaryUnit } from "./types";

/** Input for {@link emitCommentaryObservations}. */
export interface EmitCommentaryInput {
  /** Session the observations belong to (observations are session-scoped). */
  readonly sessionId: string;
  /** Producing component id (the segmentation stage's component). */
  readonly componentId: string;
  /** The commentary units to emit, in emission order. */
  readonly commentary: readonly CommentaryUnit[];
}

/**
 * Emits one contract `Observation` per commentary unit (see module docs for
 * the exact field contract). Deterministic: no clock, no randomness, no ids
 * minted beyond the `seg-<unitId>` derivation.
 */
export function emitCommentaryObservations(input: EmitCommentaryInput): Observation[] {
  return input.commentary.map((unit) => ({
    observationId: `seg-${unit.unitId}`,
    sessionId: input.sessionId,
    schemaVersion: SCHEMA_VERSION,
    eventTimeMs: unit.startMs,
    modality: "commentary",
    componentId: input.componentId,
    provenance: "DERIVED",
    ...(unit.asrConfidence !== undefined ? { confidence: unit.asrConfidence } : {}),
    payload: {
      kind: "transcription" as const,
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
export function validateObservation(obs: unknown): boolean {
  return ObservationSchema.safeParse(obs).success;
}
