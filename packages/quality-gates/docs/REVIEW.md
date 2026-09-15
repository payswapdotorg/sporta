# @sporta/quality-gates — REVIEW.md

**The normative human review document for W803's human quality checks
gate.** `@sporta/quality-gates` · canonical reference:
`packages/quality-gates/src/humanReview.ts` (`HUMAN_REVIEW_CHECKLIST`,
`SELF_CHECK_CHECKLIST`, `validateHumanReviewRecord`).

The human quality checks gate is fail-closed: a missing, malformed, or
incomplete review record never passes and is never silently skipped (the
release verdict becomes `PENDING-HUMAN-REVIEW` when the machine gates
pass — GATES.md §2). This document defines WHAT a review checks (§1),
what the automated pipeline's honest self-check can check instead (§2),
and the record format that captures the result (§3). `src/humanReview.ts`
is the executable mirror of §1, §2, and the identity table in §3, pinned
row-for-row (value AND order, both directions) by
`test/humanReview.test.ts` — a change to either side without the other
fails the suite.

---

## 1. The human-review checklist (what a HUMAN reviews)

One record kind completes this checklist: `human-review`. The reviewer
must verify every item below; each is recorded as `pass` or `fail` (any
`fail` is a definitive human gate failure — GATES.md §2).

Checklist identity: `w803-human-review-checklist@1`.

| itemId | the reviewer must verify |
| --- | --- |
| temporal-clip-visual | Anime clip path: the rendered fixture clip's SVG frames viewed frame-by-frame; no identity pop-out, style change, or geometry jump is visible. |
| scene-match-visual | 3D match path: the rendered match fixture's frames viewed; the HUD score/clock claims are right, identities are stable, markers sit at their events. |
| scene-directed-visual | Directed rundown path: the rendered rundown's frames viewed across its live windows, camera cuts, and the review window; presentation matches the plan. |
| gate-report-read | The full machine gate report read end-to-end; every check and measured value understood; failing checks (if any) triaged to an owner. |

The first three items are the work item's "one rendered clip per renderer
path visually inspected": the anime clip path (the W503 fixture clip),
the 3D match path (the W605 clean-match fixture), and the directed
rundown path (the W605 directed-review fixture). They are VISUAL checks —
the point of the human gate is exactly the judgment a person adds on top
of the machine measurements.

## 2. The automated pipeline self-check checklist (the machine-verifiable analog)

One record kind completes this checklist: `automated-pipeline-self-check`.
Each item below maps 1:1 to a §1 item — it is what the pipeline can
honestly verify WITHOUT a person. The checked-in demo record
(`fixtures/human-review-self-check.json`) completes THIS checklist; it is
the automated demo run's honest record, NOT an attestation that a human
reviewed anything (§5).

Checklist identity: `w803-self-check-checklist@1`.

| itemId | the pipeline must verify |
| --- | --- |
| temporal-clip-rendered | Anime clip path: the real W503 clean fixture clip rendered through the real renderer (frames and manifest produced). |
| scene-match-rendered | 3D match path: the real W605 clean-match fixture built through the real W601-W603 seams. |
| scene-directed-rendered | Directed rundown path: the real W605 directed-review fixture built through the real W604 direction chain. |
| gate-report-read | The machine gate report produced, schema-tag verified, and read back (parsed) by the pipeline. |

The 1:1 mapping to §1:

| human item (§1) | self-check item (§2) | what the self-check honestly establishes |
| --- | --- | --- |
| temporal-clip-visual | temporal-clip-rendered | the clip the human would watch EXISTS, was rendered by the real renderer, and is available for inspection — not that anyone watched it |
| scene-match-visual | scene-match-rendered | the match output the human would watch exists, built through the real seams |
| scene-directed-visual | scene-directed-rendered | the directed rundown exists, built through the real W604 chain |
| gate-report-read | gate-report-read | the machine report was produced and read back (both kinds really do read the report) |

## 3. The review record format (the checked-in JSON document)

A review record is one JSON document. Its identity and format bounds:

| field | value |
| --- | --- |
| record schema tag | sporta/quality-gates/human-review@1 |
| human checklist id | w803-human-review-checklist@1 |
| self-check checklist id | w803-self-check-checklist@1 |
| notes bound (characters) | 500 |
| reviewer name bound (characters) | 100 |
| reviewer role bound (characters) | 100 |
| checklist results bound (entries) | 16 |
| release-input fixture name bound (characters) | 64 |
| release-input scene runs bound (fixtures) | 8 |

The exact shape (fail-closed: unknown keys, wrong types, unknown result
values, duplicate item ids, over-bound fields, or a checklist id that
does not match the record kind are `record-malformed` and fail loud with
the JSON path):

```json
{
  "schemaTag": "sporta/quality-gates/human-review@1",
  "recordKind": "human-review",
  "checklistId": "w803-human-review-checklist@1",
  "reviewer": { "name": "<a named person, at most 100 chars>", "role": "<their role, at most 100 chars>" },
  "date": "<authored YYYY-MM-DD, month 01-12, day 01-31>",
  "checklistResults": [
    { "itemId": "<one §1 itemId>", "result": "pass" },
    { "itemId": "<one §1 itemId>", "result": "fail" }
  ],
  "notes": "<free text, at most 500 chars, possibly empty>"
}
```

- `recordKind` selects the checklist: `"human-review"` completes §1's
  checklist; `"automated-pipeline-self-check"` completes §2's. The
  `checklistId` must be the CURRENT id of that kind's checklist — a
  record carrying an older or mismatched checklist id is
  `record-malformed` (fail-loud, no silent acceptance of stale records).
- `date` is an AUTHORED calendar date — a fixed string in the record,
  never read from a clock anywhere in this package.
- **Completeness** is semantic: the `checklistResults` must cover
  EXACTLY the current checklist's items — missing items, or results for
  items the current checklist does not define, make the record
  `record-incomplete` (an accounted FAIL: the release becomes
  `PENDING-HUMAN-REVIEW`, never a pass, never a silent skip).
- **Sign-off fields**: `reviewer` (name + role) and `date` are the
  sign-off. A record with every item `pass`, both sign-off fields
  present, and full checklist coverage is the only `PASS`.
- A complete record with one or more items `fail` is a definitive human
  FAIL (`checklist-item-failed`) — the review happened and found
  problems; the release fails.

## 4. Completing a record for a release

1. Run the release evaluation and read the machine gate report end to
   end (the `gate-report-read` item).
2. Obtain each renderer path's rendered fixture output and watch it (the
   three `*-visual` items). For a production release these are the
   actual outputs under release, not the demo fixtures.
3. Author the record: your name, your role, today's date (authored, as a
   string), one result per §1 item, and honest notes (what you saw, what
   you triaged).
4. Supply the record to the release evaluation
   (`humanReview` in the release input) and re-run. The release verdict
   is `PASS` only when every blocking gate passed and your record is
   complete.

## 5. The honesty boundary

A self-check record proves the checklist PROCEDURE ran mechanically and
that the outputs exist for inspection; it is NOT evidence that a human
looked at pixels, and the gate cannot verify review QUALITY even for a
`human-review` record (GATES.md §7). The record's `recordKind` is
carried verbatim into every report row and section — a report produced
from the self-check record says so, everywhere, and never claims a human
attestation. A production release requires a `human-review` record
completed by a named person per §4.
