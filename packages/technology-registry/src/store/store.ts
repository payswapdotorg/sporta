/**
 * Technology Registry persistence port (R001) — the in-memory implementation.
 *
 * Follows the `@sporta/session` repository pattern: one interface
 * ({@link TechnologyRegistryStore}) with a process-local implementation
 * (this file, for tests and ephemeral runs) and a durable SQLite
 * implementation (`sqlite-store.ts`, on the built-in `bun:sqlite`). Both
 * store the FULL validated contract documents (`document_json` for sqlite)
 * and validate every document on write AND on read, failing loudly on
 * drift. Deep-clone-on-read means callers can never mutate stored state
 * through handed-out references.
 *
 * The store is deliberately DUMB document storage with keyed lookups; every
 * lifecycle rule (legal transitions, evidence gates, license gates) lives in
 * the services above it. One exception is made for atomicity:
 * {@link TechnologyRegistryStore.saveCurrentProfile} writes the profile
 * document, the current-profile pointer, and the effective status together
 * so a crash can never leave a dangling pointer.
 *
 * Ordering is fully explicit (`decidedAtMs`/`reviewedAtMs` plus the append
 * sequence) — the store never reads the wall clock, so histories are stable
 * and testable.
 */
import {
  BenchmarkRun,
  EvaluationReport,
  PromotionRecord,
  TechnologyCandidate,
  TechnologyProfile,
  TechnologyStatus,
} from "@sporta/contracts";
import type { LicenseReviewRecord } from "../license/license-registry";

/** The identity triple every registry record is keyed by. */
export interface TechnologyTriple {
  technologyId: string;
  technologyVersion: string;
  adapterVersion: string;
}

/** Canonical triple string (`id@version+adapter`). */
export function tripleKey(triple: TechnologyTriple): string {
  return `${triple.technologyId}@${triple.technologyVersion}+${triple.adapterVersion}`;
}

/**
 * Persistence port for the technology registry. All methods hand out deep
 * copies; stored documents are validated against their frozen zod schemas
 * on write and on read.
 */
export interface TechnologyRegistryStore {
  // ---- candidates -------------------------------------------------------
  /** Upsert a candidate by `candidateId` (the service owns duplicate logic). */
  putCandidate(candidate: TechnologyCandidate): void;
  getCandidateById(candidateId: string): TechnologyCandidate | null;
  /** The candidate registered for exactly this triple, or `null`. */
  findCandidateByTriple(triple: TechnologyTriple): TechnologyCandidate | null;
  /** Any candidate registered for this technology id + version, or `null`. */
  findCandidateByTechnology(
    technologyId: string,
    technologyVersion: string,
  ): TechnologyCandidate | null;

  // ---- profiles ---------------------------------------------------------
  /** The immutable recorded profile document for exactly this triple. */
  getRecordedProfile(triple: TechnologyTriple): TechnologyProfile | null;
  /** The current profile DOCUMENT (latest adapterVersion) for id+version. */
  getCurrentProfileDocument(
    technologyId: string,
    technologyVersion: string,
  ): TechnologyProfile | null;
  /**
   * Atomically upsert the profile document, point the (technologyId,
   * technologyVersion) current-pointer at it, and set the effective status to
   * the document's recorded status.
   */
  saveCurrentProfile(profile: TechnologyProfile): void;
  /** Current profile documents for every registered (id, version) unit. */
  listCurrentProfileDocuments(): TechnologyProfile[];
  /** The effective (promotion-driven) status, or `null` when unregistered. */
  getEffectiveStatus(technologyId: string, technologyVersion: string): TechnologyStatus | null;
  /** Overwrite the effective status (used only by the promotion pipeline). */
  setEffectiveStatus(
    technologyId: string,
    technologyVersion: string,
    status: TechnologyStatus,
  ): void;

  // ---- benchmark runs & evaluation reports ------------------------------
  putBenchmarkRun(run: BenchmarkRun): void;
  getBenchmarkRun(runId: string): BenchmarkRun | null;
  putEvaluationReport(report: EvaluationReport): void;
  getEvaluationReport(reportId: string): EvaluationReport | null;

  // ---- promotion records (append-only audit trail) -----------------------
  /** Insert a promotion record; throws on a duplicate `promotionId`. */
  putPromotionRecord(record: PromotionRecord): void;
  getPromotionRecord(promotionId: string): PromotionRecord | null;
  /** Full decision trail for a technology id, ordered (decidedAtMs, seq). */
  listPromotionRecords(technologyId: string): PromotionRecord[];

  // ---- license reviews ---------------------------------------------------
  /** Insert a license review; throws on a duplicate `reviewId`. */
  putLicenseReview(review: LicenseReviewRecord): void;
  getLicenseReview(reviewId: string): LicenseReviewRecord | null;
  /** All reviews for one technology version, ordered (reviewedAtMs, seq). */
  listLicenseReviews(technologyId: string, technologyVersion: string): LicenseReviewRecord[];
}

/** Ordered append entry used by the in-memory histories. */
interface Sequenced<T> {
  seq: number;
  value: T;
}

/**
 * Process-local {@link TechnologyRegistryStore}. Stores deep clones and
 * hands out deep clones; promotion/review histories keep an explicit append
 * sequence so ordering never depends on map iteration or wall-clock time.
 */
export class InMemoryTechnologyRegistryStore implements TechnologyRegistryStore {
  private readonly candidatesById = new Map<string, TechnologyCandidate>();
  private readonly candidateByTriple = new Map<string, TechnologyCandidate>();
  private readonly candidateByTechnology = new Map<string, TechnologyCandidate>();
  private readonly profilesByTriple = new Map<string, TechnologyProfile>();
  private readonly currentTripleByTechnology = new Map<string, string>();
  private readonly effectiveStatus = new Map<string, TechnologyStatus>();
  private readonly benchmarkRuns = new Map<string, BenchmarkRun>();
  private readonly evaluationReports = new Map<string, EvaluationReport>();
  private readonly promotions = new Map<string, PromotionRecord>();
  private readonly promotionHistoryByTechnology = new Map<
    string,
    Array<Sequenced<PromotionRecord>>
  >();
  private readonly licenseReviews = new Map<string, LicenseReviewRecord>();
  private readonly reviewsByTechnologyVersion = new Map<
    string,
    Array<Sequenced<LicenseReviewRecord>>
  >();
  private seq = 0;

  putCandidate(candidate: TechnologyCandidate): void {
    const doc = structuredClone(candidate);
    this.candidatesById.set(doc.candidateId, doc);
    this.candidateByTriple.set(tripleKey(doc), doc);
    this.candidateByTechnology.set(`${doc.technologyId}@${doc.technologyVersion}`, doc);
  }

  getCandidateById(candidateId: string): TechnologyCandidate | null {
    const stored = this.candidatesById.get(candidateId);
    return stored === undefined ? null : structuredClone(stored);
  }

  findCandidateByTriple(triple: TechnologyTriple): TechnologyCandidate | null {
    const stored = this.candidateByTriple.get(tripleKey(triple));
    return stored === undefined ? null : structuredClone(stored);
  }

  findCandidateByTechnology(
    technologyId: string,
    technologyVersion: string,
  ): TechnologyCandidate | null {
    const stored = this.candidateByTechnology.get(`${technologyId}@${technologyVersion}`);
    return stored === undefined ? null : structuredClone(stored);
  }

  getRecordedProfile(triple: TechnologyTriple): TechnologyProfile | null {
    const stored = this.profilesByTriple.get(tripleKey(triple));
    return stored === undefined ? null : structuredClone(stored);
  }

  getCurrentProfileDocument(
    technologyId: string,
    technologyVersion: string,
  ): TechnologyProfile | null {
    const key = `${technologyId}@${technologyVersion}`;
    const tripleStr = this.currentTripleByTechnology.get(key);
    if (tripleStr === undefined) return null;
    const stored = this.profilesByTriple.get(tripleStr);
    return stored === undefined ? null : structuredClone(stored);
  }

  saveCurrentProfile(profile: TechnologyProfile): void {
    const doc = structuredClone(profile);
    const techKey = `${doc.technologyId}@${doc.technologyVersion}`;
    const tripleStr = tripleKey(doc);
    this.profilesByTriple.set(tripleStr, doc);
    this.currentTripleByTechnology.set(techKey, tripleStr);
    this.effectiveStatus.set(techKey, doc.status);
  }

  listCurrentProfileDocuments(): TechnologyProfile[] {
    const out: TechnologyProfile[] = [];
    for (const tripleStr of this.currentTripleByTechnology.values()) {
      const stored = this.profilesByTriple.get(tripleStr);
      if (stored !== undefined) out.push(structuredClone(stored));
    }
    return out;
  }

  getEffectiveStatus(technologyId: string, technologyVersion: string): TechnologyStatus | null {
    return this.effectiveStatus.get(`${technologyId}@${technologyVersion}`) ?? null;
  }

  setEffectiveStatus(
    technologyId: string,
    technologyVersion: string,
    status: TechnologyStatus,
  ): void {
    this.effectiveStatus.set(`${technologyId}@${technologyVersion}`, status);
  }

  putBenchmarkRun(run: BenchmarkRun): void {
    this.benchmarkRuns.set(run.runId, structuredClone(run));
  }

  getBenchmarkRun(runId: string): BenchmarkRun | null {
    const stored = this.benchmarkRuns.get(runId);
    return stored === undefined ? null : structuredClone(stored);
  }

  putEvaluationReport(report: EvaluationReport): void {
    this.evaluationReports.set(report.reportId, structuredClone(report));
  }

  getEvaluationReport(reportId: string): EvaluationReport | null {
    const stored = this.evaluationReports.get(reportId);
    return stored === undefined ? null : structuredClone(stored);
  }

  putPromotionRecord(record: PromotionRecord): void {
    if (this.promotions.has(record.promotionId)) {
      throw new Error(`duplicate promotion id '${record.promotionId}'`);
    }
    const doc = structuredClone(record);
    this.promotions.set(doc.promotionId, doc);
    const history = this.promotionHistoryByTechnology.get(doc.technologyId) ?? [];
    history.push({ seq: ++this.seq, value: doc });
    this.promotionHistoryByTechnology.set(doc.technologyId, history);
  }

  getPromotionRecord(promotionId: string): PromotionRecord | null {
    const stored = this.promotions.get(promotionId);
    return stored === undefined ? null : structuredClone(stored);
  }

  listPromotionRecords(technologyId: string): PromotionRecord[] {
    const history = this.promotionHistoryByTechnology.get(technologyId) ?? [];
    return [...history]
      .sort((a, b) => a.value.decidedAtMs - b.value.decidedAtMs || a.seq - b.seq)
      .map((entry) => structuredClone(entry.value));
  }

  putLicenseReview(review: LicenseReviewRecord): void {
    if (this.licenseReviews.has(review.reviewId)) {
      throw new Error(`duplicate license review id '${review.reviewId}'`);
    }
    const doc = structuredClone(review);
    this.licenseReviews.set(doc.reviewId, doc);
    const key = `${doc.technologyId}@${doc.technologyVersion}`;
    const history = this.reviewsByTechnologyVersion.get(key) ?? [];
    history.push({ seq: ++this.seq, value: doc });
    this.reviewsByTechnologyVersion.set(key, history);
  }

  getLicenseReview(reviewId: string): LicenseReviewRecord | null {
    const stored = this.licenseReviews.get(reviewId);
    return stored === undefined ? null : structuredClone(stored);
  }

  listLicenseReviews(technologyId: string, technologyVersion: string): LicenseReviewRecord[] {
    const history =
      this.reviewsByTechnologyVersion.get(`${technologyId}@${technologyVersion}`) ?? [];
    return [...history]
      .sort((a, b) => a.value.reviewedAtMs - b.value.reviewedAtMs || a.seq - b.seq)
      .map((entry) => structuredClone(entry.value));
  }
}
