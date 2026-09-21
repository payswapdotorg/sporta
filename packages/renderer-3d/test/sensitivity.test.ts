import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Software3DEngine } from "../src/index";
import { SCHEMA_VERSION } from "@sporta/contracts";
import { SESSION_ID, ALLOW_ALL, buildFixtureSnapshot, buildFixtureEvents } from "./game/helpers";

/**
 * THE DERIVED-REALITY RENDERER SENSITIVITY TESTS (J013, renderer side) —
 * BOTH game realities (stylized-3d AND cel-shaded/anime-NPR) respond to
 * MEANINGFUL SWM differences with DIFFERENT rendered frames, and
 * equivalent SWMs render IDENTICAL frames (the deterministic equivalence).
 *
 * WHY THIS LEVEL: the apps/web J013 battery proves the gate end-to-end
 * through the REAL pipeline (upload → perception → SWM → dispatch → real
 * MP4 artifacts) for the tactical and 3D realities — and, since the Wave-3
 * anime-budget resolution (the "on twos" default profile — 12 fps — that
 * brings the populated-pitch cel-shaded default render under the compute
 * plane's fail-closed 1 MB artifact budget; the previous 25 fps default
 * measured 1 038 993–1 082 922 bytes, OVER), for the Anime/NPR reality too.
 * THIS test keeps proving the RENDERER-side sensitivity directly — the same
 * engine, the same styles, driven with two materially different canonical
 * SWMs — independent of the app battery (no budget in this path).
 *
 * REAL-vs-FIXTURE: FIXTURE SWM snapshots (the @sporta/testing builder +
 * the canonical game fixtures — deterministic, no clock/RNG); REAL engine
 * + REAL frame staging (the actual rgb24 frames the bridge encodes).
 */

function buildRequest(style: "stylized-3d" | "cel-shaded") {
  return {
    schemaVersion: SCHEMA_VERSION,
    sessionId: SESSION_ID,
    snapshotVersion: 1,
    renderingStyle: style,
  } as const;
}

/** Renders one scene's staged frames and answers their content hashes. */
function renderFrameHashes(options: {
  style: "stylized-3d" | "cel-shaded";
  snapshot: ReturnType<typeof buildFixtureSnapshot>;
  events: ReturnType<typeof buildFixtureEvents>;
}): { frameHashes: string[]; frameCount: number; sceneId: string } {
  const engine = new Software3DEngine();
  try {
    const handle = engine.buildScene(buildRequest(options.style), options.snapshot, options.events);
    const result = engine.renderScene({
      schemaVersion: SCHEMA_VERSION,
      sceneId: handle.sceneId,
      outputProfile: {
        widthPx: 320,
        heightPx: 180,
        fps: 10,
        durationMs: 1_000,
        format: "frames-rgb24",
      },
      presentation: { camera: "aerial-follow", seed: "3" },
    });
    if (result.output.kind !== "frame-output") throw new Error("expected frame output");
    // The staged output is ONE concatenated rgb24 buffer (frameCount frames
    // of width×height×3) — hash each frame's slice for per-frame evidence.
    const staged = readFileSync(result.output.stagingRef);
    const frameBytes = result.output.widthPx * result.output.heightPx * 3;
    expect(staged.length).toBe(frameBytes * result.output.frameCount);
    const hashes: string[] = [];
    for (let index = 0; index < result.output.frameCount; index += 1) {
      hashes.push(
        createHash("sha256")
          .update(staged.subarray(index * frameBytes, (index + 1) * frameBytes))
          .digest("hex"),
      );
    }
    return { frameHashes: hashes, frameCount: result.output.frameCount, sceneId: handle.sceneId };
  } finally {
    engine.dispose();
  }
}

/** Two materially different SWMs over the canonical fixture (J013 premise):
 *  the SAME entity identities at DIFFERENT pitch positions (a real
 *  positional difference — the class of difference the perception chain
 *  produces on different clips), plus a score difference. Built by
 *  transforming the VALIDATED base snapshot directly (the deep-merge
 *  helper replaces entity arrays wholesale — the transform keeps every
 *  required field structurally intact). */
function materiallyDifferentSnapshot(): ReturnType<typeof buildFixtureSnapshot> {
  const base = buildFixtureSnapshot();
  const moveTo = (entityId: string, x: number, y: number, confidence = 0.85) => {
    const entity = base.entities.find((candidate) => candidate.entityId === entityId);
    if (entity === undefined) throw new Error(`fixture entity ${entityId} not found`);
    entity.state["pitchPosition"] = { status: "known", value: { x, y }, confidence };
  };
  moveTo("ball-1", 12.5, 55, 0.9);
  entityHeightOf(base, "ball-1", 1.8);
  moveTo("player-2", 20, 10);
  moveTo("player-8", 95, 60, 0.75);
  return {
    ...base,
    entities: [...base.entities],
    football: base.football
      ? {
          ...base.football,
          score: { home: 3, away: 1, status: { status: "known", value: "confirmed" } },
        }
      : undefined,
  };
}

/** Adjusts one entity's height slot (the ball's airborne carry). */
function entityHeightOf(
  snapshot: ReturnType<typeof buildFixtureSnapshot>,
  entityId: string,
  height: number,
): void {
  const entity = snapshot.entities.find((candidate) => candidate.entityId === entityId);
  if (entity === undefined) throw new Error(`fixture entity ${entityId} not found`);
  entity.state["height"] = { status: "known", value: height, confidence: 0.7 };
}

describe("the game renderers' SWM sensitivity (J013 — renderer side)", () => {
  const STYLES: ReadonlyArray<{ style: "stylized-3d" | "cel-shaded"; label: string }> = [
    { style: "stylized-3d", label: "stylized-3d (the 3D Game reality)" },
    { style: "cel-shaded", label: "cel-shaded (the Anime/NPR reality)" },
  ];

  for (const { style, label } of STYLES) {
    describe(label, () => {
      test("meaningfully different SWMs → DIFFERENT rendered frames", () => {
        const left = renderFrameHashes({
          style,
          snapshot: buildFixtureSnapshot(),
          events: buildFixtureEvents(),
        });
        const right = renderFrameHashes({
          style,
          snapshot: materiallyDifferentSnapshot(),
          events: buildFixtureEvents(),
        });
        expect(left.frameCount).toBe(10);
        expect(right.frameCount).toBe(10);
        // The frame CONTENT differs (different worlds, different pictures).
        expect(left.frameHashes).not.toEqual(right.frameHashes);
        let differing = 0;
        for (let index = 0; index < left.frameHashes.length; index += 1) {
          if (left.frameHashes[index] !== right.frameHashes[index]) differing += 1;
        }
        // The difference is visible across the window (the camera follows
        // the changed state; at minimum several frames differ).
        expect(differing).toBeGreaterThan(2);
      });

      test("the SAME SWM → IDENTICAL frames (the deterministic equivalence)", () => {
        const left = renderFrameHashes({
          style,
          snapshot: buildFixtureSnapshot(),
          events: buildFixtureEvents(),
        });
        const right = renderFrameHashes({
          style,
          snapshot: buildFixtureSnapshot(),
          events: buildFixtureEvents(),
        });
        expect(left.frameHashes).toEqual(right.frameHashes);
      });
    });
  }

  test("the two styles render the SAME world differently (the realities differ from each other)", () => {
    const stylized = renderFrameHashes({
      style: "stylized-3d",
      snapshot: buildFixtureSnapshot(),
      events: buildFixtureEvents(),
    });
    const celShaded = renderFrameHashes({
      style: "cel-shaded",
      snapshot: buildFixtureSnapshot(),
      events: buildFixtureEvents(),
    });
    // ADR-009: the SAME SWM, the SAME projection, DIFFERENT presentation
    // styles — the two derived realities are visually distinct products.
    expect(stylized.frameHashes).not.toEqual(celShaded.frameHashes);
  });
});

// The rights constant is part of the canonical fixture discipline.
void ALLOW_ALL;

beforeAll(() => {
  // (No shared state — each test builds its own engine + disposes it.)
});
afterAll(() => {
  // (Each test's engine disposal already ran in its finally block.)
});
