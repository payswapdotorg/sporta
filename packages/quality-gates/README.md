# @sporta/quality-gates

**Work item W803 (M7):** "release gates include temporal stability, scene
correctness, and human/automated quality checks." · Dependencies: W503,
W605 (both COMPLETE).

The release-gate suite that composes the REAL evaluations of the two
completed evaluation packages into one release verdict. This package
imports and runs their real public APIs; it re-implements NOTHING and
defines ZERO new numeric thresholds (the source packages' pinned
threshold documents govern; the roadmap rule: a number without measured
evidence is an aspiration — and not a gate).

## The gates (docs/GATES.md is the normative policy)

| gate | source | what runs |
|---|---|---|
| temporal-stability | `@sporta/renderer-evaluation` | `evaluateRenderOutput` over the real clean fixture — the gate verdict is that report's own verdict |
| scene-correctness | `@sporta/scene-evaluation` | `evaluateSceneOutput` over the real match AND directed fixtures — both must pass |
| human-review | this package | the fail-closed record gate (docs/REVIEW.md): absent/malformed/incomplete → PENDING-HUMAN-REVIEW, never PASS |

Verdicts: **PASS** (every blocking gate green + the human record
complete), **PENDING-HUMAN-REVIEW** (machine gates green, human record
not complete), **FAIL** (any blocking gate FAIL or NOT-RUNNABLE — a gate
that cannot run is a failed release check, never a skipped one). The
accounting always reconciles: gates = pass + fail + not-runnable +
pending.

## The API

```ts
import { evaluateReleaseReadiness, parseDemoRecord } from "@sporta/quality-gates";

const report = evaluateReleaseReadiness({ humanRecord: parseDemoRecord() });
// report.verdict.outcome — "PASS" | "FAIL" | "PENDING-HUMAN-REVIEW"
// report.gates — per-gate rows with carried measured values
// report.accounting — the never-silent ledger
```

Pure and deterministic: same input → byte-identical report (in-process ×2
and across subprocesses, SHA-256 pinned). Gate runners that throw land
NOT-RUNNABLE and fail the release (defense in depth at both the runner
and the report level).

## The CLI

```bash
bun run gate                    # demo record (the pipeline self-check)
bun run gate --record review.json  # a REAL human review record
```

Prints `SPORTA-RELEASE-GATE <verdict>`; exit 0 PASS / 1 FAIL / 2
PENDING-HUMAN-REVIEW. Report: `reports/w803-release-report.json`.

## Tests (29)

Detection proofs (an injected temporal defect through the W503 package's
own injector FAILs the release; a corrupted scene fixture FAILs it; a
missing/malformed/incomplete human record PENDS it; a complete record
with a failed item FAILs it; a throwing gate runner lands NOT-RUNNABLE and
FAILs it), report shape + zod self-validation + accounting reconciliation,
determinism ×2 in-process + cross-subprocess SHA-256, the GATES.md/REVIEW.md
policy pins (row-for-row, both directions, with teeth), boundary isolation
+ constitution source scans (no wall clock, no randomness).

## Honest boundaries

- The machine gates measure what W503/W605 measure — nothing more; this
  package adds composition, policy, and accounting only.
- The human gate records that review HAPPENED and WHAT was checked — not
  review quality; the demo record is a pipeline self-check, explicitly NOT
  a human attestation (docs/REVIEW.md §honesty).
- The suite evaluates the repo's deterministic fixtures, not production
  traffic.
- Runtime dependencies: `@sporta/renderer-evaluation`,
  `@sporta/scene-evaluation`, `zod` (pinned by test/boundary.test.ts).
