# W803 Human Quality Checks — the review checklist and record contract

The human half of W803's *"human/automated quality checks"*: a documented
checklist of what a human reviews before a release verdict may be PASS,
and the checked-in RECORD format that captures the review. Canonical
executable references: `src/review.ts` (`HUMAN_REVIEW_CHECKLIST`,
`HUMAN_REVIEW_CHECKLIST_VERSION`, `REVIEW_BOUNDS`,
`validateHumanReviewRecord`). The §1 checklist table and the §2 bounds
table are pinned row-for-row to the code by `test/policy-doc.test.ts`
(both directions — the W503 THRESHOLDS.md convention).

The gate logic (docs/GATES.md §2.3): a missing, malformed, or incomplete
record makes the release verdict `PENDING-HUMAN-REVIEW` — never PASS,
never silently skipped. A complete record with failed items makes it
FAIL.

## 1. The review checklist (w803-review-checklist@1)

Seven items. Every item's requirement defines BOTH completion paths
honestly: a HUMAN record satisfies it by the human doing the thing; an
automated SELF-CHECK record satisfies it only by the deterministic
verification named in the requirement — and the per-item notes must state
which path was taken. A record answers the checked-in checklist
item-for-item: fewer answers = incomplete; unknown items = malformed.

| itemId | requirement |
| --- | --- |
| rendered-clip-anime | one rendered clip of the anime renderer path (W502) was inspected: a human viewed the clip, or — self-check record only — the pinned fixture clip was re-rendered and byte-verified deterministically; the item notes state which |
| rendered-clip-3d-match | one rendered clip of the 3D match renderer path (W603) was inspected: a human viewed the clip, or — self-check record only — the pinned fixture output was rebuilt through the real seams and byte-verified deterministically; the item notes state which |
| rendered-clip-3d-directed | one rendered rundown of the directed renderer path (W604) was inspected: a human viewed the rundown, or — self-check record only — the pinned fixture rundown was rebuilt through the real W604 chain and byte-verified deterministically; the item notes state which |
| gate-report-read | the release gate report was read end-to-end — every gate row, every key value, every accounted reason — and every unexplained row was chased to its source report |
| machine-gate-evidence-reviewed | the machine gates' failing or edge-case findings were reviewed and every failure was understood (or the release rejected) |
| release-scope-verified | the evaluated artifacts match the release scope: the right fixtures, sessions, and renderer versions — nothing extra, nothing missing |
| release-signoff | explicit sign-off: the reviewer accepts the release candidate as scoped for this verdict, under the documented boundaries (docs/GATES.md §boundaries) |

## 2. The record format (sporta/quality-gates/human-review@1)

One JSON document — the sign-off fields (reviewer, date), the
per-checklist-item results, and bounded notes:

```json
{
  "schemaTag": "sporta/quality-gates/human-review@1",
  "recordId": "<stable record identifier>",
  "reviewer": "<who performed the review>",
  "reviewedAt": "YYYY-MM-DD",
  "scope": "<exactly what was reviewed: fixtures, sessions, renderer versions>",
  "isHumanAttestation": true,
  "checklistResults": [
    { "itemId": "rendered-clip-anime", "result": "pass", "notes": "…" },
    { "itemId": "release-signoff", "result": "pass", "notes": "…" }
  ],
  "notes": "<bounded free-text notes>"
}
```

Field contract (validated fail-closed — unknown keys, wrong types, a bad
calendar date, unknown or duplicate items, or a reserved-id violation
throw with the JSON path):

| field | required | type | notes |
| --- | --- | --- | --- |
| schemaTag | yes | string | exactly `sporta/quality-gates/human-review@1` |
| recordId | yes | string | bounded (see the bounds table) |
| reviewer | yes | string | bounded; see the reviewer semantics below |
| reviewedAt | yes | string | `YYYY-MM-DD`, a real calendar date (2025-02-30 is rejected); input data, never a wall-clock read |
| scope | yes | string | bounded; what was reviewed, precisely |
| isHumanAttestation | yes | boolean | false iff this is the automated self-check record |
| checklistResults | yes | array | one entry per checklist item, exactly; each `{itemId, result: pass|fail, notes?}` |
| notes | yes | string | bounded free-text |

Reviewer semantics (fail-closed): a record with `isHumanAttestation:
false` MUST carry the reserved reviewer `automated-pipeline-self-check`
(a self-check record can never masquerade under a human name), and a
record with `isHumanAttestation: true` MUST NOT carry it (the reserved id
cannot sign a human attestation).

Bounds (pinned to `REVIEW_BOUNDS` in `src/review.ts`):

| bound | value |
| --- | --- |
| maxRecordIdLength | 200 |
| maxReviewerLength | 200 |
| maxScopeLength | 2000 |
| maxItemNotesLength | 500 |
| maxNotesLength | 2000 |

## 3. The checked-in self-check record

`fixtures/human-review/w803-fixture-self-check.json` is the
automated-pipeline SELF-CHECK record for the fixture demo run. It exists
so the demo run (`bun run gate`) exercises the record format and the
human gate's complete-record path with an honest document: every
visual-inspection item is satisfied by the deterministic re-render /
byte-pin path named in the item's requirement, the notes say so per item,
`isHumanAttestation` is false, and the reviewer is the reserved
`automated-pipeline-self-check`. It is NOT a claim that a human reviewed
production output. A production release requires a human record
(`isHumanAttestation: true`, a real reviewer name) — the boundary is
restated in docs/GATES.md §boundaries.

## 4. How the gate consumes records

| record state | recordStatus | gate verdict | release effect |
| --- | --- | --- | --- |
| absent (undefined/null) | absent | NOT-RUNNABLE | PENDING-HUMAN-REVIEW (machine gates green) or FAIL |
| structurally invalid | malformed | NOT-RUNNABLE | same as absent — the JSON path and reason are accounted |
| valid but missing items | incomplete | NOT-RUNNABLE | same as absent — the missing item ids are accounted |
| complete, all pass | present-complete | PASS | release may PASS |
| complete, some fail | present-complete | FAIL | release FAIL — the failed item ids are accounted |
