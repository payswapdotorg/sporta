/**
 * Frozen-fixture loading (W403).
 *
 * The fixture (`fixtures/w403-fixture.json`) is CHECKED-IN, BYTE-STABLE INPUT:
 * the loader never writes it, never regenerates it, and pins its bytes via a
 * sha256 that flows into the artifact (and is compared `EXACT`). Regenerating
 * the fixture is not a supported operation — a fixture change invalidates the
 * golden (the `fixtureSha256` comparison fails loud) and demands an explicit,
 * tech-lead-reviewed golden regeneration (see TOLERANCE.md).
 *
 * Fail loud (repo style): a missing file, a malformed envelope, a
 * contract-invalid observation, or a drifted canonical constant throws a
 * `RangeError` with full context — never a silent skip or a default.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { Observation } from "@sporta/contracts";
import {
  PITCH_AXES,
  PITCH_LENGTH_AXIS_METERS,
  PITCH_ORIGIN,
  PITCH_WIDTH_AXIS_METERS,
} from "@sporta/contracts";
import type { Observation as ObservationType } from "@sporta/contracts";
import type { FootballState } from "@sporta/world-model";
import { FIXTURE_KIND } from "./artifact";
import type { FixtureSpec } from "./artifact";

/** The default checked-in fixture path (package-relative). */
export const DEFAULT_FIXTURE_PATH = `${import.meta.dir}/../fixtures/w403-fixture.json`;

/** Everything the pipeline needs from the frozen fixture file. */
export interface LoadedFixture {
  /** The validated spec (parsed fixture envelope + validated observations). */
  readonly spec: FixtureSpec;
  /** sha256 (hex) over the fixture FILE bytes — the byte-stability proof. */
  readonly sha256: string;
}

/** Validates a football init carried by the fixture (canonical constants only). */
function validateFootballInit(value: unknown): FootballState {
  const football = value as FootballState;
  const problems: string[] = [];
  if (football?.pitch?.lengthAxisMeters !== PITCH_LENGTH_AXIS_METERS) {
    problems.push(`pitch.lengthAxisMeters must be the canonical ${PITCH_LENGTH_AXIS_METERS}`);
  }
  if (football?.pitch?.widthAxisMeters !== PITCH_WIDTH_AXIS_METERS) {
    problems.push(`pitch.widthAxisMeters must be the canonical ${PITCH_WIDTH_AXIS_METERS}`);
  }
  if (football?.pitch?.origin !== PITCH_ORIGIN) {
    problems.push(`pitch.origin must be the canonical "${PITCH_ORIGIN}"`);
  }
  if (football?.pitch?.axes !== PITCH_AXES) {
    problems.push(`pitch.axes must be the canonical "${PITCH_AXES}"`);
  }
  if (problems.length > 0) {
    throw new RangeError(
      `loadFixture: footballInit is not the canonical pitch frame — ${problems.join("; ")}`,
    );
  }
  // The engine validates the full FootballState contract at create(); the
  // checks above guard the constants the fixture must not drift on.
  return football;
}

/**
 * Loads and validates the frozen fixture. Pure: reads the file, validates,
 * returns — no mutation of anything, no writes.
 */
export function loadFixture(fixturePath: string = DEFAULT_FIXTURE_PATH): LoadedFixture {
  let bytes: string;
  try {
    bytes = readFileSync(fixturePath, "utf8");
  } catch (cause) {
    throw new RangeError(
      `loadFixture: cannot read the frozen fixture at "${fixturePath}" — the fixture is ` +
        `checked-in input and must exist (${(cause as Error).message})`,
    );
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");

  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes);
  } catch (cause) {
    throw new RangeError(
      `loadFixture: fixture "${fixturePath}" is not valid JSON (${(cause as Error).message})`,
    );
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new RangeError(`loadFixture: fixture "${fixturePath}" must be a JSON object`);
  }
  const envelope = parsed as Record<string, unknown>;

  const requireString = (key: string): string => {
    const value = envelope[key];
    if (typeof value !== "string" || value.length < 1) {
      throw new RangeError(
        `loadFixture: fixture "${key}" must be a non-empty string (got ${String(value)})`,
      );
    }
    return value;
  };
  const requireNumber = (key: string, minimum: number): number => {
    const value = envelope[key];
    if (typeof value !== "number" || !Number.isFinite(value) || value < minimum) {
      throw new RangeError(
        `loadFixture: fixture "${key}" must be a finite number >= ${minimum} (got ${String(value)})`,
      );
    }
    return value;
  };

  const fixtureId = requireString("fixtureId");
  const fixtureKind = requireString("fixtureKind");
  if (fixtureKind !== FIXTURE_KIND) {
    throw new RangeError(
      `loadFixture: fixture "${fixturePath}" has kind "${fixtureKind}" — this loader ` +
        `only consumes "${FIXTURE_KIND}" fixtures`,
    );
  }

  if (envelope.trackFrame !== "pitch") {
    throw new RangeError(
      `loadFixture: fixture trackFrame must be "pitch" (got ${String(envelope.trackFrame)})`,
    );
  }

  const pinned = envelope.pinnedStateAtMs;
  if (!Array.isArray(pinned) || pinned.length === 0) {
    throw new RangeError("loadFixture: fixture pinnedStateAtMs must be a non-empty number array");
  }
  for (let i = 0; i < pinned.length; i += 1) {
    const t = pinned[i];
    if (typeof t !== "number" || !Number.isFinite(t) || t < 0) {
      throw new RangeError(`loadFixture: pinnedStateAtMs[${i}] must be a finite number >= 0`);
    }
    if (i > 0 && (t as number) <= (pinned[i - 1] as number)) {
      throw new RangeError(
        `loadFixture: pinnedStateAtMs must be strictly ascending (${pinned[i - 1]} !< ${t})`,
      );
    }
  }

  const windowValue = envelope.eventWindow;
  const windowOk =
    typeof windowValue === "object" &&
    windowValue !== null &&
    !Array.isArray(windowValue) &&
    typeof (windowValue as Record<string, unknown>).fromMs === "number" &&
    typeof (windowValue as Record<string, unknown>).toMs === "number";
  const wv = windowValue as { fromMs: number; toMs: number } | undefined;
  if (!windowOk || !wv || wv.fromMs < 0 || wv.fromMs > wv.toMs) {
    throw new RangeError(
      "loadFixture: fixture eventWindow must be { fromMs, toMs } with 0 <= fromMs <= toMs",
    );
  }

  const replayValue = envelope.replay;
  const replayOk =
    typeof replayValue === "object" &&
    replayValue !== null &&
    !Array.isArray(replayValue) &&
    typeof (replayValue as Record<string, unknown>).maxEvents === "number" &&
    Number.isInteger((replayValue as Record<string, unknown>).maxEvents) &&
    typeof (replayValue as Record<string, unknown>).maxSpanMs === "number" &&
    typeof (replayValue as Record<string, unknown>).checkpointEveryMs === "number" &&
    Number.isInteger((replayValue as Record<string, unknown>).checkpointEveryMs);
  const rv = replayValue as
    { maxEvents: number; maxSpanMs: number; checkpointEveryMs: number } | undefined;
  if (
    !replayOk ||
    !rv ||
    rv.maxEvents < 1 ||
    !Number.isFinite(rv.maxSpanMs) ||
    rv.maxSpanMs < 0 ||
    rv.checkpointEveryMs < 1
  ) {
    throw new RangeError(
      "loadFixture: fixture replay must be { maxEvents >= 1, maxSpanMs >= 0, checkpointEveryMs >= 1 }",
    );
  }

  const observationsValue = envelope.observations;
  if (!Array.isArray(observationsValue) || observationsValue.length === 0) {
    throw new RangeError("loadFixture: fixture observations must be a non-empty array");
  }
  const observations: ObservationType[] = [];
  for (let i = 0; i < observationsValue.length; i += 1) {
    const check = Observation.safeParse(observationsValue[i]);
    if (!check.success) {
      const issues = check.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ");
      throw new RangeError(
        `loadFixture: observations[${i}] does not parse against the Observation contract ` +
          `(${issues}) — the frozen fixture has drifted; it must never be regenerated silently`,
      );
    }
    observations.push(check.data);
  }

  const knownEnvelopeKeys = new Set([
    "fixtureId",
    "fixtureKind",
    "sessionId",
    "trackFrame",
    "possessionRadiusM",
    "maxReorderMs",
    "footballInit",
    "pinnedStateAtMs",
    "eventWindow",
    "replay",
    "observations",
  ]);
  for (const key of Object.keys(envelope)) {
    if (!knownEnvelopeKeys.has(key)) {
      throw new RangeError(
        `loadFixture: fixture carries unknown envelope key "${key}" — the fixture shape is ` +
          "frozen; extending it is a conscious act that requires a golden regeneration",
      );
    }
  }

  const spec: FixtureSpec = {
    fixtureId,
    fixtureKind,
    sessionId: requireString("sessionId"),
    trackFrame: "pitch",
    possessionRadiusM: requireNumber("possessionRadiusM", 0),
    maxReorderMs: requireNumber("maxReorderMs", 0),
    footballInit: validateFootballInit(envelope.footballInit),
    pinnedStateAtMs: pinned as number[],
    eventWindow: {
      fromMs: wv.fromMs,
      toMs: wv.toMs,
    },
    replay: {
      maxEvents: rv.maxEvents,
      maxSpanMs: rv.maxSpanMs,
      checkpointEveryMs: rv.checkpointEveryMs,
    },
    observations,
  };

  // Cross-field sanity: every observation belongs to the fixture's session.
  for (let i = 0; i < spec.observations.length; i += 1) {
    if (spec.observations[i]!.sessionId !== spec.sessionId) {
      throw new RangeError(
        `loadFixture: observations[${i}] belongs to session ` +
          `"${spec.observations[i]!.sessionId}", not the fixture session "${spec.sessionId}"`,
      );
    }
  }

  return { spec, sha256 };
}
