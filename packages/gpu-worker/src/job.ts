/**
 * The GPU job envelope (W303) — the unit of work the protocol carries.
 *
 * A job is domain-agnostic BY DESIGN (vendor neutrality,
 * architecture-lock §9: no core contract hard-codes a GPU or model
 * provider): `payloadRef` is an OPAQUE descriptor the executor seam
 * interprets (a fixture reads a table; a real deployment resolves a
 * reference to model inputs). The protocol itself only understands the
 * fields it must account for:
 *
 * - `jobId` — the per-job identity (caller-authored, unique per
 *   dispatcher — a NEW key re-using an admitted job's id refuses loudly
 *   as a collision; re-submitting a KNOWN key is a counted duplicate
 *   FIRST, even with the same jobId — an idempotent submit retry is never
 *   a collision);
 * - `idempotencyKey` — the streaming-contract Recovery rule
 *   ("Duplicate messages are tolerated through idempotency keys",
 *   docs/contracts/streaming.md): a known key is NEVER double-claimed —
 *   while its job is in flight a re-submission counts a duplicate and is
 *   skipped; after a terminal disposition the same (exactly-once claim,
 *   at-least-once execution — lease recovery can re-acquire);
 * - `kind` — the job's work class (routing/telemetry; abstract, not
 *   GPU-specific);
 * - `priority` — scheduling order (higher value = claimed earlier;
 *   ties break by submission order — deterministic);
 * - `requirements` — declared resource needs for worker matching
 *   (advisory metadata, see PROTOCOL.md §6);
 * - `deadlineMs` — the whole-job time budget from submission, enforced on
 *   the injected clock (timeouts classified, never silent);
 * - `maxAttempts` — the CLAIM budget (lease epochs; requeue bound) with
 *   the dispatcher default applying when absent.
 *
 * Validation is fail-loud (`MalformedJobError`, the W302
 * `validatePipelineSegment` posture): a malformed envelope refuses at
 * `submit()` — counted, logged, metered — and the dispatcher continues
 * (one corrupt job never kills a live dispatch session).
 */
import { MalformedJobError } from "./errors";

/** Declared resource requirements of one job (advisory, abstract). */
export interface GpuJobRequirements {
  /** Minimum declared worker memory, in MB (finite >= 0). */
  memoryMb?: number;
  /** Required abstract model class (non-empty; absent = any worker). */
  modelClass?: string;
}

/** One unit of GPU-worker work. */
export interface GpuJobEnvelope {
  /** Per-job identity (caller-authored, non-empty, unique per dispatcher). */
  jobId: string;
  /** Dedupe/claim-once identity (non-empty; the Recovery-rule key). */
  idempotencyKey: string;
  /** The job's work class (non-empty; abstract routing key). */
  kind: string;
  /** Opaque payload descriptor the executor seam interprets (non-empty). */
  payloadRef: string;
  /** Scheduling priority (integer; higher = claimed earlier; default 0). */
  priority: number;
  /** Declared resource requirements (optional). */
  requirements?: GpuJobRequirements;
  /**
   * Whole-job time budget in milliseconds from submission (finite > 0).
   * Enforced on the injected clock: queued, in-flight, and reported-late
   * breaches all classify as `deadline-timeout`.
   */
  deadlineMs: number;
  /**
   * Claim budget — the maximum number of lease epochs (claims) the job may
   * consume (integer >= 1; dispatcher default applies when absent). Lease
   * expiry requeues while claims remain; exhaustion dead-letters.
   */
  maxAttempts?: number;
}

/**
 * Structural validation of one job envelope (hand-written fail-loud checks,
 * the W302 posture — this package adds no schema dependency). Throws
 * `MalformedJobError` naming the exact field; returns void when the
 * envelope satisfies the invariants.
 */
export function validateJobEnvelope(job: GpuJobEnvelope): void {
  if (job === null || typeof job !== "object") {
    throw new MalformedJobError("job must be an object", { reason: "job-not-object" });
  }
  for (const field of ["jobId", "idempotencyKey", "kind", "payloadRef"] as const) {
    const value = job[field];
    if (typeof value !== "string" || value.length < 1) {
      throw new MalformedJobError(
        `job.${field} must be a non-empty string (got ${String(value)})`,
        { reason: "job-field-missing", field },
      );
    }
  }
  if (!Number.isInteger(job.priority)) {
    throw new MalformedJobError(`job.priority must be an integer (got ${String(job.priority)})`, {
      reason: "priority-invalid",
      field: "priority",
    });
  }
  if (!Number.isFinite(job.deadlineMs) || job.deadlineMs <= 0) {
    throw new MalformedJobError(
      `job.deadlineMs must be a finite number > 0 (got ${String(job.deadlineMs)})`,
      { reason: "deadline-invalid", field: "deadlineMs" },
    );
  }
  if (
    job.maxAttempts !== undefined &&
    (!Number.isInteger(job.maxAttempts) || job.maxAttempts < 1)
  ) {
    throw new MalformedJobError(
      `job.maxAttempts must be an integer >= 1 when given (got ${String(job.maxAttempts)})`,
      { reason: "max-attempts-invalid", field: "maxAttempts" },
    );
  }
  const requirements = job.requirements;
  if (requirements !== undefined) {
    if (requirements === null || typeof requirements !== "object") {
      throw new MalformedJobError("job.requirements must be an object when given", {
        reason: "requirements-invalid",
        field: "requirements",
      });
    }
    if (
      requirements.memoryMb !== undefined &&
      (!Number.isFinite(requirements.memoryMb) || (requirements.memoryMb as number) < 0)
    ) {
      throw new MalformedJobError(
        `job.requirements.memoryMb must be a finite number >= 0 when given ` +
          `(got ${String(requirements.memoryMb)})`,
        { reason: "requirements-memory-invalid", field: "requirements.memoryMb" },
      );
    }
    if (
      requirements.modelClass !== undefined &&
      (typeof requirements.modelClass !== "string" ||
        (requirements.modelClass as string).length < 1)
    ) {
      throw new MalformedJobError(
        `job.requirements.modelClass must be a non-empty string when given ` +
          `(got ${String(requirements.modelClass)})`,
        { reason: "requirements-model-class-invalid", field: "requirements.modelClass" },
      );
    }
  }
}
