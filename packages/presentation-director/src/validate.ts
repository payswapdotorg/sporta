/**
 * Fail-closed structural validation of a presentation policy document
 * (`./policy.ts`). A policy is DATA — it can arrive from a config file, an
 * API, or the exported {@link DEFAULT_PRESENTATION_POLICY} — and is
 * admitted only if it satisfies every documented rule below. `present`
 * re-runs this validation before presenting (defense in depth — the
 * camera-director `validatePolicy` posture).
 *
 * Rules (each fail-closed, each test-pinned):
 *
 * - top level: a record; `policyId`/`policyVersion` non-empty strings;
 *   `camera` a VALID W604 `DirectorPolicy` (delegated to the wrapped
 *   seam's own `validatePolicy` — never re-implemented here); UNKNOWN
 *   KEYS ARE IGNORED (forward-compatible policy documents);
 * - `eventImportance`: a (possibly empty) array of `{eventType, weight}`
 *   rows — `eventType` one of W209's `CommentaryEventType` values (the
 *   W209 `EVENT_TYPE_PRIORITY` array IS the authoritative vocabulary —
 *   imported, never re-stated), NO DUPLICATE types (one row per type),
 *   `weight` a finite number in `[0, 1]`;
 * - the CROSS-LAYER rule: every event type the CAMERA layer rules MUST
 *   carry an importance row (a ruled event without a weight would direct
 *   a window the presentation layer cannot explain — refused);
 * - `baselineImportance` / `baselineSemanticScore`: finite numbers in
 *   `[0, 1]`;
 * - `semantics`: the three blend weights finite `>= 0` summing to EXACTLY
 *   1 (the documented blend model — a drifting sum would silently
 *   rescale every combined score);
 * - `framing`: a non-empty array of `{slotId, framing}` rows —
 *   non-empty `slotId` strings, `framing` in the framing vocabulary, NO
 *   DUPLICATE slot ids (ambiguous classification). Coverage of every
 *   canonical W601 slot is NOT checked here (the canonical vocabulary
 *   belongs to the scene-projection seam this package deliberately does
 *   not import) — it is enforced FAIL-CLOSED AT USE TIME: a presented
 *   plan whose slot has no framing row is refused (`framing-gap`), never
 *   defaulted.
 */
import { validatePolicy } from "@sporta/camera-director";
import { EVENT_TYPE_PRIORITY } from "@sporta/commentary-understanding";
import { isFiniteNumber, isRecord, readNonEmptyString } from "./internal";
import type {
  EventImportanceRow,
  FramingRule,
  PresentationPolicy,
  SemanticBlendWeights,
} from "./policy";

/** The result of `validatePresentationPolicy`: admitted, or refused with issues. */
export type PresentationPolicyValidation =
  | { ok: true; value: PresentationPolicy }
  | { ok: false; issues: string[] };

function pushIssue(issues: string[], path: string, message: string): void {
  issues.push(`${path}: ${message}`);
}

/** Validates the event-importance table at `path` (with the cross-layer rule). */
function validateEventImportance(
  value: unknown,
  cameraRuledTypes: ReadonlySet<string>,
  path: string,
  issues: string[],
): EventImportanceRow[] | undefined {
  if (!Array.isArray(value)) {
    pushIssue(issues, path, "must be an array (may be empty)");
    return undefined;
  }
  const rows: EventImportanceRow[] = [];
  let valid = true;
  for (let i = 0; i < value.length; i += 1) {
    const row = value[i];
    const rowPath = `${path}[${i}]`;
    if (!isRecord(row)) {
      pushIssue(issues, rowPath, "must be an object");
      valid = false;
      continue;
    }
    if (
      typeof row.eventType !== "string" ||
      !(EVENT_TYPE_PRIORITY as readonly string[]).includes(row.eventType)
    ) {
      pushIssue(
        issues,
        `${rowPath}.eventType`,
        `must be one of the W209 event types (${EVENT_TYPE_PRIORITY.join(", ")})`,
      );
      valid = false;
      continue;
    }
    if (!isFiniteNumber(row.weight) || row.weight < 0 || row.weight > 1) {
      pushIssue(issues, `${rowPath}.weight`, "must be a finite number in [0, 1]");
      valid = false;
      continue;
    }
    // Membership-checked above against the W209 vocabulary (the authoritative
    // list) — the cast is a validated narrowing, never an invention.
    rows.push({ eventType: row.eventType as EventImportanceRow["eventType"], weight: row.weight });
  }
  if (!valid) return undefined;
  // One row per event type (unambiguous importance lookup).
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.eventType)) {
      pushIssue(
        issues,
        path,
        `duplicate row for event type "${row.eventType}" (one row per type)`,
      );
      valid = false;
    }
    seen.add(row.eventType);
  }
  if (!valid) return undefined;
  // The cross-layer rule: every camera-ruled type carries a weight.
  for (const ruled of cameraRuledTypes) {
    if (!seen.has(ruled)) {
      pushIssue(
        issues,
        path,
        `the camera layer rules event type "${ruled}" but the importance table has no row for it (every ruled event must be explainable)`,
      );
      valid = false;
    }
  }
  return valid ? rows : undefined;
}

/** Validates the semantic blend weights at `path`. */
function validateSemantics(
  value: unknown,
  path: string,
  issues: string[],
): SemanticBlendWeights | undefined {
  if (!isRecord(value)) {
    pushIssue(issues, path, "must be an object");
    return undefined;
  }
  const keys = ["importanceWeight", "emphasisWeight", "confidenceWeight"] as const;
  const weights: number[] = [];
  for (const key of keys) {
    const weight = value[key];
    if (!isFiniteNumber(weight) || weight < 0) {
      pushIssue(issues, `${path}.${key}`, "must be a finite number >= 0");
      return undefined;
    }
    weights.push(weight);
  }
  const sum = weights[0]! + weights[1]! + weights[2]!;
  if (Math.abs(sum - 1) > 1e-9) {
    pushIssue(issues, path, `the three blend weights must sum to exactly 1 (got ${sum})`);
    return undefined;
  }
  return {
    importanceWeight: weights[0]!,
    emphasisWeight: weights[1]!,
    confidenceWeight: weights[2]!,
  };
}

/** Validates the framing table at `path`. */
function validateFraming(value: unknown, path: string, issues: string[]): FramingRule[] | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    pushIssue(issues, path, "must be a non-empty array");
    return undefined;
  }
  const rows: FramingRule[] = [];
  let valid = true;
  for (let i = 0; i < value.length; i += 1) {
    const row = value[i];
    const rowPath = `${path}[${i}]`;
    if (!isRecord(row)) {
      pushIssue(issues, rowPath, "must be an object");
      valid = false;
      continue;
    }
    const slotId = readNonEmptyString(row.slotId);
    if (slotId === undefined) {
      pushIssue(issues, `${rowPath}.slotId`, "must be a non-empty string");
      valid = false;
      continue;
    }
    if (row.framing !== "wide" && row.framing !== "tight") {
      pushIssue(issues, `${rowPath}.framing`, `must be "wide" or "tight" (got ${String(row.framing)})`);
      valid = false;
      continue;
    }
    rows.push({ slotId, framing: row.framing });
  }
  if (!valid) return undefined;
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.slotId)) {
      pushIssue(issues, path, `duplicate framing row for slot "${row.slotId}" (ambiguous classification)`);
      valid = false;
    }
    seen.add(row.slotId);
  }
  return valid ? rows : undefined;
}

/**
 * Validates a presentation policy document (fail-closed, unknown
 * top-level keys ignored). Pure: same input → same issues.
 */
export function validatePresentationPolicy(value: unknown): PresentationPolicyValidation {
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
  // The camera layer: delegated to the wrapped W604 seam's own validator.
  const camera = validatePolicy(value.camera);
  if (!camera.ok) {
    for (const issue of camera.issues) {
      pushIssue(issues, "policy.camera", issue);
    }
  }
  const cameraRuledTypes = new Set<string>(
    camera.ok ? camera.value.eventRules.map((rule) => rule.eventType as string) : [],
  );
  const eventImportance = camera.ok
    ? validateEventImportance(value.eventImportance, cameraRuledTypes, "policy.eventImportance", issues)
    : undefined;
  const baselineImportance = value.baselineImportance;
  if (!isFiniteNumber(baselineImportance) || baselineImportance < 0 || baselineImportance > 1) {
    pushIssue(issues, "policy.baselineImportance", "must be a finite number in [0, 1]");
  }
  const semantics = validateSemantics(value.semantics, "policy.semantics", issues);
  const baselineSemanticScore = value.baselineSemanticScore;
  if (
    !isFiniteNumber(baselineSemanticScore) ||
    baselineSemanticScore < 0 ||
    baselineSemanticScore > 1
  ) {
    pushIssue(issues, "policy.baselineSemanticScore", "must be a finite number in [0, 1]");
  }
  const framing = validateFraming(value.framing, "policy.framing", issues);
  if (
    issues.length > 0 ||
    !camera.ok ||
    eventImportance === undefined ||
    semantics === undefined ||
    framing === undefined ||
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
      camera: camera.value,
      eventImportance,
      // Narrowed by the checks above (the ok-flags gate the early return).
      baselineImportance: baselineImportance as number,
      semantics,
      baselineSemanticScore: baselineSemanticScore as number,
      framing,
    },
  };
}
