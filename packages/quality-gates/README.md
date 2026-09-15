# @sporta/quality-gates — the W803 visual quality gates (release gate suite)

**Work item W803 (M8):** *"release gates include temporal stability, scene
correctness, and human/automated quality checks."* · Owner: AI ·
Dependencies: W503 (`@sporta/renderer-evaluation`, COMPLETE), W605
(`@sporta/scene-evaluation`, COMPLETE).

The release gate suite that **composes the REAL evaluations of the two
completed evaluation packages into one release verdict**. It imports and
runs their real public APIs; it re-implements nothing and measures nothing
new — the machine gates measure exactly what W503/W605 measure. What this
package adds is **composition, policy, and accounting**:

- **`evaluateReleaseReadiness(input)`** — pure, deterministic: the same
  input yields a byte-identical canonical JSON report (pinned twice
  in-process and across two CLI subprocess invocations with compared
  SHA-256 hashes). Four accounted gates, one report:
  - **temporal stability** — the real `evaluateTemporalConsistency` over
    the supplied clip; the gate verdict IS the source report's own
    verdict; thresholds REFERENCED from the source package's pinned
    `thresholds.ts` / `THRESHOLDS.md` (zero new thresholds here);
  - **scene correctness** — the real `evaluateSceneOutput` over the
    supplied fixture cases (the demo set is the source package's own
    `clean-match` / `corrections-match` / `directed-review` fixtures);
  - **human quality checks** — fail-closed human review: a documented
    checklist (`REVIEW.md`), a checked-in JSON record format, and gate
    logic where a missing/malformed/incomplete record makes the release
    verdict `PENDING-HUMAN-REVIEW` — never `PASS`, never silently
    skipped;
  - **gate accounting** — the never-silent ledger: total gates, per-gate
    verdicts, gates that could not run (missing input, package error)
    counted as `FAIL` with the reason. A release evaluation where a gate
    silently vanishes is itself a failure.
- **The release verdict** — `PASS` only when every blocking gate passes
  AND the human record is complete; `PENDING-HUMAN-REVIEW` when the
  machine gates pass but the record is absent/incomplete; `FAIL`
  otherwise. Gate policy (which gates are blocking vs advisory, how each
  not-runnable propagates) is a versioned DATA document — `GATES.md`
  §gates ↔ `src/gatePolicy.ts`, pinned both directions by tests — never
  scattered `if`s.

## Usage

```bash
cd packages/quality-gates
bun run gate                # evaluate the fixture demo, write the report, print the verdict
bun run gate --report out.json
```

The CLI runs the release evaluation over the real fixtures plus the
checked-in human-review record, writes the deterministic canonical report
(default `dist/release-report.json`), prints every gate's verdict and
the accounting, prints the report's SHA-256, and prints the literal marker
line `SPORTA-RELEASE-GATE <verdict>`. Exit codes: `0` PASS · `1` FAIL ·
`2` PENDING-HUMAN-REVIEW · `3` usage.

In code:

```ts
import {
  buildDefaultReleaseInputs,
  canonicalJsonStringify,
  evaluateReleaseReadiness,
} from "@sporta/quality-gates";

const input = buildDefaultReleaseInputs({ humanReview: recordValue });
const report = evaluateReleaseReadiness(input);
console.log(report.verdict.overall); // "PASS" | "PENDING-HUMAN-REVIEW" | "FAIL"
const bytes = canonicalJsonStringify(report); // the deterministic form
```

## The detection teeth (test/)

The suite must BITE, and the tests prove it: a temporal defect injected
through the real W503 injector seam → overall `FAIL`; a scene defect
injected the way the scene-evaluation package's own tests inject (its real
injectors) → `FAIL`; the human record removed → `PENDING-HUMAN-REVIEW`; a
gate made not-runnable (malformed fixture input) → counted `FAIL`, never
skipped; accounting totality (counts reconcile, a vanishing gate fails the
accounting gate — teeth-tested through the exported pure checker);
determinism byte-identical ×2 and cross-subprocess SHA-256 stable; the
isolation boundary (src imports only the two declared `@sporta/*`
dependencies + relative paths) and the purity constitution (no clock, no
RNG, in src AND scripts) are source-scanned with their own teeth tests.

## Documents

- **`GATES.md`** — the normative gate policy: the gate table (pinned to
  `src/gatePolicy.ts` both directions), the verdict semantics, the
  carried-evidence contract, the structural bounds (pinned to
  `src/bounds.ts`), the fail-closed layering, determinism, and the honesty
  boundaries.
- **`REVIEW.md`** — the normative human-review document: the checklist
  (pinned to `src/humanReview.ts` both directions), the record format,
  and the discipline (what a record proves and never proves).
- **`fixtures/human-review/self-check-record.json`** — the fixture-demo
  record, honestly marked as the automated-pipeline self-check.

## Package boundary

Runtime dependencies: `@sporta/renderer-evaluation` and
`@sporta/scene-evaluation` ONLY (both consumed through their real public
APIs; the fixture builders included). No external deps. No clock reads, no
RNG, no I/O in the evaluation core; the CLI (scripts/) does the only I/O
(reads the record, writes the report). Purity and isolation are pinned by
`test/boundary.test.ts`.

## The honest boundary (what this is NOT)

The machine gates see what W503/W605 see — nothing more. The human gate
accounts that review HAPPENED and WHAT was checked — it cannot verify
review QUALITY. No new thresholds exist anywhere in this package (the
roadmap's rule: a number without measured evidence is an aspiration, not
an SLO — and not a gate). The suite evaluates fixtures, not production
traffic. See `GATES.md` §boundaries for the full statement.
