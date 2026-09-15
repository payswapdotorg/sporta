/**
 * The W601 case executor: scene-projection conformance (W801 harness).
 *
 * Runs the REAL W601 evaluator — `projectScene` + `runSceneConformance` from
 * `@sporta/scene-projection` — in-process over the checked-in scene fixture
 * (`fixtures/w601-scene-fixture.json`, generated from
 * `src/w601-fixture.ts`, the W601 golden-fixture construction):
 *
 * 1. load + strictly validate the fixture file (fail loud: a missing file, a
 *    malformed envelope, or an unknown camera slot is a CASE FAILURE, never
 *    a skip);
 * 2. `projectScene(snapshot, { events, cameraSlotIds })` — the real
 *    projection (validates the snapshot/events against the frozen contracts;
 *    garbage input throws `SceneProjectionError`, contained by the runner);
 * 3. `runSceneConformance(scene, { snapshot, events, cameraSlotIds })` — the
 *    full-evidence conformance mode (S1–S8, including the identity and
 *    byte-identity checks that need the snapshot);
 * 4. the conformance report is the case's `measured`, VERBATIM.
 */
import type { WorldEventStreamEntry, WorldSnapshot } from "@sporta/contracts";
import { CAMERA_SLOT_IDS, projectScene, runSceneConformance } from "@sporta/scene-projection";
import type { SceneConformanceReport } from "@sporta/scene-projection";
import { readFileSync } from "node:fs";
import type { CaseContext, CaseOutcome } from "./types";
import type { W601CaseConfig } from "../suite-config";

/** The W601 scene-fixture file's kind tag (versioned with the fixture shape). */
export const W601_SCENE_FIXTURE_KIND = "sporta/eval-harness/w601-scene-fixture@1";

/** The W601 contract document of the scene-projection evaluator (a reference). */
export const W601_RULE_DOCUMENT = "packages/scene-projection/CONTRACT.md";

/** The parsed W601 scene fixture (the projection input triple). */
export interface W601SceneFixture {
  readonly fixtureKind: typeof W601_SCENE_FIXTURE_KIND;
  readonly sessionId: string;
  readonly snapshot: WorldSnapshot;
  readonly events: readonly WorldEventStreamEntry[];
  readonly cameraSlotIds: readonly string[];
}

/**
 * Loads and validates the W601 scene fixture file. Fail loud (repo style):
 * unknown keys, wrong types, and unknown/duplicate camera slots throw a
 * `RangeError`; the snapshot/events contract validation happens inside
 * `projectScene` (the real evaluator's own fail-loud gate).
 */
export function loadW601SceneFixture(sceneFixturePath: string): W601SceneFixture {
  let text: string;
  try {
    text = readFileSync(sceneFixturePath, "utf8");
  } catch (cause) {
    throw new RangeError(
      `loadW601SceneFixture: cannot read the scene fixture at "${sceneFixturePath}" — ` +
        `checked-in case input must exist (${(cause as Error).message})`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    throw new RangeError(
      `loadW601SceneFixture: scene fixture "${sceneFixturePath}" is not valid JSON ` +
        `(${(cause as Error).message})`,
    );
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new RangeError(
      `loadW601SceneFixture: scene fixture "${sceneFixturePath}" must be a JSON object`,
    );
  }
  const envelope = parsed as Record<string, unknown>;
  const knownKeys = new Set(["fixtureKind", "sessionId", "snapshot", "events", "cameraSlotIds"]);
  for (const key of Object.keys(envelope)) {
    if (!knownKeys.has(key)) {
      throw new RangeError(
        `loadW601SceneFixture: scene fixture carries unknown key "${key}" — the fixture shape ` +
          "is versioned; extending it is a conscious act (regenerate via " +
          "`bun run regen-w601-fixture` after review)",
      );
    }
  }
  for (const key of knownKeys) {
    if (!(key in envelope)) {
      throw new RangeError(`loadW601SceneFixture: scene fixture is missing required key "${key}"`);
    }
  }
  if (envelope.fixtureKind !== W601_SCENE_FIXTURE_KIND) {
    throw new RangeError(
      `loadW601SceneFixture: fixtureKind must be "${W601_SCENE_FIXTURE_KIND}" ` +
        `(got ${JSON.stringify(envelope.fixtureKind)})`,
    );
  }
  if (typeof envelope.sessionId !== "string" || envelope.sessionId.length < 1) {
    throw new RangeError("loadW601SceneFixture: sessionId must be a non-empty string");
  }
  if (typeof envelope.snapshot !== "object" || envelope.snapshot === null) {
    throw new RangeError("loadW601SceneFixture: snapshot must be an object");
  }
  if (!Array.isArray(envelope.events)) {
    throw new RangeError("loadW601SceneFixture: events must be an array");
  }
  if (!Array.isArray(envelope.cameraSlotIds)) {
    throw new RangeError("loadW601SceneFixture: cameraSlotIds must be an array");
  }
  const canonicalSlots = new Set<string>(CAMERA_SLOT_IDS);
  const seenSlots = new Set<string>();
  for (const slot of envelope.cameraSlotIds) {
    if (typeof slot !== "string" || slot.length < 1) {
      throw new RangeError("loadW601SceneFixture: cameraSlotIds entries must be non-empty strings");
    }
    if (!canonicalSlots.has(slot)) {
      throw new RangeError(
        `loadW601SceneFixture: unknown camera slot "${slot}" — the canonical set is ` +
          `${CAMERA_SLOT_IDS.join(", ")}`,
      );
    }
    if (seenSlots.has(slot)) {
      throw new RangeError(`loadW601SceneFixture: duplicate camera slot "${slot}"`);
    }
    seenSlots.add(slot);
  }

  return {
    fixtureKind: W601_SCENE_FIXTURE_KIND,
    sessionId: envelope.sessionId,
    snapshot: envelope.snapshot as WorldSnapshot,
    events: envelope.events as readonly WorldEventStreamEntry[],
    cameraSlotIds: envelope.cameraSlotIds as readonly string[],
  };
}

/** The W601 case's measured values: the conformance report, VERBATIM. */
export type W601CaseMeasured = SceneConformanceReport;

/** The W601 case's thresholds: rule-based conformance (no numeric thresholds). */
export interface W601CaseThresholds {
  /** Where the rules S1–S8 are documented. */
  readonly ruleDocument: string;
  /** The applied rule (check) ids, verbatim from the conformance report. */
  readonly checkIds: readonly string[];
}

/** Runs the W601 case: the real scene-projection evaluator, in-process. */
export function runW601Case(
  caseConfig: W601CaseConfig,
  context: CaseContext,
): CaseOutcome<W601CaseMeasured, W601CaseThresholds> {
  const fixture = loadW601SceneFixture(context.resolvePath(caseConfig.fixture.sceneFixturePath));
  const scene = projectScene(fixture.snapshot, {
    events: fixture.events,
    cameraSlotIds: fixture.cameraSlotIds,
  });
  const report = runSceneConformance(scene, {
    snapshot: fixture.snapshot,
    events: fixture.events,
    cameraSlotIds: fixture.cameraSlotIds,
  });

  const failureReasons: string[] = [];
  for (const check of report.checks) {
    if (!check.passed) {
      failureReasons.push(
        `conformance check "${check.checkId}" failed${check.detail ? ` (${check.detail})` : ""}`,
      );
    }
  }

  return {
    verdict: report.passed ? "PASS" : "FAIL",
    measured: report,
    thresholds: {
      ruleDocument: W601_RULE_DOCUMENT,
      checkIds: report.checks.map((check) => check.checkId),
    },
    failureReasons,
  };
}
