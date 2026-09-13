/**
 * `createControlApp` — the transport-free control-plane core (W701).
 *
 * The EXPERIENCE-plane entry point of the architecture (architecture.md §2:
 * the control plane owns media sessions, authorization policy, renderer
 * configuration, and audit). This module owns the semantics; `./http.ts` owns
 * the transport. Everything here is drivable in-process (and under `bun
 * test`) without any network.
 *
 * Fail-closed rights (architecture-lock §11, `docs/security/rights-security.md`):
 *
 * - session creation derives `RightsCapabilities` from the caller-supplied
 *   authorization policy FIRST; a policy from which NO capability can be
 *   derived (missing/expired/insufficient decision) denies creation. KNOWN
 *   LIMITATION (W701): there is no user authentication yet (M7) — the
 *   caller-supplied policy IS the trust boundary;
 * - every rights read re-derives at the injected `nowMs`, so a policy that
 *   expired after creation denies everything downstream;
 * - stored-render playback additionally requires
 *   `rightsCapabilities.canStoreDerivatives === true` (tech-lead decision: a
 *   stored derivative must exist to be playable — rendering itself is
 *   compute and stays allowed without it, but retrieval is denied).
 *
 * Rendering (W501 plugin contract): the plugin is resolved from the immutable
 * `RendererRegistry`, the session's world model is snapshotted at the CURRENT
 * watermark with an EMPTY event tail (the perception pipeline does not feed
 * the control plane yet — documented W701 simplification), the
 * `RenderRequest` is built from the RESOLVED plugin's identity/capability,
 * and `validateRequest` + `render` rejections map onto typed control errors.
 *
 * Observability (architecture-lock §12): every method emits EXACTLY ONE
 * structured log line (stage `control-api`, bound sessionId when known,
 * correlationId = the caller's request id when provided) and bumps
 * `control_requests_total{route}` plus `control_failures_total{failure_class}`
 * on failure. Absent observability is a silent no-op.
 *
 * Determinism: the default clock is a per-app TEST_EPOCH_MS-based counter
 * (from `@sporta/testing`), so unseeded runs are reproducible. Production
 * deployments MUST inject a real wall clock (`nowMs: () => Date.now()`).
 */
import {
  AuthorizationPolicy,
  OutputProfile,
  RenderRequest,
  RenderResult,
  SCHEMA_VERSION,
  SessionStatus,
  deriveRightsCapabilities,
} from "@sporta/contracts";
import type {
  AuthorizationPolicy as AuthorizationPolicyDoc,
  MediaSession as MediaSessionDoc,
  OutputProfile as OutputProfileDoc,
  RenderRequest as RenderRequestDoc,
  RenderResult as RenderResultDoc,
  RendererCapability,
  RightsCapabilities,
  SourceMedia,
  WorldSnapshot,
} from "@sporta/contracts";
import { MetricsRegistry, createLogger } from "@sporta/observability";
import type { Logger } from "@sporta/observability";
import {
  RendererContractError,
  RendererRegistry,
  createTestCardRenderer,
} from "@sporta/renderer-contract";
import type { RendererPlugin } from "@sporta/renderer-contract";
import { TEST_EPOCH_MS } from "@sporta/testing";
import { WorldModelEngine } from "@sporta/world-model";
import type { WorldModelEngine as WorldModelEngineInstance } from "@sporta/world-model";
import {
  InMemorySessionRepository,
  RightsDeniedError,
  SessionLifecycle,
  newSession,
} from "@sporta/session";
import type { MediaSessionRepository } from "@sporta/session";
import {
  ControlInternalError,
  ControlMediaInvalidError,
  ControlRightsDeniedError,
  ControlUnknownRenderError,
  ControlUnknownSessionError,
  ControlValidationError,
  asControlError,
  wrapRendererResolutionError,
  wrapSessionRightsDenied,
} from "./errors";

/** Log/metric stage name for every record emitted by the control plane. */
export const CONTROL_API_STAGE = "control-api";

/** Metric names emitted by the control plane (see METRIC_NAMES pattern). */
export const CONTROL_METRIC_NAMES = {
  /** Counter bumped once per control-plane method call (label: `route`). */
  requestsTotal: "control_requests_total",
  /** Counter bumped once per failed method call (label: `failure_class`). */
  failuresTotal: "control_failures_total",
} as const;

/** Label keys on the control-plane counters. */
const ROUTE_LABEL = "route";
const FAILURE_CLASS_LABEL = "failure_class";

/** Canonical route names (the `route` metric label and log field). */
export type ControlRoute =
  | "create_session"
  | "get_session"
  | "list_sessions"
  | "terminate_session"
  | "list_renderers"
  | "create_render"
  | "get_render"
  | "list_renders";

/** Default style id when the caller does not select one. */
const DEFAULT_STYLE_ID = "default";

/** Max accepted length of caller-supplied ids and labels. */
const MAX_LABEL_LENGTH = 200;

/**
 * Call-scoped context. The HTTP transport passes the request id so it lands
 * in the correlation line; in-process callers may omit it.
 */
export interface ControlCallContext {
  /** Correlation id for this call (the `x-request-id` at the transport). */
  requestId?: string;
}

/** Options for {@link createControlApp}. */
export interface ControlAppOptions {
  /** Session persistence (default: in-memory repository). */
  sessionRepository?: MediaSessionRepository;
  /**
   * Renderer registry. When provided, it should already be populated
   * (default: a fresh registry pre-registered with the reference
   * `sporta.testcard` renderer).
   */
  rendererRegistry?: RendererRegistry;
  /**
   * Creates the session-scoped world-model engine for a session (default:
   * `WorldModelEngine.create(sessionId)` wired to the app clock). The app
   * caches one engine per session; the snapshot for a render is taken at the
   * engine's current watermark with an empty event tail (no perception
   * pipeline feeds it in W701).
   */
  worldModelFactory?: (sessionId: string) => WorldModelEngineInstance;
  /** Observability seams (default: silent no-op logger + private registry). */
  observability?: {
    logger?: Logger;
    metrics?: MetricsRegistry;
  };
  /**
   * Clock in epoch milliseconds (default: deterministic per-app counter
   * `TEST_EPOCH_MS + ticks`). Production callers MUST inject a real wall
   * clock; the deterministic default exists so unseeded runs stay
   * reproducible (docs/testing/HARNESS.md).
   */
  nowMs?: () => number;
}

/** Input for {@link ControlApp.createSession}. */
export interface CreateSessionInput {
  /** The authorization policy decision for this session (trust boundary). */
  authorizationPolicy: AuthorizationPolicyDoc;
  /** Human-readable label for the attached source (optional). */
  sourceLabel?: string;
}

/** A session document plus its fail-closed derived capabilities. */
export interface SessionWithRights {
  session: MediaSessionDoc;
  rightsCapabilities: RightsCapabilities;
}

/** Result of {@link ControlApp.createSession} / {@link ControlApp.getSession}. */
export type CreateSessionResult = SessionWithRights;
export type GetSessionResult = SessionWithRights;

/** One entry of {@link ControlApp.listSessions}. */
export interface SessionSummary {
  /** Session id. */
  id: string;
  /** Current lifecycle status. */
  state: MediaSessionDoc["status"];
  /** Creation time (ISO-8601 UTC). */
  createdAt: string;
  /** Caller-supplied source label, when one was given. */
  sourceLabel?: string;
}

/** Result of {@link ControlApp.listSessions}. */
export interface ListSessionsResult {
  sessions: SessionSummary[];
}

/** Result of {@link ControlApp.terminateSession}. */
export interface TerminateSessionResult {
  session: MediaSessionDoc;
}

/** Result of {@link ControlApp.listRenderers}. */
export interface ListRenderersResult {
  renderers: RendererCapability[];
}

/** Input for {@link ControlApp.createRender}. */
export interface CreateRenderInput {
  /** Renderer to use (resolved against the registry). */
  rendererId: string;
  /** Exact renderer version; omit for the highest registered version. */
  rendererVersion?: string;
  /** Output constraints; omit for the plugin's first supported profile. */
  outputProfile?: OutputProfileDoc;
  /** Style selection; omit for `{ styleId: "default", config: {} }`. */
  styleConfig?: {
    styleId?: string;
    config?: unknown;
  };
}

/** Result of {@link ControlApp.createRender} / {@link ControlApp.getRender}. */
export interface RenderEnvelope {
  /** The deterministic render id (`r-<seq>`). */
  renderId: string;
  /** The stored render result document. */
  result: RenderResultDoc;
}

/** One entry of {@link ControlApp.listRenders}. */
export interface RenderSummary {
  renderId: string;
  rendererId: string;
  segmentCount: number;
  provenance: RenderResultDoc["provenance"];
  watermarkAfter: RenderResultDoc["watermarkAfter"];
}

/** Result of {@link ControlApp.listRenders}. */
export interface ListRendersResult {
  renders: RenderSummary[];
}

/** The transport-free control-plane application surface. */
export interface ControlApp {
  /** The resolved observability seams (read-only; used by the transport). */
  readonly observability: { logger: Logger; metrics: MetricsRegistry };
  createSession(input: CreateSessionInput, ctx?: ControlCallContext): Promise<CreateSessionResult>;
  getSession(sessionId: string, ctx?: ControlCallContext): Promise<GetSessionResult>;
  listSessions(ctx?: ControlCallContext): Promise<ListSessionsResult>;
  terminateSession(sessionId: string, ctx?: ControlCallContext): Promise<TerminateSessionResult>;
  listRenderers(ctx?: ControlCallContext): Promise<ListRenderersResult>;
  createRender(
    sessionId: string,
    input: CreateRenderInput,
    ctx?: ControlCallContext,
  ): Promise<RenderEnvelope>;
  getRender(sessionId: string, renderId: string, ctx?: ControlCallContext): Promise<RenderEnvelope>;
  listRenders(sessionId: string, ctx?: ControlCallContext): Promise<ListRendersResult>;
}

/** A stored render, keyed by its deterministic id. */
interface StoredRender {
  renderId: string;
  sessionId: string;
  rendererId: string;
  result: RenderResultDoc;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Formats zod issues as `"path: message"` strings (registry convention). */
function issuesOf(error: { issues: { path: PropertyKey[]; message: string }[] }): string[] {
  return error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
}

/** `true` when the fail-closed derivation denied every capability. */
function allDenied(caps: RightsCapabilities): boolean {
  return (
    !caps.canReferenceSourceFrames &&
    !caps.canDeliverLive &&
    !caps.canStoreDerivatives &&
    !caps.canShare
  );
}

/** Deterministic per-app clock: `TEST_EPOCH_MS + ticks`. */
function createDeterministicClock(): () => number {
  let ticks = 0;
  return (): number => TEST_EPOCH_MS + (ticks += 1);
}

/** Fresh registry pre-registered with the reference test-card renderer. */
function defaultRendererRegistry(): RendererRegistry {
  const registry = new RendererRegistry();
  registry.register(createTestCardRenderer());
  return registry;
}

// ---------------------------------------------------------------------------
// Input validation (zod schemas reused from @sporta/contracts; scalar guards
// for the rest — no new dependencies)
// ---------------------------------------------------------------------------

function requireNonEmptyString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string" || value.length < 1 || value.length > maxLength) {
    throw new ControlValidationError(
      `${field} must be a string of 1..${maxLength} characters (got ${typeof value})`,
    );
  }
  return value;
}

function validateCreateSessionInput(input: unknown): {
  policy: AuthorizationPolicyDoc;
  sourceLabel: string | undefined;
} {
  if (!isRecord(input)) {
    throw new ControlValidationError("request body must be a JSON object");
  }
  const policyResult = AuthorizationPolicy.safeParse(input.authorizationPolicy);
  if (!policyResult.success) {
    throw new ControlValidationError("authorizationPolicy is not a valid AuthorizationPolicy", {
      issues: issuesOf(policyResult.error),
    });
  }
  const sourceLabel =
    input.sourceLabel === undefined
      ? undefined
      : requireNonEmptyString(input.sourceLabel, "sourceLabel", MAX_LABEL_LENGTH);
  return { policy: policyResult.data, sourceLabel };
}

function validateCreateRenderInput(input: unknown): {
  rendererId: string;
  rendererVersion: string | undefined;
  outputProfile: OutputProfileDoc | undefined;
  styleConfig: { styleId?: string; config: unknown } | undefined;
} {
  if (!isRecord(input)) {
    throw new ControlValidationError("request body must be a JSON object");
  }
  const rendererId = requireNonEmptyString(input.rendererId, "rendererId", MAX_LABEL_LENGTH);
  const rendererVersion =
    input.rendererVersion === undefined
      ? undefined
      : requireNonEmptyString(input.rendererVersion, "rendererVersion", MAX_LABEL_LENGTH);
  let outputProfile: OutputProfileDoc | undefined;
  if (input.outputProfile !== undefined) {
    const parsed = OutputProfile.safeParse(input.outputProfile);
    if (!parsed.success) {
      throw new ControlValidationError("outputProfile is not a valid OutputProfile", {
        issues: issuesOf(parsed.error),
      });
    }
    outputProfile = parsed.data;
  }
  let styleConfig: { styleId?: string; config: unknown } | undefined;
  if (input.styleConfig !== undefined) {
    if (!isRecord(input.styleConfig)) {
      throw new ControlValidationError("styleConfig must be a JSON object");
    }
    const styleId =
      input.styleConfig.styleId === undefined
        ? undefined
        : requireNonEmptyString(input.styleConfig.styleId, "styleConfig.styleId", MAX_LABEL_LENGTH);
    styleConfig = {
      ...(styleId === undefined ? {} : { styleId }),
      config: input.styleConfig.config,
    };
  }
  return { rendererId, rendererVersion, outputProfile, styleConfig };
}

// ---------------------------------------------------------------------------
// createControlApp
// ---------------------------------------------------------------------------

/**
 * Creates the transport-free control-plane application. See the module docs
 * for the fail-closed rights model, the playback gate, and the observability
 * contract. All state (sessions, policies, labels, world models, renders) is
 * instance-local and in-memory: W701 is the first experience-plane slice and
 * deliberately ships no durable control-plane store.
 */
export function createControlApp(options: ControlAppOptions = {}): ControlApp {
  const sessionRepository = options.sessionRepository ?? new InMemorySessionRepository();
  const rendererRegistry = options.rendererRegistry ?? defaultRendererRegistry();
  const nowMs = options.nowMs ?? createDeterministicClock();
  const logger = options.observability?.logger ?? createNoopLogger();
  const metrics = options.observability?.metrics ?? new MetricsRegistry();
  const lifecycle = new SessionLifecycle({ now: () => new Date(nowMs()) });
  const worldModelFactory =
    options.worldModelFactory ??
    ((sessionId: string) => WorldModelEngine.create(sessionId, { now: () => nowMs() }));

  // Instance-local state.
  const policies = new Map<string, AuthorizationPolicyDoc>();
  const sourceLabels = new Map<string, string>();
  const worldModels = new Map<string, WorldModelEngineInstance>();
  const rendersById = new Map<string, StoredRender>();
  const rendersBySession = new Map<string, StoredRender[]>();
  const initedPlugins = new WeakSet<RendererPlugin>();
  let sessionSeq = 0;
  let renderSeq = 0;

  const stageLogger = logger.child({ stage: CONTROL_API_STAGE });

  /** Silent no-op logger (absent observability never breaks the app). */
  function createNoopLogger(): Logger {
    return createLogger({ minLevel: "error", sink: () => {} });
  }

  /**
   * Exactly one structured line + counters per method call. The call scope
   * lets an impl publish a sessionId discovered mid-call (createSession)
   * so the line is correlated even on failure.
   */
  async function run<T>(
    route: ControlRoute,
    ctx: ControlCallContext | undefined,
    sessionId: string | undefined,
    fn: (scope: { sessionId?: string }) => Promise<T>,
  ): Promise<T> {
    const scope: { sessionId?: string } = {};
    const callLogger = (): Logger => {
      const bound = scope.sessionId ?? sessionId;
      const bindings: { sessionId?: string; correlationId?: string } = {};
      if (bound !== undefined) bindings.sessionId = bound;
      if (ctx?.requestId !== undefined) bindings.correlationId = ctx.requestId;
      return stageLogger.child(bindings);
    };
    try {
      const value = await fn(scope);
      metrics.counter(CONTROL_METRIC_NAMES.requestsTotal, { [ROUTE_LABEL]: route }).inc();
      callLogger().info(`control.${route}`, { route, outcome: "ok" });
      return value;
    } catch (err) {
      const failure = asControlError(err);
      metrics.counter(CONTROL_METRIC_NAMES.requestsTotal, { [ROUTE_LABEL]: route }).inc();
      metrics
        .counter(CONTROL_METRIC_NAMES.failuresTotal, {
          [FAILURE_CLASS_LABEL]: failure.failureClass,
        })
        .inc();
      const fields: Record<string, unknown> = {
        route,
        outcome: "failed",
        failureClass: failure.failureClass,
        message: failure.message,
      };
      if (failure.failureClass === "internal") {
        callLogger().error(`control.${route}`, fields);
      } else {
        callLogger().warn(`control.${route}`, fields);
      }
      throw failure;
    }
  }

  /** Fail-closed capabilities for a session, derived at `now`. */
  function capabilitiesFor(sessionId: string): RightsCapabilities {
    // A missing stored policy decision DENIES (fail-closed).
    return deriveRightsCapabilities(policies.get(sessionId), new Date(nowMs()));
  }

  function requireSession(sessionId: string): MediaSessionDoc {
    requireNonEmptyString(sessionId, "sessionId", MAX_LABEL_LENGTH);
    const session = sessionRepository.get(sessionId);
    if (session === null) {
      throw new ControlUnknownSessionError(sessionId);
    }
    return session;
  }

  function worldModelFor(sessionId: string): WorldModelEngineInstance {
    let engine = worldModels.get(sessionId);
    if (engine === undefined) {
      engine = worldModelFactory(sessionId);
      worldModels.set(sessionId, engine);
    }
    return engine;
  }

  // --- createSession ------------------------------------------------------

  async function createSessionImpl(
    scope: { sessionId?: string },
    input: unknown,
  ): Promise<CreateSessionResult> {
    const { policy, sourceLabel } = validateCreateSessionInput(input);

    // Fail-closed policy check FIRST: derive the capabilities; a policy from
    // which no capability can be derived denies creation (nothing is stored).
    const now = new Date(nowMs());
    const rightsCapabilities = deriveRightsCapabilities(policy, now);
    if (allDenied(rightsCapabilities)) {
      const expired =
        policy.expiresAtIso !== undefined && Date.parse(policy.expiresAtIso) <= now.getTime();
      throw new ControlRightsDeniedError(
        expired
          ? `rights denied (expired-policy): policy '${policy.policyId}' is not currently in force`
          : `rights denied: policy '${policy.policyId}' grants no rights capabilities`,
        {
          policyId: policy.policyId,
          reason: expired ? "expired-policy" : "no-capabilities",
        },
      );
    }

    // Create the media session and attach the authorized source. The source
    // is a declared placeholder (no streams) until ingestion (W10x) wires
    // real media; `declaredRightsPolicyId` references the presented policy.
    sessionSeq += 1;
    const sessionId = `sess-${sessionSeq}`;
    scope.sessionId = sessionId; // correlate the call's log line
    const source: SourceMedia = {
      sourceId: `src-${sessionSeq}`,
      kind: "file",
      videoStreams: 0,
      audioStreams: 0,
      declaredRightsPolicyId: policy.policyId,
    };
    let session = newSession(
      { sessionId, authorizationPolicyId: policy.policyId, sources: [source] },
      new Date(nowMs()),
    );
    session = sessionRepository.create(session);
    policies.set(sessionId, policy);
    if (sourceLabel !== undefined) {
      sourceLabels.set(sessionId, sourceLabel);
    }

    // Advance created -> authorized. The lifecycle rights gate requires the
    // policy to allow `analysis`; a denial is recorded on the session as a
    // terminal rights-denied failure (auditable), then rethrown.
    try {
      session = lifecycle.transition(session, "authorized", { policy });
    } catch (err) {
      if (err instanceof RightsDeniedError) {
        const failed = lifecycle.fail(session, "rights-denied", err.message);
        sessionRepository.update(failed);
        throw wrapSessionRightsDenied(err);
      }
      throw asControlError(err);
    }
    sessionRepository.update(session);
    return { session: structuredClone(session), rightsCapabilities };
  }

  // --- getSession / listSessions / terminateSession -----------------------

  function getSessionImpl(sessionId: string): GetSessionResult {
    const session = requireSession(sessionId);
    return { session, rightsCapabilities: capabilitiesFor(sessionId) };
  }

  function listSessionsImpl(): ListSessionsResult {
    const sessions: MediaSessionDoc[] = [];
    for (const status of SessionStatus.options) {
      sessions.push(...sessionRepository.listByStatus(status));
    }
    sessions.sort((a, b) =>
      a.createdAtIso === b.createdAtIso
        ? a.sessionId < b.sessionId
          ? -1
          : 1
        : a.createdAtIso < b.createdAtIso
          ? -1
          : 1,
    );
    const summaries: SessionSummary[] = sessions.map((session) => {
      const label = sourceLabels.get(session.sessionId);
      return {
        id: session.sessionId,
        state: session.status,
        createdAt: session.createdAtIso,
        ...(label !== undefined ? { sourceLabel: label } : {}),
      };
    });
    return { sessions: summaries };
  }

  function terminateSessionImpl(sessionId: string): TerminateSessionResult {
    const session = requireSession(sessionId);
    // Idempotent per the streaming contract: terminating an already-terminal
    // session is a no-op that never re-stamps `cancelledAtIso`.
    const final = lifecycle.cancel(session);
    sessionRepository.update(final);
    return { session: structuredClone(final) };
  }

  // --- listRenderers / createRender ---------------------------------------

  function listRenderersImpl(): ListRenderersResult {
    return { renderers: rendererRegistry.list() };
  }

  async function createRenderImpl(sessionId: string, input: unknown): Promise<RenderEnvelope> {
    const parsed = validateCreateRenderInput(input);

    // 1. Resolve the plugin (unknown renderer id/version → media-invalid).
    let plugin: RendererPlugin;
    try {
      plugin = rendererRegistry.resolve(parsed.rendererId, parsed.rendererVersion);
    } catch (err) {
      if (err instanceof RendererContractError) {
        throw wrapRendererResolutionError(err);
      }
      throw asControlError(err);
    }
    // Init-once with the host observability seam (plugin lifecycle contract).
    if (!initedPlugins.has(plugin)) {
      await plugin.init({ observability: { logger, metrics } });
      initedPlugins.add(plugin);
    }
    const capability = plugin.capability();

    // 2. Fail-closed rights derivation. Rendering is compute: it does NOT
    //    require canStoreDerivatives (playback is gated separately), but an
    //    all-denied decision (e.g. the policy expired) denies everything
    //    (architecture-lock §11).
    requireSession(sessionId);
    const rightsCapabilities = capabilitiesFor(sessionId);
    if (allDenied(rightsCapabilities)) {
      const policy = policies.get(sessionId);
      const expired =
        policy?.expiresAtIso !== undefined && Date.parse(policy.expiresAtIso) <= nowMs();
      throw new ControlRightsDeniedError(
        expired
          ? `rights denied (expired-policy): no valid rights decision for session '${sessionId}'`
          : `rights denied: no rights capability can be derived for session '${sessionId}'`,
        { sessionId, reason: expired ? "expired-policy" : "no-capabilities" },
      );
    }

    // 3. Snapshot the session's world model at the current watermark. The
    //    event tail is empty in W701 (no perception pipeline feeds the
    //    control plane yet): eventsSince(snapshot watermark) is [].
    const engine = worldModelFor(sessionId);
    const snapshot: WorldSnapshot = engine.snapshot();
    const events = engine.eventsSince(snapshot.watermark.sequence);

    // 4. Build the request. Renderer identity comes from the RESOLVED
    //    plugin; styleConfig defaults `{ styleId: "default", config: {} }`;
    //    outputProfile defaults to the plugin's first supported profile.
    const outputProfile = parsed.outputProfile ?? firstSupportedProfile(capability);
    const request: RenderRequestDoc = {
      sessionId,
      schemaVersion: SCHEMA_VERSION,
      rendererId: capability.rendererId,
      rendererVersion: capability.rendererVersion,
      styleConfig: {
        styleId: parsed.styleConfig?.styleId ?? DEFAULT_STYLE_ID,
        configSchemaVersion: SCHEMA_VERSION,
        config: parsed.styleConfig?.config ?? {},
      },
      snapshotVersion: engine.snapshotVersion,
      eventsSinceSequence: snapshot.watermark.sequence,
      outputProfile,
      rightsCapabilities,
      sourceFrameRefs: [],
    };
    const requestCheck = RenderRequest.safeParse(request);
    if (!requestCheck.success) {
      throw new ControlInternalError("built RenderRequest failed schema validation", {
        issues: issuesOf(requestCheck.error),
      });
    }

    // 5. Plugin gates: validateRequest, then render (rejections map to
    //    typed control errors; render re-runs every gate per R2/R3/R4).
    const validation = plugin.validateRequest(request);
    if (!validation.ok) {
      throw new ControlMediaInvalidError(`renderer rejected the request: ${validation.reason}`, {
        rendererId: capability.rendererId,
        rendererVersion: capability.rendererVersion,
        reason: validation.reason,
      });
    }
    let result: RenderResultDoc;
    try {
      result = await plugin.render(request, { snapshot, events });
    } catch (err) {
      throw asControlError(err);
    }
    const resultCheck = RenderResult.safeParse(result);
    if (!resultCheck.success) {
      throw new ControlInternalError("renderer returned an invalid RenderResult", {
        issues: issuesOf(resultCheck.error),
      });
    }

    // 6. Store the result, keyed by the deterministic render id `r-<seq>`.
    renderSeq += 1;
    const renderId = `r-${renderSeq}`;
    const record: StoredRender = {
      renderId,
      sessionId,
      rendererId: capability.rendererId,
      result: structuredClone(resultCheck.data),
    };
    rendersById.set(renderId, record);
    const list = rendersBySession.get(sessionId) ?? [];
    list.push(record);
    rendersBySession.set(sessionId, list);
    return { renderId, result: structuredClone(record.result) };
  }

  function firstSupportedProfile(capability: RendererCapability): OutputProfileDoc {
    const profile = capability.supportedOutputProfiles[0];
    if (profile === undefined) {
      throw new ControlMediaInvalidError(
        `renderer '${capability.rendererId}' declares no supported output profiles and none was given`,
        { rendererId: capability.rendererId },
      );
    }
    return profile;
  }

  // --- getRender / listRenders (playback access gate) ----------------------

  function requirePlaybackRights(sessionId: string): RightsCapabilities {
    const caps = capabilitiesFor(sessionId);
    if (caps.canStoreDerivatives !== true) {
      throw new ControlRightsDeniedError(
        `playback access denied: rightsCapabilities.canStoreDerivatives is false for session '${sessionId}'`,
        { sessionId },
      );
    }
    return caps;
  }

  function getRenderImpl(sessionId: string, renderId: string): RenderEnvelope {
    requireSession(sessionId);
    // Playback gate: deny BEFORE revealing whether the render exists.
    requirePlaybackRights(sessionId);
    const record = rendersById.get(renderId);
    if (record === undefined || record.sessionId !== sessionId) {
      throw new ControlUnknownRenderError(sessionId, renderId);
    }
    return { renderId: record.renderId, result: structuredClone(record.result) };
  }

  function listRendersImpl(sessionId: string): ListRendersResult {
    requireSession(sessionId);
    requirePlaybackRights(sessionId);
    const records = rendersBySession.get(sessionId) ?? [];
    const renders: RenderSummary[] = records.map((record) => {
      const result = structuredClone(record.result);
      return {
        renderId: record.renderId,
        rendererId: record.rendererId,
        segmentCount: result.outputSegments.length,
        provenance: result.provenance,
        watermarkAfter: result.watermarkAfter,
      };
    });
    return { renders };
  }

  const app: ControlApp = {
    observability: { logger, metrics },
    createSession: (input, ctx) =>
      run("create_session", ctx, undefined, (scope) => createSessionImpl(scope, input)),
    getSession: (sessionId, ctx) =>
      run("get_session", ctx, sessionId, async () => getSessionImpl(sessionId)),
    listSessions: (ctx) => run("list_sessions", ctx, undefined, async () => listSessionsImpl()),
    terminateSession: (sessionId, ctx) =>
      run("terminate_session", ctx, sessionId, async () => terminateSessionImpl(sessionId)),
    listRenderers: (ctx) => run("list_renderers", ctx, undefined, async () => listRenderersImpl()),
    createRender: (sessionId, input, ctx) =>
      run("create_render", ctx, sessionId, async () => createRenderImpl(sessionId, input)),
    getRender: (sessionId, renderId, ctx) =>
      run("get_render", ctx, sessionId, async () => getRenderImpl(sessionId, renderId)),
    listRenders: (sessionId, ctx) =>
      run("list_renders", ctx, sessionId, async () => listRendersImpl(sessionId)),
  };
  return app;
}
