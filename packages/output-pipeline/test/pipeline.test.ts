/**
 * W504 output-pipeline tests: the ENCODE → STORE → LOCATE composition over
 * the real encoder + both store layers, driven by the canonical fixture
 * clip. Pins: golden-path id agreement (segment contentHash = artifact id =
 * sha-256), idempotent double-store on BOTH layers, the conflict path
 * leaving no artifact behind, W502 `anime://` ref resolution (including the
 * honest-absence and rights-denial paths), stats, and determinism.
 */
import { describe, expect, test } from "bun:test";
import { renderAnimeClip } from "@sporta/renderer-anime";
import { TEST_EPOCH_MS } from "@sporta/testing";
import {
  InMemoryArtifactStore,
  InMemoryRenderSegmentStore,
  PlaybackRightsDeniedError,
  SegmentConflictError,
  SegmentValidationError,
  createAnimeOutputPipeline,
  encodeAnimeClip,
  parseAnimeArtifactRef,
} from "../src/index";
import type { AnimeOutputPipeline, PipelineStoreInput } from "../src/index";
import {
  RENDER_ID,
  SESSION_ID,
  analysisTransformationPolicy,
  buildClipRequest,
  buildFixtureOutput,
  buildFixtureSteps,
  expiredPolicy,
  fullAllowPolicy,
} from "./helpers";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/** The canonical pipeline input (the W502 fixture clip render). */
function fixtureInput(): PipelineStoreInput {
  return { sessionId: SESSION_ID, renderId: RENDER_ID, output: buildFixtureOutput() };
}

/** A conflicting input: same scope, different frame content (player-7 +5m). */
function conflictingInput(): PipelineStoreInput {
  const shiftedSteps = buildFixtureSteps().map((step) => {
    const clone = structuredClone(step);
    const player7 = clone.snapshot.entities[0]!;
    const slot = player7.state.pitchPosition!;
    slot.value = { x: (slot.value as { x: number; y: number }).x + 5, y: 34 };
    return clone;
  });
  return {
    sessionId: SESSION_ID,
    renderId: RENDER_ID,
    output: renderAnimeClip(buildClipRequest(), shiftedSteps),
  };
}

/** A rights context with full-allow at the test epoch. */
const ALLOW = { policy: fullAllowPolicy, nowMs: TEST_EPOCH_MS } as const;

// ---------------------------------------------------------------------------
// parseAnimeArtifactRef unit pins
// ---------------------------------------------------------------------------

describe("parseAnimeArtifactRef (W502 ref → structured)", () => {
  test("parses a well-formed ref verbatim", () => {
    const parsed = parseAnimeArtifactRef("anime://sess-1/12/3");
    expect(parsed.kind).toBe("ok");
    if (parsed.kind === "ok") {
      expect(parsed.ref).toEqual({
        ref: "anime://sess-1/12/3",
        sessionId: "sess-1",
        snapshotVersion: 12,
        frameIndex: 3,
      });
    }
  });

  test("rejects malformed refs with reasons", () => {
    for (const [ref, reason] of [
      ["", "non-empty"],
      ["testcard://sess/1/0", "must start"],
      ["anime://sess-1/1", "exactly 3"],
      ["anime://sess-1/1/2/3", "exactly 3"],
      ["anime://sess-1/x/0", "snapshotVersion"],
      ["anime://sess-1/1/-1", "frameIndex"],
      ["anime:///1/0", "sessionId segment is empty"],
    ] as const) {
      const parsed = parseAnimeArtifactRef(ref);
      expect(parsed.kind).toBe("invalid");
      if (parsed.kind === "invalid") {
        expect(parsed.reason).toContain(reason);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// encodeAndStore (the encode → store composition)
// ---------------------------------------------------------------------------

describe("encodeAndStore — golden path", () => {
  test("stores BOTH layers with agreeing ids (segment contentHash = artifact id = sha-256)", () => {
    const pipeline = createAnimeOutputPipeline();
    const result = pipeline.encodeAndStore(fixtureInput());
    expect(result.outcome).toBe("stored");
    expect(result.artifactOutcome).toBe("stored");
    expect(result.sessionId).toBe(SESSION_ID);
    expect(result.renderId).toBe(RENDER_ID);
    const segment = encodeAnimeClip(fixtureInput().output);
    expect(result.segmentId).toBe(segment.segmentId);
    expect(result.artifactId).toBe(segment.contentHash);
    expect(result.artifactId).toMatch(/^[0-9a-f]{64}$/);
    expect(result.byteLength).toBe(segment.byteLength);
    expect(result.frameCount).toBe(6);
    // The segment store serves it under the scope…
    const record = pipeline.getSegment({
      sessionId: SESSION_ID,
      renderId: RENDER_ID,
      segmentId: segment.segmentId,
      ...ALLOW,
    });
    expect(record).not.toBeNull();
    expect(record!.content).toBe(segment.content);
    expect(record!.contentHash).toBe(result.artifactId);
    // …and the artifact store serves the same bytes by content id.
    const artifact = pipeline.artifactStore.getArtifact(result.artifactId);
    expect(artifact).not.toBeNull();
    expect(artifact!.content).toBe(segment.content);
    expect(artifact!.metadata).toEqual({
      sessionId: SESSION_ID,
      renderId: RENDER_ID,
      segmentId: segment.segmentId,
      snapshotVersion: segment.manifest.sourceManifest.session.snapshotVersion,
      frameCount: segment.manifest.frameCount,
      totalDurationMs: segment.manifest.totalDurationMs,
    });
    // Stats see both layers exactly once.
    expect(pipeline.stats()).toEqual({
      segments: 1,
      segmentBytes: segment.byteLength,
      duplicateSegmentStores: 0,
      artifacts: 1,
      artifactBytes: segment.byteLength,
      duplicateArtifactPuts: 0,
    });
  });

  test("the injected stores are used (no hidden defaults)", () => {
    const segmentStore = new InMemoryRenderSegmentStore();
    const artifactStore = new InMemoryArtifactStore();
    const pipeline = createAnimeOutputPipeline({ segmentStore, artifactStore });
    pipeline.encodeAndStore(fixtureInput());
    expect(pipeline.segmentStore).toBe(segmentStore);
    expect(pipeline.artifactStore).toBe(artifactStore);
    expect(segmentStore.stats().segments).toBe(1);
    expect(artifactStore.stats().artifacts).toBe(1);
  });
});

describe("encodeAndStore — idempotency (both layers, honest outcomes)", () => {
  test("re-storing the same output is a counted duplicate on BOTH layers", () => {
    const pipeline = createAnimeOutputPipeline();
    const first = pipeline.encodeAndStore(fixtureInput());
    const second = pipeline.encodeAndStore(fixtureInput());
    expect(second.outcome).toBe("duplicate");
    expect(second.artifactOutcome).toBe("duplicate");
    expect(second.segmentId).toBe(first.segmentId);
    expect(second.artifactId).toBe(first.artifactId);
    const stats = pipeline.stats();
    expect(stats.segments).toBe(1);
    expect(stats.artifacts).toBe(1);
    expect(stats.duplicateSegmentStores).toBe(1);
    expect(stats.duplicateArtifactPuts).toBe(1);
  });

  test("same content under a DIFFERENT render id: new segment, duplicate artifact (content addressing)", () => {
    const pipeline = createAnimeOutputPipeline();
    const first = pipeline.encodeAndStore(fixtureInput());
    const second = pipeline.encodeAndStore({ ...fixtureInput(), renderId: "r-clip-2" });
    expect(second.outcome).toBe("stored"); // new scope key
    expect(second.artifactOutcome).toBe("duplicate"); // same bytes = same id
    expect(second.artifactId).toBe(first.artifactId);
    const stats = pipeline.stats();
    expect(stats.segments).toBe(2);
    expect(stats.artifacts).toBe(1);
    expect(stats.artifactBytes).toBe(stats.segmentBytes / 2);
  });
});

describe("encodeAndStore — fail-loud paths", () => {
  test("conflict: same render id + different content → SegmentConflictError and NO artifact stored", () => {
    const pipeline = createAnimeOutputPipeline();
    pipeline.encodeAndStore(fixtureInput());
    expect(() => pipeline.encodeAndStore(conflictingInput())).toThrow(SegmentConflictError);
    // The segment-first ordering: nothing was added to the artifact layer.
    const stats = pipeline.stats();
    expect(stats.segments).toBe(1);
    expect(stats.artifacts).toBe(1);
    // The ORIGINAL stored output is untouched.
    const segment = encodeAnimeClip(fixtureInput().output);
    const record = pipeline.getSegment({
      sessionId: SESSION_ID,
      renderId: RENDER_ID,
      segmentId: segment.segmentId,
      ...ALLOW,
    });
    expect(record!.content).toBe(segment.content);
  });

  test("session-scope drift fails loud in the segment store (no artifact stored)", () => {
    const pipeline = createAnimeOutputPipeline();
    expect(() => pipeline.encodeAndStore({ ...fixtureInput(), sessionId: "sess-other" })).toThrow(
      SegmentValidationError,
    );
    expect(pipeline.stats().artifacts).toBe(0);
  });

  test("malformed render output fails loud in the encoder (nothing stored anywhere)", () => {
    const pipeline = createAnimeOutputPipeline();
    const broken = structuredClone(fixtureInput().output);
    broken.frames.pop();
    expect(() => pipeline.encodeAndStore({ ...fixtureInput(), output: broken })).toThrow();
    expect(pipeline.stats().segments).toBe(0);
    expect(pipeline.stats().artifacts).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// locateAnimeRef (W502 anime:// refs become resolvable)
// ---------------------------------------------------------------------------

describe("locateAnimeRef — golden path", () => {
  test("every W502 result artifactRef resolves to the playback coordinates", () => {
    const pipeline = createAnimeOutputPipeline();
    const input = fixtureInput();
    const result = pipeline.encodeAndStore(input);
    for (const segment of input.output.result.outputSegments) {
      const locations = pipeline.locateAnimeRef({ ref: segment.artifactRef, ...ALLOW });
      expect(locations).toHaveLength(1);
      const location = locations[0]!;
      // The ref's own frame index (parsed with the public parser).
      const parsed = parseAnimeArtifactRef(segment.artifactRef);
      expect(parsed.kind).toBe("ok");
      expect(location).toEqual({
        ref: segment.artifactRef,
        sessionId: SESSION_ID,
        snapshotVersion: input.output.manifest.session.snapshotVersion,
        frameIndex: parsed.kind === "ok" ? parsed.ref.frameIndex : -1,
        renderId: RENDER_ID,
        segmentId: result.segmentId,
        artifactId: result.artifactId,
        contentType: "image/svg+xml",
        byteLength: result.byteLength,
        contentHash: result.artifactId,
      });
    }
  });

  test("renderId narrowing scopes the resolution", () => {
    const pipeline = createAnimeOutputPipeline();
    const input = fixtureInput();
    pipeline.encodeAndStore(input);
    const ref = input.output.result.outputSegments[0]!.artifactRef;
    expect(pipeline.locateAnimeRef({ ref, renderId: RENDER_ID, ...ALLOW })).toHaveLength(1);
    expect(pipeline.locateAnimeRef({ ref, renderId: "r-other", ...ALLOW })).toEqual([]);
  });

  test("the same content under a SECOND render id resolves under BOTH scopes (narrowing probe)", () => {
    /**
     * REAL BUG this test pins (found in the inherited-work audit): the
     * artifact layer indexes one scope per content hash (first write wins),
     * and locateAnimeRef skipped an artifact whenever the narrowing render
     * id differed from the indexed one — so narrowing to any non-first
     * scope returned [] even though the segment store (and the control
     * plane) serve the byte-identical artifact under that scope. The
     * narrowed scope is now PROBED directly: it is a location iff it serves
     * the same segment id with the same content hash.
     */
    const pipeline = createAnimeOutputPipeline();
    const input = fixtureInput();
    const first = pipeline.encodeAndStore(input);
    // The same logical render under a second render id: a NEW segment
    // record (new scope key, same deterministic segment id), a DUPLICATE
    // artifact (content addressing — same bytes = same id).
    const second = pipeline.encodeAndStore({ ...fixtureInput(), renderId: "r-clip-2" });
    expect(second.outcome).toBe("stored");
    expect(second.artifactOutcome).toBe("duplicate");
    expect(second.segmentId).toBe(first.segmentId);
    const ref = input.output.result.outputSegments[0]!.artifactRef;
    // Un-narrowed: the artifact-indexed (first-write) scope.
    const unnarrowed = pipeline.locateAnimeRef({ ref, ...ALLOW });
    expect(unnarrowed).toHaveLength(1);
    expect(unnarrowed[0]!.renderId).toBe(RENDER_ID);
    // Narrowed to EITHER scope: both resolve (each serves the same bytes).
    for (const renderId of [RENDER_ID, "r-clip-2"]) {
      const locations = pipeline.locateAnimeRef({ ref, renderId, ...ALLOW });
      expect(locations).toHaveLength(1);
      expect(locations[0]!.renderId).toBe(renderId);
      expect(locations[0]!.segmentId).toBe(first.segmentId);
      expect(locations[0]!.artifactId).toBe(first.artifactId);
      expect(locations[0]!.contentHash).toBe(first.artifactId);
    }
    // A narrowed scope that stores DIFFERENT bytes under the same segment id
    // is not a location: the conflicting variant has the same identity (→
    // the same segment id) but different content — the probe's hash check
    // must reject it (and the store itself fails loud on the conflict, so
    // this state is only reachable through a tampered store).
    const tamperedStore = new InMemoryRenderSegmentStore();
    const tamperedArtifactStore = new InMemoryArtifactStore();
    const tamperedPipeline = createAnimeOutputPipeline({
      segmentStore: tamperedStore,
      artifactStore: tamperedArtifactStore,
    });
    tamperedPipeline.encodeAndStore(input);
    // Direct (host-side) store of DIFFERENT content under the second scope:
    const conflicting = conflictingInput().output;
    const conflictingSegment = encodeAnimeClip(conflicting);
    tamperedStore.storeSegment({
      sessionId: SESSION_ID,
      renderId: "r-clip-2",
      segment: conflictingSegment,
    });
    expect(tamperedPipeline.locateAnimeRef({ ref, renderId: "r-clip-2", ...ALLOW })).toEqual([]);
    // …and the first scope still resolves through the tampered pipeline.
    expect(tamperedPipeline.locateAnimeRef({ ref, renderId: RENDER_ID, ...ALLOW })).toHaveLength(1);
  });
});

describe("locateAnimeRef — honest absence", () => {
  test("a well-formed ref that matches nothing resolves to [] (never invented)", () => {
    const pipeline = createAnimeOutputPipeline();
    pipeline.encodeAndStore(fixtureInput());
    // Wrong session, wrong snapshot, frame index beyond the clip:
    expect(pipeline.locateAnimeRef({ ref: "anime://sess-other/1/0", ...ALLOW })).toEqual([]);
    expect(pipeline.locateAnimeRef({ ref: "anime://sess-w504/99/0", ...ALLOW })).toEqual([]);
    expect(pipeline.locateAnimeRef({ ref: "anime://sess-w504/1/99", ...ALLOW })).toEqual([]);
  });

  test("an artifact whose segment was never stored (orphan) is NOT located", () => {
    const artifactStore = new InMemoryArtifactStore();
    const segmentStore = new InMemoryRenderSegmentStore();
    const pipeline = createAnimeOutputPipeline({ segmentStore, artifactStore });
    const segment = encodeAnimeClip(fixtureInput().output);
    // Put the artifact WITHOUT the pipeline (no segment index entry):
    artifactStore.putArtifact({
      content: segment.content,
      contentType: segment.contentType,
      metadata: {
        sessionId: SESSION_ID,
        renderId: RENDER_ID,
        segmentId: segment.segmentId,
        snapshotVersion: segment.manifest.sourceManifest.session.snapshotVersion,
        frameCount: segment.manifest.frameCount,
        totalDurationMs: segment.manifest.totalDurationMs,
      },
    });
    const ref = fixtureInput().output.result.outputSegments[0]!.artifactRef;
    expect(pipeline.locateAnimeRef({ ref, ...ALLOW })).toEqual([]);
    // The artifact exists in the bytes layer — visible in stats, never served.
    expect(artifactStore.stats().artifacts).toBe(1);
  });

  test("a deleted segment is no longer located (delete propagates)", () => {
    const pipeline = createAnimeOutputPipeline();
    const input = fixtureInput();
    const result = pipeline.encodeAndStore(input);
    pipeline.segmentStore.deleteSegment(SESSION_ID, RENDER_ID, result.segmentId);
    const ref = input.output.result.outputSegments[0]!.artifactRef;
    expect(pipeline.locateAnimeRef({ ref, ...ALLOW })).toEqual([]);
  });
});

describe("locateAnimeRef — malformed refs fail loud (typed)", () => {
  test("a malformed ref throws SegmentValidationError with the ref + reason", () => {
    const pipeline = createAnimeOutputPipeline();
    try {
      pipeline.locateAnimeRef({ ref: "not-a-ref", ...ALLOW });
      expect.unreachable();
    } catch (err) {
      expect(err instanceof SegmentValidationError).toBe(true);
      if (err instanceof SegmentValidationError) {
        expect(err.failureClass).toBe("media-invalid");
        expect(err.details.ref).toBe("not-a-ref");
        expect(typeof err.details.reason).toBe("string");
      }
    }
  });
});

describe("locateAnimeRef — fail-closed rights (deny BEFORE reveal)", () => {
  test("policy without canStoreDerivatives denies before existence is revealed", () => {
    const pipeline = createAnimeOutputPipeline();
    const input = fixtureInput();
    pipeline.encodeAndStore(input);
    const ref = input.output.result.outputSegments[0]!.artifactRef;
    // Present ref:
    expect(() =>
      pipeline.locateAnimeRef({ ref, policy: analysisTransformationPolicy, nowMs: TEST_EPOCH_MS }),
    ).toThrow(PlaybackRightsDeniedError);
    // Absent-but-well-formed ref: still a rights denial (never a [] reveal).
    expect(() =>
      pipeline.locateAnimeRef({
        ref: "anime://sess-other/1/0",
        policy: analysisTransformationPolicy,
        nowMs: TEST_EPOCH_MS,
      }),
    ).toThrow(PlaybackRightsDeniedError);
  });

  test("expired policy denies with the expired-policy reason; malformed policy denies", () => {
    const pipeline = createAnimeOutputPipeline();
    try {
      pipeline.locateAnimeRef({
        ref: "anime://sess-w504/1/0",
        policy: expiredPolicy,
        nowMs: TEST_EPOCH_MS,
      });
      expect.unreachable();
    } catch (err) {
      expect(err instanceof PlaybackRightsDeniedError).toBe(true);
      if (err instanceof PlaybackRightsDeniedError) {
        expect(err.details.reason).toBe("expired-policy");
      }
    }
    expect(() =>
      pipeline.locateAnimeRef({
        ref: "anime://sess-w504/1/0",
        policy: {} as never,
        nowMs: TEST_EPOCH_MS,
      }),
    ).toThrow(PlaybackRightsDeniedError);
  });

  test("a malformed ref under a denied policy is DENIED first (rights before parse errors)", () => {
    const pipeline = createAnimeOutputPipeline();
    expect(() =>
      pipeline.locateAnimeRef({
        ref: "not-a-ref",
        policy: analysisTransformationPolicy,
        nowMs: TEST_EPOCH_MS,
      }),
    ).toThrow(PlaybackRightsDeniedError);
  });
});

// ---------------------------------------------------------------------------
// Delegation + determinism
// ---------------------------------------------------------------------------

describe("pipeline delegation (the control-plane port surface)", () => {
  test("getSegment/listSegments delegate to the segment store with the same rights posture", () => {
    const pipeline: AnimeOutputPipeline = createAnimeOutputPipeline();
    const result = pipeline.encodeAndStore(fixtureInput());
    const listed = pipeline.listSegments({ sessionId: SESSION_ID, renderId: RENDER_ID, ...ALLOW });
    expect(listed).toEqual([
      {
        segmentId: result.segmentId,
        contentType: "image/svg+xml",
        byteLength: result.byteLength,
        contentHash: result.artifactId,
      },
    ]);
    expect(() =>
      pipeline.listSegments({
        sessionId: SESSION_ID,
        renderId: RENDER_ID,
        policy: analysisTransformationPolicy,
        nowMs: TEST_EPOCH_MS,
      }),
    ).toThrow(PlaybackRightsDeniedError);
  });
});

describe("determinism", () => {
  test("two fresh pipelines fed the same input produce deep-equal results and stats", () => {
    const pipelineA = createAnimeOutputPipeline();
    const pipelineB = createAnimeOutputPipeline();
    const resultA = pipelineA.encodeAndStore(fixtureInput());
    const resultB = pipelineB.encodeAndStore(fixtureInput());
    expect(resultA).toEqual(resultB);
    expect(pipelineA.stats()).toEqual(pipelineB.stats());
    // And the served bytes are byte-identical through both.
    const recordA = pipelineA.getSegment({
      sessionId: SESSION_ID,
      renderId: RENDER_ID,
      segmentId: resultA.segmentId,
      ...ALLOW,
    });
    const recordB = pipelineB.getSegment({
      sessionId: SESSION_ID,
      renderId: RENDER_ID,
      segmentId: resultB.segmentId,
      ...ALLOW,
    });
    expect(recordA!.content).toBe(recordB!.content);
  });

  test("full double-run: encode → store → locate → fetch is deep-equal", () => {
    function run() {
      const pipeline = createAnimeOutputPipeline();
      const input = fixtureInput();
      const result = pipeline.encodeAndStore(input);
      const ref = input.output.result.outputSegments[0]!.artifactRef;
      const location = pipeline.locateAnimeRef({ ref, ...ALLOW });
      const record = pipeline.getSegment({
        sessionId: SESSION_ID,
        renderId: RENDER_ID,
        segmentId: result.segmentId,
        ...ALLOW,
      });
      return { result, location, record, stats: pipeline.stats() };
    }
    expect(run()).toEqual(run());
  });
});
