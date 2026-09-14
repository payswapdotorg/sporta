/**
 * Fail-loud validation tests (W503): every malformed manifest shape aborts
 * the evaluation with a structured `TemporalEvaluationError` carrying the
 * JSON path — never a silent skip, never a guessed repair.
 */
import { describe, expect, test } from "bun:test";
import type { AnimeClipManifest } from "@sporta/renderer-anime";
import { measureIdentityFlicker } from "../src/identity";
import { measureGeometryDrift } from "../src/drift";
import { measureTemporalArtifacts } from "../src/artifacts";
import { TemporalEvaluationError, renderW503CleanFixture, validateManifest } from "../src/index";

/** The clean manifest to perturb (deep-cloned per case). */
function cleanManifest(): AnimeClipManifest {
  return structuredClone(renderW503CleanFixture().manifest);
}

/** Expects validateManifest to throw with code + path prefix. */
function expectMalformed(mutate: (manifest: AnimeClipManifest) => void, path: string): void {
  const manifest = cleanManifest();
  mutate(manifest);
  try {
    validateManifest(manifest);
    expect.unreachable();
  } catch (error) {
    expect(error).toBeInstanceOf(TemporalEvaluationError);
    const typed = error as TemporalEvaluationError;
    expect(typed.code).toBe("manifest-malformed");
    expect(typed.path.startsWith(path)).toBe(true);
    expect(typed.message).toContain("temporal evaluation");
  }
}

describe("validateManifest — well-formed input", () => {
  test("the clean W502 fixture manifest validates without throwing", () => {
    expect(() => validateManifest(renderW503CleanFixture().manifest)).not.toThrow();
  });
});

describe("validateManifest — top-level malformation", () => {
  test("missing frames", () => {
    expectMalformed((m) => delete (m as unknown as Record<string, unknown>).frames, "$.frames");
  });

  test("empty frames array", () => {
    expectMalformed((m) => (m.frames = []), "$.frames");
  });

  test("missing output", () => {
    expectMalformed((m) => delete (m as unknown as Record<string, unknown>).output, "$.output");
  });

  test("non-positive frame interval", () => {
    expectMalformed((m) => (m.output.frameIntervalMs = 0), "$.output.frameIntervalMs");
  });

  test("missing watermarkAfter", () => {
    expectMalformed(
      (m) => delete (m as unknown as Record<string, unknown>).watermarkAfter,
      "$.watermarkAfter",
    );
  });

  test("malformed skippedEvents reason", () => {
    expectMalformed((m) => {
      (m.skippedEvents as unknown[]).push({
        sequence: 99,
        eventId: "fe-x",
        eventTimeMs: 1,
        reason: "mid-window",
      });
    }, "$.skippedEvents[0].reason");
  });

  test("degradation reasons not an array", () => {
    expectMalformed(
      (m) => (m.degradation.reasons = "none" as unknown as string[]),
      "$.degradation.reasons",
    );
  });
});

describe("validateManifest — frame-level malformation", () => {
  test("frameIndex does not match the array position", () => {
    expectMalformed((m) => (m.frames[2]!.frameIndex = 7), "$.frames[2].frameIndex");
  });

  test("non-monotone frame timestamps (fail-loud, no re-sort)", () => {
    expectMalformed(
      (m) => (m.frames[3]!.outputTimestampMs = 2_500),
      "$.frames[3].outputTimestampMs",
    );
  });

  test("equal frame timestamps are also rejected", () => {
    expectMalformed(
      (m) => (m.frames[3]!.outputTimestampMs = 3_000),
      "$.frames[3].outputTimestampMs",
    );
  });

  test("missing windowMs", () => {
    expectMalformed(
      (m) => delete (m.frames[2] as unknown as Record<string, unknown>).windowMs,
      "$.frames[2].windowMs",
    );
  });

  test("non-finite window bound", () => {
    expectMalformed(
      (m) => (m.frames[2]!.windowMs.endMs = Number.POSITIVE_INFINITY),
      "$.frames[2].windowMs.endMs",
    );
  });

  test("missing appliedEventSequences", () => {
    expectMalformed(
      (m) => delete (m.frames[2] as unknown as Record<string, unknown>).appliedEventSequences,
      "$.frames[2].appliedEventSequences",
    );
  });

  test("non-integer applied sequence", () => {
    expectMalformed(
      (m) => (m.frames[0]!.appliedEventSequences = [11.5]),
      "$.frames[0].appliedEventSequences[0]",
    );
  });

  test("missing source watermark", () => {
    expectMalformed(
      (m) => delete (m.frames[2]!.source as unknown as Record<string, unknown>).watermark,
      "$.frames[2].source.watermark",
    );
  });
});

describe("validateManifest — entity-level malformation", () => {
  test("missing entities array", () => {
    expectMalformed(
      (m) => delete (m.frames[2] as unknown as Record<string, unknown>).entities,
      "$.frames[2].entities",
    );
  });

  test("unknown disposition value", () => {
    expectMalformed(
      (m) => (m.frames[0]!.entities[0]!.disposition = "sort-of-drawn" as never),
      "$.frames[0].entities[0].disposition",
    );
  });

  test("unknown entity kind", () => {
    expectMalformed(
      (m) => (m.frames[0]!.entities[0]!.kind = "npc" as never),
      "$.frames[0].entities[0].kind",
    );
  });

  test("non-finite positionMeters", () => {
    expectMalformed(
      (m) => (m.frames[0]!.entities[0]!.positionMeters = { x: Number.NaN, y: 34 }),
      "$.frames[0].entities[0].positionMeters.x",
    );
  });

  test("malformed style token (missing jersey)", () => {
    expectMalformed(
      (m) => delete (m.frames[0]!.entities[0]!.style as unknown as Record<string, unknown>).jersey,
      "$.frames[0].entities[0].style.jersey",
    );
  });

  test("confidence out of range", () => {
    expectMalformed(
      (m) => (m.frames[0]!.entities[6]!.confidence = 1.5),
      "$.frames[0].entities[6].confidence",
    );
  });

  test("duplicate entity entry within one frame", () => {
    expectMalformed(
      (m) => m.frames[0]!.entities.push(structuredClone(m.frames[0]!.entities[0]!)),
      "$.frames[0].entities[7]",
    );
  });

  test("empty entityId", () => {
    expectMalformed(
      (m) => (m.frames[0]!.entities[0]!.entityId = ""),
      "$.frames[0].entities[0].entityId",
    );
  });
});

describe("validateManifest — caption/possession malformation", () => {
  test("missing captions", () => {
    expectMalformed(
      (m) => delete (m.frames[2] as unknown as Record<string, unknown>).captions,
      "$.frames[2].captions",
    );
  });

  test("score object without status", () => {
    expectMalformed(
      (m) => delete (m.frames[0]!.captions.score as unknown as Record<string, unknown>).status,
      "$.frames[0].captions.score.status",
    );
  });

  test("caption event without phrase", () => {
    expectMalformed(
      (m) => delete (m.frames[0]!.captions.events[0] as unknown as Record<string, unknown>).phrase,
      "$.frames[0].captions.events[0].phrase",
    );
  });

  test("possession without displayed", () => {
    expectMalformed(
      (m) => delete (m.frames[0]!.possession as unknown as Record<string, unknown>).displayed,
      "$.frames[0].possession.displayed",
    );
  });
});

describe("validateManifest — the measurement core refuses malformed input", () => {
  test("measureIdentityFlicker validates first (fail-loud)", () => {
    const manifest = cleanManifest();
    manifest.frames[2]!.frameIndex = 9;
    expect(() => measureIdentityFlicker(manifest)).toThrow(TemporalEvaluationError);
  });

  test("measureGeometryDrift validates first (fail-loud)", () => {
    const manifest = cleanManifest();
    manifest.frames[2]!.frameIndex = 9;
    expect(() => measureGeometryDrift(manifest)).toThrow(TemporalEvaluationError);
  });

  test("measureTemporalArtifacts validates first (fail-loud)", () => {
    const manifest = cleanManifest();
    manifest.frames[2]!.frameIndex = 9;
    expect(() => measureTemporalArtifacts(manifest)).toThrow(TemporalEvaluationError);
  });
});
