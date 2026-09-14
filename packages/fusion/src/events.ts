/**
 * Commentary event candidates → SWM events (W401 §3.1, pure).
 *
 * W209 emits one contract `Observation` per extracted event candidate:
 * `modality: "commentary"`, `provenance: "DERIVED"`, payload `kind: "generic"`
 * with `data: { eventType, eventPhrase, subjects, emphasis, unitId }`
 * (`packages/commentary-understanding/src/observe.ts`). This module is the
 * deterministic DATA-PURE mapping from those candidates onto the W006
 * world-model seams:
 *
 * - {@link FOOTBALL_EVENT_MAP}: `CommentaryEventType` → canonical
 *   `FootballEventType` / `MatchPeriod` clock rule. The mapping is a
 *   tech-lead AUTHORED decision (test-pinned), not an inference: it encodes
 *   which commentary vocabulary entries carry enough specificity to become
 *   a canonical football event, and which do not;
 * - {@link buildEventEnvelope}: candidate observation → `EventEnvelope`
 *   (point event at the candidate's timeline position);
 * - {@link buildClockPatch}: fulltime candidate → `FootballStatePatch`
 *   (period transition to `"post-match"`).
 *
 * HONESTY RULES (architecture-lock §4/§7; docs/contracts/
 * sports-world-model.md §provenance model):
 *
 * - a candidate is DERIVED understanding, NOT an observation of fact — every
 *   envelope carries `provenance: "DERIVED"`;
 * - `"other"` candidates map to NO event (insufficient specificity). The
 *   candidate REMAINS in the observation stream — dropping it from the
 *   evidence record would silently destroy commentary evidence; the fusion
 *   report counts it as a warning instead;
 * - the clock value is never invented: a fulltime patch pins `clockMs` to
 *   the caller-provided current football timeline position (see
 *   {@link buildClockPatch}) and changes only what commentary can honestly
 *   establish — the period and the stoppage flag.
 */
import { SCHEMA_VERSION } from "@sporta/contracts";
import type {
  EventEnvelope,
  EventEvidence,
  FootballEventType,
  MatchPeriod,
  Observation,
} from "@sporta/contracts";
import type { FootballStatePatch } from "@sporta/world-model";

/**
 * The W209 generic-payload `data` shape (structural subset; extra fields —
 * e.g. W209's subject `role`/`nameConfidence` — are tolerated).
 */
export interface CandidatePayload {
  /** The extracted `CommentaryEventType` (kebab-case, lowercase). */
  eventType: string;
  /** The matched text span, verbatim. */
  eventPhrase: string;
  /** Entity mentions in the containing sentence (may be empty — honest). */
  subjects: ReadonlyArray<{ name: string }>;
  /** Excitement of the containing sentence in [0, 1]. */
  emphasis: number;
  /** The W208 commentary unit the candidate was extracted from. */
  unitId: string;
}

/**
 * Data-pure commentary → football mapping (tech-lead authored; test-pinned):
 *
 * | CommentaryEventType | event               | clockRule       |
 * |---------------------|---------------------|-----------------|
 * | `pass`              | `pass`              | —               |
 * | `shot`              | `shot`              | —               |
 * | `goal`              | `goal`              | —               |
 * | `save`              | `save`              | —               |
 * | `offside`           | `offside`           | —               |
 * | `substitution`      | `substitution`      | —               |
 * | `card`              | `card`              | —               |
 * | `kickoff`           | `kickoff`           | —               |
 * | `corner`            | `restart`           | —               |
 * | `throw-in`          | `restart`           | —               |
 * | `free-kick`         | `restart`           | —               |
 * | `foul`              | `referee-decision`  | —               |
 * | `fulltime`          | NO event            | `"post-match"`  |
 * | `other`             | NO event            | —               |
 *
 * Rationale (documented per entry):
 *
 * - direct 1:1 renames where the vocabularies overlap;
 * - `corner`/`throw-in`/`free-kick` are set-piece RESTARTS — the taxonomy
 *   models restart detail as `restart` (W209's own types.ts documents this
 *   as fusion territory);
 * - `foul` is a referee signal, not a play event — `referee-decision`;
 * - `fulltime` carries no play semantics but DOES establish a period
 *   transition: no event, `clockRule: "post-match"`;
 * - `other` is reserved for spans no template matched — mapping it to any
 *   event would invent specificity the understanding stage explicitly did
 *   not claim (the candidate stays in the observation stream; the fusion
 *   warns and skips).
 */
export const FOOTBALL_EVENT_MAP: Readonly<
  Record<string, { event?: FootballEventType; clockRule?: MatchPeriod }>
> = {
  pass: { event: "pass" },
  shot: { event: "shot" },
  goal: { event: "goal" },
  save: { event: "save" },
  offside: { event: "offside" },
  substitution: { event: "substitution" },
  card: { event: "card" },
  kickoff: { event: "kickoff" },
  corner: { event: "restart" },
  "throw-in": { event: "restart" },
  "free-kick": { event: "restart" },
  foul: { event: "referee-decision" },
  fulltime: { clockRule: "post-match" },
  other: {},
};

/**
 * Parses a W209 candidate observation's generic payload `data` as a
 * {@link CandidatePayload}: `true` shape → the structural subset; `null` when
 * the observation is not a generic payload or `data` does not match the
 * documented shape (a non-candidate commentary observation is out of fusion
 * scope, not an error).
 */
export function parseCandidatePayload(observation: Observation): CandidatePayload | null {
  if (observation.payload.kind !== "generic") return null;
  const data = observation.payload.data;
  if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
  const d = data as Record<string, unknown>;
  if (typeof d.eventType !== "string" || d.eventType.length < 1) return null;
  if (typeof d.eventPhrase !== "string") return null;
  if (typeof d.emphasis !== "number" || !Number.isFinite(d.emphasis)) return null;
  if (typeof d.unitId !== "string" || d.unitId.length < 1) return null;
  if (!Array.isArray(d.subjects)) return null;
  for (const subject of d.subjects) {
    if (typeof subject !== "object" || subject === null) return null;
    if (typeof (subject as Record<string, unknown>).name !== "string") return null;
  }
  return {
    eventType: d.eventType,
    eventPhrase: d.eventPhrase,
    // The structural subset: extra subject fields (W209's role,
    // nameConfidence) are tolerated on input and dropped on parse.
    subjects: (d.subjects as ReadonlyArray<{ name: string }>).map((subject) => ({
      name: subject.name,
    })),
    emphasis: d.emphasis,
    unitId: d.unitId,
  };
}

/** Input for {@link buildEventEnvelope}. */
export interface BuildEventEnvelopeInput {
  /** Session the candidate (and the derived event) belong to. */
  readonly sessionId: string;
  /** The W209 candidate observation (generic payload). */
  readonly candidate: Observation;
  /**
   * Additional evidence chained onto the candidate (e.g. corroborating
   * transcription observations). `observationIds` are appended AFTER the
   * candidate's own id (duplicates of it are dropped); `reportedBy` passes
   * through.
   */
  readonly evidence: EventEvidence;
}

/**
 * Builds the `EventEnvelope` for a mappable W209 candidate observation:
 *
 * - `eventId = "fe-<observationId>"` — deterministic, so re-deriving the same
 *   candidate yields the same id (this is what makes engine-side
 *   `DuplicateEventError` the re-fusion dedup);
 * - `eventTypeRef = "football/v1/<mapped>"` from {@link FOOTBALL_EVENT_MAP};
 * - `interval = { startTimeMs: eventTimeMs, endTimeMs: eventTimeMs }` — a
 *   POINT event at the candidate time: W209 candidates carry a single
 *   timeline position (the commentary unit's `startMs` passthrough), not a
 *   span; inventing an interval would fabricate temporal extent;
 * - `eventTimeMs = candidate.eventTimeMs` (session timeline);
 * - `provenance: "DERIVED"` — candidates are derived understanding, NOT
 *   observations of fact (an inferred value may not be represented as
 *   directly observed);
 * - `confidence = candidate.confidence` — honest passthrough, omitted when
 *   the candidate carries none (never invented);
 * - `evidence` = the candidate's observation id first, then any additional
 *   evidence ids passed in (order-stable, deduplicated).
 *
 * Throws a `RangeError` (fail loud, repo style) when the candidate is not a
 * generic-payload W209 observation, its `data` does not parse as
 * {@link CandidatePayload}, or its `eventType` maps to no football event
 * (`fulltime`/`other`/unknown — the caller checks {@link FOOTBALL_EVENT_MAP}
 * first and routes those candidates elsewhere).
 */
export function buildEventEnvelope(input: BuildEventEnvelopeInput): EventEnvelope {
  const candidate = input.candidate;
  const data = parseCandidatePayload(candidate);
  if (data === null) {
    throw new RangeError(
      `buildEventEnvelope: observation "${candidate.observationId}" is not a W209 event ` +
        "candidate (requires a generic payload whose data parses as CandidatePayload)",
    );
  }
  const mapped = FOOTBALL_EVENT_MAP[data.eventType];
  if (mapped === undefined || mapped.event === undefined) {
    throw new RangeError(
      `buildEventEnvelope: commentary eventType "${data.eventType}" maps to no football ` +
        "event (the caller must route fulltime/other/unknown candidates elsewhere)",
    );
  }
  const observationIds = [
    candidate.observationId,
    ...input.evidence.observationIds.filter((id) => id !== candidate.observationId),
  ];
  return {
    eventId: `fe-${candidate.observationId}`,
    sessionId: input.sessionId,
    schemaVersion: SCHEMA_VERSION,
    eventTypeRef: `football/v1/${mapped.event}`,
    interval: { startTimeMs: candidate.eventTimeMs, endTimeMs: candidate.eventTimeMs },
    eventTimeMs: candidate.eventTimeMs,
    provenance: "DERIVED",
    ...(candidate.confidence !== undefined ? { confidence: candidate.confidence } : {}),
    evidence: {
      observationIds,
      ...(input.evidence.reportedBy !== undefined ? { reportedBy: input.evidence.reportedBy } : {}),
    },
  };
}

/**
 * Builds the football state patch for a period-establishing candidate:
 * `fulltime` yields `{ atMs: eventTimeMs, clock: { period: "post-match",
 * clockMs: currentFootballTimelineMs, stoppage: false } }`, exactly the W006
 * `FootballStatePatch` shape (`Partial<FootballState> & { atMs }`).
 *
 * `clockMs` is the caller-provided CURRENT football timeline position
 * (W006's `engine.footballTimelineMs`, a public getter). Per the W401 brief
 * ("caller passes current footballTimelineMs") the patch pins the clock to
 * that position instead of guessing match-elapsed time: the fusion owns the
 * period/stoppage transition the commentary honestly establishes, while the
 * clock VALUE stays caller context — clock advancement from real match time
 * is W402's temporal work, not commentary's to invent. A period change never
 * trips W006's `ClockRegressionError` (regression is only checked WITHIN a
 * period), so the patch is accepted by the engine whenever the period
 * actually changes.
 *
 * Returns `null` for every other candidate type (no period claim).
 */
export function buildClockPatch(
  candidate: Observation,
  currentFootballTimelineMs: number,
): FootballStatePatch | null {
  const data = parseCandidatePayload(candidate);
  if (data === null) return null;
  const mapped = FOOTBALL_EVENT_MAP[data.eventType];
  if (mapped === undefined || mapped.clockRule === undefined) return null;
  return {
    atMs: candidate.eventTimeMs,
    clock: {
      period: mapped.clockRule,
      clockMs: currentFootballTimelineMs,
      stoppage: false,
    },
  };
}
