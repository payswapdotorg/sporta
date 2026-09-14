/**
 * `createAnimePrototypeRenderer` — the W502 `RendererPlugin` implementation
 * (`anime.prototype@0.1.0`).
 *
 * Procedural stylized rendering of SWM state: every `render` synthesizes a
 * deterministic SVG frame sequence plus the clip manifest via
 * `renderAnimeFromSnapshot` (`./render.ts`); the returned document is the
 * contract `RenderResult` (segments reference the frames through opaque
 * `anime://<sessionId>/<snapshotVersion>/<frameIndex>` URIs — encoded
 * delivery is the W504 concern). Hosts that need the frames and manifest
 * (e.g. W503 temporal-consistency evaluation) call
 * {@link AnimePrototypeRenderer.renderDetailed}.
 *
 * Contract posture (see `./render.ts` `admitRequest` and the W501 rule docs
 * in `@sporta/renderer-contract`):
 *
 * - **R1**: `capability()` returns a deep-equal clone on every call.
 * - **R2**: `requiresSourceFrames` is `false` (pure SWM projection — no
 *   source pixels), so the harness's source-frame probe is n/a; the
 *   fail-closed rights posture goes BEYOND the baseline: a request that
 *   CARRIES source-frame references without
 *   `rightsCapabilities.canReferenceSourceFrames` is rejected
 *   (`rights-denied`) in BOTH `validateRequest` and `render` — the plugin
 *   never silently consumes unauthorized references (architecture-lock
 *   §11: transformation does not clear rights).
 * - **R3**: renderer identity, supported profile, and snapshot-version
 *   gates in both `validateRequest` and `render` (defense in depth).
 * - **R4**: `dispose` is terminal — a post-dispose `render` throws
 *   `RendererContractError` (`internal`).
 * - **R5/R6/R7/R8**: honored by `renderAnimeFromSnapshot` (event
 *   application accounting, exact watermark semantics, explicit
 *   degradation with reasons, well-formed non-overlapping segments).
 *
 * Determinism: `render` is a pure function of `(req, input)` — no RNG, no
 * clock reads; identity-stable styling comes from `./palette.ts`. The only
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
import { ANIME_RENDERER_ID, ANIME_RENDERER_VERSION, animeCapability } from "./identity";
import { admitRequest, renderAnimeFromSnapshot } from "./render";
import type { AnimeRenderOutput } from "./types";

type Logger = NonNullable<NonNullable<RendererContext["observability"]>["logger"]>;

/**
 * The synchronous plugin surface of the anime prototype. Every method the
 * interface types as `MaybePromise` is implemented synchronously (the
 * W501 conformance harness is synchronous); assignable to
 * {@link RendererPlugin} (return-type narrowing is covariant).
 */
export interface AnimePrototypeRenderer extends RendererPlugin {
  capability(): RendererCapability;
  init(ctx?: RendererContext): void;
  render(req: RenderRequest, input: RenderInput): RenderResult;
  /**
   * The detailed render: the contract result PLUS the SVG frame sequence
   * and the clip manifest (per-frame provenance/accounting). Package-level
   * extra surface for hosts and evaluators (W503) — not part of the W501
   * interface, but the same pure function underneath.
   */
  renderDetailed(req: RenderRequest, input: RenderInput): AnimeRenderOutput;
  health(): RendererHealth;
  dispose(): void;
}

/**
 * Creates the anime prototype renderer. Fully self-contained and safe to
 * instantiate per test or per host; no external state, no fs, no network.
 */
export function createAnimePrototypeRenderer(): AnimePrototypeRenderer {
  let disposed = false;
  let logger: Logger | undefined;
  let metrics: Metrics | undefined;

  const bump = (name: string): void => {
    if (metrics === undefined) return; // absent seam: silent no-op
    metrics.counter(name, { rendererId: ANIME_RENDERER_ID }).inc();
  };

  const logRenderCall = (req: RenderRequest, input: RenderInput, frameCount: number): void => {
    if (logger === undefined) return; // absent seam: silent no-op
    // Exactly ONE structured line per render call (level info; sessionId +
    // stage "render" bound via the child logger).
    logger.child({ sessionId: req.sessionId, stage: "render" }).info("anime.render", {
      rendererId: ANIME_RENDERER_ID,
      rendererVersion: ANIME_RENDERER_VERSION,
      snapshotVersion: req.snapshotVersion,
      eventCount: input.events.length,
      frameCount,
    });
  };

  const validateRequest = (req: RenderRequest): RequestValidation => {
    const admission = admitRequest(req);
    return admission.ok ? { ok: true } : admission;
  };

  const renderDetailed = (req: RenderRequest, input: RenderInput): AnimeRenderOutput => {
    // R4: post-dispose use is a contract violation.
    if (disposed) {
      throw new RendererContractError(
        `${ANIME_RENDERER_ID}@${ANIME_RENDERER_VERSION} is disposed; render refused`,
        "internal",
        {
          rendererId: ANIME_RENDERER_ID,
          rendererVersion: ANIME_RENDERER_VERSION,
          sessionId: req.sessionId,
        },
      );
    }
    // Observability: request counter first; the one log line needs the
    // frame count, so it is emitted after the render succeeds. Refusals
    // bump the failure counter (below) and throw — never silent.
    bump("render_requests_total");
    try {
      const output = renderAnimeFromSnapshot(req, input);
      logRenderCall(req, input, output.frames.length);
      return output;
    } catch (error) {
      bump("render_failures_total");
      throw error;
    }
  };

  return {
    pluginKind: "sporta-renderer",
    capability: (): RendererCapability => animeCapability(), // R1: deep-equal per call
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
