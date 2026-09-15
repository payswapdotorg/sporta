# @sporta/quality-gates — GATES.md

**The normative gate policy document for W803 "Visual quality gates".**
`@sporta/quality-gates` · canonical reference:
`packages/quality-gates/src/policy.ts` (`GATE_POLICY`).

Acceptance (docs/work-items/work-items.md): *"release gates include
temporal stability, scene correctness, and human/automated quality
checks."*

This document is the release gate POLICY: which gates exist, which
package owns each verdict, which are blocking, and how the per-gate
verdicts compose into one release verdict. `src/policy.ts` is the
executable mirror of §1, pinned row-for-row (value AND order, both
directions — every doc row is a code row, every code row is a doc row) by
`test/policy.test.ts`, the W503 THRESHOLDS.md / W802 SLOs.md convention:
a change to either side without the other fails the suite. No gate
decision lives in a scattered `if` anywhere in the package — the code
reads this table.

Companion documents: `docs/REVIEW.md` (the human review checklist and
record format — the normative document of the human gate), `README.md`
(the package overview and honest boundary index).

---

## 1. The gate set (the machine-parseable policy table)

| field | value |
| --- | --- |
| policy id | w803-gate-policy@1 |
| gate count | 4 |

| gateId | name | sourcePackage | role | blocking | description |
| --- | --- | --- | --- | --- | --- |
| temporal-stability | Temporal stability | @sporta/renderer-evaluation | machine | true | W503 temporal consistency of the rendered anime clip (identity flicker, geometry drift, temporal artifacts) over the real fixture clip; the gate verdict is the source report's own verdict under the source package's pinned thresholds. |
| scene-correctness | Scene correctness | @sporta/scene-evaluation | machine | true | W605 six-axis 3D-output correctness (score, clock, identity continuity, ordering, scene state, direction) over the real fixtures; the gate verdict is the conjunction of the source reports' own verdicts under the source package's pinned zero thresholds. |
| human-quality-checks | Human quality checks | @sporta/quality-gates | human | true | Fail-closed human review over the documented checklist (docs/REVIEW.md): a missing, malformed, or incomplete record never passes and is never silently skipped (PENDING-HUMAN-REVIEW when the machine gates pass). |
| accounting | Accounting | @sporta/quality-gates | accounting | true | The never-silent ledger: every policy gate appears as exactly one report row, every row verdict is from the closed vocabulary, the counts reconcile (gates = pass + fail + not-runnable), and a gate that could not run counts as FAIL with the reason — a gate that silently vanishes fails the release. |

Policy invariants (enforced fail-loud on every evaluation,
`assertGatePolicyInvariants`): a non-empty document with well-formed
rows; unique gate ids; exactly one `accounting`-role gate; exactly one
`human`-role gate, and it MUST be blocking (a waivable human review
defeats the W803 acceptance — an advisory human gate is rejected as
`policy-malformed`); at least one `machine`-role gate. A custom policy
naming a gate id this package has no runner for produces a `NOT_RUNNABLE`
row (`no-runner`) — fail-closed: an unknown gate fails the release, it
never weakens the suite.

## 2. Verdict composition (the normative rule)

Every gate row's verdict is from the closed vocabulary
`PASS | FAIL | NOT_RUNNABLE`. The overall release verdict is composed by
ONE documented function from the rows and this policy's blocking flags
and roles:

1. **`FAIL`** — any BLOCKING gate with role `machine` or `accounting` is
   not `PASS` (a failing check, or `NOT_RUNNABLE` — a gate that could not
   run fails the release, it is never a skip); OR the human gate failed
   with reason `checklist-item-failed` (a completed review that found
   failing items is a definitive human FAIL); OR the human gate failed
   with any failure class other than the three incomplete-class codes
   below (fail-closed: an unclassifiable failure is never a pending, never
   a pass).
2. **`PENDING-HUMAN-REVIEW`** — every blocking machine/accounting gate
   passed, but the human review record is `record-missing`,
   `record-malformed`, or `record-incomplete`. Never `PASS`, never
   silently skipped: the release is blocked until a complete record
   exists.
3. **`PASS`** — every blocking gate passed AND the human record is
   complete (a valid record covering exactly the current checklist, every
   item `pass`).

Advisory gates (`blocking: false`) are reported with their verdict and
reason but never block — the blocking flag is DATA from §1, and the
composition reads it (proven by test: the same defective input is `FAIL`
under the canonical policy and `PASS` with the defect accounted as
advisory under a policy that demotes that gate). The canonical policy
blocks on all four gates.

## 3. The accounting contract (the never-silent ledger)

The report's accounting table reconciles the ledger against the policy:

| checkId | invariant |
| --- | --- |
| row-count | the subject rows cover exactly the policy's non-accounting gates (policy gates = subject rows + the one accounting row) |
| gate-set | the subject rows' gate ids equal the policy's non-accounting gate ids, in order — no vanished gate, no duplicate, no invented gate |
| verdict-vocabulary | every row verdict is from `PASS \| FAIL \| NOT_RUNNABLE` (an uncountable row is a ledger failure) |
| count-reconciliation | every subject row lands in exactly one bucket: subject rows = pass + fail + not-runnable |

The published table carries the final counts including the accounting
row itself, so the identity the report asserts is:

```
gates = pass + fail + not-runnable    (and rowCount = totalGates)
```

A release evaluation where a gate silently vanishes is itself a failure:
the accounting verdict is the conjunction of the four checks above, it is
blocking, and its `reconciles` flag is echoed at the top level of the
report.

## 4. The seams (the real evaluations this suite runs — all test-pinned to exist)

| gateId | package | export |
| --- | --- | --- |
| temporal-stability | @sporta/renderer-evaluation | renderW503CleanFixture |
| temporal-stability | @sporta/renderer-evaluation | evaluateRenderOutput |
| scene-correctness | @sporta/scene-evaluation | buildCleanMatchFixture |
| scene-correctness | @sporta/scene-evaluation | buildCorrectionsMatchFixture |
| scene-correctness | @sporta/scene-evaluation | buildDirectedReviewFixture |
| scene-correctness | @sporta/scene-evaluation | evaluateSceneOutput |
| human-quality-checks | @sporta/quality-gates | HUMAN_REVIEW_CHECKLIST |
| human-quality-checks | @sporta/quality-gates | SELF_CHECK_CHECKLIST |
| human-quality-checks | @sporta/quality-gates | validateHumanReviewRecord |
| accounting | @sporta/quality-gates | reconcileGateLedger |

`test/policy.test.ts` imports every named package and asserts every named
export exists — a policy naming a seam that does not exist fails the
suite, fail-closed (the W802 `DEGRADATION_POLICIES` machinery-pin
convention). The machine gates RUN these seams: nothing is re-implemented
in this package.

## 5. The evidence carried (the verbatim rule)

Each machine gate row carries, per evaluated fixture, the source
report's evidence VERBATIM — values are carried unchanged, never
re-derived, never re-thresholded:

- the source report's `schemaTag` and own verdict;
- the source report's `input` echo (renderer identity, session, frame
  counts — what was measured and where it came from);
- the FULL check list (metric, operator, threshold, measured value, pass
  flag) — completeness over selection: this package makes no judgment
  about which measured values are "key", it carries all of them;
- the source report's failing checks, verbatim (empty iff the source
  verdict passed).

The scene report's bounded findings arrays are not carried (upstream
evidence detail); the check list and failing checks carry the measured
verdict evidence. The human-review section echoes the review record
(kind, checklist, reviewer, authored date, per-item results, failing
items, notes) verbatim. Every gate that did not pass carries its
accounted reason; a `NOT_RUNNABLE` gate additionally echoes the source
evaluation's thrown error verbatim (class, typed code, JSON path,
message).

## 6. The CLI (bun run gate)

`scripts/gate.ts` runs the canonical release evaluation over the real
fixtures (the W503 clean clip + all three W605 fixtures — the same input
`buildCanonicalReleaseInput` builds), with the checked-in automated
pipeline self-check record (§7) as the human review record. It writes the
deterministic machine-readable report to
`reports/release-readiness-report.json` (canonical bytes: 2-space JSON +
trailing newline; the same input yields byte-identical output), prints
the per-gate summary, the verdict, and the literal marker line:

```
SPORTA-RELEASE-GATE <verdict>
```

plus the report's SHA-256 (stable across invocations — the
cross-subprocess determinism proof). Exit codes: `0` = PASS,
`1` = PENDING-HUMAN-REVIEW, `2` = FAIL. A non-zero exit is the gate
biting, not a crash. A checked-in golden copy of the canonical report
(`fixtures/golden/release-readiness-report.json`) pins the fixture-based
demo run byte-for-byte: any drift in the composed evaluations' measured
values is a loud, reviewed diff (regenerating the golden is an
intentional act: run `bun run gate`, verify the diff, copy the report
over the golden).

## 7. Boundaries (the honesty section)

What this package is NOT, in plain words:

- **Machine gates measure what W503/W605 measure — nothing more.** This
  package adds NO new quality metrics and NO new thresholds. The temporal
  gate's verdict is the W503 report's own verdict under W503's pinned
  thresholds (`packages/renderer-evaluation/THRESHOLDS.md`); the scene
  gate's verdict is the W605 reports' own verdicts under W605's pinned
  zero-thresholds (`packages/scene-evaluation/THRESHOLDS.md`). The only
  numbers this package defines are FORMAT bounds of the documents it owns
  (the review record's field bounds, the input envelope's fixture-name
  and run-count bounds — schema constraints, documented in REVIEW.md §3,
  never quality or latency thresholds). The roadmap's rule applies: a
  number without measured evidence is an aspiration, not an SLO — and not
  a gate.
- **The human gate records that review HAPPENED and WHAT was checked — it
  cannot verify review QUALITY.** A complete record with every item
  `pass` proves a documented procedure was executed and sign-off fields
  were filled; it cannot prove the reviewer looked carefully, understood
  what they saw, or told the truth. The record format is the honest
  accounting of that limit.
- **The checked-in demo record is a pipeline self-check, not a human
  attestation.** `fixtures/human-review-self-check.json` records that the
  automated demo run executed the machine-verifiable analog checklist
  (every renderer path rendered its real fixture; the gate report was
  produced and read back). No person visually inspected rendered output
  for that record. It is carried, labeled, and reported as
  `automated-pipeline-self-check` everywhere it appears; a production
  release requires a `human-review` record completed per docs/REVIEW.md
  §1 by a named person.
- **The suite evaluates fixtures, not production traffic.** The gate
  inputs are the deterministic checked-in fixtures of the two evaluation
  packages (their construction rules and limits are those packages' own
  documented boundaries — injected clocks, authored timelines, no
  production telemetry). A passing release evaluation says the fixture
  pipeline is correct; it says nothing about live-renderer behavior under
  real load, real streams, or real-world visual conditions.
- **The composition is only as good as its inputs.** A release evaluation
  over a stale, partial, or non-canonical fixture set is only as
  meaningful as that fixture set; the report honestly echoes what it
  evaluated (fixture names, record kind) so a reader can judge.

## 8. Format bounds (schema constraints — not thresholds)

For completeness, the full list of numeric bounds this package defines,
all of them FORMAT bounds of documents the package itself owns (see
REVIEW.md §3 for their documentation): the review record's notes bound
(500 characters), reviewer name/role bounds (100 characters each), the
checklist-results count bound (16), the release input's fixture-name
bound (64 characters) and scene-run count bound (8). Zero quality
thresholds are defined anywhere in this package.
