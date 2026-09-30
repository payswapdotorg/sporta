/**
 * The canonical acquisition pipeline (REL-009): the legal ORDER of a
 * provider-path acquisition, as one reusable driver.
 *
 * ```
 * registerReference          (referenced — indexed, metadata discovery OK)
 *   -> authorizeAccess(basis) (authorized-for-access — THE RIGHTS GATE)
 *   -> adapter.retrieveBytes(ref, access)   (bytes, only through the token)
 *   -> recordAcquiredBytes(access, bytes)   (acquired — checksums recorded)
 * ```
 *
 * The driver cannot bypass the gate: the access token it hands to the
 * adapter is minted by `store.authorizeAccess` (which refuses without a
 * basis), and `recordAcquiredBytes` re-verifies the token. It exists so
 * REL-011 (corpus/feature pipeline) and the tests compose one canonical
 * order instead of re-implementing (and possibly corrupting) it.
 */
import type { RightsBasis, SourceRecord } from "./domain";
import type { ProviderAdapter } from "./provider-adapter";
import type { CorpusStore } from "./store";

export interface AcquireFromAdapterOptions {
  /**
   * The explicit rights/policy basis. REQUIRED — absent, the driver lets
   * the store's typed `corpus.rights-basis-required` refusal surface
   * unchanged (the driver never improvises a basis).
   */
  readonly basis?: RightsBasis;
  /** The acquisition method/version recorded on the source. */
  readonly acquisitionMethod?: string;
}

/**
 * Runs the canonical provider-path acquisition for an already-registered
 * reference: authorize -> retrieve -> record. Returns the acquired record.
 */
export async function acquireSourceFromAdapter(
  store: CorpusStore,
  sourceId: string,
  adapter: ProviderAdapter,
  options: AcquireFromAdapterOptions = {},
): Promise<SourceRecord> {
  const access = await store.authorizeAccess(sourceId, options.basis);
  const record = await store.get(sourceId);
  const reference = await adapter.toCanonicalReference({
    provider: record.provider,
    providerContentId: record.providerContentId,
    canonicalUrl: record.canonicalUrl,
    ownerRef: record.ownerRef,
    observedAt: record.observedAt,
    availability: record.availability,
    restrictions: [...record.restrictions],
    // Display fields do not participate in the canonical reference; the
    // record does not retain them (they live in the metadata digest).
    title: null,
    description: null,
  });
  const bytes = await adapter.retrieveBytes(reference, access);
  return store.recordAcquiredBytes(sourceId, access, bytes, {
    acquisitionMethod: options.acquisitionMethod ?? `${adapter.provider}:v0`,
  });
}
