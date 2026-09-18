/**
 * The conformance harness for the frozen `GameEngineAdapter` seam (R302) —
 * the W501 renderer-contract conformance style applied to the second-level,
 * provider-neutral game-engine seam.
 *
 * `runGameEngineConformance` proves an adapter honors the seam's rules by
 * exercising it exactly the way a renderer implementation would: probe
 * `describe()` twice, `buildScene` from a deterministic synthetic SWM
 * (SYNTHETIC-DIAGNOSTIC input — never real-video acceptance), an event-
 * application probe with out-of-envelope + replayed events, one happy-path
 * `renderScene`, a second render for determinism, a two-style distinctness
 * probe, and fail-loud probes (unknown scene, unsupported format, over-
 * capacity snapshot).
 *
 * Guarantees (mirroring W501):
 *
 * - the harness NEVER throws because an adapter misbehaves — every violation
 *   (including thrown promises or garbage shapes) is a failed check with
 *   structured evidence in `detail`;
 * - checks have stable ids (`G1`-`G13`); a check an adapter's capability
 *   makes inapplicable is reported passed with a `detail` starting `"n/a …"`
 *   (e.g. style distinctness for a single-style engine);
 * - `passed` is true only when every check passed.
 *
 * Documented conventions this harness enforces beyond the frozen types
 * (fail-loud seam conventions, mirroring the repo style):
 *
 * - exceeding `maxConcurrentEntities` at build time THROWS (never clamps);
 * - `renderScene` with an unknown sceneId or an unsupported output format
 *   THROWS (never returns garbage);
 * - frame staging is REAL: for `rgb24`/`rgba32` outputs the staged file's
 *   byte length is verified against `frameCount × w × h × bytesPerPixel`;
 * - renders are DETERMINISTIC: two identical renders stage byte-identical
 *   frame sequences (the deterministic-software-engine guarantee).
 *
 * Limitation (documented, by design): like the W501 harness, this harness is
 * synchronous — adapter methods that return promises are recorded as
 * failures of the checks that needed the value.
 */
import { readFileSync } from "node:fs";
import {
  GameEngineDescriptor,
  GameSceneBuildRequest,
  WorldEventStreamEntry,
  WorldSnapshot,
} from "@sporta/contracts";
import type { GameEngineAdapter } from "@sporta/contracts";
import { buildEventEnvelope, buildWorldSnapshot } from "@sporta/testing";

/** One conformance result: stable id, description, verdict, evidence. */
export interface GameEngineConformanceCheck {
  checkId: string;
  description: string;
  passed: boolean;
  detail?: string;
}

/** The full conformance report for one adapter run. */
export interface GameEngineConformanceReport {
  /** The descriptor the adapter claims (as returned by the first call). */
  engine: GameEngineDescriptor | null;
  /** Every check, in documented order (G1-G13). */
  checks: GameEngineConformanceCheck[];
  /** True only when every check passed. */
  passed: boolean;
}

/** The stable check ids, in documented order. */
export const GAME_ENGINE_CONFORMANCE_CHECK_IDS = [
  "G1",
  "G2",
  "G3",
  "G4",
  "G5",
  "G6",
  "G7",
  "G8",
  "G9",
  "G10",
  "G11",
  "G12",
  "G13",
] as const;

/** Options for {@link runGameEngineConformance}; every field is optional. */
export interface GameEngineConformanceOptions {
  /** SWM snapshot to build the scene from (default: `buildWorldSnapshot()`). */
  snapshot?: WorldSnapshot;
  /** Ordered events to apply at build time (default: 3 composed events). */
  events?: WorldEventStreamEntry[];
  /** The output profile for render probes (default: 320×180 @ 4 fps, 1000 ms, frames-rgb24). */
  outputProfile?: {
    widthPx: number;
    heightPx: number;
    fps: number;
    durationMs: number;
    format: string;
  };
}

type Attempt<T> =
  { kind: "value"; value: T } | { kind: "threw"; error: unknown } | { kind: "promise" };

/** Calls an adapter method and classifies the outcome (sync harness). */
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
      return "returned a Promise (the conformance harness is synchronous)";
    case "value":
      return "returned a value";
  }
}

function errMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Composes the default 3-event tail continuing the snapshot watermark. */
function composeDefaultEvents(snapshot: WorldSnapshot): WorldEventStreamEntry[] {
  const baseSequence = snapshot.watermark.sequence;
  const startMs = snapshot.watermark.watermarkMs;
  return [0, 1, 2].map((index) => ({
    sequence: baseSequence + 1 + index,
    snapshotVersionAfter: index + 1,
    event: buildEventEnvelope({
      eventId: `engine-conformance-${index}`,
      sessionId: snapshot.sessionId,
      eventTimeMs: startMs + 500 * (index + 1),
    }),
  }));
}

/** Builds an over-capacity snapshot (every entity placed with a position). */
function buildOverCapacitySnapshot(sessionId: string, entityCount: number): WorldSnapshot {
  return buildWorldSnapshot({
    sessionId,
    watermark: { watermarkMs: 10_000, sequence: 1 },
    entities: Array.from({ length: entityCount }, (_, i) => ({
      entityId: `bulk-${i}`,
      kind: "participant" as const,
      version: 1,
      lastEventTimeMs: 10_000,
      state: {
        pitchPosition: {
          status: "known" as const,
          value: { x: 5 + (i % 20) * 5, y: 5 + Math.floor(i / 20) * 5 },
        },
      },
    })),
  });
}

/** Reads a staged frame sequence (null when unreadable). */
function readStaged(ref: string): Buffer | null {
  try {
    return readFileSync(ref);
  } catch {
    return null;
  }
}

/**
 * Runs the game-engine conformance harness. See the module docs for the
 * construction rules and the check list.
 */
export function runGameEngineConformance(
  adapter: GameEngineAdapter,
  opts: GameEngineConformanceOptions = {},
): GameEngineConformanceReport {
  // ---------------------------------------------------------------- G1/G2 probe
  const describeFirst = attempt(() => adapter.describe());
  const describeSecond = attempt(() => adapter.describe());
  const rawDescriptor: unknown = describeFirst.kind === "value" ? describeFirst.value : null;
  const parsedDescriptor = GameEngineDescriptor.safeParse(rawDescriptor);
  const descriptor = parsedDescriptor.success ? parsedDescriptor.data : null;

  // ------------------------------------------------------------ input setup
  const snapshot = opts.snapshot ?? buildWorldSnapshot();
  const events = opts.events ?? composeDefaultEvents(snapshot);
  const lastEvent = events[events.length - 1];
  const expectedAppliedSequence =
    lastEvent !== undefined ? lastEvent.sequence : snapshot.watermark.sequence;
  const firstStyle = descriptor?.renderingStyles[0] ?? "stylized-3d";
  const secondStyle = descriptor?.renderingStyles[1];
  const format = opts.outputProfile?.format ?? descriptor?.outputFormats[0] ?? "frames-rgb24";
  const profile = {
    widthPx: opts.outputProfile?.widthPx ?? 320,
    heightPx: opts.outputProfile?.heightPx ?? 180,
    fps: opts.outputProfile?.fps ?? 4,
    durationMs: opts.outputProfile?.durationMs ?? 1_000,
    format,
  };
  const buildRequest = (style: string): GameSceneBuildRequest => ({
    schemaVersion: "1.1",
    sessionId: snapshot.sessionId,
    snapshotVersion: 1,
    renderingStyle: style as GameSceneBuildRequest["renderingStyle"],
  });

  // ------------------------------------------------------------- build probes
  const buildMain =
    describeFirst.kind === "value"
      ? attempt(() => adapter.buildScene(buildRequest(firstStyle), snapshot, events))
      : null;
  const handle =
    buildMain !== null && buildMain.kind === "value" && buildMain.value !== null
      ? (buildMain.value as { sceneId?: unknown })
      : null;
  const handleSceneId = typeof handle?.sceneId === "string" ? handle.sceneId : "unknown-scene";

  // The event-application probe: one replayed event, one new applicable
  // event, and one out-of-envelope event (unknown taxonomy).
  const replayEvent = events[0];
  const applicableEvent: WorldEventStreamEntry = {
    sequence: expectedAppliedSequence + 1,
    snapshotVersionAfter: 99,
    event: buildEventEnvelope({
      eventId: "engine-conformance-applied",
      sessionId: snapshot.sessionId,
      eventTimeMs: snapshot.watermark.watermarkMs + 2_000,
    }),
  };
  const unsupportedEvent: WorldEventStreamEntry = {
    sequence: expectedAppliedSequence + 2,
    snapshotVersionAfter: 100,
    event: buildEventEnvelope({
      eventId: "engine-conformance-unsupported",
      sessionId: snapshot.sessionId,
      eventTypeRef: "other-sport/v9/unknown",
      eventTimeMs: snapshot.watermark.watermarkMs + 3_000,
    }),
  };
  const applyProbe =
    handle !== null
      ? attempt(() =>
          adapter.applySceneEvents(handle as never, [
            ...(replayEvent !== undefined ? [replayEvent] : []),
            applicableEvent,
            unsupportedEvent,
          ]),
        )
      : null;

  // ------------------------------------------------------------ render probes
  const renderRequest = (sceneId: string) => ({
    schemaVersion: "1.1",
    sceneId,
    outputProfile: profile,
  });
  const renderMain =
    handle !== null ? attempt(() => adapter.renderScene(renderRequest(handleSceneId))) : null;
  const renderAgain =
    handle !== null ? attempt(() => adapter.renderScene(renderRequest(handleSceneId))) : null;
  const renderUnknownScene = attempt(() => adapter.renderScene(renderRequest("no-such-scene-id")));
  const renderBadFormat =
    handle !== null
      ? attempt(() =>
          adapter.renderScene({
            schemaVersion: "1.1",
            sceneId: handleSceneId,
            outputProfile: { ...profile, format: `${format}-offlist` },
          }),
        )
      : null;

  // The style-distinctness probe: build the SAME snapshot in the second
  // style and render with the same profile.
  const buildSecond =
    describeFirst.kind === "value" && secondStyle !== undefined
      ? attempt(() => adapter.buildScene(buildRequest(secondStyle), snapshot, events))
      : null;
  const renderSecond =
    buildSecond !== null && buildSecond.kind === "value" && buildSecond.value !== null
      ? attempt(() =>
          adapter.renderScene(
            renderRequest((buildSecond.value as { sceneId?: unknown }).sceneId as string),
          ),
        )
      : null;

  // The capacity probe: an over-capacity snapshot must fail loud.
  const capacitySnapshot = buildOverCapacitySnapshot(
    snapshot.sessionId,
    (descriptor?.maxConcurrentEntities ?? 64) + 5,
  );
  const buildOverCapacity =
    describeFirst.kind === "value"
      ? attempt(() => adapter.buildScene(buildRequest(firstStyle), capacitySnapshot, []))
      : null;

  // ---------------------------------------------------------------- checks
  const checkDescriptorSchema: GameEngineConformanceCheck = {
    checkId: "G1",
    description:
      "describe() returns a schema-valid GameEngineDescriptor (engine-kind marker, styles, formats, capacity) with no engine-vendor name",
    passed: false,
  };
  if (describeFirst.kind !== "value") {
    checkDescriptorSchema.detail = `describe() ${describeAttempt(describeFirst)}`;
  } else if (!parsedDescriptor.success) {
    checkDescriptorSchema.detail = `describe() failed GameEngineDescriptor validation: ${parsedDescriptor.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .slice(0, 3)
      .join("; ")}`;
  } else {
    const text = JSON.stringify(parsedDescriptor.data).toLowerCase();
    const vendorLeak = ["godot", "unity", "unreal", "cryengine", "source-engine"].find((vendor) =>
      text.includes(vendor),
    );
    if (vendorLeak !== undefined) {
      checkDescriptorSchema.detail = `the descriptor leaks an engine-vendor name ("${vendorLeak}") — the seam is provider-neutral`;
    } else {
      checkDescriptorSchema.passed = true;
      checkDescriptorSchema.detail = `engineId=${parsedDescriptor.data.engineId} styles=[${parsedDescriptor.data.renderingStyles.join(", ")}] formats=[${parsedDescriptor.data.outputFormats.join(", ")}] maxEntities=${parsedDescriptor.data.maxConcurrentEntities}`;
    }
  }

  const checkDescriptorStable: GameEngineConformanceCheck = {
    checkId: "G2",
    description: "describe() returns a deep-equal document on every call (identity immutability)",
    passed: false,
  };
  if (describeFirst.kind !== "value" || describeSecond.kind !== "value") {
    checkDescriptorStable.detail = `describe() ${describeAttempt(
      describeFirst.kind !== "value" ? describeFirst : describeSecond,
    )}`;
  } else if (JSON.stringify(describeFirst.value) === JSON.stringify(describeSecond.value)) {
    checkDescriptorStable.passed = true;
    checkDescriptorStable.detail = "two calls returned deep-equal documents";
  } else {
    checkDescriptorStable.detail = "two describe() calls returned different documents";
  }

  const checkBuildHonest: GameEngineConformanceCheck = {
    checkId: "G3",
    description:
      "buildScene reports the session/snapshotVersion honestly, applies the event tail, and counts placed entities",
    passed: false,
  };
  if (buildMain === null) {
    checkBuildHonest.detail = "buildScene was not invoked (describe() failed)";
  } else if (buildMain.kind !== "value") {
    checkBuildHonest.detail = `buildScene ${describeAttempt(buildMain)}`;
  } else {
    const handleValue = buildMain.value as Record<string, unknown>;
    const ok =
      handleValue.sessionId === snapshot.sessionId &&
      handleValue.snapshotVersion === 1 &&
      handleValue.appliedEventSequence === expectedAppliedSequence &&
      typeof handleValue.entityCount === "number" &&
      handleValue.entityCount >= 0 &&
      handleValue.entityCount <= snapshot.entities.length;
    if (ok) {
      checkBuildHonest.passed = true;
      checkBuildHonest.detail = `appliedEventSequence=${String(handleValue.appliedEventSequence)} entityCount=${String(handleValue.entityCount)}`;
    } else {
      checkBuildHonest.detail = `handle {sessionId: ${String(handleValue.sessionId)}, snapshotVersion: ${String(handleValue.snapshotVersion)}, appliedEventSequence: ${String(handleValue.appliedEventSequence)}, entityCount: ${String(handleValue.entityCount)}} does not match the build request (expected applied ${expectedAppliedSequence})`;
    }
  }

  const checkEventsSkipped: GameEngineConformanceCheck = {
    checkId: "G4",
    description:
      "applySceneEvents counts skipped events (replays + out-of-envelope) and degrades with a reason only when events were dropped",
    passed: false,
  };
  if (applyProbe === null) {
    checkEventsSkipped.detail = "applySceneEvents was not invoked (buildScene failed)";
  } else if (applyProbe.kind !== "value") {
    checkEventsSkipped.detail = `applySceneEvents ${describeAttempt(applyProbe)}`;
  } else {
    const result = applyProbe.value as Record<string, unknown>;
    const expectedSequence = applicableEvent.sequence;
    const expectedSkips = (replayEvent !== undefined ? 1 : 0) + 1; // replay(s) + 1 unsupported
    const ok =
      result.appliedEventSequence === expectedSequence &&
      result.skippedEvents === expectedSkips &&
      result.degraded === true &&
      typeof result.degradationReason === "string" &&
      (result.degradationReason as string).length > 0;
    if (ok) {
      checkEventsSkipped.passed = true;
      checkEventsSkipped.detail = `applied ${String(result.appliedEventSequence)}, skipped ${expectedSkips} (${replayEvent !== undefined ? "1 replay + " : ""}1 unsupported), degraded with a reason`;
    } else {
      checkEventsSkipped.detail = `result {appliedEventSequence: ${String(result.appliedEventSequence)}, skippedEvents: ${String(result.skippedEvents)}, degraded: ${String(result.degraded)}} does not reflect 1 new application (sequence ${expectedSequence}) + ${expectedSkips} skip(s) with explicit degradation`;
    }
  }

  const checkRenderSchema: GameEngineConformanceCheck = {
    checkId: "G5",
    description: "renderScene returns a schema-valid result with EXACTLY ONE output kind",
    passed: false,
  };
  if (renderMain === null) {
    checkRenderSchema.detail = "renderScene was not invoked (buildScene failed)";
  } else if (renderMain.kind !== "value") {
    checkRenderSchema.detail = `renderScene ${describeAttempt(renderMain)}`;
  } else {
    const kind = (renderMain.value as { output?: { kind?: string } }).output?.kind;
    if (kind === "frame-output" || kind === "encoded-output") {
      checkRenderSchema.passed = true;
      checkRenderSchema.detail = `output kind "${kind}" (the discriminated union admits exactly one)`;
    } else {
      checkRenderSchema.detail = `output.kind is "${String(kind)}" — not a member of the frozen union`;
    }
  }

  const checkRenderProvenance: GameEngineConformanceCheck = {
    checkId: "G6",
    description:
      "render provenance reports the scene's snapshotVersion and the highest applied event sequence (never more)",
    passed: false,
  };
  if (renderMain === null || renderMain.kind !== "value") {
    checkRenderProvenance.detail = "no render result (see G5)";
  } else {
    const provenance = (renderMain.value as { provenance?: Record<string, unknown> }).provenance;
    const expected = applicableEvent.sequence;
    if (provenance?.snapshotVersion === 1 && Number(provenance?.lastEventSequence) === expected) {
      checkRenderProvenance.passed = true;
      checkRenderProvenance.detail = `snapshotVersion=1 lastEventSequence=${String(provenance.lastEventSequence)} (honest high-water mark)`;
    } else {
      checkRenderProvenance.detail = `provenance ${JSON.stringify(provenance)} does not match the scene (expected snapshotVersion 1, lastEventSequence ${expected})`;
    }
  }

  const checkRenderTelemetry: GameEngineConformanceCheck = {
    checkId: "G7",
    description: "render telemetry carries honest counters (frames, drops, measured time)",
    passed: false,
  };
  if (renderMain === null || renderMain.kind !== "value") {
    checkRenderTelemetry.detail = "no render result (see G5)";
  } else {
    const telemetry = (renderMain.value as { telemetry?: Record<string, unknown> }).telemetry;
    const expectedFrames = Math.max(1, Math.round((profile.fps * profile.durationMs) / 1000));
    if (
      typeof telemetry?.renderMs === "number" &&
      telemetry.renderMs >= 0 &&
      telemetry?.framesRendered === expectedFrames &&
      telemetry?.droppedFrames === 0
    ) {
      checkRenderTelemetry.passed = true;
      checkRenderTelemetry.detail = `framesRendered=${String(telemetry.framesRendered)} droppedFrames=0 renderMs=${String(telemetry.renderMs)}`;
    } else {
      checkRenderTelemetry.detail = `telemetry ${JSON.stringify(telemetry)} does not reflect the plan (${expectedFrames} frames, 0 drops, measured renderMs >= 0)`;
    }
  }

  const checkStagingReal: GameEngineConformanceCheck = {
    checkId: "G8",
    description: "frame staging is REAL: the staged file's byte length matches the declared format",
    passed: false,
  };
  if (renderMain === null || renderMain.kind !== "value") {
    checkStagingReal.detail = "no render result (see G5)";
  } else {
    const output = (renderMain.value as { output?: Record<string, unknown> }).output;
    if (output?.kind !== "frame-output") {
      checkStagingReal.passed = true;
      checkStagingReal.detail = `n/a: output kind is "${String(output?.kind)}" (only frame-output staging is byte-verifiable)`;
    } else if (output.pixelFormat === "png-sequence") {
      checkStagingReal.passed = true;
      checkStagingReal.detail =
        "n/a: png-sequence staging is not byte-length-verifiable generically";
    } else {
      const bytesPerPixel = output.pixelFormat === "rgba32" ? 4 : 3;
      const expectedBytes =
        Number(output.frameCount) *
        Number(output.widthPx) *
        Number(output.heightPx) *
        bytesPerPixel;
      const staged = readStaged(String(output.stagingRef));
      if (staged === null) {
        checkStagingReal.detail = `the stagingRef "${String(output.stagingRef)}" is not readable`;
      } else if (staged.length === expectedBytes) {
        checkStagingReal.passed = true;
        checkStagingReal.detail = `staged ${staged.length} bytes == ${String(output.frameCount)} frames × ${String(output.widthPx)}×${String(output.heightPx)}×${bytesPerPixel}`;
      } else {
        checkStagingReal.detail = `staged file has ${staged.length} bytes, expected ${expectedBytes}`;
      }
    }
  }

  const checkDeterminism: GameEngineConformanceCheck = {
    checkId: "G9",
    description: "two identical renders stage byte-identical frame sequences",
    passed: false,
  };
  if (
    renderMain === null ||
    renderAgain === null ||
    renderMain.kind !== "value" ||
    renderAgain.kind !== "value"
  ) {
    checkDeterminism.detail = "two renders were not both available (see G5)";
  } else {
    const a = (renderMain.value as { output?: { stagingRef?: string } }).output?.stagingRef;
    const b = (renderAgain.value as { output?: { stagingRef?: string } }).output?.stagingRef;
    const bytesA = typeof a === "string" ? readStaged(a) : null;
    const bytesB = typeof b === "string" ? readStaged(b) : null;
    if (bytesA === null || bytesB === null) {
      checkDeterminism.detail = "one render is not a frame-output with a readable stagingRef";
    } else if (Buffer.compare(bytesA, bytesB) === 0) {
      checkDeterminism.passed = true;
      checkDeterminism.detail = `${bytesA.length} staged bytes identical across renders`;
    } else {
      checkDeterminism.detail = `the two renders staged different bytes (${bytesA.length} vs ${bytesB.length})`;
    }
  }

  const checkStyleDistinct: GameEngineConformanceCheck = {
    checkId: "G10",
    description:
      "two supported styles render the SAME scene differently (the anime/NPR path shares the game-3D scene — ADR-009)",
    passed: false,
  };
  if (secondStyle === undefined) {
    checkStyleDistinct.passed = true;
    checkStyleDistinct.detail = "n/a: the engine declares a single rendering style";
  } else if (
    renderMain === null ||
    renderSecond === null ||
    renderMain.kind !== "value" ||
    renderSecond.kind !== "value"
  ) {
    checkStyleDistinct.detail = "the two style renders were not both available";
  } else {
    const refA = (renderMain.value as { output?: { stagingRef?: string } }).output?.stagingRef;
    const refB = (renderSecond.value as { output?: { stagingRef?: string } }).output?.stagingRef;
    const bytesA = typeof refA === "string" ? readStaged(refA) : null;
    const bytesB = typeof refB === "string" ? readStaged(refB) : null;
    if (bytesA === null || bytesB === null) {
      checkStyleDistinct.detail = "one render is not a frame-output with a readable stagingRef";
    } else if (Buffer.compare(bytesA, bytesB) !== 0) {
      checkStyleDistinct.passed = true;
      checkStyleDistinct.detail = `styles "${firstStyle}" and "${secondStyle}" produced different frames (${bytesA.length} vs ${bytesB.length} staged bytes) over the same scene`;
    } else {
      checkStyleDistinct.detail = `styles "${firstStyle}" and "${secondStyle}" produced IDENTICAL frames — the style is not applied`;
    }
  }

  const checkUnknownScene: GameEngineConformanceCheck = {
    checkId: "G11",
    description: "renderScene with an unknown sceneId fails loud (never garbage output)",
    passed: false,
  };
  if (renderUnknownScene.kind === "threw") {
    checkUnknownScene.passed = true;
    checkUnknownScene.detail = `threw: ${errMessage(renderUnknownScene.error)}`;
  } else {
    checkUnknownScene.detail = `renderScene ${describeAttempt(renderUnknownScene)} instead of throwing`;
  }

  const checkBadFormat: GameEngineConformanceCheck = {
    checkId: "G12",
    description: "renderScene with a format outside the descriptor's outputFormats fails loud",
    passed: false,
  };
  if (renderBadFormat === null) {
    checkBadFormat.detail = "renderScene was not invoked (buildScene failed)";
  } else if (renderBadFormat.kind === "threw") {
    checkBadFormat.passed = true;
    checkBadFormat.detail = `threw: ${errMessage(renderBadFormat.error)}`;
  } else {
    checkBadFormat.detail = `renderScene ${describeAttempt(renderBadFormat)} instead of throwing`;
  }

  const checkCapacity: GameEngineConformanceCheck = {
    checkId: "G13",
    description:
      "buildScene with more placed entities than maxConcurrentEntities fails loud (never clamps)",
    passed: false,
  };
  if (buildOverCapacity === null) {
    checkCapacity.detail = "buildScene was not invoked (describe() failed)";
  } else if (buildOverCapacity.kind === "threw") {
    checkCapacity.passed = true;
    checkCapacity.detail = `threw: ${errMessage(buildOverCapacity.error)}`;
  } else {
    const handleValue =
      buildOverCapacity.kind === "value"
        ? (buildOverCapacity.value as { entityCount?: unknown })
        : null;
    checkCapacity.detail = `buildScene ${describeAttempt(buildOverCapacity)} with entityCount=${String(handleValue?.entityCount)} instead of throwing (capacity ${String(descriptor?.maxConcurrentEntities)})`;
  }

  const checks: GameEngineConformanceCheck[] = [
    checkDescriptorSchema,
    checkDescriptorStable,
    checkBuildHonest,
    checkEventsSkipped,
    checkRenderSchema,
    checkRenderProvenance,
    checkRenderTelemetry,
    checkStagingReal,
    checkDeterminism,
    checkStyleDistinct,
    checkUnknownScene,
    checkBadFormat,
    checkCapacity,
  ];

  return {
    engine: descriptor,
    checks,
    passed: checks.every((check) => check.passed),
  };
}
