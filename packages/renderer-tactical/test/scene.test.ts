import { describe, expect, test } from "bun:test";
import { projectScene } from "@sporta/scene-projection";
import { buildWorldSnapshot } from "@sporta/testing";
import { FrameBuffer } from "../src/canvas";
import { drawTacticalFrame } from "../src/draw";
import { buildTacticalView } from "../src/scene";
import {
  SYNTHETIC_FIXTURE_LABEL,
  buildSyntheticTacticalEvents,
  buildSyntheticTacticalSnapshot,
} from "./helpers";

const snapshot = buildSyntheticTacticalSnapshot();
const events = buildSyntheticTacticalEvents();
const scene = projectScene(snapshot, { events });
const view = buildTacticalView(scene);

describe("buildTacticalView over the canonical scene (synthetic-diagnostic)", () => {
  test("places every projected entity and keeps out-of-bounds TRUE coordinates", () => {
    expect(view.sessionId).toBe("sess-tactical-synthetic");
    expect(view.entities).toHaveLength(13);
    const ids = view.entities.map((e) => e.entityId);
    expect(ids).toContain("ball-1");
    expect(ids).toContain("keeper-1");
    const sub = view.entities.find((e) => e.entityId === "sub-14")!;
    expect(sub.outOfBounds).toBe(true);
    expect(sub.x).toBe(108);
    expect(sub.y).toBe(71);
  });

  test("carries verbatim uncertainty and heading slots", () => {
    const striker = view.entities.find((e) => e.entityId === "striker-9")!;
    expect(striker.status).toBe("uncertain");
    expect(striker.confidence).toBe(0.83);
    const keeper = view.entities.find((e) => e.entityId === "keeper-1")!;
    expect(keeper.status).toBe("known");
    expect(keeper.headingRadians).toBe(0);
    expect(view.ball?.status).toBe("uncertain");
    expect(view.ball?.confidence).toBe(0.91);
  });

  test("event badges are the verbatim markers (with the correction flagged)", () => {
    expect(view.eventBadges).toHaveLength(5);
    expect(view.eventBadges.map((b) => b.eventId)).toEqual([
      "fe-tac-1",
      "fe-tac-2",
      "fe-tac-3",
      "fe-tac-4",
      "fe-tac-5",
    ]);
    expect(view.eventBadges[3]!.label).toBe("GOAL");
    expect(view.eventBadges[4]!.isCorrection).toBe(true);
  });

  test("the score clock block is the verbatim football state", () => {
    expect(view.scoreClock.footballState).toBe(true);
    expect(view.scoreClock.home).toBe(2);
    expect(view.scoreClock.away).toBe(1);
    expect(view.scoreClock.scoreStatus).toBe("known");
    expect(view.scoreClock.clockPeriod).toBe("second-half");
    expect(view.scoreClock.clockMs).toBe(2_704_000);
    expect(view.scoreClock.possessionEntityId).toBe("striker-9");
  });

  test("unplaced entities are accounted by disposition, never silently dropped", () => {
    // The builder default snapshot has a player with an UNKNOWN position.
    const bare = buildTacticalView(projectScene(buildWorldSnapshot(), {}));
    expect(bare.unplacedByDisposition["omitted-no-position"]).toBeGreaterThanOrEqual(1);
    expect(bare.entities.every((e) => e.status !== "unknown")).toBe(true);
  });

  test("determinism: the same scene yields a deep-equal view", () => {
    const again = buildTacticalView(projectScene(snapshot, { events }));
    expect(again).toEqual(view);
  });
});

describe("drawTacticalFrame (the frame painter)", () => {
  test("paints non-trivial, deterministic frames that evolve with elapsedMs", () => {
    const paint = (elapsedMs: number): Buffer => {
      const buffer = new FrameBuffer(640, 360);
      drawTacticalFrame(buffer, {
        scene,
        view,
        elapsedMs,
        durationMs: 4_000,
        videoOriginMs: 30_000,
      });
      return Buffer.from(buffer.data);
    };
    const frame0 = paint(0);
    const frame0again = paint(0);
    const frameMid = paint(3_999);

    // Non-trivial: many distinct colors on the pitch/overlay.
    const colors = new Set<string>();
    for (let i = 0; i < frame0.length; i += 3) {
      colors.add(`${frame0[i]},${frame0[i + 1]},${frame0[i + 2]}`);
    }
    expect(colors.size).toBeGreaterThan(10);

    // Deterministic at a fixed time; the timeline/progress makes later
    // frames differ (the clip is animated by presentation state only).
    expect(Buffer.compare(frame0, frame0again)).toBe(0);
    expect(Buffer.compare(frame0, frameMid)).not.toBe(0);
  });

  test("event badges appear only after their event time is due", () => {
    const countBadgeCells = (elapsedMs: number): number => {
      const buffer = new FrameBuffer(640, 360);
      drawTacticalFrame(buffer, {
        scene,
        view,
        elapsedMs,
        durationMs: 4_000,
        videoOriginMs: 30_000,
      });
      // Count badge cells by scanning the overlay band for the badge-frame
      // color rows: a badge cell paints an 18px-tall panel starting at
      // height - 46 + 6. We look for any of the badge colors there.
      let badgePixels = 0;
      const bandStart = (buffer.height - 46 + 6) * buffer.width * 3;
      for (let i = bandStart; i < buffer.data.length; i += 3) {
        const r = buffer.data[i]!;
        const g = buffer.data[i + 1]!;
        const b = buffer.data[i + 2]!;
        if (r === 214 && g === 79 && b === 79) badgePixels += 1; // GOAL red
      }
      return badgePixels;
    };
    // The goal fires at 32_400ms = 2_400ms into the clip.
    expect(countBadgeCells(0)).toBe(0);
    expect(countBadgeCells(2_399)).toBe(0);
    expect(countBadgeCells(2_400)).toBeGreaterThan(0);
  });

  test(`is labeled ${SYNTHETIC_FIXTURE_LABEL}: the session tag renders the SWM version`, () => {
    const buffer = new FrameBuffer(640, 360);
    drawTacticalFrame(buffer, {
      scene,
      view,
      elapsedMs: 0,
      durationMs: 4_000,
      videoOriginMs: 30_000,
    });
    // The top-left tag carries the session id prefix (rendered pixels exist).
    let tagPixels = 0;
    for (let y = 12; y < 21; y += 1) {
      for (let x = 13; x < 13 + 200; x += 1) {
        const [r, g, b] = buffer.getPixel(x, y);
        if (r !== 18 || g !== 22 || b !== 26) tagPixels += 1;
      }
    }
    expect(tagPixels).toBeGreaterThan(10);
  });
});
