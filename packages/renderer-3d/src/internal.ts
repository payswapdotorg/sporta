/**
 * Internal helpers shared by the renderer-3d modules (JSON-space and
 * vector utilities with the same semantics as the renderer-contract/anime
 * internals — kept private to this package's boundary).
 */

/** A 3-vector in scene coordinates (meters, right-handed, z up). */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** The world-up direction of the scene's right-handed z-up frame. */
export const WORLD_UP: Vec3 = { x: 0, y: 0, z: 1 };

/** Whether `value` is a finite number (the repo's numeric-floor check). */
export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Whether `value` is a plain JSON record (not an array, not null). */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Deep equality over JSON-safe values (primitives, arrays, records). */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => deepEqual(item, b[index]));
  }
  if (isRecord(a) && isRecord(b)) {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    return (
      keysA.length === keysB.length && keysA.every((key) => key in b && deepEqual(a[key], b[key]))
    );
  }
  return false;
}

/** Describes an unknown value for error messages (never throws). */
export function describeValue(value: unknown): string {
  if (typeof value === "string") return `string "${value}"`;
  if (typeof value === "number") return `number ${String(value)}`;
  if (typeof value === "boolean") return `boolean ${String(value)}`;
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

/** Formats zod issues as `path: message; ...` (the repo's reporting shape). */
export function issuesOf(error: {
  issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>;
}): string {
  return error.issues
    .slice(0, 3)
    .map((issue) => `${issue.path.map(String).join(".") || "<root>"}: ${issue.message}`)
    .join("; ");
}

/** XML-escaping for text nodes and attribute values (deterministic). */
export function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

/** Serialization rounding to 2 decimals (screen coordinates, radii). */
export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Serialization rounding to 3 decimals (opacity values). */
export function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** The Euclidean norm of a 3-vector. */
export function length3(v: Vec3): number {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

/** The cross product of two 3-vectors. */
export function cross3(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

/** The dot product of two 3-vectors. */
export function dot3(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

/** `a + t·(b − a)` (the parametric point on segment `a→b`). */
export function lerp3(a: Vec3, b: Vec3, t: number): Vec3 {
  return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y), z: a.z + t * (b.z - a.z) };
}

/** A unit vector; the zero vector maps to the zero vector (degenerate-safe). */
export function normalize3(v: Vec3): Vec3 {
  const length = length3(v);
  if (length === 0) return { x: 0, y: 0, z: 0 };
  return { x: v.x / length, y: v.y / length, z: v.z / length };
}
