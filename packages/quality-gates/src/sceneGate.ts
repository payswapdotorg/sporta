/**
 * The scene-correctness gate — gate row 2 of the W803 release suite.
 *
 * This gate RUNS the real W605 evaluation: `evaluateSceneOutput` from
 * `@sporta/scene-evaluation` over the caller-supplied fixture cases, and
 * the gate verdict is the strict conjunction of the fixture reports' own
 * verdicts. The names of the demo fixture set (`clean-match`,
 * `corrections-match`, `directed-review`) are the source package's own
 * fixture names (its README's fixture table); this package adds no fixture
 * of its own.
 *
 * Zero new thresholds: every W605 threshold is ZERO in the source
 * package's pinned `THRESHOLDS` / `THRESHOLDS.md` and stays there; the
 * gate rows carry each report's full check list VERBATIM so the thresholds
 * travel with the evidence (docs/GATES.md §carried-evidence).
 *
 * Never-silent accounting: every supplied fixture is either evaluated (its
 * evidence carried verbatim) or errored (the typed error carried verbatim,
 * named by index and case name) — a fixture that could not be evaluated
 * makes the whole gate `NOT-RUNNABLE` (counted FAIL), never a skip, and
 * the successfully evaluated fixtures are still carried as partial
 * evidence.
 */
import { evaluateSceneOutput } from "@sporta/scene-evaluation";
import type {
  SceneEvaluationCheck,
  SceneEvaluationInput,
  SceneEvaluationReport,
} from "@sporta/scene-evaluation";
import type { AccountedError, GateRowBase } from "./gateRow";
import { describeThrownError } from "./gateRow";
import { policyEntryOf } from "./gatePolicy";

/** One scene fixture case: a caller-supplied name + the real evaluation input. */
export interface SceneFixtureCase {
  /** A bounded, non-empty label (the source package's own fixture names for the demo set). */
  readonly name: string;
  /** The input `evaluateSceneOutput` measures. Its validation is the source package's fail-loud domain. */
  readonly input: SceneEvaluationInput;
}

/** One fixture's carried evidence, verbatim from its report. */
export interface SceneFixtureEvidence {
  readonly name: string;
  /** The report's own verdict for this fixture. */
  readonly pass: boolean;
  readonly schemaTag: string;
  /** The report's input descriptor, verbatim. */
  readonly input: SceneEvaluationReport["input"];
  /** Every check across all dimensions, verbatim. */
  readonly checks: readonly SceneEvaluationCheck[];
  /** The failing checks, verbatim (empty when the fixture passes). */
  readonly failures: readonly SceneEvaluationCheck[];
  /** The findings accounting, verbatim (the evidence list itself stays in the source report). */
  readonly findings: {
    readonly recorded: number;
    readonly dropped: number;
    readonly cap: number;
    readonly truncated: boolean;
  };
}

/** One fixture that could not be evaluated. */
export interface SceneFixtureError {
  readonly index: number;
  readonly name: string;
  readonly error: AccountedError;
}

/** The carried evidence when every fixture evaluated. */
export interface SceneGateEvidence {
  readonly ran: true;
  readonly fixtures: readonly SceneFixtureEvidence[];
}

/** The accounted evidence when any fixture could not be evaluated. */
export interface SceneGateNotRun {
  readonly ran: false;
  /** How many fixture cases were supplied. */
  readonly suppliedFixtureCount: number;
  /** The fixtures that DID evaluate (partial evidence, never dropped). */
  readonly evaluated: readonly SceneFixtureEvidence[];
  /** The fixtures that errored (each with its typed error, verbatim). */
  readonly errors: readonly SceneFixtureError[];
}

export type SceneGateMeasured = SceneGateEvidence | SceneGateNotRun;

/** The scene-correctness gate row. */
export interface SceneGateRow extends GateRowBase {
  readonly gateId: "scene-correctness";
  readonly measured: SceneGateMeasured;
}

/** Runs the scene-correctness gate over the supplied fixture cases. Pure; never throws. */
export function runSceneGate(seam: readonly SceneFixtureCase[] | undefined): SceneGateRow {
  const policy = policyEntryOf("scene-correctness");
  const cases = seam ?? [];
  if (cases.length === 0) {
    return {
      ...policy,
      gateId: "scene-correctness",
      verdict: "NOT-RUNNABLE",
      reason:
        "no scene fixture case supplied — the scene-correctness gate cannot run (counted FAIL: docs/GATES.md §verdicts)",
      measured: {
        ran: false,
        suppliedFixtureCount: 0,
        evaluated: [],
        errors: [
          {
            index: -1,
            name: "<none-supplied>",
            error: {
              name: "QualityGatesError",
              code: "gate-input-missing",
              message: "no scene fixture case supplied",
            },
          },
        ],
      },
    };
  }

  const evaluated: SceneFixtureEvidence[] = [];
  const errors: SceneFixtureError[] = [];
  cases.forEach((fixtureCase, index) => {
    try {
      const report = evaluateSceneOutput(fixtureCase.input);
      evaluated.push({
        name: fixtureCase.name,
        pass: report.verdict.pass,
        schemaTag: report.schemaTag,
        input: { ...report.input },
        checks: [...report.verdict.checks],
        failures: [...report.verdict.failures],
        findings: {
          recorded: report.findings.entries.length,
          dropped: report.findings.dropped,
          cap: report.findings.cap,
          truncated: report.findings.truncated,
        },
      });
    } catch (error) {
      errors.push({ index, name: fixtureCase.name, error: describeThrownError(error) });
    }
  });

  if (errors.length > 0) {
    const accounted = errors
      .map(
        (failure) =>
          `fixture[${failure.index}] "${failure.name}": ` +
          `${failure.error.name}${failure.error.code === undefined ? "" : ` (${failure.error.code})`}: ${failure.error.message}`,
      )
      .join("; ");
    return {
      ...policy,
      gateId: "scene-correctness",
      verdict: "NOT-RUNNABLE",
      reason:
        `${errors.length} of ${cases.length} scene fixture case(s) could not be evaluated — ` +
        `${accounted} — counted FAIL, never skipped`,
      measured: {
        ran: false,
        suppliedFixtureCount: cases.length,
        evaluated,
        errors,
      },
    };
  }

  const failing = evaluated.filter((fixture) => !fixture.pass);
  return {
    ...policy,
    gateId: "scene-correctness",
    verdict: failing.length === 0 ? "PASS" : "FAIL",
    reason:
      failing.length === 0
        ? `evaluateSceneOutput over ${evaluated.length} fixture case(s): every fixture's own verdict is PASS ` +
          "(thresholds referenced from packages/scene-evaluation/THRESHOLDS.md)"
        : `evaluateSceneOutput over ${evaluated.length} fixture case(s): ${failing.length} failing — ` +
          failing
            .map(
              (fixture) =>
                `"${fixture.name}" (${fixture.failures.length} failing check(s): ` +
                fixture.failures.map((failure) => failure.metric).join(", ") +
                ")",
            )
            .join("; "),
    measured: { ran: true, fixtures: evaluated },
  };
}
