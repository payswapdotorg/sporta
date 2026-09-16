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
  SessionConflictError,
  SessionLifecycle,
  newSession,
} from "@sporta/session";
import type { MediaSessionRepository } from "@sporta/session";
import {
  ComputeAdmissionError,
  ComputeResourceLimitError,
  ComputeRightsError,
  ComputeValidationError,
  canonicalByteLengthOf,
  sha256OfCanonicalJson,
} from "@sporta/compute-adapter";
import type {
  ComputeAdapterPort,
  ComputeDispatchOutcome,
  ComputeJobEvent as ComputeJobEventDoc,
  ComputeJobState as ComputeJobStateDoc,
  ComputeTerminalDisposition as ComputeTerminalDispositionDoc,
  ComputeUsageRecord as ComputeUsageRecordDoc,
} from "@sporta/compute-adapter";
import {
  ControlComputeUnavailableError,
  ControlInternalError,
  ControlMediaInvalidError,
  ControlResourceLimitError,
  ControlRightsDeniedError,
  ControlUnknownComputeJobError,
  ControlUnknownRenderError,
  ControlUnknownSegmentError,
  ControlUnknownSessionError,
  ControlValidationError,
  asControlError,
  wrapRendererResolutionError,
  wrapSessionRightsDenied,
} from "./errors";
import { asRenderOutputStoreError } from "./playback";
import type {
  RenderOutputDocument,
  RenderOutputListResult,
  RenderOutputStore,
  RenderOutputWriter,
} from "./playback";

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
  | "list_renders"
  | "get_render_output"
  | "list_render_outputs"
  // W914 (ADDITIVE): the async compute-dispatch surface (G2-approved).
  | "create_render_async"
  | "get_compute_job";

/** Default style id when the caller does not select one. */
const DEFAULT_STYLE_ID = "default";

/** Max accepted length of caller-supplied ids and labels. */
const MAX_LABEL_LENGTH = 200;

/** W921: max accepted length of a caller-supplied session id. */
const MAX_SESSION_ID_LENGTH = 128;

/** W921: the closed charset of a caller-supplied session id (`[a-z0-9-]`). */
const SESSION_ID_PATTERN = /^[a-z0-9-]+$/;

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
  /**
   * W504 (ADDITIVE): the render-output store serving the playback routes —
   * a STRUCTURAL port satisfied by `@sporta/output-pipeline`'s segment
   * store (no package dependency; see `./playback.ts`). Absent by default:
   * the playback routes then answer 404 (no stored outputs exist), exactly
   * like an empty store.
   */
  renderOutputStore?: RenderOutputStore;
  /**
   * W914 (ADDITIVE): the compute adapter the async render surface dispatches
   * through (a structural `ComputeAdapterPort` — see
   * `@sporta/compute-adapter-hosted` for the production implementation and
   * its env-driven provider selection). Absent by default: the async surface
   * then answers its typed unavailability error (503) and EVERY existing
   * (synchronous) route is unaffected — this option composes additively,
   * exactly like `renderOutputStore` did in W504.
   */
  computeAdapter?: ComputeAdapterPort;
  /**
   * W914 (ADDITIVE): the write side of the render-output store (structural;
   * satisfied by `@sporta/output-pipeline`'s `RenderSegmentStore`). The
   * async surface stores a completed job's artifact deliveries through it.
   * Absent by default: async renders are then observable but their outputs
   * are not playback-served (the same posture as an unconfigured reader).
   */
  renderOutputWriter?: RenderOutputWriter;
}

/** Input for {@link ControlApp.createSession}. */
export interface CreateSessionInput {
  /** The authorization policy decision for this session (trust boundary). */
  authorizationPolicy: AuthorizationPolicyDoc;
  /** Human-readable label for the attached source (optional). */
  sourceLabel?: string;
  /**
   * W921 (ADDITIVE, G2 precedent): caller-supplied session id. When provided,
   * the session is created under EXACTLY this id (fail-closed: non-empty,
   * 1..128 chars, charset `[a-z0-9-]`, and unique in the session repository —
   * a collision is a typed `validation` error, NEVER a silent renumbering).
   * When absent, the historical `sess-<seq>` allocation is byte-identical.
   */
  sessionId?: string;
  /**
   * W921 (ADDITIVE): caller-supplied creation time (ISO-8601 UTC). When
   * provided, the session document carries it verbatim instead of the app
   * clock's `now` — the durable-reconstruction path restores a session with
   * its RECORDED creation time, never the replay clock's. Absent → unchanged
   * clock-derived behavior.
   */
  createdAtIso?: string;
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
  /**
   * W921 flight 8 (ADDITIVE, the sessionId seam's G2 precedent): caller-
   * supplied render id. The control plane's `r-<seq>` allocation is
   * PER-INSTANCE, so renders of the SAME durable session dispatched from
   * different serverless instances can collide on `r-<seq>` with divergent
   * content — the exact defect class the W920 gate found for session ids.
   * When provided, the render is stored under EXACTLY this id (fail-closed:
   * non-empty, 1..128 chars, charset `[a-z0-9-]`, and unique in the render
   * repository — a collision is a typed `validation` error, NEVER a silent
   * renumbering). When absent, the historical `r-<seq>` allocation is
   * byte-identical.
   */
  renderId?: string;
}

/** Result of {@link ControlApp.createRender} / {@link ControlApp.getRender}. */
export interface RenderEnvelope {
  /** The render id (`r-<seq>`, or the W921 caller-supplied collision-safe id). */
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

// ---------------------------------------------------------------------------
// W914 (ADDITIVE): the async compute-dispatch surface (G2-approved)
// ---------------------------------------------------------------------------

/**
 * Input for {@link ControlApp.createRenderAsync} — the synchronous
 * {@link CreateRenderInput} plus the compute-dispatch controls. The renderer
 * selection, output profile, and style resolution follow the SAME rules as
 * the synchronous path; the extra fields control the compute job identity
 * and budget.
 */
export interface CreateRenderAsyncInput extends CreateRenderInput {
  /** Caller-authored job id (default: `render-job-<sessionId>-<seq>`, the W304 derivation). */
  jobId?: string;
  /** Dedupe identity (default: `render-<sessionId>-wm-<seq>-seq-<seq>`, the W304 derivation). */
  idempotencyKey?: string;
  /** Whole-job deadline in ms (default: 60 000 — the W304 `renderDeadlineMs` default). */
  deadlineMs?: number;
}

/** Result of {@link ControlApp.createRenderAsync}. */
export interface CreateRenderAsyncResult {
  /** The dispatch disposition (`admitted`, or a counted `duplicate`). */
  disposition: "admitted" | "duplicate";
  /** The compute job id. */
  jobId: string;
  /** The dedupe identity. */
  idempotencyKey: string;
  /** The session the job renders for. */
  sessionId: string;
  /** The adapter that admitted the job. */
  adapterId: string;
  /** The job state at dispatch return. */
  jobState: ComputeJobStateDoc;
  /** Present when `disposition === "admitted"`. */
  admittedAtMs?: number;
  /** The stored render id, when the job's render was already ingested. */
  renderId?: string;
}

/** The playback-safe projection of one output artifact of a compute job. */
export interface ComputeJobArtifactView {
  /** The content-addressed artifact id (sha-256). */
  artifactId: string;
  contentType: string;
  byteLength: number;
  /** The W504 store-scope metadata (identity only — bytes are playback-gated). */
  metadata: {
    renderId?: string;
    segmentId?: string;
    snapshotVersion?: number;
    frameCount?: number;
    totalDurationMs?: number;
  };
}

/** The terminal completion of a compute job, projected for observation. */
export interface ComputeJobCompletionView {
  status: "succeeded" | "failed" | "cancelled";
  terminalDisposition: ComputeTerminalDispositionDoc;
  failure?: { errorClass: string; message: string; terminal: string };
  /** Identity-only artifact views — the bytes come from the playback-gated routes. */
  outputs: ComputeJobArtifactView[];
  attempts: number;
  claims: number;
  timing: {
    submittedAtMs: number;
    startedAtMs?: number;
    finishedAtMs: number;
    queueWaitMs?: number;
    executionMs: number;
  };
  /** The never-silent input accounting (always present). */
  accounting: {
    consumedInputIds: string[];
    unconsumedInputs: Array<{ inputId: string; reason: string }>;
  };
  /** The metering record for this terminal job (always present). */
  usage: ComputeUsageRecordDoc;
}

/**
 * Result of {@link ControlApp.getComputeJob}: the observable state of one
 * compute job — lifecycle state, decision trail, the terminal completion
 * (with accounting and usage) once settled, and the render id once the
 * job's outputs were ingested into the playback store. Artifact BYTES are
 * deliberately absent: they are served only by the playback-gated
 * render-output routes.
 */
export interface GetComputeJobResult {
  jobId: string;
  idempotencyKey: string;
  sessionId: string;
  state: ComputeJobStateDoc;
  /** The decision/progress trail in occurrence order. */
  events: ComputeJobEventDoc[];
  /** The stored render id once the job's render was ingested. */
  renderId?: string;
  /** The ingestion state of the job's outputs into the playback store. */
  ingest: { status: "pending" | "stored" | "failed" | "none"; error?: string };
  /** Present once the job reached its terminal disposition. */
  completion?: ComputeJobCompletionView;
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
  /**
   * W504 (ADDITIVE): one stored render-output segment — the encoded document
   * (e.g. the animated SVG text) plus its content type, byte length, content
   * hash, and container manifest, verbatim. Same playback gate as
   * `getRender` (fail-closed; rights checked BEFORE existence is revealed).
   */
  getRenderOutput(
    sessionId: string,
    renderId: string,
    segmentId: string,
    ctx?: ControlCallContext,
  ): Promise<RenderOutputDocument>;
  /** W504 (ADDITIVE): the segment summaries stored under one render. */
  listRenderOutputs(
    sessionId: string,
    renderId: string,
    ctx?: ControlCallContext,
  ): Promise<RenderOutputListResult>;
  /**
   * W914 (ADDITIVE): dispatches one render asynchronously through the
   * configured compute adapter (a REAL render job — real renderer, real
   * output store, artifact handoff). The synchronous `createRender` path is
   * untouched; when no adapter is configured this answers the typed
   * `ControlComputeUnavailableError`.
   */
  createRenderAsync(
    sessionId: string,
    input: CreateRenderAsyncInput,
    ctx?: ControlCallContext,
  ): Promise<CreateRenderAsyncResult>;
  /**
   * W914 (ADDITIVE): observes one compute job — lifecycle state, decision
   * trail, terminal completion with never-silent accounting and its usage
   * record, plus the render id once the outputs were ingested.
   */
  getComputeJob(
    sessionId: string,
    jobId: string,
    ctx?: ControlCallContext,
  ): Promise<GetComputeJobResult>;
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
  sessionId: string | undefined;
  createdAtIso: string | undefined;
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
  // W921 (fail-closed): a caller-supplied session id must be a sane, non-empty
  // lowercase slug. Anything else is a typed validation error — never coerced,
  // never silently renumbered.
  let sessionId: string | undefined;
  if (input.sessionId !== undefined) {
    sessionId = requireNonEmptyString(input.sessionId, "sessionId", MAX_SESSION_ID_LENGTH);
    if (!SESSION_ID_PATTERN.test(sessionId)) {
      throw new ControlValidationError(
        `sessionId must match ${SESSION_ID_PATTERN.source} (got '${sessionId}')`,
        { sessionId, reason: "invalid-session-id" },
      );
    }
  }
  // W921 (fail-closed): a caller-supplied creation time must be ISO-8601.
  let createdAtIso: string | undefined;
  if (input.createdAtIso !== undefined) {
    createdAtIso = requireNonEmptyString(input.createdAtIso, "createdAtIso", 64);
    if (Number.isNaN(Date.parse(createdAtIso))) {
      throw new ControlValidationError("createdAtIso must be an ISO-8601 timestamp", {
        createdAtIso,
      });
    }
  }
  return { policy: policyResult.data, sourceLabel, sessionId, createdAtIso };
}

function validateCreateRenderInput(input: unknown): {
  rendererId: string;
  rendererVersion: string | undefined;
  outputProfile: OutputProfileDoc | undefined;
  styleConfig: { styleId?: string; config: unknown } | undefined;
  renderId: string | undefined;
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
  // W921 flight 8 (fail-closed): a caller-supplied render id must be a sane,
  // non-empty lowercase slug — anything else is a typed validation error,
  // never coerced, never silently renumbered.
  let renderId: string | undefined;
  if (input.renderId !== undefined) {
    renderId = requireNonEmptyString(input.renderId, "renderId", MAX_SESSION_ID_LENGTH);
    if (!SESSION_ID_PATTERN.test(renderId)) {
      throw new ControlValidationError(`renderId must match ${SESSION_ID_PATTERN.source} (got '${renderId}')`, {
        renderId,
        reason: "invalid-render-id",
      });
    }
  }
  return { rendererId, rendererVersion, outputProfile, styleConfig, renderId };
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
  const renderOutputStore = options.renderOutputStore; // W504 (additive); undefined ≡ empty store
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
    const { policy, sourceLabel, sessionId: callerSessionId, createdAtIso } =
      validateCreateSessionInput(input);

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
    // W921 (ADDITIVE): when the caller supplied a session id, the session is
    // created under EXACTLY that id (fail-closed above; a repository conflict
    // is the typed duplicate error, never a silent renumbering). Without it,
    // the historical `sess-<seq>` allocation is byte-identical.
    sessionSeq += 1;
    const sessionId = callerSessionId ?? `sess-${sessionSeq}`;
    scope.sessionId = sessionId; // correlate the call's log line
    const source: SourceMedia = {
      sourceId: `src-${sessionSeq}`,
      kind: "file",
      videoStreams: 0,
      audioStreams: 0,
      declaredRightsPolicyId: policy.policyId,
    };
    let session = newSession(
      {
        sessionId,
        authorizationPolicyId: policy.policyId,
        sources: [source],
        ...(createdAtIso !== undefined ? { createdAtIso } : {}),
      },
      new Date(nowMs()),
    );
    try {
      session = sessionRepository.create(session);
    } catch (err) {
      // W921 (fail-closed): a caller-supplied id that collides with an
      // existing session is a typed validation rejection — the session is
      // NEVER silently renumbered to a fresh `sess-<seq>`.
      if (err instanceof SessionConflictError) {
        throw new ControlValidationError(
          `sessionId '${sessionId}' is already in use (fail closed — never renumbered)`,
          { sessionId, reason: "duplicate-session-id" },
        );
      }
      throw err;
    }
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

    // 6. Store the result, keyed by the deterministic render id `r-<seq>` —
    //    or, W921 flight 8 (ADDITIVE), by the caller-supplied collision-safe
    //    id when one was given (fail-closed above; a collision is the typed
    //    duplicate error, never a renumbering).
    if (parsed.renderId !== undefined && rendersById.has(parsed.renderId)) {
      throw new ControlValidationError(
        `renderId '${parsed.renderId}' is already in use (fail closed — never renumbered)`,
        { renderId: parsed.renderId, reason: "duplicate-render-id" },
      );
    }
    renderSeq += 1;
    const renderId = parsed.renderId ?? `r-${renderSeq}`;
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

  // --- getRenderOutput / listRenderOutputs (W504 playback access) --------

  /** The stored policy of a session — fail-closed when absent (unreachable after the gate). */
  function requireSessionPolicy(sessionId: string): AuthorizationPolicyDoc {
    const policy = policies.get(sessionId);
    if (policy === undefined) {
      throw new ControlRightsDeniedError(
        `playback access denied: no authorization policy is on record for session '${sessionId}'`,
        { sessionId },
      );
    }
    return policy;
  }

  function getRenderOutputImpl(
    sessionId: string,
    renderId: string,
    segmentId: string,
  ): RenderOutputDocument {
    requireSession(sessionId);
    // Playback gate: deny BEFORE revealing whether anything exists.
    requirePlaybackRights(sessionId);
    const policy = requireSessionPolicy(sessionId);
    if (renderOutputStore === undefined) {
      // No store configured behaves exactly like an empty store.
      throw new ControlUnknownRenderError(sessionId, renderId);
    }
    try {
      const record = renderOutputStore.getSegment({
        sessionId,
        renderId,
        segmentId,
        policy,
        nowMs: nowMs(),
      });
      if (record === null) {
        // Classify the miss: a render with no stored outputs at all is an
        // unknown render; a render with outputs but not this id is an
        // unknown segment.
        const listed = renderOutputStore.listSegments({
          sessionId,
          renderId,
          policy,
          nowMs: nowMs(),
        });
        if (listed.length === 0) {
          throw new ControlUnknownRenderError(sessionId, renderId);
        }
        throw new ControlUnknownSegmentError(sessionId, renderId, segmentId);
      }
      // Contract guard: the store must answer within the requested scope —
      // a record from another session/render/segment is a store-contract
      // violation, never served (architecture-lock §13: derived output must
      // not leak across scopes through mis-scoped store answers).
      if (
        record.sessionId !== sessionId ||
        record.renderId !== renderId ||
        record.segmentId !== segmentId
      ) {
        throw new ControlInternalError(
          `render output store returned a segment outside the requested scope (asked for session '${sessionId}', render '${renderId}', segment '${segmentId}'; got session '${record.sessionId}', render '${record.renderId}', segment '${record.segmentId}')`,
          {
            sessionId,
            renderId,
            segmentId,
            storeSessionId: record.sessionId,
            storeRenderId: record.renderId,
            storeSegmentId: record.segmentId,
          },
        );
      }
      return {
        sessionId: record.sessionId,
        renderId: record.renderId,
        segmentId: record.segmentId,
        contentType: record.contentType,
        byteLength: record.byteLength,
        contentHash: record.contentHash,
        content: record.content,
        manifest: structuredClone(record.manifest),
      };
    } catch (err) {
      // Store failures keep their structural failureClass (rights-denied →
      // 403, resource-limit → 413, ...); the app-level gate above has
      // already handled the ordinary denials.
      throw asRenderOutputStoreError(err);
    }
  }

  function listRenderOutputsImpl(sessionId: string, renderId: string): RenderOutputListResult {
    requireSession(sessionId);
    requirePlaybackRights(sessionId);
    const policy = requireSessionPolicy(sessionId);
    if (renderOutputStore === undefined) {
      // No store configured behaves exactly like an empty store.
      return { sessionId, renderId, segments: [] };
    }
    try {
      const segments = renderOutputStore.listSegments({
        sessionId,
        renderId,
        policy,
        nowMs: nowMs(),
      });
      // Explicit projection to the port's summary shape (a store may carry
      // richer records; only the documented summary fields are answered).
      return {
        sessionId,
        renderId,
        segments: segments.map((segment) => ({
          segmentId: segment.segmentId,
          contentType: segment.contentType,
          byteLength: segment.byteLength,
          contentHash: segment.contentHash,
        })),
      };
    } catch (err) {
      throw asRenderOutputStoreError(err);
    }
  }

  // --- W914 (ADDITIVE): the async compute-dispatch surface ------------------
  // The compute adapter (absent by default — the async surface then fails
  // closed with the typed unavailability error; every sync route unchanged).
  const computeAdapter = options.computeAdapter;
  const renderOutputWriter = options.renderOutputWriter;

  /** One dispatched compute job's control-plane bookkeeping. */
  interface ComputeJobEntry {
    jobId: string;
    sessionId: string;
    renderId: string | undefined;
    /** W921 flight 8: the caller-supplied collision-safe render id at dispatch. */
    callerRenderId: string | undefined;
    ingest: { status: "pending" | "stored" | "failed" | "none"; error?: string };
  }

  const computeJobs = new Map<string, ComputeJobEntry>();
  let computeJobSeq = 0;

  /** The whole-job deadline default (the W304 `renderDeadlineMs` default). */
  const DEFAULT_COMPUTE_DEADLINE_MS = 60_000;

  /** Maps typed compute-adapter refusals onto the control error vocabulary. */
  function wrapComputeError(err: unknown): unknown {
    if (err instanceof ComputeValidationError)
      return asControlError(
        new ControlValidationError(err.message, { ...(err.details as Record<string, unknown>) }),
      );
    if (err instanceof ComputeAdmissionError)
      return asControlError(
        new ControlMediaInvalidError(err.message, { ...(err.details as Record<string, unknown>) }),
      );
    if (err instanceof ComputeResourceLimitError)
      return asControlError(
        new ControlResourceLimitError(err.message, { ...(err.details as Record<string, unknown>) }),
      );
    if (err instanceof ComputeRightsError)
      return asControlError(
        new ControlRightsDeniedError(err.message, { ...(err.details as Record<string, unknown>) }),
      );
    return asControlError(err);
  }

  async function createRenderAsyncImpl(
    sessionId: string,
    input: unknown,
  ): Promise<CreateRenderAsyncResult> {
    if (computeAdapter === undefined) {
      throw new ControlComputeUnavailableError(
        "the async render surface requires a compute adapter (none is configured on this control plane)",
      );
    }
    // 1. Validate the input: the sync-path rules + the dispatch controls.
    if (!isRecord(input)) {
      throw new ControlValidationError("request body must be a JSON object");
    }
    const parsed = validateCreateRenderInput(input);
    const jobIdInput =
      input.jobId === undefined
        ? undefined
        : requireNonEmptyString(input.jobId, "jobId", MAX_LABEL_LENGTH);
    const idempotencyKeyInput =
      input.idempotencyKey === undefined
        ? undefined
        : requireNonEmptyString(input.idempotencyKey, "idempotencyKey", MAX_LABEL_LENGTH);
    let deadlineMs = DEFAULT_COMPUTE_DEADLINE_MS;
    if (input.deadlineMs !== undefined) {
      if (
        typeof input.deadlineMs !== "number" ||
        !Number.isFinite(input.deadlineMs) ||
        input.deadlineMs <= 0
      ) {
        throw new ControlValidationError("deadlineMs must be a finite number > 0");
      }
      deadlineMs = input.deadlineMs;
    }

    // 2. Resolve the plugin (unknown renderer id/version → media-invalid) —
    //    the same admission the sync path applies, so an async dispatch can
    //    never name a renderer the control plane itself would refuse.
    let capability: RendererCapability;
    try {
      const plugin = rendererRegistry.resolve(parsed.rendererId, parsed.rendererVersion);
      capability = plugin.capability();
    } catch (err) {
      if (err instanceof RendererContractError) {
        throw wrapRendererResolutionError(err);
      }
      throw asControlError(err);
    }

    // 3. Fail-closed rights derivation (identical to the sync path).
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

    // 4. Snapshot the session's world model at the current watermark (the
    //    same materialization the sync path renders from).
    const engine = worldModelFor(sessionId);
    const snapshot: WorldSnapshot = engine.snapshot();
    const events = engine.eventsSince(snapshot.watermark.sequence);
    const outputProfile = parsed.outputProfile ?? firstSupportedProfile(capability);

    // 5. Build the materialized inputs (content-addressed — the Wave-2
    //    contract): the snapshot + the event window, each with its
    //    canonical sha-256 and byte size.
    const snapshotPayload = { snapshotVersion: engine.snapshotVersion, snapshot };
    const eventsPayload = { fromSequence: snapshot.watermark.sequence, entries: events };
    // Content addressing of the materialized inputs (the Wave-2 contract):
    // sha-256 of the canonical JSON + the canonical byte size, per input.
    const snapshotContentHash = await sha256OfCanonicalJson(snapshotPayload);
    const eventsContentHash = await sha256OfCanonicalJson(eventsPayload);
    const manifestInputs = [
      {
        inputId: "swm-snapshot",
        kind: "swm-snapshot" as const,
        ref: `swm-snapshot:${sessionId}:v${engine.snapshotVersion}`,
        contentHash: snapshotContentHash,
        byteSize: canonicalByteLengthOf(snapshotPayload),
      },
      {
        inputId: "swm-events",
        kind: "swm-event-window" as const,
        ref: `swm-events:${sessionId}:from-${snapshot.watermark.sequence}`,
        contentHash: eventsContentHash,
        byteSize: canonicalByteLengthOf(eventsPayload),
      },
    ];
    const materialized = [
      { inputId: "swm-snapshot", kind: "swm-snapshot" as const, payload: snapshotPayload },
      { inputId: "swm-events", kind: "swm-event-window" as const, payload: eventsPayload },
    ];

    // 6. The transport-safe job description (the W914 contract): identity,
    //    correlation, renderer+recipe, manifest, output profile, rights
    //    posture, and constraints.
    computeJobSeq += 1;
    const jobId = jobIdInput ?? `render-job-${sessionId}-${computeJobSeq}`; // the W304 derivation pattern
    const idempotencyKey =
      idempotencyKeyInput ??
      `render-${sessionId}-wm-${snapshot.watermark.sequence}-seq-${computeJobSeq}`; // the W304 key
    const policyDoc = policies.get(sessionId);
    const description = {
      schemaVersion: "1.0" as const,
      jobId,
      idempotencyKey,
      sessionId,
      correlationId: `corr-${sessionId}-${computeJobSeq}`,
      traceId: `trace-${sessionId}-${computeJobSeq}`,
      renderer: {
        rendererId: capability.rendererId,
        rendererVersion: capability.rendererVersion,
      },
      recipe: {
        styleId: parsed.styleConfig?.styleId ?? DEFAULT_STYLE_ID,
        configSchemaVersion: SCHEMA_VERSION,
        config: parsed.styleConfig?.config ?? {},
      },
      inputs: manifestInputs,
      outputProfile,
      rights: {
        policyRef: policyDoc?.policyId ?? `unknown-policy:${sessionId}`,
        canReferenceSourceFrames: rightsCapabilities.canReferenceSourceFrames,
      },
      constraints: {
        deadlineMs,
        priority: 0, // the W304 priority
        resourceHints: { computeClass: capability.rendererClass },
      },
    };

    // W921 flight 8 (fail-closed): a caller-supplied render id that is
    // already taken fails the DISPATCH (before the job runs) — never a silent
    // renumbering. (The ingest re-checks for the in-flight race.)
    if (parsed.renderId !== undefined && rendersById.has(parsed.renderId)) {
      throw new ControlValidationError(
        `renderId '${parsed.renderId}' is already in use (fail closed — never renumbered)`,
        { renderId: parsed.renderId, reason: "duplicate-render-id" },
      );
    }

    // 7. Dispatch through the ComputeAdapter port.
    let outcome: ComputeDispatchOutcome;
    try {
      outcome = await computeAdapter.dispatch(description, materialized);
    } catch (err) {
      throw wrapComputeError(err);
    }
    const outcomeJobId = outcome.disposition === "admitted" ? outcome.handle.jobId : outcome.jobId;
    const outcomeKey =
      outcome.disposition === "admitted" ? outcome.handle.idempotencyKey : outcome.idempotencyKey;
    const entry: ComputeJobEntry = {
      jobId: outcomeJobId,
      sessionId,
      renderId: undefined,
      callerRenderId: parsed.renderId,
      ingest: { status: "pending" },
    };
    const existing = computeJobs.get(outcomeJobId);
    if (existing !== undefined || outcome.disposition === "duplicate") {
      // A counted duplicate: the job's bookkeeping already exists (or the
      // adapter resolved the idempotency key) — return it with the render
      // id when its outputs were already ingested.
      const known = existing ?? computeJobs.get(outcomeJobId);
      if (known !== undefined) {
        return {
          disposition: "duplicate",
          jobId: known.jobId,
          idempotencyKey: outcomeKey,
          sessionId,
          adapterId: computeAdapter.describe().adapterId,
          jobState: outcome.disposition === "duplicate" ? outcome.jobState : "admitted",
          ...(known.renderId !== undefined ? { renderId: known.renderId } : {}),
        };
      }
      // A duplicate for a job this control-plane instance never dispatched
      // (another instance's ledger admitted it): the honest duplicate answer
      // without local render bookkeeping.
      return {
        disposition: "duplicate",
        jobId: outcomeJobId,
        idempotencyKey: outcomeKey,
        sessionId,
        adapterId: computeAdapter.describe().adapterId,
        jobState: outcome.disposition === "duplicate" ? outcome.jobState : "admitted",
      };
    }
    computeJobs.set(outcomeJobId, entry);
    // Subscription-driven ingestion: when the job settles, its render and
    // outputs materialize (idempotently — see ingestComputeJob).
    computeAdapter.subscribe(outcomeJobId, () => {
      void ingestComputeJob(outcomeJobId);
    });
    // The honest job state at dispatch return (the decoupled handoff may
    // already have progressed past admission).
    const stateAtReturn = (await computeAdapter.getJob(outcomeJobId))?.state ?? "admitted";
    return {
      disposition: "admitted",
      jobId: outcomeJobId,
      idempotencyKey: outcomeKey,
      sessionId,
      adapterId: computeAdapter.describe().adapterId,
      jobState: stateAtReturn,
      admittedAtMs: outcome.handle.admittedAtMs,
    };
  }

  /**
   * Ingests one settled job's render (idempotent): validates the render
   * result document, stores the render under the SAME `r-<seq>` sequence as
   * the synchronous path, and stores each inline artifact into the render
   * output store under the control plane's render id.
   */
  async function ingestComputeJob(jobId: string): Promise<void> {
    if (computeAdapter === undefined) return;
    const entry = computeJobs.get(jobId);
    if (entry === undefined || entry.ingest.status !== "pending") return;
    const snapshot = await computeAdapter.getJob(jobId);
    if (snapshot === null || snapshot.completion === undefined) return;
    const completion = snapshot.completion;
    if (completion.status !== "succeeded") {
      entry.ingest = { status: "none" };
      return;
    }
    try {
      // 1. The renderer's own result document (validated against contracts).
      const resultCheck = RenderResult.safeParse(completion.renderResult);
      if (!resultCheck.success) {
        throw new ControlInternalError("compute job returned an invalid RenderResult", {
          jobId,
          issues: issuesOf(resultCheck.error),
        });
      }
      // W921 flight 8: the stored render id is the caller-supplied
      // collision-safe id when one was dispatched, else the historical
      // `r-<seq>` allocation. A caller id that collided in the in-flight
      // race fails the ingest loudly (typed, never renumbered).
      if (entry.callerRenderId !== undefined && rendersById.has(entry.callerRenderId)) {
        throw new ControlValidationError(
          `renderId '${entry.callerRenderId}' is already in use (fail closed — never renumbered)`,
          { renderId: entry.callerRenderId, reason: "duplicate-render-id" },
        );
      }
      renderSeq += 1;
      const renderId = entry.callerRenderId ?? `r-${renderSeq}`;
      const record: StoredRender = {
        renderId,
        sessionId: entry.sessionId,
        rendererId: resultCheck.data.rendererId,
        result: structuredClone(resultCheck.data),
      };
      rendersById.set(renderId, record);
      const list = rendersBySession.get(entry.sessionId) ?? [];
      list.push(record);
      rendersBySession.set(entry.sessionId, list);
      // 2. The artifacts: inline deliveries become stored render-output
      //    segments under the control plane's render id (the playback store
      //    is the SAME port the sync path's composition configures).
      if (renderOutputWriter !== undefined) {
        for (const artifact of completion.outputs) {
          if (artifact.delivery.mode !== "inline") continue;
          renderOutputWriter.storeSegment({
            sessionId: entry.sessionId,
            renderId,
            segment: {
              segmentId: artifact.metadata.segmentId ?? artifact.artifactId,
              contentType: artifact.contentType,
              content: artifact.delivery.content,
              byteLength: artifact.byteLength,
              contentHash: artifact.contentHash,
              manifest: artifact.manifest,
            },
          });
        }
      }
      entry.renderId = renderId;
      entry.ingest = { status: "stored" };
    } catch (err) {
      const failure = asControlError(err);
      entry.ingest = { status: "failed", error: failure.message };
    }
  }

  async function getComputeJobImpl(sessionId: string, jobId: string): Promise<GetComputeJobResult> {
    if (computeAdapter === undefined) {
      throw new ControlComputeUnavailableError(
        "the async render surface requires a compute adapter (none is configured on this control plane)",
      );
    }
    requireSession(sessionId);
    requireNonEmptyString(jobId, "jobId", MAX_LABEL_LENGTH);
    const entry = computeJobs.get(jobId);
    const snapshot = await computeAdapter.getJob(jobId);
    if (entry === undefined || snapshot === null || entry.sessionId !== sessionId) {
      // Session-scoped 404: a job id from another session is indistinguishable
      // from an unknown one (no cross-session probing).
      throw new ControlUnknownComputeJobError(sessionId, jobId);
    }
    // Poll-driven ingestion fallback (idempotent with the subscription).
    if (entry.ingest.status === "pending" && snapshot.completion !== undefined) {
      await ingestComputeJob(jobId);
    }
    const result: GetComputeJobResult = {
      jobId: snapshot.jobId,
      idempotencyKey: snapshot.idempotencyKey,
      sessionId: snapshot.sessionId,
      state: snapshot.state,
      events: structuredClone(snapshot.events),
      ...(entry.renderId !== undefined ? { renderId: entry.renderId } : {}),
      ingest: entry.ingest,
    };
    if (snapshot.completion !== undefined) {
      const completion = snapshot.completion;
      result.completion = {
        status: completion.status,
        terminalDisposition: completion.terminalDisposition,
        ...(completion.failure !== undefined
          ? {
              failure: {
                errorClass: completion.failure.errorClass,
                message: completion.failure.message,
                terminal: completion.failure.terminal,
              },
            }
          : {}),
        outputs: completion.outputs.map((artifact) => ({
          artifactId: artifact.artifactId,
          contentType: artifact.contentType,
          byteLength: artifact.byteLength,
          metadata: {
            ...(artifact.metadata.renderId !== undefined
              ? { renderId: artifact.metadata.renderId }
              : {}),
            ...(artifact.metadata.segmentId !== undefined
              ? { segmentId: artifact.metadata.segmentId }
              : {}),
            ...(artifact.metadata.snapshotVersion !== undefined
              ? { snapshotVersion: artifact.metadata.snapshotVersion }
              : {}),
            ...(artifact.metadata.frameCount !== undefined
              ? { frameCount: artifact.metadata.frameCount }
              : {}),
            ...(artifact.metadata.totalDurationMs !== undefined
              ? { totalDurationMs: artifact.metadata.totalDurationMs }
              : {}),
          },
        })),
        attempts: completion.attempts,
        claims: completion.claims,
        timing: completion.timing,
        accounting: completion.accounting,
        usage: completion.usage,
      };
    }
    return result;
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
    getRenderOutput: (sessionId, renderId, segmentId, ctx) =>
      run("get_render_output", ctx, sessionId, async () =>
        getRenderOutputImpl(sessionId, renderId, segmentId),
      ),
    listRenderOutputs: (sessionId, renderId, ctx) =>
      run("list_render_outputs", ctx, sessionId, async () =>
        listRenderOutputsImpl(sessionId, renderId),
      ),
    createRenderAsync: (sessionId, input, ctx) =>
      run("create_render_async", ctx, sessionId, async () =>
        createRenderAsyncImpl(sessionId, input),
      ),
    getComputeJob: (sessionId, jobId, ctx) =>
      run("get_compute_job", ctx, sessionId, async () => getComputeJobImpl(sessionId, jobId)),
  };
  return app;
}
