/**
 * The DIRECTION consistency dimension (the directed half of W605
 * deliverable 5): camera slots consistent with the plan's directed slots
 * when evaluating a directed rundown.
 *
 * What is checked, per output:
 *
 * - **Slot consistency** (every mode): each frame's HUD camera label is the
 *   fixed template over the slot actually in force (the frame's directed
 *   window's slot, or the match manifest's camera slot); the realized
 *   camera block (window or manifest) is the CANONICAL W601 slot geometry
 *   — the slot document carried by the steps' scenes, verbatim (positions
 *   never re-invented by the composer); every directed frame's own
 *   `cameraSlotId` equals its window's slot.
 * - **Directed-mode structure**: every window's slot is one of the
 *   canonical slots carried by the steps' scenes; review windows render at
 *   the W603 review profile (`REVIEW_OUTPUT_PROFILE` — the documented
 *   replay cadence; W604's composition selects it, never re-times).
 * - **Plan consistency** (when the caller supplies the `CameraPlan` the
 *   rundown was composed from): the manifest's windows match the plan's
 *   windows one-for-one (kind, source range, slot, decision record —
 *   VERBATIM), and the director provenance block (versions, policy,
 *   counts, suppressed cuts, total candidate accounting) matches the plan
 *   verbatim. Without the plan these checks are vacuously 0 and the report
 *   records `planSupplied: false` — never a silent claim.
 */
import { REVIEW_OUTPUT_PROFILE } from "@sporta/camera-director";
import type { CameraPlan, DirectedRenderManifest } from "@sporta/camera-director";
import type { EvalFrame, ValidatedSceneEvaluationInput } from "./validate";
import type { FrameExpectation } from "./expected";
import type { FindingSink } from "./findings";
import { frameFinding } from "./findings";
import { deepEqualJson, describeValue } from "./internal";

/** The direction-consistency dimension's measured metrics. */
export interface DirectionMetrics {
  /** Directed frames whose own cameraSlotId ≠ their window's slot. */
  frameSlotMismatchCount: number;
  /** Frames whose HUD camera label ≠ the fixed template over the slot in force. */
  frameCameraLabelMismatchCount: number;
  /** Windows (or the match manifest) whose slot is not among the steps' carried canonical slots. */
  windowSlotNotCarriedCount: number;
  /** Realized camera blocks that are not the canonical slot geometry (position/target drift). */
  windowCameraBlockMismatchCount: number;
  /** Review windows not rendered at the W603 review profile. */
  reviewProfileMismatchCount: number;
  /** Manifest windows that drift from the plan's directed windows (kind/source/slot/decision). */
  planWindowMismatchCount: number;
  /** Director provenance blocks that drift from the plan (version/policy/summary). */
  planProvenanceMismatchCount: number;
  /** Windows checked (0 in match mode — the metrics below reduce to the manifest's own camera). */
  windowCount: number;
}

/** The canonical slot documents carried by the steps' scenes (by slot id). */
function canonicalSlots(input: ValidatedSceneEvaluationInput): Map<string, { position: { x: number; y: number; z: number }; target: { x: number; y: number; z: number } }> {
  const slots = new Map<
    string,
    { position: { x: number; y: number; z: number }; target: { x: number; y: number; z: number } }
  >();
  for (const step of input.steps) {
    for (const slot of step.scene.cameraSlots) {
      if (!slots.has(slot.slotId)) {
        slots.set(slot.slotId, { position: slot.position, target: slot.target });
      }
    }
  }
  return slots;
}

/**
 * Measures the direction-consistency dimension. Pure. In match mode the
 * window-scoped metrics are structurally 0 (there are no windows) and the
 * frame/manifest-level checks still apply.
 */
export function measureDirection(options: {
  input: ValidatedSceneEvaluationInput;
  frames: readonly EvalFrame[];
  expectations: readonly FrameExpectation[];
  plan: CameraPlan | undefined;
  findings: FindingSink;
}): DirectionMetrics {
  const { input, frames, expectations, plan, findings } = options;
  const slots = canonicalSlots(input);

  let frameSlotMismatchCount = 0;
  let frameCameraLabelMismatchCount = 0;
  let windowSlotNotCarriedCount = 0;
  let windowCameraBlockMismatchCount = 0;
  let reviewProfileMismatchCount = 0;
  let planWindowMismatchCount = 0;
  let planProvenanceMismatchCount = 0;

  // --- Per-frame checks (both modes).
  for (let i = 0; i < frames.length; i += 1) {
    const frame = frames[i]!;
    const expectation = expectations[i]!;
    const framePath = `$.output.manifest.frames[${frame.frameIndex}]`;

    if (input.mode === "directed") {
      const ownSlot = (input.manifest as DirectedRenderManifest).frames.find(
        (candidate) => candidate.frameIndex === frame.frameIndex,
      )?.cameraSlotId;
      if (ownSlot !== undefined && ownSlot !== frame.windowSlotId) {
        frameSlotMismatchCount += 1;
        findings.push(
          frameFinding(frame, {
            dimension: "direction",
            metric: "direction.frameSlotMismatchCount",
            path: `${framePath}.cameraSlotId`,
            expected: describeValue(frame.windowSlotId),
            actual: describeValue(ownSlot),
          }),
        );
      }
    }

    if (frame.entry.hud.cameraLabel !== expectation.expectedCameraLabel) {
      frameCameraLabelMismatchCount += 1;
      findings.push(
        frameFinding(frame, {
          dimension: "direction",
          metric: "direction.frameCameraLabelMismatchCount",
          path: `${framePath}.entry.hud.cameraLabel`,
          expected: describeValue(expectation.expectedCameraLabel),
          actual: describeValue(frame.entry.hud.cameraLabel),
        }),
      );
    }
  }

  // --- Window/manifest-level checks.
  if (input.mode === "match") {
    const manifest = input.manifest as Exclude<typeof input.manifest, DirectedRenderManifest>;
    const slotId = manifest.camera.slotId;
    if (!slots.has(slotId)) {
      windowSlotNotCarriedCount += 1;
      findings.push({
        dimension: "direction",
        metric: "direction.windowSlotNotCarriedCount",
        path: "$.output.manifest.camera.slotId",
        expected: describeValue({ slotId: "one of the steps' carried slots" }),
        actual: describeValue(slotId),
      });
    } else {
      const canonical = slots.get(slotId)!;
      if (
        !deepEqualJson(manifest.camera.position, canonical.position) ||
        !deepEqualJson(manifest.camera.target, canonical.target)
      ) {
        windowCameraBlockMismatchCount += 1;
        findings.push({
          dimension: "direction",
          metric: "direction.windowCameraBlockMismatchCount",
          path: "$.output.manifest.camera",
          expected: describeValue(canonical),
          actual: describeValue({
            position: manifest.camera.position,
            target: manifest.camera.target,
          }),
        });
      }
    }
    return {
      frameSlotMismatchCount,
      frameCameraLabelMismatchCount,
      windowSlotNotCarriedCount,
      windowCameraBlockMismatchCount,
      reviewProfileMismatchCount,
      planWindowMismatchCount,
      planProvenanceMismatchCount,
      windowCount: 0,
    };
  }

  const manifest = input.manifest as DirectedRenderManifest;
  for (const window of manifest.windows) {
    const windowPath = `$.output.manifest.windows[${window.index}]`;
    if (!slots.has(window.cameraSlotId)) {
      windowSlotNotCarriedCount += 1;
      findings.push({
        dimension: "direction",
        metric: "direction.windowSlotNotCarriedCount",
        path: `${windowPath}.cameraSlotId`,
        expected: describeValue({ slotId: "one of the steps' carried slots" }),
        actual: describeValue(window.cameraSlotId),
      });
    } else {
      const canonical = slots.get(window.cameraSlotId)!;
      if (
        !deepEqualJson(window.camera.position, canonical.position) ||
        !deepEqualJson(window.camera.target, canonical.target)
      ) {
        windowCameraBlockMismatchCount += 1;
        findings.push({
          dimension: "direction",
          metric: "direction.windowCameraBlockMismatchCount",
          path: `${windowPath}.camera`,
          expected: describeValue(canonical),
          actual: describeValue({ position: window.camera.position, target: window.camera.target }),
        });
      }
    }
    if (window.kind === "review" && !deepEqualJson(window.outputProfile, REVIEW_OUTPUT_PROFILE)) {
      reviewProfileMismatchCount += 1;
      findings.push({
        dimension: "direction",
        metric: "direction.reviewProfileMismatchCount",
        path: `${windowPath}.outputProfile`,
        expected: describeValue(REVIEW_OUTPUT_PROFILE),
        actual: describeValue(window.outputProfile),
      });
    }
  }

  // --- Plan consistency (when the caller supplied the plan).
  if (plan !== undefined) {
    const director = manifest.director;
    const provenanceDrift =
      director.directorVersion !== plan.directorVersion ||
      !deepEqualJson(director.policy, plan.policy) ||
      !deepEqualJson(director.timeline, plan.timeline) ||
      !deepEqualJson(director.reviewOutputProfile, REVIEW_OUTPUT_PROFILE) ||
      director.windowCount !== plan.summary.windowCount ||
      director.liveWindowCount !== plan.summary.liveWindowCount ||
      director.reviewWindowCount !== plan.summary.reviewWindowCount ||
      director.cutCount !== plan.summary.cutCount ||
      !deepEqualJson(director.suppressedCuts, plan.summary.suppressedCuts) ||
      !deepEqualJson(director.eventAccounting, plan.summary.eventAccounting);
    if (provenanceDrift) {
      planProvenanceMismatchCount += 1;
      findings.push({
        dimension: "direction",
        metric: "direction.planProvenanceMismatchCount",
        path: "$.output.manifest.director",
        expected: describeValue({
          directorVersion: plan.directorVersion,
          policy: plan.policy,
          timeline: plan.timeline,
          reviewOutputProfile: REVIEW_OUTPUT_PROFILE,
          summary: plan.summary,
        }),
        actual: describeValue({
          directorVersion: director.directorVersion,
          policy: director.policy,
          timeline: director.timeline,
          reviewOutputProfile: director.reviewOutputProfile,
          summary: {
            windowCount: director.windowCount,
            liveWindowCount: director.liveWindowCount,
            reviewWindowCount: director.reviewWindowCount,
            cutCount: director.cutCount,
            suppressedCuts: director.suppressedCuts,
            eventAccounting: director.eventAccounting,
          },
        }),
      });
    }
    for (let w = 0; w < Math.max(manifest.windows.length, plan.windows.length); w += 1) {
      const realized = manifest.windows[w];
      const planned = plan.windows[w];
      const consistent =
        realized !== undefined &&
        planned !== undefined &&
        realized.kind === planned.kind &&
        deepEqualJson(realized.source, planned.source) &&
        realized.cameraSlotId === planned.cameraSlotId &&
        deepEqualJson(realized.decision, planned.decision);
      if (!consistent) {
        planWindowMismatchCount += 1;
        findings.push({
          dimension: "direction",
          metric: "direction.planWindowMismatchCount",
          path: `$.output.manifest.windows[${w}]`,
          expected: describeValue(planned),
          actual: describeValue(realized),
        });
      }
    }
  }

  return {
    frameSlotMismatchCount,
    frameCameraLabelMismatchCount,
    windowSlotNotCarriedCount,
    windowCameraBlockMismatchCount,
    reviewProfileMismatchCount,
    planWindowMismatchCount,
    planProvenanceMismatchCount,
    windowCount: manifest.windows.length,
  };
}
