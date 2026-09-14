/**
 * @sporta/control-api — the session/control HTTP control plane (W701).
 *
 * The first EXPERIENCE-plane package: a real user can create a media session,
 * choose a renderer, inspect state, and obtain playback access according to
 * the fail-closed authorization policy (architecture-lock §11). Module map:
 *
 * - `errors`: the `ControlApiError` family (`failureClass` + `httpStatus`),
 *   wrapping renderer-contract and session errors rather than re-implementing
 *   them
 * - `app`: `createControlApp` — the transport-free core (fail-closed rights,
 *   renderer registry, world-model snapshots, the playback gate, one log
 *   line + counters per call)
 * - `http`: `createControlServer` — the `Bun.serve` transport (v1 routes,
 *   typed-error → status mapping, request-id correlation)
 * - `playback`: the W504 render-output store PORT (structural — satisfied by
 *   `@sporta/output-pipeline` with no dependency in either direction) and
 *   the playback-route result types
 *
 * KNOWN LIMITATIONS (W701): no user authentication yet (M7) — the
 * caller-supplied authorization policy is the trust boundary; world-model
 * snapshots carry an empty event tail until the perception pipeline feeds
 * the control plane.
 */
export { CONTROL_API_STAGE, CONTROL_METRIC_NAMES, createControlApp } from "./app";
export type {
  ControlApp,
  ControlAppOptions,
  ControlCallContext,
  ControlRoute,
  CreateRenderInput,
  CreateSessionInput,
  CreateSessionResult,
  GetSessionResult,
  ListRenderersResult,
  ListRendersResult,
  ListSessionsResult,
  RenderEnvelope,
  RenderSummary,
  SessionSummary,
  SessionWithRights,
  TerminateSessionResult,
} from "./app";
export { createControlServer } from "./http";
export type { ControlServer, ControlServerOptions, TransportFailureClass } from "./http";
export {
  CONTROL_HTTP_STATUS,
  ControlApiError,
  ControlInternalError,
  ControlMediaInvalidError,
  ControlResourceLimitError,
  ControlRightsDeniedError,
  ControlUnknownRenderError,
  ControlUnknownSegmentError,
  ControlUnknownSessionError,
  ControlValidationError,
  asControlError,
  isControlApiError,
  wrapRendererContractError,
  wrapRendererResolutionError,
  wrapSessionRightsDenied,
} from "./errors";
export type { ControlError, ControlErrorDetails, ControlFailureClass } from "./errors";
export { asRenderOutputStoreError } from "./playback";
export type {
  PlaybackRightsContext,
  RenderOutputDocument,
  RenderOutputListQuery,
  RenderOutputListResult,
  RenderOutputRetrieval,
  RenderOutputSegmentDocument,
  RenderOutputSegmentSummary,
  RenderOutputStore,
} from "./playback";
import { createControlServer } from "./http";

/**
 * Dev entry: starts the control server on `Bun.env.PORT` (default 3111) and
 * logs the listen line. Dev convenience only — tests never rely on it.
 */
export function run(): Bun.Server<undefined> {
  const parsed = Number.parseInt(Bun.env.PORT ?? "", 10);
  const port = Number.isInteger(parsed) && parsed > 0 ? parsed : 3111;
  const server = createControlServer({ port });
  // eslint-disable-next-line no-console -- the documented dev listen line
  console.log(`control-api listening on http://127.0.0.1:${server.port}`);
  return server;
}

if (import.meta.main) {
  run();
}
