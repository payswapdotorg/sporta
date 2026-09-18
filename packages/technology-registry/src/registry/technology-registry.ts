/**
 * The Technology Registry service (R001).
 *
 * The single entry lane every replaceable implementation technology passes
 * through (ADR-009): register a candidate, record its versioned profile,
 * then let the evaluation/promotion machinery (R003-R005) move it through
 * the lifecycle. Product/domain code NEVER refers to a technology name —
 * it refers to a logical task profile resolved through
 * {@link TechnologyRegistry.resolveTaskProfile}.
 *
 * Lifecycle model (docs/architecture/technology-plane.md):
 *
 * - `technologyId @ technologyVersion` is the lifecycle unit; its CURRENT
 *   profile is the latest recorded `adapterVersion` (profiles are immutable
 *   documents — a content change is a NEW adapterVersion, never an edit).
 * - The EFFECTIVE status of the unit starts at the recorded profile's
 *   status and is advanced by the promotion pipeline (R005). `getProfile`
 *   and `listProfiles` return the effective-status view; the immutable
 *   recorded documents remain available via `getRecordedProfile`.
 * - `recordProfile` rules (fail-closed):
 *   1. the document must pass the frozen zod schema (which enforces the
 *      closed AdapterTaskKind taxonomy);
 *   2. a candidate must have been registered for the technology id+version
 *      with a matching task ("every profile starts here" — the frozen
 *      TechnologyCandidate docstring);
 *   3. the FIRST profile of a unit must enter as `candidate`;
 *   4. a subsequent profile with the SAME status is a REVISION (new
 *      adapterVersion, e.g. updated license verdicts);
 *   5. a subsequent profile with a DIFFERENT status must be a legal
 *      lifecycle edge per `isLegalTechnologyTransition` — anything else is
 *      refused. (The audited promotion path is R005's pipeline; this guard
 *      is the registry's own legality check.)
 *   6. re-recording the identical triple is an idempotent no-op;
 *      re-recording a triple with different content is refused
 *      (immutability).
 *
 * Benchmark runs and evaluation reports are also registered here (the
 * promotion pipeline validates its evidence against this registry), with
 * the same fail-closed discipline: a run must belong to a recorded
 * profile, a report's cited runs must exist and share its fixture-set
 * version.
 */
import {
  AdapterTaskKind,
  BenchmarkRun,
  EvaluationReport,
  PromotionRecord,
  TechnologyCandidate,
  TechnologyProfile,
  TechnologyStatus,
  isLegalTechnologyTransition,
} from "@sporta/contracts";
import { z } from "zod";
import type {
  AdapterTaskKind as AdapterTaskKindType,
  BenchmarkRun as BenchmarkRunDoc,
  EvaluationReport as EvaluationReportDoc,
  PromotionRecord as PromotionRecordDoc,
  TechnologyCandidate as TechnologyCandidateDoc,
  TechnologyProfile as TechnologyProfileDoc,
} from "@sporta/contracts";
import {
  EvaluationValidationError,
  IllegalProfileStatusError,
  RegistryConflictError,
  RegistryValidationError,
  TechnologyNotFoundError,
} from "../errors";
import {
  resolveTaskProfileAgainst,
  type TaskProfileRef,
  type TaskProfileResolution,
} from "./resolution";
import type { TechnologyRegistryStore, TechnologyTriple } from "../store/store";
import { candidateKeyOf } from "../evaluation/report";

/** Filter for `listProfiles`. */
export interface ProfileFilter {
  task?: AdapterTaskKindType;
  status?: TechnologyStatus;
}

/** The result of an idempotent registration (`created: false` = no-op). */
export interface RegistrationResult<T> {
  record: T;
  created: boolean;
}

function zodIssues(error: {
  issues: Array<{ path: Array<string | number | symbol>; message: string }>;
}): string[] {
  return error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
}

/**
 * The Technology Registry service over a {@link TechnologyRegistryStore}
 * (in-memory or SQLite).
 */
export class TechnologyRegistry {
  constructor(private readonly store: TechnologyRegistryStore) {}

  // ---- candidates (R001) ---------------------------------------------------

  /**
   * Register a new technology candidate: validates the frozen
   * `TechnologyCandidate` document and stores it. Registering the same
   * identity triple (technologyId+technologyVersion+adapterVersion) again
   * is an IDEMPOTENT no-op when the document is identical, and a conflict
   * when the same triple or candidateId arrives with different content.
   */
  registerCandidate(candidate: TechnologyCandidateDoc): RegistrationResult<TechnologyCandidateDoc> {
    const parsed = TechnologyCandidate.safeParse(candidate);
    if (!parsed.success) {
      throw new RegistryValidationError("technology candidate failed schema validation", [
        ...zodIssues(parsed.error),
      ]);
    }
    const doc = parsed.data;

    const byId = this.store.getCandidateById(doc.candidateId);
    if (byId !== null) {
      if (deepEqual(byId, doc)) {
        return { record: byId, created: false };
      }
      throw new RegistryConflictError(
        `candidateId '${doc.candidateId}' is already registered with different content`,
      );
    }
    const byTriple = this.store.findCandidateByTriple(doc);
    if (byTriple !== null) {
      if (deepEqual(byTriple, doc)) {
        return { record: byTriple, created: false };
      }
      throw new RegistryConflictError(
        `technology ${doc.technologyId}@${doc.technologyVersion}+${doc.adapterVersion} ` +
          `is already registered as candidate '${byTriple.candidateId}'`,
      );
    }
    this.store.putCandidate(doc);
    return { record: structuredClone(doc), created: true };
  }

  getCandidate(candidateId: string): TechnologyCandidateDoc | null {
    return this.store.getCandidateById(candidateId);
  }

  // ---- profiles (R001) -------------------------------------------------------

  /**
   * Record a versioned technology profile. See the module docstring for the
   * fail-closed lifecycle rules; refusals throw
   * {@link RegistryValidationError} (schema/taxonomy),
   * {@link IllegalProfileStatusError} (lifecycle), or
   * {@link RegistryConflictError} (immutability).
   *
   * Returns the effective-status view of the recorded profile.
   */
  recordProfile(profile: TechnologyProfileDoc): RegistrationResult<TechnologyProfileDoc> {
    const parsed = TechnologyProfile.safeParse(profile);
    if (!parsed.success) {
      throw new RegistryValidationError("technology profile failed schema validation", [
        ...zodIssues(parsed.error),
      ]);
    }
    const doc = parsed.data;

    // Immutability + idempotency on the exact triple.
    const existing = this.store.getRecordedProfile(doc);
    if (existing !== null) {
      if (deepEqual(existing, doc)) {
        return { record: this.effectiveView(existing), created: false };
      }
      throw new RegistryConflictError(
        `profile ${doc.technologyId}@${doc.technologyVersion}+${doc.adapterVersion} ` +
          `is already recorded with different content; profiles are immutable — record a new adapterVersion`,
      );
    }

    // A candidate registration must precede the first profile (the frozen
    // TechnologyCandidate docstring: "Every profile starts here").
    const candidate = this.store.findCandidateByTechnology(doc.technologyId, doc.technologyVersion);
    if (candidate === null) {
      throw new TechnologyNotFoundError(
        `no candidate registered for ${doc.technologyId}@${doc.technologyVersion}; ` +
          `call registerCandidate first`,
      );
    }
    if (candidate.task !== doc.task) {
      throw new RegistryValidationError(
        `profile task '${doc.task}' does not match the registered candidate task '${candidate.task}' ` +
          `for ${doc.technologyId}@${doc.technologyVersion}`,
      );
    }

    const current = this.store.getCurrentProfileDocument(doc.technologyId, doc.technologyVersion);

    if (current === null) {
      // First profile of the lifecycle unit: it enters as a candidate.
      if (doc.status !== "candidate") {
        throw new IllegalProfileStatusError(
          `the first profile of ${doc.technologyId}@${doc.technologyVersion} must enter as ` +
            `'candidate' (got '${doc.status}'); use the promotion pipeline to advance`,
        );
      }
    } else {
      // saveCurrentProfile always stamps the effective status alongside the
      // document, so a current document implies an effective status.
      const currentEffective =
        this.store.getEffectiveStatus(doc.technologyId, doc.technologyVersion) ?? current.status;
      if (current.task !== doc.task) {
        throw new RegistryValidationError(
          `profile task '${doc.task}' does not match the current profile task '${current.task}' ` +
            `for ${doc.technologyId}@${doc.technologyVersion}`,
        );
      }
      if (doc.status !== currentEffective) {
        // A status change via recordProfile must be a legal lifecycle edge.
        if (!isLegalTechnologyTransition(currentEffective, doc.status)) {
          throw new IllegalProfileStatusError(
            `illegal status transition ${currentEffective} -> ${doc.status} for ` +
              `${doc.technologyId}@${doc.technologyVersion} (same-status revisions record a new ` +
              `adapterVersion; status changes must follow the frozen lifecycle edges)`,
          );
        }
      }
    }

    this.store.saveCurrentProfile(doc);
    return { record: this.effectiveView(doc), created: true };
  }

  /**
   * The CURRENT profile of a lifecycle unit with its EFFECTIVE status
   * (reflecting the last promotion), or `null` when unregistered.
   */
  getProfile(technologyId: string, technologyVersion: string): TechnologyProfileDoc | null {
    const doc = this.store.getCurrentProfileDocument(technologyId, technologyVersion);
    return doc === null ? null : this.effectiveView(doc);
  }

  /** The immutable RECORDED document for an exact triple (audit access). */
  getRecordedProfile(triple: TechnologyTriple): TechnologyProfileDoc | null {
    return this.store.getRecordedProfile(triple);
  }

  /** Current profiles (effective status view), optionally filtered. */
  listProfiles(filter?: ProfileFilter): TechnologyProfileDoc[] {
    return this.store
      .listCurrentProfileDocuments()
      .map((doc) => this.effectiveView(doc))
      .filter(
        (profile) =>
          (filter?.task === undefined || profile.task === filter.task) &&
          (filter?.status === undefined || profile.status === filter.status),
      )
      .sort(
        (a, b) =>
          a.technologyId.localeCompare(b.technologyId) ||
          a.technologyVersion.localeCompare(b.technologyVersion),
      );
  }

  // ---- resolution seam (R001) ------------------------------------------------

  /**
   * Resolve a LOGICAL task profile to a concrete registered technology
   * (the seam later waves call at runtime). See `resolution.ts` for the
   * deterministic ordering rules.
   */
  resolveTaskProfile(ref: TaskProfileRef): TaskProfileResolution {
    const refParsed = TaskProfileRefShape.safeParse(ref);
    if (!refParsed.success) {
      throw new RegistryValidationError("task profile reference failed validation", [
        ...zodIssues(refParsed.error),
      ]);
    }
    const profiles = this.store.listCurrentProfileDocuments().map((doc) => this.effectiveView(doc));
    return resolveTaskProfileAgainst(refParsed.data, profiles);
  }

  // ---- benchmark runs & evaluation reports (registry-held evidence) ---------

  /**
   * Register a benchmark run. Fail-closed: the run must pass the frozen
   * schema AND belong to a RECORDED profile triple (no benchmarks for
   * unregistered technologies). Same runId with identical content is an
   * idempotent no-op; different content is a conflict.
   */
  recordBenchmarkRun(run: BenchmarkRunDoc): RegistrationResult<BenchmarkRunDoc> {
    const parsed = BenchmarkRun.safeParse(run);
    if (!parsed.success) {
      throw new RegistryValidationError("benchmark run failed schema validation", [
        ...zodIssues(parsed.error),
      ]);
    }
    const doc = parsed.data;

    const existing = this.store.getBenchmarkRun(doc.runId);
    if (existing !== null) {
      if (deepEqual(existing, doc)) {
        return { record: existing, created: false };
      }
      throw new RegistryConflictError(
        `benchmark run '${doc.runId}' is already registered with different content`,
      );
    }

    const recorded = this.store.getRecordedProfile(doc);
    if (recorded === null) {
      throw new TechnologyNotFoundError(
        `benchmark run '${doc.runId}' cites unregistered profile ` +
          `${doc.technologyId}@${doc.technologyVersion}+${doc.adapterVersion}`,
      );
    }
    if (recorded.task !== doc.task) {
      throw new RegistryValidationError(
        `benchmark run task '${doc.task}' does not match the recorded profile task '${recorded.task}'`,
      );
    }

    this.store.putBenchmarkRun(doc);
    return { record: structuredClone(doc), created: true };
  }

  getBenchmarkRun(runId: string): BenchmarkRunDoc | null {
    return this.store.getBenchmarkRun(runId);
  }

  /**
   * Register an evaluation report. Fail-closed coherence gate: every cited
   * benchmark run must exist, share the report's fixture-set version, and
   * the recommendation/candidate pairing must be coherent (promote ⇔ a
   * recommended candidate that matches one of the cited runs).
   */
  recordEvaluationReport(report: EvaluationReportDoc): RegistrationResult<EvaluationReportDoc> {
    const parsed = EvaluationReport.safeParse(report);
    if (!parsed.success) {
      throw new RegistryValidationError("evaluation report failed schema validation", [
        ...zodIssues(parsed.error),
      ]);
    }
    const doc = parsed.data;

    const existing = this.store.getEvaluationReport(doc.reportId);
    if (existing !== null) {
      if (deepEqual(existing, doc)) {
        return { record: existing, created: false };
      }
      throw new RegistryConflictError(
        `evaluation report '${doc.reportId}' is already registered with different content`,
      );
    }

    const issues: string[] = [];
    const runKeys = new Set<string>();
    for (const runId of doc.benchmarkRunIds) {
      const run = this.store.getBenchmarkRun(runId);
      if (run === null) {
        issues.push(`cited benchmark run '${runId}' is not registered`);
        continue;
      }
      if (run.fixtureSetVersion !== doc.fixtureSetVersion) {
        issues.push(
          `cited run '${runId}' uses fixture set '${run.fixtureSetVersion}' but the report ` +
            `declares '${doc.fixtureSetVersion}'`,
        );
      }
      runKeys.add(candidateKeyOf(run));
    }
    if (doc.recommendation === "promote" && doc.recommendedCandidate === undefined) {
      issues.push("a 'promote' recommendation must name its recommendedCandidate");
    }
    if (doc.recommendation !== "promote" && doc.recommendedCandidate !== undefined) {
      issues.push(
        `recommendedCandidate is only meaningful for a 'promote' recommendation ` +
          `(got '${doc.recommendation}')`,
      );
    }
    if (doc.recommendedCandidate !== undefined && !runKeys.has(doc.recommendedCandidate)) {
      issues.push(
        `recommendedCandidate '${doc.recommendedCandidate}' does not match any cited run`,
      );
    }
    if (issues.length > 0) {
      throw new EvaluationValidationError(
        `evaluation report '${doc.reportId}' is incoherent: ${issues.join("; ")}`,
        issues,
      );
    }

    this.store.putEvaluationReport(doc);
    return { record: structuredClone(doc), created: true };
  }

  getEvaluationReport(reportId: string): EvaluationReportDoc | null {
    return this.store.getEvaluationReport(reportId);
  }

  // ---- promotion audit trail (used by the R005 pipeline) ---------------------

  /** Fetch one promotion record, or `null`. */
  getPromotionRecord(promotionId: string): PromotionRecordDoc | null {
    return this.store.getPromotionRecord(promotionId);
  }

  /**
   * Append an immutable promotion record. Duplicate `promotionId` with
   * identical content is an idempotent no-op; different content is a
   * conflict. Called by the promotion pipeline AFTER its gates pass.
   */
  appendPromotionRecord(record: PromotionRecordDoc): RegistrationResult<PromotionRecordDoc> {
    const parsed = PromotionRecord.safeParse(record);
    if (!parsed.success) {
      throw new RegistryValidationError("promotion record failed schema validation", [
        ...zodIssues(parsed.error),
      ]);
    }
    const doc = parsed.data;
    const existing = this.store.getPromotionRecord(doc.promotionId);
    if (existing !== null) {
      if (deepEqual(existing, doc)) {
        return { record: existing, created: false };
      }
      throw new RegistryConflictError(
        `promotion '${doc.promotionId}' is already recorded with different content`,
      );
    }
    this.store.putPromotionRecord(doc);
    return { record: structuredClone(doc), created: true };
  }

  /** The full promotion decision trail for a technology id. */
  listPromotionRecords(technologyId: string): PromotionRecordDoc[] {
    return this.store.listPromotionRecords(technologyId);
  }

  /**
   * Apply a promotion's target status to the lifecycle unit (the registry's
   * profile status reflects the last promotion). Called by the promotion
   * pipeline after appending the record.
   */
  applyPromotionStatus(
    technologyId: string,
    technologyVersion: string,
    status: TechnologyStatus,
  ): void {
    if (this.store.getCurrentProfileDocument(technologyId, technologyVersion) === null) {
      throw new TechnologyNotFoundError(
        `cannot apply status '${status}': no profile registered for ` +
          `${technologyId}@${technologyVersion}`,
      );
    }
    this.store.setEffectiveStatus(technologyId, technologyVersion, status);
  }

  // ---- internals -------------------------------------------------------------

  /** The effective-status view of a recorded profile document. */
  private effectiveView(doc: TechnologyProfileDoc): TechnologyProfileDoc {
    const effective = this.store.getEffectiveStatus(doc.technologyId, doc.technologyVersion);
    return effective === null || effective === doc.status ? doc : { ...doc, status: effective };
  }
}

/** Runtime shape of {@link TaskProfileRef} (the task enum is the frozen one). */
const TaskProfileRefShape = z.object({
  task: AdapterTaskKind,
  prefer: z.array(z.string().min(1)).optional(),
  fallback: z.array(z.string().min(1)).optional(),
});

/** Structural deep equality over JSON-safe contract documents. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, index) => deepEqual(item, b[index]));
  }
  const aKeys = Object.keys(a as Record<string, unknown>);
  const bKeys = Object.keys(b as Record<string, unknown>);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every(
    (key) =>
      Object.prototype.hasOwnProperty.call(b, key) &&
      deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
  );
}
