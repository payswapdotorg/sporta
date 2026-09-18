/**
 * Typed perception-adapter errors (R201), in the style of the W203
 * field-mapping error module: every deliberate, classified refusal in the
 * perception-adapter plane throws one of these (never a bare `Error`), each
 * carrying a structured, JSON-safe `details` object for logs and metrics
 * labels.
 *
 * The headline failure class of the whole plane is the fail-closed
 * BINDING refusal: a candidate whose {@link PerceptionAdapterDescriptor}
 * mismatches the frozen `PERCEPTION_TASK_BINDINGS` table (or claims the
 * wrong family task) is refused at CONSTRUCTION — before any evaluation —
 * so an incoherent technology can never silently run (R201's fail-closed
 * technology neutrality).
 */
import {
  SCHEMA_VERSION,
  PerceptionAdapterDescriptor,
  perceptionBindingIssues,
  type PerceptionTaskKind,
} from "@sporta/contracts";

/** Structured, JSON-safe details carried on every perception-adapter error. */
export type PerceptionAdapterErrorDetails = Record<string, unknown>;

/** Base of all typed perception-adapter errors: message + structured details. */
export class PerceptionAdapterError extends Error {
  readonly details: PerceptionAdapterErrorDetails;

  constructor(message: string, details: PerceptionAdapterErrorDetails = {}) {
    super(message);
    this.name = "PerceptionAdapterError";
    this.details = details;
  }
}

/**
 * A descriptor failed schema validation or the frozen task->contract binding
 * table (R201 fail-closed registration): malformed descriptor, contract
 * reference mismatch, or a family task mismatch. `details` carries the
 * offending descriptor and the concrete issues.
 */
export class AdapterBindingError extends PerceptionAdapterError {
  constructor(message: string, details: PerceptionAdapterErrorDetails = {}) {
    super(message, details);
    this.name = "AdapterBindingError";
  }
}

/**
 * Input handed to an adapter violates the family input contract (malformed
 * frame sequence, unordered frames, degenerate correspondence input, …).
 * Media-derived input is UNTRUSTED (architecture-lock §13): adapters fail
 * loudly and typed, never silently degrade.
 */
export class InvalidAdapterInputError extends PerceptionAdapterError {
  constructor(message: string, details: PerceptionAdapterErrorDetails = {}) {
    super(message, details);
    this.name = "InvalidAdapterInputError";
  }
}

/**
 * A documented failure class of a specific candidate surfaced at runtime
 * (e.g. the model-backed detector's weights-unavailable refusal, or a
 * calibrator's degenerate-geometry refusal). Carries the failing
 * `failureClassId` so the caller can map the refusal onto the candidate's
 * declared failure classes.
 */
export class CandidateFailureError extends PerceptionAdapterError {
  constructor(
    message: string,
    details: PerceptionAdapterErrorDetails & { failureClassId: string },
  ) {
    super(message, details);
    this.name = "CandidateFailureError";
  }
}

/** Union of the typed perception-adapter errors. */
export type PerceptionAdapterErrorUnion =
  AdapterBindingError | InvalidAdapterInputError | CandidateFailureError;

/**
 * Type guard: `true` when `value` is one of the typed perception-adapter
 * errors (a deliberate, classified refusal rather than an internal fault).
 */
export function isPerceptionAdapterError(value: unknown): value is PerceptionAdapterErrorUnion {
  return value instanceof PerceptionAdapterError;
}

// ---------------------------------------------------------------------------
// Fail-closed descriptor validation (shared by every family)
// ---------------------------------------------------------------------------

/**
 * Validates a descriptor for construction and returns it typed.
 *
 * Fail-closed on THREE axes (in order):
 *
 * 1. SHAPE — the descriptor must parse against the frozen zod
 *    {@link PerceptionAdapterDescriptor} schema (a malformed descriptor is a
 *    registration bug, not a runtime condition);
 * 2. BINDING — `perceptionBindingIssues(descriptor)` must be empty: the
 *    declared input/output contract references must match the frozen
 *    `PERCEPTION_TASK_BINDINGS` table for the declared task EXACTLY;
 * 3. FAMILY — when `expectedTask` is given (every shipped adapter passes its
 *    family task), the declared task must equal it — a
 *    `PlayerDetectionAdapter` implementation may not register under
 *    `perception.ball-detection`.
 *
 * Any violation throws {@link AdapterBindingError} with all concrete issues
 * in `details.issues` — construction-time, BEFORE any evaluation.
 */
export function assertDescriptorBinding(
  descriptor: PerceptionAdapterDescriptor,
  expectedTask?: PerceptionTaskKind,
): PerceptionAdapterDescriptor {
  const issues: string[] = [];
  const shape = PerceptionAdapterDescriptor.safeParse(descriptor);
  if (!shape.success) {
    issues.push(
      ...shape.error.issues.map((issue) => `descriptor.${issue.path.join(".")}: ${issue.message}`),
    );
  } else {
    issues.push(...perceptionBindingIssues(shape.data));
    if (expectedTask !== undefined && shape.data.task !== expectedTask) {
      issues.push(`task ${shape.data.task} does not match the family task ${expectedTask}`);
    }
  }
  if (issues.length > 0) {
    throw new AdapterBindingError(
      `perception adapter descriptor refused at construction: ${issues.join("; ")}`,
      { descriptor, issues, expectedTask },
    );
  }
  return descriptor;
}

/**
 * Builds a frozen-conforming descriptor from identity + task: stamps the
 * current contracts `SCHEMA_VERSION` and the `"perception"` adapter kind,
 * then re-validates through {@link assertDescriptorBinding} (the frozen
 * binding table fills nothing — the caller declares the contracts, the
 * table merely verifies them).
 */
export function perceptionDescriptor(input: {
  technologyId: string;
  technologyVersion: string;
  adapterVersion: string;
  task: PerceptionTaskKind;
  inputContract: string;
  outputContract: string;
}): PerceptionAdapterDescriptor {
  return assertDescriptorBinding({
    schemaVersion: SCHEMA_VERSION,
    adapterKind: "perception",
    technologyId: input.technologyId,
    technologyVersion: input.technologyVersion,
    adapterVersion: input.adapterVersion,
    task: input.task,
    inputContract: input.inputContract,
    outputContract: input.outputContract,
  });
}
