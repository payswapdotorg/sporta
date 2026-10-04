/**
 * Fail-closed structural validation of a camera intent document
 * (`./intent.ts` {@link CameraIntentDocument}). An intent document is
 * DATA — it can arrive from a wire, a config file, or the emission itself
 * — and is admitted only if it satisfies every documented rule below (the
 * `./validate.ts` policy convention: structural validation, UNKNOWN KEYS
 * IGNORED — forward-compatible documents — and every value rule
 * test-pinned in `test/intent.test.ts`).
 *
 * Rules (each fail-closed, each test-pinned):
 *
 * - top level: a record; `intentVersion`/`poseVocabulary`/`directorVersion`
 *   non-empty strings; `policy` a record with non-empty `policyId`/
 *   `policyVersion`; `timeline` a record with finite `startMs`/`endMs`,
 *   `endMs >= startMs`; `pitchGeometry` finite positive `lengthXMeters`/
 *   `widthYMeters` and a boolean `zUp`; `slotGeometry` a non-empty
 *   `constantsVersion` + a non-empty `slots` array of records with a
 *   non-empty `slotId` and finite `eye`/`look` vectors; `emission` a
 *   record with `intentKind === "slot-hold"`, finite `frameRate > 0`,
 *   finite `frameIntervalMs > 0`, integer `poseQuantizationDecimals >= 0`,
 *   non-empty `determinism`/`sourceTimeConvention`; `windows` a non-empty
 *   array; `summary` a record with integer counts `>= 0`, a
 *   `suppressedCuts` array, and an `eventAccounting` array;
 * - windows: records in gap-free rundown order (`index === i`), `kind`
 *   `"live"` or `"review"`, finite `source` with `endMs >= startMs`,
 *   non-empty `cameraSlotId`, `provenance` a record with a closed-vocabulary
 *   `ruleId`, non-empty `slotGeometryVersion`, and a `decision` record
 *   (non-empty `ruleId` + `reason`; event-driven decisions carry the
 *   verbatim candidate fields; possession decisions carry the follow
 *   inputs), `path` a record with `intentKind === "slot-hold"`,
 *   non-empty `anchorSlotId`, integer `frameCount > 0` equal to the pose
 *   count, finite `frameIntervalMs > 0`/`fps > 0`, and a non-empty
 *   `poses` array;
 * - poses: records in gap-free order (`frameIndex === j`) carrying the
 *   six vocabulary fields — finite `tMs >= 0`, finite `eye`/`look`
 *   vectors, finite `focalMultiplier > 0`, integer `sourceFrame >= 0`.
 *
 * On success the validated document is returned as a fresh, structurally
 * cloned value (unknown keys are ignored, never interpreted); on refusal
 * the issues carry the JSON path of every violated rule.
 */
import { isFiniteNumber, isRecord, readNonEmptyString, cloneJson } from "./internal";
import type { CameraPlanSummary } from "./types";
import type { CameraIntentDocument, IntentVec3 } from "./intent";
import { INTENT_KIND_SLOT_HOLD } from "./intent";
import type { CameraIntentPose, CameraIntentWindow, CameraIntentWindowProvenance } from "./intent";

/** The result of {@link validateIntentDocument}: admitted, or refused. */
export type IntentValidation =
  { ok: true; value: CameraIntentDocument } | { ok: false; issues: string[] };

/** The presentation-kind vocabulary. */
const PRESENTATION_KINDS = ["live", "review"] as const;

/** The closed rule vocabulary of the director. */
const RULE_IDS = ["possession-follow", "event-focus", "replay-emphasis"] as const;

function pushIssue(issues: string[], path: string, message: string): void {
  issues.push(`${path}: ${message}`);
}

/** A finite 3-vector at `path` (issues recorded, `undefined` on refusal). */
function readVec3(value: unknown, path: string, issues: string[]): IntentVec3 | undefined {
  if (!isRecord(value)) {
    pushIssue(issues, path, "must be an object");
    return undefined;
  }
  for (const axis of ["x", "y", "z"] as const) {
    if (!isFiniteNumber(value[axis])) {
      pushIssue(issues, `${path}.${axis}`, "must be a finite number");
      return undefined;
    }
  }
  return { x: value.x as number, y: value.y as number, z: value.z as number };
}

/** A window's decision record at `path` (shape-checked, cloned on success). */
function readDecision(
  value: unknown,
  path: string,
  issues: string[],
): CameraIntentWindowProvenance["decision"] | undefined {
  if (!isRecord(value)) {
    pushIssue(issues, path, "must be an object");
    return undefined;
  }
  const ruleId = readNonEmptyString(value.ruleId);
  if (ruleId === undefined) {
    pushIssue(issues, `${path}.ruleId`, "must be a non-empty string");
    return undefined;
  }
  const reason = readNonEmptyString(value.reason);
  if (reason === undefined) {
    pushIssue(issues, `${path}.reason`, "must be a non-empty string (fixed-template)");
    return undefined;
  }
  const eventDriven = ruleId === "event-focus" || ruleId === "replay-emphasis";
  let carried = true;
  if (eventDriven) {
    const event = value.event;
    if (!isRecord(event)) {
      pushIssue(issues, `${path}.event`, "event-driven rules must carry the verbatim candidate");
      carried = false;
    } else {
      for (const name of ["candidateId", "eventType"] as const) {
        if (readNonEmptyString(event[name]) === undefined) {
          pushIssue(issues, `${path}.event.${name}`, "must be a non-empty string");
          carried = false;
        }
      }
      for (const name of ["eventTimeMs", "confidence", "emphasis"] as const) {
        if (!isFiniteNumber(event[name]) || (event[name] as number) < 0) {
          pushIssue(issues, `${path}.event.${name}`, "must be a finite number >= 0 (verbatim)");
          carried = false;
        }
      }
    }
  } else if (ruleId === "possession-follow" && !isRecord(value.possession)) {
    pushIssue(
      issues,
      `${path}.possession`,
      "possession-follow decisions must carry the follow inputs",
    );
    carried = false;
  }
  if (!carried) return undefined;
  // The decision rides verbatim (a structural clone; unknown keys ignored).
  return cloneJson(value) as unknown as CameraIntentWindowProvenance["decision"];
}

/** One pose at `path` (vocabulary fields only, cloned on success). */
function readPose(
  value: unknown,
  path: string,
  index: number,
  issues: string[],
): CameraIntentPose | undefined {
  if (!isRecord(value)) {
    pushIssue(issues, path, "must be an object");
    return undefined;
  }
  if (value.frameIndex !== index) {
    pushIssue(issues, `${path}.frameIndex`, `must be ${index} (gap-free path order)`);
    return undefined;
  }
  if (!isFiniteNumber(value.tMs) || value.tMs < 0) {
    pushIssue(issues, `${path}.tMs`, "must be a finite number >= 0");
    return undefined;
  }
  const eye = readVec3(value.eye, `${path}.eye`, issues);
  const look = readVec3(value.look, `${path}.look`, issues);
  if (eye === undefined || look === undefined) return undefined;
  if (!isFiniteNumber(value.focalMultiplier) || value.focalMultiplier <= 0) {
    pushIssue(issues, `${path}.focalMultiplier`, "must be a finite number > 0");
    return undefined;
  }
  if (
    typeof value.sourceFrame !== "number" ||
    !Number.isInteger(value.sourceFrame) ||
    value.sourceFrame < 0
  ) {
    pushIssue(issues, `${path}.sourceFrame`, "must be an integer >= 0 (a step index)");
    return undefined;
  }
  return {
    frameIndex: index,
    tMs: value.tMs,
    eye,
    look,
    focalMultiplier: value.focalMultiplier,
    sourceFrame: value.sourceFrame,
  };
}

/** One window at `path` (cloned with the known fields on success). */
function readWindow(
  value: unknown,
  path: string,
  index: number,
  issues: string[],
): CameraIntentWindow | undefined {
  if (!isRecord(value)) {
    pushIssue(issues, path, "must be an object");
    return undefined;
  }
  if (value.index !== index) {
    pushIssue(issues, `${path}.index`, `must be ${index} (gap-free rundown order)`);
    return undefined;
  }
  if (
    typeof value.kind !== "string" ||
    !(PRESENTATION_KINDS as readonly string[]).includes(value.kind)
  ) {
    pushIssue(issues, `${path}.kind`, `must be "live" or "review" (got ${String(value.kind)})`);
    return undefined;
  }
  const source = value.source;
  if (!isRecord(source) || !isFiniteNumber(source.startMs) || !isFiniteNumber(source.endMs)) {
    pushIssue(issues, `${path}.source`, "must carry finite startMs/endMs");
    return undefined;
  }
  if (source.endMs < source.startMs) {
    pushIssue(
      issues,
      `${path}.source`,
      `endMs ${source.endMs} must be >= startMs ${source.startMs}`,
    );
    return undefined;
  }
  const cameraSlotId = readNonEmptyString(value.cameraSlotId);
  if (cameraSlotId === undefined) {
    pushIssue(issues, `${path}.cameraSlotId`, "must be a non-empty string (a canonical slot id)");
    return undefined;
  }
  const provenance = value.provenance;
  if (!isRecord(provenance)) {
    pushIssue(issues, `${path}.provenance`, "must be an object (rule + slot geometry + decision)");
    return undefined;
  }
  const ruleId = readNonEmptyString(provenance.ruleId);
  if (ruleId === undefined || !(RULE_IDS as readonly string[]).includes(ruleId)) {
    pushIssue(issues, `${path}.provenance.ruleId`, `must be one of (${RULE_IDS.join(", ")})`);
    return undefined;
  }
  const slotGeometryVersion = readNonEmptyString(provenance.slotGeometryVersion);
  if (slotGeometryVersion === undefined) {
    pushIssue(issues, `${path}.provenance.slotGeometryVersion`, "must be a non-empty string");
    return undefined;
  }
  const decision = readDecision(provenance.decision, `${path}.provenance.decision`, issues);
  if (decision === undefined) return undefined;
  const pathBlock = value.path;
  if (!isRecord(pathBlock)) {
    pushIssue(issues, `${path}.path`, "must be an object (the resolved camera path)");
    return undefined;
  }
  if (pathBlock.intentKind !== INTENT_KIND_SLOT_HOLD) {
    pushIssue(issues, `${path}.path.intentKind`, `must be "${INTENT_KIND_SLOT_HOLD}"`);
    return undefined;
  }
  const anchorSlotId = readNonEmptyString(pathBlock.anchorSlotId);
  if (anchorSlotId === undefined) {
    pushIssue(issues, `${path}.path.anchorSlotId`, "must be a non-empty string");
    return undefined;
  }
  if (
    typeof pathBlock.frameCount !== "number" ||
    !Number.isInteger(pathBlock.frameCount) ||
    pathBlock.frameCount <= 0
  ) {
    pushIssue(issues, `${path}.path.frameCount`, "must be an integer > 0");
    return undefined;
  }
  if (!isFiniteNumber(pathBlock.frameIntervalMs) || pathBlock.frameIntervalMs <= 0) {
    pushIssue(issues, `${path}.path.frameIntervalMs`, "must be a finite number > 0");
    return undefined;
  }
  if (!isFiniteNumber(pathBlock.fps) || pathBlock.fps <= 0) {
    pushIssue(issues, `${path}.path.fps`, "must be a finite number > 0");
    return undefined;
  }
  const poses = pathBlock.poses;
  if (!Array.isArray(poses) || poses.length === 0) {
    pushIssue(issues, `${path}.path.poses`, "must be a non-empty array");
    return undefined;
  }
  if (poses.length !== pathBlock.frameCount) {
    pushIssue(issues, `${path}.path.frameCount`, `must equal the pose count (${poses.length})`);
    return undefined;
  }
  const readPoses: CameraIntentPose[] = [];
  for (let j = 0; j < poses.length; j += 1) {
    const pose = readPose(poses[j], `${path}.path.poses[${j}]`, j, issues);
    if (pose === undefined) return undefined;
    readPoses.push(pose);
  }
  return {
    index,
    kind: value.kind as CameraIntentWindow["kind"],
    source: { startMs: source.startMs, endMs: source.endMs },
    cameraSlotId,
    provenance: {
      ruleId: ruleId as CameraIntentWindowProvenance["ruleId"],
      slotGeometryVersion,
      decision,
    },
    path: {
      intentKind: INTENT_KIND_SLOT_HOLD,
      anchorSlotId,
      frameCount: pathBlock.frameCount,
      frameIntervalMs: pathBlock.frameIntervalMs,
      fps: pathBlock.fps,
      poses: readPoses,
    },
  };
}

/**
 * Validates a camera intent document (fail-closed, unknown keys ignored at
 * every level). Pure: the same input → the same issues.
 */
export function validateIntentDocument(value: unknown): IntentValidation {
  const issues: string[] = [];
  if (!isRecord(value)) {
    return { ok: false, issues: ["intent: must be an object"] };
  }
  const intentVersion = readNonEmptyString(value.intentVersion);
  if (intentVersion === undefined) {
    pushIssue(issues, "intent.intentVersion", "must be a non-empty string");
  }
  const poseVocabulary = readNonEmptyString(value.poseVocabulary);
  if (poseVocabulary === undefined) {
    pushIssue(issues, "intent.poseVocabulary", "must be a non-empty string");
  }
  const directorVersion = readNonEmptyString(value.directorVersion);
  if (directorVersion === undefined) {
    pushIssue(issues, "intent.directorVersion", "must be a non-empty string");
  }
  let policyId: string | undefined;
  let policyVersion: string | undefined;
  if (!isRecord(value.policy)) {
    pushIssue(issues, "intent.policy", "must be an object");
  } else {
    policyId = readNonEmptyString(value.policy.policyId);
    if (policyId === undefined) {
      pushIssue(issues, "intent.policy.policyId", "must be a non-empty string");
    }
    policyVersion = readNonEmptyString(value.policy.policyVersion);
    if (policyVersion === undefined) {
      pushIssue(issues, "intent.policy.policyVersion", "must be a non-empty string");
    }
  }
  let timeline: CameraIntentDocument["timeline"] | undefined;
  if (
    !isRecord(value.timeline) ||
    !isFiniteNumber(value.timeline.startMs) ||
    !isFiniteNumber(value.timeline.endMs)
  ) {
    pushIssue(issues, "intent.timeline", "must carry finite startMs/endMs");
  } else if (value.timeline.endMs < value.timeline.startMs) {
    pushIssue(
      issues,
      "intent.timeline",
      `endMs ${value.timeline.endMs} must be >= startMs ${value.timeline.startMs}`,
    );
  } else {
    timeline = { startMs: value.timeline.startMs, endMs: value.timeline.endMs };
  }
  let pitchGeometry: CameraIntentDocument["pitchGeometry"] | undefined;
  if (
    !isRecord(value.pitchGeometry) ||
    !isFiniteNumber(value.pitchGeometry.lengthXMeters) ||
    value.pitchGeometry.lengthXMeters <= 0 ||
    !isFiniteNumber(value.pitchGeometry.widthYMeters) ||
    value.pitchGeometry.widthYMeters <= 0 ||
    typeof value.pitchGeometry.zUp !== "boolean"
  ) {
    pushIssue(
      issues,
      "intent.pitchGeometry",
      "must carry finite positive lengthXMeters/widthYMeters and zUp",
    );
  } else {
    pitchGeometry = {
      lengthXMeters: value.pitchGeometry.lengthXMeters,
      widthYMeters: value.pitchGeometry.widthYMeters,
      zUp: value.pitchGeometry.zUp,
    };
  }
  if (!isRecord(value.slotGeometry)) {
    pushIssue(issues, "intent.slotGeometry", "must be an object");
  } else {
    if (readNonEmptyString(value.slotGeometry.constantsVersion) === undefined) {
      pushIssue(issues, "intent.slotGeometry.constantsVersion", "must be a non-empty string");
    }
    const slots = value.slotGeometry.slots;
    if (!Array.isArray(slots) || slots.length === 0) {
      pushIssue(issues, "intent.slotGeometry.slots", "must be a non-empty array");
    } else {
      for (let i = 0; i < slots.length; i += 1) {
        const slot = slots[i];
        const slotPath = `intent.slotGeometry.slots[${i}]`;
        if (!isRecord(slot) || readNonEmptyString(slot.slotId) === undefined) {
          pushIssue(issues, slotPath, "must be an object with a non-empty slotId");
          continue;
        }
        if (readVec3(slot.eye, `${slotPath}.eye`, issues) === undefined) continue;
        readVec3(slot.look, `${slotPath}.look`, issues);
      }
    }
  }
  if (!isRecord(value.emission)) {
    pushIssue(issues, "intent.emission", "must be an object");
  } else {
    const emission = value.emission;
    if (emission.intentKind !== INTENT_KIND_SLOT_HOLD) {
      pushIssue(issues, "intent.emission.intentKind", `must be "${INTENT_KIND_SLOT_HOLD}"`);
    }
    if (!isFiniteNumber(emission.frameRate) || emission.frameRate <= 0) {
      pushIssue(issues, "intent.emission.frameRate", "must be a finite number > 0");
    }
    if (!isFiniteNumber(emission.frameIntervalMs) || emission.frameIntervalMs <= 0) {
      pushIssue(issues, "intent.emission.frameIntervalMs", "must be a finite number > 0");
    }
    if (
      typeof emission.poseQuantizationDecimals !== "number" ||
      !Number.isInteger(emission.poseQuantizationDecimals) ||
      emission.poseQuantizationDecimals < 0
    ) {
      pushIssue(issues, "intent.emission.poseQuantizationDecimals", "must be an integer >= 0");
    }
    if (readNonEmptyString(emission.determinism) === undefined) {
      pushIssue(issues, "intent.emission.determinism", "must be a non-empty string");
    }
    if (readNonEmptyString(emission.sourceTimeConvention) === undefined) {
      pushIssue(issues, "intent.emission.sourceTimeConvention", "must be a non-empty string");
    }
  }
  const windows: CameraIntentWindow[] = [];
  if (!Array.isArray(value.windows) || value.windows.length === 0) {
    pushIssue(issues, "intent.windows", "must be a non-empty array");
  } else {
    for (let i = 0; i < value.windows.length; i += 1) {
      const window = readWindow(value.windows[i], `intent.windows[${i}]`, i, issues);
      if (window !== undefined) windows.push(window);
    }
  }
  if (!isRecord(value.summary)) {
    pushIssue(issues, "intent.summary", "must be an object (the plan's accounting, verbatim)");
  } else {
    for (const name of [
      "windowCount",
      "liveWindowCount",
      "reviewWindowCount",
      "cutCount",
    ] as const) {
      if (
        typeof value.summary[name] !== "number" ||
        !Number.isInteger(value.summary[name]) ||
        value.summary[name] < 0
      ) {
        pushIssue(issues, `intent.summary.${name}`, "must be an integer >= 0");
      }
    }
    if (!Array.isArray(value.summary.suppressedCuts)) {
      pushIssue(issues, "intent.summary.suppressedCuts", "must be an array");
    }
    if (!Array.isArray(value.summary.eventAccounting)) {
      pushIssue(issues, "intent.summary.eventAccounting", "must be an array");
    }
  }
  if (
    issues.length > 0 ||
    intentVersion === undefined ||
    poseVocabulary === undefined ||
    directorVersion === undefined ||
    policyId === undefined ||
    policyVersion === undefined ||
    timeline === undefined ||
    pitchGeometry === undefined
  ) {
    return { ok: false, issues };
  }
  return {
    ok: true,
    value: {
      intentVersion,
      poseVocabulary,
      directorVersion,
      policy: { policyId, policyVersion },
      timeline,
      pitchGeometry,
      // Structurally cloned (fresh objects: a consumer mutating the admitted
      // document can never reach the input's blocks — the docstring's own
      // freshness claim, honored for EVERY block).
      slotGeometry: cloneJson(value.slotGeometry as CameraIntentDocument["slotGeometry"]),
      emission: cloneJson(value.emission as CameraIntentDocument["emission"]),
      windows,
      summary: cloneJson(value.summary as CameraPlanSummary),
    },
  };
}
