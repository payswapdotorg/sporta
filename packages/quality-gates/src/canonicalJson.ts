/**
 * The canonical JSON serializer — the byte-determinism contract of the W803
 * release report (docs/GATES.md §determinism).
 *
 * `evaluateReleaseReadiness` is a pure function of its input (no clock, no
 * RNG, no I/O), and its report is serialized through THIS function so that
 * "same input → byte-identical JSON report" holds by construction, in one
 * process and across subprocess invocations:
 *
 * - object keys are emitted in code-unit-sorted order (recursively) — the
 *   serialization never depends on the construction order of any
 *   intermediate object;
 * - `undefined` and non-finite numbers are REFUSED (a report field that is
 *   `undefined`, `NaN`, or `Infinity` is an evaluator bug — `JSON.stringify`
 *   would silently degrade it to `null`, and this suite does not);
 * - everything else uses the standard JSON grammar (strings escaped per
 *   `JSON.stringify`, integers and finite floats verbatim).
 *
 * The same input always yields the same string; `test/determinism.test.ts`
 * pins it twice in-process and across two CLI subprocess invocations with
 * compared SHA-256 hashes.
 */

/** Serializes one value into its canonical JSON form. */
export function canonicalJsonStringify(value: unknown): string {
  return serialize(value, "$");
}

/** The recursive worker (carries the JSON path for fail-loud errors). */
function serialize(value: unknown, path: string): string {
  if (value === null) return "null";
  const type = typeof value;
  if (type === "boolean") return value ? "true" : "false";
  if (type === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(
        `canonical JSON: non-finite number at ${path} (an evaluator bug — reports must be JSON-safe)`,
      );
    }
    return String(value);
  }
  if (type === "string") return JSON.stringify(value);
  if (type === "undefined") {
    throw new TypeError(
      `canonical JSON: undefined at ${path} (an evaluator bug — optional fields must be omitted, not undefined)`,
    );
  }
  if (type !== "object") {
    throw new TypeError(
      `canonical JSON: unserializable ${type} at ${path} (reports must be JSON-safe)`,
    );
  }
  if (Array.isArray(value)) {
    const parts = value.map((entry, index) => serialize(entry, `${path}[${index}]`));
    return `[${parts.join(",")}]`;
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const parts = keys.map((key) => {
    const entry = (value as Record<string, unknown>)[key];
    return `${JSON.stringify(key)}:${serialize(entry, `${path}.${key}`)}`;
  });
  return `{${parts.join(",")}}`;
}
