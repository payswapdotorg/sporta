/**
 * Hosted compute budgets (W914 Wave 2): the fail-closed bounds the hosted
 * worker enforces on every executed job — duration and size — with the
 * documented Vercel Hobby deployment limits they derive from.
 *
 * Fail-closed means: a job whose measured execution exceeds the duration
 * budget, or whose encoded artifact exceeds the size budget, NEVER hands its
 * outputs back — the outputs are discarded and the job resolves `failed`
 * with the `timeout` / non-retryable class (see ./executor.ts). The bounds
 * are enforced by MEASUREMENT against the injected clock, never trusted from
 * a provider's self-report.
 *
 * ## Documented platform limits (Vercel Hobby — the Wave-2 deployment target)
 *
 * - Function execution duration: Hobby default 10 s per invocation
 *   (configurable up to 60 s; Fluid Compute extends this but 10 s is the
 *   fail-closed default this package ships).
 * - Request/response body size: 4.5 MB per request on serverless
 *   functions; the artifact budget below stays comfortably inside it so one
 *   completion envelope (inline content mode) fits a single response.
 *
 * KNOWN LIMITATION (honest boundary): these are the LOCAL/self-hosted
 * defaults; the deployed-Vercel validation wave (later) may tighten them
 * per-region. Local-real-HTTP is this flight's evidence boundary.
 */

/** The fail-closed execution budgets of the hosted compute worker. */
export interface HostedComputeBudgets {
  /** Maximum measured render+encode execution per job, in ms (fail-closed). */
  maxExecutionMs: number;
  /** Maximum encoded artifact byte length per segment (fail-closed). */
  maxArtifactBytes: number;
  /** Largest whole-job deadline the worker's adapter accepts (ms). */
  maxJobDeadlineMs: number;
  /** Smallest whole-job deadline the worker's adapter accepts (ms). */
  minJobDeadlineMs: number;
  /** How long one dispatch handoff may take before it fails (ms). */
  dispatchTimeoutMs: number;
  /** Maximum simultaneously executing jobs (integer >= 1). */
  maxConcurrentJobs: number;
}

/**
 * Default budgets, derived from the documented Vercel Hobby limits:
 * execution 10 000 ms (the Hobby per-invocation default), artifacts 1 MB
 * (comfortably under the 4.5 MB request/response body limit), whole-job
 * deadline 60 000 ms (the W304 `renderDeadlineMs` default magnitude), and
 * one-at-a-time handoffs per dispatch.
 */
export const DEFAULT_HOSTED_COMPUTE_BUDGETS: HostedComputeBudgets = Object.freeze({
  maxExecutionMs: 10_000,
  maxArtifactBytes: 1_000_000,
  maxJobDeadlineMs: 60_000,
  minJobDeadlineMs: 1_000,
  dispatchTimeoutMs: 5_000,
  maxConcurrentJobs: 4,
});

/** Resolves caller-supplied partial budgets over the defaults. */
export function resolveHostedComputeBudgets(
  overrides?: Partial<HostedComputeBudgets>,
): HostedComputeBudgets {
  return { ...DEFAULT_HOSTED_COMPUTE_BUDGETS, ...overrides };
}
