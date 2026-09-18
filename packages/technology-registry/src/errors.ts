/**
 * Typed errors for `@sporta/technology-registry` (R001-R005).
 *
 * Follows the `@sporta/capability` / `@sporta/session` error conventions: a
 * classified failureClass, a structured (JSON-safe) details record, and a
 * small closed taxonomy so callers — including later waves calling the
 * resolution seam — can branch on the REFUSAL REASON instead of parsing
 * message strings. Every refusal in this package is fail-closed: the
 * registry never invents a profile, an evaluation, or a promotion from
 * broken input.
 */

/** Failure classes for the technology-registry package. */
export type TechnologyRegistryFailureClass = "validation" | "conflict" | "not-found" | "refused";

/**
 * Base of the technology-registry error family. `reasons` carries the
 * machine-readable refusal causes (e.g. the blocking license issues, the
 * missing evidence items) so tests and callers can assert on them exactly.
 */
export class TechnologyRegistryError extends Error {
  readonly failureClass: TechnologyRegistryFailureClass;
  readonly reasons: string[];
  readonly details: Record<string, unknown>;

  constructor(
    failureClass: TechnologyRegistryFailureClass,
    message: string,
    reasons: string[] = [],
    details: Record<string, unknown> = {},
    options?: { cause?: unknown },
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "TechnologyRegistryError";
    this.failureClass = failureClass;
    this.reasons = reasons;
    this.details = details;
  }
}

/**
 * A document failed its frozen `@sporta/contracts` (or fixture-set) zod
 * schema, or violated a cross-field invariant the schema cannot express.
 * The write/read is REFUSED — the registry never stores an invalid document.
 */
export class RegistryValidationError extends TechnologyRegistryError {
  constructor(message: string, reasons: string[] = [], options?: { cause?: unknown }) {
    super("validation", message, reasons, {}, options);
    this.name = "RegistryValidationError";
  }
}

/**
 * A candidate/profile/run/report/review arrived with an identity that
 * collides with a stored record under different content (immutable records
 * must not be silently overwritten).
 */
export class RegistryConflictError extends TechnologyRegistryError {
  constructor(message: string, reasons: string[] = []) {
    super("conflict", message, reasons);
    this.name = "RegistryConflictError";
  }
}

/** A required registry record (profile, run, report) does not exist. */
export class TechnologyNotFoundError extends TechnologyRegistryError {
  constructor(message: string, reasons: string[] = []) {
    super("not-found", message, reasons);
    this.name = "TechnologyNotFoundError";
  }
}

/**
 * A profile registration violates the lifecycle rules (R001): illegal
 * status transition per `isLegalTechnologyTransition`, a first profile not
 * entering as `candidate`, or an incoherent task for an already-registered
 * technology.
 */
export class IllegalProfileStatusError extends TechnologyRegistryError {
  constructor(message: string, reasons: string[] = []) {
    super("refused", message, reasons);
    this.name = "IllegalProfileStatusError";
  }
}

/**
 * A promotion was refused on lifecycle/state grounds (R005): illegal
 * transition edge, stale `fromStatus`/adapterVersion, or no registered
 * profile to promote.
 */
export class PromotionTransitionError extends TechnologyRegistryError {
  constructor(message: string, reasons: string[] = []) {
    super("refused", message, reasons);
    this.name = "PromotionTransitionError";
  }
}

/**
 * A promotion was refused because its evidence chain is incomplete or
 * incoherent (R005): missing evidence items per `missingPromotionEvidence`,
 * unknown evaluation report / benchmark runs, runs not cited by the report,
 * or runs that do not share the promoted technology identity.
 */
export class PromotionEvidenceError extends TechnologyRegistryError {
  constructor(message: string, reasons: string[] = []) {
    super("refused", message, reasons);
    this.name = "PromotionEvidenceError";
  }
}

/**
 * The R004 fail-closed license gate refused the promotion:
 * `blockingLicenseIssues(profile)` is non-empty (unresolved or
 * non-commercial-use-affirmed license components), so the technology may
 * not move toward approved/canary/production.
 */
export class PromotionLicenseError extends TechnologyRegistryError {
  constructor(message: string, reasons: string[] = []) {
    super("refused", message, reasons);
    this.name = "PromotionLicenseError";
  }
}

/**
 * An evaluation-runner input or outcome was invalid (R003): inconsistent
 * metric keys across fixtures, non-finite numbers, failures without
 * examples, or an incoherent evaluation report (mixed fixture-set
 * versions, promote recommendation without a candidate, ...).
 */
export class EvaluationValidationError extends TechnologyRegistryError {
  constructor(message: string, reasons: string[] = []) {
    super("validation", message, reasons);
    this.name = "EvaluationValidationError";
  }
}
