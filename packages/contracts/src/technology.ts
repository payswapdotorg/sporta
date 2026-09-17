/**
 * Technology Plane contracts — Wave-0 freeze of the MVP Reality Engine
 * program (ADR-009, docs/architecture/technology-plane.md).
 *
 * Every replaceable implementation technology (detector, tracker, model,
 * renderer, game engine, codec, GPU execution provider) enters Sporta as a
 * versioned {@link TechnologyProfile} registered against a closed
 * {@link AdapterTaskKind} taxonomy. Product/domain contracts refer to logical
 * task profiles — never to a technology name (architecture-lock §9 vendor
 * neutrality).
 *
 * A profile carries the mandatory evaluation metadata (ADR-009):
 * version/provenance, capabilities, resource requirements, execution
 * requirements, license/commercial-use status (recorded SEPARATELY for code,
 * model/checkpoint, dataset and bundled assets — permissive code licensing
 * does not make a checkpoint commercially usable), benchmark identity,
 * failure semantics, and lifecycle status.
 *
 * Status lifecycle (technology-plane.md): `candidate -> benchmarked ->
 * approved -> canary -> production`, with `deprecated` and `rejected` as
 * terminal exits. A technology can never enter production merely because it
 * works on one example — promotion requires benchmark + license evidence
 * (see `technology-evaluation.ts` PromotionRecord).
 *
 * `isPromotableProfile` encodes the R004 fail-closed rule: unresolved
 * commercial-use status on ANY license component blocks production
 * promotion.
 */
import { z } from "zod";
import { schemaVersionField } from "./versioning";

/**
 * The closed adapter-task taxonomy: what a replaceable technology DOES,
 * not which vendor implements it. Task ids are stable identifiers; adding a
 * member is an additive (MINOR) contract change.
 */
export const AdapterTaskKind = z.enum([
  // Perception (vision)
  "perception.player-detection",
  "perception.ball-detection",
  "perception.player-tracking",
  "perception.ball-tracking",
  "perception.reid",
  "perception.pitch-calibration",
  "perception.team-identity",
  "perception.jersey-ocr",
  // Intelligence (commentary/audio)
  "intelligence.asr",
  "intelligence.commentary-segmentation",
  "intelligence.commentary-understanding",
  // Rendering (visual realities)
  "rendering.original",
  "rendering.tactical",
  "rendering.game-3d",
  "rendering.anime-npr",
  "rendering.encode",
  // Compute execution
  "compute.execution",
  // Game engines (behind the renderer seam)
  "rendering.game-engine",
]);
export type AdapterTaskKind = z.infer<typeof AdapterTaskKind>;

/** Lifecycle status of a registered technology (technology-plane.md). */
export const TechnologyStatus = z.enum([
  "candidate",
  "benchmarked",
  "approved",
  "canary",
  "production",
  "deprecated",
  "rejected",
]);
export type TechnologyStatus = z.infer<typeof TechnologyStatus>;

/** Commercial-use resolution of one license component. */
export const LicenseComponentStatus = z.enum([
  "permissive",
  "copyleft",
  "research-only",
  "unresolved",
]);
export type LicenseComponentStatus = z.infer<typeof LicenseComponentStatus>;

/**
 * One license component record. `commercialUse` is the reviewed verdict; it
 * may only be `true` when `status` is resolved AND the review found the terms
 * commercially usable (R004's two-gate rule: license id + commercial verdict).
 */
export const LicenseComponent = z.object({
  status: LicenseComponentStatus,
  /** SPDX identifier or an explicit license name (e.g. "Apache-2.0", "CC-BY-NC-4.0"). */
  licenseId: z.string().min(1).optional(),
  /** The reviewed commercial-use verdict; absent means not yet reviewed. */
  commercialUse: z.boolean().optional(),
  /** Where the verdict came from (URL, review doc, or registry id). */
  reviewRef: z.string().min(1).optional(),
});
export type LicenseComponent = z.infer<typeof LicenseComponent>;

/**
 * The full license record for a technology: code, model/checkpoint, dataset
 * and bundled assets are reviewed SEPARATELY because permissive code
 * licensing does not automatically make a model/checkpoint commercially
 * usable (technology-plane.md License policy).
 */
export const TechnologyLicenseRecord = z.object({
  code: LicenseComponent,
  model: LicenseComponent.optional(),
  dataset: LicenseComponent.optional(),
  assets: LicenseComponent.optional(),
});
export type TechnologyLicenseRecord = z.infer<typeof TechnologyLicenseRecord>;

/** Deployment resource requirements a scheduler must respect. */
export const ResourceRequirements = z.object({
  /** GPU execution required (else CPU-only is acceptable). */
  gpuRequired: z.boolean(),
  /** Minimum GPU memory in GiB when a GPU is required. */
  minVramGb: z.number().positive().optional(),
  minRamGb: z.number().positive().optional(),
  minDiskGb: z.number().positive().optional(),
  /** Minimum CPU core count. */
  minCpuCores: z.number().positive().optional(),
});
export type ResourceRequirements = z.infer<typeof ResourceRequirements>;

/** One named failure class with its documented semantics. */
export const FailureClassRecord = z.object({
  failureClassId: z.string().min(1),
  description: z.string().min(1),
  /** Whether a retry with the same inputs can succeed. */
  retryable: z.boolean(),
});
export type FailureClassRecord = z.infer<typeof FailureClassRecord>;

/**
 * The full versioned technology profile: the registry's unit of record.
 * Immutable once written; changes produce a new `adapterVersion`.
 */
export const TechnologyProfile = z.object({
  schemaVersion: schemaVersionField,
  /** Stable logical id (e.g. "yolov11-player-detector"). */
  technologyId: z.string().min(1),
  technologyVersion: z.string().min(1),
  adapterVersion: z.string().min(1),
  task: AdapterTaskKind,
  displayName: z.string().min(1),
  /** Machine-readable capability statements (capability id -> description). */
  capabilities: z.record(z.string(), z.string()),
  /** Reference to the contract/interface the technology consumes. */
  inputContract: z.string().min(1),
  /** Reference to the contract/interface the technology produces. */
  outputContract: z.string().min(1),
  resourceRequirements: ResourceRequirements,
  /** Execution environment requirements (e.g. runtime, CUDA version). */
  executionRequirements: z.record(z.string(), z.string()),
  provenance: z.object({
    maintainer: z.string().min(1).optional(),
    sourceUrl: z.string().min(1).optional(),
    versionTag: z.string().min(1).optional(),
    acquiredAtMs: z.number().int().min(0).optional(),
  }),
  license: TechnologyLicenseRecord,
  /** Benchmark identity: the fixture set + runs backing this profile. */
  benchmarkProfile: z.object({
    fixtureSetVersion: z.string().min(1),
    benchmarkRunIds: z.array(z.string().min(1)),
  }),
  failureClasses: z.array(FailureClassRecord),
  status: TechnologyStatus,
  notes: z.string().optional(),
});
export type TechnologyProfile = z.infer<typeof TechnologyProfile>;

/**
 * The registration envelope for a NEW technology entering evaluation: the
 * minimal honest record before benchmark/license data exists. Every profile
 * starts here; promotion out of `candidate` requires evidence
 * (technology-evaluation.ts).
 */
export const TechnologyCandidate = z.object({
  schemaVersion: schemaVersionField,
  candidateId: z.string().min(1),
  technologyId: z.string().min(1),
  technologyVersion: z.string().min(1),
  adapterVersion: z.string().min(1),
  task: AdapterTaskKind,
  displayName: z.string().min(1),
  registeredAtMs: z.number().int().min(0),
  sourceUrl: z.string().min(1).optional(),
  notes: z.string().optional(),
});
export type TechnologyCandidate = z.infer<typeof TechnologyCandidate>;

/**
 * R004 fail-closed rule: a profile may be promoted toward production only
 * when every PRESENT license component is resolved AND the reviewed
 * commercial-use verdict is `true`. `code` is always present.
 *
 * Returns the list of blocking issues (empty = promotable from a license
 * standpoint). An absent component is not blocking — but the promotion
 * record must then state why the component does not apply.
 */
export function blockingLicenseIssues(profile: TechnologyProfile): string[] {
  const issues: string[] = [];
  const components: Array<[string, LicenseComponent | undefined]> = [
    ["code", profile.license.code],
    ["model", profile.license.model],
    ["dataset", profile.license.dataset],
    ["assets", profile.license.assets],
  ];
  for (const [name, component] of components) {
    if (!component) continue;
    if (component.status === "unresolved") {
      issues.push(`license.${name}: unresolved status`);
      continue;
    }
    if (component.commercialUse !== true) {
      issues.push(
        `license.${name}: commercial-use not affirmed (status ${component.status}, commercialUse ${component.commercialUse ?? "unreviewed"})`,
      );
    }
    if (!component.licenseId) {
      issues.push(`license.${name}: resolved without a license id`);
    }
  }
  return issues;
}

/**
 * The legal status-transition edges of the technology lifecycle
 * (technology-plane.md Promotion lifecycle). Promotion NEVER skips evidence
 * gates: `candidate -> benchmarked` requires a benchmark, `benchmarked ->
 * approved` requires the license/security review; `deprecated`/`rejected`
 * are reachable from any non-terminal state. Terminal here means
 * deprecated/rejected (no outgoing edges).
 */
export const TECHNOLOGY_TRANSITIONS: ReadonlyArray<readonly [TechnologyStatus, TechnologyStatus]> =
  [
    ["candidate", "benchmarked"],
    ["candidate", "rejected"],
    ["candidate", "deprecated"],
    ["benchmarked", "approved"],
    ["benchmarked", "rejected"],
    ["benchmarked", "deprecated"],
    ["approved", "canary"],
    ["approved", "rejected"],
    ["approved", "deprecated"],
    ["canary", "production"],
    ["canary", "rejected"],
    ["canary", "deprecated"],
    ["production", "deprecated"],
  ];

/** `true` when `from -> to` is a legal lifecycle edge. */
export function isLegalTechnologyTransition(from: TechnologyStatus, to: TechnologyStatus): boolean {
  return TECHNOLOGY_TRANSITIONS.some(([f, t]) => f === from && t === to);
}
