/**
 * Artifact tests (R208): content-hash stability, canonical serialization,
 * serialize→parse round-trip, tamper detection, and replay — using a
 * hand-built minimal artifact (no pipeline run needed).
 */
import { describe, expect, test } from "bun:test";
import {
  artifactContentHash,
  buildLedger,
  canonicalJson,
  parseArtifact,
  replayReconstruction,
  serializeArtifact,
  sha256HexOfString,
} from "../src/index";
import type { ReconstructionArtifact } from "../src/index";

/** A minimal but structurally valid artifact fixture. */
function minimalArtifact(): ReconstructionArtifact {
  const body = {
    schemaVersion: "1.1",
    artifactId: "rswm-abcdef123456-01234567",
    clip: {
      clipId: "fx-test",
      filename: "fx-test.mp4",
      byteLength: 42,
      contentSha256: "a".repeat(64),
      container: "mp4",
      durationMs: 4000,
      frameCount: 100,
      width: 640,
      height: 360,
      fps: 25,
      firstFrameMs: 0,
      lastFrameMs: 3960,
      provenance: {
        clipId: "fx-test",
        sourceUrl: "https://example.org/clip",
        sourceSha256: "b".repeat(64),
        licenseId: "CC0-1.0",
      },
    },
    pipeline: {
      sessionId: "sess-fx-test",
      nowMs: 0,
      config: { sessionId: "sess-fx-test", minTrackFrames: 5 },
      candidates: [],
    },
    swm: {
      snapshots: [
        {
          sessionId: "sess-fx-test",
          schemaVersion: "1.1",
          watermark: { watermarkMs: 3960, sequence: 0 },
          entities: [
            {
              entityId: "t1",
              kind: "participant",
              version: 3,
              lastEventTimeMs: 3960,
              state: {
                position: { status: "uncertain", value: { x: 0.5, y: 0.5 }, confidence: 0.7 },
                spatialFrame: { status: "known", value: "image" },
                lastSeenMs: { status: "known", value: 3960 },
              },
            },
          ],
          football: {
            pitch: {
              lengthAxisMeters: 105,
              widthAxisMeters: 68,
              origin: "corner",
              axes: "x=touchline, y=goal-line",
            },
            clock: { period: "pre-match", clockMs: 0, stoppage: false },
            score: { home: 0, away: 0, status: { status: "unknown" } },
            possession: { status: "unknown" },
            eventTaxonomyVersion: "v1",
          },
          generatedAtMs: 0,
        },
      ],
      events: [],
      football: null,
    },
    eventCandidates: [],
    provenance: {
      entities: [
        {
          entityId: "t1",
          kind: "participant",
          observationCount: 3,
          firstSeenMs: 0,
          lastSeenMs: 3960,
          meanConfidence: 0.7,
          minConfidence: 0.6,
          producedBy: ["greedy-iou-tracker"],
        },
      ],
      observations: {
        playerTracks: 3,
        ballTracks: 0,
        teamAssignments: 1,
        fieldMappings: 0,
        detections: 0,
      },
    },
    fusion: {
      entitiesUpserted: 3,
      eventsApplied: 0,
      eventsDeduplicated: 0,
      clockPatches: 0,
      possessionUpdates: 0,
      conflicts: [],
      snapshotVersionAfter: 4,
      warnings: [],
    },
    ledger: buildLedger([
      {
        stage: "decode",
        order: 1,
        framesIn: 100,
        framesOut: 100,
        itemsOut: 100,
        attempted: [],
        degradations: [],
        notes: [],
      },
    ]),
  } satisfies Omit<ReconstructionArtifact, "contentHash">;
  const contentHash = artifactContentHash(body);
  return { ...body, contentHash };
}

describe("canonical serialization", () => {
  test("object keys are recursively sorted; undefined properties are dropped", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
    expect(canonicalJson([3, 1, { z: 1, a: 2 }])).toBe('[3,1,{"a":2,"z":1}]');
  });

  test("sha256HexOfString is stable and hex", () => {
    expect(sha256HexOfString("abc")).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256HexOfString("abc")).toBe(sha256HexOfString("abc"));
    expect(sha256HexOfString("abd")).not.toBe(sha256HexOfString("abc"));
  });
});

describe("artifact content hash + serialization round-trip", () => {
  test("serialize → parse round-trips and the hash survives", () => {
    const artifact = minimalArtifact();
    const json = serializeArtifact(artifact);
    const parsed = parseArtifact(json);
    expect(parsed.contentHash).toBe(artifact.contentHash);
    expect(serializeArtifact(parsed)).toBe(json);
  });

  test("any content mutation breaks the hash (tamper detection)", () => {
    const artifact = minimalArtifact();
    const json = serializeArtifact(artifact);
    const tampered = JSON.parse(json) as Record<string, unknown>;
    (tampered.clip as Record<string, unknown>).frameCount = 999;
    try {
      parseArtifact(JSON.stringify(tampered));
      expect.unreachable("tampered artifact must refuse");
    } catch (error) {
      expect((error as Error).name).toBe("ArtifactIntegrityError");
      expect((error as Error).message).toContain("mismatch");
    }
  });

  test("a malformed contentHash refuses before validation", () => {
    const artifact = minimalArtifact();
    const json = JSON.parse(serializeArtifact(artifact)) as Record<string, unknown>;
    json.contentHash = "not-a-hash";
    try {
      parseArtifact(JSON.stringify(json));
      expect.unreachable("must refuse");
    } catch (error) {
      expect((error as Error).name).toBe("ArtifactIntegrityError");
    }
  });

  test("replay reconstructs the view: entities join with provenance", () => {
    const artifact = minimalArtifact();
    const view = replayReconstruction(artifact);
    expect(view.clipId).toBe("fx-test");
    expect(view.contentHash).toBe(artifact.contentHash);
    expect(view.snapshots.length).toBe(1);
    expect(view.entities.length).toBe(1);
    expect(view.entities[0]!.entityId).toBe("t1");
    expect(view.entities[0]!.provenance?.producedBy).toEqual(["greedy-iou-tracker"]);
  });
});
