/**
 * THE renderer plugin interface (W501 — docs/contracts/renderer.md).
 *
 * A renderer is a versioned plugin behind this stable interface. It is
 * replaceable; its dependencies live behind its adapter/package boundary and
 * the core domain never imports renderer-specific frameworks
 * (architecture-lock §5). Plugins consume `@sporta/contracts` documents only
 * (validated plain objects), never live engine internals.
 *
 * The conformance harness (`../conformance.ts`) proves every rule below; the
 * rule ids are stable and appear in check details:
 *
 * - **R1 identity immutability** — `capability()` returns a deep-equal object
 *   on every call. `rendererId` + `rendererVersion` are an immutable pair:
 *   renderer IDs are stable logical identifiers and renderer versions are
 *   immutable (docs/contracts/renderer.md, Versioning).
 * - **R2 fail-closed rights** — a plugin whose `capability.requiresSourceFrames`
 *   is `true` MUST reject any request whose
 *   `rightsCapabilities.canReferenceSourceFrames` is `false`
 *   (failureClass `"rights-denied"`) — in BOTH `validateRequest` and `render`
 *   (defense in depth: `render` may be called without prior validation).
 *   Architecture-lock §11: transformation never clears rights by itself.
 * - **R3 compatibility gates** — reject (failureClass `"media-invalid"`) when
 *   `outputProfile` is not in `supportedOutputProfiles`, when
 *   `snapshotVersion < capability.minSnapshotVersion`, or when
 *   `req.rendererId`/`req.rendererVersion` do not match the plugin's own.
 * - **R4 disposal** — after `dispose()`, `render` MUST throw
 *   {@link RendererContractError} with failureClass `"internal"`.
 * - **R5 provenance faithfulness** — `result.provenance.snapshotVersion ===
 *   req.snapshotVersion`; `result.provenance.lastEventSequence` reports the
 *   highest event sequence actually applied: the last input event's sequence
 *   under full application, and `0` when no events were passed. It must never
 *   claim MORE than the input allows (upward lies are hard violations;
 *   reporting less than full application is legal only under R7's explicit
 *   degradation).
 * - **R6 watermark monotonicity** — `result.watermarkAfter.sequence === (last
 *   input event sequence, or `input.snapshot.watermark.sequence` when no
 *   events)` and `result.watermarkAfter.watermarkMs >=
 *   input.snapshot.watermark.watermarkMs`.
 * - **R7 no silent staleness** — if the renderer skipped applicable events
 *   (`provenance.lastEventSequence` below the full-application expectation)
 *   it MUST report `rendererHealth.degraded: true` WITH `degradationReason`;
 *   whenever `degraded === true`, `degradationReason` MUST be present. A
 *   renderer must never output misleading stale state unmarked
 *   (docs/contracts/renderer.md, Failure behavior).
 * - **R8 output wellformedness** — segments ordered ascending by `startMs`,
 *   non-overlapping (`segments[i].startMs >= segments[i-1].endMs`), with
 *   `0 <= startMs < endMs`, unique `segmentId`s, and non-empty `artifactRef`s;
 *   `result.sessionId === req.sessionId` and `result.rendererId ===
 *   req.rendererId`.
 *
 * Lifecycle contract: `init` → (`validateRequest` / `render` / `health`)* →
 * `dispose`. `init` may be called without arguments; observability is always
 * optional (absent seam ⇒ silent no-ops). `dispose` is terminal for the
 * instance.
 */
import type {
  RenderRequest,
  RenderResult,
  RendererCapability,
  RendererHealth,
} from "@sporta/contracts";
import type { MaybePromise, RenderInput, RendererContext, RequestValidation } from "./types";

export interface RendererPlugin {
  /** Brand discriminator for the renderer plugin contract. */
  readonly pluginKind: "sporta-renderer";

  /**
   * The immutable identity/capability document of this renderer. R1: deep-equal
   * stable across calls; hosts must not rely on reference identity.
   */
  capability(): RendererCapability;

  /**
   * Lifecycle hook: receives optional host services (observability seam).
   * Must be callable with no context; a missing seam never breaks the plugin.
   */
  init(ctx?: RendererContext): MaybePromise<void>;

  /**
   * Cheap, synchronous admission check for a request. Implements R2, R3 and
   * any plugin-specific configuration validation. MUST NOT have side effects
   * that make a subsequent `render` of the same request incorrect.
   */
  validateRequest(req: RenderRequest): RequestValidation;

  /**
   * Produce the render result. MUST re-run every gate `validateRequest`
   * enforces (defense in depth — R2/R3/R4) and throw
   * {@link RendererContractError} on refusal, with the rejection's
   * failureClass. Honors R5, R6, R7 and R8 in the produced result.
   */
  render(req: RenderRequest, input: RenderInput): MaybePromise<RenderResult>;

  /** Current health snapshot, independent of any specific result. */
  health(): RendererHealth;

  /** Releases resources; terminal for the instance (R4). */
  dispose(): MaybePromise<void>;
}
