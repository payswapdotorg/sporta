# W803 release gates — the normative policy document

**Work item W803 (M7):** "release gates include temporal stability, scene
correctness, and human/automated quality checks."

Canonical executable references: `src/policy.ts` (`GATE_POLICY`,
`GATE_POLICY_VERSION`), `src/human.ts` (`HUMAN_CHECKLIST`), `src/report.ts`
(`evaluateReleaseReadiness`). The §2 table and §3 checklist are pinned
row-for-row to the code by `test/policy-doc.test.ts` — a change to either
side without the other fails the suite (the W503 THRESHOLDS.md
convention, both directions).

**Policy version: `w803@1`.**

## 1. What this suite is

The release-gate suite composes the REAL evaluations of the two completed
evaluation packages into one release verdict. It re-implements NOTHING and
defines ZERO new numeric thresholds — the machine gates' thresholds are
REFERENCED from the source packages' own pinned threshold documents
(`@sporta/renderer-evaluation` THRESHOLDS.md, `@sporta/scene-evaluation`
THRESHOLDS.md). The roadmap rule governs: a number without measured
evidence is an aspiration, not an SLO — and not a gate.

## 2. The gate policy table

| gate id | source | blocking |
|---|---|---|
| temporal-stability | @sporta/renderer-evaluation | blocking |
| scene-correctness | @sporta/scene-evaluation | blocking |
| human-review | @sporta/quality-gates/human | blocking |

All three gates are BLOCKING in `w803@1`: their FAIL (or NOT-RUNNABLE)
makes the release FAIL. The blocking column is explicit policy, never
implied — an advisory gate would be recorded here as `advisory` and never
block (none exist yet; the column exists so adding one is a documented
policy change, not a silent code path).

## 3. The human-review checklist

The checklist items a completed review records (pinned to `HUMAN_CHECKLIST`
in `src/policy.ts`; the record format is documented in `docs/REVIEW.md`):

- `one-rendered-clip-per-renderer-path-inspected`
- `gate-report-read-in-full`
- `sign-off-recorded`

## 4. Verdict semantics (one place: `src/report.ts`)

- **PASS** — every blocking gate PASSes: the machine gates green AND the
  human record complete with every checklist item `pass`.
- **PENDING-HUMAN-REVIEW** — every machine gate PASSes but the human
  record is absent, malformed, or incomplete. Never a PASS, never silent.
- **FAIL** — any blocking gate FAILs or is NOT-RUNNABLE (a gate that
  cannot run is a failed release check, never a skipped one), or the human
  record is complete with a `fail` checklist item.

The accounting is never silent: `gateCount = pass + fail + not-runnable +
pending`, reconciled on every report; a gate that silently vanished would
break the reconciliation, not the honesty.

## 5. Determinism

`evaluateReleaseReadiness` is a pure function of its input (the
human-review record; the fixtures the gate runners evaluate are the source
packages' own deterministic fixtures): no clock, no randomness, no I/O in
`src` (pinned by the constitution source scan). Same input →
byte-identical report, in-process and across subprocesses (SHA-256
compared by `test/report.test.ts` and `test/subprocess.test.ts`).

## 6. Honest boundaries

- The machine gates measure what W503/W605 measure — nothing more. This
  package adds composition, policy, and accounting; it adds NO new quality
  metrics and NO new thresholds.
- The human gate records that review HAPPENED and WHAT was checked — it
  cannot verify review QUALITY. The checked-in demo record is a pipeline
  self-check, explicitly NOT a human attestation (see `docs/REVIEW.md`).
- The suite evaluates the repo's deterministic fixtures, not production
  traffic; production release gating needs the deployment-side telemetry
  (the W804/W805 recorded operational gap).
- The CLI's demo run uses the checked-in record; a REAL release sign-off
  requires a REAL record (a human reviewer, the checklist, a date).
