import { describe, expect, test } from "bun:test";
import { RendererContractError } from "@sporta/renderer-contract";
import { projectScene } from "@sporta/scene-projection";
import {
  AVATAR_FIELD_OUTPUT_PROFILE,
  MAX_EVENT_CHIPS,
  admitRequest,
  parseStyleConfig,
  render3dClip,
  render3dFromSnapshot,
} from "../src/index";
import type { RenderRequest } from "@sporta/contracts";
import {
  ALLOW_ALL,
  DENY_ALL,
  SESSION_ID,
  build3dRequest,
  buildFixtureEvent,
  buildFixtureSnapshot,
  fixtureMarkerStream,
} from "./helpers";

/** A admitted fixture input (snapshot 0 + the marker stream). */
function fixtureInput() {
  return { snapshot: buildFixtureSnapshot(0), events: fixtureMarkerStream() };
}

describe("parseStyleConfig — the style configuration surface", () => {
  test("undefined config → the documented defaults", () => {
    expect(parseStyleConfig(undefined)).toEqual({
      ok: true,
      value: { durationMs: 6_000, cameraSlotId: "main-touchline", simulateDegradation: false },
    });
  });

  test("durationMs: bounds + non-number refusals", () => {
    expect(parseStyleConfig({ durationMs: 3_000 })).toEqual({
      ok: true,
      value: { durationMs: 3_000, cameraSlotId: "main-touchline", simulateDegradation: false },
    });
    expect(parseStyleConfig({ durationMs: 0 })).toMatchObject({ ok: false });
    expect(parseStyleConfig({ durationMs: 3_600_001 })).toMatchObject({ ok: false });
    expect(parseStyleConfig({ durationMs: Number.NaN })).toMatchObject({ ok: false });
    expect(parseStyleConfig({ durationMs: "6000" })).toMatchObject({ ok: false });
  });

  test("cameraSlotId: must be a canonical slot id", () => {
    expect(parseStyleConfig({ cameraSlotId: "aerial-tactical" })).toMatchObject({
      ok: true,
      value: { cameraSlotId: "aerial-tactical" },
    });
    expect(parseStyleConfig({ cameraSlotId: "behind-goal-x0" })).toMatchObject({ ok: true });
    expect(parseStyleConfig({ cameraSlotId: "satellite" })).toMatchObject({ ok: false });
    expect(parseStyleConfig({ cameraSlotId: 7 })).toMatchObject({ ok: false });
  });

  test("simulateDegradation must be a boolean; unknown keys are ignored", () => {
    expect(parseStyleConfig({ simulateDegradation: true, unknownKey: "x" })).toEqual({
      ok: true,
      value: { durationMs: 6_000, cameraSlotId: "main-touchline", simulateDegradation: true },
    });
    expect(parseStyleConfig({ simulateDegradation: "yes" })).toMatchObject({ ok: false });
  });

  test("a non-object config refuses", () => {
    expect(parseStyleConfig(42)).toMatchObject({ ok: false });
    expect(parseStyleConfig(null)).toMatchObject({ ok: false });
  });
});

describe("admitRequest — the fail-closed gates (R2/R3 + style)", () => {
  test("accepts the fixture request", () => {
    expect(admitRequest(build3dRequest())).toMatchObject({ ok: true });
  });

  test("R3 identity: wrong rendererId / rendererVersion → media-invalid", () => {
    expect(admitRequest(build3dRequest({ rendererId: "other.renderer" }))).toMatchObject({
      ok: false,
      failureClass: "media-invalid",
    });
    expect(admitRequest(build3dRequest({ rendererVersion: "9.9.9" }))).toMatchObject({
      ok: false,
      failureClass: "media-invalid",
    });
  });

  test("R3 profile: an off-list output profile → media-invalid", () => {
    const req = build3dRequest({
      outputProfile: { ...AVATAR_FIELD_OUTPUT_PROFILE, frameRate: 30 },
    });
    expect(admitRequest(req)).toMatchObject({ ok: false, failureClass: "media-invalid" });
  });

  test("R3 snapshot version: below the minimum or non-integer → media-invalid", () => {
    const stale = { ...build3dRequest(), snapshotVersion: -1 } as RenderRequest;
    const rejection = admitRequest(stale);
    expect(rejection).toMatchObject({ ok: false, failureClass: "media-invalid" });
    const fractional = { ...build3dRequest(), snapshotVersion: 1.5 } as RenderRequest;
    expect(admitRequest(fractional)).toMatchObject({ ok: false });
  });

  test("R2 fail-closed beyond the baseline: carried source-frame refs without rights → rights-denied", () => {
    const req = build3dRequest({
      rightsCapabilities: DENY_ALL,
      sourceFrameRefs: ["frame-9"],
    });
    const rejection = admitRequest(req);
    expect(rejection).toMatchObject({ ok: false, failureClass: "rights-denied" });
    if (!rejection.ok) expect(rejection.reason).toContain("canReferenceSourceFrames");
  });

  test("rights WITH frame references is admitted (the rights are real)", () => {
    const req = build3dRequest({
      rightsCapabilities: ALLOW_ALL,
      sourceFrameRefs: ["frame-9"],
    });
    expect(admitRequest(req)).toMatchObject({ ok: true });
  });

  test("an invalid style config → media-invalid", () => {
    const req = build3dRequest({
      styleConfig: { styleId: "s", configSchemaVersion: "1.0", config: { durationMs: -1 } },
    });
    expect(admitRequest(req)).toMatchObject({ ok: false, failureClass: "media-invalid" });
  });
});

describe("render3dFromSnapshot — the contract path (single snapshot + events)", () => {
  test("happy path: 6 frames over the 6 s window from the snapshot watermark", () => {
    const out = render3dFromSnapshot(build3dRequest(), fixtureInput());
    expect(out.frames).toHaveLength(6);
    expect(out.frames.map((frame) => frame.outputTimestampMs)).toEqual([
      1_000, 2_000, 3_000, 4_000, 5_000, 6_000,
    ]);
    expect(out.manifest.output).toEqual({
      profile: AVATAR_FIELD_OUTPUT_PROFILE,
      startMs: 1_000,
      frameIntervalMs: 1_000,
      durationMs: 6_000,
    });
    // The scene state is HELD across frames (one resolved scene; only the
    // marker windows evolve).
    expect(out.manifest.frames[0]!.entities[0]!.screenPosition).toEqual(
      out.manifest.frames[5]!.entities[0]!.screenPosition,
    );
  });

  test("segments: R8 well-formed, non-overlapping, unique ids, opaque refs", () => {
    const out = render3dFromSnapshot(build3dRequest(), fixtureInput());
    const segments = out.result.outputSegments;
    expect(segments).toHaveLength(6);
    expect(new Set(segments.map((segment) => segment.segmentId)).size).toBe(6);
    for (let i = 0; i < segments.length; i += 1) {
      const segment = segments[i]!;
      expect(segment.startMs).toBeGreaterThanOrEqual(0);
      expect(segment.endMs).toBeGreaterThan(segment.startMs);
      expect(segment.artifactRef).toMatch(/^scene3d:\/\//);
      if (i > 0) {
        expect(segment.startMs).toBeGreaterThanOrEqual(segments[i - 1]!.endMs);
      }
    }
    expect(segments[0]).toEqual({
      segmentId: "scene3d-0",
      startMs: 1_000,
      endMs: 2_000,
      artifactRef: `scene3d://${SESSION_ID}/1/0`,
    });
  });

  test("R5/R6: full application — lastEventSequence 15, watermarkAfter exact", () => {
    const out = render3dFromSnapshot(build3dRequest(), fixtureInput());
    expect(out.manifest.provenance).toEqual({ snapshotVersion: 1, lastEventSequence: 15 });
    expect(out.manifest.watermarkAfter).toEqual({ watermarkMs: 7_000, sequence: 15 });
    expect(out.result.provenance).toEqual(out.manifest.provenance);
    expect(out.result.watermarkAfter).toEqual(out.manifest.watermarkAfter);
    expect(out.result.sessionId).toBe(SESSION_ID);
    expect(out.result.rendererId).toBe("avatar-field.prototype");
    expect(out.result.rendererHealth).toEqual({ lagMs: 0, degraded: false });
  });

  test("R5 with an empty event list: lastEventSequence 0, watermark = the snapshot's", () => {
    const snapshot = buildFixtureSnapshot(0); // watermark {1000, 10}
    const out = render3dFromSnapshot(build3dRequest(), { snapshot, events: [] });
    expect(out.manifest.provenance.lastEventSequence).toBe(0);
    expect(out.manifest.watermarkAfter).toEqual({ watermarkMs: 7_000, sequence: 10 });
  });

  test("markers before/after the window: skipped + accounted + R7 degradation", () => {
    const snapshot = buildFixtureSnapshot(0); // window [1000, 7000)
    const events = [
      buildFixtureEvent("fe-early", 500, "football/v1/goal", 11),
      buildFixtureEvent("fe-late", 9_000, "football/v1/goal", 12),
    ];
    const out = render3dFromSnapshot(build3dRequest(), { snapshot, events });
    expect(out.manifest.skippedMarkers).toEqual([
      { sequence: 11, eventId: "fe-early", eventTimeMs: 500, reason: "before-window" },
      { sequence: 12, eventId: "fe-late", eventTimeMs: 9_000, reason: "after-window" },
    ]);
    expect(out.manifest.provenance.lastEventSequence).toBe(0); // nothing applied
    expect(out.result.rendererHealth).toEqual({
      lagMs: 0,
      degraded: true,
      degradationReason: "markers-outside-render-window",
    });
    expect(out.manifest.degradation.reasons).toEqual(["markers-outside-render-window"]);
  });

  test("the boundary marker at exactly the window end is AFTER (window is [start, end))", () => {
    const snapshot = buildFixtureSnapshot(0);
    const events = [buildFixtureEvent("fe-edge", 7_000, "football/v1/goal", 11)];
    const out = render3dFromSnapshot(build3dRequest(), { snapshot, events });
    expect(out.manifest.skippedMarkers[0]).toMatchObject({ reason: "after-window" });
  });

  test("a marker at exactly the window start is applied (inclusive start)", () => {
    const snapshot = buildFixtureSnapshot(0);
    const events = [buildFixtureEvent("fe-start", 1_000, "football/v1/kickoff", 11)];
    const out = render3dFromSnapshot(build3dRequest(), { snapshot, events });
    expect(out.manifest.skippedMarkers).toEqual([]);
    expect(out.manifest.frames[0]!.appliedMarkerSequences).toEqual([11]);
  });

  test("per-frame marker windows partition [start, end)", () => {
    const out = render3dFromSnapshot(build3dRequest(), fixtureInput());
    // Windows: [1000, 2000) … [6000, 7000).
    expect(out.manifest.frames.map((frame) => frame.windowMs)).toEqual([
      { startMs: 1_000, endMs: 2_000 },
      { startMs: 2_000, endMs: 3_000 },
      { startMs: 3_000, endMs: 4_000 },
      { startMs: 4_000, endMs: 5_000 },
      { startMs: 5_000, endMs: 6_000 },
      { startMs: 6_000, endMs: 7_000 },
    ]);
    // Half-open windows [start, start + interval): kickoff@1000 → f0,
    // pass@2500 → f1, shot@4000 + unknown@4700 → f3, goal@5500 → f4.
    expect(out.manifest.frames.map((frame) => frame.appliedMarkerSequences)).toEqual([
      [11],
      [12],
      [],
      [13, 14],
      [15],
      [],
    ]);
  });

  test("MAX_EVENT_CHIPS: surplus markers are accounted, not displayed", () => {
    expect(MAX_EVENT_CHIPS).toBe(4);
    const snapshot = buildFixtureSnapshot(0);
    const events = [
      buildFixtureEvent("fe-a", 1_100, "football/v1/pass", 11),
      buildFixtureEvent("fe-b", 1_200, "football/v1/pass", 12),
      buildFixtureEvent("fe-c", 1_300, "football/v1/pass", 13),
      buildFixtureEvent("fe-d", 1_400, "football/v1/pass", 14),
      buildFixtureEvent("fe-e", 1_500, "football/v1/pass", 15),
      buildFixtureEvent("fe-f", 1_600, "football/v1/goal", 16),
    ];
    const out = render3dFromSnapshot(build3dRequest(), { snapshot, events });
    const frame = out.manifest.frames[0]!;
    expect(frame.hud.eventChips).toEqual(["Pass", "Pass", "Pass", "Pass"]);
    expect(frame.hud.markersNotDisplayed).toBe(2);
    expect(frame.markers).toHaveLength(6);
    expect(frame.markers.filter((marker) => marker.displayed)).toHaveLength(4);
    // The un-displayed markers still carry their accounting (text + seq).
    expect(frame.markers[4]).toMatchObject({ sequence: 15, displayed: false, text: "Pass" });
    expect(frame.markers[5]).toMatchObject({ sequence: 16, text: "GOAL!" });
  });

  test("simulateDegradation: R7 explicit degradation with the fixed reason", () => {
    const req = build3dRequest({
      styleConfig: {
        styleId: "s",
        configSchemaVersion: "1.0",
        config: { simulateDegradation: true },
      },
    });
    const out = render3dFromSnapshot(req, fixtureInput());
    expect(out.result.rendererHealth).toEqual({
      lagMs: 0,
      degraded: true,
      degradationReason: "simulated-degradation",
    });
  });

  test("degradation reasons join deterministically when both apply", () => {
    const req = build3dRequest({
      styleConfig: {
        styleId: "s",
        configSchemaVersion: "1.0",
        config: { simulateDegradation: true },
      },
    });
    const snapshot = buildFixtureSnapshot(0);
    const events = [buildFixtureEvent("fe-late", 9_000, "football/v1/goal", 11)];
    const out = render3dFromSnapshot(req, { snapshot, events });
    expect(out.result.rendererHealth.degradationReason).toBe(
      "markers-outside-render-window;simulated-degradation",
    );
  });

  test("the manifest camera block records the slot verbatim + the camera constants", () => {
    const out = render3dFromSnapshot(build3dRequest(), fixtureInput());
    expect(out.manifest.camera).toEqual({
      slotId: "main-touchline",
      position: { x: 52.5, y: -25, z: 20 },
      target: { x: 52.5, y: 34, z: 0 },
      focalPx: 512,
      nearPlaneMeters: 0.5,
    });
  });

  test("per-frame provenance links back to the projected scene", () => {
    const out = render3dFromSnapshot(build3dRequest(), fixtureInput());
    const scene = projectScene(buildFixtureSnapshot(0), { events: fixtureMarkerStream() });
    expect(out.manifest.frames[0]!.source).toEqual({
      watermark: { sequence: 10, watermarkMs: 1_000 },
      generatedAtMs: 1_736_164_800_000,
      footballState: true,
      sceneSchemaVersion: "1.0",
    });
    expect(scene.source.watermark).toEqual({ sequence: 10, watermarkMs: 1_000 });
  });

  test("style config selects a different camera slot (the caller frames)", () => {
    const req = build3dRequest({
      styleConfig: {
        styleId: "s",
        configSchemaVersion: "1.0",
        config: { cameraSlotId: "aerial-tactical" },
      },
    });
    const out = render3dFromSnapshot(req, fixtureInput());
    expect(out.manifest.camera.slotId).toBe("aerial-tactical");
    expect(out.frames[0]!.svg).toContain("CAM · aerial-tactical");
  });

  test("an uncarried camera slot fails loud (media-invalid)", () => {
    // A scene projected with a slot SUBSET that omits main-touchline.
    const snapshot = buildFixtureSnapshot(0);
    const scene = projectScene(snapshot, { cameraSlotIds: ["aerial-tactical"] });
    const steps = [{ atMs: 1_000, scene }];
    const req = build3dRequest();
    expect(() => render3dClip(req, steps)).toThrow(RendererContractError);
    expect(() => render3dClip(req, steps)).toThrow(/not among them/);
  });

  test("durationMs shapes the frame count (bounded render work)", () => {
    const req = build3dRequest({
      styleConfig: { styleId: "s", configSchemaVersion: "1.0", config: { durationMs: 2_500 } },
    });
    const out = render3dFromSnapshot(req, fixtureInput());
    expect(out.frames).toHaveLength(3); // ceil(2500/1000)
    expect(out.manifest.frames[2]!.windowMs).toEqual({ startMs: 3_000, endMs: 3_500 });
    expect(out.manifest.output.durationMs).toBe(2_500);
  });
});

describe("render3dFromSnapshot — fail-loud input validation", () => {
  test("a schema-invalid snapshot → media-invalid", () => {
    const req = build3dRequest();
    const bad = { ...buildFixtureSnapshot(0), sessionId: 42 } as never;
    expect(() => render3dFromSnapshot(req, { snapshot: bad, events: [] })).toThrow(
      RendererContractError,
    );
    expect(() => render3dFromSnapshot(req, { snapshot: bad, events: [] })).toThrow(
      /not a valid WorldSnapshot/,
    );
  });

  test("a session mismatch between request and snapshot → media-invalid", () => {
    const req = build3dRequest();
    const other = { ...buildFixtureSnapshot(0), sessionId: "sess-other" };
    expect(() => render3dFromSnapshot(req, { snapshot: other, events: [] })).toThrow(
      /belongs to session "sess-other"/,
    );
  });

  test("a schema-invalid event entry → media-invalid", () => {
    const req = build3dRequest();
    const events = [{ sequence: 11, snapshotVersionAfter: 31 } as never];
    expect(() => render3dFromSnapshot(req, { snapshot: buildFixtureSnapshot(0), events })).toThrow(
      /events\[0\] is not a valid WorldEventStreamEntry/,
    );
  });

  test("an event from another session → media-invalid", () => {
    const req = build3dRequest();
    const foreign = buildFixtureEvent("fe-x", 1_500, "football/v1/goal", 11);
    const event = { ...foreign, event: { ...foreign.event, sessionId: "sess-other" } };
    expect(() =>
      render3dFromSnapshot(req, { snapshot: buildFixtureSnapshot(0), events: [event] }),
    ).toThrow(/belongs to session "sess-other"/);
  });

  test("non-ascending event sequences → media-invalid", () => {
    const req = build3dRequest();
    const events = [
      buildFixtureEvent("fe-a", 1_500, "football/v1/pass", 12),
      buildFixtureEvent("fe-b", 1_600, "football/v1/goal", 11),
    ];
    expect(() => render3dFromSnapshot(req, { snapshot: buildFixtureSnapshot(0), events })).toThrow(
      /strictly ascending/,
    );
  });

  test("events at or below the snapshot watermark sequence → media-invalid", () => {
    const req = build3dRequest();
    // Snapshot 0's watermark sequence is 10; sequence 10 is not > 10.
    const events = [buildFixtureEvent("fe-old", 1_500, "football/v1/pass", 10)];
    expect(() => render3dFromSnapshot(req, { snapshot: buildFixtureSnapshot(0), events })).toThrow(
      /strictly ascending/,
    );
  });

  test("a non-array events input → media-invalid", () => {
    const req = build3dRequest();
    expect(() =>
      render3dFromSnapshot(req, { snapshot: buildFixtureSnapshot(0), events: null as never }),
    ).toThrow(/events must be an array/);
  });

  test("admission is re-run at render time (defense in depth): rights refusal throws", () => {
    const req = build3dRequest({
      rightsCapabilities: DENY_ALL,
      sourceFrameRefs: ["frame-9"],
    });
    expect(() => render3dFromSnapshot(req, fixtureInput())).toThrow(RendererContractError);
    expect(() => render3dFromSnapshot(req, fixtureInput())).toThrow(
      /rights-denied|canReferenceSourceFrames/,
    );
  });
});

describe("render3dFromSnapshot — determinism", () => {
  test("rerun over fresh fixture objects is deep-equal (result + manifest + frames)", () => {
    const a = render3dFromSnapshot(build3dRequest(), fixtureInput());
    const b = render3dFromSnapshot(build3dRequest(), fixtureInput());
    expect(a.result).toEqual(b.result);
    expect(a.manifest).toEqual(b.manifest);
    expect(a.frames).toEqual(b.frames);
    expect(a.frames[0]!.svg).toBe(b.frames[0]!.svg); // byte-identical
  });
});
