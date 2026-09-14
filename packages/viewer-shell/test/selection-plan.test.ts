/**
 * The W703 selection-plan tests — the PURE capability-driven derivation.
 *
 * Every decision `src/selection-plan.ts` makes is pinned here headlessly:
 *
 * - the affordance per listed capability (selectable / blocked) for every
 *   machine reason — `rights-required` (mirrors the plugin R2 gate),
 *   `no-output-profiles` (mirrors the W701 request-build failure),
 *   `unsupported-output` (the viewer's own presentable-output-kinds
 *   surface), and `no-session` (fail-closed: never assume rights);
 * - the reason precedence (server-side gates first);
 * - registry order preservation, verbatim capability pass-through, and ids
 *   that are NEVER matched, branched, or rewritten (synthetic ids flow
 *   through unchanged);
 * - purity (deep-equal rerun, no input mutation) and the deterministic
 *   selection payload;
 * - THE W703 PIN: the plan layer (and the frontend glue that renders it)
 *   contains NO renderer-id literals — a hard-coded renderer list cannot
 *   regress into the selection path.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { RendererCapability, RightsCapabilities } from "@sporta/contracts";
import {
  VIEWER_PRESENTABLE_OUTPUT_KINDS,
  declaredOutputKindsOf,
  deriveRendererOptions,
  selectionRequestOf,
} from "../src/selection-plan.ts";

/** The SVG (presentable) output profile — the anime renderer's declared kind. */
const SVG_PROFILE: RendererCapability["supportedOutputProfiles"][number] = {
  resolution: { w: 1170, h: 880 },
  frameRate: 1,
  codec: "svg",
  container: "svg",
  latencyClass: "offline",
};

/** A non-presentable declared profile (the testcard renderer's kind). */
const H264_PROFILE: RendererCapability["supportedOutputProfiles"][number] = {
  resolution: { w: 1280, h: 720 },
  frameRate: 30,
  codec: "h264",
  container: "mp4",
  latencyClass: "offline",
};

/** Full-allow rights (every capability true). */
const FULL_RIGHTS: RightsCapabilities = {
  canReferenceSourceFrames: true,
  canDeliverLive: true,
  canStoreDerivatives: true,
  canShare: true,
};

/** No source-frame rights, storage granted (renders + playback allowed). */
const NO_FRAME_RIGHTS: RightsCapabilities = {
  canReferenceSourceFrames: false,
  canDeliverLive: false,
  canStoreDerivatives: true,
  canShare: false,
};

/** A capability document builder (synthetic ids — the plan never matches them). */
function capability(overrides: Partial<RendererCapability> = {}): RendererCapability {
  return {
    rendererId: "zzz.synthetic",
    rendererVersion: "0.1.0",
    rendererClass: "procedural-3d",
    supportedOutputProfiles: [SVG_PROFILE],
    requiresSourceFrames: false,
    minSnapshotVersion: 0,
    ...overrides,
  };
}

describe("selection-plan — deriveRendererOptions affordances", () => {
  test("presentable capability + granted rights → selectable (null reason, empty note)", () => {
    const options = deriveRendererOptions([capability()], FULL_RIGHTS);
    expect(options).toHaveLength(1);
    expect(options[0]?.capability).toEqual(capability());
    expect(options[0]?.selectable).toBe(true);
    expect(options[0]?.blockedReason).toBeNull();
    expect(options[0]?.blockedNote).toBe("");
  });

  test("requiresSourceFrames with rights granted → still selectable", () => {
    const options = deriveRendererOptions(
      [capability({ requiresSourceFrames: true })],
      FULL_RIGHTS,
    );
    expect(options[0]?.selectable).toBe(true);
  });

  test("requiresSourceFrames without canReferenceSourceFrames → blocked rights-required", () => {
    const options = deriveRendererOptions(
      [capability({ requiresSourceFrames: true })],
      NO_FRAME_RIGHTS,
    );
    expect(options[0]?.selectable).toBe(false);
    expect(options[0]?.blockedReason).toBe("rights-required");
    expect(options[0]?.blockedNote).toContain("requiresSourceFrames");
    expect(options[0]?.blockedNote).toContain("canReferenceSourceFrames");
  });

  test("empty supportedOutputProfiles → blocked no-output-profiles", () => {
    const options = deriveRendererOptions(
      [capability({ supportedOutputProfiles: [] })],
      FULL_RIGHTS,
    );
    expect(options[0]?.selectable).toBe(false);
    expect(options[0]?.blockedReason).toBe("no-output-profiles");
    expect(options[0]?.blockedNote).toContain("no supported output profiles");
  });

  test("non-presentable declared kinds → blocked unsupported-output (the note names the data)", () => {
    const options = deriveRendererOptions(
      [capability({ supportedOutputProfiles: [H264_PROFILE] })],
      FULL_RIGHTS,
    );
    expect(options[0]?.selectable).toBe(false);
    expect(options[0]?.blockedReason).toBe("unsupported-output");
    // The note names the DECLARED kinds (data), never the renderer identity.
    expect(options[0]?.blockedNote).toContain("h264/mp4");
    expect(options[0]?.blockedNote).toContain("animated-SVG");
  });

  test("multiple declared profiles with at least ONE presentable → selectable", () => {
    const options = deriveRendererOptions(
      [capability({ supportedOutputProfiles: [H264_PROFILE, SVG_PROFILE] })],
      FULL_RIGHTS,
    );
    expect(options[0]?.selectable).toBe(true);
  });

  test("null rights (no session) → every option blocked no-session (fail-closed, never assume)", () => {
    const options = deriveRendererOptions(
      [capability(), capability({ requiresSourceFrames: true })],
      null,
    );
    expect(options).toHaveLength(2);
    for (const option of options) {
      expect(option.selectable).toBe(false);
      expect(option.blockedReason).toBe("no-session");
      expect(option.blockedNote).toContain("open session");
    }
  });

  test("reason precedence: rights-required over unsupported-output (both apply)", () => {
    const options = deriveRendererOptions(
      [capability({ requiresSourceFrames: true, supportedOutputProfiles: [H264_PROFILE] })],
      NO_FRAME_RIGHTS,
    );
    expect(options[0]?.blockedReason).toBe("rights-required");
  });

  test("reason precedence: no-output-profiles over unsupported-output (empty profiles)", () => {
    const options = deriveRendererOptions(
      [capability({ supportedOutputProfiles: [] })],
      FULL_RIGHTS,
    );
    expect(options[0]?.blockedReason).toBe("no-output-profiles");
  });

  test("empty renderer list → empty options", () => {
    expect(deriveRendererOptions([], FULL_RIGHTS)).toEqual([]);
    expect(deriveRendererOptions([], null)).toEqual([]);
  });
});

describe("selection-plan — capability-driven, never id-driven", () => {
  test("registry order preserved; ids pass through VERBATIM (never matched or rewritten)", () => {
    const renderers = [
      capability({ rendererId: "zzz.last", rendererVersion: "9.9.9" }),
      capability({ rendererId: "aaa.first" }),
      capability({
        rendererId: "mmm.blocked",
        supportedOutputProfiles: [H264_PROFILE],
      }),
    ];
    const options = deriveRendererOptions(renderers, FULL_RIGHTS);
    expect(options.map((option) => option.capability.rendererId)).toEqual([
      "zzz.last",
      "aaa.first",
      "mmm.blocked",
    ]);
    expect(options.map((option) => option.capability.rendererVersion)).toEqual([
      "9.9.9",
      "0.1.0",
      "0.1.0",
    ]);
    // Only the declared-data violation is blocked; the arbitrary ids are not.
    expect(options.map((option) => option.selectable)).toEqual([true, true, false]);
    expect(options[2]?.blockedReason).toBe("unsupported-output");
  });

  test("purity: same inputs → deep-equal output; the inputs are never mutated", () => {
    const renderers = [
      capability({ rendererId: "one" }),
      capability({ rendererId: "two", requiresSourceFrames: true }),
    ];
    const snapshot = structuredClone(renderers);
    const first = deriveRendererOptions(renderers, NO_FRAME_RIGHTS);
    const second = deriveRendererOptions(renderers, NO_FRAME_RIGHTS);
    expect(first).toEqual(second);
    expect(renderers).toEqual(snapshot);
  });
});

describe("selection-plan — the selection payload + presentable kinds surface", () => {
  test("selectionRequestOf carries the exact identity pair and NOTHING else", () => {
    const [option] = deriveRendererOptions(
      [capability({ rendererId: "zzz.synthetic", rendererVersion: "0.2.0" })],
      FULL_RIGHTS,
    );
    expect(option).toBeDefined();
    if (option === undefined) throw new Error("unreachable");
    expect(selectionRequestOf(option)).toEqual({
      rendererId: "zzz.synthetic",
      rendererVersion: "0.2.0",
    });
    // Object.keys pins "nothing else": no invented style/variant data.
    expect(Object.keys(selectionRequestOf(option)).sort()).toEqual([
      "rendererId",
      "rendererVersion",
    ]);
  });

  test("declaredOutputKindsOf: deterministic codec/container summary", () => {
    expect(declaredOutputKindsOf(capability())).toBe("svg/svg");
    expect(
      declaredOutputKindsOf(capability({ supportedOutputProfiles: [H264_PROFILE, SVG_PROFILE] })),
    ).toBe("h264/mp4, svg/svg");
    expect(declaredOutputKindsOf(capability({ supportedOutputProfiles: [] }))).toBe("");
  });

  test("the viewer's presentable output kinds are the animated-SVG surface (documented constant)", () => {
    expect(VIEWER_PRESENTABLE_OUTPUT_KINDS).toEqual([{ codec: "svg", container: "svg" }]);
  });
});

describe("selection-plan — THE W703 PIN: no renderer-id literals in the plan layer", () => {
  /**
   * The accept criterion: "renderer selection is capability-driven, not
   * hard-coded into frontend pages." This pin scans the plan layer's source
   * (and the frontend glue that renders it) for the REAL renderer ids and
   * id-class vocabulary — any match would mean a hard-coded renderer list
   * regressed into the selection path.
   */
  const SCANNED_MODULES: string[] = [
    "src/selection-plan.ts",
    "src/dom-plan.ts",
    "src/detail-plan.ts",
    "src/pane-signature.ts",
    "src/viewer-core.ts",
    "web/bootstrap.ts",
  ];

  /** Renderer-id literals (the real registered ids + id-class vocabulary). */
  const RENDERER_ID_LITERALS =
    /anime\.prototype|sporta\.testcard|\banime\b|\btestcard\b|stylized-video|procedural-3d|\btactical\b/i;

  /** Package root: `import.meta.dir` is `<pkg>/test`, so one `dirname` up. */
  const PACKAGE_ROOT = dirname(import.meta.dir);

  test("the plan layer and the frontend glue contain ZERO renderer-id literals", () => {
    for (const modulePath of SCANNED_MODULES) {
      const source = readFileSync(join(PACKAGE_ROOT, modulePath), "utf8");
      const matches = source.match(new RegExp(RENDERER_ID_LITERALS.source, "gi")) ?? [];
      expect(matches, `${modulePath} contains renderer-id literals: ${matches.join(", ")}`).toEqual(
        [],
      );
    }
  });

  test("the scan has teeth: a renderer id in a scanned module would fail it", () => {
    // Self-proof: run the same scan over a string that DOES contain a real
    // renderer id (plus one that does not) — the pin is not vacuous.
    const withId = `renderers.find((r) => r.rendererId === "anime.prototype")`;
    expect(new RegExp(RENDERER_ID_LITERALS.source, "i").test(withId)).toBe(true);
    const withoutId = `deriveRendererOptions(renderers, rights)`;
    expect(new RegExp(RENDERER_ID_LITERALS.source, "i").test(withoutId)).toBe(false);
  });
});
