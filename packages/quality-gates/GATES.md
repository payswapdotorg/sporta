# @sporta/quality-gates — GATES.md

The normative gate-policy document for W803 "Visual quality gates".
Acceptance (verbatim from `docs/work-items/work-items.md`): *"release gates
include temporal stability, scene correctness, and human/automated quality
checks."*

This document is the DATA mirror of `src/gatePolicy.ts` (the gate table,
§gates), `src/bounds.ts` (§structural-bounds), and the verdict semantics of
`src/report.ts` (§verdicts). `test/policyDoc.test.ts` pins every table to
the code ROW-FOR-ROW, IN BOTH DIRECTIONS, order-preserving (the W503
THRESHOLDS.md convention): code and document cannot drift apart silently.

Companion documents: `REVIEW.md` (the human checklist + record format, the
normative mirror of `src/humanReview.ts`), `README.md` (the package
overview + honest boundary index).

---

## §gates — the gate table (the policy, v1)

Four accounted gates. Order is the evaluation order and the report's
gate-row order. "Blocking" is the release-blocking classification; the
"not-runnable outcome" column states what that gate's `NOT-RUNNABLE`
verdict contributes to the overall release verdict (§verdicts).

| gateId | name | sourcePackage | blocking | notRunnableOutcome |
| --- | --- | --- | --- | --- |
| temporal-stability | Temporal stability | @sporta/renderer-evaluation | blocking | release-fail |
| scene-correctness | Scene correctness | @sporta/scene-evaluation | blocking | release-fail |
| human-quality-checks | Human quality checks | @sporta/quality-gates | blocking | pending-human-review |
| gate-accounting | Gate accounting | @sporta/quality-gates | blocking | release-fail |

What each gate runs — the REAL evaluations, composed, never re-implemented:

1. **temporal-stability** — `evaluateTemporalConsistency` from
   `@sporta/renderer-evaluation` (the `evaluateRenderOutput` /
   `evaluateTemporalConsistency` family) over the caller-supplied clip
   (`{ manifest, frames? }`; the fixture-demo seam is the real
   `renderW503CleanFixture()` output, SVG frames on). The gate verdict IS
   that report's own verdict (`report.verdict.pass`). **Thresholds are
   REFERENCED, never redefined**: every threshold lives in and stays in
   `packages/renderer-evaluation/src/thresholds.ts`, documented in
   `packages/renderer-evaluation/THRESHOLDS.md` and carried verbatim inside
   the report's check rows (§carried-evidence). This package defines ZERO
   new numeric thresholds for this gate.
2. **scene-correctness** — `evaluateSceneOutput` from
   `@sporta/scene-evaluation` over the caller-supplied fixture cases (the
   fixture-demo set is that package's own three fixtures: `clean-match`,
   `corrections-match`, `directed-review`). The gate verdict is the strict
   conjunction of the fixture reports' own verdicts; a fixture that errors
   makes the gate `NOT-RUNNABLE` with the typed error accounted. Same
   threshold rule: every W605 threshold lives in and stays in that
   package's pinned `THRESHOLDS` (in `src/report.ts`), documented in
   `packages/scene-evaluation/THRESHOLDS.md`; ZERO new thresholds here.
3. **human-quality-checks** — the fail-closed human review gate
   (`REVIEW.md` is its normative document): a documented checklist, a
   checked-in JSON record format, and gate logic where a missing,
   malformed, or incomplete record is an ACCOUNTED `NOT-RUNNABLE` whose
   policy-declared outcome is `pending-human-review` — the release verdict
   becomes `PENDING-HUMAN-REVIEW` (when the machine gates pass), never
   `PASS`, never a silent skip. A complete record with a failed checklist
   item is an honest FAILED review: gate verdict `FAIL`.
4. **gate-accounting** — the never-silent ledger
   (`src/accountingGate.ts`): totality (every declared gate has exactly one
   row, no undeclared rows), verdict vocabulary, and the accounted-reason
   rule (every `NOT-RUNNABLE` row states why). Any violation fails this
   gate, which fails the release: **a release evaluation where a gate
   silently vanishes is itself a failure.** The report's accounting table
   counts `totalGates = pass + fail + not-runnable` and carries the
   reconciliation as an explicit boolean.

**Why every gate is blocking in v1:** downgrading a gate to advisory would
be an invented escape hatch — no measured evidence exists that any gate's
failure is survivable for a release, so none is advisory. The advisory
MECHANISM is real code (the verdict derivation reads `blocking` from the
policy data, `src/report.ts` `deriveOverallVerdict`), and
`test/gates.test.ts` proves it with a test-only policy variant; only the
classification is v1 data.

**Why the human gate's not-runnable outcome is `pending-human-review`:**
its input is a human act that code cannot perform on behalf of a person.
When every machine gate passes, an absent/incomplete review must not
silently pass, and it must not fail the release either — it pends
(§verdicts). Exactly one gate may carry this outcome, and the policy
self-check enforces that it is the human gate.

## §verdicts — the overall release verdict

`evaluateReleaseReadiness` derives the overall verdict from the gate rows
UNDER THE POLICY (no gate-id `if`s in the code):

| gate state | contribution to the release verdict |
| --- | --- |
| verdict PASS | pass (blocking and advisory alike) |
| verdict FAIL (any gate) | release-fail |
| verdict NOT-RUNNABLE, outcome release-fail | release-fail (a gate that could not run — missing input, package error — counts as FAIL, never a skip) |
| verdict NOT-RUNNABLE, outcome pending-human-review | pending-human-review (only the human gate, v1) |
| non-pass verdict of an ADVISORY gate | recorded in the report and in the PASS reason; does not block |

Overall:

- **`PASS`** — only when every blocking gate passes AND the human review
  record is complete (every checklist item `pass`). The human gate's PASS
  reason and the report's `humanReview` section carry the record kind and
  reviewer verbatim, so a pipeline self-check record can never be mistaken
  for a human attestation.
- **`PENDING-HUMAN-REVIEW`** — every machine gate passed, but the human
  record is missing, malformed, or incomplete. Not a pass; not a failure
  either — the release is waiting on a human act.
- **`FAIL`** — otherwise: any gate failed, or any machine gate could not
  run. A machine failure dominates a pending review.

## §carried-evidence — what each gate row carries (verbatim)

The release report carries the SOURCE REPORTS' own evidence verbatim —
values copied field-by-field, never re-derived, never summarized into
judgment:

- **temporal-stability** (`measured`): the source report's `schemaTag`
  (`sporta/renderer-evaluation/w503@1`), its full `input` descriptor, its
  COMPLETE check list (`verdict.checks` — every metric with operator,
  threshold, measured value, and pass flag; this is how the referenced
  thresholds travel with the evidence), and its failing checks
  (`verdict.failures`). When the evaluation could not run: the accounted
  typed error (`name`, `code`, `path`, `message`) and whether a seam was
  supplied at all.
- **scene-correctness** (`measured`): per fixture case — the source
  report's `schemaTag` (`sporta/scene-evaluation/w605@1`), `input`
  descriptor, COMPLETE check list, failing checks, and the findings
  ACCOUNTING (`recorded`, `dropped`, `cap`, `truncated`). The findings
  ENTRIES themselves stay in the source reports (they are bounded at 200
  per report there and are deterministically regenerable); the release
  report carries the accounting, never a silently truncated list. When a
  fixture could not be evaluated: per-fixture typed errors, and the
  successfully evaluated fixtures are still carried as partial evidence —
  never dropped.
- **human-quality-checks** (`measured`, = the report's `humanReview`
  section): the inspection status, the checklist version, every accounted
  issue (typed code + JSON path + message), the missing item ids, the
  record's fixed fields verbatim (`recordKind`, `reviewer`, `reviewedAt`,
  `scope`, `notes`), the per-item results joined with their checklist
  requirements, the failed item ids, and `humanAttested` (whether the
  record is a person's attestation).
- **gate-accounting** (`measured`): the policy's subject-gate ids, the
  accounted subject-gate ids, and the violations (empty iff PASS).

## §structural-bounds — the only numeric constants (NOT thresholds)

The roadmap rule — *a number without measured evidence is an aspiration,
not an SLO, and not a gate* — applies to QUALITY thresholds. Every quality
threshold used by this suite belongs to a source evaluation package
(§gates). The constants below are field-size sanity bounds on bounded
record formats (the W605 `MAX_FINDINGS` precedent): they keep documents
bounded and reject bloat; none of them gates a quality judgment. Pinned
row-for-row to `src/bounds.ts` in both directions by
`test/policyDoc.test.ts`.

| name | value | purpose |
| --- | --- | --- |
| MAX_FIXTURE_CASE_NAME_LENGTH | 200 | a scene-fixture case name is a bounded label, not free text |
| MAX_REVIEWER_LENGTH | 200 | a reviewer identity is a bounded label, not free text |
| MAX_SCOPE_LENGTH | 2000 | the review record's scope statement stays a statement, not a log |
| MAX_ITEM_NOTES_LENGTH | 2000 | per-checklist-item notes stay notes, not reports |
| MAX_RECORD_NOTES_LENGTH | 4000 | the record's overall notes stay notes, not reports |

## §fail-closed — the layering (what throws, what is accounted)

- **The wrapper contract throws.** `evaluateReleaseReadiness` validates ITS
  OWN input shape (`src/validateInput.ts`): unknown keys, wrong seam
  shapes, unbounded names → `QualityGatesError("input-malformed", <JSON
  path>, <message>)`. Never coerced, never defaulted.
- **The evaluation domain is accounted, not thrown.** A malformed manifest
  inside `$.temporal.input`, a malformed scene fixture, a package error —
  the gate runners catch the source packages' own typed errors and record
  `NOT-RUNNABLE` rows with the error (`name`, `code`, `path`, `message`)
  carried verbatim. `evaluateReleaseReadiness` never throws for
  evaluation-domain problems.
- **The human record is inspected, not thrown.** A missing, malformed, or
  incomplete record yields `PENDING-HUMAN-REVIEW` with every issue
  accounted (typed code + JSON path). Unknown record shapes are REJECTED
  (unknown keys, unknown checklist ids, unknown result values) — never
  partially interpreted.
- **The evaluator bug guard throws.** A report that fails the structural
  self-check (`assertReportWellFormed`: gate totality/order, verdict
  vocabulary, accounted reasons, ledger reconciliation, verdict
  re-derivation) throws `QualityGatesError("report-inconsistent")` — an
  evaluator bug, never an input problem.
- **Absent seams are accounted.** Omitting `$.temporal` or supplying an
  empty `$.scene` is not a wrapper violation — it is an accounted
  `NOT-RUNNABLE` (a gate that could not run for missing input), which
  counts as FAIL for the release.

## §determinism — byte-identical, in-process and across processes

`evaluateReleaseReadiness` is a pure function of its input: no clock reads,
no RNG, no I/O, no environment facts (no runtime versions, no hostnames).
The report serializes through `canonicalJsonStringify`
  (`src/canonicalJson.ts`): recursively key-sorted JSON, `undefined` and
non-finite numbers REFUSED. Consequently the same input yields a
byte-identical report — pinned twice in one process, and across two CLI
subprocess invocations with compared SHA-256 hashes
(`test/determinism.test.ts`; the CLI prints the report's SHA-256 so the
stability is visible on stdout).

## §boundaries — the honesty boundaries

1. **The machine gates measure what W503/W605 measure — nothing more.**
   This package adds no new quality metrics, no new scoring, no new
   comparisons: it composes the two completed evaluation packages' REAL
   evaluations, adds the policy (which gates block), the fail-closed human
   gate, and the accounting. If W503/W605 cannot see a defect class, this
   suite cannot either.
2. **The human gate records that review HAPPENED and WHAT was checked — it
   cannot verify review QUALITY.** A completed record with every item
   `pass` proves the checklist was executed and signed, not that the
   execution was good. The fixture-demo record
   (`fixtures/human-review/self-check-record.json`) is a **pipeline
   self-check**: the automated pipeline's own execution of the checklist
   over the deterministic checked-in fixtures, clearly marked
   `recordKind: "pipeline-self-check"` with `humanAttested: false` carried
   into the release report — it is NOT a claim that a human reviewed
   production output.
3. **No new thresholds anywhere.** Every threshold is a source package's
   pinned threshold, referenced (§gates) and carried verbatim inside the
   check rows (§carried-evidence). The only numeric constants this package
   defines are the §structural-bounds, and none of them gates quality.
4. **The suite evaluates fixtures, not production traffic.** The demo run
   composes the deterministic checked-in fixtures of the two evaluation
   packages (rebuilt through the real renderer seams). There is no
   production traffic to evaluate yet; a production release gate would
   need production clips and a human review record of them — the machinery
   is this package, the inputs are not.
5. **`PENDING-HUMAN-REVIEW` is not a softer FAIL for machines.** Only the
   human gate's `NOT-RUNNABLE` pends. A machine gate that cannot run
   (missing input, package error) counts as FAIL with the reason
   accounted — a release evaluation where a gate silently vanishes is
   itself a failure.
