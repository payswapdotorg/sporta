/**
 * Canonical report serialization (W804): deterministic bytes for identical
 * inputs. The canonical form recursively sorts object keys (code-unit order)
 * and serializes compactly — the same events in, the SAME bytes out, on every
 * run (test-pinned). Arrays keep their construction order (which is itself
 * fixed by the closed vocabulary orders in `./funnel.ts`).
 */
import type { ProductAnalyticsReport } from "./report.ts";
import { parseAnalyticsReport } from "./schema.ts";

/** Sorts object keys recursively (arrays keep order; primitives untouched). */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
      .map((key) => [key, canonicalize(record[key])] as const);
    return Object.fromEntries(entries);
  }
  return value;
}

/**
 * Serializes one report to its canonical compact JSON form (no trailing
 * newline). Byte-identical for identical inputs — the determinism contract.
 * The report must be one `parseAnalyticsReport` accepts (callers validate).
 */
export function serializeAnalyticsReport(report: ProductAnalyticsReport): string {
  return JSON.stringify(canonicalize(report));
}

/**
 * Parses a serialized canonical report back (fail-loud through the versioned
 * zod schema — `parseAnalyticsReport`): the reader-side counterpart of
 * {@link serializeAnalyticsReport}.
 */
export function deserializeAnalyticsReport(text: string): ProductAnalyticsReport {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(
      `serialized analytics report is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return parseAnalyticsReport(parsed);
}
