# W803 Visual Quality Gates — the normative gate policy document

**Work item W803 (M7):** *"release gates include temporal stability, scene
correctness, and human/automated quality checks."* · Owner: AI ·
Dependencies: W503 (`@sporta/renderer-evaluation`, COMPLETE), W605
(`@sporta/scene-evaluation`, COMPLETE).

Canonical executable reference: `src/policy.ts` (`GATE_POLICY`,
`GATE_POLICY_VERSION`). The §1 table is pinned row-for-row to the code by
`test/policy-doc.test.ts` — a change to either side without the other fails
the suite (the W503 THRESHOLDS.md / W802 SLOs.md convention, both
directions: code and documents never drift apart silently).

This package is the COMPOSITION layer. It imports and runs the REAL public
evaluations of the two completed evaluation packages and adds the human
review gate and the accounting gate. It re-implements nothing: no metric,
no threshold, no expectation from W503 or W605 is duplicated here.

Companion documents: `docs/REVIEW.md` (the human review checklist and
record contract, pinned to `src/review.ts`), `README.md` (the package
overview), `../renderer-evaluation/THRESHOLDS.md` (the temporal gates'
thresholds — W503's own), `../scene-evaluation/THRESHOLDS.md` (the scene
gates' thresholds — W605's own).

## 1. The gate policy table

The gate policy is DATA, not scattered ifs: every row below is carried
verbatim into every release report row (`sourcePackage`, `blocking`,
`notRunnableOutcome`), and the overall verdict is computed from those
fields alone. A custom policy may be injected into
`evaluateReleaseReadiness` (the camera-director `DirectorPolicy`
precedent) and is re-validated fail-closed at admission (§5).

| gateId | source package | blocking | not-runnable outcome | description |
| --- | --- | --- | --- | --- |
| temporal-stability | @sporta/renderer-evaluation | yes | fail | W503's real temporal-consistency evaluation over the fixture clip; the gate verdict is that report's own verdict (thresholds referenced from W503's pinned THRESHOLDS, none defined here) |
| scene-correctness | @sporta/scene-evaluation | yes | fail | W605's real scene-correctness evaluation over the fixtures; the gate verdict is that report's own verdict (zero-threshold semantics referenced from W605) |
| human-quality-checks | @sporta/quality-gates | yes | pending-human-review | fail-closed human review record (docs/REVIEW.md checklist); a missing, malformed, or incomplete record yields PENDING-HUMAN-REVIEW, never PASS |
| gate-accounting | @sporta/quality-gates | yes | fail | the never-silent ledger: every policy gate appears exactly once and the counts reconcile (gates = pass + fail + not-runnable); a silently vanished gate is itself a failure |

All four canonical gates are blocking in `w803-gate-policy@1`. The
`blocking` column is real data, not decoration: a policy that marks a gate
advisory changes the verdict computation (advisory failures are reported
but never block), and the validation rules of §5 still apply to the
blocking gates that carry release semantics.

## 2. Gate semantics

### 2.1 temporal-stability

Runs W503's real `evaluateTemporalConsistency` over each supplied fixture
case (`TemporalEvaluationInput`: the W502 clip manifest plus its SVG
frames — frames enable the byte-level style stability measurement). The
sub-verdict IS the source report's own verdict (`report.verdict.pass`).
Every threshold that bites is W503's own pinned threshold
(`../renderer-evaluation/THRESHOLDS.md` ↔ `src/thresholds.ts` of that
package, row-for-row pinned by that package's own tests): this package
defines ZERO new numeric thresholds for it and re-states none. The
carried failing checks carry the threshold values verbatim, so the
release report shows exactly which documented W503 thresholds were
breached, with the measured values.

The gate verdict is the roll-up over its fixtures: PASS iff every
evaluation passed; NOT-RUNNABLE if any evaluation could not run (missing
case input, empty fixture list, or the source package rejected the
payload — its own fail-loud validation is the authority); FAIL if any
evaluation failed. Not-runnable dominates the roll-up: a gate whose
evidence is incomplete is never credited.

### 2.2 scene-correctness

Runs W605's real `evaluateSceneOutput` over each supplied fixture case
(`SceneEvaluationInput`: snapshots, event stream, steps, output, optional
plan — match and directed modes alike). Same verbatim-verdict and roll-up
rules as §2.1. The zero-threshold semantics (every defect count must be
0) are W605's own, referenced from `../scene-evaluation/THRESHOLDS.md` —
not re-stated, not extended. The demo run evaluates all three W605
fixtures (clean match, corrections match, directed review).

### 2.3 human-quality-checks

Fail-closed human review over the record contract of `docs/REVIEW.md`.
The gate verdict:

- **PASS** — the record is structurally valid, answers the checked-in
  checklist item-for-item, and every item's result is `pass`;
- **FAIL** — the record is complete but some item's result is `fail` (a
  review that happened and found problems — the release is rejected with
  the failed items accounted);
- **NOT-RUNNABLE** — the record is absent, malformed (structural
  validation throws, JSON path accounted), or incomplete (missing
  checklist results, the missing item ids accounted).

The policy maps this gate's not-runnable outcome to
`pending-human-review` (§1): an unfinished review is a release state that
must be finished, never a pass, never a silent skip.

### 2.4 gate-accounting

The never-silent ledger. It reconciles the evaluated gate rows against
the policy: every policy gate except `gate-accounting` itself (whose row
is derived from the reconciliation) must appear EXACTLY once; no row may
name a gate outside that set (an extra row is as much a ledger violation
as a missing one); every row's verdict must be from the accounting
vocabulary {PASS, FAIL, NOT-RUNNABLE}; every row's `sourcePackage`,
`blocking`, and `notRunnableOutcome` must equal the policy's own row.
Any violation → the accounting gate FAILS → the release verdict is FAIL.
In the honest assembly the reconciliation always passes; its teeth are
proven by direct `reconcileGateRows` tests over tampered row arrays (a
gate that silently vanishes, a duplicated gate, a policy-unfaithful row).

The report-level accounting table (§4) counts all four rows and must
reconcile exactly: `totalGates = passCount + failCount + notRunnableCount`
— pinned by tests on every produced report, including the not-runnable
and fail paths.

## 3. The overall verdict

Exactly three outcomes, computed from the policy data alone:

- **PASS** — every blocking gate has verdict PASS (machine gates on the
  source packages' own verdicts; the human gate on a complete, all-pass
  review record). Advisory gates never change the outcome, but they are
  never silent either: an advisory failure or not-runnable advisory gate
  is carried in the verdict reason.
- **PENDING-HUMAN-REVIEW** — every blocking machine gate passed (and the
  accounting reconciles), but the human gate is NOT-RUNNABLE: the review
  record is absent, malformed, or incomplete. The release cannot pass on
  unfinished review; the report says exactly what is missing.
- **FAIL** — any blocking gate has verdict FAIL, or any blocking gate
  whose not-runnable outcome is `fail` could not run (missing input,
  package error — counted as FAIL with the accounted reason), or the
  completed review record rejects the release.

Precedence: hard failures first — if a machine gate fails or cannot run,
the verdict is FAIL regardless of the human record's state; only when the
machine side is fully green does an unfinished review surface as
PENDING-HUMAN-REVIEW.

## 4. The release report

`evaluateReleaseReadiness(input, policy = GATE_POLICY)` is pure and
deterministic: the same (input, policy) yields a byte-identical canonical
report (`serializeReleaseReport`: recursively sorted keys, two-space
indent, one trailing newline), pinned twice in one process and across two
subprocess invocations with compared SHA-256 hashes. No clock, no RNG, no
I/O, no stack traces, no hostnames appear anywhere in the report.

Report structure (`sporta/quality-gates/w803@1`):

- `schemaTag` — the versioned report tag;
- `policy` — the policy echo: version, gate count, blocking/advisory
  counts;
- `input` — derived counts: temporal fixture count, scene fixture count,
  whether a human-review record was supplied;
- `gates` — the gate rows, in POLICY order. Each row: `gateId`,
  `sourcePackage`, `blocking`, `notRunnableOutcome`, `verdict`, the
  accounted `reason` (present when not-runnable, or when the human gate
  rejected), `evaluations` (machine gates: one sub-row per fixture), and
  `keyValues` (row-level counts). Each sub-row carries, VERBATIM from the
  source report: the schema tag, the report's own `input` block, every
  numeric top-level metric of every metrics section
  (`identity.flickerCount`, `geometry.jumpCount`,
  `sceneState.positionMismatchCount`, … — property reads, never
  recomputed), the check counts, and the full `verdict.failures` list
  (metric, operator, threshold, measured, pass); scene sub-rows also
  carry the findings accounting (recorded/dropped/truncated/cap) and the
  seven per-dimension verdicts;
- `humanReview` — the human-review section: `required`, `recordStatus`
  (present-complete / absent / malformed / incomplete), the checklist
  version, the bounded accounted `problems`, and the record echoed
  verbatim when structurally valid;
- `accounting` — the ledger table: `totalGates`, `passCount`,
  `failCount`, `notRunnableCount` (reconcile exactly, §2.4);
- `verdict` — `{ outcome, reason }`.

Report FORMAT bounds (boundedness, not quality thresholds — the roadmap's
rule applies to quality numbers, and these are none): accounted reasons
are bounded at 500 characters with accounted truncation; the
human-review problems list is bounded at 16 entries with accounted
truncation; fixture names are bounded at 200 characters; review-record
field bounds live in `docs/REVIEW.md` §2.

## 5. Policy versioning and validation

The policy document is versioned (`w803-gate-policy@1` — versioned with
the policy shape). A supplied policy is validated fail-closed by
`validateGatePolicy` (`gate-policy-malformed` errors with JSON paths):
exact key sets, the closed four-gate vocabulary, unique ids, totality
(all four gates present — dropping a gate is a silent vanish), and the
semantic constraints that carry the work order's own rules: the human
gate is blocking with not-runnable → `pending-human-review`; the
accounting gate is blocking with not-runnable → `fail`; machine gates
count not-runnable as `fail`; exactly one gate (the human gate) maps
not-runnable to pending. The canonical policy is pinned to §1 both
directions by `test/policy-doc.test.ts`.

## boundaries — what this suite does not claim

1. **The machine gates measure what W503/W605 measure — nothing more.**
   This package adds no new quality metrics, no new thresholds, and no
   re-derivations: it composes the two completed evaluations' real public
   APIs and carries their measured values verbatim. A defect class
   neither source package measures is invisible to this release gate.
2. **The human gate records that review HAPPENED and WHAT was checked —
   it cannot verify review QUALITY.** A complete, all-pass record
   attests the named reviewer performed the named checklist against the
   named scope; whether the review was thorough, expert, or honest is
   outside what a record format can prove. The checked-in demo record is
   the automated pipeline's own self-check (reviewer
   `automated-pipeline-self-check`, `isHumanAttestation: false`) — it
   exercises the record format and the complete-record path for the
   fixture demo run and is NOT a claim that a human reviewed production
   output. A production release requires a record with
   `isHumanAttestation: true` and a real reviewer name.
3. **No new thresholds anywhere.** The roadmap's rule: a number without
   measured evidence is an aspiration, not an SLO — and not a gate. Every
   threshold that can fail a release belongs to a source package's own
   pinned threshold document (W503's THRESHOLDS.md, W605's
   THRESHOLDS.md). The only numbers this package introduces are
   accounting counts (derived), boundedness limits on string fields
   (documented format bounds), and the boolean-derived checklist counts.
4. **The suite evaluates fixtures, not production traffic.** The demo
   run evaluates the repo's checked-in fixture clips and match timelines
   through the real renderers; it is repeatable evidence about those
   fixtures. It says nothing about live production behavior, real camera
   feeds, or real load — that is W805's observability domain, not a
   fixture gate's.
