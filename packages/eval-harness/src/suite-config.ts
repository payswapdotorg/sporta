/**
 * The W801 suite definition: the declarative, versioned, strictly-validated
 * suite configuration (work item W801: "repeatable benchmark suite produces
 * machine-readable reports").
 *
 * A suite config is a CHECKED-IN JSON document naming the benchmark cases:
 *
 * - every case has a caller-chosen `caseName` (unique) and a `caseKind` from
 *   the CONTROLLED VOCABULARY {@link CASE_KINDS} — an unknown kind (or an
 *   unknown key, a missing field, a wrong type, a duplicate name) FAILS LOUD
 *   with the full JSON path, before anything runs. There are NO defaults:
 *   every case must declare its `fixture` and its `policy` explicitly, and an
 *   omitted field is a validation error, never a silently-filled value;
 * - every case's fixture paths are RELATIVE TO THE SUITE CONFIG FILE — the
 *   report carries the verbatim declared values (relative), never resolved
 *   absolute paths, so report bytes stay machine-independent;
 * - the config's canonical serialization is hashed (sha256) into the report
 *   (suite config hash) — a suite report is reproducible only against the
 *   byte-identical config.
 *
 * The shape is versioned by {@link SUITE_CONFIG_SCHEMA_TAG}: any change to
 * the config shape bumps the tag (old configs fail loud with the tag
 * mismatch, never partially parse).
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { serializeArtifact } from "@sporta/evaluation";

/** Canonical suite-config schema tag (bump on any config shape change). */
export const SUITE_CONFIG_SCHEMA_TAG = "sporta/eval-harness/suite-config@1";

/** The checked-in default suite (package-relative). */
export const DEFAULT_SUITE_PATH = `${import.meta.dir}/../fixtures/suite.json`;

/** The controlled case-kind vocabulary (the suite's entire case universe). */
export const CASE_KINDS = [
  "w403-replay-comparability",
  "w503-temporal-consistency",
  "w601-scene-conformance",
] as const;

export type CaseKind = (typeof CASE_KINDS)[number];

// ---------------------------------------------------------------------------
// Case configs (a discriminated union on `caseKind`)
// ---------------------------------------------------------------------------

/** W403 case: replay comparability (cross-run world-model evaluation). */
export interface W403CaseConfig {
  readonly caseKind: "w403-replay-comparability";
  /** Caller-chosen unique case label (echoed into the report). */
  readonly caseName: string;
  /**
   * The frozen W403 fixture inputs, paths RELATIVE to the suite config file.
   * `goldenPath: null` disables the golden comparison (an explicit policy,
   * not a default).
   */
  readonly fixture: {
    readonly fixturePath: string;
    readonly goldenPath: string | null;
  };
  /** Cross-run policy: the number of subprocess runs (integer >= 2). */
  readonly policy: {
    readonly runs: number;
  };
}

/** W503 case: rendered-clip temporal consistency. */
export interface W503CaseConfig {
  readonly caseKind: "w503-temporal-consistency";
  readonly caseName: string;
  /**
   * The evaluated clip. The W503 evaluator ships exactly one clean fixture
   * clip (built by driving the real W502 renderer); the controlled value is
   * `"w503-clean-fixture"` — anything else fails loud.
   */
  readonly fixture: {
    readonly clip: "w503-clean-fixture";
  };
  /**
   * Whether the case also runs the W503 detection proof (every injected
   * defect must flip the verdict to FAIL; one going undetected fails the
   * case). Explicit boolean, no default.
   */
  readonly policy: {
    readonly detectionProof: boolean;
  };
}

/** W601 case: scene-projection conformance. */
export interface W601CaseConfig {
  readonly caseKind: "w601-scene-conformance";
  readonly caseName: string;
  /**
   * The scene-fixture file (snapshot + events + camera slots), path RELATIVE
   * to the suite config file.
   */
  readonly fixture: {
    readonly sceneFixturePath: string;
  };
  /**
   * Conformance evidence policy. `"full"` supplies the snapshot, the event
   * tail, and the camera-slot selection as evidence — the strongest
   * conformance mode (identity, verbatim-block, and byte-identity checks
   * all enabled).
   */
  readonly policy: {
    readonly evidence: "full";
  };
}

/** One suite case (discriminated on `caseKind`). */
export type SuiteCaseConfig = W403CaseConfig | W503CaseConfig | W601CaseConfig;

/** The validated suite configuration. */
export interface SuiteConfig {
  /** The config schema tag — must equal {@link SUITE_CONFIG_SCHEMA_TAG}. */
  readonly suiteKind: typeof SUITE_CONFIG_SCHEMA_TAG;
  /** The suite's identity (echoed into every report). */
  readonly suiteId: string;
  /** The suite's own version (integer >= 1; bump when cases change). */
  readonly suiteVersion: number;
  /** The suite's cases, in the declared run order (order is semantic). */
  readonly cases: readonly SuiteCaseConfig[];
}

/** A loaded suite: the validated config plus its canonical hash. */
export interface LoadedSuite {
  /** The validated config. */
  readonly config: SuiteConfig;
  /** The absolute path the config was loaded from (fixture paths resolve against it). */
  readonly configPath: string;
  /** The canonical serialization of the validated config (sorted keys). */
  readonly canonical: string;
  /** sha256 (hex) over the canonical bytes — the suite config hash. */
  readonly sha256: string;
  /** The directory fixture paths resolve against (the config file's dir). */
  readonly originDir: string;
}

// ---------------------------------------------------------------------------
// Validation helpers (fail loud, JSON-path errors, zero defaults)
// ---------------------------------------------------------------------------

/** Renders a path array as `$.cases[2].fixture` for error messages. */
function at(path: readonly string[]): string {
  return path.join(".");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Asserts the object has EXACTLY the expected keys (no unknown, no missing). */
function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  path: readonly string[],
): void {
  const expectedSet = new Set(expected);
  for (const key of Object.keys(value)) {
    if (!expectedSet.has(key)) {
      throw new RangeError(
        `parseSuiteConfig: ${at(path)} carries unknown key "${key}" — the config shape is ` +
          `versioned (${SUITE_CONFIG_SCHEMA_TAG}); unknown keys fail loud, never silently ignored`,
      );
    }
  }
  for (const key of expected) {
    if (!(key in value)) {
      throw new RangeError(
        `parseSuiteConfig: ${at(path)} is missing required key "${key}" — the config has NO ` +
          "defaults; every case must declare its fixture and policy explicitly",
      );
    }
  }
}

function requireNonEmptyString(value: unknown, path: readonly string[]): string {
  if (typeof value !== "string" || value.length < 1) {
    throw new RangeError(
      `parseSuiteConfig: ${at(path)} must be a non-empty string (got ${JSON.stringify(value)})`,
    );
  }
  return value;
}

function requireBoolean(value: unknown, path: readonly string[]): boolean {
  if (typeof value !== "boolean") {
    throw new RangeError(
      `parseSuiteConfig: ${at(path)} must be a boolean (got ${JSON.stringify(value)})`,
    );
  }
  return value;
}

function requireInteger(value: unknown, minimum: number, path: readonly string[]): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum) {
    throw new RangeError(
      `parseSuiteConfig: ${at(path)} must be an integer >= ${minimum} (got ${JSON.stringify(value)})`,
    );
  }
  return value;
}

/** Validates one case's common envelope, returning the caseName. */
function requireCaseEnvelope(
  value: unknown,
  index: number,
): { caseName: string; kind: string; body: Record<string, unknown> } {
  const casePath = ["$", "cases", `[${index}]`];
  if (!isRecord(value)) {
    throw new RangeError(
      `parseSuiteConfig: ${at(casePath)} must be an object (got ${JSON.stringify(value)})`,
    );
  }
  exactKeys(value, ["caseName", "caseKind", "fixture", "policy"], casePath);
  const caseName = requireNonEmptyString(value.caseName, [...casePath, "caseName"]);
  const kind = value.caseKind;
  if (typeof kind !== "string") {
    throw new RangeError(
      `parseSuiteConfig: ${at([...casePath, "caseKind"])} must be a string (got ${JSON.stringify(kind)})`,
    );
  }
  return { caseName, kind, body: value };
}

/** Validates a W403 case config. */
function parseW403Case(
  body: Record<string, unknown>,
  caseName: string,
  index: number,
): W403CaseConfig {
  const casePath = ["$", "cases", `[${index}]`];
  const fixture = body.fixture;
  if (!isRecord(fixture)) {
    throw new RangeError(
      `parseSuiteConfig: ${at([...casePath, "fixture"])} must be an object ` +
        `{ fixturePath, goldenPath }`,
    );
  }
  exactKeys(fixture, ["fixturePath", "goldenPath"], [...casePath, "fixture"]);
  const fixturePath = requireNonEmptyString(fixture.fixturePath, [
    ...casePath,
    "fixture",
    "fixturePath",
  ]);
  const goldenPathValue = fixture.goldenPath;
  if (goldenPathValue !== null && typeof goldenPathValue !== "string") {
    throw new RangeError(
      `parseSuiteConfig: ${at([...casePath, "fixture", "goldenPath"])} must be a string or ` +
        `null (got ${JSON.stringify(goldenPathValue)})`,
    );
  }
  if (goldenPathValue !== null && goldenPathValue.length < 1) {
    throw new RangeError(
      `parseSuiteConfig: ${at([...casePath, "fixture", "goldenPath"])} must be non-empty when ` +
        "present (use null to disable the golden comparison explicitly)",
    );
  }
  const policy = body.policy;
  if (!isRecord(policy)) {
    throw new RangeError(
      `parseSuiteConfig: ${at([...casePath, "policy"])} must be an object { runs }`,
    );
  }
  exactKeys(policy, ["runs"], [...casePath, "policy"]);
  const runs = requireInteger(policy.runs, 2, [...casePath, "policy", "runs"]);
  return {
    caseKind: "w403-replay-comparability",
    caseName,
    fixture: { fixturePath, goldenPath: goldenPathValue },
    policy: { runs },
  };
}

/** Validates a W503 case config. */
function parseW503Case(
  body: Record<string, unknown>,
  caseName: string,
  index: number,
): W503CaseConfig {
  const casePath = ["$", "cases", `[${index}]`];
  const fixture = body.fixture;
  if (!isRecord(fixture)) {
    throw new RangeError(
      `parseSuiteConfig: ${at([...casePath, "fixture"])} must be an object { clip }`,
    );
  }
  exactKeys(fixture, ["clip"], [...casePath, "fixture"]);
  if (fixture.clip !== "w503-clean-fixture") {
    throw new RangeError(
      `parseSuiteConfig: ${at([...casePath, "fixture", "clip"])} must be "w503-clean-fixture" ` +
        `(the only clip the W503 evaluator ships; got ${JSON.stringify(fixture.clip)})`,
    );
  }
  const policy = body.policy;
  if (!isRecord(policy)) {
    throw new RangeError(
      `parseSuiteConfig: ${at([...casePath, "policy"])} must be an object { detectionProof }`,
    );
  }
  exactKeys(policy, ["detectionProof"], [...casePath, "policy"]);
  const detectionProof = requireBoolean(policy.detectionProof, [
    ...casePath,
    "policy",
    "detectionProof",
  ]);
  return {
    caseKind: "w503-temporal-consistency",
    caseName,
    fixture: { clip: "w503-clean-fixture" },
    policy: { detectionProof },
  };
}

/** Validates a W601 case config. */
function parseW601Case(
  body: Record<string, unknown>,
  caseName: string,
  index: number,
): W601CaseConfig {
  const casePath = ["$", "cases", `[${index}]`];
  const fixture = body.fixture;
  if (!isRecord(fixture)) {
    throw new RangeError(
      `parseSuiteConfig: ${at([...casePath, "fixture"])} must be an object { sceneFixturePath }`,
    );
  }
  exactKeys(fixture, ["sceneFixturePath"], [...casePath, "fixture"]);
  const sceneFixturePath = requireNonEmptyString(fixture.sceneFixturePath, [
    ...casePath,
    "fixture",
    "sceneFixturePath",
  ]);
  const policy = body.policy;
  if (!isRecord(policy)) {
    throw new RangeError(
      `parseSuiteConfig: ${at([...casePath, "policy"])} must be an object { evidence }`,
    );
  }
  exactKeys(policy, ["evidence"], [...casePath, "policy"]);
  if (policy.evidence !== "full") {
    throw new RangeError(
      `parseSuiteConfig: ${at([...casePath, "policy", "evidence"])} must be "full" ` +
        `(the only evidence mode this harness implements; got ${JSON.stringify(policy.evidence)})`,
    );
  }
  return {
    caseKind: "w601-scene-conformance",
    caseName,
    fixture: { sceneFixturePath },
    policy: { evidence: "full" },
  };
}

const CASE_PARSERS: Record<
  string,
  (body: Record<string, unknown>, caseName: string, index: number) => SuiteCaseConfig
> = {
  "w403-replay-comparability": parseW403Case,
  "w503-temporal-consistency": parseW503Case,
  "w601-scene-conformance": parseW601Case,
};

/**
 * Validates a suite config value into a {@link SuiteConfig}.
 *
 * Fail loud (repo style): unknown case kinds, unknown keys, missing fields,
 * wrong types, duplicate case names, and tag mismatches all throw a
 * `RangeError` carrying the full JSON path. No defaults are applied — the
 * value must be complete and explicit.
 */
export function validateSuiteConfig(value: unknown): SuiteConfig {
  if (!isRecord(value)) {
    throw new RangeError(
      `parseSuiteConfig: the suite config must be a JSON object (got ${JSON.stringify(value)})`,
    );
  }
  exactKeys(value, ["suiteKind", "suiteId", "suiteVersion", "cases"], ["$"]);
  if (value.suiteKind !== SUITE_CONFIG_SCHEMA_TAG) {
    throw new RangeError(
      `parseSuiteConfig: $.suiteKind must be "${SUITE_CONFIG_SCHEMA_TAG}" ` +
        `(got ${JSON.stringify(value.suiteKind)}) — the config shape is versioned; a mismatch ` +
        "is a hard error, never a partial parse",
    );
  }
  const suiteId = requireNonEmptyString(value.suiteId, ["$", "suiteId"]);
  const suiteVersion = requireInteger(value.suiteVersion, 1, ["$", "suiteVersion"]);

  const casesValue = value.cases;
  if (!Array.isArray(casesValue) || casesValue.length < 1) {
    throw new RangeError(
      "parseSuiteConfig: $.cases must be a non-empty array — a suite with no cases is a " +
        "configuration error, not a vacuous PASS",
    );
  }
  const cases: SuiteCaseConfig[] = [];
  const seenNames = new Set<string>();
  for (let index = 0; index < casesValue.length; index += 1) {
    const envelope = requireCaseEnvelope(casesValue[index], index);
    const parser = CASE_PARSERS[envelope.kind];
    if (parser === undefined) {
      throw new RangeError(
        `parseSuiteConfig: $.cases[${index}].caseKind is "${envelope.kind}" — unknown case ` +
          `kind. Known kinds: ${CASE_KINDS.map((kind) => `"${kind}"`).join(", ")}. A new kind ` +
          "is a conscious harness extension (executor + report shape + docs), never a silent skip",
      );
    }
    if (seenNames.has(envelope.caseName)) {
      throw new RangeError(
        `parseSuiteConfig: duplicate caseName "${envelope.caseName}" at $.cases[${index}] — ` +
          "case names must be unique (they key the report's failure reasons)",
      );
    }
    seenNames.add(envelope.caseName);
    cases.push(parser(envelope.body, envelope.caseName, index));
  }

  return {
    suiteKind: SUITE_CONFIG_SCHEMA_TAG,
    suiteId,
    suiteVersion,
    cases,
  };
}

/** Loads a suite config file and validates it (fail loud on any problem). */
export function loadSuiteConfig(configPath: string = DEFAULT_SUITE_PATH): LoadedSuite {
  let text: string;
  try {
    text = readFileSync(configPath, "utf8");
  } catch (cause) {
    throw new RangeError(
      `loadSuiteConfig: cannot read the suite config at "${configPath}" (${(cause as Error).message})`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    throw new RangeError(
      `loadSuiteConfig: suite config "${configPath}" is not valid JSON (${(cause as Error).message})`,
    );
  }
  return finalizeSuite(parsed, configPath);
}

/** Finishes a validated config: canonical bytes, sha256, origin directory. */
function finalizeSuite(value: unknown, configPath: string): LoadedSuite {
  const config = validateSuiteConfig(value);
  const canonical = serializeArtifact(config);
  const sha256 = createHash("sha256").update(canonical).digest("hex");
  const originDir = dirname(configPath);
  return { config, configPath, canonical, sha256, originDir };
}
