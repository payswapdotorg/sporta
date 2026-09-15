# @sporta/quality-gates — W803 visual quality gates

The W803 acceptance criterion (docs/work-items/work-items.md):

> release gates include temporal stability, scene correctness, and
> human/automated quality checks.

This package is the release gate SUITE: it composes the REAL evaluations
of the two completed evaluation packages into one release verdict —
importing and running their real public APIs, re-implementing nothing:

| gate | source package | what runs |
| --- | --- | --- |
| temporal-stability | `@sporta/renderer-evaluation` (W503) | the real `evaluateTemporalConsistency` over the fixture clip — the gate verdict is that report's own verdict; thresholds are W503's own pinned ones (zero new thresholds here) |
| scene-correctness | `@sporta/scene-evaluation` (W605) | the real `evaluateSceneOutput` over the three W605 fixtures — same verbatim-verdict rule |
| human-quality-checks | this package | fail-closed human review over the docs/REVIEW.md checklist and record contract (absent/malformed/incomplete record → `PENDING-HUMAN-REVIEW`, never PASS) |
| gate-accounting | this package | the never-silent ledger: every policy gate appears exactly once and the counts reconcile (`gates = pass + fail + not-runnable`); a silently vanished gate is itself a failure |

The gate policy (which gates exist, which are blocking, what a
not-runnable gate counts as) is a versioned DATA document —
[docs/GATES.md](./docs/GATES.md) (`w803-gate-policy@1`), pinned
row-for-row to `src/policy.ts` by tests both directions. No policy in
scattered ifs.

## Verdicts

- **PASS** — every blocking gate passed (machine gates on the source
  packages' own verdicts; the human gate on a complete, all-pass review
  record).
- **PENDING-HUMAN-REVIEW** — machine gates green, but the human review
  record is absent, malformed, or incomplete (fail-closed: the review
  has not happened; never PASS, never a silent skip).
- **FAIL** — a blocking gate failed or could not run (not-runnable gates
  count as FAIL with the accounted reason — missing input, package
  error), or the completed review record rejects the release.

The release report (`evaluateReleaseReadiness`) is pure and
deterministic: the same input yields a byte-identical canonical report
(recursively sorted keys, two-space indent, trailing newline), pinned
twice in one process and across two subprocess invocations with compared
SHA-256 hashes. Gate rows carry the source reports' key measured values
VERBATIM (property reads, never recomputed) plus the full failing-check
lists with the source packages' own threshold values.

## The fixture demo run

`bun run gate` runs the release evaluation over the repo's real fixtures
with the checked-in automated-pipeline self-check review record
(`fixtures/human-review/w803-fixture-self-check.json` — honestly marked
`isHumanAttestation: false`; see docs/GATES.md §boundaries):

| fixture | builder | what it exercises |
| --- | --- | --- |
| w503-clean-clip | W503 `renderW503CleanFixture()` | the 6-step anime clip through the real `renderAnimeClip`, frames supplied (byte-level style stability measured) |
| w605-clean-match | W605 `buildCleanMatchFixture()` | the 4-step 3D match baseline through the real W601–W603 seams |
| w605-corrections-match | W605 `buildCorrectionsMatchFixture()` | the 8-step honest-discontinuity story (disposition change, height gap, teleport, correction event, declared cut) |
| w605-directed-review | W605 `buildDirectedReviewFixture()` | the full W604 chain: commentary → `extractEventCandidates` → `direct` → `render3dDirectedMatch`, plan riding along |

The CLI writes the canonical report to stdout between the
`SPORTA-RELEASE-REPORT-BEGIN` / `SPORTA-RELEASE-REPORT-END` markers,
prints a human-readable summary, and ends with the literal marker line
`SPORTA-RELEASE-GATE <verdict>`. Exit codes: 0 = PASS, 1 = FAIL,
2 = PENDING-HUMAN-REVIEW.

## The detection teeth (test/)

`test/detection.test.ts` proves the gate bites:

- a temporal defect injected through W503's real injector seam
  (`injectGeometryTeleport`) → the temporal gate FAILs with the injected
  metric's measured value carried verbatim → the release verdict FAILs;
- a scene defect injected the way W605's own tests inject
  (`injectWrongScoreClaim` / `injectSceneStateDrift`) → the scene gate
  FAILs → the release verdict FAILs;
- the human review record removed → `PENDING-HUMAN-REVIEW` (never PASS,
  never skipped);
- a gate made not-runnable (malformed fixture input / missing case input
  / empty fixture list) → counted FAIL with the accounted reason, and the
  accounting table still reconciles;
- accounting totality — counts reconcile on every produced report, and
  `reconcileGateRows` bites on tampered rows (a vanished gate, a
  duplicate, a policy-unfaithful row);
- determinism — byte-identical reports ×2 in one process and across two
  subprocesses (SHA-256 compared; `test/subprocess.test.ts`).

## Re-running

```bash
cd packages/quality-gates
bun run typecheck   # tsc --noEmit (zero errors)
bun test            # the suite (gate composition + detection teeth + determinism)
bun run gate        # the fixture demo run — report + verdict + SPORTA-RELEASE-GATE marker
```

## Honest boundaries

Documented in [docs/GATES.md](./docs/GATES.md) §boundaries and restated
here in brief: the machine gates measure exactly what W503/W605 measure —
nothing more; the human gate records that review HAPPENED and WHAT was
checked, not review QUALITY; the demo record is a pipeline self-check,
not a human attestation; there are no new thresholds anywhere (every
release-failing threshold belongs to a source package's own pinned
threshold document); and the suite evaluates fixtures, never production
traffic.

Package boundary: runtime dependencies are `@sporta/renderer-evaluation`
and `@sporta/scene-evaluation` only — no clock reads, no RNG, no I/O in
the measurement core (pinned by `test/boundary.test.ts`).
