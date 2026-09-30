/**
 * Content-addressed benchmark fixtures (REL-009) — the reproducibility
 * contract of docs/contracts/historical-media-and-corpus.md:
 *
 * "Every benchmark fixture is content-addressed by:
 * - source identifier/reference;
 * - acquired-byte checksum where applicable;
 * - normalized-byte checksum;
 * - time window;
 * - feature/decoder versions."
 *
 * "Where applicable" is load-bearing: a reference-only fixture (a source
 * indexed for metadata discovery without ever acquiring bytes) carries NO
 * acquired-byte checksum — `null`, honestly, never a fabricated digest.
 * The fixture id is the SHA-256 of the canonical serialization of the
 * whole preimage, so two structurally identical fixtures have the
 * identical id and any field change produces a different one — what the
 * Lab's benchmark windows pin their reproducibility to.
 */
import { z } from "zod";
import { canonicalJson, sha256Hex } from "./hash";
import { CorpusValidationError } from "./errors";

/** A named component version — features and decoders both ride this shape. */
export const ComponentVersionSchema = z.object({
  /** The component name, e.g. "optical-flow" (feature) or "h264-decoder" (decoder). */
  name: z.string().min(1),
  /** Whether this component is a feature extractor or a decoder. */
  kind: z.enum(["feature", "decoder"]),
  /** The component version string. */
  version: z.string().min(1),
});

export type ComponentVersion = z.infer<typeof ComponentVersionSchema>;

/** The source identifier/reference the fixture is content-addressed over. */
export const BenchmarkSourceRefSchema = z.object({
  /** The corpus source id once registered (nullable for pre-registration fixtures). */
  sourceId: z.string().min(1).nullable(),
  provider: z.string().min(1),
  providerContentId: z.string().min(1).nullable(),
  canonicalUrl: z.string().min(1),
});

export type BenchmarkSourceRef = z.infer<typeof BenchmarkSourceRefSchema>;

/** The time window of the fixture (epoch ms, start inclusive / end inclusive). */
export const TimeWindowSchema = z
  .object({
    startMs: z.number().int().nonnegative(),
    endMs: z.number().int().nonnegative(),
  })
  .refine((window) => window.startMs <= window.endMs, {
    message: "time window startMs must be <= endMs",
  });

export type TimeWindow = z.infer<typeof TimeWindowSchema>;

/** The fixture input — the full reproducibility preimage. */
export const BenchmarkFixtureInputSchema = z.object({
  sourceRef: BenchmarkSourceRefSchema,
  /** SHA-256 hex of the acquired bytes, or null when the source was never acquired (reference-only). */
  acquiredByteChecksum: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .nullable(),
  /** SHA-256 hex of the normalized bytes (always required — the benchmark bar). */
  normalizedByteChecksum: z.string().regex(/^[0-9a-f]{64}$/),
  timeWindow: TimeWindowSchema,
  /** The feature/decoder versions the fixture's reproducibility pins. */
  versions: z.array(ComponentVersionSchema).min(1),
});

export type BenchmarkFixtureInput = z.infer<typeof BenchmarkFixtureInputSchema>;

/** The content-addressed fixture: the input plus its SHA-256 fixture id. */
export interface BenchmarkFixture {
  readonly fixtureId: string;
  readonly sourceRef: BenchmarkSourceRef;
  readonly acquiredByteChecksum: string | null;
  readonly normalizedByteChecksum: string;
  readonly timeWindow: TimeWindow;
  readonly versions: readonly ComponentVersion[];
}

/**
 * Creates a content-addressed benchmark fixture. The id is the SHA-256 of
 * the canonical JSON of the full preimage (sorted keys, no whitespace), so
 * property insertion order never matters.
 */
export async function createBenchmarkFixture(
  input: BenchmarkFixtureInput,
): Promise<BenchmarkFixture> {
  const parsed = BenchmarkFixtureInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new CorpusValidationError(
      "the benchmark fixture input violates the reproducibility contract shape",
      parsed.error.issues,
    );
  }
  const value = parsed.data;
  const fixtureId = await sha256Hex(canonicalJson(value));
  // Immutable evidence: the fixture is frozen before it leaves the factory.
  return deepFreeze({
    fixtureId,
    sourceRef: { ...value.sourceRef },
    acquiredByteChecksum: value.acquiredByteChecksum,
    normalizedByteChecksum: value.normalizedByteChecksum,
    timeWindow: { ...value.timeWindow },
    versions: value.versions.map((version) => ({ ...version })),
  });
}

/** Deep freeze (the store precedent): fixtures handed out are immutable. */
function deepFreeze<T>(value: T): T {
  if (Array.isArray(value)) {
    for (const item of value) deepFreeze(item);
    return Object.freeze(value);
  }
  if (value !== null && typeof value === "object") {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    return Object.freeze(value);
  }
  return value;
}
