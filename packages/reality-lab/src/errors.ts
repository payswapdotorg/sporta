/**
 * Typed reality-lab errors (REL-001..004), following `@sporta/identity`'s and
 * `@sporta/organization-registry`'s errors.ts conventions: a classified
 * `failureClass` and structured JSON-safe details.
 *
 * Scope discipline (mirrors the registry package): these are
 * CONTRACT-BOUNDARY errors only — a malformed Agent Body definition, an
 * Agent Organization definition that violates its graph invariants, or a
 * caller error at the lab-run boundary. The lab's EVALUATIVE decisions are
 * NEVER thrown: hard invalidity gates and evaluator results are TYPED
 * REFUSAL RECORDS (`HardInvalidityViolation`, `LabEvaluatorResult`) because
 * a refusal is evidence a run must be able to record, not an exceptional
 * control-flow event.
 */

/** Failure classification for lab rejections. */
export type LabFailureClass = "validation" | "not-found" | "conflict" | "internal";

/** The base of the reality-lab error family. */
export class LabApiError extends Error {
  readonly failureClass: LabFailureClass;
  readonly details: Record<string, unknown>;

  constructor(
    failureClass: LabFailureClass,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "LabApiError";
    this.failureClass = failureClass;
    this.details = details;
  }
}

/** Malformed caller input at a lab boundary (issue list attached). */
export class LabValidationError extends LabApiError {
  constructor(message: string, issues: readonly unknown[] = []) {
    super("validation", message, { issues });
    this.name = "LabValidationError";
  }
}

/** Unknown reference (body, organization, runtime, run id). */
export class LabNotFoundError extends LabApiError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super("not-found", message, details);
    this.name = "LabNotFoundError";
  }
}

/** A uniqueness/consistency conflict at a lab boundary. */
export class LabConflictError extends LabApiError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super("conflict", message, details);
    this.name = "LabConflictError";
  }
}

/** An unexpected internal lab fault. */
export class LabInternalError extends LabApiError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super("internal", message, details);
    this.name = "LabInternalError";
  }
}

/**
 * An Agent Body definition that violates the frozen body contract
 * (docs/contracts/agent-body-and-organization.md §Agent Body). The error is
 * COLLECTIVE: every missing required field and every malformed field is
 * reported in one throw — the caller fixes the whole definition, not one
 * field per round trip.
 */
export class BodyContractError extends LabValidationError {
  constructor(
    message: string,
    issues: readonly unknown[],
    readonly missingFields: readonly string[],
    readonly invalidFields: readonly string[],
  ) {
    super(message, [
      ...issues,
      { missingFields: [...missingFields], invalidFields: [...invalidFields] },
    ]);
    this.name = "BodyContractError";
  }
}

/** One violated Agent Organization graph invariant, in words. */
export interface OrganizationInvariantViolation {
  code:
    | "not-versioned"
    | "duplicate-node"
    | "duplicate-stage"
    | "duplicate-edge"
    | "unknown-edge-endpoint"
    | "unknown-stage"
    | "node-multi-stage"
    | "unassigned-node"
    | "missing-node-budget"
    | "unknown-capability-node"
    | "unknown-body"
    | "delegation-cycle"
    | "missing-termination";
  message: string;
  nodeId?: string;
  edgeId?: string;
  stageId?: string;
  capabilityId?: string;
}

/**
 * An Agent Organization definition that violates its graph invariants
 * (versioned, edges resolve, delegation acyclic, budgets present, ...).
 * Like `BodyContractError` it is collective — all violations are reported.
 */
export class OrganizationContractError extends LabValidationError {
  constructor(
    message: string,
    readonly violations: readonly OrganizationInvariantViolation[],
  ) {
    super(message, violations);
    this.name = "OrganizationContractError";
  }
}

/** Union of the typed lab errors. */
export type LabError =
  | LabApiError
  | LabValidationError
  | LabNotFoundError
  | LabConflictError
  | LabInternalError
  | BodyContractError
  | OrganizationContractError;

/** Type guard: `true` when `value` is a typed lab error. */
export function isLabError(value: unknown): value is LabApiError {
  return value instanceof LabApiError;
}
