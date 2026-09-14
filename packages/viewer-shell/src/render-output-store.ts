/**
 * The render-output capture store + capturing renderer (W702) — the honest
 * SERVER-SIDE stand-in for the W504 stored-output API.
 *
 * The gap (W701/W502 seam): the control plane stores the contract
 * `RenderResult` whose segments reference frames through opaque
 * `anime://…` artifact refs; the playable W502 `{ frames, manifest }`
 * document is produced inside the renderer plugin and discarded by the
 * control app. Retrieving stored output behind the control plane is the
 * W504 work item ("generated segments can be encoded, stored, and played
 * back through the viewer API") — NOT this package's to invent as a
 * control-plane route.
 *
 * The stand-in: hosts wrap the anime plugin with
 * {@link createCapturingRenderer} when registering it in the control app's
 * renderer registry. The wrapper delegates every plugin call unchanged, but
 * after a successful `render` it records the detailed output in this store
 * keyed by the render id the control app is about to assign.
 *
 * The render-id mapping invariant (deterministic, test-pinned):
 * `createControlApp` assigns `r-<n>` by incrementing a per-app counter
 * exactly once per SUCCESSFUL `createRender` that reaches storage, and the
 * wrapper records exactly once per successful plugin `render`. Assuming
 * sequential `createRender` calls (the single-user viewer posture), the
 * store's Nth record is the app's `r-<N>`. Edge: a plugin result that fails
 * the app's post-render schema validation would desynchronize the counters
 * (recorded but never assigned) — that path is an app-level `internal`
 * failure and loud; the stand-in documents it rather than hiding it.
 */
import type { RendererPlugin } from "@sporta/renderer-contract";
import type { RenderInput, RequestValidation, RendererContext } from "@sporta/renderer-contract";
import type { AnimePrototypeRenderer } from "@sporta/renderer-anime";
import type { AnimeRenderOutput } from "@sporta/renderer-anime";
import type { BatchRenderOutput } from "./ports.ts";

/** One captured output: the render id, its session, and the W502 document. */
export interface RenderOutputRecord {
  renderId: string;
  sessionId: string;
  output: BatchRenderOutput;
}

/** The capture store surface (host-side; see the module docs). */
export interface RenderOutputCaptureStore {
  /**
   * Records one successful detailed render. Returns the render id the
   * control app will assign to this render (`r-<n>` — see the invariant in
   * the module docs).
   */
  record(sessionId: string, output: AnimeRenderOutput): string;
  /**
   * Resolves the captured output for a render id, if present. Returns a DEEP
   * COPY — callers can never mutate the store through a resolved record.
   */
  resolve(renderId: string): RenderOutputRecord | undefined;
  /** All records in capture order (deep copies; inspection/tests). */
  records(): RenderOutputRecord[];
  /** Number of records so far. */
  size(): number;
}

/** Creates an empty capture store. */
export function createRenderOutputCaptureStore(): RenderOutputCaptureStore {
  const byId = new Map<string, RenderOutputRecord>();
  const order: RenderOutputRecord[] = [];
  let seq = 0;

  /** A deep copy of a record — callers can never mutate the store. */
  function cloneRecord(record: RenderOutputRecord): RenderOutputRecord {
    return {
      renderId: record.renderId,
      sessionId: record.sessionId,
      output: structuredClone(record.output),
    };
  }

  return {
    record(sessionId: string, output: AnimeRenderOutput): string {
      seq += 1;
      const renderId = `r-${seq}`;
      const record: RenderOutputRecord = {
        renderId,
        sessionId,
        output: {
          frames: structuredClone(output.frames),
          manifest: structuredClone(output.manifest),
        },
      };
      byId.set(renderId, record);
      order.push(record);
      return renderId;
    },
    resolve(renderId: string): RenderOutputRecord | undefined {
      const record = byId.get(renderId);
      return record === undefined ? undefined : cloneRecord(record);
    },
    records(): RenderOutputRecord[] {
      return order.map((record) => cloneRecord(record));
    },
    size(): number {
      return order.length;
    },
  };
}

/**
 * Wraps an anime prototype renderer so every successful `render` records
 * the detailed W502 output into `store`. Delegates `capability`, `init`,
 * `validateRequest`, `health`, and `dispose` unchanged; rejections
 * propagate (the control app maps them to typed errors) and record NOTHING.
 */
export function createCapturingRenderer(
  plugin: AnimePrototypeRenderer,
  store: RenderOutputCaptureStore,
): RendererPlugin {
  return {
    pluginKind: "sporta-renderer",
    capability: () => plugin.capability(),
    init: (ctx?: RendererContext) => plugin.init(ctx),
    validateRequest: (req): RequestValidation => plugin.validateRequest(req),
    render: (req, input: RenderInput) => {
      const output: AnimeRenderOutput = plugin.renderDetailed(req, input);
      store.record(req.sessionId, output);
      return output.result;
    },
    health: () => plugin.health(),
    dispose: () => plugin.dispose(),
  };
}
