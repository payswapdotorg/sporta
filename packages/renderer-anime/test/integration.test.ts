/**
 * W502 ↔ W402 integration: the anime renderer consuming the temporal seams
 * (`stateAt` + `eventWindow` from `@sporta/temporal`) as its SWM snapshot
 * source. This mirrors the W502 work-item dependency (W502 depends on
 * W402): a W006 engine accumulates moving entities + football events, the
 * temporal queries produce the clip steps, and the anime renderer turns
 * them into a coherent stylized output.
 *
 * Deterministic: fixed `now` (TEST_EPOCH_MS), explicit timeline positions,
 * no Math.random. These imports are dev-only (package boundary in
 * `src/index.ts` stays renderer-contract + contracts + testing).
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
import { renderAnimeClip } from "../src/index";
import type { AnimeClipStep } from "../src/index";

const E2E_SESSION = "sess-anime-e2e";

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
 * x, b1 (ball) follows 0.5 m behind; events pass@1500 (seq 1) and
 * goal@5500 (seq 2) are applied in chronological order. Snapshots are
 * captured with `stateAt` BEFORE later upserts mutate the engine (at-T
 * semantics), exactly like a real consumer would.
 */
function buildClipSteps(): AnimeClipStep[] {
  const engine = WorldModelEngine.create(E2E_SESSION, {
    now: () => TEST_EPOCH_MS,
    football,
  });
  const steps: AnimeClipStep[] = [];
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
      },
    });
    if (t === 2_000) {
      // Applied before the stateAt(2000) capture: the pass lands in step 1's
      // caption window (1000, 2000] and in that snapshot's event prefix.
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
    steps.push({ atMs: t, snapshot, events: window });
  }
  return steps;
}

function buildE2ERequest() {
  return buildRenderRequest({
    sessionId: E2E_SESSION,
    rendererId: "anime.prototype",
    rendererVersion: "0.1.0",
    snapshotVersion: 1,
    eventsSinceSequence: 0,
    outputProfile: {
      resolution: { w: 1170, h: 880 },
      frameRate: 1,
      codec: "svg",
      container: "svg",
      latencyClass: "offline",
    },
    styleConfig: { styleId: "style-anime-e2e", configSchemaVersion: "1.0", config: {} },
    rightsCapabilities: {
      canReferenceSourceFrames: true,
      canDeliverLive: false,
      canStoreDerivatives: true,
      canShare: false,
    },
    sourceFrameRefs: [],
  });
}

describe("W402 seams → W502 anime render (temporal integration)", () => {
  test("stateAt snapshots + eventWindow events render into a coherent moving clip", () => {
    const steps = buildClipSteps();
    const output = renderAnimeClip(buildE2ERequest(), steps);
    expect(output.frames).toHaveLength(6);

    // Coherent motion: p1 at x = 51..56 → canvas cx = 570..620.
    const p1Positions = output.manifest.frames.map(
      (frame) => frame.entities.find((entity) => entity.entityId === "p1")!.svgPosition!.x,
    );
    expect(p1Positions).toEqual([570, 580, 590, 600, 610, 620]);
    // The ball follows half a meter behind.
    const ballPositions = output.manifest.frames.map(
      (frame) => frame.entities.find((entity) => entity.entityId === "b1")!.svgPosition!.x,
    );
    expect(ballPositions).toEqual([565, 575, 585, 595, 605, 615]);

    // Identity stability across engine-derived frames (style tokens pinned).
    const p1Styles = output.manifest.frames.map((frame) =>
      JSON.stringify(frame.entities.find((entity) => entity.entityId === "p1")!.style),
    );
    expect(new Set(p1Styles).size).toBe(1);

    // Captions land in the right windows via eventWindow.
    expect(output.manifest.frames[1]!.captions.events).toEqual([
      { sequence: 1, eventId: "evt-pass", phrase: "Pass" },
    ]);
    expect(output.manifest.frames[5]!.captions.events).toEqual([
      { sequence: 2, eventId: "evt-goal", phrase: "GOAL!" },
    ]);

    // Provenance: per-frame snapshot watermarks advance with the engine.
    expect(output.manifest.frames.map((frame) => frame.source.watermark.sequence)).toEqual([
      0, 1, 1, 1, 1, 2,
    ]);
    expect(output.result.provenance.lastEventSequence).toBe(2);
    expect(output.result.watermarkAfter).toEqual({ watermarkMs: 7_000, sequence: 2 });
  });

  test("the full pipeline is deterministic: rerun is deep-equal", () => {
    const first = renderAnimeClip(buildE2ERequest(), buildClipSteps());
    const second = renderAnimeClip(buildE2ERequest(), buildClipSteps());
    expect(first.frames).toEqual(second.frames);
    expect(first.manifest).toEqual(second.manifest);
    expect(first.result).toEqual(second.result);
  });

  test("fail-closed rights end-to-end: analysis-only policy cannot reference source frames", () => {
    // deriveRightsCapabilities is the fail-closed derivation (W002/W701);
    // an analysis-only policy denies source-frame references, and the anime
    // renderer refuses the request rather than consuming them.
    const rights = deriveRightsCapabilities({
      policyId: "policy-analysis-only",
      allowedOperations: ["analysis"],
      assertedBy: "operator",
    });
    expect(rights.canReferenceSourceFrames).toBe(false);
    const req = buildE2ERequest();
    const denied = { ...req, rightsCapabilities: rights, sourceFrameRefs: ["frame-9"] };
    expect(() => renderAnimeClip(denied, buildClipSteps())).toThrow(/canReferenceSourceFrames/);
  });
});
