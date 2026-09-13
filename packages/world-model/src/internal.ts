/**
 * Internal helpers for @sporta/world-model.
 *
 * These are implementation utilities, not contract surface: everything the
 * engine stores is cloned at the boundary, and everything it returns is a
 * deep-frozen clone, so callers can never reach engine state through the
 * objects they hand in or get back (immutable snapshots, architecture-lock §4).
 */

/**
 * Structurally clones a plain-JSON value. Engine state is always plain data
 * (no functions, no cycles), so `structuredClone` is sufficient.
 */
export function cloneDeep<T>(value: T): T {
  return structuredClone(value);
}

/**
 * Recursively freezes a plain-JSON value (objects, arrays, primitives).
 * Applied only to fresh clones handed back to callers — never to internal
 * engine state, which must stay mutable.
 */
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.freeze(value);
    const record = value as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      deepFreeze(record[key]);
    }
  }
  return value;
}

/**
 * Renders a zod validation failure as readable issue strings
 * (`path: message`), for embedding in engine error messages.
 */
export function issuesOf(error: {
  issues: Array<{ path: readonly PropertyKey[]; message: string }>;
}): string[] {
  return error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
}
