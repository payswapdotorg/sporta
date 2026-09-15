import { describe, expect, test } from "bun:test";
import {
  AVATAR_FIELD_ANIMATED_OUTPUT_PROFILE,
  AVATAR_FIELD_GAME_OUTPUT_PROFILE,
  AVATAR_FIELD_OUTPUT_PROFILE,
  AVATAR_FIELD_RENDERER_ID,
  AVATAR_FIELD_RENDERER_VERSION,
  DEFAULT_CAMERA_SLOT_ID,
  DEFAULT_DURATION_MS,
  MAX_DURATION_MS,
  MAX_RENDER_FRAMES,
  MIN_DURATION_MS,
  avatarFieldCapability,
  createAvatarFieldRenderer,
} from "../src/index";

describe("identity — the immutable renderer document (R1)", () => {
  test("pinned identity: avatar-field.prototype@0.2.0 (the W603 bump)", () => {
    expect(AVATAR_FIELD_RENDERER_ID).toBe("avatar-field.prototype");
    expect(AVATAR_FIELD_RENDERER_VERSION).toBe("0.2.0");
  });

  test("capability: procedural-3d, three 1280×720 svg/offline profiles (1/5/25 fps), no source frames", () => {
    const capability = avatarFieldCapability();
    expect(capability.rendererId).toBe("avatar-field.prototype");
    expect(capability.rendererVersion).toBe("0.2.0");
    // The contract's "Procedural/3D renderer" class — literally true here: the
    // plugin projects SWM state into the W601 synthetic 3D scene and renders
    // it with deterministic graphics (a dependency-free perspective camera;
    // W603 interpolation is still pure arithmetic, no engine).
    expect(capability.rendererClass).toBe("procedural-3d");
    // The W602 1 fps profile stays FIRST (historical default); the W603
    // animated profiles follow (profile order is capability data, not
    // preference).
    expect(capability.supportedOutputProfiles).toEqual([
      AVATAR_FIELD_OUTPUT_PROFILE,
      AVATAR_FIELD_ANIMATED_OUTPUT_PROFILE,
      AVATAR_FIELD_GAME_OUTPUT_PROFILE,
    ]);
    expect(AVATAR_FIELD_OUTPUT_PROFILE).toEqual({
      resolution: { w: 1280, h: 720 },
      frameRate: 1,
      codec: "svg",
      container: "svg",
      latencyClass: "offline",
    });
    expect(AVATAR_FIELD_ANIMATED_OUTPUT_PROFILE).toEqual({
      ...AVATAR_FIELD_OUTPUT_PROFILE,
      frameRate: 5,
    });
    expect(AVATAR_FIELD_GAME_OUTPUT_PROFILE).toEqual({
      ...AVATAR_FIELD_OUTPUT_PROFILE,
      frameRate: 25,
    });
    expect(capability.requiresSourceFrames).toBe(false);
    expect(capability.minSnapshotVersion).toBe(0);
  });

  test("capability() returns deep-equal documents on every call (R1)", () => {
    expect(avatarFieldCapability()).toEqual(avatarFieldCapability());
    expect(avatarFieldCapability()).not.toBe(avatarFieldCapability()); // fresh clone per call
  });

  test("pluginKind brands the renderer plugin contract", () => {
    expect(createAvatarFieldRenderer().pluginKind).toBe("sporta-renderer");
  });

  test("style-config defaults are the documented constants", () => {
    expect(DEFAULT_DURATION_MS).toBe(6_000);
    expect(MIN_DURATION_MS).toBe(1);
    expect(MAX_DURATION_MS).toBe(3_600_000);
    // The universal per-render frame budget (the W602 worst case: 1 fps ×
    // the max duration; now bounds every profile — W603).
    expect(MAX_RENDER_FRAMES).toBe(3_600);
    // A presentation default, NOT a direction policy (W604 directs).
    expect(DEFAULT_CAMERA_SLOT_ID).toBe("main-touchline");
  });
});
