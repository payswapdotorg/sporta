/**
 * THE L011 INTEGRATION TEST — a REAL decoded clip driven through the full
 * live composition, per frame, INCREMENTALLY:
 *
 * ```text
 * generateTestMp4(scene: "pitch") → decode (W102) → detect per frame
 *   (the contrast-context production path) → track → the L011 seam
 *   → LiveObservation (BROADCAST_PERCEPTION) → TemporalBufferEngine (L004)
 *   → LiveSwmUpdater (L003) → the ONE canonical WorldModelEngine
 * ```
 *
 * The L011 acceptance pins: broadcast perception feeds the SAME live
 * observation contract with NO renderer changes (the seam emits observations
 * only) and NO second SWM (the batches flow through the SAME L004 → L003
 * composition into the SAME engine instance the batch path would drive).
 * The clip is the committed-scene-equivalent synthetic pitch (three moving
 * kit-colored players on a uniform green field — real H.264 MP4 bytes from
 * the real ffmpeg; never a committed binary), and the calibration is the
 * test's KNOWN scene geometry (the full frame IS the pitch — injected, never
 * a fabricated calibration result).
 *
 * ffmpeg-gated: skipped honestly when the binary is unavailable (the repo
 * convention).
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { FfmpegTool, generateTestMp4 } from "@sporta/media-platform";
import type { CalibrationResult } from "@sporta/perception-adapters";
import { parseLiveObservation } from "@sporta/live-source";
import type { LiveObservation } from "@sporta/live-source";
import { createTemporalBufferEngine } from "@sporta/live-temporal";
import { createLiveSwmUpdater } from "@sporta/live-swm";
import type { LiveSwmUpdater } from "@sporta/live-swm";
import { WorldModelEngine } from "@sporta/world-model";
import {
  createBroadcastPerceptionClipSource,
  type BroadcastPerceptionClipSource,
} from "../src/index";

const SESSION_ID = "s-perception-live";
const tool = new FfmpegTool();
const hasFfmpeg = await tool.available();

const WORK_DIR = join(import.meta.dir, ".tmp-integration");
const CLIP_PATH = join(WORK_DIR, "pitch-scene.mp4");

/** The known scene geometry: the full frame IS the pitch (injected, documented). */
const FULL_FRAME_CALIBRATION: CalibrationResult = {
  mapping: {
    kind: "field-mapping",
    pitchCorners: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ],
  },
  homography: [105, 0, 0, 0, 68, 0, 0, 0, 1],
  cornerSet: {
    corners: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ],
    cornerOrder: "tl, tr, br, bl",
    confidence: 1,
  },
  confidence: 1,
  correspondenceCount: 4,
};

/** The clip bytes (generated once; cleaned up after the suite). */
let clipBytes: Uint8Array | null = null;
if (hasFfmpeg) {
  mkdirSync(WORK_DIR, { recursive: true });
  await generateTestMp4(CLIP_PATH, {
    scene: "pitch",
    durationSeconds: 2,
    width: 320,
    height: 240,
    frameRate: 24,
    withAudio: false,
  });
  clipBytes = new Uint8Array(await Bun.file(CLIP_PATH).arrayBuffer());
}
afterAll(() => {
  if (hasFfmpeg) rmSync(WORK_DIR, { recursive: true, force: true });
});

/** Drives one source through the full live composition, batch by batch. */
async function driveLiveComposition(source: BroadcastPerceptionClipSource): Promise<{
  engine: WorldModelEngine;
  updater: LiveSwmUpdater;
  batches: LiveObservation[];
  versionAfterEachBatch: number[];
}> {
  const engine = WorldModelEngine.create(SESSION_ID, { now: () => 0 });
  const updater = createLiveSwmUpdater({ sessionId: SESSION_ID, engine });
  const temporal = createTemporalBufferEngine({ sessionId: SESSION_ID });
  const batches: LiveObservation[] = [];
  const versionAfterEachBatch: number[] = [];
  const feed = (drain: ReturnType<typeof temporal.tick>): void => {
    for (const entry of drain.applied) {
      const sourceStats = drain.sources.find((stats) => stats.sourceId === entry.sourceId);
      updater.apply(
        entry.batch,
        sourceStats !== undefined ? { engineWatermark: sourceStats.watermark } : undefined,
      );
      versionAfterEachBatch.push(engine.snapshotVersion);
    }
  };
  let clock = 0;
  for (;;) {
    const planned = source.plannedIngestTimeMs();
    if (planned !== null && planned <= clock) {
      const observation = source.next();
      if (observation !== null) {
        batches.push(observation);
        parseLiveObservation(observation); // every batch parses against the frozen contract
        feed(temporal.admit(observation));
        continue;
      }
    }
    if (source.stats().exhausted) break;
    feed(temporal.tick(clock));
    clock += 20; // sub-frame ticks (24 fps ≈ 41.67 ms): the render clock runs finer than the frames
    if (clock > 10_000_000) break;
  }
  feed(temporal.finalize());
  return { engine, updater, batches, versionAfterEachBatch };
}

describe.skipIf(!hasFfmpeg)("L011 integration: a decoded clip drives the SAME live path", () => {
  test("the clip exists and decodes (the precondition)", () => {
    expect(clipBytes).not.toBeNull();
    expect(clipBytes!.byteLength).toBeGreaterThan(1000);
  });

  test("per-frame perception → LiveObservation → L004 → L003 → the ONE canonical engine", async () => {
    const source = await createBroadcastPerceptionClipSource({
      sessionId: SESSION_ID,
      clipBytes: clipBytes!,
      calibration: FULL_FRAME_CALIBRATION,
    });
    const { engine, updater, batches, versionAfterEachBatch } = await driveLiveComposition(source);

    // -- the perception pass really ran on the real clip ---------------------
    const sourceStats = source.stats();
    expect(sourceStats.framesDecoded).toBeGreaterThan(30); // ~48 frames at 24 fps
    expect(sourceStats.framesWithDetections).toBeGreaterThan(20);
    expect(sourceStats.playerDetections).toBeGreaterThan(60); // ~3 players × most frames
    expect(sourceStats.used.detectorId).toContain("contrast"); // the production path

    // -- the seam's batches are frozen-contract BROADCAST_PERCEPTION ---------
    expect(batches.length).toBeGreaterThan(20);
    for (const batch of batches) {
      expect(batch.sourceType).toBe("BROADCAST_PERCEPTION");
      expect(batch.provenance).toBe("DERIVED");
      for (const row of batch.entityObservations) {
        expect(row.kind).toBe("PLAYER"); // no ball detector injected — honest absence
        // Positions land in the canonical pitch frame (the full-frame
        // calibration maps [0,1]² → 105×68 m).
        expect(row.position.xMeters).toBeGreaterThanOrEqual(0);
        expect(row.position.xMeters).toBeLessThanOrEqual(105);
        expect(row.position.yMeters).toBeGreaterThanOrEqual(0);
        expect(row.position.yMeters).toBeLessThanOrEqual(68);
      }
    }

    // -- INCREMENTAL: the canonical engine's version advances batch by batch -
    // (the SWM updates as frames stream — never a whole-clip batch at the end)
    expect(versionAfterEachBatch.length).toBe(batches.length);
    for (let index = 1; index < versionAfterEachBatch.length; index += 1) {
      expect(versionAfterEachBatch[index]!).toBeGreaterThan(versionAfterEachBatch[index - 1]!);
    }

    // -- the scene's three players exist with identity continuity ------------
    const participants = engine.entityIds;
    expect(participants.length).toBeGreaterThanOrEqual(3);
    const trackerStats = source.stats();
    expect(trackerStats.identitySwitches).toBe(0); // clean disjoint lanes — no apparent switches
    for (const entityId of participants) {
      const entity = engine.entityAt(entityId)!;
      expect(entity.kind).toBe("participant");
      expect(entity.state.position!.status).toBe("uncertain"); // honesty retained
      expect(entity.state.position!.confidence).toBeGreaterThan(0);
      expect(entity.version).toBeGreaterThan(1); // tracked across frames
    }

    // -- NO second SWM: the updater drives THE engine instance ---------------
    expect(updater.worldEngine).toBe(engine);
    expect(updater.stats().appliedBatches).toBe(batches.length);
    expect(updater.stats().invalidBatches).toBe(0);
    expect(updater.stats().duplicateSequence).toBe(0);
  });

  test("determinism: the same clip replays byte-identically through the whole path", async () => {
    const run = async (): Promise<string> => {
      const source = await createBroadcastPerceptionClipSource({
        sessionId: SESSION_ID,
        clipBytes: clipBytes!,
        calibration: FULL_FRAME_CALIBRATION,
      });
      const batches: LiveObservation[] = [];
      for (let batch = source.next(); batch !== null; batch = source.next()) {
        batches.push(batch);
      }
      return JSON.stringify({
        batches,
        stats: source.stats(),
      });
    };
    const first = await run();
    const second = await run();
    expect(second).toBe(first);
  });
});
