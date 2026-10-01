/**
 * The acquisition provenance view (REL-026) — the policy basis + the acquired
 * digest in ONE queryable chain.
 *
 * Source of truth: docs/testing/reality-engineering-lab-acceptance.md Gate
 * REL-A1 ("record rights basis ... acquire bytes only when permitted ...
 * with the digest + basis queryable afterwards" per the REL-026 packet) and
 * docs/adr/ADR-013-reality-engineering-lab-and-agent-organizations.md #7
 * ("A public URL alone never proves transformation rights").
 *
 * THE INVARIANT (binding, unchanged from the 62-b delivery): the URL is NOT
 * in the chain as evidence of anything — the chain carries the canonical
 * reference (where the content was seen), the RIGHTS/POLICY BASIS (the only
 * thing that ever authorized touching bytes), the acquired digest (what was
 * actually acquired), the acquisition method, the normalization record and
 * the benchmark binding. A record that never passed the gate shows the
 * basis fields as honest nulls — a reference without rights is queryable AS
 * a reference, never as an acquisition.
 *
 * This module is a PURE PROJECTION over the immutable {@link SourceRecord}:
 * it adds no authority, mutates nothing, and invents no fields — the store
 * remains the only place a basis or a digest can be recorded.
 */
import type { SourceRecord } from "./domain";
import { canonicalJson, sha256Hex } from "./hash";

/** The rights-basis leg of the chain (null until an authorized/user-declared basis exists). */
export interface ProvenanceBasis {
  /** The source-class basis type (the frozen vocabulary). */
  readonly basisType: string;
  /** The explicit grant/declaration reference. */
  readonly grantRef: string;
  /** What the basis permits. */
  readonly scope: string;
  /** Who declared the basis. */
  readonly declaredBy: string;
  /** SHA-256 hex of the canonical basis record (the audit digest). */
  readonly digest: string;
}

/** The normalization leg (null until `normalized`). */
export interface ProvenanceNormalization {
  readonly normalizedChecksum: string;
  readonly pipeline: string;
  readonly pipelineVersion: string;
}

/**
 * The acquisition provenance chain: which reference, which basis (if any),
 * which digest (if any), how it was acquired, what normalization ran and
 * which benchmark fixture is bound. Answers the REL-026 acceptance question
 * — "the policy basis + the acquired digest in the provenance chain" — as
 * one queryable record.
 */
export interface AcquisitionProvenance {
  readonly sourceId: string;
  readonly provider: string;
  readonly canonicalUrl: string;
  /** The acquisition state at projection time. */
  readonly state: string;
  /** The declared restrictions (unchanged law: a basis cannot lift them). */
  readonly restrictions: readonly string[];
  /** THE basis leg — null until the rights gate or the user-fed path recorded one. */
  readonly basis: ProvenanceBasis | null;
  /** THE digest leg — SHA-256 hex of the acquired bytes, null until `acquired`. */
  readonly acquiredChecksum: string | null;
  /** How the bytes were acquired (e.g. "authorized-acquisition", "user-upload:v0"). */
  readonly acquisitionMethod: string | null;
  /** When the acquisition happened (epoch ms), null until `acquired`. */
  readonly acquiredAt: number | null;
  /** The normalization leg, null until `normalized`. */
  readonly normalization: ProvenanceNormalization | null;
  /** The content-addressed benchmark fixture bound at `benchmarked`, else null. */
  readonly benchmarkedWith: string | null;
}

/**
 * Projects the provenance chain of a source record. Async only because the
 * basis audit digest is a real SHA-256 over the canonical basis record —
 * the same digest the store mints into the byte-access token, so the chain
 * and the token corroborate each other.
 */
export async function provenanceOf(record: SourceRecord): Promise<AcquisitionProvenance> {
  const basis =
    record.rightsBasis === null
      ? null
      : {
          basisType: record.rightsBasis.basisType,
          grantRef: record.rightsBasis.grantRef,
          scope: record.rightsBasis.scope,
          declaredBy: record.rightsBasis.declaredBy,
          digest: await sha256Hex(canonicalJson(record.rightsBasis)),
        };
  return deepFreeze({
    sourceId: record.sourceId,
    provider: record.provider,
    canonicalUrl: record.canonicalUrl,
    state: record.state,
    restrictions: [...record.restrictions],
    basis,
    acquiredChecksum: record.acquiredChecksum,
    acquisitionMethod: record.acquisitionMethod,
    acquiredAt: record.acquiredAt,
    normalization:
      record.normalized === null
        ? null
        : {
            normalizedChecksum: record.normalized.normalizedChecksum,
            pipeline: record.normalized.pipeline,
            pipelineVersion: record.normalized.pipelineVersion,
          },
    benchmarkedWith: record.benchmarkedWith,
  });
}

/** Deep freeze (the store precedent): views handed out are immutable. */
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
