/**
 * Canonical serialization and parsing of scene specifications (W601, rule
 * S5 — the determinism proof surface).
 *
 * `serializeScene` emits THE canonical JSON form: object keys sorted
 * recursively (arrays keep their semantic order — entity order, marker
 * order, camera-slot order), numbers at full `JSON.stringify` precision, no
 * explicit `undefined` values, non-finite numbers rejected fail-loud (they
 * have no canonical form). Two deep-equal scenes serialize byte-identically;
 * two projections of the same snapshot + options are therefore provably
 * byte-identical.
 *
 * `parseSceneSpecification` is the inverse: JSON.parse, zod validation
 * against the current {@link SceneSpecification} schema, and a fail-closed
 * version gate (`isSceneVersionCompatible`) so a consumer never partially
 * parses a newer-minor scene (docs/contracts/COMPATIBILITY.md posture).
 */
import { SceneSpecification, SCENE_SCHEMA_VERSION, isSceneVersionCompatible } from "./schema";
import { SceneProjectionError } from "./errors";
import { isRecord } from "./internal";
import type { SceneSpecification as SceneSpecificationType } from "./schema";

/** Formats zod issues as `path: message; ...` (the repo's reporting shape). */
function issuesOf(error: {
  issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>;
}): string {
  return error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
}

/**
 * Builds the canonical JSON-safe structure: recursively sorted object keys,
 * arrays preserved element-wise, explicit `undefined` values DROPPED (the
 * canonical form has no undefined-valued keys), non-finite numbers rejected.
 */
function canonicalize(value: unknown, path: string): unknown {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new RangeError(
        `serializeScene: non-finite number at ${path} — a scene specification must be JSON-safe`,
      );
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => canonicalize(item, `${path}[${index}]`));
  }
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const member = value[key];
      if (member === undefined) continue;
      out[key] = canonicalize(member, `${path}.${key}`);
    }
    return out;
  }
  return value;
}

/**
 * Serializes a scene specification into its CANONICAL JSON form (sorted
 * keys, full number precision). Pure; byte-identical for deep-equal inputs.
 * Throws a `RangeError` on non-finite numbers (fail loud — the scene has no
 * canonical serialization for them).
 */
export function serializeScene(scene: SceneSpecificationType): string {
  return JSON.stringify(canonicalize(scene, "$"));
}

/**
 * Parses and validates a serialized scene specification. Throws
 * {@link SceneProjectionError} on: invalid JSON, a document that does not
 * validate against the current scene schema, or an incompatible
 * `sceneSchemaVersion` (fail closed — never a partial parse of a newer
 * scene).
 */
export function parseSceneSpecification(text: string): SceneSpecificationType {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    throw new SceneProjectionError(
      `parseSceneSpecification: the text is not valid JSON (${(cause as Error).message})`,
    );
  }
  const check = SceneSpecification.safeParse(parsed);
  if (!check.success) {
    throw new SceneProjectionError(
      `parseSceneSpecification: the document is not a valid SceneSpecification — ${issuesOf(check.error)}`,
    );
  }
  const scene = check.data;
  if (!isSceneVersionCompatible(scene.sceneSchemaVersion)) {
    throw new SceneProjectionError(
      `parseSceneSpecification: scene schema version "${scene.sceneSchemaVersion}" is not compatible with ` +
        `this package's scene schema version "${SCENE_SCHEMA_VERSION}" — refuse rather than partially parse`,
    );
  }
  return scene;
}
