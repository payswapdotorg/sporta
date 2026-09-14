/**
 * Structural self-check of a {@link WorldModelArtifact} (fail loud, repo
 * style).
 *
 * The comparator's classification table already fails loud on any path it
 * cannot classify — but a WILDCARD rule (`$.stateAt.*`, `$.fusion.*`) accepts
 * any KEY under it, and a brand-new field could otherwise hide behind such a
 * wildcard as "just another classified child". This module closes that hole at
 * the source: the pipeline asserts, BEFORE serialization, that the artifact
 * carries EXACTLY the known keys at every level. An unknown key is an
 * explicit `RangeError` carrying the full JSON path — an artifact shape
 * change must be a conscious act (bump `ARTIFACT_SCHEMA`, extend the known
 * sets here, extend the classification table, regenerate the golden, and have
 * the tech lead review it).
 */
import type { WorldModelArtifact } from "./artifact";

/** The key sets of every object level of the artifact (documented shape). */
interface KnownKeys {
  readonly required: readonly string[];
  readonly optional?: readonly string[];
}

const REPORT_KEYS: KnownKeys = {
  required: [
    "entitiesUpserted",
    "eventsApplied",
    "eventsDeduplicated",
    "clockPatches",
    "possessionUpdates",
    "snapshotVersionAfter",
    "conflicts",
    "warnings",
  ],
};
const CONFLICT_KEYS: KnownKeys = {
  required: ["conflictId", "slotKey", "observationIds", "values", "resolution", "detectedAtMs"],
};
const CONFLICT_VALUE_KEYS: KnownKeys = { required: ["value"], optional: ["confidence"] };
const SNAPSHOT_KEYS: KnownKeys = {
  required: ["sessionId", "schemaVersion", "watermark", "entities", "generatedAtMs"],
  optional: ["football"],
};
const WATERMARK_KEYS: KnownKeys = { required: ["watermarkMs", "sequence"] };
const ENTITY_KEYS: KnownKeys = {
  required: ["entityId", "kind", "version", "lastEventTimeMs", "state"],
};
/** W401's track-entity projection slots — extending these is a shape change. */
const ENTITY_STATE_KEYS: KnownKeys = {
  required: ["position", "spatialFrame", "lastSeenMs"],
};
const UNCERTAIN_VALUE_KEYS: KnownKeys = {
  required: ["status"],
  optional: ["value", "confidence"],
};
const FOOTBALL_KEYS: KnownKeys = {
  required: ["pitch", "clock", "score", "possession", "eventTaxonomyVersion"],
};
const PITCH_KEYS: KnownKeys = {
  required: ["lengthAxisMeters", "widthAxisMeters", "origin", "axes"],
};
const CLOCK_KEYS: KnownKeys = { required: ["period", "clockMs", "stoppage"] };
const SCORE_KEYS: KnownKeys = { required: ["home", "away", "status"] };
const POSSESSION_VALUE_KEYS: KnownKeys = { required: ["entityId"] };
const ENTRY_KEYS: KnownKeys = { required: ["sequence", "snapshotVersionAfter", "event"] };
const EVENT_KEYS: KnownKeys = {
  required: [
    "eventId",
    "sessionId",
    "schemaVersion",
    "eventTypeRef",
    "interval",
    "eventTimeMs",
    "provenance",
    "evidence",
  ],
  optional: ["confidence", "correctionOf"],
};
const EVIDENCE_KEYS: KnownKeys = { required: ["observationIds"], optional: ["reportedBy"] };
const INTERVAL_KEYS: KnownKeys = { required: ["startTimeMs", "endTimeMs"] };
const LIMITS_KEYS: KnownKeys = {
  required: ["maxEvents", "maxSpanMs", "checkpointEveryMs"],
};

/** Renders a path array (`["$", "a", "[2]", "b"]`) as `$.a[2].b`. */
function render(path: readonly string[]): string {
  let out = "$";
  for (const segment of path) {
    if (segment === "$") continue;
    out += segment.startsWith("[") ? segment : `.${segment}`;
  }
  return out;
}

/** Checks one object level: present, plain object, known keys, all required. */
function checkObject(value: unknown, path: readonly string[], keys: KnownKeys): void {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new RangeError(
      `assertArtifactShape: ${render(path)} must be an object (got ${typeof value})`,
    );
  }
  const present = new Set(Object.keys(value));
  for (const key of keys.required) {
    if (!present.has(key)) {
      throw new RangeError(`assertArtifactShape: ${render(path)} is missing required key "${key}"`);
    }
    present.delete(key);
  }
  for (const key of keys.optional ?? []) {
    present.delete(key);
  }
  if (present.size > 0) {
    const unknown = [...present].sort().join(", ");
    throw new RangeError(
      `assertArtifactShape: ${render(path)} carries unknown key(s) [${unknown}] — ` +
        "an artifact shape change must bump ARTIFACT_SCHEMA and be consciously propagated " +
        "(shape.ts key sets, compare.ts classification, TOLERANCE.md, regen-golden)",
    );
  }
}

/** Checks one snapshot (the shared shape of `stateAt.*`, checkpoints, final). */
function checkSnapshot(value: unknown, path: readonly string[]): void {
  checkObject(value, path, SNAPSHOT_KEYS);
  const snapshot = value as Record<string, unknown>;
  checkObject(snapshot.watermark, [...path, "watermark"], WATERMARK_KEYS);
  if (!Array.isArray(snapshot.entities)) {
    throw new RangeError(`assertArtifactShape: ${render([...path, "entities"])} must be an array`);
  }
  snapshot.entities.forEach((entity, index) =>
    checkEntity(entity, [...path, "entities", `[${index}]`]),
  );
  if (snapshot.football !== undefined) {
    checkObject(snapshot.football, [...path, "football"], FOOTBALL_KEYS);
    const football = snapshot.football as Record<string, unknown>;
    checkObject(football.pitch, [...path, "football", "pitch"], PITCH_KEYS);
    checkObject(football.clock, [...path, "football", "clock"], CLOCK_KEYS);
    checkObject(football.score, [...path, "football", "score"], SCORE_KEYS);
    const score = football.score as Record<string, unknown>;
    checkObject(score.status, [...path, "football", "score", "status"], UNCERTAIN_VALUE_KEYS);
    checkObject(football.possession, [...path, "football", "possession"], UNCERTAIN_VALUE_KEYS);
    const possession = football.possession as Record<string, unknown> | undefined;
    if (possession !== undefined && possession.value !== undefined) {
      checkObject(
        possession.value,
        [...path, "football", "possession", "value"],
        POSSESSION_VALUE_KEYS,
      );
    }
  }
}

/** Checks one world entity. */
function checkEntity(value: unknown, path: readonly string[]): void {
  checkObject(value, path, ENTITY_KEYS);
  const entity = value as Record<string, unknown>;
  checkObject(entity.state, [...path, "state"], ENTITY_STATE_KEYS);
  const state = entity.state as Record<string, unknown>;
  for (const slot of Object.keys(state)) {
    checkObject(state[slot], [...path, "state", slot], UNCERTAIN_VALUE_KEYS);
  }
}

/** Checks one fusion report (first or refusion). */
function checkReport(value: unknown, path: readonly string[]): void {
  checkObject(value, path, REPORT_KEYS);
  const report = value as Record<string, unknown>;
  if (!Array.isArray(report.conflicts)) {
    throw new RangeError(`assertArtifactShape: ${render([...path, "conflicts"])} must be an array`);
  }
  report.conflicts.forEach((conflict, index) => {
    const conflictPath = [...path, "conflicts", `[${index}]`];
    checkObject(conflict, conflictPath, CONFLICT_KEYS);
    const record = conflict as Record<string, unknown>;
    if (!Array.isArray(record.observationIds)) {
      throw new RangeError(
        `assertArtifactShape: ${render([...conflictPath, "observationIds"])} must be an array`,
      );
    }
    if (!Array.isArray(record.values)) {
      throw new RangeError(
        `assertArtifactShape: ${render([...conflictPath, "values"])} must be an array`,
      );
    }
    (record.values as unknown[]).forEach((entry, valueIndex) => {
      checkObject(entry, [...conflictPath, "values", `[${valueIndex}]`], CONFLICT_VALUE_KEYS);
    });
  });
  if (!Array.isArray(report.warnings)) {
    throw new RangeError(`assertArtifactShape: ${render([...path, "warnings"])} must be an array`);
  }
}

/** Checks one event-stream entry. */
function checkEntry(value: unknown, path: readonly string[]): void {
  checkObject(value, path, ENTRY_KEYS);
  const entry = value as Record<string, unknown>;
  const eventPath = [...path, "event"];
  checkObject(entry.event, eventPath, EVENT_KEYS);
  const event = entry.event as Record<string, unknown>;
  checkObject(event.interval, [...eventPath, "interval"], INTERVAL_KEYS);
  checkObject(event.evidence, [...eventPath, "evidence"], EVIDENCE_KEYS);
}

/**
 * Asserts the full structural shape of an artifact (fail loud on unknown or
 * missing keys at any level). `pinnedStateAtMs` are the fixture's pins — the
 * `stateAt` keys must equal them exactly.
 */
export function assertArtifactShape(
  artifact: WorldModelArtifact,
  pinnedStateAtMs: readonly number[],
): void {
  checkObject(artifact, ["$"], {
    required: [
      "artifactSchema",
      "fixtureId",
      "fixtureSha256",
      "fusion",
      "stateAt",
      "eventWindow",
      "replay",
    ],
  });

  checkObject(artifact.fusion, ["$", "fusion"], { required: ["first", "refusion"] });
  checkReport(artifact.fusion.first, ["$", "fusion", "first"]);
  checkReport(artifact.fusion.refusion, ["$", "fusion", "refusion"]);

  const expectedPins = new Set(pinnedStateAtMs.map((t) => String(t)));
  const actualPins = new Set(Object.keys(artifact.stateAt));
  for (const pin of expectedPins) {
    if (!actualPins.has(pin)) {
      throw new RangeError(
        `assertArtifactShape: $.stateAt is missing the pinned timestamp "${pin}"`,
      );
    }
    actualPins.delete(pin);
  }
  if (actualPins.size > 0) {
    const unknown = [...actualPins].sort().join(", ");
    throw new RangeError(
      `assertArtifactShape: $.stateAt carries key(s) [${unknown}] that are not the ` +
        "fixture's pinned timestamps — stateAt keys are fixture data, not free-form",
    );
  }
  for (const pin of pinnedStateMsSorted(pinnedStateAtMs)) {
    checkSnapshot(artifact.stateAt[String(pin)], ["$", "stateAt", String(pin)]);
  }

  checkObject(artifact.eventWindow, ["$", "eventWindow"], {
    required: ["fromMs", "toMs", "entries"],
  });
  if (!Array.isArray(artifact.eventWindow.entries)) {
    throw new RangeError(`assertArtifactShape: $.eventWindow.entries must be an array`);
  }
  artifact.eventWindow.entries.forEach((entry, index) => {
    checkEntry(entry, ["$", "eventWindow", "entries", `[${index}]`]);
  });

  checkObject(artifact.replay, ["$", "replay"], {
    required: [
      "eventsApplied",
      "correctionsApplied",
      "supersededSkipped",
      "correctionsOrphaned",
      "duplicatesSkipped",
      "limits",
      "checkpoints",
      "final",
    ],
  });
  checkObject(artifact.replay.limits, ["$", "replay", "limits"], LIMITS_KEYS);
  if (!Array.isArray(artifact.replay.checkpoints)) {
    throw new RangeError(`assertArtifactShape: $.replay.checkpoints must be an array`);
  }
  artifact.replay.checkpoints.forEach((checkpoint, index) => {
    checkSnapshot(checkpoint, ["$", "replay", "checkpoints", `[${index}]`]);
  });
  checkSnapshot(artifact.replay.final, ["$", "replay", "final"]);
}

/** The pins in ascending order (fail loud if the fixture pins are unsorted). */
function pinnedStateMsSorted(pins: readonly number[]): number[] {
  const sorted = [...pins].sort((a, b) => a - b);
  for (let i = 0; i < pins.length; i += 1) {
    if (pins[i] !== sorted[i]) {
      throw new RangeError(
        "assertArtifactShape: fixture pinnedStateAtMs must be ascending (fixture data error)",
      );
    }
  }
  return sorted;
}
