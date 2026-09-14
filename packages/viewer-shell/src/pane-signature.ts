/**
 * Pane signatures (W702): the PURE memo keys for the shell's re-rendered
 * panes — the fix for a real inherited bug in the same class as the
 * detail-pane plan (see `./detail-plan.ts`).
 *
 * The bug: the bootstrap re-rendered the SESSIONS pane (and the error
 * banner) on EVERY view-model emission. While a clip plays, the player
 * emits on every host tick (`rAF`, ~60 Hz), so the left pane — which
 * contains the create-session form (a textarea + a text input) — was
 * destroyed and rebuilt at tick rate: focus was lost mid-typing and the
 * entered text reset to the demo default. The pane renders NONE of the
 * per-tick fields (playback position/frame/svg, session detail,
 * renderer selection, status).
 *
 * The fix follows the package's architecture rule (pure decision module +
 * thin DOM writer): each pane gets a signature — a deterministic JSON key
 * over EXACTLY the view-model fields the pane renders. The bootstrap
 * re-renders a pane only when its signature changes. The signatures are
 * pure functions of the view-model, test-pinned headlessly (invariant
 * across playback-only changes; sensitive to every rendered field).
 */
import type { ViewerViewModel } from "./viewer-core.ts";

/**
 * The memo key for the sessions pane (left). The pane renders:
 * `connection`, `pendingOperation` (button disabled states), `sessions`
 * (the list), and the constant live note — nothing else.
 */
export function sessionsPaneSignature(view: ViewerViewModel): string {
  return JSON.stringify({
    connection: view.connection,
    pendingOperation: view.pendingOperation,
    sessions: view.sessions,
    liveNote: view.live.note,
  });
}

/**
 * The memo key for the error banner. The banner renders exactly the
 * `ErrorView` (class tag, label, message, retryability, operation, retry
 * and dismiss actions).
 */
export function errorBannerSignature(view: ViewerViewModel): string {
  return JSON.stringify(view.error);
}
