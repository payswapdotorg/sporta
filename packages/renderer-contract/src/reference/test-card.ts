/**
 * The reference renderer for the plugin contract (W501): a deterministic
 * "test card" renderer.
 *
 * This module exists to PROVE the {@link RendererPlugin} interface is
 * implementable against `@sporta/contracts` types only — no SWM-core
 * modification, no graphics/ML frameworks (those arrive with W502+), no
 * encoding, no fs, no network. `artifactRef`s are opaque URIs
 * (`testcard://<sessionId>/<snapshotVersion>/<index>`); "rendering" is the
 * deterministic synthesis of a timeline of segments starting at the snapshot
 * watermark.
 *
 * Determinism: `render` is a pure function of `(req, input)` — no RNG, no
 * clock reads — so the same request over the same input yields a deep-equal
 * result on every call and across plugin instances. The only side effects
 * are the observability seam (one structured log line per render call, level
 * `info`, carrying `sessionId` and stage `"render"`; counters
 * `render_requests_total` and `render_failures_total` bumped on refusal),
 * which is a no-op when the host provided no seam.
 *
 * Style configuration (`styleConfig.config`): `{ durationMs?: number
 * (default 10000, min 1), segmentMs?: number (default 2000, min 1),
 * simulateDegradation?: boolean }`. Unknown keys are ignored; invalid values
 * are rejected by `validateRequest` with failureClass `"media-invalid"`.
 *
 * Provenance/watermark semantics: all input events are applied, so
 * `provenance.lastEventSequence` is the last input event's sequence (R5,
 * `0` when no events were passed) and `watermarkAfter.sequence` follows R6
 * (last event sequence, or the snapshot watermark sequence without events).
 * `simulateDegradation: true` flips `rendererHealth.degraded` with the
 * reason `"simulated-degradation"` (R7's explicit-degradation pattern).
 */
import type {
  OutputProfile,
  RenderRequest,
  RenderResult,
  RendererCapability,
  RendererHealth,
} from "@sporta/contracts";
import type { Logger } from "@sporta/observability";
import { RendererContractError } from "../errors";
import { cloneJson, deepEqual, isRecord } from "../internal";
import type { RendererPlugin } from "../plugin";
import type { Metrics, RenderInput, RendererContext, RequestValidation } from "../types";

const RENDERER_ID = "sporta.testcard";
const RENDERER_VERSION = "0.1.0";

/** The single supported output profile of the test card renderer. */
export const TESTCARD_OUTPUT_PROFILE: OutputProfile = {
  resolution: { w: 1280, h: 720 },
  frameRate: 30,
  codec: "h264",
  container: "mp4",
  latencyClass: "offline",
};

/** The immutable capability document (cloned on every `capability()` call). */
const CAPABILITY: RendererCapability = {
  rendererId: RENDERER_ID,
  rendererVersion: RENDERER_VERSION,
  rendererClass: "tactical",
  supportedOutputProfiles: [TESTCARD_OUTPUT_PROFILE],
  requiresSourceFrames: false,
  minSnapshotVersion: 0,
};

const DEFAULT_DURATION_MS = 10_000;
const DEFAULT_SEGMENT_MS = 2_000;

/** Parsed `styleConfig.config` for the test card renderer. */
interface TestCardConfig {
  durationMs: number;
  segmentMs: number;
  simulateDegradation: boolean;
}

/** Renders a human-readable description of an unknown config value. */
function describeValue(value: unknown): string {
  if (typeof value === "string") return `string "${value}"`;
  if (typeof value === "number") return `number ${String(value)}`;
  if (typeof value === "boolean") return `boolean ${String(value)}`;
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

/**
 * Parses `styleConfig.config` into a {@link TestCardConfig}. `undefined`
 * means all defaults; a non-object config is rejected. `durationMs` and
 * `segmentMs` must be finite numbers >= 1; `simulateDegradation` must be a
 * boolean. Unknown keys are ignored by design (forward-compatible style
 * configuration).
 */
function parseStyleConfig(
  config: unknown,
): { ok: true; value: TestCardConfig } | { ok: false; reason: string } {
  if (config === undefined) {
    return {
      ok: true,
      value: {
        durationMs: DEFAULT_DURATION_MS,
        segmentMs: DEFAULT_SEGMENT_MS,
        simulateDegradation: false,
      },
    };
  }
  if (!isRecord(config)) {
    return {
      ok: false,
      reason: `styleConfig.config must be an object (got ${describeValue(config)})`,
    };
  }
  let durationMs = DEFAULT_DURATION_MS;
  let segmentMs = DEFAULT_SEGMENT_MS;
  let simulateDegradation = false;
  if (config.durationMs !== undefined) {
    if (
      typeof config.durationMs !== "number" ||
      !Number.isFinite(config.durationMs) ||
      config.durationMs < 1
    ) {
      return {
        ok: false,
        reason: `styleConfig.config.durationMs must be a finite number >= 1 (got ${describeValue(config.durationMs)})`,
      };
    }
    durationMs = config.durationMs;
  }
  if (config.segmentMs !== undefined) {
    if (
      typeof config.segmentMs !== "number" ||
      !Number.isFinite(config.segmentMs) ||
      config.segmentMs < 1
    ) {
      return {
        ok: false,
        reason: `styleConfig.config.segmentMs must be a finite number >= 1 (got ${describeValue(config.segmentMs)})`,
      };
    }
    segmentMs = config.segmentMs;
  }
  if (config.simulateDegradation !== undefined) {
    if (typeof config.simulateDegradation !== "boolean") {
      return {
        ok: false,
        reason: `styleConfig.config.simulateDegradation must be a boolean (got ${describeValue(config.simulateDegradation)})`,
      };
    }
    simulateDegradation = config.simulateDegradation;
  }
  // Unknown keys are intentionally ignored (forward-compatible style config).
  return { ok: true, value: { durationMs, segmentMs, simulateDegradation } };
}

/**
 * The synchronous plugin surface of the reference renderer. Every method the
 * interface types as `MaybePromise` is implemented synchronously here, so
 * hosts and tests can use the results directly without awaiting. Assignable
 * to {@link RendererPlugin} (return-type narrowing is covariant).
 */
export interface TestCardRenderer extends RendererPlugin {
  init(ctx?: RendererContext): void;
  render(req: RenderRequest, input: RenderInput): RenderResult;
  dispose(): void;
}

/**
 * Creates the reference test card renderer. See the module docs; the plugin
 * is fully self-contained and safe to instantiate per test or per host.
 */
export function createTestCardRenderer(): TestCardRenderer {
  let disposed = false;
  let logger: Logger | undefined;
  let metrics: Metrics | undefined;

  const bump = (name: string): void => {
    if (metrics === undefined) return; // absent seam: silent no-op
    metrics.counter(name, { rendererId: RENDERER_ID }).inc();
  };

  const logRenderCall = (req: RenderRequest, input: RenderInput): void => {
    if (logger === undefined) return; // absent seam: silent no-op
    // Exactly ONE structured line per render call (level info, sessionId +
    // stage "render" bound via the child logger).
    logger.child({ sessionId: req.sessionId, stage: "render" }).info("testcard.render", {
      rendererId: RENDERER_ID,
      rendererVersion: RENDERER_VERSION,
      snapshotVersion: req.snapshotVersion,
      eventCount: input.events.length,
    });
  };

  const validateRequest = (req: RenderRequest): RequestValidation => {
    // R3: the request must target this exact renderer identity.
    if (req.rendererId !== RENDERER_ID || req.rendererVersion !== RENDERER_VERSION) {
      return {
        ok: false,
        reason: `request targets renderer ${req.rendererId}@${req.rendererVersion}, but this plugin is ${RENDERER_ID}@${RENDERER_VERSION}`,
        failureClass: "media-invalid",
      };
    }
    // R3: output profile must be one of the supported profiles.
    if (!deepEqual(req.outputProfile, TESTCARD_OUTPUT_PROFILE)) {
      return {
        ok: false,
        reason: "outputProfile is not one of the supported output profiles",
        failureClass: "media-invalid",
      };
    }
    // R3: snapshot version gate.
    if (req.snapshotVersion < CAPABILITY.minSnapshotVersion) {
      return {
        ok: false,
        reason: `snapshotVersion ${req.snapshotVersion} is below the minimum supported ${CAPABILITY.minSnapshotVersion}`,
        failureClass: "media-invalid",
      };
    }
    // R2: fail-closed source-frame rights (n/a for the test card — it never
    // requires source frames — but the gate is kept as the reference pattern).
    if (CAPABILITY.requiresSourceFrames && !req.rightsCapabilities.canReferenceSourceFrames) {
      return {
        ok: false,
        reason:
          "renderer requires source frames but rightsCapabilities.canReferenceSourceFrames is false",
        failureClass: "rights-denied",
      };
    }
    // Plugin-specific style configuration validation.
    const config = parseStyleConfig(req.styleConfig.config);
    if (!config.ok) {
      return { ok: false, reason: config.reason, failureClass: "media-invalid" };
    }
    return { ok: true };
  };

  const render = (req: RenderRequest, input: RenderInput): RenderResult => {
    // R4: post-dispose use is a contract violation.
    if (disposed) {
      throw new RendererContractError(
        `${RENDERER_ID}@${RENDERER_VERSION} is disposed; render refused`,
        "internal",
        { rendererId: RENDERER_ID, rendererVersion: RENDERER_VERSION, sessionId: req.sessionId },
      );
    }
    // Observability: counters first, then exactly one log line for this call.
    bump("render_requests_total");
    logRenderCall(req, input);

    // Defense in depth: render re-runs every validateRequest gate (R2/R3 +
    // config) — it must never assume prior validation.
    const validation = validateRequest(req);
    if (!validation.ok) {
      bump("render_failures_total");
      throw new RendererContractError(
        `render refused: ${validation.reason}`,
        validation.failureClass,
        {
          rendererId: RENDERER_ID,
          rendererVersion: RENDERER_VERSION,
          sessionId: req.sessionId,
          reason: validation.reason,
        },
      );
    }
    const styleConfig = parseStyleConfig(req.styleConfig.config);
    if (!styleConfig.ok) {
      // Unreachable in practice (validateRequest already rejected the config);
      // kept as a defensive re-parse so render never trusts prior validation.
      bump("render_failures_total");
      throw new RendererContractError(`render refused: ${styleConfig.reason}`, "media-invalid", {
        rendererId: RENDERER_ID,
        rendererVersion: RENDERER_VERSION,
        sessionId: req.sessionId,
        reason: styleConfig.reason,
      });
    }
    const { durationMs, segmentMs, simulateDegradation } = styleConfig.value;

    // Deterministic synthetic timeline: cover durationMs in segmentMs chunks
    // starting at the snapshot watermark (the last chunk may be shorter; a
    // duration shorter than one segment yields a single shortened segment).
    const startMs = input.snapshot.watermark.watermarkMs;
    const lastEventSequence =
      input.events.length > 0 ? input.events[input.events.length - 1]!.sequence : 0;
    const watermarkSequence =
      input.events.length > 0 ? lastEventSequence : input.snapshot.watermark.sequence;
    const segmentCount = Math.max(1, Math.ceil(durationMs / segmentMs));
    const outputSegments: RenderResult["outputSegments"] = [];
    for (let index = 0; index < segmentCount; index += 1) {
      const segmentStartMs = startMs + index * segmentMs;
      const segmentEndMs = Math.min(segmentStartMs + segmentMs, startMs + durationMs);
      outputSegments.push({
        segmentId: `tc-${index}`,
        startMs: segmentStartMs,
        endMs: segmentEndMs,
        artifactRef: `testcard://${req.sessionId}/${req.snapshotVersion}/${index}`,
      });
    }

    return {
      sessionId: req.sessionId,
      rendererId: req.rendererId,
      outputSegments,
      watermarkAfter: { watermarkMs: startMs + durationMs, sequence: watermarkSequence },
      rendererHealth: {
        lagMs: 0,
        degraded: simulateDegradation,
        ...(simulateDegradation ? { degradationReason: "simulated-degradation" } : {}),
      },
      quality: { temporalConsistencyScore: 1 },
      provenance: { snapshotVersion: req.snapshotVersion, lastEventSequence },
    };
  };

  return {
    pluginKind: "sporta-renderer",
    capability: () => cloneJson(CAPABILITY), // R1: deep-equal stable per call
    init: (ctx?: RendererContext): void => {
      // Store the observability seam; re-init replaces it. Init does NOT
      // resurrect a disposed instance — dispose is terminal (R4).
      logger = ctx?.observability?.logger;
      metrics = ctx?.observability?.metrics;
    },
    validateRequest,
    render,
    health: (): RendererHealth => ({ lagMs: 0, degraded: false }),
    dispose: (): void => {
      disposed = true; // idempotent; terminal for this instance
    },
  };
}
