import { beforeAll, describe, expect, test } from "bun:test";
import { createDeterministicTestHasher } from "@sporta/identity";
import { createSportaServer, installSportaServerForTests } from "../src/server/composition";
import type { SportaServer } from "../src/server/composition";
import { buildWatchModel } from "../src/server/catalog-service";
import type { WatchModelLike } from "../src/lib/api-types";
import {
  buildMatchLabModel,
  formatMatchTime,
  mapCommentary,
  mapEvidence,
  mapTimeline,
} from "../src/lib/match-lab";

/**
 * W907 — the Analyst surface's data mapping: the REAL watch document (the
 * hermetic seed's real engine sessions, renders and stored outputs) mapped
 * through the pure Match Lab projections. Real event tail → timeline,
 * real transcript → commentary segments, real watermarks → SWM evidence;
 * playback-denied sessions map to honest nulls, never a peek.
 */

const NOW_MS = 1_766_666_666_000;
let server: SportaServer;
let derbyWatch: WatchModelLike = null as unknown as WatchModelLike;
let friendlyWatch: WatchModelLike = null as unknown as WatchModelLike;
let trainingWatch: WatchModelLike = null as unknown as WatchModelLike;

beforeAll(async () => {
  server = createSportaServer({
    nowMs: () => NOW_MS,
    passwordHasher: createDeterministicTestHasher(),
    seed: true,
  });
  installSportaServerForTests(server);
  await server.ready;
  for (const sessionId of (await server.control.listSessions()).sessions.map((s) => s.id)) {
    const story = server.storyIndex.get(sessionId);
    const model = (await buildWatchModel(server, sessionId)) as unknown as WatchModelLike;
    if (story?.storyKey === "derby") derbyWatch = model;
    if (story?.storyKey === "friendly") friendlyWatch = model;
    if (story?.storyKey === "training") trainingWatch = model;
  }
});

describe("W907 Match Lab — real event tail → timeline", () => {
  test("the derby session's real event tail maps 1:1 onto timeline markers", () => {
    const tail = derbyWatch.eventTail!;
    expect(tail.length).toBeGreaterThan(0);
    const timeline = mapTimeline(tail);
    expect(timeline.length).toBe(tail.length);
    expect(timeline.every((marker, i) => marker.eventId === tail[i]!.eventId)).toBe(true);
  });

  test("timeline markers sort by match time, then sequence (ties deterministic)", () => {
    const shuffled = [...derbyWatch.eventTail!].reverse();
    const timeline = mapTimeline(shuffled);
    const sorted = [...timeline].sort((a, b) =>
      a.eventTimeMs === b.eventTimeMs ? a.sequence - b.sequence : a.eventTimeMs - b.eventTimeMs,
    );
    expect(timeline).toEqual(sorted);
  });

  test("markers carry the real taxonomy refs and confidences verbatim", () => {
    const timeline = mapTimeline(derbyWatch.eventTail!);
    for (const marker of timeline) {
      expect(marker.eventTypeRef).toMatch(/^[a-z0-9/-]+\/[a-z0-9.-]+$/);
      if (marker.confidence !== undefined) {
        expect(marker.confidence).toBeGreaterThanOrEqual(0);
        expect(marker.confidence).toBeLessThanOrEqual(1);
      }
    }
  });

  test("the buildMatchLabModel timeline is the same real mapping (no drift)", () => {
    const model = buildMatchLabModel(derbyWatch);
    expect(model.timeline).toEqual(mapTimeline(derbyWatch.eventTail!));
  });
});

describe("W907 Match Lab — real transcript → commentary segments", () => {
  test("the derby story's commentary windows map in time order", () => {
    const segments = mapCommentary(derbyWatch.story!.transcript);
    expect(segments.length).toBe(derbyWatch.story!.transcript.length);
    expect(segments.length).toBeGreaterThan(0);
    for (let i = 1; i < segments.length; i += 1) {
      expect(segments[i]!.startMs).toBeGreaterThanOrEqual(segments[i - 1]!.startMs);
    }
  });

  test("segments carry the real text and ASR confidences", () => {
    const segments = mapCommentary(derbyWatch.story!.transcript);
    for (const segment of segments) {
      expect(segment.text.length).toBeGreaterThan(0);
      expect(segment.asrConfidence).toBeGreaterThanOrEqual(0);
      expect(segment.asrConfidence).toBeLessThanOrEqual(1);
    }
  });

  test("the friendly story's transcript maps too (its real extraction can be empty — honest)", () => {
    const segments = mapCommentary(friendlyWatch.story!.transcript);
    expect(Array.isArray(segments)).toBe(true);
    // The friendly story's real transcript windows exist (3 per its spec).
    expect(segments.length).toBeGreaterThan(0);
  });
});

describe("W907 Match Lab — real render watermarks → SWM evidence", () => {
  test("evidence rows are 1:1 with the renders and carry real watermarks", () => {
    const evidence = mapEvidence(derbyWatch.renders)!;
    expect(evidence.length).toBe(derbyWatch.renders!.length);
    expect(evidence.length).toBeGreaterThan(0);
    for (const row of evidence) {
      expect(row.renderId).toMatch(/^r-/);
      expect(row.watermarkSequence).toBeGreaterThan(0);
      expect(row.snapshotVersion).toBeGreaterThan(0);
      expect(row.lastEventSequence).toBeGreaterThanOrEqual(0);
    }
  });

  test("a degraded renderer's health surfaces in its evidence row", () => {
    const evidence = mapEvidence([
      {
        renderId: "r-test",
        rendererId: "sporta.testcard",
        watermarkAfter: { watermarkMs: 12_000, sequence: 7 },
        provenance: { snapshotVersion: 3, lastEventSequence: 6 },
        rendererHealth: { lagMs: 900, degraded: true, degradationReason: "lag-exceeded" },
      },
    ])!;
    expect(evidence[0]!.rendererDegraded).toBe(true);
    expect(evidence[0]!.degradationReason).toBe("lag-exceeded");
  });

  test("a playback-denied session maps to null evidence — never a peek", () => {
    expect(mapEvidence(null)).toBeNull();
  });
});

describe("W907 Match Lab — the honest whole-model mapping", () => {
  test("the derby model carries its real story source and wave count", () => {
    const model = buildMatchLabModel(derbyWatch);
    expect(model.storySource).toBe("dev-seed");
    expect(model.waveCount).toBe(6); // the real fusion-wave count the engine produced
    expect(model.label.length).toBeGreaterThan(0);
    expect(model.sessionId).toBe(derbyWatch.sessionId);
  });

  test("the training session (playback denied) maps to honest nulls", () => {
    // The training story's policy denies derivative storage: playback is
    // denied, and the watch model reveals NOTHING (event tail, transcript,
    // renders all null) — the Match Lab projection must not peek either.
    expect(trainingWatch.playback.state).toBe("denied");
    const model = buildMatchLabModel(trainingWatch);
    expect(model.timeline).toBeNull();
    expect(model.commentary).toBeNull();
    expect(model.evidence).toBeNull();
    expect(model.storySource).toBeNull();
  });

  test("match-time formatting is deterministic and clamped", () => {
    expect(formatMatchTime(0)).toBe("0:00.000");
    expect(formatMatchTime(65_432)).toBe("1:05.432");
    expect(formatMatchTime(-5)).toBe("0:00.000");
    expect(formatMatchTime(600_000)).toBe("10:00.000");
  });
});
