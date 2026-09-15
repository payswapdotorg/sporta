/**
 * Deterministic fixtures for the compute-adapter contract tests (W914 Wave 1).
 *
 * Everything here is constant or caller-driven: no clock, no randomness, no
 * I/O. `makeCounter` is the injected timestamp source tests pass as
 * `nowMs` (a pure closure — the reference adapter itself reads NO time
 * source).
 */
import type {
  ComputeAdapterDescriptor,
  ComputeJobCompletion,
  ComputeJobDescription,
  ComputeOutputArtifact,
} from "../src/schemas";
import { COMPUTE_SCHEMA_VERSION } from "../src/schemas";

/** A deterministic monotone timestamp source (starts at 1, steps by 1). */
export function makeCounter(start = 0): () => number {
  let t = start;
  return () => {
    t += 1;
    return t;
  };
}

/** A sha-256-shaped test id (64 lowercase hex digits — deterministic). */
export const TEST_HASH_A = "a".repeat(64);
export const TEST_HASH_B = "b".repeat(64);

/**
 * The test descriptor. `rendererId` is the REAL anime prototype's id
 * (`anime.prototype`, @sporta/renderer-anime `src/identity.ts`) and the
 * latency class list mirrors the contracts `OutputLatencyClass` enum — the
 * vocabulary-alignment tests pin both.
 */
export function makeDescriptor(
  overrides: Partial<ComputeAdapterDescriptor> = {},
): ComputeAdapterDescriptor {
  return {
    schemaVersion: COMPUTE_SCHEMA_VERSION,
    adapterId: "compute-test-0",
    adapterVersion: "0.1",
    providerKind: "in-memory",
    supportedRenderers: [{ rendererId: "anime.prototype", rendererVersions: ["0.1.0"] }],
    supportedLatencyClasses: ["offline"],
    maxConcurrentJobs: 2,
    dispatchTimeoutMs: 5_000,
    maxJobDeadlineMs: 600_000,
    costUnits: [
      { unitId: "compute-ms", unitKind: "time-ms", description: "injected-clock execution ms" },
      { unitId: "jobs", unitKind: "count" },
    ],
    ...overrides,
  };
}

/** A valid transport-safe job description (the W914 seam's happy shape). */
export function makeJob(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: COMPUTE_SCHEMA_VERSION,
    jobId: "compute-job-1",
    idempotencyKey: "render-s1-wm-1000-seq-1",
    sessionId: "s-1",
    correlationId: "corr-1",
    traceId: "trace-1",
    renderer: { rendererId: "anime.prototype", rendererVersion: "0.1.0" },
    recipe: { styleId: "default", configSchemaVersion: "1.0", config: {} },
    inputs: [
      { inputId: "snap-0", kind: "swm-snapshot", ref: "swm://s-1/0", contentHash: TEST_HASH_A },
      { inputId: "events-0", kind: "swm-event-window", ref: "swm://s-1/events?from=0&to=100" },
    ],
    outputProfile: {
      resolution: { w: 1170, h: 880 },
      frameRate: 1,
      codec: "svg",
      container: "svg",
      latencyClass: "offline",
    },
    rights: { policyRef: "policy-fixture-1", canReferenceSourceFrames: false },
    constraints: { deadlineMs: 60_000, maxAttempts: 3, priority: 0 },
    ...overrides,
  };
}

/** A valid content-addressed output artifact (inline delivery). */
export function makeArtifact(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: COMPUTE_SCHEMA_VERSION,
    artifactId: TEST_HASH_A,
    contentHash: TEST_HASH_A,
    contentType: "image/svg+xml",
    byteLength: 5,
    manifest: { format: { kind: "animated-svg", version: 1 }, segmentId: "anime-clip-test" },
    metadata: {
      sessionId: "s-1",
      renderId: "r-1",
      segmentId: "anime-clip-test",
      snapshotVersion: 0,
      frameCount: 1,
      totalDurationMs: 6_000,
    },
    delivery: { mode: "inline", content: "hello" },
    ...overrides,
  };
}

/** A structurally valid completion envelope for job `jobId` (typed loosely for overrides). */
export function makeCompletion(
  job: ComputeJobDescription,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const merged: Record<string, unknown> = {
    schemaVersion: COMPUTE_SCHEMA_VERSION,
    jobId: job.jobId,
    idempotencyKey: job.idempotencyKey,
    sessionId: job.sessionId,
    status: "succeeded",
    terminalDisposition: "succeeded",
    outputs: [makeArtifact()],
    attempts: 1,
    claims: 1,
    timing: {
      submittedAtMs: 1,
      startedAtMs: 2,
      finishedAtMs: 3,
      queueWaitMs: 1,
      executionMs: 1,
    },
    accounting: {
      consumedInputIds: job.inputs.map((input) => input.inputId),
      unconsumedInputs: [],
    },
    usage: {},
    ...overrides,
  };
  // Keep the embedded usage record consistent with the merged envelope
  // unless the test explicitly overrides the usage record itself.
  if (overrides.usage === undefined) {
    merged.usage = {
      schemaVersion: COMPUTE_SCHEMA_VERSION,
      jobId: merged.jobId,
      idempotencyKey: job.idempotencyKey,
      sessionId: job.sessionId,
      adapterId: "compute-test-0",
      providerId: "compute-test-0:memory",
      terminalDisposition: merged.terminalDisposition,
      timing: { queueWaitMs: 1, executionMs: 1 },
      attempts: 1,
      claims: 1,
      costUnits: [
        { unitId: "compute-ms", quantity: 1 },
        { unitId: "jobs", quantity: 1 },
      ],
      meteredAtMs: 3,
    };
  }
  return merged;
}

/** Type helper: narrows a successful parse's data for expect().toBe comparisons. */
export function parsedOrThrow<T>(
  result: { success: boolean; data?: T; error?: { issues: Array<{ message: string }> } },
  label: string,
): T {
  if (!result.success || result.data === undefined) {
    throw new Error(
      `${label} should parse: ${result.error?.issues.map((i) => i.message).join("; ")}`,
    );
  }
  return result.data;
}

/** Re-export for convenience so tests import one fixture module. */
export type { ComputeJobCompletion, ComputeOutputArtifact };
