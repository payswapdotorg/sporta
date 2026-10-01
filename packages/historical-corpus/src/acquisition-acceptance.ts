/**
 * The historical acquisition acceptance journey (REL-026) — the provider
 * rule made TESTABLE end-to-end, as one reusable driver.
 *
 * Source of truth:
 * - docs/testing/reality-engineering-lab-acceptance.md Gate REL-A1 and the
 *   REL-026 packet's acceptance scenario: "reference-only discovery ->
 *   rights declaration -> authorized acquisition -> corpus registration,
 *   with the digest + basis queryable afterwards".
 * - The Worker B provider rule (binding): "YouTube/source adapters may
 *   discover and reference content; download/transformation only when
 *   authorization/policy allows; never implement a bypass."
 *
 * THE JOURNEY (four stages, each leaving evidence):
 *
 * 1. REFERENCE-ONLY DISCOVERY — the source adapter discovers metadata and
 *    the driver registers REFERENCE-ONLY records (state `referenced`; a
 *    canonical URL is indexed, NO bytes are fetched). Stage 1 also runs the
 *    honest PRE-AUTHORIZATION PROBE: an acquisition attempt with NO basis
 *    against the freshly referenced source, which the corpus rights gate
 *    refuses typed (`corpus.rights-basis-required`) — and the refusal is
 *    RECORDED in the ledger (never silently dropped). The probe is the
 *    journey's own evidence that discovery fetched nothing.
 * 2. RIGHTS DECLARATION — the explicit rights/policy basis that will ride
 *    the acquisition (validated by the gate itself at authorization time;
 *    a malformed basis refuses typed there).
 * 3. AUTHORIZED ACQUISITION — `acquireSourceFromAdapter` in the canonical
 *    legal order (authorize -> retrieve -> record): the gate mints the
 *    branded token against the declared basis, the adapter serves the
 *    bytes only to that token, the store records the ACQUIRED DIGEST.
 * 4. CORPUS REGISTRATION — the acquired source is normalized and a
 *    content-addressed benchmark registration is bound (window + versions
 *    + optional feature bundles), leaving the digest + basis + benchmark
 *    binding queryable afterwards through the provenance chain
 *    (src/provenance.ts) and the registrar's own query API.
 *
 * The driver never bypasses anything: it composes the SAME store, adapter
 * and pipeline primitives the tests use, and its outcome carries the
 * stage-by-stage evidence so an acceptance test asserts rather than
 * re-implements. Every record inside the outcome is immutable at its
 * producer (the store, the registrar and the ledger all deep-freeze what
 * they hand out).
 */
import type { RightsBasis, SourceMetadata, SourceRecord } from "./domain";
import { acquireSourceFromAdapter } from "./pipeline";
import type { ProviderAdapter } from "./provider-adapter";
import type { AcquisitionProvenance } from "./provenance";
import { provenanceOf } from "./provenance";
import { createRefusalLedger } from "./refusal-ledger";
import type { RefusalLedger, RefusalRecord } from "./refusal-ledger";
import { createBenchmarkRegistrar } from "./benchmark";
import type { BenchmarkRegistrar, BenchmarkRegistrationRequest } from "./benchmark";
import { createCorpusStore } from "./store";
import type { CorpusStore } from "./store";

// ---------------------------------------------------------------------------
// The journey input
// ---------------------------------------------------------------------------

/** What the journey needs: the fixture adapter's view + the declared basis. */
export interface AcquisitionJourneyInput {
  /**
   * The source adapter (the provider-neutral seam). Discovery is metadata
   * only; byte retrieval happens ONLY through the store-minted token.
   */
  readonly adapter: ProviderAdapter;
  /** The discovery query stage 1 runs (default: everything the adapter has). */
  readonly discoveryQuery?: { readonly text?: string; readonly limit?: number };
  /**
   * The declared rights/policy basis for stage 3 — REQUIRED (an absent
   * basis would make stage 3 the pre-authorization probe again).
   */
  readonly declaredBasis: RightsBasis;
  /**
   * Which discovered reference the journey acquires (default: the first, in
   * the adapter's deterministic discovery order).
   */
  readonly canonicalUrl?: string;
  /** The benchmark registration request for stage 4 (window + versions). */
  readonly benchmark: Omit<BenchmarkRegistrationRequest, "sourceId">;
  /** The store to run against (default: a fresh in-memory corpus store). */
  readonly store?: CorpusStore;
  /** The registrar to register with (default: a fresh registrar over the store). */
  readonly registrar?: BenchmarkRegistrar;
}

// ---------------------------------------------------------------------------
// The journey outcome (the acceptance evidence)
// ---------------------------------------------------------------------------

/** Stage 1 evidence: reference-only discovery, zero bytes fetched. */
export interface DiscoveryStageEvidence {
  /** The discovered metadata (reference-only — no bytes were fetched). */
  readonly discovered: readonly SourceMetadata[];
  /** The registered source records (state `referenced`). */
  readonly references: readonly SourceRecord[];
  /**
   * The pre-authorization probe: the recorded typed refusal of an
   * acquisition attempt WITHOUT a basis against the freshly registered
   * reference (the journey's own evidence that discovery fetched nothing).
   */
  readonly preAuthorizationRefusal: RefusalRecord;
  /**
   * The probe's fail-closed proof: the record's state observed immediately
   * AFTER the refusal (still `referenced`, no basis, no digest — the probe
   * changed nothing).
   */
  readonly postProbeState: {
    readonly state: string;
    readonly rightsBasis: null;
    readonly acquiredChecksum: null;
  };
}

/** Stage 3 evidence: the authorized acquisition. */
export interface AcquisitionStageEvidence {
  /** The acquired record (state `acquired`, digest + method recorded). */
  readonly record: SourceRecord;
  /** The digest of the bytes actually acquired (the chain's digest leg). */
  readonly acquiredChecksum: string;
}

/** Stage 4 evidence: the corpus registration. */
export interface RegistrationStageEvidence {
  /** The registered record (state `benchmarked`). */
  readonly record: SourceRecord;
  /** The content-addressed benchmark registration id (queryable afterwards). */
  readonly registrationId: string;
}

/** The full journey outcome: stage evidence + the queryable chain. */
export interface AcquisitionJourneyOutcome {
  /** The store the journey ran against (for post-hoc queries). */
  readonly store: CorpusStore;
  /** The registrar the journey registered with. */
  readonly registrar: BenchmarkRegistrar;
  /** The refusal ledger the journey audited into. */
  readonly ledger: RefusalLedger;
  readonly sourceId: string;
  readonly canonicalUrl: string;
  readonly discovery: DiscoveryStageEvidence;
  readonly declaration: { readonly basis: RightsBasis };
  readonly acquisition: AcquisitionStageEvidence;
  readonly registration: RegistrationStageEvidence;
  /**
   * THE QUERYABLE CHAIN: the provenance view of the registered source —
   * the policy basis + the acquired digest + the benchmark binding, all in
   * one queryable record.
   */
  readonly provenance: AcquisitionProvenance;
}

// ---------------------------------------------------------------------------
// The driver
// ---------------------------------------------------------------------------

/**
 * Runs the acceptance journey end-to-end. Throws the corpus's own typed
 * refusals (the gate law is not suspended for the happy path — a bad basis
 * or unavailable bytes refuse here exactly as everywhere else, and the
 * ledger records them).
 */
export async function runAcquisitionJourney(
  input: AcquisitionJourneyInput,
): Promise<AcquisitionJourneyOutcome> {
  const store = input.store ?? createCorpusStore();
  const registrar = input.registrar ?? createBenchmarkRegistrar(store);
  // The journey always audits: the pre-authorization probe is a refusal by
  // design, and any later refusal (a malformed basis, unavailable bytes, an
  // ineligible benchmark) is recorded the same way — never silently dropped.
  const ledger = createRefusalLedger();

  // -- Stage 1: reference-only discovery ------------------------------------
  const discovered = await input.adapter.discoverMetadata({ ...(input.discoveryQuery ?? {}) });
  if (discovered.length === 0) {
    throw new Error("the acceptance journey requires at least one discoverable source");
  }
  const references: SourceRecord[] = [];
  for (const metadata of discovered) {
    references.push(await store.registerReference(metadata));
  }
  const target =
    input.canonicalUrl === undefined
      ? references[0]
      : references.find((record) => record.canonicalUrl === input.canonicalUrl);
  if (target === undefined) {
    throw new Error(
      `the acceptance journey could not find the requested reference ${input.canonicalUrl ?? "(first)"}`,
    );
  }
  // The pre-authorization probe: acquisition WITHOUT a basis must refuse
  // typed, fail-closed, recorded — this is discovery's own evidence that it
  // fetched nothing (the URL is a source reference, not rights).
  let preAuthorizationRefusal: RefusalRecord | null = null;
  try {
    await acquireSourceFromAdapter(store, target.sourceId, input.adapter);
  } catch (error) {
    preAuthorizationRefusal = ledger.record(
      "pre-authorization-probe",
      { sourceId: target.sourceId, canonicalUrl: target.canonicalUrl },
      error,
    );
    if (preAuthorizationRefusal === null) {
      throw error; // not a typed corpus refusal — surface it unchanged
    }
  }
  if (preAuthorizationRefusal === null) {
    throw new Error(
      "the pre-authorization probe did not refuse: an acquisition without a basis must fail closed (the rights gate is not optional)",
    );
  }
  // The probe's fail-closed proof, observed at probe time: the refusal
  // must have left the reference exactly where it was — anything else is
  // corruption of the gate law, and the driver says so.
  const postProbe = await store.get(target.sourceId);
  if (
    postProbe.state !== "referenced" ||
    postProbe.rightsBasis !== null ||
    postProbe.acquiredChecksum !== null
  ) {
    throw new Error(
      "the pre-authorization probe changed the record: fail-closed is broken (the rights gate must leave the reference untouched)",
    );
  }
  const postProbeState = {
    state: postProbe.state,
    rightsBasis: postProbe.rightsBasis,
    acquiredChecksum: postProbe.acquiredChecksum,
  };
  const discovery: DiscoveryStageEvidence = {
    discovered,
    references,
    preAuthorizationRefusal,
    postProbeState,
  };

  // -- Stage 2: rights declaration -------------------------------------------
  // The declared basis is validated by the gate itself at authorization
  // time (a malformed basis refuses typed there); the journey records the
  // declaration as the basis it will ride.
  const declaration = { basis: input.declaredBasis };

  // -- Stage 3: authorized acquisition ---------------------------------------
  const acquired = await ledger.attempt(
    "authorized-acquisition",
    { sourceId: target.sourceId, canonicalUrl: target.canonicalUrl },
    () =>
      acquireSourceFromAdapter(store, target.sourceId, input.adapter, {
        basis: input.declaredBasis,
      }),
  );
  const acquisition: AcquisitionStageEvidence = {
    record: acquired,
    acquiredChecksum: acquired.acquiredChecksum ?? "",
  };

  // -- Stage 4: corpus registration -------------------------------------------
  await store.normalizeSource(target.sourceId);
  const benchmark = await registrar.register({ ...input.benchmark, sourceId: target.sourceId });
  const registered = await store.get(target.sourceId);
  const registration: RegistrationStageEvidence = {
    record: registered,
    registrationId: benchmark.registrationId,
  };

  // -- The queryable chain -----------------------------------------------------
  const provenance = await provenanceOf(registered);

  return {
    store,
    registrar,
    ledger,
    sourceId: target.sourceId,
    canonicalUrl: target.canonicalUrl,
    discovery,
    declaration,
    acquisition,
    registration,
    provenance,
  };
}
