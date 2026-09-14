/**
 * The in-process control client (W702): a {@link ControlClient} adapter over
 * a REAL transport-free `createControlApp` (W701).
 *
 * Purpose: headless integration — the full viewer flow (connect, browse,
 * render, play) driven against the actual control-plane semantics with no
 * network. The app's typed `ControlApiError` rejections are mapped onto
 * transport-independent {@link ViewerControlError} documents (class, message,
 * details preserved verbatim) — the same documents the HTTP adapter
 * produces from the wire, so ViewerCore sees ONE error model from both
 * transports. Anything the app throws that is not a `ControlApiError`
 * (impossible by construction — the app wraps every failure) still surfaces
 * as an `internal` error, never raw.
 */
import type { ControlApp } from "@sporta/control-api";
import { ControlApiError } from "@sporta/control-api";
import { ViewerControlError } from "./errors.ts";
import type { ControlClient } from "./ports.ts";

/** Maps a thrown value from the app onto the viewer error model. */
function mapError(value: unknown): ViewerControlError {
  if (value instanceof ControlApiError) {
    return new ViewerControlError(value.failureClass, value.message, { ...value.details });
  }
  return new ViewerControlError(
    "internal",
    value instanceof Error ? value.message : "unexpected control-plane failure",
  );
}

/** Options for {@link createInProcessControlClient}. */
export interface InProcessControlClientOptions {
  /** Correlation-id prefix for the app's log lines (default `"viewer"`). */
  requestIdPrefix?: string;
}

/**
 * Creates the in-process client. Every method passes a deterministic
 * `requestId` (`<prefix>-<n>`) so the app's one-line-per-call logs correlate
 * with the viewer operations even in headless runs.
 */
export function createInProcessControlClient(
  app: ControlApp,
  options: InProcessControlClientOptions = {},
): ControlClient {
  const prefix = options.requestIdPrefix ?? "viewer";
  let seq = 0;
  const ctx = (): { requestId: string } => ({ requestId: `${prefix}-${(seq += 1)}` });

  async function call<T>(fn: (context: { requestId: string }) => Promise<T>): Promise<T> {
    try {
      return await fn(ctx());
    } catch (err) {
      throw mapError(err);
    }
  }

  return {
    createSession: (input) => call((context) => app.createSession(input, context)),
    getSession: (sessionId) => call((context) => app.getSession(sessionId, context)),
    listSessions: () => call((context) => app.listSessions(context)),
    terminateSession: (sessionId) => call((context) => app.terminateSession(sessionId, context)),
    listRenderers: () => call((context) => app.listRenderers(context)),
    createRender: (sessionId, input) =>
      call((context) => app.createRender(sessionId, input, context)),
    getRender: (sessionId, renderId) =>
      call((context) => app.getRender(sessionId, renderId, context)),
    listRenders: (sessionId) => call((context) => app.listRenders(sessionId, context)),
  };
}
