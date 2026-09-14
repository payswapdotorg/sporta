/**
 * Canonical artifact serialization (W403, pure, deterministic).
 *
 * The byte-level authority on the artifact's file/stdout form:
 *
 * - **Sorted keys** — object keys are emitted in lexicographic order, so key
 *   insertion order can never leak into the bytes (JSON object key order is
 *   not semantic; array order IS and is preserved verbatim);
 * - **Full float precision** — numbers pass through `JSON.stringify`'s
 *   shortest-round-trip form (e.g. `0.1 + 0.2` serializes as
 *   `0.30000000000000004` and parses back to the identical double). Nothing
 *   is rounded, truncated, or coerced;
 * - **Volatile-free by rejection** — `NaN`, `±Infinity`, and `undefined`
 *   values are REJECTED with the full JSON path (`JSON.stringify` would map
 *   them to `null`/drop them — silently corrupting the artifact). Volatile
 *   *time* fields are not excluded: they are forced-constant by construction
 *   (the pipeline injects the clock; `replayForward` forces
 *   `REPLAY_GENERATED_AT_MS`) and the pipeline asserts the constants;
 * - **2-space indentation + trailing newline** — readable, diff-able goldens.
 *
 * The golden file additionally passes the repo's Prettier check (Prettier
 * reformats short arrays onto one line); Prettier's JSON printer is
 * lossless, so `serializeArtifact(JSON.parse(goldenText))` reproduces the
 * exact canonical bytes — the runner and tests compare those canonical bytes,
 * never the file's cosmetic formatting.
 */

/**
 * Canonicalizes a JSON value: returns a plain structure with keys sorted at
 * every object level, arrays preserved verbatim.
 *
 * Fail loud (repo style): `NaN`, `±Infinity`, `undefined` (anywhere — object
 * values or array elements), and non-JSON types (functions, symbols, bigints)
 * throw a `RangeError` carrying the value's JSON path.
 *
 * @param value the value to canonicalize (artifacts are plain JSON data)
 * @param path internal — the JSON path of `value` (rendered into errors)
 */
export function canonicalizeValue(value: unknown, path: readonly string[] = ["$"]): unknown {
  const where = renderPath(path);
  if (value === undefined) {
    throw new RangeError(
      `canonicalizeValue: ${where} is undefined — JSON would drop/null it silently ` +
        "(absent fields are represented by the key being absent, never by undefined)",
    );
  }
  if (typeof value === "number") {
    if (Number.isNaN(value)) {
      throw new RangeError(
        `canonicalizeValue: ${where} is NaN — a NaN would serialize as null and ` +
          "silently compare equal to a real null (a NaN in a world-model output is corrupt)",
      );
    }
    if (!Number.isFinite(value)) {
      throw new RangeError(
        `canonicalizeValue: ${where} is ${value} — JSON has no Infinity; refusing to ` +
          "serialize a non-finite number",
      );
    }
    return value;
  }
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((element, index) => canonicalizeValue(element, [...path, `[${index}]`]));
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = canonicalizeValue((value as Record<string, unknown>)[key], [...path, key]);
    }
    return out;
  }
  throw new RangeError(
    `canonicalizeValue: ${where} is of non-JSON type ${typeof value} — cannot be serialized`,
  );
}

/**
 * Serializes a value into the canonical artifact bytes: canonicalized
 * (sorted keys), full-precision, 2-space-indented JSON with a trailing
 * newline. Deterministic: the same value serializes to the same bytes on
 * every call.
 */
export function serializeArtifact(value: unknown): string {
  return `${JSON.stringify(canonicalizeValue(value), null, 2)}\n`;
}

/** Renders a path array (`["$", "a", "[2]", "b"]`) as `$.a[2].b`. */
export function renderPath(path: readonly string[]): string {
  let out = "$";
  for (const segment of path) {
    out += segment.startsWith("[") ? segment : `.${segment}`;
  }
  return out;
}
