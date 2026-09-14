/**
 * Pipeline-segment validation tests (W302): every invariant violated is
 * refused LOUDLY with a MalformedSegmentError naming the field and a short
 * machine reason (the W301 validate posture).
 */
import { describe, expect, test } from "bun:test";
import { MalformedSegmentError } from "../src/errors";
import { validatePipelineSegment } from "../src/segment";
import type { PipelineSegment } from "../src/segment";
import { segment } from "./helpers";

describe("validatePipelineSegment", () => {
  test("accepts a well-formed segment", () => {
    expect(() => validatePipelineSegment(segment("k0", 0))).not.toThrow();
  });

  test("accepts zero watermark and zero byte size (boundary values)", () => {
    expect(() => validatePipelineSegment(segment("k0", 0, 0, 0))).not.toThrow();
  });

  test("refuses a non-object segment", () => {
    expect(() => validatePipelineSegment(null as unknown as PipelineSegment)).toThrow(
      MalformedSegmentError,
    );
    expect(() => validatePipelineSegment(42 as unknown as PipelineSegment)).toThrow(
      MalformedSegmentError,
    );
  });

  test("refuses an empty idempotency key", () => {
    const bad = segment("", 0);
    expect(() => validatePipelineSegment(bad)).toThrow(/idempotencyKey/);
    try {
      validatePipelineSegment(bad);
    } catch (err) {
      expect((err as MalformedSegmentError).details.reason).toBe("idempotency-key-missing");
      expect((err as MalformedSegmentError).failureClass).toBe("media-invalid");
    }
  });

  test("refuses a non-string idempotency key", () => {
    const bad = { ...segment("k0", 0), idempotencyKey: 7 as unknown as string };
    expect(() => validatePipelineSegment(bad)).toThrow(/idempotencyKey/);
  });

  test("refuses a missing watermark", () => {
    const bad = segment("k0", 0);
    delete (bad as Partial<PipelineSegment>).watermark;
    expect(() => validatePipelineSegment(bad as PipelineSegment)).toThrow(/watermark/);
  });

  test("refuses a negative watermark ms", () => {
    const bad = { ...segment("k0", 0), watermark: { watermarkMs: -1, sequence: 0 } };
    expect(() => validatePipelineSegment(bad)).toThrow(/watermarkMs/);
  });

  test("refuses a non-integer watermark sequence", () => {
    const bad = { ...segment("k0", 0), watermark: { watermarkMs: 0, sequence: 1.5 } };
    expect(() => validatePipelineSegment(bad)).toThrow(/sequence/);
    const bad2 = { ...segment("k0", 0), watermark: { watermarkMs: 0, sequence: -1 } };
    expect(() => validatePipelineSegment(bad2)).toThrow(/sequence/);
  });

  test("refuses a negative byte size", () => {
    const bad = segment("k0", 0, 0, -3);
    expect(() => validatePipelineSegment(bad)).toThrow(/byteSize/);
    expect(() => validatePipelineSegment(bad)).toThrow(MalformedSegmentError);
  });

  test("refuses a non-integer byte size", () => {
    const bad = segment("k0", 0, 0, 4.2);
    expect(() => validatePipelineSegment(bad)).toThrow(/byteSize/);
  });

  test("payload is deliberately unconstrained (vendor-neutral domain data)", () => {
    const seg: PipelineSegment = {
      idempotencyKey: "k0",
      watermark: { watermarkMs: 0, sequence: 0 },
      byteSize: 2,
      payload: { anything: true, nested: [1, 2, 3] },
    };
    expect(() => validatePipelineSegment(seg)).not.toThrow();
  });
});
