/**
 * Job envelope validation tests (W303): the W302 `validatePipelineSegment`
 * posture — hand-written structural checks, fail-loud with a short machine
 * reason on the error details; malformed envelopes never pass the boundary.
 */
import { describe, expect, test } from "bun:test";
import { MalformedJobError } from "../src/errors";
import { validateJobEnvelope } from "../src/job";
import { job, requirements } from "./helpers";

describe("validateJobEnvelope", () => {
  test("accepts a fully-specified valid envelope", () => {
    expect(() => validateJobEnvelope(job("j1"))).not.toThrow();
  });

  test("accepts an envelope with requirements and a claim budget", () => {
    expect(() =>
      validateJobEnvelope(job("j1", { requirements: requirements(), maxAttempts: 5 })),
    ).not.toThrow();
  });

  test("refuses a non-object envelope", () => {
    for (const bad of [null, undefined, 42, "job"]) {
      expect(() => validateJobEnvelope(bad as never)).toThrow(MalformedJobError);
    }
    expect(() => validateJobEnvelope(null as never)).toThrow(/job must be an object/);
  });

  test.each(["jobId", "idempotencyKey", "kind", "payloadRef"] as const)(
    "refuses a missing or empty %s",
    (field) => {
      const envelope = job("j1");
      (envelope as unknown as Record<string, unknown>)[field] = "";
      const err = capture(() => validateJobEnvelope(envelope));
      expect(err?.details.field).toBe(field);
      expect(err?.details.reason).toBe("job-field-missing");
      expect(err?.message).toContain(field);
    },
  );

  test("refuses non-string identity fields", () => {
    for (const field of ["jobId", "idempotencyKey", "kind", "payloadRef"] as const) {
      const envelope = job("j1");
      (envelope as unknown as Record<string, unknown>)[field] = 7;
      expect(() => validateJobEnvelope(envelope)).toThrow(MalformedJobError);
    }
  });

  test("refuses a non-integer priority", () => {
    for (const bad of [0.5, Number.NaN, "high"]) {
      const err = capture(() => validateJobEnvelope(job("j1", { priority: bad as number })));
      expect(err?.details.reason).toBe("priority-invalid");
    }
    // Negative priorities are legal (scheduling order, not a budget).
    expect(() => validateJobEnvelope(job("j1", { priority: -3 }))).not.toThrow();
  });

  test("refuses a zero, negative, or non-finite deadline", () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const err = capture(() => validateJobEnvelope(job("j1", { deadlineMs: bad })));
      expect(err?.details.reason).toBe("deadline-invalid");
      expect(err?.details.field).toBe("deadlineMs");
    }
  });

  test("refuses a zero, fractional, or non-integer claim budget", () => {
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      const err = capture(() => validateJobEnvelope(job("j1", { maxAttempts: bad })));
      expect(err?.details.reason).toBe("max-attempts-invalid");
    }
  });

  test("refuses a non-object requirements field", () => {
    const err = capture(() => validateJobEnvelope(job("j1", { requirements: "big" as never })));
    expect(err?.details.reason).toBe("requirements-invalid");
  });

  test("refuses invalid requirement memory", () => {
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const err = capture(() =>
        validateJobEnvelope(job("j1", { requirements: { memoryMb: bad, modelClass: "encode" } })),
      );
      expect(err?.details.reason).toBe("requirements-memory-invalid");
      expect(err?.details.field).toBe("requirements.memoryMb");
    }
  });

  test("refuses an empty or non-string requirement model class", () => {
    for (const bad of ["", 5]) {
      const err = capture(() =>
        validateJobEnvelope(
          job("j1", { requirements: { memoryMb: 1_024, modelClass: bad as string } }),
        ),
      );
      expect(err?.details.reason).toBe("requirements-model-class-invalid");
    }
  });

  test("the error carries the contracts failure classification", () => {
    const err = capture(() => validateJobEnvelope({ ...job("j1"), deadlineMs: 0 }));
    expect(err).toBeInstanceOf(MalformedJobError);
    expect(err?.terminalFailureClass).toBe("media-invalid");
    expect(err?.failureClass).toBe("media-invalid");
    expect(err?.name).toBe("MalformedJobError");
  });
});

/** Runs `fn` and returns the thrown MalformedJobError (or undefined). */
function capture(fn: () => void): MalformedJobError | undefined {
  try {
    fn();
  } catch (err) {
    if (err instanceof MalformedJobError) return err;
    throw err;
  }
  throw new Error("expected validateJobEnvelope to throw");
}
