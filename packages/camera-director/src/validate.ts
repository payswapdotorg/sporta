/**
 * Fail-closed structural validation of a direction policy document
 * (`./policy.ts`). A policy is DATA — it can arrive from a config file,
 * an API, or the exported {@link DEFAULT_DIRECTOR_POLICY} — and is
 * admitted only if it satisfies every documented rule below. `direct`
 * re-runs this validation before directing (defense in depth — the
 * renderer-3d `admitRequest` posture).
 *
 * Rules (each fail-closed, each test-pinned):
 *
 * - top level: a record; `policyId`/`policyVersion` non-empty strings;
 *   `possessionFollow` a valid config; `eventRules` an array of valid
 *   rules; UNKNOWN KEYS ARE IGNORED (forward-compatible policy documents
 *   — the renderer style-config convention);
 * - zones: non-empty array of `{xMin, xMax, slotId}` with finite numbers,
 *   `xMax >= xMin`, canonical slot ids; the zones must COVER the whole
 *   canonical pitch x span `[0, 105]` (a hole in the zone table is a
 *   POLICY BUG, not an honest "unknown" — the fallback slot covers
 *   missing DATA, never a coverage hole);
 * - `fallbackSlotId`: a canonical slot;
 * - `hysteresisMs`: a finite number >= 0;
 * - event rules: `eventType` one of W209's `CommentaryEventType` values
 *   (the W209 `EVENT_TYPE_PRIORITY` array IS the authoritative vocabulary —
 *   imported, never re-stated), NO DUPLICATES (one rule per type —
 *   first-match semantics would otherwise be ambiguous), `minConfidence`
 *   in `[0, 1]`, `focusSlotSelector` in the selector vocabulary,
 *   `holdMs` a finite number > 0 (a zero hold is a degenerate window);
 * - replay (optional): valid selector, `leadMs`/`trailMs` finite >= 0.
 */
import { EVENT_TYPE_PRIORITY } from "@sporta/commentary-understanding";
import { CAMERA_SLOT_IDS } from "@sporta/scene-projection";
import { isFiniteNumber, isRecord, readNonEmptyString } from "./internal";
import type {
  DirectorPolicy,
  EventFocusRule,
  PossessionFollowConfig,
  ReplayConfig,
} from "./policy";
import { FOCUS_SLOT_SELECTORS } from "./policy";

/** The canonical pitch x span (the W601/IFAB Law 1 length axis, meters). */
const PITCH_X_MIN = 0;
const PITCH_X_MAX = 105;

/** The result of {@link validatePolicy}: admitted, or refused with issues. */
export type PolicyValidation =
  { ok: true; value: DirectorPolicy } | { ok: false; issues: string[] };

function pushIssue(issues: string[], path: string, message: string): void {
  issues.push(`${path}: ${message}`);
}

/** Validates the possession-follow configuration at `path`. */
function validatePossessionFollow(
  value: unknown,
  path: string,
  issues: string[],
): PossessionFollowConfig | undefined {
  if (!isRecord(value)) {
    pushIssue(issues, path, "must be an object");
    return undefined;
  }
  if (typeof value.enabled !== "boolean") {
    pushIssue(issues, `${path}.enabled`, "must be a boolean");
    return undefined;
  }
  const zones: PossessionFollowConfig["zones"][number][] = [];
  if (!Array.isArray(value.zones) || value.zones.length === 0) {
    pushIssue(issues, `${path}.zones`, "must be a non-empty array");
    return undefined;
  }
  let zonesValid = true;
  for (let i = 0; i < value.zones.length; i += 1) {
    const zone = value.zones[i];
    const zonePath = `${path}.zones[${i}]`;
    if (!isRecord(zone)) {
      pushIssue(issues, zonePath, "must be an object");
      zonesValid = false;
      continue;
    }
    const { xMin, xMax, slotId } = zone;
    if (!isFiniteNumber(xMin) || !isFiniteNumber(xMax)) {
      pushIssue(issues, zonePath, "xMin and xMax must be finite numbers");
      zonesValid = false;
      continue;
    }
    if (xMax < xMin) {
      pushIssue(issues, zonePath, `xMax (${xMax}) must be >= xMin (${xMin})`);
      zonesValid = false;
      continue;
    }
    if (typeof slotId !== "string" || !CAMERA_SLOT_IDS.includes(slotId)) {
      pushIssue(
        issues,
        zonePath,
        `slotId must be one of the canonical camera slots (${CAMERA_SLOT_IDS.join(", ")})`,
      );
      zonesValid = false;
      continue;
    }
    zones.push({ xMin, xMax, slotId });
  }
  if (!zonesValid) return undefined;
  // Coverage: the sorted zones must span the whole canonical pitch x span
  // with no interior holes (overlaps are legal — declared order decides).
  const sorted = [...zones].sort((a, b) => a.xMin - b.xMin);
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  if (first.xMin > PITCH_X_MIN || last.xMax < PITCH_X_MAX) {
    pushIssue(
      issues,
      `${path}.zones`,
      `must cover the canonical pitch x span [${PITCH_X_MIN}, ${PITCH_X_MAX}] (covered: [${first.xMin}, ${last.xMax}])`,
    );
    return undefined;
  }
  for (let i = 1; i < sorted.length; i += 1) {
    const previous = sorted[i - 1]!;
    const current = sorted[i]!;
    if (current.xMin > previous.xMax) {
      pushIssue(
        issues,
        `${path}.zones`,
        `must have no interior hole between [${previous.xMin}, ${previous.xMax}] and [${current.xMin}, ${current.xMax}]`,
      );
      return undefined;
    }
  }
  if (typeof value.fallbackSlotId !== "string" || !CAMERA_SLOT_IDS.includes(value.fallbackSlotId)) {
    pushIssue(
      issues,
      `${path}.fallbackSlotId`,
      `must be one of the canonical camera slots (${CAMERA_SLOT_IDS.join(", ")})`,
    );
    return undefined;
  }
  if (!isFiniteNumber(value.hysteresisMs) || value.hysteresisMs < 0) {
    pushIssue(issues, `${path}.hysteresisMs`, "must be a finite number >= 0");
    return undefined;
  }
  return {
    enabled: value.enabled,
    zones,
    fallbackSlotId: value.fallbackSlotId,
    hysteresisMs: value.hysteresisMs,
  };
}

/** Validates one event rule at `path`. */
function validateEventRule(
  value: unknown,
  path: string,
  issues: string[],
): EventFocusRule | undefined {
  if (!isRecord(value)) {
    pushIssue(issues, path, "must be an object");
    return undefined;
  }
  if (
    typeof value.eventType !== "string" ||
    !(EVENT_TYPE_PRIORITY as readonly string[]).includes(value.eventType)
  ) {
    pushIssue(
      issues,
      `${path}.eventType`,
      `must be one of the W209 event types (${EVENT_TYPE_PRIORITY.join(", ")})`,
    );
    return undefined;
  }
  // Membership-checked above against the W209 vocabulary (the authoritative
  // list) — the cast is a validated narrowing, never an invention.
  const eventType = value.eventType as EventFocusRule["eventType"];
  if (!isFiniteNumber(value.minConfidence) || value.minConfidence < 0 || value.minConfidence > 1) {
    pushIssue(issues, `${path}.minConfidence`, "must be a finite number in [0, 1]");
    return undefined;
  }
  if (
    typeof value.focusSlotSelector !== "string" ||
    !(FOCUS_SLOT_SELECTORS as readonly string[]).includes(value.focusSlotSelector)
  ) {
    pushIssue(
      issues,
      `${path}.focusSlotSelector`,
      `must be one of (${FOCUS_SLOT_SELECTORS.join(", ")})`,
    );
    return undefined;
  }
  // Membership-checked against the selector vocabulary above.
  const focusSlotSelector = value.focusSlotSelector as EventFocusRule["focusSlotSelector"];
  if (!isFiniteNumber(value.holdMs) || value.holdMs <= 0) {
    pushIssue(issues, `${path}.holdMs`, "must be a finite number > 0");
    return undefined;
  }
  let replay: EventFocusRule["replay"];
  if (value.replay !== undefined) {
    if (!isRecord(value.replay)) {
      pushIssue(issues, `${path}.replay`, "must be an object");
      return undefined;
    }
    const replaySelector = value.replay.replaySlotSelector;
    if (
      typeof replaySelector !== "string" ||
      !(FOCUS_SLOT_SELECTORS as readonly string[]).includes(replaySelector)
    ) {
      pushIssue(
        issues,
        `${path}.replay.replaySlotSelector`,
        `must be one of (${FOCUS_SLOT_SELECTORS.join(", ")})`,
      );
      return undefined;
    }
    // Membership-checked against the selector vocabulary above.
    const replaySlotSelector = replaySelector as ReplayConfig["replaySlotSelector"];
    if (!isFiniteNumber(value.replay.leadMs) || value.replay.leadMs < 0) {
      pushIssue(issues, `${path}.replay.leadMs`, "must be a finite number >= 0");
      return undefined;
    }
    if (!isFiniteNumber(value.replay.trailMs) || value.replay.trailMs < 0) {
      pushIssue(issues, `${path}.replay.trailMs`, "must be a finite number >= 0");
      return undefined;
    }
    replay = {
      replaySlotSelector,
      leadMs: value.replay.leadMs,
      trailMs: value.replay.trailMs,
    };
  }
  return {
    eventType,
    minConfidence: value.minConfidence,
    focusSlotSelector,
    holdMs: value.holdMs,
    ...(replay === undefined ? {} : { replay }),
  };
}

/**
 * Validates a direction policy document (fail-closed, unknown top-level
 * keys ignored). Pure: same input → same issues.
 */
export function validatePolicy(value: unknown): PolicyValidation {
  const issues: string[] = [];
  if (!isRecord(value)) {
    return { ok: false, issues: ["policy: must be an object"] };
  }
  const policyId = readNonEmptyString(value.policyId);
  if (policyId === undefined) {
    pushIssue(issues, "policy.policyId", "must be a non-empty string");
  }
  const policyVersion = readNonEmptyString(value.policyVersion);
  if (policyVersion === undefined) {
    pushIssue(issues, "policy.policyVersion", "must be a non-empty string");
  }
  const possessionFollow = validatePossessionFollow(
    value.possessionFollow,
    "policy.possessionFollow",
    issues,
  );
  const eventRules: EventFocusRule[] = [];
  if (!Array.isArray(value.eventRules)) {
    pushIssue(issues, "policy.eventRules", "must be an array (may be empty)");
  } else {
    for (let i = 0; i < value.eventRules.length; i += 1) {
      const rule = validateEventRule(value.eventRules[i], `policy.eventRules[${i}]`, issues);
      if (rule !== undefined) {
        eventRules.push(rule);
      }
    }
    // One rule per event type (first-match semantics must be unambiguous).
    const seen = new Set<string>();
    for (const rule of eventRules) {
      if (seen.has(rule.eventType)) {
        pushIssue(
          issues,
          "policy.eventRules",
          `duplicate rule for event type "${rule.eventType}" (one rule per type)`,
        );
      }
      seen.add(rule.eventType);
    }
  }
  if (
    issues.length > 0 ||
    possessionFollow === undefined ||
    policyId === undefined ||
    policyVersion === undefined
  ) {
    return { ok: false, issues };
  }
  return {
    ok: true,
    value: {
      policyId,
      policyVersion,
      possessionFollow,
      eventRules,
    },
  };
}
