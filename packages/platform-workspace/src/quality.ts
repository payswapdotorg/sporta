/**
 * The organization-declared quality gate (REL-024) — the output gate that
 * rides the ORGANIZATION'S DECLARED QUALITY POLICY.
 *
 * "the output passes the organization's declared quality policy (typed
 * refusals on failure, never silent passes)" — the registry contract's
 * "expected quality metrics" + "uncertainty" on the organization record ARE
 * that declared policy: the axes the organization promises, the values it
 * measured, and the confidence interval around each. This gate composes two
 * legs over the imported `PlatformQualityGate` port:
 *
 * 1. THE OUTPUT LEG (delegated, imported): the external-platform's own
 *    checksum gate — output non-empty, per-source lineage complete, no data
 *    loss. Real byte checks, never re-implemented here.
 * 2. THE DECLARED-POLICY LEG (this module): checks derived from the
 *    selected organization's record AT EXECUTION TIME (the registry is the
 *    authority; the record is read through the port, not snapshotted):
 *    - `declared-quality-present` — benchmark evidence with at least one
 *      axis exists (an organization without declared quality is a typed
 *      refusal, never a silent pass);
 *    - `declared-quality-consistent` — every declared axis carries an
 *      uncertainty interval that CONTAINS its value within [0, 10]
 *      (a self-inconsistent declaration — a lying interval — refuses);
 *    - `declared-quality-floor` — every declared axis's conservative lower
 *      bound (ciLow) clears the workspace's configured floor (default 0:
 *      the organization's own declaration is the policy; a workspace that
 *      wants a bar DECLARES one).
 *
 * On failure the job FAILS (the executor's fail-closed law): the failed
 * check names are carried in the job failure, the evidence bundle is never
 * published, and `getOutput` refuses typed. A REAL perceptual evaluator
 * (REL-A3's quality metrics) plugs in behind the same port — this gate is
 * the composition seam, not a re-implementation of quality evaluation.
 */
import type { OrganizationRegistry } from "@sporta/organization-registry";
import { createChecksumQualityGate } from "@sporta/external-platform";
import type { PlatformQualityGate, QualityGateResult } from "@sporta/external-platform";

/** The declared-quality gate's identity (recorded in every evidence bundle). */
export const DECLARED_QUALITY_GATE_ID = "organization-declared-quality/v1" as const;

/** Everything the declared-quality gate needs. */
export interface DeclaredQualityGateOptions {
  /** The organization registry — the record authority read at gate time. */
  readonly registry: OrganizationRegistry;
  /**
   * The workspace's declared quality floor: every declared axis's ciLow must
   * clear it. Default 0 — presence + self-consistency enforced; the
   * organization's own declaration is then the policy. A workspace that
   * wants a bar declares one (the floor is workspace configuration, never a
   * hidden constant per call site).
   */
  readonly qualityFloor?: number;
  /**
   * The output-leg gate (default: the external-platform's checksum gate —
   * non-empty, lineage-complete, no-data-loss — imported, not re-implemented).
   */
  readonly base?: PlatformQualityGate;
}

/** One declared axis with its uncertainty interval joined (registry record). */
interface DeclaredAxis {
  readonly axis: string;
  readonly value: number;
  readonly ciLow: number | null;
  readonly ciHigh: number | null;
}

/** Joins the record's metrics + uncertainty by axis (absent interval = null). */
function declaredAxesOf(
  metrics: readonly { axis: string; value: number }[],
  uncertainty: readonly {
    axis: string;
    ciLow: number;
    ciHigh: number;
  }[],
): DeclaredAxis[] {
  const intervals = new Map(uncertainty.map((u) => [u.axis, u]));
  return metrics.map((metric) => {
    const interval = intervals.get(metric.axis);
    return {
      axis: metric.axis,
      value: metric.value,
      ciLow: interval === undefined ? null : interval.ciLow,
      ciHigh: interval === undefined ? null : interval.ciHigh,
    };
  });
}

/**
 * Creates the organization-declared quality gate: the imported output-leg
 * checks + the declared-policy leg read from the organization record at
 * execution time. Fails closed on EVERY policy violation — typed check
 * names, honest details, never a silent pass.
 */
export function createOrganizationQualityGate(
  options: DeclaredQualityGateOptions,
): PlatformQualityGate {
  const floor = options.qualityFloor ?? 0;
  const base = options.base ?? createChecksumQualityGate();

  return {
    gateId: DECLARED_QUALITY_GATE_ID,
    async evaluate(input): Promise<QualityGateResult> {
      // 1. The output leg — the imported checks, verbatim.
      const baseResult = await base.evaluate(input);
      const checks = [...baseResult.checks];

      // 2. The declared-policy leg — the organization record at gate time.
      if (input.organizationId === null) {
        checks.push({
          name: "declared-quality-present",
          passed: false,
          detail:
            "no organization was selected for this output — the declared-quality gate " +
            "requires an organization whose declared policy can be evaluated",
        });
        return {
          gateId: DECLARED_QUALITY_GATE_ID,
          passed: false,
          checks,
        };
      }
      const record = await options.registry.get(input.organizationId); // typed not-found
      const benchmark = record.evidence.benchmark;

      if (benchmark === undefined || benchmark.metrics.length === 0) {
        checks.push({
          name: "declared-quality-present",
          passed: false,
          detail:
            `organization '${record.organizationId}' (v${record.version}, status ` +
            `${record.status}) declares NO benchmark evidence — an output cannot pass a ` +
            `quality policy that was never declared (typed refusal, never a silent pass)`,
        });
        return {
          gateId: DECLARED_QUALITY_GATE_ID,
          passed: false,
          checks,
        };
      }
      checks.push({
        name: "declared-quality-present",
        passed: true,
        detail:
          `organization '${record.organizationId}' (v${record.version}, status ` +
          `${record.status}) declares ${benchmark.metrics.length} benchmark axis(es) on ` +
          `corpus ${benchmark.corpusVersion} (evaluator ${benchmark.evaluatorVersion})`,
      });

      const axes = declaredAxesOf(benchmark.metrics, benchmark.uncertainty);
      const inconsistent = axes.filter(
        (axis) =>
          axis.ciLow === null ||
          axis.ciHigh === null ||
          !(axis.ciLow <= axis.value && axis.value <= axis.ciHigh) ||
          !(0 <= axis.ciLow && axis.ciHigh <= 10),
      );
      checks.push({
        name: "declared-quality-consistent",
        passed: inconsistent.length === 0,
        detail:
          inconsistent.length === 0
            ? axes
                .map((axis) => `${axis.axis}=${axis.value} [${axis.ciLow}, ${axis.ciHigh}]`)
                .join(", ")
            : `self-inconsistent declared quality: ${inconsistent
                .map(
                  (axis) =>
                    `${axis.axis}=${axis.value} with interval [${
                      axis.ciLow ?? "absent"
                    }, ${axis.ciHigh ?? "absent"}] (the declared interval must contain the value within [0, 10])`,
                )
                .join("; ")}`,
      });

      const belowFloor = axes.filter((axis) => axis.ciLow !== null && axis.ciLow < floor);
      checks.push({
        name: "declared-quality-floor",
        passed: belowFloor.length === 0,
        detail:
          belowFloor.length === 0
            ? `every declared axis clears the floor ${floor} (conservative ciLow bound)`
            : `declared quality below the workspace floor ${floor}: ${belowFloor
                .map((axis) => `${axis.axis} ciLow=${axis.ciLow}`)
                .join("; ")} — the organization's declared policy does not clear the bar`,
      });

      return {
        gateId: DECLARED_QUALITY_GATE_ID,
        passed: checks.every((check) => check.passed),
        checks,
      };
    },
  };
}
