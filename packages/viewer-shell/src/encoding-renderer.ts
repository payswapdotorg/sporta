/**
 * The encoding renderer (W705) — the HOST-SIDE wrapper that runs the real
 * W504 output pipeline step for a control-plane render.
 *
 * WHY this exists: the W701 control plane's `createRender` stores the
 * contract `RenderResult` but DISCARDS the renderer's detailed output —
 * encoding + storing the playable segment is the W504 HOST-side
 * responsibility (`AnimeOutputPipeline.encodeAndStore`), which runs AFTER
 * the render completes. This decorator wires that step into the dev-server
 * composition (`serveViewer`): every successful `renderDetailed` is encoded
 * and stored under the render id the control app is about to assign.
 *
 * The render-id mapping invariant (deterministic, test-pinned — the same
 * contract as the W702 capture store): `createControlApp` assigns `r-<n>`
 * by incrementing a per-app counter exactly once per SUCCESSFUL
 * `createRender` that reaches storage. This wrapper counts its own
 * successful `renderDetailed` calls and predicts the same id. If the
 * pipeline step REJECTS (conflict, limit), the wrapper rolls its counter
 * back before propagating — the control app will fail the same render (the
 * plugin call threw), so the app counter never counts it either, and the
 * NEXT successful render keeps predicting correctly. The one documented
 * desync edge (inherited verbatim from the capture store): a plugin output
 * that passes `renderDetailed` but fails the APP's post-render
 * `RenderResult` schema validation would desynchronize the counters
 * (stored but never assigned) — that path is an app-level `internal`
 * failure and loud; a renderer bug, not a wiring decision.
 *
 * Honest limitation (inherited from the pipeline's store ordering): a
 * segment-store rejection leaves NO artifact behind, but an artifact-store
 * rejection AFTER a successful segment store leaves the segment stored
 * under the predicted id while the control app REJECTS the render — the
 * orphaned segment stays servable through the playback routes under that
 * unassigned id (documented W504 behavior; this wrapper never hides it).
 *
 * Delegation: `capability`, `init`, `validateRequest`, `render`,
 * `renderDetailed`, `health`, and `dispose` all delegate unchanged;
 * rejections propagate and store NOTHING.
 */
import type { AnimePrototypeRenderer } from "@sporta/renderer-anime";
import type { AnimeOutputPipeline } from "@sporta/output-pipeline";

/** Options for {@link createEncodingRenderer}. */
export interface EncodingRendererOptions {
  /** The output pipeline that encodes + stores each successful render. */
  pipeline: AnimeOutputPipeline;
}

/**
 * Wraps an anime prototype renderer so every successful `renderDetailed`
 * is encoded and stored through the pipeline under the predicted control
 * render id (`r-<n>` — see the invariant in the module docs). Composable
 * with the W702 capture wrapper:
 * `createCapturingRenderer(createEncodingRenderer(plugin, pipeline), store)`.
 */
export function createEncodingRenderer(
  plugin: AnimePrototypeRenderer,
  options: EncodingRendererOptions,
): AnimePrototypeRenderer {
  const pipeline = options.pipeline;
  let seq = 0;

  const renderDetailed: AnimePrototypeRenderer["renderDetailed"] = (req, input) => {
    const output = plugin.renderDetailed(req, input);
    // Count first (this render WILL reach app storage on the success path),
    // roll back if the pipeline step rejects (the app fails with it).
    seq += 1;
    const renderId = `r-${seq}`;
    try {
      pipeline.encodeAndStore({ sessionId: req.sessionId, renderId, output });
    } catch (err) {
      seq -= 1;
      throw err;
    }
    return output;
  };

  return {
    pluginKind: plugin.pluginKind,
    capability: () => plugin.capability(),
    init: (ctx) => plugin.init(ctx),
    validateRequest: (req) => plugin.validateRequest(req),
    render: (req, input) => renderDetailed(req, input).result,
    renderDetailed,
    health: () => plugin.health(),
    dispose: () => plugin.dispose(),
  };
}
