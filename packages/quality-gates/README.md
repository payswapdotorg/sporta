# @sporta/quality-gates — W803 release gates

The W803 acceptance criterion (docs/work-items/work-items.md):

> release gates include temporal stability, scene correctness, and
> human/automated quality checks.

This package is the release gate suite that composes the REAL evaluations
of the two completed evaluation packages into one release verdict. It
re-implements nothing: the temporal stability gate runs
`@sporta/renderer-evaluation`'s real `evaluateRenderOutput` over its real
fixture clip; the scene correctness gate runs `@sporta/scene-evaluation`'s
real `evaluateSceneOutput` over all three of its real fixtures; the
verdicts adopted are the SOURCE packages' own verdicts under THEIR pinned
thresholds. On top of the two machine gates it adds exactly two things of
its own: a fail-closed human review gate (docs/REVIEW.md) and the
never-silent accounting gate (GATES.md §3).

## The verdict

```
PASS                  every blocking gate passed AND the human record is complete
PENDING-HUMAN-REVIEW  machine gates passed; human record absent/malformed/incomplete
FAIL                  otherwise (any blocking gate FAIL or NOT_RUNNABLE, or a completed
                      review with failing items)
```

A gate that could not run (missing input, source-package error) is
`NOT_RUNNABLE`, echoed with the source error verbatim, and counts as
`FAIL` — never a skip. The accounting table reconciles on every report:
`gates = pass + fail + not-runnable`, every policy gate present as
exactly one row. The gate policy (which gates exist, which are blocking
vs advisory) is the versioned data document [docs/GATES.md](./docs/GATES.md)
§1, mirrored by `src/policy.ts` and pinned row-for-row both directions by
tests — no policy in scattered ifs.

## Usage

```sh
cd packages/quality-gates
bun run gate        # the fixture-based demo release evaluation
bun test            # the full suite (detection teeth + determinism pins)
```

The CLI writes the deterministic report to
`reports/release-readiness-report.json`, prints the per-gate summary, the
verdict, and the marker line `SPORTA-RELEASE-GATE <verdict>`; exit codes
0 / 1 / 2 for PASS / PENDING-HUMAN-REVIEW / FAIL. Programmatic:

```ts
import {
  buildCanonicalReleaseInput, canonicalReportBytes, evaluateReleaseReadiness,
} from "@sporta/quality-gates";

const input = buildCanonicalReleaseInput(reviewRecord);   // real W503 + W605 fixtures
const report = evaluateReleaseReadiness(input);           // pure, deterministic
const bytes = canonicalReportBytes(report);               // byte-identical every run
```

`evaluateReleaseReadiness` is pure: no clock, no RNG, no I/O, no input
mutation; the same input yields a byte-identical canonical report —
pinned twice in one process and across two subprocess invocations with
compared stdout hashes, plus a checked-in golden copy of the canonical
fixture run (`fixtures/golden/release-readiness-report.json`).

## The human quality checks gate

Fail-closed: a missing, malformed, or incomplete review record never
passes and is never silently skipped. The checklist, the derived
machine-verifiable self-check checklist, and the record format are
[docs/REVIEW.md](./docs/REVIEW.md) (the normative document; mirrored by
`src/humanReview.ts` and pinned row-for-row by tests). The checked-in
demo record is the automated pipeline's honest self-check over the
fixtures — clearly marked `automated-pipeline-self-check`, never a claim
that a human reviewed production output.

## The honest boundary (what this is NOT)

- Machine gates measure what W503/W605 measure — nothing more; this
  package adds no new metrics and no new thresholds (the only numbers it
  defines are schema format bounds, documented in GATES.md §8).
- The human gate records that review HAPPENED and WHAT was checked; it
  cannot verify review QUALITY.
- The suite evaluates fixtures, not production traffic.
- The full boundary statement is GATES.md §7 (the normative honesty
  section).

## Package boundary

Runtime dependencies: exactly `@sporta/renderer-evaluation` and
`@sporta/scene-evaluation` — the two completed evaluation packages this
suite composes (their own dependency graphs come with them). No external
dependencies, no clock reads, no RNG, no I/O anywhere in `src` — pinned
by `test/boundary.test.ts` (isolation + constitution source scans, the
W802 `@sporta/slo` convention).

## Module map

| module | what it owns |
| --- | --- |
| `errors` | the typed fail-loud error surface (codes, JSON-path context) |
| `policy` | `GATE_POLICY` — the versioned gate policy data document (GATES.md §1's mirror) |
| `humanReview` | the checklists + the fail-closed review record validation (REVIEW.md's mirror) |
| `input` | the release evaluation input envelope + its shape validation |
| `gates` | the gate runners: the real W503/W605 evaluations, the human gate, fail-closed error capture |
| `accounting` | `reconcileGateLedger` — the never-silent ledger's four reconciliation checks |
| `fixtures` | `buildCanonicalReleaseInput` — the real fixtures assembled into one input |
| `report` | `evaluateReleaseReadiness` + the report types + the canonical serialization |
| `scripts/gate.ts` | the operator CLI (fixtures → deterministic report + verdict + marker line) |
