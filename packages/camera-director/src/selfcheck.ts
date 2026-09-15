/**
 * The plan self-check harness (W604 evaluation-readiness): a pure,
 * fail-soft invariant checker over a {@link CameraPlan} + the match
 * timeline it was directed for. The director's own tests AND the
 * composition's fail-closed admission both run it — the documented
 * invariants of the plan (POLICY.md §5) are therefore both PROVEN on the
 * canonical fixture and ENFORCED on every composed render.
 *
 * This is the W503 `runSceneConformance` posture applied to direction:
 * checks report violations with stable ids + JSON paths (fail-soft for
 * evaluation), never mutate the plan, and every defect class has a
 * negative fixture proving detection (`test/selfcheck.test.ts`).
 *
 * The invariants (each check's documented contract):
 *
 * - **plan-shape**: windows are records with the full window shape
 *   (index/kind/source/cameraSlotId/decision), gap-free indices in
 *   rundown order.
 * - **one-selection-per-window**: every window carries EXACTLY ONE
 *   canonical camera-slot id and one presentation kind.
 * - **boundaries-respected**: EVERY window boundary (live and review)
 *   is a SNAPSHOT boundary (a step `atMs`) — camera changes never land
 *   mid-segment.
 * - **live-tiling-total**: the live windows tile the match timeline
 *   exactly: the first starts at the timeline start, the last ends at
 *   the timeline end, consecutive windows share boundaries
 *   (`w[i].end === w[i+1].start`), and no non-last live window is
 *   degenerate.
 * - **review-within-timeline**: every review source range lies inside
 *   the match timeline (reviews re-present existing time, never new).
 * - **decision-records**: every window's decision uses a closed
 *   ruleId; event-driven decisions carry the verbatim candidate fields
 *   (id/type/time/confidence/emphasis); possession decisions carry the
 *   follow inputs.
 * - **timeline-consistency**: the plan's declared timeline equals the
 *   steps' `atMs` span (the composition contract).
 * - **summary-consistency**: the summary counts recompute exactly
 *   (window counts AND the cut count), and the candidate accounting is
 *   internally total: every entry well-formed with a UNIQUE candidate id,
 *   and every event-driven window's candidate traceable to an accounting
 *   entry carrying the same verbatim fields with outcome `governed` (a
 *   window must never cite a candidate the accounting disowns).
 */
import { CAMERA_SLOT_IDS } from "@sporta/scene-projection";
import type { AvatarField3dMatchStep } from "@sporta/renderer-3d";
import { isFiniteNumber, isRecord } from "./internal";
import type { DirectedWindow } from "./types";

/** The vocabulary of presentation kinds. */
const PRESENTATION_KINDS = ["live", "review"] as const;

/** The closed rule vocabulary of the director. */
const RULE_IDS = ["possession-follow", "event-focus", "replay-emphasis"] as const;

/** The result of {@link checkCameraPlan}: the violations (empty ⇔ ok). */
export interface PlanCheckResult {
  ok: boolean;
  violations: string[];
}

function isWindow(value: unknown): value is DirectedWindow {
  if (!isRecord(value)) return false;
  return (
    isFiniteNumber(value.index) &&
    typeof value.kind === "string" &&
    isRecord(value.source) &&
    isFiniteNumber(value.source.startMs) &&
    isFiniteNumber(value.source.endMs) &&
    typeof value.cameraSlotId === "string" &&
    isRecord(value.decision) &&
    typeof value.decision.ruleId === "string" &&
    typeof value.decision.reason === "string"
  );
}

/** The live windows in rundown order (plan-order filter). */
function liveWindowsOf(windows: readonly DirectedWindow[]): DirectedWindow[] {
  return windows.filter((window) => window.kind === "live");
}

/**
 * Checks a camera plan against the match timeline it will compose with.
 * Pure: the plan is never mutated; the same inputs yield the same
 * violations.
 */
export function checkCameraPlan(
  plan: unknown,
  steps: readonly AvatarField3dMatchStep[],
): PlanCheckResult {
  const violations: string[] = [];
  const push = (id: string, path: string, message: string): void => {
    violations.push(`${id}: ${path}: ${message}`);
  };

  if (!isRecord(plan)) {
    push("plan-shape", "plan", "must be an object");
    return { ok: false, violations };
  }
  const windows = plan.windows;
  if (!Array.isArray(windows) || windows.length === 0) {
    push("plan-shape", "plan.windows", "must be a non-empty array");
    return { ok: false, violations };
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
  const isStepTime = (t: number): boolean => times.includes(t);
  const timelineStart = times[0]!;
  const timelineEnd = times[times.length - 1]!;

  // plan-shape + one-selection-per-window + decision-records.
  for (let i = 0; i < windows.length; i += 1) {
    const window = windows[i];
    if (!isWindow(window)) {
      push("plan-shape", `windows[${i}]`, "must be a directed window record");
      continue;
    }
    if (window.index !== i) {
      push("plan-shape", `windows[${i}].index`, `must be ${i} (gap-free rundown order)`);
    }
    if (!(PRESENTATION_KINDS as readonly string[]).includes(window.kind)) {
      push(
        "one-selection-per-window",
        `windows[${i}].kind`,
        `must be "live" or "review" (got ${String(window.kind)})`,
      );
    }
    if (!CAMERA_SLOT_IDS.includes(window.cameraSlotId)) {
      push(
        "one-selection-per-window",
        `windows[${i}].cameraSlotId`,
        `"${window.cameraSlotId}" is not a canonical camera slot (never an invented angle)`,
      );
    }
    if (!(RULE_IDS as readonly string[]).includes(window.decision.ruleId)) {
      push(
        "decision-records",
        `windows[${i}].decision.ruleId`,
        `"${String(window.decision.ruleId)}" is not a director rule id`,
      );
    }
    const eventDriven =
      window.decision.ruleId === "event-focus" || window.decision.ruleId === "replay-emphasis";
    if (eventDriven) {
      const event = window.decision.event;
      if (!isRecord(event)) {
        push(
          "decision-records",
          `windows[${i}].decision.event`,
          "event-driven rules must carry the verbatim candidate",
        );
      } else {
        const fields: Array<[string, unknown]> = [
          ["candidateId", event.candidateId],
          ["eventType", event.eventType],
        ];
        for (const [name, value] of fields) {
          if (typeof value !== "string" || value.length === 0) {
            push(
              "decision-records",
              `windows[${i}].decision.event.${name}`,
              "must be a non-empty string",
            );
          }
        }
        for (const name of ["eventTimeMs", "confidence", "emphasis"] as const) {
          if (!isFiniteNumber(event[name]) || event[name] < 0) {
            push(
              "decision-records",
              `windows[${i}].decision.event.${name}`,
              "must be a finite number >= 0 (verbatim)",
            );
          }
        }
      }
    } else if (
      window.decision.ruleId === "possession-follow" &&
      !isRecord(window.decision.possession)
    ) {
      push(
        "decision-records",
        `windows[${i}].decision.possession`,
        "possession-follow decisions must carry the follow inputs",
      );
    }
    if (window.source.endMs < window.source.startMs) {
      push(
        "plan-shape",
        `windows[${i}].source`,
        `endMs ${window.source.endMs} < startMs ${window.source.startMs}`,
      );
    }
    if (!isStepTime(window.source.startMs) || !isStepTime(window.source.endMs)) {
      push(
        "boundaries-respected",
        `windows[${i}].source`,
        `boundaries [${window.source.startMs}, ${window.source.endMs}] must be snapshot boundaries (step atMs values)`,
      );
    }
    if (window.kind === "review") {
      if (window.source.startMs < timelineStart || window.source.endMs > timelineEnd) {
        push(
          "review-within-timeline",
          `windows[${i}].source`,
          `review range [${window.source.startMs}, ${window.source.endMs}] lies outside the match timeline [${timelineStart}, ${timelineEnd}]`,
        );
      }
    }
  }

  // live-tiling-total.
  const liveWindows = liveWindowsOf(windows.filter(isWindow));
  if (liveWindows.length === 0) {
    push(
      "live-tiling-total",
      "plan.windows",
      "the plan must carry at least one live window (totality)",
    );
  } else {
    if (liveWindows[0]!.source.startMs !== timelineStart) {
      push(
        "live-tiling-total",
        "windows[0].source.startMs",
        `the first live window must start at the timeline start ${timelineStart} (got ${liveWindows[0]!.source.startMs})`,
      );
    }
    const lastLive = liveWindows[liveWindows.length - 1]!;
    if (lastLive.source.endMs !== timelineEnd) {
      push(
        "live-tiling-total",
        "windows[last-live].source.endMs",
        `the last live window must end at the timeline end ${timelineEnd} (got ${lastLive.source.endMs})`,
      );
    }
    for (let i = 1; i < liveWindows.length; i += 1) {
      const previous = liveWindows[i - 1]!;
      const current = liveWindows[i]!;
      if (previous.source.endMs !== current.source.startMs) {
        push(
          "live-tiling-total",
          `windows[${current.index}].source.startMs`,
          `live tiling broken: previous window ends at ${previous.source.endMs}, this starts at ${current.source.startMs} (no gap, no overlap)`,
        );
      }
    }
    for (let i = 0; i + 1 < liveWindows.length; i += 1) {
      const window = liveWindows[i]!;
      if (window.source.endMs <= window.source.startMs) {
        push(
          "live-tiling-total",
          `windows[${window.index}].source`,
          `non-last live window is degenerate [${window.source.startMs}, ${window.source.endMs}]`,
        );
      }
    }
  }

  // timeline-consistency + summary-consistency.
  if (isRecord(plan.timeline)) {
    if (plan.timeline.startMs !== timelineStart || plan.timeline.endMs !== timelineEnd) {
      push(
        "timeline-consistency",
        "plan.timeline",
        `must equal the steps' atMs span [${timelineStart}, ${timelineEnd}] (got [${String(plan.timeline.startMs)}, ${String(plan.timeline.endMs)}])`,
      );
    }
  } else {
    push("timeline-consistency", "plan.timeline", "must be an object");
  }
  if (isRecord(plan.summary)) {
    if (plan.summary.windowCount !== windows.length) {
      push("summary-consistency", "plan.summary.windowCount", `must be ${windows.length}`);
    }
    const liveCount = windows.filter((window) => isWindow(window) && window.kind === "live").length;
    if (plan.summary.liveWindowCount !== liveCount) {
      push("summary-consistency", "plan.summary.liveWindowCount", `must be ${liveCount}`);
    }
    if (plan.summary.reviewWindowCount !== windows.length - liveCount) {
      push(
        "summary-consistency",
        "plan.summary.reviewWindowCount",
        `must be ${windows.length - liveCount}`,
      );
    }
    // The cut count recomputes: slot changes between ADJACENT rundown
    // windows (the types.ts definition, verbatim).
    let expectedCutCount = 0;
    for (let i = 1; i < windows.length; i += 1) {
      const previous = windows[i - 1];
      const current = windows[i];
      if (
        isWindow(previous) &&
        isWindow(current) &&
        previous.cameraSlotId !== current.cameraSlotId
      ) {
        expectedCutCount += 1;
      }
    }
    if (plan.summary.cutCount !== expectedCutCount) {
      push(
        "summary-consistency",
        "plan.summary.cutCount",
        `must be ${expectedCutCount} (slot changes between adjacent rundown windows)`,
      );
    }
    checkAccounting(windows, plan.summary, push);
  } else {
    push("summary-consistency", "plan.summary", "must be an object");
  }

  return { ok: violations.length === 0, violations };
}

/**
 * The candidate-accounting totality check (the W605 evaluation surface):
 * every accounting entry well-formed with a UNIQUE candidate id, and every
 * event-driven window's candidate traceable to an entry carrying the SAME
 * verbatim fields with outcome `governed`.
 */
function checkAccounting(
  windows: readonly unknown[],
  summary: Record<string, unknown>,
  push: (id: string, path: string, message: string) => void,
): void {
  const accounting = summary.eventAccounting;
  if (!Array.isArray(accounting)) {
    push("summary-consistency", "plan.summary.eventAccounting", "must be an array");
    return;
  }
  const byId = new Map<string, Record<string, unknown>>();
  for (let i = 0; i < accounting.length; i += 1) {
    const entry = accounting[i];
    if (!isRecord(entry)) {
      push("summary-consistency", `plan.summary.eventAccounting[${i}]`, "must be an object");
      continue;
    }
    const candidateId = typeof entry.candidateId === "string" ? entry.candidateId : "";
    if (candidateId === "") {
      push(
        "summary-consistency",
        `plan.summary.eventAccounting[${i}].candidateId`,
        "must be a non-empty string",
      );
      continue;
    }
    if (byId.has(candidateId)) {
      push(
        "summary-consistency",
        `plan.summary.eventAccounting[${i}].candidateId`,
        `"${candidateId}" appears more than once (every input candidate appears exactly once)`,
      );
      continue;
    }
    byId.set(candidateId, entry);
    for (const name of ["eventTimeMs", "confidence", "emphasis"] as const) {
      if (!isFiniteNumber(entry[name]) || entry[name] < 0) {
        push(
          "summary-consistency",
          `plan.summary.eventAccounting[${i}].${name}`,
          "must be a finite number >= 0 (verbatim)",
        );
      }
    }
    if (typeof entry.eventType !== "string" || entry.eventType === "") {
      push(
        "summary-consistency",
        `plan.summary.eventAccounting[${i}].eventType`,
        "must be a non-empty string",
      );
    }
  }
  // Every event-driven window's candidate must be an accounted GOVERNOR
  // with the same verbatim fields (a window citing a candidate the
  // accounting disowns — or tampered fields — is an evaluation-surface
  // inconsistency).
  for (let i = 0; i < windows.length; i += 1) {
    const window = windows[i];
    if (!isWindow(window)) continue;
    const decision = window.decision as unknown as Record<string, unknown>;
    const event =
      decision.ruleId === "event-focus" || decision.ruleId === "replay-emphasis"
        ? decision.event
        : undefined;
    if (!isRecord(event)) continue; // decision-records covers the missing case
    const candidateId = typeof event.candidateId === "string" ? event.candidateId : "";
    const entry = candidateId === "" ? undefined : byId.get(candidateId);
    if (entry === undefined) {
      push(
        "summary-consistency",
        `windows[${i}].decision.event.candidateId`,
        `"${candidateId}" is absent from the candidate accounting (every event-driven window must trace to an accounted candidate)`,
      );
      continue;
    }
    if (entry.outcome !== "governed") {
      push(
        "summary-consistency",
        `windows[${i}].decision.event.candidateId`,
        `"${candidateId}" is accounted "${String(entry.outcome)}" — only a governed candidate may drive a window`,
      );
      continue;
    }
    for (const [name, value] of [
      ["eventType", event.eventType],
      ["eventTimeMs", event.eventTimeMs],
      ["confidence", event.confidence],
      ["emphasis", event.emphasis],
    ] as Array<[string, unknown]>) {
      if (entry[name] !== value) {
        push(
          "summary-consistency",
          `windows[${i}].decision.event.${name}`,
          `${describeOf(value)} disagrees with the accounting entry (${describeOf(entry[name])}) — the candidate must ride VERBATIM`,
        );
      }
    }
  }
}

/** A compact value description for violation messages (never throws). */
function describeOf(value: unknown): string {
  return typeof value === "string" ? `"${value}"` : String(value);
}
