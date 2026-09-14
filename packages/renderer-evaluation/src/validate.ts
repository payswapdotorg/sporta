/**
 * Fail-loud structural validation of a W502 clip manifest before measurement
 * (W503).
 *
 * **Malformed vs defective — the boundary this file draws:**
 *
 * - **Malformed** (this file, `TemporalEvaluationError` `manifest-malformed`):
 *   the document does not satisfy the STRUCTURAL contract the metrics rely
 *   on — missing fields, wrong types, non-integer sequences, a `frameIndex`
 *   that does not match its array position, non-monotone frame timestamps,
 *   an unknown disposition, a non-finite position, an unknown entity kind.
 *   The evaluator refuses to measure over a manifest it cannot trust: never
 *   a silent skip, never a guessed repair.
 * - **Defective** (measured by `./identity.ts`, `./drift.ts`,
 *   `./artifacts.ts`): the manifest is structurally sound but describes a
 *   temporally inconsistent render — unexplained entity absence, unstable
 *   style, implausible displacement, overlapping windows, regressing
 *   watermarks, flapping dispositions. Defects are COUNTED and drive the
 *   verdict; malformation is a thrown error.
 *
 * Everything validated here is a documented invariant of the W502 manifest
 * (`packages/renderer-anime/src/types.ts`) or of its construction
 * (`renderAnimeClip` / `renderAnimeFromSnapshot`): 0-based sequential frame
 * indices, strictly increasing output timestamps, closed disposition and
 * uncertainty vocabularies, entity kinds from the contracts enum.
 */
import { ENTITY_KINDS } from "@sporta/contracts";
import type { AnimeClipManifest, AnimeEntityDisposition } from "@sporta/renderer-anime";
import { TemporalEvaluationError, fail } from "./errors";

/** The closed disposition vocabulary of the W502 manifest. */
export const ENTITY_DISPOSITIONS: readonly AnimeEntityDisposition[] = [
  "rendered",
  "rendered-out-of-play",
  "omitted-out-of-play",
  "omitted-no-position",
  "omitted-invalid-position",
  "not-rendered-kind",
] as const;

/** The closed uncertainty-status vocabulary (contracts). */
const UNCERTAINTY_STATUSES: readonly string[] = ["known", "unknown", "uncertain"];

/** The closed skip reason vocabulary of the W502 manifest. */
const SKIP_REASONS: readonly string[] = ["before-window", "after-window"];

// ---------------------------------------------------------------------------
// Tiny structural predicates (JSON-space)
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

function isIn(value: unknown, vocabulary: readonly string[]): boolean {
  return isString(value) && vocabulary.includes(value);
}

function describe(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (isRecord(value)) return "object";
  if (isString(value)) return `string "${value.slice(0, 40)}"`;
  return `${typeof value} ${String(value).slice(0, 40)}`;
}

/** Requires a record field to satisfy a predicate, else fails with its path. */
function requireField(
  path: string,
  container: Record<string, unknown>,
  key: string,
  predicate: (value: unknown) => boolean,
  expected: string,
): void {
  const value = container[key];
  if (!predicate(value)) {
    fail("manifest-malformed", `${path}.${key}`, `must be ${expected} (got ${describe(value)})`);
  }
}

/** Requires an optional record field to satisfy a predicate when present. */
function requireOptionalField(
  path: string,
  container: Record<string, unknown>,
  key: string,
  predicate: (value: unknown) => boolean,
  expected: string,
): void {
  const value = container[key];
  if (value === undefined) return;
  if (!predicate(value)) {
    fail(
      "manifest-malformed",
      `${path}.${key}`,
      `must be ${expected} when present (got ${describe(value)})`,
    );
  }
}

/** Requires a finite `{x, y}` point. */
function requirePoint(path: string, value: unknown): void {
  if (!isRecord(value)) {
    fail("manifest-malformed", path, `must be an {x, y} object (got ${describe(value)})`);
  }
  requireField(path, value, "x", isFiniteNumber, "a finite number");
  requireField(path, value, "y", isFiniteNumber, "a finite number");
}

/** Requires a confidence in [0, 1]. */
function requireConfidence(path: string, value: unknown): void {
  if (!isFiniteNumber(value) || value < 0 || value > 1) {
    fail("manifest-malformed", path, `must be a finite number in [0, 1] (got ${describe(value)})`);
  }
}

// ---------------------------------------------------------------------------
// Section validators
// ---------------------------------------------------------------------------

function validateFrameEntry(path: string, frame: unknown, index: number): void {
  if (!isRecord(frame)) {
    fail("manifest-malformed", path, `must be a frame object (got ${describe(frame)})`);
  }
  requireField(path, frame, "frameIndex", isInteger, "an integer");
  const frameIndex = frame.frameIndex;
  if (frameIndex !== index) {
    fail(
      "manifest-malformed",
      `${path}.frameIndex`,
      `must equal the array index ${index} (got ${String(frameIndex)})`,
    );
  }
  requireField(path, frame, "outputTimestampMs", isFiniteNumber, "a finite number");

  const window = frame.windowMs;
  if (!isRecord(window)) {
    fail("manifest-malformed", `${path}.windowMs`, `must be an object (got ${describe(window)})`);
  }
  requireField(`${path}.windowMs`, window, "startMs", isFiniteNumber, "a finite number");
  requireField(`${path}.windowMs`, window, "endMs", isFiniteNumber, "a finite number");
  // startMs >= endMs is a MEASURED artifact (inverted window), not malformation.

  const source = frame.source;
  if (!isRecord(source)) {
    fail("manifest-malformed", `${path}.source`, `must be an object (got ${describe(source)})`);
  }
  const watermark = source.watermark;
  if (!isRecord(watermark)) {
    fail(
      "manifest-malformed",
      `${path}.source.watermark`,
      `must be an object (got ${describe(watermark)})`,
    );
  }
  requireField(
    `${path}.source.watermark`,
    watermark,
    "sequence",
    isInteger,
    "an integer event-log sequence",
  );
  requireField(
    `${path}.source.watermark`,
    watermark,
    "watermarkMs",
    isFiniteNumber,
    "a finite number",
  );
  requireField(`${path}.source`, source, "generatedAtMs", isFiniteNumber, "a finite number");
  requireField(`${path}.source`, source, "footballState", isBoolean, "a boolean");
  // A watermark REGRESSION (vs the previous frame) is a measured artifact.

  const applied = frame.appliedEventSequences;
  if (!Array.isArray(applied)) {
    fail(
      "manifest-malformed",
      `${path}.appliedEventSequences`,
      `must be an array of integers (got ${describe(applied)})`,
    );
  }
  for (let i = 0; i < applied.length; i += 1) {
    if (!isInteger(applied[i])) {
      fail(
        "manifest-malformed",
        `${path}.appliedEventSequences[${i}]`,
        `must be an integer (got ${describe(applied[i])})`,
      );
    }
  }
  // Non-ascending applied sequences are a measured artifact (appliedUnsorted).

  validateCaptions(`${path}.captions`, frame.captions);
  validatePossession(`${path}.possession`, frame.possession);
  validateEntities(`${path}.entities`, frame.entities);
}

function validateCaptions(path: string, captions: unknown): void {
  if (!isRecord(captions)) {
    fail("manifest-malformed", path, `must be a captions object (got ${describe(captions)})`);
  }
  const statusLineOk = (value: unknown) => isString(value) || value === null;
  requireField(path, captions, "statusLine", statusLineOk, "a string or null");
  requireField(path, captions, "clockText", statusLineOk, "a string or null");

  const score = captions.score;
  const scoreOk = (value: unknown): boolean => value === null || isRecord(value);
  requireField(path, captions, "score", scoreOk, "a score object or null");
  if (isRecord(score)) {
    requireField(`${path}.score`, score, "displayed", isBoolean, "a boolean");
    requireField(
      `${path}.score`,
      score,
      "status",
      (value: unknown) => isIn(value, UNCERTAINTY_STATUSES),
      "one of known, unknown, uncertain",
    );
    requireOptionalField(`${path}.score`, score, "text", isString, "a string");
  }

  const events = captions.events;
  if (!Array.isArray(events)) {
    fail("manifest-malformed", `${path}.events`, `must be an array (got ${describe(events)})`);
  }
  for (let i = 0; i < events.length; i += 1) {
    const event = events[i];
    const eventPath = `${path}.events[${i}]`;
    if (!isRecord(event)) {
      fail("manifest-malformed", eventPath, `must be an object (got ${describe(event)})`);
    }
    requireField(eventPath, event, "sequence", isInteger, "an integer");
    requireField(eventPath, event, "eventId", isString, "a string");
    requireField(eventPath, event, "phrase", isString, "a string");
  }

  const uncaptioned = captions.uncaptionedEvents;
  if (!Array.isArray(uncaptioned)) {
    fail(
      "manifest-malformed",
      `${path}.uncaptionedEvents`,
      `must be an array (got ${describe(uncaptioned)})`,
    );
  }
  for (let i = 0; i < uncaptioned.length; i += 1) {
    const event = uncaptioned[i];
    const eventPath = `${path}.uncaptionedEvents[${i}]`;
    if (!isRecord(event)) {
      fail("manifest-malformed", eventPath, `must be an object (got ${describe(event)})`);
    }
    requireField(eventPath, event, "sequence", isInteger, "an integer");
    requireField(eventPath, event, "eventId", isString, "a string");
    requireField(eventPath, event, "eventTypeRef", isString, "a string");
  }
}

function validatePossession(path: string, possession: unknown): void {
  if (possession === null) return;
  if (!isRecord(possession)) {
    fail(
      "manifest-malformed",
      path,
      `must be a possession object or null (got ${describe(possession)})`,
    );
  }
  requireField(
    path,
    possession,
    "status",
    (value: unknown) => isIn(value, UNCERTAINTY_STATUSES),
    "one of known, unknown, uncertain",
  );
  requireField(path, possession, "displayed", isBoolean, "a boolean");
  requireOptionalField(path, possession, "entityId", isString, "a string");
  requireOptionalField(
    path,
    possession,
    "confidence",
    (value: unknown) => isFiniteNumber(value) && value >= 0 && value <= 1,
    "a finite number in [0, 1]",
  );
}

function validateEntities(path: string, entities: unknown): void {
  if (!Array.isArray(entities)) {
    fail("manifest-malformed", path, `must be an array (got ${describe(entities)})`);
  }
  const seenEntityIds = new Set<string>();
  for (let i = 0; i < entities.length; i += 1) {
    const entity = entities[i];
    const entityPath = `${path}[${i}]`;
    if (!isRecord(entity)) {
      fail("manifest-malformed", entityPath, `must be an object (got ${describe(entity)})`);
    }
    requireField(
      entityPath,
      entity,
      "entityId",
      (value: unknown) => isString(value) && value.length > 0,
      "a non-empty string",
    );
    const entityId = entity.entityId;
    if (isString(entityId)) {
      if (seenEntityIds.has(entityId)) {
        fail(
          "manifest-malformed",
          entityPath,
          `duplicate entity entry for entityId "${entityId}" — the W502 accounting contract records every snapshot entity exactly once per frame`,
        );
      }
      seenEntityIds.add(entityId);
    }
    requireField(
      entityPath,
      entity,
      "kind",
      (value: unknown) => isIn(value, ENTITY_KINDS),
      `one of ${ENTITY_KINDS.join(", ")}`,
    );
    requireField(
      entityPath,
      entity,
      "disposition",
      (value: unknown) => isIn(value, ENTITY_DISPOSITIONS),
      "one of the six W502 dispositions",
    );
    requireOptionalField(entityPath, entity, "positionMeters", isRecord, "an {x, y} object");
    if (entity.positionMeters !== undefined) {
      requirePoint(`${entityPath}.positionMeters`, entity.positionMeters);
    }
    requireOptionalField(entityPath, entity, "svgPosition", isRecord, "an {x, y} object");
    if (entity.svgPosition !== undefined) {
      requirePoint(`${entityPath}.svgPosition`, entity.svgPosition);
    }
    requireOptionalField(
      entityPath,
      entity,
      "positionStatus",
      (value: unknown) => isIn(value, UNCERTAINTY_STATUSES),
      "one of known, unknown, uncertain",
    );
    requireOptionalField(entityPath, entity, "confidence", isFiniteNumber, "a finite number");
    if (entity.confidence !== undefined) {
      requireConfidence(`${entityPath}.confidence`, entity.confidence);
    }
    const style = entity.style;
    if (style !== undefined) {
      if (!isRecord(style)) {
        fail(
          "manifest-malformed",
          `${entityPath}.style`,
          `must be an object (got ${describe(style)})`,
        );
      }
      requireField(
        `${entityPath}.style`,
        style,
        "paletteIndex",
        (value: unknown) => isInteger(value) && value >= 0,
        "a non-negative integer",
      );
      requireField(`${entityPath}.style`, style, "jersey", isString, "a string");
      requireField(`${entityPath}.style`, style, "trim", isString, "a string");
    }
  }
}

// ---------------------------------------------------------------------------
// The manifest validator
// ---------------------------------------------------------------------------

/**
 * Validates a W502 `AnimeClipManifest` structurally. Throws
 * {@link TemporalEvaluationError} (`manifest-malformed`) on the FIRST
 * violation with its JSON path — never returns false, never skips silently.
 *
 * Invariants enforced (all documented W502 construction invariants):
 *
 * - top-level sections `renderer`, `session`, `output`, `provenance`,
 *   `watermarkAfter`, `frames`, `skippedEvents`, `degradation` present and
 *   well-typed;
 * - `frames` non-empty; `frameIndex[i] === i` (0-based sequential);
 * - `outputTimestampMs` finite and STRICTLY increasing (non-monotone frames
 *   are malformed — a temporal evaluator cannot walk a time-traveling
 *   frame list);
 * - per-frame `windowMs`, `source.watermark`, `captions`, `possession`,
 *   `entities` well-typed; dispositions/kinds/statuses from the closed
 *   vocabularies; positions finite; confidences in [0, 1]; style tokens
 *   `{paletteIndex, jersey, trim}`.
 */
export function validateManifest(manifest: AnimeClipManifest): void {
  if (!isRecord(manifest)) {
    fail("manifest-malformed", "$", `must be a manifest object (got ${describe(manifest)})`);
  }

  // renderer
  const renderer = manifest.renderer;
  if (!isRecord(renderer)) {
    fail("manifest-malformed", "$.renderer", `must be an object (got ${describe(renderer)})`);
  }
  requireField("$.renderer", renderer, "rendererId", isString, "a string");
  requireField("$.renderer", renderer, "rendererVersion", isString, "a string");
  requireField("$.renderer", renderer, "styleId", isString, "a string");
  requireField("$.renderer", renderer, "configSchemaVersion", isString, "a string");

  // session
  const session = manifest.session;
  if (!isRecord(session)) {
    fail("manifest-malformed", "$.session", `must be an object (got ${describe(session)})`);
  }
  requireField("$.session", session, "sessionId", isString, "a string");
  requireField(
    "$.session",
    session,
    "snapshotVersion",
    (value: unknown) => isInteger(value) && value >= 0,
    "a non-negative integer",
  );
  requireField(
    "$.session",
    session,
    "eventsSinceSequence",
    (value: unknown) => isInteger(value) && value >= 0,
    "a non-negative integer",
  );

  // output
  const output = manifest.output;
  if (!isRecord(output)) {
    fail("manifest-malformed", "$.output", `must be an object (got ${describe(output)})`);
  }
  requireField("$.output", output, "profile", isRecord, "an object");
  requireField("$.output", output, "startMs", isFiniteNumber, "a finite number");
  requireField(
    "$.output",
    output,
    "frameIntervalMs",
    (value: unknown) => isFiniteNumber(value) && value > 0,
    "a finite number > 0",
  );
  requireField(
    "$.output",
    output,
    "durationMs",
    (value: unknown) => isFiniteNumber(value) && value > 0,
    "a finite number > 0",
  );

  // provenance + watermarkAfter
  const provenance = manifest.provenance;
  if (!isRecord(provenance)) {
    fail("manifest-malformed", "$.provenance", `must be an object (got ${describe(provenance)})`);
  }
  requireField(
    "$.provenance",
    provenance,
    "snapshotVersion",
    (value: unknown) => isInteger(value) && value >= 0,
    "a non-negative integer",
  );
  requireField(
    "$.provenance",
    provenance,
    "lastEventSequence",
    (value: unknown) => isInteger(value) && value >= 0,
    "a non-negative integer",
  );
  const watermarkAfter = manifest.watermarkAfter;
  if (!isRecord(watermarkAfter)) {
    fail(
      "manifest-malformed",
      "$.watermarkAfter",
      `must be an object (got ${describe(watermarkAfter)})`,
    );
  }
  requireField(
    "$.watermarkAfter",
    watermarkAfter,
    "sequence",
    (value: unknown) => isInteger(value) && value >= 0,
    "a non-negative integer",
  );
  requireField(
    "$.watermarkAfter",
    watermarkAfter,
    "watermarkMs",
    isFiniteNumber,
    "a finite number",
  );

  // frames
  const frames = manifest.frames;
  if (!Array.isArray(frames) || frames.length === 0) {
    fail("manifest-malformed", "$.frames", `must be a non-empty array (got ${describe(frames)})`);
  }
  let previousTimestamp: number | undefined;
  for (let i = 0; i < frames.length; i += 1) {
    const framePath = `$.frames[${i}]`;
    validateFrameEntry(framePath, frames[i], i);
    const timestamp = (frames[i] as unknown as Record<string, unknown>).outputTimestampMs;
    if (isFiniteNumber(timestamp)) {
      if (previousTimestamp !== undefined && timestamp <= previousTimestamp) {
        fail(
          "manifest-malformed",
          `${framePath}.outputTimestampMs`,
          `frames must have strictly increasing timestamps (${timestamp} <= ${previousTimestamp} at index ${i})`,
        );
      }
      previousTimestamp = timestamp;
    }
  }

  // skippedEvents
  const skipped = manifest.skippedEvents;
  if (!Array.isArray(skipped)) {
    fail("manifest-malformed", "$.skippedEvents", `must be an array (got ${describe(skipped)})`);
  }
  for (let i = 0; i < skipped.length; i += 1) {
    const event = skipped[i];
    const eventPath = `$.skippedEvents[${i}]`;
    if (!isRecord(event)) {
      fail("manifest-malformed", eventPath, `must be an object (got ${describe(event)})`);
    }
    requireField(eventPath, event, "sequence", isInteger, "an integer");
    requireField(eventPath, event, "eventId", isString, "a string");
    requireField(eventPath, event, "eventTimeMs", isFiniteNumber, "a finite number");
    requireField(
      eventPath,
      event,
      "reason",
      (value: unknown) => isIn(value, SKIP_REASONS),
      "one of before-window, after-window",
    );
  }

  // degradation
  const degradation = manifest.degradation;
  if (!isRecord(degradation)) {
    fail("manifest-malformed", "$.degradation", `must be an object (got ${describe(degradation)})`);
  }
  requireField("$.degradation", degradation, "degraded", isBoolean, "a boolean");
  const reasons = degradation.reasons;
  if (!Array.isArray(reasons)) {
    fail(
      "manifest-malformed",
      "$.degradation.reasons",
      `must be an array (got ${describe(reasons)})`,
    );
  }
  for (let i = 0; i < reasons.length; i += 1) {
    if (!isString(reasons[i])) {
      fail(
        "manifest-malformed",
        `$.degradation.reasons[${i}]`,
        `must be a string (got ${describe(reasons[i])})`,
      );
    }
  }
}

export type { AnimeClipManifest };
export { TemporalEvaluationError };
