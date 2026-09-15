/**
 * W602 ↔ W402/W601 integration: the 3D renderer consuming the temporal
 * seams (`stateAt` + `eventWindow` from `@sporta/temporal`) projected
 * through W601 `projectScene` — the documented consumer construction
 * (`projectScene(stateAt(engine, t).snapshot, { events: eventWindow(...) })`).
 *
 * Deterministic: fixed `now` (TEST_EPOCH_MS), explicit timeline positions,
 * no Math.random. These imports are dev-only (the src boundary stays
 * contracts + renderer-contract + scene-projection).
 */
import { describe, expect, test } from "bun:test";
import {
  PITCH_AXES,
  PITCH_LENGTH_AXIS_METERS,
  PITCH_ORIGIN,
  PITCH_WIDTH_AXIS_METERS,
  SCHEMA_VERSION,
  deriveRightsCapabilities,
} from "@sporta/contracts";
import { TEST_EPOCH_MS, buildRenderRequest } from "@sporta/testing";
import { eventWindow, stateAt } from "@sporta/temporal";
import { WorldModelEngine } from "@sporta/world-model";
import type { FootballState } from "@sporta/world-model";
import { projectScene } from "@sporta/scene-projection";
import { render3dClip } from "../src/index";
import type { AvatarField3dClipStep } from "../src/index";
import { runSceneConformance } from "@sporta/scene-projection";

const E2E_SESSION = "sess-3d-e2e";

/** A first-half fixture football state (canonical pitch, uncertain score). */
const football: FootballState = {
  pitch: {
    lengthAxisMeters: PITCH_LENGTH_AXIS_METERS,
    widthAxisMeters: PITCH_WIDTH_AXIS_METERS,
    origin: PITCH_ORIGIN,
    axes: PITCH_AXES,
  },
  clock: { period: "first-half", clockMs: 0, stoppage: false },
  score: {
    home: 0,
    away: 0,
    status: { status: "uncertain", value: "provisional", confidence: 0.6 },
  },
  possession: { status: "uncertain", value: { entityId: "p1" }, confidence: 0.7 },
  eventTaxonomyVersion: "v1",
};

/**
 * Builds the moving engine fixture: p1 (participant) advances 1 m/s along
 * x, b1 (ball) follows 0.5 m behind WITH a carried height; events
 * pass@1500 (seq 1) and goal@5500 (seq 2) are applied in chronological
 * order. Snapshots are captured with `stateAt` BEFORE later upserts mutate
 * the engine (at-T semantics), exactly like a real consumer would.
 */
function buildClipSteps(): AvatarField3dClipStep[] {
  const engine = WorldModelEngine.create(E2E_SESSION, {
    now: () => TEST_EPOCH_MS,
    football,
  });
  const steps: AvatarField3dClipStep[] = [];
  for (let second = 1; second <= 6; second += 1) {
    const t = second * 1_000;
    engine.upsertEntity({
      entityId: "p1",
      kind: "participant",
      version: 1,
      lastEventTimeMs: t,
      state: {
        pitchPosition: {
          status: "known",
          value: { x: 50 + second, y: 34 },
        },
        heading: { status: "known", value: 0.3 },
      },
    });
    engine.upsertEntity({
      entityId: "b1",
      kind: "ball",
      version: 1,
      lastEventTimeMs: t,
      state: {
        pitchPosition: {
          status: "uncertain",
          value: { x: 50 + second - 0.5, y: 34.2 },
          confidence: 0.9,
        },
        height: { status: "known", value: 1.0 + 0.1 * second },
      },
    });
    if (t === 2_000) {
      // Applied before the stateAt(2000) capture: the pass lands in step 1's
      // marker window (1000, 2000] and in that snapshot's event prefix.
      engine.applyEvent({
        eventId: "evt-pass",
        sessionId: E2E_SESSION,
        schemaVersion: SCHEMA_VERSION,
        eventTypeRef: "football/v1/pass",
        interval: { startTimeMs: 1_500, endTimeMs: 1_500 },
        eventTimeMs: 1_500,
        provenance: "DERIVED",
        evidence: { observationIds: ["obs-1"] },
      });
    }
    if (t === 6_000) {
      engine.applyEvent({
        eventId: "evt-goal",
        sessionId: E2E_SESSION,
        schemaVersion: SCHEMA_VERSION,
        eventTypeRef: "football/v1/goal",
        interval: { startTimeMs: 5_500, endTimeMs: 5_500 },
        eventTimeMs: 5_500,
        provenance: "DERIVED",
        confidence: 0.95,
        evidence: { observationIds: ["obs-2"] },
      });
    }
    const snapshot = stateAt(engine, t).snapshot;
    const window = eventWindow(engine.eventsSince(0), {
      fromMs: t === 1_000 ? 0 : (second - 1) * 1_000,
      toMs: t,
    });
    // The documented W602 consumer construction: project the at-T snapshot
    // with its windowed events into the scene the renderer consumes.
    steps.push({ atMs: t, scene: projectScene(snapshot, { events: window }) });
  }
  return steps;
}

function buildE2ERequest() {
  return buildRenderRequest({
    sessionId: E2E_SESSION,
    rendererId: "avatar-field.prototype",
    rendererVersion: "0.2.0",
    snapshotVersion: 1,
    eventsSinceSequence: 0,
    outputProfile: {
      resolution: { w: 1280, h: 720 },
      frameRate: 1,
      codec: "svg",
      container: "svg",
      latencyClass: "offline",
    },
    styleConfig: { styleId: "style-3d-e2e", configSchemaVersion: "1.0", config: {} },
    rightsCapabilities: {
      canReferenceSourceFrames: true,
      canDeliverLive: false,
      canStoreDerivatives: true,
      canShare: false,
    },
    sourceFrameRefs: [],
  });
}

describe("W402 seams → W601 projection → W602 3D render", () => {
  test("stateAt snapshots + eventWindow markers render a coherent moving clip", () => {
    const steps = buildClipSteps();
    const output = render3dClip(buildE2ERequest(), steps);
    expect(output.frames).toHaveLength(6);

    // Coherent motion: p1 at x = 51..56, near the pitch center; the striker
    // group is drawn (billboard figure from main-touchline).
    const p1Entries = output.manifest.frames.map((frame) =>
      frame.entities.find((entity) => entity.entityId === "p1")!,
    );
    expect(p1Entries.map((entry) => entry.positionMeters?.x)).toEqual([51, 52, 53, 54, 55, 56]);
    expect(p1Entries.every((entry) => entry.renderDisposition === "rendered")).toBe(true);
    expect(p1Entries.every((entry) => entry.headingCarried)).toBe(true); // heading 0.3 carried

    // The ball follows half a meter behind, ELEVATED (height carried each
    // step: 1.1..1.6 m) — its screen y is above its ground shadow.
    const ballEntries = output.manifest.frames.map((frame) =>
      frame.entities.find((entity) => entity.entityId === "b1")!,
    );
    expect(ballEntries.map((entry) => entry.positionMeters?.x)).toEqual([
      50.5, 51.5, 52.5, 53.5, 54.5, 55.5,
    ]);
    expect(ballEntries.map((entry) => entry.positionMeters?.z)).toEqual([
      1.1, 1.2, 1.3, 1.4, 1.5, 1.6,
    ]);

    // Identity stability across engine-derived frames (style tokens pinned
    // byte-identical while the entities' versions advance).
    const p1Styles = p1Entries.map((entry) => JSON.stringify(entry.style));
    expect(new Set(p1Styles).size).toBe(1);

    // Captions land in the right windows via eventWindow.
    expect(output.manifest.frames[1]!.markers).toEqual([
      expect.objectContaining({ sequence: 1, eventId: "evt-pass", text: "Pass" }),
    ]);
    expect(output.manifest.frames[5]!.markers).toEqual([
      expect.objectContaining({ sequence: 2, eventId: "evt-goal", text: "GOAL!" }),
    ]);

    // Possession ring displayed around p1 each frame (rendered participant).
    expect(output.manifest.frames.every((frame) => frame.possession?.displayed === true)).toBe(
      true,
    );

    // Provenance: per-frame snapshot watermarks advance with the engine.
    expect(output.manifest.frames.map((frame) => frame.source.watermark.sequence)).toEqual([
      0, 1, 1, 1, 1, 2,
    ]);
    expect(output.result.provenance.lastEventSequence).toBe(2);
    expect(output.result.watermarkAfter).toEqual({ watermarkMs: 7_000, sequence: 2 });
  });

  test("every step's scene passes the W601 conformance harness (the seam is clean)", () => {
    const steps = buildClipSteps();
    for (const step of steps) {
      const report = runSceneConformance(step.scene);
      expect(report.passed).toBe(true);
    }
  });

  test("the full pipeline is deterministic: rerun is deep-equal", () => {
    const first = render3dClip(buildE2ERequest(), buildClipSteps());
    const second = render3dClip(buildE2ERequest(), buildClipSteps());
    expect(first.frames).toEqual(second.frames);
    expect(first.manifest).toEqual(second.manifest);
    expect(first.result).toEqual(second.result);
  });

  test("fail-closed rights end-to-end: an analysis-only policy cannot reference source frames", () => {
    // deriveRightsCapabilities is the fail-closed derivation (W002/W701);
    // an analysis-only policy denies source-frame references, and the 3D
    // renderer refuses the request rather than consuming them.
    const rights = deriveRightsCapabilities({
      policyId: "policy-analysis-only",
      allowedOperations: ["analysis"],
      assertedBy: "operator",
    });
    expect(rights.canReferenceSourceFrames).toBe(false);
    const req = buildE2ERequest();
    const denied = { ...req, rightsCapabilities: rights, sourceFrameRefs: ["frame-9"] };
    expect(() => render3dClip(denied, buildClipSteps())).toThrow(/canReferenceSourceFrames/);
  });
});
