/**
 * The camera intent self-check harness (the `./selfcheck.ts` convention
 * applied to the HF014 emission): a pure, fail-soft invariant checker over
 * a {@link CameraIntentDocument} + the match timeline it was emitted for.
 * The intent module's own tests AND any consumer admitting an intent
 * document (by wire) can run it — the emission's documented invariants are
 * therefore both PROVEN on the canonical fixtures and ENFORCEABLE on any
 * document that claims the class.
 *
 * Checks report violations with STABLE IDS + JSON paths (fail-soft for
 * evaluation), never mutate the document, and every defect class has a
 * negative fixture proving detection (`test/intent.test.ts`).
 *
 * The invariants (each check's documented contract):
 *
 * - **intent-shape**: the document is a record with the full top-level
 *   shape (versions/policy/timeline/geometry/emission/windows/summary);
 *   windows and poses are records with their full shapes.
 * - **pose-vocabulary**: every pose carries EXACTLY the six
 *   `hf010.camera-paths@1` vocabulary fields
 *   (`frameIndex/tMs/eye/look/focalMultiplier/sourceFrame`).
 * - **slot-geometry**: the document's `slotGeometry` block echoes the W601
 *   `CANONICAL_CAMERA_SLOTS` constants VERBATIM (`camera-slots@1`), and
 *   the pitch geometry equals the canonical 105 × 68 m z-up frame.
 * - **pose-resolution**: every window's path is the honest slot-hold
 *   resolution — `anchorSlotId === cameraSlotId` is a canonical slot,
 *   every pose's `eye`/`look` deep-equal the slot geometry,
 *   `focalMultiplier === 1`, `tMs = i · frameIntervalMs` strictly
 *   increasing from 0, `frameCount === poses.length`, and every
 *   `sourceFrame` lies inside the window's step RUN and never decreases.
 * - **provenance-carried**: every window's provenance uses a closed
 *   `ruleId`, carries the W601 slot-geometry version, and the decision
 *   record carries the verbatim candidate/follow inputs (the plan's own
 *   decision-records convention).
 * - **timeline-consistency**: the document's timeline equals the steps'
 *   `atMs` span; every window boundary is a snapshot boundary (a step
 *   `atMs`); live windows tile the timeline; review ranges lie inside it
 *   (the plan's invariants, preserved by the emission).
 * - **summary-consistency**: the summary counts recompute from the
 *   windows (window/live/review/cut counts).
 */
import { CANONICAL_CAMERA_SLOTS, CAMERA_SLOT_SET_VERSION } from "@sporta/scene-projection";
import { PITCH_LENGTH_AXIS_METERS, PITCH_WIDTH_AXIS_METERS } from "@sporta/contracts";
import type { AvatarField3dMatchStep } from "@sporta/renderer-3d";
import { isFiniteNumber, isRecord } from "./internal";
import { INTENT_KIND_SLOT_HOLD } from "./intent";

/** The result of {@link checkCameraIntent}: the violations (empty ⇔ ok). */
export interface IntentCheckResult {
  ok: boolean;
  violations: string[];
}

/** The presentation-kind vocabulary. */
const PRESENTATION_KINDS = ["live", "review"] as const;

/** The closed rule vocabulary of the director. */
const RULE_IDS = ["possession-follow", "event-focus", "replay-emphasis"] as const;

/** The exact pose-vocabulary field set (the hf010 class contract). */
const POSE_FIELDS = ["frameIndex", "tMs", "eye", "look", "focalMultiplier", "sourceFrame"] as const;

/** The exact slot-geometry field set of one echoed slot. */
const SLOT_FIELDS = ["slotId", "eye", "look"] as const;

function isVec3(value: unknown): value is { x: number; y: number; z: number } {
  return (
    isRecord(value) && isFiniteNumber(value.x) && isFiniteNumber(value.y) && isFiniteNumber(value.z)
  );
}

function vec3Equals(a: unknown, b: unknown): boolean {
  if (!isVec3(a) || !isVec3(b)) return false;
  return a.x === b.x && a.y === b.y && a.z === b.z;
}

/**
 * Checks a camera intent document against the match timeline it was
 * emitted for. Pure: the document is never mutated; the same inputs yield
 * the same violations.
 */
export function checkCameraIntent(
  intent: unknown,
  steps: readonly AvatarField3dMatchStep[],
): IntentCheckResult {
  const violations: string[] = [];
  const push = (id: string, path: string, message: string): void => {
    violations.push(`${id}: ${path}: ${message}`);
  };

  if (!isRecord(intent)) {
    push("intent-shape", "intent", "must be an object");
    return { ok: false, violations };
  }
  if (typeof intent.intentVersion !== "string" || intent.intentVersion === "") {
    push("intent-shape", "intent.intentVersion", "must be a non-empty string");
  }
  if (typeof intent.poseVocabulary !== "string" || intent.poseVocabulary === "") {
    push("intent-shape", "intent.poseVocabulary", "must be a non-empty string");
  }
  if (typeof intent.directorVersion !== "string" || intent.directorVersion === "") {
    push("intent-shape", "intent.directorVersion", "must be a non-empty string");
  }
  for (const name of [
    "policy",
    "timeline",
    "pitchGeometry",
    "slotGeometry",
    "emission",
    "summary",
  ] as const) {
    if (!isRecord(intent[name])) {
      push("intent-shape", `intent.${name}`, "must be an object");
    }
  }

  const times: number[] = [];
  if (steps.length === 0) {
    push("timeline-consistency", "steps", "must be a non-empty array of match steps");
    return { ok: false, violations };
  }
  for (let i = 0; i < steps.length; i += 1) {
    const atMs = isRecord(steps[i]) ? steps[i]!.atMs : undefined;
    if (!isFiniteNumber(atMs)) {
      push("timeline-consistency", `steps[${i}].atMs`, "must be a finite number");
      return { ok: false, violations };
    }
    times.push(atMs);
  }
  const timelineStart = times[0]!;
  const timelineEnd = times[times.length - 1]!;
  if (isRecord(intent.timeline)) {
    if (intent.timeline.startMs !== timelineStart || intent.timeline.endMs !== timelineEnd) {
      push(
        "timeline-consistency",
        "intent.timeline",
        `must equal the steps' atMs span [${timelineStart}, ${timelineEnd}] (got [${String(intent.timeline.startMs)}, ${String(intent.timeline.endMs)}])`,
      );
    }
  }

  // slot-geometry: the W601 echo must be VERBATIM.
  const slotGeometry = intent.slotGeometry;
  if (isRecord(slotGeometry)) {
    if (slotGeometry.constantsVersion !== CAMERA_SLOT_SET_VERSION) {
      push(
        "slot-geometry",
        "intent.slotGeometry.constantsVersion",
        `must be the W601 camera-slot constant set version "${CAMERA_SLOT_SET_VERSION}"`,
      );
    }
    const slots = slotGeometry.slots;
    if (!Array.isArray(slots) || slots.length !== CANONICAL_CAMERA_SLOTS.length) {
      push(
        "slot-geometry",
        "intent.slotGeometry.slots",
        `must echo the ${CANONICAL_CAMERA_SLOTS.length} canonical W601 slots`,
      );
    } else {
      for (let i = 0; i < slots.length; i += 1) {
        const echoed = slots[i];
        const canonical = CANONICAL_CAMERA_SLOTS[i]!;
        const path = `intent.slotGeometry.slots[${i}]`;
        if (!isRecord(echoed)) {
          push("slot-geometry", path, "must be an object");
          continue;
        }
        const echoedKeys = Object.keys(echoed).sort().join(",");
        const expectedKeys = [...SLOT_FIELDS].sort().join(",");
        if (echoedKeys !== expectedKeys) {
          push(
            "slot-geometry",
            path,
            `must carry exactly the slot fields (${SLOT_FIELDS.join(", ")})`,
          );
          continue;
        }
        if (
          echoed.slotId !== canonical.slotId ||
          !vec3Equals(echoed.eye, canonical.position) ||
          !vec3Equals(echoed.look, canonical.target)
        ) {
          push(
            "slot-geometry",
            path,
            `must echo the W601 slot "${canonical.slotId}" verbatim (position ${canonical.position.x}/${canonical.position.y}/${canonical.position.z}, target ${canonical.target.x}/${canonical.target.y}/${canonical.target.z})`,
          );
        }
      }
    }
  }
  const pitchGeometry = intent.pitchGeometry;
  if (isRecord(pitchGeometry)) {
    if (
      pitchGeometry.lengthXMeters !== PITCH_LENGTH_AXIS_METERS ||
      pitchGeometry.widthYMeters !== PITCH_WIDTH_AXIS_METERS ||
      pitchGeometry.zUp !== true
    ) {
      push(
        "slot-geometry",
        "intent.pitchGeometry",
        `must be the canonical W601 frame ${PITCH_LENGTH_AXIS_METERS} × ${PITCH_WIDTH_AXIS_METERS} m, z up`,
      );
    }
  }

  // The slot-geometry lookup the pose-resolution check resolves against.
  const geometryById = new Map(
    CANONICAL_CAMERA_SLOTS.map((slot) => [slot.slotId, { eye: slot.position, look: slot.target }]),
  );

  const emission = isRecord(intent.emission) ? intent.emission : undefined;
  const emissionFrameIntervalMs = emission !== undefined ? emission.frameIntervalMs : undefined;
  if (
    emission !== undefined &&
    (!isFiniteNumber(emissionFrameIntervalMs) || emissionFrameIntervalMs! <= 0)
  ) {
    push("pose-resolution", "intent.emission.frameIntervalMs", "must be a finite number > 0");
  }
  if (emission !== undefined && emission.intentKind !== INTENT_KIND_SLOT_HOLD) {
    push("pose-resolution", "intent.emission.intentKind", `must be "${INTENT_KIND_SLOT_HOLD}"`);
  }

  const windows = intent.windows;
  if (!Array.isArray(windows) || windows.length === 0) {
    push("intent-shape", "intent.windows", "must be a non-empty array");
    return { ok: false, violations };
  }

  const isStepTime = (t: number): boolean => times.includes(t);
  const wellFormedWindows: Array<Record<string, unknown>> = [];
  for (let i = 0; i < windows.length; i += 1) {
    const window = windows[i];
    const path = `intent.windows[${i}]`;
    if (!isRecord(window)) {
      push("intent-shape", path, "must be an object");
      continue;
    }
    wellFormedWindows.push(window);
    if (window.index !== i) {
      push("intent-shape", `${path}.index`, `must be ${i} (gap-free rundown order)`);
    }
    if (
      typeof window.kind !== "string" ||
      !(PRESENTATION_KINDS as readonly string[]).includes(window.kind)
    ) {
      push("intent-shape", `${path}.kind`, `must be "live" or "review"`);
    }
    const source = window.source;
    if (!isRecord(source) || !isFiniteNumber(source.startMs) || !isFiniteNumber(source.endMs)) {
      push("intent-shape", `${path}.source`, "must carry finite startMs/endMs");
      continue;
    }
    if (source.endMs < source.startMs) {
      push("intent-shape", `${path}.source`, "endMs must be >= startMs");
      continue;
    }
    if (!isStepTime(source.startMs) || !isStepTime(source.endMs)) {
      push(
        "timeline-consistency",
        `${path}.source`,
        `boundaries [${source.startMs}, ${source.endMs}] must be snapshot boundaries (step atMs values)`,
      );
    }
    if (
      window.kind === "review" &&
      (source.startMs < timelineStart || source.endMs > timelineEnd)
    ) {
      push(
        "timeline-consistency",
        `${path}.source`,
        `review range [${source.startMs}, ${source.endMs}] lies outside the match timeline [${timelineStart}, ${timelineEnd}]`,
      );
    }

    // provenance-carried.
    const provenance = window.provenance;
    if (!isRecord(provenance)) {
      push(
        "provenance-carried",
        `${path}.provenance`,
        "must be an object (rule + geometry + decision)",
      );
      continue;
    }
    if (
      typeof provenance.ruleId !== "string" ||
      !(RULE_IDS as readonly string[]).includes(provenance.ruleId)
    ) {
      push(
        "provenance-carried",
        `${path}.provenance.ruleId`,
        `"${String(provenance.ruleId)}" is not a director rule id`,
      );
    }
    if (provenance.slotGeometryVersion !== CAMERA_SLOT_SET_VERSION) {
      push(
        "provenance-carried",
        `${path}.provenance.slotGeometryVersion`,
        `must be "${CAMERA_SLOT_SET_VERSION}" (the geometry the poses resolved from)`,
      );
    }
    const decision = provenance.decision;
    if (!isRecord(decision)) {
      push(
        "provenance-carried",
        `${path}.provenance.decision`,
        "must be the plan's decision record, verbatim",
      );
    } else {
      if (decision.ruleId !== provenance.ruleId) {
        push(
          "provenance-carried",
          `${path}.provenance.decision.ruleId`,
          `must equal the window's ruleId "${String(provenance.ruleId)}" (carried verbatim)`,
        );
      }
      const eventDriven =
        provenance.ruleId === "event-focus" || provenance.ruleId === "replay-emphasis";
      if (eventDriven) {
        const event = decision.event;
        if (!isRecord(event)) {
          push(
            "provenance-carried",
            `${path}.provenance.decision.event`,
            "event-driven rules must carry the verbatim candidate",
          );
        } else {
          for (const name of ["candidateId", "eventType"] as const) {
            if (typeof event[name] !== "string" || (event[name] as string) === "") {
              push(
                "provenance-carried",
                `${path}.provenance.decision.event.${name}`,
                "must be a non-empty string (verbatim)",
              );
            }
          }
          for (const name of ["eventTimeMs", "confidence", "emphasis"] as const) {
            if (!isFiniteNumber(event[name]) || (event[name] as number) < 0) {
              push(
                "provenance-carried",
                `${path}.provenance.decision.event.${name}`,
                "must be a finite number >= 0 (verbatim)",
              );
            }
          }
        }
      } else if (provenance.ruleId === "possession-follow" && !isRecord(decision.possession)) {
        push(
          "provenance-carried",
          `${path}.provenance.decision.possession`,
          "possession-follow decisions must carry the follow inputs",
        );
      }
    }

    // pose-resolution (+ pose-vocabulary).
    const cameraSlotId = window.cameraSlotId;
    const geometry = typeof cameraSlotId === "string" ? geometryById.get(cameraSlotId) : undefined;
    const pathBlock = window.path;
    if (!isRecord(pathBlock)) {
      push("pose-resolution", `${path}.path`, "must be an object (the resolved camera path)");
      continue;
    }
    if (pathBlock.intentKind !== INTENT_KIND_SLOT_HOLD) {
      push("pose-resolution", `${path}.path.intentKind`, `must be "${INTENT_KIND_SLOT_HOLD}"`);
    }
    if (pathBlock.anchorSlotId !== cameraSlotId) {
      push(
        "pose-resolution",
        `${path}.path.anchorSlotId`,
        `must equal the window's cameraSlotId "${String(cameraSlotId)}"`,
      );
    }
    const poses = pathBlock.poses;
    if (!Array.isArray(poses) || poses.length === 0) {
      push("pose-resolution", `${path}.path.poses`, "must be a non-empty array");
      continue;
    }
    if (pathBlock.frameCount !== poses.length) {
      push(
        "pose-resolution",
        `${path}.path.frameCount`,
        `must equal the pose count (${poses.length})`,
      );
    }
    if (pathBlock.frameIntervalMs !== emissionFrameIntervalMs) {
      push(
        "pose-resolution",
        `${path}.path.frameIntervalMs`,
        `must equal the emission's frameIntervalMs ${String(emissionFrameIntervalMs)}`,
      );
    }
    // The window's step RUN (the sourceFrame bounds).
    const runStart = times.indexOf(source.startMs as number);
    const runEnd = times.indexOf(source.endMs as number);
    let previousSourceFrame = -1;
    for (let j = 0; j < poses.length; j += 1) {
      const pose = poses[j];
      const posePath = `${path}.path.poses[${j}]`;
      if (!isRecord(pose)) {
        push("intent-shape", posePath, "must be an object");
        continue;
      }
      const poseKeys = Object.keys(pose).sort().join(",");
      const expectedKeys = [...POSE_FIELDS].sort().join(",");
      if (poseKeys !== expectedKeys) {
        push(
          "pose-vocabulary",
          posePath,
          `must carry exactly the six vocabulary fields (${POSE_FIELDS.join(", ")})`,
        );
        continue;
      }
      if (pose.frameIndex !== j) {
        push("pose-resolution", `${posePath}.frameIndex`, `must be ${j} (gap-free path order)`);
      }
      const interval = isFiniteNumber(emissionFrameIntervalMs)
        ? Math.round(j * (emissionFrameIntervalMs as number) * 1000) / 1000
        : undefined;
      if (interval !== undefined && pose.tMs !== interval) {
        push(
          "pose-resolution",
          `${posePath}.tMs`,
          `must be ${interval} (frameIndex ${j} × frameIntervalMs ${String(emissionFrameIntervalMs)}, quantized to 3 decimals)`,
        );
      }
      if (geometry === undefined) {
        push(
          "pose-resolution",
          `${path}.cameraSlotId`,
          `"${String(cameraSlotId)}" is not a canonical camera slot (never an invented geometry)`,
        );
        break;
      }
      if (!vec3Equals(pose.eye, geometry.eye) || !vec3Equals(pose.look, geometry.look)) {
        push(
          "pose-resolution",
          `${posePath}`,
          `eye/look must equal the "${String(cameraSlotId)}" slot geometry (the slot-hold resolution: eye ${geometry.eye.x}/${geometry.eye.y}/${geometry.eye.z}, look ${geometry.look.x}/${geometry.look.y}/${geometry.look.z})`,
        );
      }
      if (pose.focalMultiplier !== 1) {
        push(
          "pose-resolution",
          `${posePath}.focalMultiplier`,
          "must be 1 (the fixed-focal posture — the director never zooms)",
        );
      }
      if (
        typeof pose.sourceFrame !== "number" ||
        !Number.isInteger(pose.sourceFrame) ||
        pose.sourceFrame < runStart ||
        pose.sourceFrame > runEnd
      ) {
        push(
          "pose-resolution",
          `${posePath}.sourceFrame`,
          `must be an integer in the window's step run [${runStart}, ${runEnd}]`,
        );
      } else if (pose.sourceFrame < previousSourceFrame) {
        push(
          "pose-resolution",
          `${posePath}.sourceFrame`,
          `must not decrease (source frames advance monotonically; got ${pose.sourceFrame} after ${previousSourceFrame})`,
        );
      }
      if (typeof pose.sourceFrame === "number") {
        previousSourceFrame = pose.sourceFrame as number;
      }
    }
  }

  // live-tiling (the plan's invariant, preserved by the emission).
  const liveWindows = wellFormedWindows.filter((window) => window.kind === "live");
  if (liveWindows.length === 0) {
    push(
      "timeline-consistency",
      "intent.windows",
      "the intent must carry at least one live window",
    );
  } else {
    const first = liveWindows[0]!.source as Record<string, number>;
    if (first.startMs !== timelineStart) {
      push(
        "timeline-consistency",
        "intent.windows[0].source.startMs",
        `the first live window must start at the timeline start ${timelineStart}`,
      );
    }
    const last = liveWindows[liveWindows.length - 1]!.source as Record<string, number>;
    if (last.endMs !== timelineEnd) {
      push(
        "timeline-consistency",
        "intent.windows[last-live].source.endMs",
        `the last live window must end at the timeline end ${timelineEnd}`,
      );
    }
    for (let i = 1; i < liveWindows.length; i += 1) {
      const previous = liveWindows[i - 1]!.source as Record<string, number>;
      const current = liveWindows[i]!.source as Record<string, number>;
      if (previous.endMs !== current.startMs) {
        push(
          "timeline-consistency",
          "intent.windows",
          `live tiling broken: previous window ends at ${previous.endMs}, this starts at ${current.startMs}`,
        );
      }
    }
  }

  // summary-consistency.
  if (isRecord(intent.summary)) {
    const summary = intent.summary;
    if (summary.windowCount !== windows.length) {
      push("summary-consistency", "intent.summary.windowCount", `must be ${windows.length}`);
    }
    const liveCount = wellFormedWindows.filter((window) => window.kind === "live").length;
    if (summary.liveWindowCount !== liveCount) {
      push("summary-consistency", "intent.summary.liveWindowCount", `must be ${liveCount}`);
    }
    if (summary.reviewWindowCount !== wellFormedWindows.length - liveCount) {
      push(
        "summary-consistency",
        "intent.summary.reviewWindowCount",
        `must be ${wellFormedWindows.length - liveCount}`,
      );
    }
    let expectedCutCount = 0;
    for (let i = 1; i < wellFormedWindows.length; i += 1) {
      if (wellFormedWindows[i - 1]!.cameraSlotId !== wellFormedWindows[i]!.cameraSlotId) {
        expectedCutCount += 1;
      }
    }
    if (summary.cutCount !== expectedCutCount) {
      push(
        "summary-consistency",
        "intent.summary.cutCount",
        `must be ${expectedCutCount} (slot changes between adjacent rundown windows)`,
      );
    }
  }

  return { ok: violations.length === 0, violations };
}
