/**
 * The conformance harness of the scene projection contract (W601) — the
 * W501 `runConformance` precedent applied to scene DOCUMENTS instead of
 * plugin instances.
 *
 * `runSceneConformance(scene, options?)` proves a SceneSpecification honors
 * the contract rules S1–S8 (documented in CONTRACT.md) by checking it
 * exactly the way a consumer would: schema-parse it, version-gate it, and —
 * when the caller supplies the SNAPSHOT (and events / camera-slot
 * selection) the scene claims to come from — re-derive every verbatim block
 * and re-run the projection for the byte-identity proof. Every check is
 * adversarial and stable-id'd; a consumer that cannot supply the snapshot
 * still gets the standalone checks (schema, version, disposition closure,
 * pitch/camera constants, serialization roundtrip) — the W605 evaluation
 * posture.
 *
 * Guarantees (the W501 harness guarantees, restated):
 *
 * - the harness NEVER throws because a scene is broken — every violation
 *   (including throwing during re-projection, garbage input, or a malformed
 *   options snapshot) is recorded as a failed check with structured
 *   evidence in `detail`;
 * - checks have stable ids; a check the available options make
 *   inapplicable is reported as PASSED with a `detail` starting `"n/a …"`
 *   (for example the identity check without a snapshot);
 * - `passed` is true only when every check passed.
 */
import { WorldEventStreamEntry, WorldSnapshot } from "@sporta/contracts";
import { firstDifference, errMessage, isRecord } from "./internal";
import { CANONICAL_CAMERA_SLOTS, CAMERA_SLOT_IDS, CANONICAL_PITCH_FRAME } from "./constants";
import {
  projectScene,
  resolveSceneEntity,
  resolveScoreClock,
  buildPitchFurniture,
} from "./project";
import type { ProjectionOptions } from "./project";
import { SCENE_SCHEMA_VERSION, SceneSpecification, isSceneVersionCompatible } from "./schema";
import type { SceneSpecification as SceneSpecificationType } from "./schema";
import { serializeScene, parseSceneSpecification } from "./serialize";

/** One conformance result: stable id, human description, verdict, evidence. */
export interface SceneConformanceCheck {
  checkId: string;
  description: string;
  passed: boolean;
  detail?: string;
}

/** The full conformance report for one scene run. */
export interface SceneConformanceReport {
  /** Every check, in documented order. */
  checks: SceneConformanceCheck[];
  /** True only when every check passed. */
  passed: boolean;
}

/**
 * Evidence options: what the scene claims to be the projection of. Every
 * field is optional; absent evidence degrades the matching checks to `n/a`
 * (passed) rather than failing them.
 */
export interface SceneConformanceOptions {
  /** The SWM snapshot the scene claims to project (validated fail-soft). */
  snapshot?: WorldSnapshot;
  /** The ordered event tail projected as markers (validated fail-soft). */
  events?: readonly WorldEventStreamEntry[];
  /**
   * The camera-slot selection used for the projection, when a subset was
   * requested (the harness needs it to reproduce the selection).
   */
  cameraSlotIds?: readonly string[];
}

/** One check under construction. */
type Check = SceneConformanceCheck;

/** Wraps a probe so a throwing scene/option never escapes the harness. */
function attempt<T>(fn: () => T): { ok: true; value: T } | { ok: false; error: unknown } {
  try {
    return { ok: true, value: fn() };
  } catch (error) {
    return { ok: false, error };
  }
}

/** A failed check that only exists to carry the schema-invalid detail. */
function schemaInvalid(checkId: string, description: string, detail: string): Check {
  return { checkId, description, passed: false, detail: `scene-schema-invalid: ${detail}` };
}

/**
 * Runs the scene conformance checks (S1–S8) over one scene document.
 * Fail-soft; see the module docblock.
 */
export function runSceneConformance(
  scene: unknown,
  options: SceneConformanceOptions = {},
): SceneConformanceReport {
  const checks: Check[] = [];
  const add = (check: Check) => checks.push(check);

  // --- S2/S8: schema validity (the gate for every typed check below) --------
  const parsed = attempt(() => SceneSpecification.safeParse(scene));
  let valid: SceneSpecificationType | undefined;
  let schemaDetail = "the document parses against the current SceneSpecification schema";
  if (parsed.ok) {
    const result = parsed.value;
    if (result.success) {
      valid = result.data;
    } else {
      const issues = result.error.issues;
      const shown = issues
        .slice(0, 5)
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ");
      schemaDetail = `validation failed (${shown}${issues.length > 5 ? `; +${issues.length - 5} more` : ""})`;
    }
  } else {
    schemaDetail = `validation threw (${errMessage(parsed.error)})`;
  }
  add({
    checkId: "scene-schema-valid",
    description: "S2/S8: the document parses against the SceneSpecification schema",
    passed: valid !== undefined,
    detail: valid !== undefined ? schemaDetail : `scene-schema-invalid: ${schemaDetail}`,
  });

  // --- S8: version compatibility ---------------------------------------------
  const versionOnScene = isRecord(scene) ? scene.sceneSchemaVersion : undefined;
  if (typeof versionOnScene === "string" || valid !== undefined) {
    const declared =
      typeof versionOnScene === "string" ? versionOnScene : valid?.sceneSchemaVersion;
    const compatible = declared !== undefined && isSceneVersionCompatible(declared);
    add({
      checkId: "scene-version-compatible",
      description: "S8: sceneSchemaVersion is consumable by this schema version",
      passed: compatible,
      detail: compatible
        ? `sceneSchemaVersion "${declared}" is compatible with scene schema version "${SCENE_SCHEMA_VERSION}"`
        : `sceneSchemaVersion "${String(declared)}" is not consumable by scene schema version ` +
          `"${SCENE_SCHEMA_VERSION}" (same MAJOR, MINOR <= current required)`,
    });
  } else {
    add(
      schemaInvalid(
        "scene-version-compatible",
        "S8: sceneSchemaVersion is consumable by this schema version",
        "no sceneSchemaVersion to check",
      ),
    );
  }

  // --- The caller-supplied evidence (validated once, fail-soft) ---------------
  const snapshotCheck = attempt(() => WorldSnapshot.safeParse(options.snapshot));
  let snapshot: WorldSnapshot | undefined;
  let snapshotProblem: string | undefined;
  if (options.snapshot !== undefined && snapshotCheck.ok) {
    const result = snapshotCheck.value;
    if (result.success) {
      snapshot = result.data;
    } else {
      snapshotProblem = `options.snapshot is not a valid WorldSnapshot (${
        result.error.issues[0]?.message ?? "validation failed"
      })`;
    }
  } else if (!snapshotCheck.ok && options.snapshot !== undefined) {
    snapshotProblem = `options.snapshot validation threw (${errMessage(snapshotCheck.error)})`;
  }
  const eventsValid = attempt(() => {
    if (options.events === undefined) return true;
    if (!Array.isArray(options.events)) return false;
    return options.events.every((entry) => WorldEventStreamEntry.safeParse(entry).success);
  });
  const eventsOk = eventsValid.ok && eventsValid.value === true;

  // --- S1: source provenance --------------------------------------------------
  if (valid === undefined) {
    add(
      schemaInvalid(
        "source-provenance-complete",
        "S1: source provenance (session, version, watermark, counts) is verbatim",
        schemaDetail,
      ),
    );
  } else if (snapshot !== undefined) {
    const expected = {
      schemaVersion: snapshot.schemaVersion,
      watermark: snapshot.watermark,
      generatedAtMs: snapshot.generatedAtMs,
      footballState: snapshot.football !== undefined,
      entityCount: snapshot.entities.length,
    };
    const sessionIdOk = isRecord(scene) && scene.sessionId === snapshot.sessionId;
    const diff = firstDifference(expected, valid.source, "$.source");
    add({
      checkId: "source-provenance-complete",
      description: "S1: source provenance (session, version, watermark, counts) is verbatim",
      passed: diff === undefined && sessionIdOk,
      detail:
        diff !== undefined
          ? `source provenance differs from the snapshot: ${diff}`
          : sessionIdOk
            ? "source provenance matches the snapshot verbatim"
            : `sessionId mismatch: scene "${String(isRecord(scene) ? scene.sessionId : scene)}" vs snapshot "${snapshot.sessionId}"`,
    });
  } else if (snapshotProblem !== undefined) {
    add({
      checkId: "source-provenance-complete",
      description: "S1: source provenance (session, version, watermark, counts) is verbatim",
      passed: false,
      detail: snapshotProblem,
    });
  } else {
    add({
      checkId: "source-provenance-complete",
      description: "S1: source provenance (session, version, watermark, counts) is verbatim",
      passed: true,
      detail: "n/a — no options.snapshot provided; only structural presence was checked (schema)",
    });
  }

  // --- S1: identity stability and totality ------------------------------------
  if (options.snapshot === undefined) {
    add({
      checkId: "identity-stable-and-total",
      description: "S1: entity ids/kinds/versions/lastEventTimeMs are verbatim, ordered, and total",
      passed: true,
      detail: "n/a — no options.snapshot provided; identity cannot be cross-checked",
    });
  } else if (valid === undefined) {
    add(
      schemaInvalid(
        "identity-stable-and-total",
        "S1: entity ids/kinds/versions/lastEventTimeMs are verbatim, ordered, and total",
        schemaDetail,
      ),
    );
  } else if (snapshot === undefined) {
    // A PROVIDED-but-invalid snapshot fails the check (never n/a): the caller
    // claimed evidence that does not parse — that is a caller defect.
    add({
      checkId: "identity-stable-and-total",
      description: "S1: entity ids/kinds/versions/lastEventTimeMs are verbatim, ordered, and total",
      passed: false,
      detail: snapshotProblem ?? "options.snapshot could not be validated",
    });
  } else {
    const snapshotEntities = snapshot.entities;
    let detail = "every snapshot entity appears exactly once, in order, with verbatim identity";
    let passed = valid.entities.length === snapshotEntities.length;
    if (!passed) {
      detail = `entity count differs: scene has ${valid.entities.length}, snapshot has ${snapshotEntities.length}`;
    } else {
      for (let i = 0; i < snapshotEntities.length; i += 1) {
        const expected = snapshotEntities[i]!;
        const actual = valid.entities[i]!;
        if (
          actual.entityId !== expected.entityId ||
          actual.kind !== expected.kind ||
          actual.version !== expected.version ||
          actual.lastEventTimeMs !== expected.lastEventTimeMs
        ) {
          passed = false;
          detail =
            `entities[${i}] identity differs: scene (entityId=${actual.entityId}, kind=${actual.kind}, ` +
            `version=${actual.version}, lastEventTimeMs=${actual.lastEventTimeMs}) vs snapshot ` +
            `(entityId=${expected.entityId}, kind=${expected.kind}, version=${expected.version}, ` +
            `lastEventTimeMs=${expected.lastEventTimeMs})`;
          break;
        }
      }
    }
    add({
      checkId: "identity-stable-and-total",
      description: "S1: entity ids/kinds/versions/lastEventTimeMs are verbatim, ordered, and total",
      passed,
      detail,
    });
  }

  // --- S3/S4: disposition accounting closure -----------------------------------
  if (valid === undefined) {
    add(
      schemaInvalid(
        "disposition-accounting-closed",
        "S3/S4: entity dispositions are closed and consistent",
        schemaDetail,
      ),
    );
  } else {
    const PROJECTED = new Set(["projected", "projected-out-of-bounds"]);
    const PLANE = new Set(["participant", "official"]);
    let detail =
      "every entity disposition is consistent with its carried fields and the pitch bounds";
    let passed = valid.source.entityCount === valid.entities.length;
    if (!passed) {
      detail = `source.entityCount (${valid.source.entityCount}) differs from entities.length (${valid.entities.length})`;
    } else {
      for (let i = 0; i < valid.entities.length; i += 1) {
        const entity = valid.entities[i]!;
        const hasPosition = entity.position !== undefined;
        if (hasPosition !== PROJECTED.has(entity.disposition)) {
          passed = false;
          detail =
            `entities[${i}] (${entity.entityId}): disposition "${entity.disposition}" carries a ` +
            `position ${hasPosition ? "but is not a projected disposition" : "only for projected dispositions — none present"}`;
          break;
        }
        if (hasPosition) {
          const position = entity.position!;
          const inBounds =
            position.x >= 0 && position.x <= 105 && position.y >= 0 && position.y <= 68;
          if (entity.disposition === "projected" && !inBounds) {
            passed = false;
            detail =
              `entities[${i}] (${entity.entityId}): disposition "projected" but position ` +
              `(${position.x}, ${position.y}) is outside the inclusive pitch bounds`;
            break;
          }
          if (entity.disposition === "projected-out-of-bounds" && inBounds) {
            passed = false;
            detail =
              `entities[${i}] (${entity.entityId}): disposition "projected-out-of-bounds" but position ` +
              `(${position.x}, ${position.y}) is INSIDE the pitch bounds (never clamp — never mis-flag)`;
            break;
          }
          if (entity.kind === "ball") {
            if (entity.height?.meters === undefined && position.z !== undefined) {
              passed = false;
              detail =
                `entities[${i}] (${entity.entityId}): ball carries z=${position.z} without a carried ` +
                `height value — z must be ABSENT when the SWM carries no height (never a faked 0)`;
              break;
            }
            if (entity.height?.meters !== undefined && position.z !== entity.height.meters) {
              passed = false;
              detail =
                `entities[${i}] (${entity.entityId}): ball z (${position.z}) differs from its carried ` +
                `height meters (${entity.height.meters})`;
              break;
            }
          } else if (PLANE.has(entity.kind) && position.z !== 0) {
            passed = false;
            detail =
              `entities[${i}] (${entity.entityId}): kind "${entity.kind}" must sit on the pitch plane ` +
              `(z = 0), got z=${position.z}`;
            break;
          }
        }
        if (
          entity.disposition === "not-projected-kind" &&
          (entity.positionSlotKey !== undefined ||
            entity.positionStatus !== undefined ||
            entity.positionConfidence !== undefined ||
            entity.height !== undefined ||
            entity.heading !== undefined ||
            entity.invalidSlotKeys !== undefined)
        ) {
          passed = false;
          detail =
            `entities[${i}] (${entity.entityId}): disposition "not-projected-kind" carries projected ` +
            `slot fields (position/height/heading) — not-projected entities carry accounting only`;
          break;
        }
      }
    }
    add({
      checkId: "disposition-accounting-closed",
      description: "S3/S4: entity dispositions are closed and consistent",
      passed,
      detail,
    });
  }

  // --- S2/S4: pitch geometry canonical -----------------------------------------
  if (valid === undefined) {
    add(
      schemaInvalid(
        "pitch-geometry-canonical",
        "S2/S4: pitch geometry is the canonical frame + IFAB Law 1 constants",
        schemaDetail,
      ),
    );
  } else {
    const expectedFrame =
      snapshot?.football !== undefined ? snapshot.football.pitch : CANONICAL_PITCH_FRAME;
    let diff = firstDifference(expectedFrame, valid.world.pitch.frame, "$.world.pitch.frame");
    if (diff === undefined) {
      diff = firstDifference(
        buildPitchFurniture(),
        valid.world.pitch.furniture,
        "$.world.pitch.furniture",
      );
    }
    if (diff === undefined && snapshot !== undefined) {
      const expectedSource =
        snapshot.football !== undefined ? "snapshot-football" : "contracts-constant";
      if (valid.world.pitch.frameSource !== expectedSource) {
        diff = `$.world.pitch.frameSource: expected "${expectedSource}", got "${valid.world.pitch.frameSource}"`;
      }
    }
    add({
      checkId: "pitch-geometry-canonical",
      description: "S2/S4: pitch geometry is the canonical frame + IFAB Law 1 constants",
      passed: diff === undefined,
      detail:
        diff === undefined
          ? "pitch frame and furniture match the canonical constants (frameSource consistent with the snapshot)"
          : `pitch geometry differs from the canonical constants: ${diff}`,
    });
  }

  // --- S2: camera slots canonical -----------------------------------------------
  if (valid === undefined) {
    add(
      schemaInvalid(
        "camera-slots-canonical",
        "S2: camera slots are the canonical named slots",
        schemaDetail,
      ),
    );
  } else if (options.cameraSlotIds === undefined) {
    // No selection evidence: a partial camera-slot list is a LEGITIMATE
    // projection output (`options.cameraSlotIds` at projection time), so the
    // check verifies canonical SUBSET consistency — every present slot must be
    // deep-equal to its canonical constant and the list must be a canonical-
    // order subsequence of the constant set (reorderings and duplicates fail).
    // The exact SET cannot be verified without the selection option: a dropped
    // slot is indistinguishable from a selection (the honest limitation this
    // detail names; the determinism check reports n/a for the same reason).
    let detail =
      `camera slots are a canonical subset (${valid.cameraSlots.length} of ` +
      `${CANONICAL_CAMERA_SLOTS.length}; exact-set verification needs options.cameraSlotIds)`;
    let passed = true;
    let cursor = 0;
    for (let i = 0; i < valid.cameraSlots.length; i += 1) {
      const slot = valid.cameraSlots[i]!;
      let matchIndex = -1;
      for (let j = cursor; j < CANONICAL_CAMERA_SLOTS.length; j += 1) {
        if (CANONICAL_CAMERA_SLOTS[j]!.slotId === slot.slotId) {
          matchIndex = j;
          break;
        }
      }
      if (matchIndex === -1) {
        passed = false;
        detail =
          `cameraSlots[${i}] ("${slot.slotId}"): no canonical slot with this id at or after canonical ` +
          `position ${cursor} — the list must be a canonical-order subsequence of the constant set ` +
          "(a duplicate, a reordered subset, or an off-set slot id)";
        break;
      }
      const diff = firstDifference(
        CANONICAL_CAMERA_SLOTS[matchIndex]!,
        slot,
        `$.cameraSlots[${i}]`,
      );
      if (diff !== undefined) {
        passed = false;
        detail = `cameraSlots[${i}] ("${slot.slotId}") differs from the canonical constant: ${diff}`;
        break;
      }
      cursor = matchIndex + 1;
    }
    add({
      checkId: "camera-slots-canonical",
      description: "S2: camera slots are the canonical named slots",
      passed,
      detail,
    });
  } else {
    const selection = CANONICAL_CAMERA_SLOTS.filter((slot) =>
      options.cameraSlotIds!.includes(slot.slotId),
    );
    let detail = "camera slots match the canonical set (geometry, derivation, canonical order)";
    let passed = valid.cameraSlots.length === selection.length;
    if (!passed) {
      detail =
        `camera slot count differs: scene has ${valid.cameraSlots.length}, expected ${selection.length} ` +
        `(selection: ${options.cameraSlotIds.join(", ")})`;
    } else {
      for (let i = 0; i < valid.cameraSlots.length; i += 1) {
        const slot = valid.cameraSlots[i]!;
        const expectedSlot = selection[i]!;
        if (slot.slotId !== expectedSlot.slotId) {
          passed = false;
          detail =
            `cameraSlots[${i}]: expected canonical order position "${expectedSlot.slotId}", got ` +
            `"${slot.slotId}" (a selection is emitted in canonical order)`;
          break;
        }
        const diff = firstDifference(expectedSlot, slot, `$.cameraSlots[${i}]`);
        if (diff !== undefined) {
          passed = false;
          detail = `cameraSlots[${i}] ("${slot.slotId}") differs from the canonical constant: ${diff}`;
          break;
        }
      }
    }
    add({
      checkId: "camera-slots-canonical",
      description: "S2: camera slots are the canonical named slots",
      passed,
      detail,
    });
  }

  // --- S6: score/clock display state verbatim -------------------------------------
  if (options.snapshot === undefined) {
    add({
      checkId: "score-clock-verbatim",
      description: "S6: score/clock/possession display state is verbatim",
      passed: true,
      detail: "n/a — no options.snapshot provided; the display state cannot be cross-checked",
    });
  } else if (valid === undefined) {
    add(
      schemaInvalid(
        "score-clock-verbatim",
        "S6: score/clock/possession display state is verbatim",
        schemaDetail,
      ),
    );
  } else if (snapshot === undefined) {
    // A provided-but-invalid snapshot fails the check (never n/a).
    add({
      checkId: "score-clock-verbatim",
      description: "S6: score/clock/possession display state is verbatim",
      passed: false,
      detail: snapshotProblem ?? "options.snapshot could not be validated",
    });
  } else {
    const diff = firstDifference(resolveScoreClock(snapshot), valid.scoreClock, "$.scoreClock");
    add({
      checkId: "score-clock-verbatim",
      description: "S6: score/clock/possession display state is verbatim",
      passed: diff === undefined,
      detail:
        diff === undefined
          ? "the display state is the snapshot's football extension, verbatim"
          : `scoreClock differs from the snapshot's football extension: ${diff}`,
    });
  }

  // --- S2/S6: entity slots verbatim -------------------------------------------------
  if (options.snapshot === undefined) {
    add({
      checkId: "entity-slots-verbatim",
      description: "S2/S6: entity positions/statuses/confidences/heights/headings are verbatim",
      passed: true,
      detail: "n/a — no options.snapshot provided; entity slots cannot be cross-checked",
    });
  } else if (valid === undefined) {
    add(
      schemaInvalid(
        "entity-slots-verbatim",
        "S2/S6: entity positions/statuses/confidences/heights/headings are verbatim",
        schemaDetail,
      ),
    );
  } else if (snapshot === undefined) {
    // A provided-but-invalid snapshot fails the check (never n/a).
    add({
      checkId: "entity-slots-verbatim",
      description: "S2/S6: entity positions/statuses/confidences/heights/headings are verbatim",
      passed: false,
      detail: snapshotProblem ?? "options.snapshot could not be validated",
    });
  } else {
    const snapshotEntities = snapshot.entities;
    let detail = "every entity entry is the verbatim slot projection of its snapshot entity";
    let passed = valid.entities.length === snapshotEntities.length;
    if (!passed) {
      detail = `entity count differs: scene has ${valid.entities.length}, snapshot has ${snapshotEntities.length}`;
    } else {
      for (let i = 0; i < snapshotEntities.length; i += 1) {
        const expectedEntry = resolveSceneEntity(snapshotEntities[i]!);
        const diff = firstDifference(expectedEntry, valid.entities[i]!, `$.entities[${i}]`);
        if (diff !== undefined) {
          passed = false;
          detail = `entities[${i}] (${snapshotEntities[i]!.entityId}) differs from the verbatim slot projection: ${diff}`;
          break;
        }
      }
    }
    add({
      checkId: "entity-slots-verbatim",
      description: "S2/S6: entity positions/statuses/confidences/heights/headings are verbatim",
      passed,
      detail,
    });
  }

  // --- S7: event markers verbatim ---------------------------------------------------
  if (valid === undefined) {
    add(
      schemaInvalid(
        "event-markers-verbatim",
        "S7: event markers are the verbatim event tail, timeline-anchored",
        schemaDetail,
      ),
    );
  } else if (!eventsOk) {
    add({
      checkId: "event-markers-verbatim",
      description: "S7: event markers are the verbatim event tail, timeline-anchored",
      passed: false,
      detail: eventsValid.ok
        ? "options.events is not an array of valid WorldEventStreamEntry entries"
        : `options.events validation threw (${errMessage(eventsValid.error)})`,
    });
  } else if (options.events === undefined) {
    if (valid.eventMarkers.length === 0) {
      add({
        checkId: "event-markers-verbatim",
        description: "S7: event markers are the verbatim event tail, timeline-anchored",
        passed: true,
        detail: "no event markers present and no options.events provided — nothing to verify",
      });
    } else {
      add({
        checkId: "event-markers-verbatim",
        description: "S7: event markers are the verbatim event tail, timeline-anchored",
        passed: true,
        detail:
          "n/a — the scene carries event markers but no options.events was provided; pass the projected " +
          "event tail to verify them",
      });
    }
  } else {
    const expected = options.events.map((entry) => ({
      sequence: entry.sequence,
      snapshotVersionAfter: entry.snapshotVersionAfter,
      event: entry.event,
      anchoring: "timeline" as const,
    }));
    const diff = firstDifference(expected, valid.eventMarkers, "$.eventMarkers");
    add({
      checkId: "event-markers-verbatim",
      description: "S7: event markers are the verbatim event tail, timeline-anchored",
      passed: diff === undefined,
      detail:
        diff === undefined
          ? `event markers match the ${expected.length} input entries verbatim, in order, timeline-anchored`
          : `eventMarkers differ from the input event tail: ${diff}`,
    });
  }

  // --- S5: determinism (re-projection byte identity) ---------------------------------
  const sceneCameraIds = valid?.cameraSlots.map((slot) => slot.slotId);
  const partialSelection =
    options.cameraSlotIds === undefined &&
    sceneCameraIds !== undefined &&
    (sceneCameraIds.length !== CAMERA_SLOT_IDS.length ||
      sceneCameraIds.some((id, i) => id !== CAMERA_SLOT_IDS[i]));
  const markersUnverifiable = options.events === undefined && (valid?.eventMarkers.length ?? 0) > 0;
  // Branch order (test-pinned): caller-garbage FAILS first (malformed events,
  // a provided-but-invalid snapshot — fail beats every n/a), then the SPECIFIC
  // n/a reasons (a partial selection / unverifiable markers explain themselves
  // better than the generic note), then the generic no-snapshot n/a — which
  // also narrows `snapshot` for the re-projection branch (a provided-but-
  // invalid snapshot already failed above, so `undefined` here means absent).
  if (valid === undefined) {
    add(
      schemaInvalid(
        "determinism-byte-identical",
        "S5: re-projecting the snapshot reproduces the scene byte-identically",
        schemaDetail,
      ),
    );
  } else if (!eventsOk) {
    add({
      checkId: "determinism-byte-identical",
      description: "S5: re-projecting the snapshot reproduces the scene byte-identically",
      passed: false,
      detail: "options.events is invalid — the re-projection cannot run",
    });
  } else if (snapshotProblem !== undefined) {
    // A provided-but-invalid snapshot fails the check (never n/a).
    add({
      checkId: "determinism-byte-identical",
      description: "S5: re-projecting the snapshot reproduces the scene byte-identically",
      passed: false,
      detail: snapshotProblem,
    });
  } else if (partialSelection) {
    add({
      checkId: "determinism-byte-identical",
      description: "S5: re-projecting the snapshot reproduces the scene byte-identically",
      passed: true,
      detail:
        "n/a — the scene carries a partial camera-slot selection but no options.cameraSlotIds was " +
        "provided; the re-projection would emit every canonical slot",
    });
  } else if (markersUnverifiable) {
    add({
      checkId: "determinism-byte-identical",
      description: "S5: re-projecting the snapshot reproduces the scene byte-identically",
      passed: true,
      detail:
        "n/a — the scene carries event markers but no options.events was provided; the re-projection " +
        "cannot reproduce them",
    });
  } else if (snapshot === undefined) {
    add({
      checkId: "determinism-byte-identical",
      description: "S5: re-projecting the snapshot reproduces the scene byte-identically",
      passed: true,
      detail: "n/a — no options.snapshot provided; determinism cannot be re-proven",
    });
  } else {
    const reprojection = attempt(() =>
      projectScene(snapshot, {
        events: options.events,
        cameraSlotIds: options.cameraSlotIds,
      } satisfies ProjectionOptions),
    );
    if (!reprojection.ok) {
      add({
        checkId: "determinism-byte-identical",
        description: "S5: re-projecting the snapshot reproduces the scene byte-identically",
        passed: false,
        detail: `the re-projection threw (${errMessage(reprojection.error)})`,
      });
    } else {
      const diff = firstDifference(reprojection.value, scene, "$");
      let byteProblem: string | undefined;
      if (diff === undefined && valid !== undefined) {
        const sceneBytes = attempt(() => serializeScene(valid));
        const reprojectedBytes = attempt(() => serializeScene(reprojection.value));
        if (sceneBytes.ok && reprojectedBytes.ok) {
          if (sceneBytes.value !== reprojectedBytes.value) {
            byteProblem =
              "deep-equal but canonical serializations differ — key order or undefined leakage";
          }
        } else if (!sceneBytes.ok) {
          byteProblem = `serialization threw (${errMessage(sceneBytes.error)})`;
        } else if (!reprojectedBytes.ok) {
          byteProblem = `serialization threw (${errMessage(reprojectedBytes.error)})`;
        }
      }
      add({
        checkId: "determinism-byte-identical",
        description: "S5: re-projecting the snapshot reproduces the scene byte-identically",
        passed: diff === undefined && byteProblem === undefined,
        detail:
          diff !== undefined
            ? `the re-projection differs from the scene: ${diff}`
            : byteProblem !== undefined
              ? byteProblem
              : "re-projection is deep-equal and byte-identical under canonical serialization",
      });
    }
  }

  // --- S5: serialization roundtrip ------------------------------------------------------
  const roundtrip = attempt(() => parseSceneSpecification(serializeScene(scene as never)));
  if (!roundtrip.ok) {
    add({
      checkId: "serialization-roundtrip",
      description: "S5: serialize → parse reproduces the scene (canonical form is total)",
      passed: false,
      detail: `serialization roundtrip threw (${errMessage(roundtrip.error)})`,
    });
  } else {
    const diff = firstDifference(scene, roundtrip.value, "$");
    add({
      checkId: "serialization-roundtrip",
      description: "S5: serialize → parse reproduces the scene (canonical form is total)",
      passed: diff === undefined,
      detail:
        diff === undefined
          ? "serialize → parse reproduces the scene deep-equal (no unknown keys, no undefined leakage)"
          : `the roundtrip changed the scene: ${diff} (unknown keys are stripped and explicit ` +
            "undefined values dropped by the canonical form — the scene is not in canonical form)",
    });
  }

  return { checks, passed: checks.every((check) => check.passed) };
}
