/**
 * The simulated external feed source (REL-031) — the typed, continuous
 * (batched) item stream a simulated external platform client submits to
 * Sporta, per ADR-013 #15 ("submit media or feed jobs") and the Phase-5
 * sentence: "external platforms can continuously feed media to Sporta".
 *
 * Each item is a MEDIA REFERENCE with digest, rights basis and metadata:
 * - `metadata` — the provider-neutral SourceMetadata (provider, canonical
 *   URL, content id, availability, restrictions), exactly what the corpus's
 *   reference-registration path consumes;
 * - `bytes` — the deterministic fixture bytes the platform client holds
 *   (null for reference-only items: a public URL alone never proves
 *   transformation rights);
 * - `declaredBasis` — the item's rights basis (`authorized-feed`), REQUIRED
 *   with bytes (the corpus gate refuses byte acquisition without one);
 * - `declaredDigest` — SHA-256 of the item's bytes as DECLARED by the
 *   platform client — the corpus's own acquired checksum is the authority,
 *   and the feed record carries both legs so the correspondence is visible.
 *
 * DETERMINISM (binding): the source is fully deterministic from
 * (seed, plan) — no wall clock, no randomness (a fixed-point byte
 * generator, fixed epoch-based observedAt stamps, sequential ids). The
 * same seed + plan yields byte-identical batches, requests and digests, so
 * a re-derived submission is EXACTLY the original request — the
 * at-least-once re-submission converges under the idempotency key.
 *
 * The fixture FAMILIES (what the simulated stream exercises):
 * - `clean` — authorized media items only (the happy path);
 * - `mixed-rights` — authorized items + a reference-only item (no bytes: a
 *   public URL reference; under `requireTransformation` the feed job fails
 *   fail-closed at that item — the rights law, never bypassed);
 * - `malformed-item` — an item carrying bytes WITHOUT a declared basis (the
 *   corpus's typed `corpus.rights-basis-required` refusal at submission);
 * - `oversized` — more items than the default per-batch ceiling (the
 *   session's bounds refuse it typed and stop honestly);
 * - `malformed-batch` — two items sharing one canonical reference (the
 *   platform's typed duplicate-reference validation refusal);
 * - `empty-batch` — zero items (the platform's typed schema refusal).
 */
import type { RightsBasis, SourceMetadata } from "@sporta/historical-corpus";
import { sha256HexBytes } from "@sporta/external-platform";
import { FeedValidationError } from "./feed-errors";

/** The simulated source's identity (recorded in every feed record). */
export const FEED_SOURCE_KIND = "simulated-external-feed/v1" as const;

/** What an item of the stream carries. */
export type ExternalFeedItemKind = "authorized-media" | "reference-only" | "bytes-without-basis";

/** The fixture families the simulated stream exercises. */
export type ExternalFeedBatchFamily =
  "clean" | "mixed-rights" | "malformed-item" | "oversized" | "malformed-batch" | "empty-batch";

/** One item of the stream: the media reference + digest + rights basis. */
export interface ExternalFeedItemSpec {
  /** Deterministic, unique per source: `<seed>-item-<ordinal>`. */
  readonly itemId: string;
  readonly kind: ExternalFeedItemKind;
  readonly metadata: SourceMetadata;
  /** The platform-held bytes (null for reference-only items). */
  readonly bytes: Uint8Array | null;
  /** The declared basis (null only for the malformed bytes-without-basis family). */
  readonly declaredBasis: RightsBasis | null;
  /** SHA-256 hex of the bytes as declared by the platform client. */
  readonly declaredDigest: string | null;
}

/** One batch of the stream: a family + its items. */
export interface ExternalFeedBatchSpec {
  readonly batchIndex: number;
  readonly family: ExternalFeedBatchFamily;
  readonly items: readonly ExternalFeedItemSpec[];
}

/** One plan entry: a family, optionally with an item-count override. */
export type FeedBatchPlanEntry =
  | ExternalFeedBatchFamily
  | {
      readonly family: ExternalFeedBatchFamily;
      /** Only honored by the item-count-driven families (clean / oversized). */
      readonly itemCount?: number;
    };

/** Everything the simulated source needs. */
export interface SimulatedExternalFeedSourceOptions {
  /** The seed — the whole stream derives from it (non-empty). */
  readonly seed: string;
  /** The batch plan, one entry per emitted batch (non-empty). */
  readonly plan: readonly FeedBatchPlanEntry[];
  /** The byte length of each item's fixture bytes (default 48). */
  readonly itemByteLength?: number;
}

/** The typed external feed source (a bounded, deterministic batch stream). */
export interface ExternalFeedSource {
  readonly kind: typeof FEED_SOURCE_KIND;
  readonly seed: string;
  readonly batchCount: number;
  /** The batch at an index (typed validation error on out-of-range). */
  batchAt(batchIndex: number): ExternalFeedBatchSpec;
}

// ---------------------------------------------------------------------------
// Deterministic primitives (no wall clock, no randomness — fixed-point math)
// ---------------------------------------------------------------------------

/** The epoch every observedAt stamp derives from (fixed, like the fixtures). */
const FEED_OBSERVED_AT_EPOCH_MS = 1_700_000_000_000;

/**
 * Deterministic fixture bytes: a fixed-point hash over (seed, ordinal, i).
 * The repo's test-fixture precedent, carried into src so the feed session
 * and its tests share one deterministic byte discipline.
 */
function deterministicBytes(seed: string, ordinal: number, length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  let hash = (ordinal * 37) % 256;
  for (let i = 0; i < length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i % seed.length) + i) % 256;
    bytes[i] = hash;
  }
  return bytes;
}

/** The item's media-reference metadata (deterministic, unique per ordinal). */
function itemMetadata(seed: string, ordinal: number, referenceOnly: boolean): SourceMetadata {
  return {
    provider: "platform-feed",
    providerContentId: `${seed}-${ordinal}`,
    canonicalUrl: `https://platform.example/feeds/${seed}/${ordinal}`,
    ownerRef: "platform:video-platform",
    observedAt: FEED_OBSERVED_AT_EPOCH_MS + ordinal * 1_000,
    availability: "publicly-listed",
    restrictions: referenceOnly ? ["reference-only"] : [],
    title: `Feed item ${seed}-${ordinal}`,
    description: "a deterministic simulated external platform feed item",
  };
}

/** The authorized-feed basis every byte-carrying item declares. */
function feedBasis(seed: string): RightsBasis {
  return {
    basisType: "authorized-feed",
    grantRef: `agreement:${seed}-feed`,
    scope: "acquisition for normalization and transformation",
    declaredBy: "platform:video-platform",
  };
}

// ---------------------------------------------------------------------------
// The source
// ---------------------------------------------------------------------------

/** Resolves a plan entry into {family, itemCount}. */
function planEntryOf(entry: FeedBatchPlanEntry): {
  readonly family: ExternalFeedBatchFamily;
  readonly itemCount: number | null;
} {
  if (typeof entry === "string") return { family: entry, itemCount: null };
  return { family: entry.family, itemCount: entry.itemCount ?? null };
}

/**
 * Creates the simulated external feed source. Async because the declared
 * digests are real SHA-256 computations over the deterministic bytes.
 */
export async function createSimulatedExternalFeedSource(
  options: SimulatedExternalFeedSourceOptions,
): Promise<ExternalFeedSource> {
  const seed = options.seed;
  if (typeof seed !== "string" || seed.length === 0) {
    throw new FeedValidationError("the feed source seed must be a non-empty string");
  }
  if (!Array.isArray(options.plan) || options.plan.length === 0) {
    throw new FeedValidationError("the feed source plan must be a non-empty batch plan");
  }
  const byteLength = options.itemByteLength ?? 48;
  if (!Number.isInteger(byteLength) || byteLength <= 0) {
    throw new FeedValidationError("itemByteLength must be a positive integer");
  }

  // The global item ordinal — unique canonical references across the stream.
  let ordinal = 0;

  /** Builds one authorized-media item (bytes + basis + digest). */
  async function authorizedItem(): Promise<ExternalFeedItemSpec> {
    ordinal += 1;
    const bytes = deterministicBytes(seed, ordinal, byteLength);
    return {
      itemId: `${seed}-item-${ordinal}`,
      kind: "authorized-media",
      metadata: itemMetadata(seed, ordinal, false),
      bytes,
      declaredBasis: feedBasis(seed),
      declaredDigest: await sha256HexBytes(bytes),
    };
  }

  /** Builds one reference-only item (metadata only — never bytes). */
  function referenceItem(): ExternalFeedItemSpec {
    ordinal += 1;
    return {
      itemId: `${seed}-item-${ordinal}`,
      kind: "reference-only",
      metadata: itemMetadata(seed, ordinal, true),
      bytes: null,
      declaredBasis: null,
      declaredDigest: null,
    };
  }

  /** Builds one malformed item (bytes WITHOUT a declared basis). */
  async function basislessItem(): Promise<ExternalFeedItemSpec> {
    ordinal += 1;
    const bytes = deterministicBytes(seed, ordinal, byteLength);
    return {
      itemId: `${seed}-item-${ordinal}`,
      kind: "bytes-without-basis",
      metadata: itemMetadata(seed, ordinal, false),
      bytes,
      declaredBasis: null, // the corpus's typed rights refusal fires here
      declaredDigest: await sha256HexBytes(bytes),
    };
  }

  const batches: ExternalFeedBatchSpec[] = [];
  for (const entry of options.plan) {
    const { family, itemCount } = planEntryOf(entry);
    const index = batches.length;
    let items: ExternalFeedItemSpec[] = [];
    switch (family) {
      case "clean": {
        const count = itemCount ?? 3;
        if (!Number.isInteger(count) || count <= 0) {
          throw new FeedValidationError(`clean batch ${index} needs a positive item count`);
        }
        items = await Promise.all(Array.from({ length: count }, () => authorizedItem()));
        break;
      }
      case "mixed-rights": {
        // authorized items first, one reference-only item last (the item the
        // feed executor refuses fail-closed under requireTransformation).
        const authorizedCount = Math.max(1, (itemCount ?? 3) - 1);
        const authorized = await Promise.all(
          Array.from({ length: authorizedCount }, () => authorizedItem()),
        );
        items = [...authorized, referenceItem()];
        break;
      }
      case "malformed-item": {
        // authorized, bytes-WITHOUT-basis, authorized — the typed corpus
        // refusal fires at the second item, mid-submission.
        const first = await authorizedItem();
        const malformed = await basislessItem();
        const last = await authorizedItem();
        items = [first, malformed, last];
        break;
      }
      case "oversized": {
        const count = itemCount ?? 12; // exceeds the default per-batch ceiling (8)
        if (!Number.isInteger(count) || count <= 0) {
          throw new FeedValidationError(`oversized batch ${index} needs a positive item count`);
        }
        items = await Promise.all(Array.from({ length: count }, () => authorizedItem()));
        break;
      }
      case "malformed-batch": {
        // Two items sharing ONE canonical reference — the platform's typed
        // duplicate-reference validation refusal at submission.
        const first = await authorizedItem();
        const second = await authorizedItem();
        items = [
          first,
          {
            ...second,
            metadata: { ...second.metadata, canonicalUrl: first.metadata.canonicalUrl },
          },
        ];
        break;
      }
      case "empty-batch": {
        items = []; // the platform's typed schema refusal (items min(1))
        break;
      }
    }
    batches.push({ batchIndex: index, family, items });
  }

  return {
    kind: FEED_SOURCE_KIND,
    seed,
    batchCount: batches.length,
    batchAt(batchIndex: number): ExternalFeedBatchSpec {
      if (!Number.isInteger(batchIndex) || batchIndex < 0 || batchIndex >= batches.length) {
        throw new FeedValidationError(
          `batch index ${batchIndex} is outside the feed stream (0..${batches.length - 1})`,
        );
      }
      const batch = batches[batchIndex];
      if (batch === undefined) {
        throw new FeedValidationError(`batch index ${batchIndex} resolved to no batch`);
      }
      return batch;
    },
  };
}
