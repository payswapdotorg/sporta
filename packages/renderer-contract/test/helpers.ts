/**
 * Deterministic mock renderers for the renderer-contract tests.
 *
 * `makeSaneRenderer` is a fully conformant minimal plugin (a second, simpler
 * reference implementation). Every negative-conformance mock is a sane
 * renderer with exactly one broken aspect, so each test failure can be
 * attributed to precisely one contract rule. All values are fixed constants
 * — no `Math.random`, no `Date.now` (docs/testing/HARNESS.md).
 */
import type {
  RenderRequest,
  RenderResult,
  RendererCapability,
  RendererHealth,
} from "@sporta/contracts";
import { RendererContractError } from "../src/errors";
import { cloneJson, deepEqual } from "../src/internal";
import type { RendererPlugin } from "../src/plugin";
import type { RenderInput, RequestValidation } from "../src/types";

// Re-exported for the test files (JSON-safe deep clone of capability docs).
export { cloneJson };

export const SANE_RENDERER_ID = "mock.sane";
export const SANE_RENDERER_VERSION = "0.1.0";

/** The single supported profile of the sane mock. */
export const SANE_PROFILE = {
  resolution: { w: 640, h: 360 },
  frameRate: 25,
  codec: "h264",
  container: "mp4",
  latencyClass: "offline",
} as const;

/** The (valid) capability document of the sane mock. */
export const SANE_CAPABILITY: RendererCapability = {
  rendererId: SANE_RENDERER_ID,
  rendererVersion: SANE_RENDERER_VERSION,
  rendererClass: "tactical",
  supportedOutputProfiles: [SANE_PROFILE],
  requiresSourceFrames: false,
  minSnapshotVersion: 1,
};

/** Options for {@link makeSaneRenderer} — each one breaks exactly one thing. */
export interface SaneRendererOptions {
  /** What `capability()` returns (default: SANE_CAPABILITY). */
  capability?: RendererCapability;
  /**
   * The capability whose gates validate/render enforce. Defaults to
   * `capability`; decouple only for mocks whose capability DOCUMENT is broken
   * while their behavior stays sane (e.g. BadCapability).
   */
  gatesCapability?: RendererCapability;
  /** Replaces `validateRequest` entirely (default: `saneValidate`). */
  validateRequest?: (req: RenderRequest) => RequestValidation;
  /** When false, `render` skips its defense-in-depth validation (default true). */
  renderValidates?: boolean;
  /** Decorates the sane render result (identity, provenance, segments, ...). */
  decorateResult?: (req: RenderRequest, input: RenderInput, base: RenderResult) => RenderResult;
  /** Replaces the default dispose (which is terminal); use for Zombie mocks. */
  dispose?: () => void;
}

/**
 * The sane validation: identity, output-profile, snapshot-version and (when
 * the capability requires source frames) fail-closed rights gates — R2/R3.
 * Gates can be individually skipped to build negative mocks.
 */
export function saneValidate(
  req: RenderRequest,
  capability: RendererCapability,
  opts: { skipProfileGate?: boolean; skipRightsGate?: boolean } = {},
): RequestValidation {
  if (
    req.rendererId !== capability.rendererId ||
    req.rendererVersion !== capability.rendererVersion
  ) {
    return {
      ok: false,
      reason: `request targets ${req.rendererId}@${req.rendererVersion}, this mock is ${capability.rendererId}@${capability.rendererVersion}`,
      failureClass: "media-invalid",
    };
  }
  const expectedProfile = capability.supportedOutputProfiles[0] ?? SANE_PROFILE;
  if (!opts.skipProfileGate && !deepEqual(req.outputProfile, expectedProfile)) {
    return {
      ok: false,
      reason: "outputProfile is not supported by this mock",
      failureClass: "media-invalid",
    };
  }
  if (req.snapshotVersion < capability.minSnapshotVersion) {
    return {
      ok: false,
      reason: `snapshotVersion ${req.snapshotVersion} is below the minimum ${capability.minSnapshotVersion}`,
      failureClass: "media-invalid",
    };
  }
  if (
    !opts.skipRightsGate &&
    capability.requiresSourceFrames &&
    !req.rightsCapabilities.canReferenceSourceFrames
  ) {
    return {
      ok: false,
      reason: "mock requires source frames but canReferenceSourceFrames is false",
      failureClass: "rights-denied",
    };
  }
  return { ok: true };
}

/**
 * The sane render result: echoes the request identity, three non-overlapping
 * segments after the snapshot watermark, full event application (R5),
 * R6 watermark, healthy renderer (R7), and R8-compliant shape.
 */
export function saneRenderResult(req: RenderRequest, input: RenderInput): RenderResult {
  const startMs = input.snapshot.watermark.watermarkMs;
  const lastEventSequence =
    input.events.length > 0 ? input.events[input.events.length - 1]!.sequence : 0;
  const watermarkSequence =
    input.events.length > 0 ? lastEventSequence : input.snapshot.watermark.sequence;
  return {
    sessionId: req.sessionId,
    rendererId: req.rendererId,
    outputSegments: [0, 1, 2].map((index) => ({
      segmentId: `sane-${index}`,
      startMs: startMs + index * 2000,
      endMs: startMs + (index + 1) * 2000,
      artifactRef: `sane://${req.sessionId}/${req.snapshotVersion}/${index}`,
    })),
    watermarkAfter: { watermarkMs: startMs + 6000, sequence: watermarkSequence },
    rendererHealth: { lagMs: 0, degraded: false },
    quality: { temporalConsistencyScore: 1 },
    provenance: { snapshotVersion: req.snapshotVersion, lastEventSequence },
  };
}

/**
 * Builds a fully conformant mock renderer. Combine the options to produce a
 * plugin that violates exactly one contract rule (see conformance.test.ts).
 */
export function makeSaneRenderer(options: SaneRendererOptions = {}): RendererPlugin {
  const capability = options.capability ?? SANE_CAPABILITY;
  const gates = options.gatesCapability ?? capability;
  let disposed = false;
  const render = (req: RenderRequest, input: RenderInput): RenderResult => {
    if (disposed) {
      throw new RendererContractError("sane mock is disposed; render refused", "internal", {
        rendererId: gates.rendererId,
        sessionId: req.sessionId,
      });
    }
    if (options.renderValidates !== false) {
      // Defense in depth: render re-runs every gate (R2/R3).
      const validation = saneValidate(req, gates);
      if (!validation.ok) {
        throw new RendererContractError(
          `render refused: ${validation.reason}`,
          validation.failureClass,
          {
            rendererId: gates.rendererId,
            sessionId: req.sessionId,
          },
        );
      }
    }
    const base = saneRenderResult(req, input);
    return options.decorateResult ? options.decorateResult(req, input, base) : base;
  };
  return {
    pluginKind: "sporta-renderer",
    capability: () => cloneJson(capability), // R1: deep-equal stable
    init: () => undefined,
    validateRequest: (req) =>
      options.validateRequest ? options.validateRequest(req) : saneValidate(req, gates),
    render,
    health: (): RendererHealth => ({ lagMs: 0, degraded: false }),
    dispose: () => {
      if (options.dispose) {
        options.dispose();
      } else {
        disposed = true; // terminal by default
      }
    },
  };
}
