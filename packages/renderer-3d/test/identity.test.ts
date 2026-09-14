import { describe, expect, test } from "bun:test";
import {
  AVATAR_FIELD_OUTPUT_PROFILE,
  AVATAR_FIELD_RENDERER_ID,
  AVATAR_FIELD_RENDERER_VERSION,
  DEFAULT_CAMERA_SLOT_ID,
  DEFAULT_DURATION_MS,
  MAX_DURATION_MS,
  MIN_DURATION_MS,
  avatarFieldCapability,
  createAvatarFieldRenderer,
} from "../src/index";

describe("identity — the immutable renderer document (R1)", () => {
  test("pinned identity: avatar-field.prototype@0.1.0", () => {
    expect(AVATAR_FIELD_RENDERER_ID).toBe("avatar-field.prototype");
    expect(AVATAR_FIELD_RENDERER_VERSION).toBe("0.1.0");
  });

  test("capability: procedural-3d, one 1280×720 1 fps svg/offline profile, no source frames", () => {
    const capability = avatarFieldCapability();
    expect(capability.rendererId).toBe("avatar-field.prototype");
    expect(capability.rendererVersion).toBe("0.1.0");
    // The contract's "Procedural/3D renderer" class — literally true here: the
    // plugin projects SWM state into the W601 synthetic 3D scene and renders
    // it with deterministic graphics (a dependency-free perspective camera).
    expect(capability.rendererClass).toBe("procedural-3d");
    expect(capability.supportedOutputProfiles).toEqual([AVATAR_FIELD_OUTPUT_PROFILE]);
    expect(AVATAR_FIELD_OUTPUT_PROFILE).toEqual({
      resolution: { w: 1280, h: 720 },
      frameRate: 1,
      codec: "svg",
      container: "svg",
      latencyClass: "offline",
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
    // A presentation default, NOT a direction policy (W604 directs).
    expect(DEFAULT_CAMERA_SLOT_ID).toBe("main-touchline");
  });
});
