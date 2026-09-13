/**
 * The conformance harness for the renderer plugin contract (W501).
 *
 * `runConformance` proves a {@link RendererPlugin} honors the contract rules
 * R1–R8 documented in `../plugin.ts` by exercising it exactly the way a host
 * would: probe `capability()`, `init()` without an observability seam, run
 * `validateRequest` admission probes, one happy-path `render`, a
 * defense-in-depth `render` (no prior validation), then `dispose()` and a
 * post-dispose `render`. Every probe is adversarial: off-list output profile,
 * full-deny rights with source-frame references, stale snapshot version,
 * disposal, and un-validated render.
 *
 * Guarantees:
 *
 * - The harness NEVER throws because a plugin misbehaves — every violation
 *   (including throwing, returning garbage, or returning promises) is
 *   recorded as a failed check with structured evidence in `detail`.
 * - Checks have stable ids; a check that a plugin's capability makes
 *   inapplicable is reported as passed with a `detail` starting `"n/a …"`
 *   (for example the rights probe when `requiresSourceFrames` is false).
 * - `passed` is true only when every check passed.
 *
 * Input construction (when `opts` is omitted): snapshot via
 * `buildWorldSnapshot()`; three `WorldEventStreamEntry`s composed from
 * `buildEventEnvelope()` with ascending sequences continuing the snapshot
 * watermark; request from `buildRenderRequest()` with the capability's
 * rendererId/version and `supportedOutputProfiles[0]`, full-allow rights,
 * empty `sourceFrameRefs`, and styleConfig `{ styleId: "conformance",
 * configSchemaVersion: "0.1.0", config: {} }` — merged via `deepMerge`.
 * Callers can override the snapshot, events and request; the harness always
 * wins on the gated fields (rendererId, rendererVersion, outputProfile,
 * rightsCapabilities, sourceFrameRefs — the fields the probes manipulate).
 * The base request keeps `snapshotVersion: 1`; a plugin whose
 * `minSnapshotVersion` exceeds 1 should be probed with an explicit
 * `opts.request.snapshotVersion`.
 *
 * Expected values: the harness computes `expectedLastSequence` = the last
 * input event's sequence (or 0 when no events were passed) and
 * `expectedWatermarkSequence` = the same, except that it is the snapshot's
 * watermark sequence when no events were passed. Check
 * `render-provenance-faithful` verifies `provenance.lastEventSequence` never
 * claims MORE than `expectedLastSequence` (an upward lie) and echoes
 * `req.snapshotVersion`; reporting LESS than full application is legal ONLY
 * when flagged, which check `degradation-explicit` enforces (R7 — the two
 * checks together make "no silent staleness" decidable). Check
 * `render-watermark-monotonic` requires the exact R6 watermark.
 *
 * Limitation (documented, by design): the harness is synchronous — the
 * W501 signature is `runConformance(...): ConformanceReport`. Plugin methods
 * that return promises instead of values are recorded as failures of the
 * checks that needed the value; an async conformance harness can be layered
 * on top when a host needs one (W701+).
 */
import { OutputProfile, RenderResult, RendererCapability } from "@sporta/contracts";
import type {
  RenderRequest,
  RightsCapabilities,
  WorldEventStreamEntry,
  WorldSnapshot,
} from "@sporta/contracts";
import {
  buildEventEnvelope,
  buildRenderRequest,
  buildWorldSnapshot,
  deepMerge,
} from "@sporta/testing";
import { RendererContractError } from "./errors";
import { clampNonNegativeInt, cloneJson, deepEqual, errMessage, isRecord } from "./internal";
import type { RendererPlugin } from "./plugin";

/** One conformance result: stable id, human description, verdict, evidence. */
export interface ConformanceCheck {
  checkId: string;
  description: string;
  passed: boolean;
  detail?: string;
}

/** The full conformance report for one plugin run. */
export interface ConformanceReport {
  /** The capability the plugin claims (as returned by the first call). */
  plugin: RendererCapability;
  /** Every check, in documented order. */
  checks: ConformanceCheck[];
  /** True only when every check passed. */
  passed: boolean;
}

/** Options for {@link runConformance}; every field is optional. */
export interface ConformanceOptions {
  /** SWM snapshot to render from (default: `buildWorldSnapshot()`). */
  snapshot?: WorldSnapshot;
  /** Ordered events to apply after the snapshot (default: 3 composed events). */
  events?: WorldEventStreamEntry[];
  /**
   * Base request merged onto `buildRenderRequest()`. The harness overrides
   * the gated fields (rendererId, rendererVersion, outputProfile,
   * rightsCapabilities, sourceFrameRefs). Use it for e.g. a higher
   * `snapshotVersion` when the plugin's `minSnapshotVersion` exceeds 1.
   */
  request?: RenderRequest;
  /** Rights for the happy-path request (default: full allow). */
  rights?: RightsCapabilities;
}

const FULL_ALLOW: RightsCapabilities = {
  canReferenceSourceFrames: true,
  canDeliverLive: true,
  canStoreDerivatives: true,
  canShare: true,
};

const DENY_ALL: RightsCapabilities = {
  canReferenceSourceFrames: false,
  canDeliverLive: false,
  canStoreDerivatives: false,
  canShare: false,
};

/** Profile used when a broken capability leaves no usable profile to probe. */
const FALLBACK_PROFILE: OutputProfile = {
  resolution: { w: 1280, h: 720 },
  frameRate: 30,
  codec: "h264",
  container: "mp4",
  latencyClass: "offline",
};

const CONFORMANCE_STYLE: RenderRequest["styleConfig"] = {
  styleId: "conformance",
  configSchemaVersion: "0.1.0",
  config: {},
};

type Attempt<T> =
  { kind: "value"; value: T } | { kind: "threw"; error: unknown } | { kind: "promise" };

/**
 * Calls a plugin method and classifies the outcome. A returned promise is its
 * own outcome kind (the harness is synchronous — see the module docs).
 */
function attempt<T>(fn: () => T | Promise<T>): Attempt<T> {
  try {
    const value = fn();
    if (value instanceof Promise) return { kind: "promise" };
    return { kind: "value", value };
  } catch (error) {
    return { kind: "threw", error };
  }
}

function describeAttempt(result: Attempt<unknown>): string {
  switch (result.kind) {
    case "threw":
      return `threw: ${errMessage(result.error)}`;
    case "promise":
      return "returned a Promise (the W501 conformance harness is synchronous)";
    case "value":
      return "returned a value";
  }
}

function usableString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function firstUsableProfile(value: unknown): OutputProfile | undefined {
  if (!Array.isArray(value)) return undefined;
  for (const item of value) {
    const parsed = OutputProfile.safeParse(item);
    if (parsed.success) return parsed.data; // canonical: unknown keys stripped
  }
  return undefined;
}

function summarizeIssues(error: {
  issues: Array<{ path: PropertyKey[]; message: string }>;
}): string {
  const issues = error.issues;
  if (issues.length === 0) return "no issues reported";
  const shown = issues
    .slice(0, 3)
    .map((issue) => `${issue.path.map(String).join(".") || "<root>"}: ${issue.message}`);
  return `${shown.join("; ")}${issues.length > 3 ? ` (+${issues.length - 3} more)` : ""}`;
}

function describeValidation(value: unknown): string {
  if (isRecord(value) && value.ok === true) return "accepted";
  if (isRecord(value) && value.ok === false) {
    const failureClass =
      typeof value.failureClass === "string" ? value.failureClass : "<non-string>";
    const reason = typeof value.reason === "string" ? value.reason : "<non-string reason>";
    return `rejected (failureClass=${failureClass}, reason=${JSON.stringify(reason)})`;
  }
  return "returned a non-validation value";
}

function isRejectionWithClass(value: unknown, failureClass: string): boolean {
  return isRecord(value) && value.ok === false && value.failureClass === failureClass;
}

function isRejection(value: unknown): boolean {
  return isRecord(value) && value.ok === false;
}

/** Composes the default 3-event input stream continuing the snapshot watermark. */
function composeDefaultEvents(snapshot: WorldSnapshot): WorldEventStreamEntry[] {
  const baseSequence = snapshot.watermark.sequence;
  const startMs = snapshot.watermark.watermarkMs;
  return [0, 1, 2].map((index) => ({
    sequence: baseSequence + 1 + index,
    snapshotVersionAfter: index + 1,
    event: buildEventEnvelope({
      eventId: `conformance-evt-${index}`,
      sessionId: snapshot.sessionId,
      eventTimeMs: startMs + 500 * (index + 1),
    }),
  }));
}

/**
 * Runs the conformance harness. See the module docs for the construction
 * rules, the check list, and the sync-harness limitation.
 */
export function runConformance(
  plugin: RendererPlugin,
  opts: ConformanceOptions = {},
): ConformanceReport {
  // ---------------------------------------------------------------- R1 probe
  const capabilityFirst = attempt(() => plugin.capability());
  const capabilitySecond = attempt(() => plugin.capability());
  const capabilityRaw: unknown = capabilityFirst.kind === "value" ? capabilityFirst.value : {};
  const capabilityParsed = RendererCapability.safeParse(capabilityRaw);
  const capability = capabilityParsed.success ? capabilityParsed.data : null;

  // Identity/derived fields for request construction: parsed capability
  // first, then structurally-usable raw fields (a broken capability document
  // must still yield probeable requests), then neutral defaults.
  const rawRecord: Record<string, unknown> = isRecord(capabilityRaw) ? capabilityRaw : {};
  const rendererId =
    capability?.rendererId ?? usableString(rawRecord.rendererId) ?? "conformance.renderer";
  const rendererVersion =
    capability?.rendererVersion ?? usableString(rawRecord.rendererVersion) ?? "0.0.0";
  const profileList: unknown =
    capability?.supportedOutputProfiles ?? rawRecord.supportedOutputProfiles;
  const profile = firstUsableProfile(profileList) ?? FALLBACK_PROFILE;
  const requiresSourceFrames =
    capability?.requiresSourceFrames ??
    (typeof rawRecord.requiresSourceFrames === "boolean" ? rawRecord.requiresSourceFrames : false);
  const minSnapshotVersion = clampNonNegativeInt(
    capability?.minSnapshotVersion ?? rawRecord.minSnapshotVersion,
  );

  // ------------------------------------------------------------ input setup
  const snapshot = opts.snapshot ?? buildWorldSnapshot();
  const events: WorldEventStreamEntry[] = opts.events ?? composeDefaultEvents(snapshot);
  const lastEvent = events.length > 0 ? events[events.length - 1]! : undefined;
  const expectedLastSequence = lastEvent !== undefined ? lastEvent.sequence : 0;
  const expectedWatermarkSequence =
    lastEvent !== undefined ? lastEvent.sequence : snapshot.watermark.sequence;

  const baseRequest = deepMerge(buildRenderRequest(), opts.request ?? {});
  const gate: Record<string, unknown> = {
    rendererId,
    rendererVersion,
    outputProfile: profile,
    rightsCapabilities: opts.rights ?? FULL_ALLOW,
    sourceFrameRefs: [],
  };
  if (opts.request === undefined) {
    gate.sessionId = snapshot.sessionId;
    gate.eventsSinceSequence = snapshot.watermark.sequence;
  }
  const request = deepMerge(baseRequest, gate);
  // Exact styleConfig replacement (cloned so a mutating plugin cannot corrupt
  // the caller's fixture or the harness constant): `deepMerge` would merge
  // `styleConfig.config` objects recursively and leave residue from the
  // builder defaults, but the conformance style — or a caller's own style —
  // must win wholesale.
  request.styleConfig = cloneJson(opts.request?.styleConfig ?? CONFORMANCE_STYLE);

  // ------------------------------------------------------------- init probe
  const initResult = attempt(() => plugin.init());
  const initIssue = initResult.kind === "value" ? null : `init() ${describeAttempt(initResult)}`;

  // -------------------------------------------------------- validate probes
  const offListProfile: OutputProfile = {
    ...profile,
    codec: `${profile.codec}-conformance-offlist`,
  };
  const offListRequest: RenderRequest = { ...request, outputProfile: offListProfile };
  const rightsDenyRequest: RenderRequest = {
    ...request,
    rightsCapabilities: DENY_ALL,
    sourceFrameRefs: ["conformance-src-frame-1"],
  };
  // A capability with minSnapshotVersion 0 probes below the schema floor
  // (-1); the R3 gate must reject it either way.
  const staleSnapshotVersion = minSnapshotVersion - 1;
  const staleRequest: RenderRequest = { ...request, snapshotVersion: staleSnapshotVersion };

  const validateOffList =
    initIssue === null ? attempt(() => plugin.validateRequest(offListRequest)) : null;
  const validateRights =
    requiresSourceFrames && initIssue === null
      ? attempt(() => plugin.validateRequest(rightsDenyRequest))
      : null;
  const validateStale =
    initIssue === null ? attempt(() => plugin.validateRequest(staleRequest)) : null;

  // ---------------------------------------------------------- happy-path run
  let happyIssue: string | null = initIssue;
  let resultRaw: unknown = null;
  let renderIssue: string | null = null;
  if (happyIssue === null) {
    const validation = attempt(() => plugin.validateRequest(request));
    if (validation.kind !== "value") {
      happyIssue = `validateRequest ${describeAttempt(validation)}`;
    } else if (isRecord(validation.value) && validation.value.ok === true) {
      const renderResult = attempt(() => plugin.render(request, { snapshot, events }));
      if (renderResult.kind !== "value") {
        renderIssue = `render ${describeAttempt(renderResult)}`;
      } else {
        resultRaw = renderResult.value;
      }
    } else {
      happyIssue = `validateRequest rejected the conformance base request (${describeValidation(validation.value)})`;
    }
  }
  const resultParsed = resultRaw === null ? null : RenderResult.safeParse(resultRaw);
  const result: RenderResult | null =
    resultParsed !== null && resultParsed.success ? resultParsed.data : null;
  const parseIssue =
    resultParsed !== null && !resultParsed.success
      ? `render result failed RenderResult validation: ${summarizeIssues(resultParsed.error)}`
      : null;
  // The first problem in the chain that makes checks 6-11 undecidable.
  const noResultIssue = happyIssue ?? renderIssue ?? parseIssue;

  // ------------------------------------------- defense-in-depth (before R4)
  const defenseRender =
    initIssue === null ? attempt(() => plugin.render(offListRequest, { snapshot, events })) : null;

  // -------------------------------------------------------------- R4 dispose
  const disposeResult = attempt(() => plugin.dispose());
  const postDisposeRender =
    disposeResult.kind === "value"
      ? attempt(() => plugin.render(request, { snapshot, events }))
      : null;

  // ---------------------------------------------------------------- checks
  const checkCapabilitySchema: ConformanceCheck = {
    checkId: "capability-schema-valid",
    description:
      "capability() returns a schema-valid RendererCapability with at least one supported output profile",
    passed: false,
  };
  if (capabilityFirst.kind !== "value") {
    checkCapabilitySchema.detail = `capability() ${describeAttempt(capabilityFirst)}`;
  } else if (!capabilityParsed.success) {
    checkCapabilitySchema.detail = `capability failed RendererCapability validation: ${summarizeIssues(capabilityParsed.error)}`;
  } else if (capabilityParsed.data.supportedOutputProfiles.length === 0) {
    checkCapabilitySchema.passed = false;
    checkCapabilitySchema.detail = "supportedOutputProfiles is empty";
  } else {
    checkCapabilitySchema.passed = true;
    checkCapabilitySchema.detail = `rendererId=${capabilityParsed.data.rendererId} rendererVersion=${capabilityParsed.data.rendererVersion} profiles=${capabilityParsed.data.supportedOutputProfiles.length}`;
  }

  const checkCapabilityStable: ConformanceCheck = {
    checkId: "capability-stable",
    description:
      "capability() returns a deep-equal document on every call (R1: immutable identity)",
    passed: false,
  };
  if (capabilityFirst.kind !== "value" || capabilitySecond.kind !== "value") {
    checkCapabilityStable.detail = `capability() ${describeAttempt(
      capabilityFirst.kind !== "value" ? capabilityFirst : capabilitySecond,
    )}`;
  } else if (deepEqual(capabilityFirst.value, capabilitySecond.value)) {
    checkCapabilityStable.passed = true;
    checkCapabilityStable.detail = "two calls returned deep-equal documents";
  } else {
    checkCapabilityStable.detail = "two capability() calls returned different documents";
  }

  const checkRejectsOffListProfile: ConformanceCheck = {
    checkId: "validate-rejects-unsupported-profile",
    description:
      "validateRequest rejects an off-list outputProfile with failureClass media-invalid (R3)",
    passed: false,
  };
  if (validateOffList === null) {
    checkRejectsOffListProfile.detail = initIssue ?? "validateRequest was not invoked";
  } else if (validateOffList.kind !== "value") {
    checkRejectsOffListProfile.detail = `validateRequest ${describeAttempt(validateOffList)}`;
  } else if (isRejectionWithClass(validateOffList.value, "media-invalid")) {
    checkRejectsOffListProfile.passed = true;
    checkRejectsOffListProfile.detail = "rejected the off-list profile with media-invalid";
  } else {
    checkRejectsOffListProfile.detail = `expected rejection with media-invalid, but validateRequest ${describeValidation(
      validateOffList.value,
    )}`;
  }

  const checkRejectsSourceFramesWithoutRights: ConformanceCheck = {
    checkId: "validate-rejects-source-frames-without-rights",
    description:
      "when requiresSourceFrames, validateRequest rejects full-deny rights with failureClass rights-denied (R2)",
    passed: false,
  };
  if (!requiresSourceFrames) {
    checkRejectsSourceFramesWithoutRights.passed = true;
    checkRejectsSourceFramesWithoutRights.detail =
      "n/a: capability does not require source frames (requiresSourceFrames=false)";
  } else if (validateRights === null) {
    checkRejectsSourceFramesWithoutRights.detail = initIssue ?? "validateRequest was not invoked";
  } else if (validateRights.kind !== "value") {
    checkRejectsSourceFramesWithoutRights.detail = `validateRequest ${describeAttempt(validateRights)}`;
  } else if (isRejectionWithClass(validateRights.value, "rights-denied")) {
    checkRejectsSourceFramesWithoutRights.passed = true;
    checkRejectsSourceFramesWithoutRights.detail =
      "rejected deny-rights source-frame request with rights-denied";
  } else {
    checkRejectsSourceFramesWithoutRights.detail = `expected rejection with rights-denied, but validateRequest ${describeValidation(
      validateRights.value,
    )}`;
  }

  const checkRejectsStaleSnapshot: ConformanceCheck = {
    checkId: "validate-rejects-stale-snapshot",
    description:
      "validateRequest rejects a snapshotVersion below capability.minSnapshotVersion (R3)",
    passed: false,
  };
  if (validateStale === null) {
    checkRejectsStaleSnapshot.detail = initIssue ?? "validateRequest was not invoked";
  } else if (validateStale.kind !== "value") {
    checkRejectsStaleSnapshot.detail = `validateRequest ${describeAttempt(validateStale)}`;
  } else if (isRejection(validateStale.value)) {
    checkRejectsStaleSnapshot.passed = true;
    const failureClass =
      isRecord(validateStale.value) && typeof validateStale.value.failureClass === "string"
        ? validateStale.value.failureClass
        : "<non-string>";
    checkRejectsStaleSnapshot.detail = `rejected the stale snapshotVersion ${staleSnapshotVersion} (failureClass=${failureClass})`;
  } else {
    checkRejectsStaleSnapshot.detail = `expected a rejection for snapshotVersion ${staleSnapshotVersion}, but validateRequest ${describeValidation(
      validateStale.value,
    )}`;
  }

  const checkResultSchema: ConformanceCheck = {
    checkId: "render-result-schema-valid",
    description: "the happy-path render result parses as a RenderResult",
    passed: false,
  };
  if (noResultIssue !== null) {
    checkResultSchema.detail = noResultIssue;
  } else if (result !== null) {
    checkResultSchema.passed = true;
    checkResultSchema.detail = "render result parsed as RenderResult";
  } else {
    checkResultSchema.detail = parseIssue ?? "no render result";
  }

  const checkProvenance: ConformanceCheck = {
    checkId: "render-provenance-faithful",
    description:
      "provenance echoes req.snapshotVersion and never claims more application than the events allow (R5)",
    passed: false,
  };
  if (noResultIssue !== null || result === null) {
    checkProvenance.detail = noResultIssue ?? "no render result";
  } else {
    const snapshotVersionOk = result.provenance.snapshotVersion === request.snapshotVersion;
    const lastEventSequenceOk =
      events.length === 0
        ? result.provenance.lastEventSequence === 0
        : result.provenance.lastEventSequence <= expectedLastSequence;
    if (snapshotVersionOk && lastEventSequenceOk) {
      checkProvenance.passed = true;
      checkProvenance.detail =
        result.provenance.lastEventSequence === expectedLastSequence
          ? `snapshotVersion=${result.provenance.snapshotVersion}, lastEventSequence=${result.provenance.lastEventSequence} (full application)`
          : `snapshotVersion=${result.provenance.snapshotVersion}, lastEventSequence=${result.provenance.lastEventSequence} (partial application of ${expectedLastSequence}; must be flagged degraded — see degradation-explicit)`;
    } else {
      checkProvenance.detail = `provenance {snapshotVersion: ${result.provenance.snapshotVersion}, lastEventSequence: ${result.provenance.lastEventSequence} } does not match request snapshotVersion ${request.snapshotVersion} or claims more application than the last event sequence ${expectedLastSequence}`;
    }
  }

  const checkWatermark: ConformanceCheck = {
    checkId: "render-watermark-monotonic",
    description:
      "watermarkAfter.sequence equals the last event sequence (or the snapshot watermark without events) and watermarkMs never regresses (R6)",
    passed: false,
  };
  if (noResultIssue !== null || result === null) {
    checkWatermark.detail = noResultIssue ?? "no render result";
  } else if (
    result.watermarkAfter.sequence === expectedWatermarkSequence &&
    result.watermarkAfter.watermarkMs >= snapshot.watermark.watermarkMs
  ) {
    checkWatermark.passed = true;
    checkWatermark.detail = `watermarkAfter {watermarkMs: ${result.watermarkAfter.watermarkMs}, sequence: ${result.watermarkAfter.sequence}} (snapshot watermarkMs ${snapshot.watermark.watermarkMs})`;
  } else {
    checkWatermark.detail = `watermarkAfter {watermarkMs: ${result.watermarkAfter.watermarkMs}, sequence: ${result.watermarkAfter.sequence}} violates R6: expected sequence ${expectedWatermarkSequence} and watermarkMs >= ${snapshot.watermark.watermarkMs}`;
  }

  const checkSegments: ConformanceCheck = {
    checkId: "render-segments-wellformed",
    description:
      "outputSegments are ordered, non-overlapping, positive-length, uniquely identified, with non-empty artifactRefs (R8)",
    passed: false,
  };
  if (noResultIssue !== null || result === null) {
    checkSegments.detail = noResultIssue ?? "no render result";
  } else {
    const segments = result.outputSegments;
    const problems: string[] = [];
    const segmentIds = new Set<string>();
    let previousEndMs: number | undefined;
    for (const segment of segments) {
      if (!(segment.startMs >= 0) || !(segment.startMs < segment.endMs)) {
        problems.push(`segment ${segment.segmentId}: startMs/endMs violate 0 <= startMs < endMs`);
      }
      if (previousEndMs !== undefined && segment.startMs < previousEndMs) {
        problems.push(
          `segment ${segment.segmentId}: overlaps or precedes previous end ${previousEndMs}`,
        );
      }
      previousEndMs = segment.endMs;
      if (segmentIds.has(segment.segmentId)) {
        problems.push(`segment ${segment.segmentId}: duplicate segmentId`);
      }
      segmentIds.add(segment.segmentId);
      if (typeof segment.artifactRef !== "string" || segment.artifactRef.length === 0) {
        problems.push(`segment ${segment.segmentId}: empty artifactRef`);
      }
    }
    if (problems.length === 0) {
      checkSegments.passed = true;
      checkSegments.detail = `${segments.length} segment(s) well-formed`;
    } else {
      checkSegments.detail = problems.join("; ");
    }
  }

  const checkIdentity: ConformanceCheck = {
    checkId: "render-session-identity",
    description: "the result echoes the request's sessionId and rendererId (R8)",
    passed: false,
  };
  if (noResultIssue !== null || result === null) {
    checkIdentity.detail = noResultIssue ?? "no render result";
  } else if (result.sessionId === request.sessionId && result.rendererId === request.rendererId) {
    checkIdentity.passed = true;
    checkIdentity.detail = `sessionId=${result.sessionId} rendererId=${result.rendererId}`;
  } else {
    checkIdentity.detail = `result {sessionId: ${result.sessionId}, rendererId: ${result.rendererId}} does not echo request {sessionId: ${request.sessionId}, rendererId: ${request.rendererId}}`;
  }

  const checkDegradation: ConformanceCheck = {
    checkId: "degradation-explicit",
    description:
      "partial application is reported as degraded with a reason, and degraded always carries a degradationReason (R7)",
    passed: false,
  };
  if (noResultIssue !== null || result === null) {
    checkDegradation.detail = noResultIssue ?? "no render result";
  } else {
    const applied = result.provenance.lastEventSequence;
    const degraded = result.rendererHealth.degraded;
    const reason = result.rendererHealth.degradationReason;
    const silentStaleness = applied < expectedLastSequence && !(degraded && reason !== undefined);
    const degradedWithoutReason = degraded && reason === undefined;
    if (!silentStaleness && !degradedWithoutReason) {
      checkDegradation.passed = true;
      checkDegradation.detail = degraded
        ? `degraded with reason "${reason}"`
        : `healthy with full application (lastEventSequence=${applied})`;
    } else {
      const problems: string[] = [];
      if (silentStaleness) {
        problems.push(
          `silent staleness: lastEventSequence ${applied} < expected ${expectedLastSequence} while rendererHealth.degraded is ${String(degraded)}`,
        );
      }
      if (degradedWithoutReason) {
        problems.push("degraded is true without a degradationReason");
      }
      checkDegradation.detail = problems.join("; ");
    }
  }

  const checkRefusesAfterDispose: ConformanceCheck = {
    checkId: "render-refuses-after-dispose",
    description: "render throws a RendererContractError (internal) after dispose (R4)",
    passed: false,
  };
  if (disposeResult.kind !== "value") {
    checkRefusesAfterDispose.detail = `dispose() ${describeAttempt(disposeResult)}`;
  } else if (
    postDisposeRender !== null &&
    postDisposeRender.kind === "threw" &&
    postDisposeRender.error instanceof RendererContractError &&
    postDisposeRender.error.failureClass === "internal"
  ) {
    checkRefusesAfterDispose.passed = true;
    checkRefusesAfterDispose.detail = `post-dispose render threw RendererContractError (internal): ${postDisposeRender.error.message}`;
  } else {
    checkRefusesAfterDispose.detail =
      postDisposeRender === null
        ? "post-dispose render was not attempted (dispose failed)"
        : `post-dispose render ${describeAttempt(postDisposeRender)} instead of throwing RendererContractError (internal)`;
  }

  const checkDefenseInDepth: ConformanceCheck = {
    checkId: "render-defense-in-depth",
    description:
      "render throws a RendererContractError for an unsupported-profile request without prior validateRequest (R3)",
    passed: false,
  };
  if (defenseRender === null) {
    checkDefenseInDepth.detail = initIssue ?? "render was not invoked";
  } else if (
    defenseRender.kind === "threw" &&
    defenseRender.error instanceof RendererContractError
  ) {
    checkDefenseInDepth.passed = true;
    checkDefenseInDepth.detail = `render threw RendererContractError (failureClass=${defenseRender.error.failureClass}): ${defenseRender.error.message}`;
  } else {
    checkDefenseInDepth.detail = `render ${describeAttempt(defenseRender)} instead of throwing RendererContractError`;
  }

  const checks: ConformanceCheck[] = [
    checkCapabilitySchema,
    checkCapabilityStable,
    checkRejectsOffListProfile,
    checkRejectsSourceFramesWithoutRights,
    checkRejectsStaleSnapshot,
    checkResultSchema,
    checkProvenance,
    checkWatermark,
    checkSegments,
    checkIdentity,
    checkDegradation,
    checkRefusesAfterDispose,
    checkDefenseInDepth,
  ];

  return {
    plugin: capabilityRaw as RendererCapability,
    checks,
    passed: checks.every((check) => check.passed),
  };
}
