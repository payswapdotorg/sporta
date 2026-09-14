/**
 * `createAvatarFieldRenderer` — the W602 `RendererPlugin` implementation
 * (`avatar-field.prototype@0.1.0`).
 *
 * Deterministic 3D-scene rendering of SWM state: every `render` projects the
 * input snapshot through W601 `projectScene` into a `SceneSpecification`
 * and synthesizes a deterministic SVG frame sequence (a perspective camera
 * at a named slot) plus the render manifest via `render3dFromSnapshot`
 * (`./render.ts`); the returned document is the contract `RenderResult`
 * (segments reference the frames through opaque
 * `scene3d://<sessionId>/<snapshotVersion>/<frameIndex>` URIs — encoded
 * delivery is a future output-pipeline concern). Hosts that need the frames
 * and manifest (evaluation, benchmarks) call
 * {@link AvatarFieldRenderer.renderDetailed}.
 *
 * Contract posture (see `./render.ts` `admitRequest` and the W501 rule docs
 * in `@sporta/renderer-contract`):
 *
 * - **R1**: `capability()` returns a deep-equal clone on every call.
 * - **R2**: `requiresSourceFrames` is `false` (a pure SWM → scene
 *   projection — no source pixels), so the harness's source-frame probe is
 *   n/a; the fail-closed rights posture goes BEYOND the baseline: a request
 *   that CARRIES source-frame references without
 *   `rightsCapabilities.canReferenceSourceFrames` is rejected
 *   (`rights-denied`) in BOTH `validateRequest` and `render` — the plugin
 *   never silently consumes unauthorized references (architecture-lock
 *   §11: transformation does not clear rights).
 * - **R3**: renderer identity, supported profile, and snapshot-version
 *   gates in both `validateRequest` and `render` (defense in depth).
 * - **R4**: `dispose` is terminal — a post-dispose `render` throws
 *   `RendererContractError` (`internal`).
 * - **R5/R6/R7/R8**: honored by `render3dFromSnapshot` (event-marker
 *   application accounting, exact watermark semantics, explicit degradation
 *   with reasons, well-formed non-overlapping segments).
 *
 * Determinism: `render` is a pure function of `(req, input)` — no RNG, no
 * clock reads; identity-stable styling comes from `./style.ts`. The only
 * side effects are the observability seam (one structured `info` line per
 * render call via the child logger bound to `sessionId` + `stage:
 * "render"`; counters `render_requests_total` /
 * `render_failures_total`), which are no-ops when the host provided no
 * seam.
 */
import type {
  RenderRequest,
  RenderResult,
  RendererCapability,
  RendererHealth,
} from "@sporta/contracts";
import { RendererContractError } from "@sporta/renderer-contract";
import type {
  Metrics,
  RenderInput,
  RendererContext,
  RendererPlugin,
  RequestValidation,
} from "@sporta/renderer-contract";
import {
  AVATAR_FIELD_RENDERER_ID,
  AVATAR_FIELD_RENDERER_VERSION,
  avatarFieldCapability,
} from "./identity";
import { admitRequest, render3dFromSnapshot } from "./render";
import type { AvatarField3dRenderOutput } from "./types";

type Logger = NonNullable<NonNullable<RendererContext["observability"]>["logger"]>;

/**
 * The synchronous plugin surface of the avatar/field prototype. Every
 * method the interface types as `MaybePromise` is implemented synchronously
 * (the W501 conformance harness is synchronous); assignable to
 * {@link RendererPlugin} (return-type narrowing is covariant).
 */
export interface AvatarFieldRenderer extends RendererPlugin {
  capability(): RendererCapability;
  init(ctx?: RendererContext): void;
  render(req: RenderRequest, input: RenderInput): RenderResult;
  /**
   * The detailed render: the contract result PLUS the SVG frame sequence
   * and the render manifest (per-frame provenance/accounting).
   * Package-level extra surface for hosts, benchmarks, and evaluators —
   * not part of the W501 interface, but the same pure function underneath.
   */
  renderDetailed(req: RenderRequest, input: RenderInput): AvatarField3dRenderOutput;
  health(): RendererHealth;
  dispose(): void;
}

/**
 * Creates the avatar/field 3D prototype renderer. Fully self-contained and
 * safe to instantiate per test or per host; no external state, no fs, no
 * network.
 */
export function createAvatarFieldRenderer(): AvatarFieldRenderer {
  let disposed = false;
  let logger: Logger | undefined;
  let metrics: Metrics | undefined;

  const bump = (name: string): void => {
    if (metrics === undefined) return; // absent seam: silent no-op
    metrics.counter(name, { rendererId: AVATAR_FIELD_RENDERER_ID }).inc();
  };

  const logRenderCall = (req: RenderRequest, input: RenderInput, frameCount: number): void => {
    if (logger === undefined) return; // absent seam: silent no-op
    // Exactly ONE structured line per render call (level info; sessionId +
    // stage "render" bound via the child logger).
    logger.child({ sessionId: req.sessionId, stage: "render" }).info("avatar-field.render", {
      rendererId: AVATAR_FIELD_RENDERER_ID,
      rendererVersion: AVATAR_FIELD_RENDERER_VERSION,
      snapshotVersion: req.snapshotVersion,
      eventCount: input.events.length,
      frameCount,
    });
  };

  const validateRequest = (req: RenderRequest): RequestValidation => {
    const admission = admitRequest(req);
    return admission.ok ? { ok: true } : admission;
  };

  const renderDetailed = (req: RenderRequest, input: RenderInput): AvatarField3dRenderOutput => {
    // R4: post-dispose use is a contract violation.
    if (disposed) {
      throw new RendererContractError(
        `${AVATAR_FIELD_RENDERER_ID}@${AVATAR_FIELD_RENDERER_VERSION} is disposed; render refused`,
        "internal",
        {
          rendererId: AVATAR_FIELD_RENDERER_ID,
          rendererVersion: AVATAR_FIELD_RENDERER_VERSION,
          sessionId: req.sessionId,
        },
      );
    }
    // Observability: request counter first; the one log line needs the
    // frame count, so it is emitted after the render succeeds. Refusals
    // bump the failure counter (below) and throw — never silent.
    bump("render_requests_total");
    try {
      const output = render3dFromSnapshot(req, input);
      logRenderCall(req, input, output.frames.length);
      return output;
    } catch (error) {
      bump("render_failures_total");
      throw error;
    }
  };

  return {
    pluginKind: "sporta-renderer",
    capability: (): RendererCapability => avatarFieldCapability(), // R1: deep-equal per call
    init: (ctx?: RendererContext): void => {
      // Store the observability seam; re-init replaces it. Init does NOT
      // resurrect a disposed instance — dispose is terminal (R4).
      logger = ctx?.observability?.logger;
      metrics = ctx?.observability?.metrics;
    },
    validateRequest,
    render: (req: RenderRequest, input: RenderInput): RenderResult =>
      renderDetailed(req, input).result,
    renderDetailed,
    health: (): RendererHealth => ({ lagMs: 0, degraded: false }),
    dispose: (): void => {
      disposed = true; // idempotent; terminal for this instance
    },
  };
}
