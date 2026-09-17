/**
 * Perception adapter contracts — Wave-0 freeze of the perception seam
 * binding (R201 preparation, docs/architecture/technology-plane.md).
 *
 * The concrete per-family adapter INTERFACES (detector, tracker,
 * calibration, team-identity) are R201's Wave-2 deliverable, built on the
 * existing `DetectorAdapter` pattern in `@sporta/perception-detection`. What
 * Wave 0 freezes is the MACHINE-READABLE BINDING every perception adapter
 * must declare: which task it performs, which contract its input conforms
 * to, and which contract its output conforms to — so the Technology
 * Registry and the evaluation runner can verify a candidate's declared task
 * is coherent WITHOUT touching SWM semantics (never mutate the SWM to fit a
 * model).
 *
 * The shared descriptor every perception adapter exposes (mirrors the
 * game-engine descriptor pattern; both are TechnologyProfile-compatible
 * identity records).
 */
import { z } from "zod";
import { schemaVersionField } from "./versioning";
import { AdapterTaskKind } from "./technology";

/** The perception tasks (closed subset of the adapter taxonomy). */
export const PerceptionTaskKind = z.enum([
  "perception.player-detection",
  "perception.ball-detection",
  "perception.player-tracking",
  "perception.ball-tracking",
  "perception.reid",
  "perception.pitch-calibration",
  "perception.team-identity",
  "perception.jersey-ocr",
]);
export type PerceptionTaskKind = z.infer<typeof PerceptionTaskKind>;

/** The neutral descriptor every perception adapter must expose. */
export const PerceptionAdapterDescriptor = z.object({
  schemaVersion: schemaVersionField,
  adapterKind: z.literal("perception"),
  technologyId: z.string().min(1),
  technologyVersion: z.string().min(1),
  adapterVersion: z.string().min(1),
  task: PerceptionTaskKind,
  /** The contract/interface reference this adapter consumes (validated input). */
  inputContract: z.string().min(1),
  /** The contract/interface reference this adapter produces (validated output). */
  outputContract: z.string().min(1),
});
export type PerceptionAdapterDescriptor = z.infer<typeof PerceptionAdapterDescriptor>;

/**
 * The frozen task->contract binding table: the input/output contract
 * references a candidate MUST conform to for each perception task to be
 * registry-coherent. `R201` adapters assert against this table at
 * registration; a candidate whose declared bindings mismatch is refused
 * BEFORE any evaluation (fail-closed technology neutrality).
 */
export const PERCEPTION_TASK_BINDINGS: Readonly<
  Record<PerceptionTaskKind, { inputContract: string; outputContract: string }>
> = {
  "perception.player-detection": {
    inputContract: "contracts/normalized-video-frame@1",
    outputContract: "contracts/observation.detection@1",
  },
  "perception.ball-detection": {
    inputContract: "contracts/normalized-video-frame@1",
    outputContract: "contracts/observation.detection@1",
  },
  "perception.player-tracking": {
    inputContract: "contracts/observation.detection-sequence@1",
    outputContract: "contracts/observation.track@1",
  },
  "perception.ball-tracking": {
    inputContract: "contracts/observation.detection-sequence@1",
    outputContract: "contracts/observation.track@1",
  },
  "perception.reid": {
    inputContract: "contracts/observation.track-crop-sequence@1",
    outputContract: "contracts/observation.reid-match@1",
  },
  "perception.pitch-calibration": {
    inputContract: "contracts/normalized-video-frame-sequence@1",
    outputContract: "contracts/observation.field-mapping@1",
  },
  "perception.team-identity": {
    inputContract: "contracts/observation.track-sequence@1",
    outputContract: "contracts/observation.team-assignment@1",
  },
  "perception.jersey-ocr": {
    inputContract: "contracts/observation.track-crop-sequence@1",
    outputContract: "contracts/observation.jersey-number@1",
  },
};

/**
 * The binding issues for a descriptor (empty = coherent): the task must be
 * a perception task and the declared input/output contracts must match the
 * frozen binding table exactly.
 */
export function perceptionBindingIssues(descriptor: PerceptionAdapterDescriptor): string[] {
  const issues: string[] = [];
  const binding = PERCEPTION_TASK_BINDINGS[descriptor.task];
  if (!binding) {
    issues.push(`task ${descriptor.task} is not a perception task`);
    return issues;
  }
  if (descriptor.inputContract !== binding.inputContract) {
    issues.push(
      `inputContract ${descriptor.inputContract} does not match frozen binding ${binding.inputContract}`,
    );
  }
  if (descriptor.outputContract !== binding.outputContract) {
    issues.push(
      `outputContract ${descriptor.outputContract} does not match frozen binding ${binding.outputContract}`,
    );
  }
  return issues;
}

/** `true` for tasks in the perception family (helper for registry code). */
export function isPerceptionTask(task: AdapterTaskKind): boolean {
  return (Object.keys(PERCEPTION_TASK_BINDINGS) as PerceptionTaskKind[]).includes(
    task as PerceptionTaskKind,
  );
}
