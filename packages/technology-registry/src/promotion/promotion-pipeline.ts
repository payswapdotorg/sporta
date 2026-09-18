/**
 * The promotion pipeline (R005): the audited decision trail for every
 * technology lifecycle transition.
 *
 * `promote(record)` is fail-closed on ALL of:
 *
 * 1. shape — the record passes the frozen `PromotionRecord` schema;
 * 2. state — the cited profile is the CURRENT profile of the lifecycle
 *    unit (same adapterVersion) and `fromStatus` matches the registry's
 *    effective status (no promoting from a stale snapshot);
 * 3. legality — `isLegalTechnologyTransition(from, to)` (the frozen
 *    lifecycle edges; `deprecated`/`rejected` are terminal);
 * 4. evidence — `missingPromotionEvidence(record)` is empty: at least one
 *    benchmark run id always, and a license review reference for any
 *    transition toward approved/canary/production;
 * 5. evidence EXISTENCE — the cited evaluation report is registered, every
 *    cited benchmark run is registered, shares the promoted technology's
 *    identity triple, is cited BY that report, and shares the report's
 *    fixture-set version (no evidence, no promotion — and no evidence
 *    laundering from another technology or fixture set);
 * 6. the R004 license gate — toward approved/canary/production,
 *    `blockingLicenseIssues(currentProfile)` must be EMPTY.
 *
 * On success the record is APPENDED (immutable; a duplicate promotionId
 * with identical content is an idempotent no-op) and the registry's
 * profile status reflects the last promotion. `promotionHistory` returns
 * the full decision trail for a technology id.
 */
import {
  PromotionRecord,
  blockingLicenseIssues,
  isLegalTechnologyTransition,
  missingPromotionEvidence,
} from "@sporta/contracts";
import type { PromotionRecord as PromotionRecordDoc } from "@sporta/contracts";
import {
  PromotionEvidenceError,
  PromotionLicenseError,
  PromotionTransitionError,
  RegistryConflictError,
  RegistryValidationError,
  TechnologyNotFoundError,
} from "../errors";
import { candidateKeyOf } from "../evaluation/report";
import type { TechnologyRegistry } from "../registry/technology-registry";

/** Transitions that must clear the R004 license gate. */
const LICENSE_GATED_TARGETS: ReadonlySet<string> = new Set(["approved", "canary", "production"]);

/**
 * The promotion pipeline over a {@link TechnologyRegistry}. All status
 * changes flow through here so production profile changes are auditable
 * (R005 acceptance).
 */
export class PromotionPipeline {
  constructor(private readonly registry: TechnologyRegistry) {}

  /**
   * Validate and append one lifecycle transition decision. See the module
   * docstring for the six fail-closed gates. Returns the stored record.
   */
  promote(record: PromotionRecordDoc): PromotionRecordDoc {
    const parsed = PromotionRecord.safeParse(record);
    if (!parsed.success) {
      throw new RegistryValidationError("promotion record failed schema validation", [
        ...parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
      ]);
    }
    const doc = parsed.data;

    // Idempotent append: the identical promotion is already recorded.
    const existing = this.registry.getPromotionRecord(doc.promotionId);
    if (existing !== null) {
      if (JSON.stringify(existing) === JSON.stringify(doc)) {
        return existing;
      }
      throw new RegistryConflictError(
        `promotion '${doc.promotionId}' is already recorded with different content`,
      );
    }

    // Gate 2: the promoted profile is the registry's current state.
    const current = this.registry.getProfile(doc.technologyId, doc.technologyVersion);
    if (current === null) {
      throw new TechnologyNotFoundError(
        `promotion '${doc.promotionId}': no profile registered for ` +
          `${doc.technologyId}@${doc.technologyVersion}`,
      );
    }
    if (current.adapterVersion !== doc.adapterVersion) {
      throw new PromotionTransitionError(
        `promotion '${doc.promotionId}': cites adapterVersion '${doc.adapterVersion}' but the ` +
          `current profile of ${doc.technologyId}@${doc.technologyVersion} is adapterVersion ` +
          `'${current.adapterVersion}' (stale evidence; promote the current adapter)`,
      );
    }
    if (current.task !== doc.task) {
      throw new PromotionTransitionError(
        `promotion '${doc.promotionId}': task '${doc.task}' does not match the registered ` +
          `profile task '${current.task}'`,
      );
    }
    if (current.status !== doc.fromStatus) {
      throw new PromotionTransitionError(
        `promotion '${doc.promotionId}': fromStatus '${doc.fromStatus}' does not match the ` +
          `registry's effective status '${current.status}' for ` +
          `${doc.technologyId}@${doc.technologyVersion} (stale snapshot)`,
      );
    }

    // Gate 3: legality.
    if (!isLegalTechnologyTransition(doc.fromStatus, doc.toStatus)) {
      throw new PromotionTransitionError(
        `promotion '${doc.promotionId}': illegal lifecycle transition ` +
          `${doc.fromStatus} -> ${doc.toStatus}`,
      );
    }

    // Gate 4: evidence requirements per transition.
    const missing = missingPromotionEvidence(doc);
    if (missing.length > 0) {
      throw new PromotionEvidenceError(
        `promotion '${doc.promotionId}': missing evidence: ${missing.join("; ")}`,
        missing,
      );
    }

    // Gate 5: the cited evidence exists and belongs to this technology.
    const report = this.registry.getEvaluationReport(doc.evidence.evaluationReportId);
    if (report === null) {
      throw new PromotionEvidenceError(
        `promotion '${doc.promotionId}': cited evaluation report ` +
          `'${doc.evidence.evaluationReportId}' is not registered`,
      );
    }
    const issues: string[] = [];
    for (const runId of doc.evidence.benchmarkRunIds) {
      const run = this.registry.getBenchmarkRun(runId);
      if (run === null) {
        issues.push(`cited benchmark run '${runId}' is not registered`);
        continue;
      }
      const runKey = candidateKeyOf(run);
      if (
        run.technologyId !== doc.technologyId ||
        run.technologyVersion !== doc.technologyVersion ||
        run.adapterVersion !== doc.adapterVersion
      ) {
        issues.push(
          `cited run '${runId}' belongs to ${runKey} but the promotion is for ` +
            `${candidateKeyOf(doc)}`,
        );
      }
      if (!report.benchmarkRunIds.includes(runId)) {
        issues.push(`cited run '${runId}' is not cited by evaluation report '${report.reportId}'`);
      }
      if (run.fixtureSetVersion !== report.fixtureSetVersion) {
        issues.push(
          `cited run '${runId}' uses fixture set '${run.fixtureSetVersion}' but its report ` +
            `declares '${report.fixtureSetVersion}'`,
        );
      }
    }
    if (issues.length > 0) {
      throw new PromotionEvidenceError(
        `promotion '${doc.promotionId}': incoherent evidence chain: ${issues.join("; ")}`,
        issues,
      );
    }

    // Gate 6: the R004 fail-closed license gate.
    if (LICENSE_GATED_TARGETS.has(doc.toStatus)) {
      const licenseIssues = blockingLicenseIssues(current);
      if (licenseIssues.length > 0) {
        throw new PromotionLicenseError(
          `promotion '${doc.promotionId}' refused by the license gate: unresolved or ` +
            `non-affirmed license components on ` +
            `${doc.technologyId}@${doc.technologyVersion}`,
          licenseIssues,
        );
      }
    }

    this.registry.appendPromotionRecord(doc);
    this.registry.applyPromotionStatus(doc.technologyId, doc.technologyVersion, doc.toStatus);
    return structuredClone(doc);
  }

  /** The full decision trail for a technology id, ordered (decidedAtMs, seq). */
  promotionHistory(technologyId: string): PromotionRecordDoc[] {
    return this.registry.listPromotionRecords(technologyId);
  }
}
