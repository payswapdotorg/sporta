# @sporta/quality-gates — REVIEW.md

The normative human-review document for W803: the checklist (§checklist,
the mirror of `src/humanReview.ts` `REVIEW_CHECKLIST`, pinned row-for-row
in both directions by `test/policyDoc.test.ts`), the record format
(§record-format), and the discipline (§discipline — what a record proves
and what it deliberately never proves).

---

## §checklist — the w803-review-checklist-v1 items

Every item is a requirement stated so a reviewer knows exactly what to do.
A release's human gate passes only when a record covers EVERY item with
`pass` (or honestly fails the release with `fail`).

| itemId | requirement |
| --- | --- |
| clips.w503-anime-fixture | One rendered clip per renderer path, visually inspected — the anime-renderer path: the W503 fixture clip's frames are inspected (as the authored SVG markup they deterministically are): every manifest entity drawn where its manifest entry says, caption windows positioned inside their windows, the watermark line present, no visual artifact the machine gates cannot see (unreadable text, wrong palette harmony, clipped markers). |
| clips.w603-match-fixture | One rendered clip per renderer path, visually inspected — the 3D match-renderer path: the W605 corrections-match fixture's manifest frames are inspected: entities at their recorded positions, the HUD score/clock line matching the timeline state, event chips legible and inside their windows, no visual artifact the machine gates cannot see. |
| clips.w604-directed-fixture | One rendered clip per renderer path, visually inspected — the directed-rundown path: the W605 directed-review fixture's manifest is inspected: each window's camera block and slot as the plan declares, the review window's replay profile, markers presented once and inside their windows, no visual artifact the machine gates cannot see. |
| reports.temporal-gate | The temporal-stability gate's source report is read in full — the verdict line AND every check with its measured value and threshold; the failing checks (if any) are understood, not just counted. |
| reports.scene-gate | The scene-correctness gate's source reports are read in full — one per fixture: per-dimension verdicts, every check with its measured value, and the findings accounting (recorded vs dropped beyond the cap). |
| reports.release-accounting | The release report's own gate table and accounting are read: every declared gate has its row, every NOT-RUNNABLE row carries its accounted reason, and the ledger reconciles (gates = pass + fail + not-runnable). |
| scope.fixture-demo-confirmed | The run under review is confirmed to be the fixture-based demo scope (deterministic checked-in fixtures, no production traffic), and the honesty boundaries of docs/GATES.md §boundaries have been read and understood. |

## §record-format — the checked-in review record (JSON)

A review record is a JSON document with the schema tag
`sporta/quality-gates/human-review@1` and the checklist version
`w803-review-checklist-v1`. Field bounds are the §structural-bounds of
GATES.md. Validation is fail-closed: unknown keys, unknown checklist ids,
unknown result values, impossible dates, and over-bound fields are
REJECTED with a typed issue (code + JSON path) — never partially
interpreted, never coerced.

| field | type | rules |
| --- | --- | --- |
| schemaTag | string | exactly `sporta/quality-gates/human-review@1` |
| recordKind | string | `human-review` (a person's attestation) or `pipeline-self-check` (the automated pipeline's own checklist execution) |
| checklistVersion | string | exactly `w803-review-checklist-v1` |
| reviewer | string | non-empty, at most 200 characters |
| reviewedAt | string | a real calendar date `YYYY-MM-DD` (validated by pure arithmetic — impossible dates rejected) |
| scope | string | non-empty, at most 2000 characters — must identify WHAT run was reviewed |
| items | array | one entry per checklist item, each `{ checklistItemId, result, notes? }` with `result` ∈ `pass` \| `fail` and `notes` at most 2000 characters; every checklist item exactly once (missing → incomplete; unknown or duplicate → malformed) |
| notes | string? | optional, at most 4000 characters |

A record is **complete** iff it is structurally valid AND covers every
checklist item exactly once. The gate verdict: complete + all `pass` →
`PASS`; complete + any `fail` → `FAIL` (an honest failed review fails the
release); missing / malformed / incomplete → `NOT-RUNNABLE`, which makes
the release `PENDING-HUMAN-REVIEW` when every machine gate passes.

The fixture-demo run's record is checked in at
`fixtures/human-review/self-check-record.json` (see §discipline).

## §discipline — what a record proves, and what it never proves

- **A record accounts that review HAPPENED and WHAT was checked.** It
  cannot verify review QUALITY: a signed all-pass record proves the
  checklist was executed and signed, not that the execution was good.
  That boundary is inherent to records and is documented, not papered
  over.
- **The demo record is a pipeline self-check, not a human attestation.**
  The checked-in `self-check-record.json` has
  `recordKind: "pipeline-self-check"` and reviewer
  `w803-automated-pipeline`: it records the W803 delivery pipeline's own
  execution of the checklist over the deterministic checked-in fixtures
  (clip frames inspected as authored SVG/manifest data; gate reports read
  as machine-generated JSON). It exists so the fixture-demo run exercises
  the complete-record path end to end. It is NOT a claim that a human
  reviewed production output — no production output exists — and the
  record kind, reviewer, and `humanAttested: false` travel verbatim into
  the release report, so a PASSing fixture-demo report can never be
  mistaken for a human attestation.
- **A human-reviewed release needs a `human-review` record.** A person
  performs the §checklist over the run being released (for the fixture
  demo: the rebuilt clips and reports; for a future production release:
  the production clips and reports), then completes the record with their
  own reviewer identity and date. The record format is identical; only
  the kind and the honesty of the executor differ.
- **Fail-closed everywhere.** A missing, malformed, or incomplete record
  never passes and never silently skips: the release verdict is
  `PENDING-HUMAN-REVIEW` (when the machine gates pass) with every issue
  accounted in the report's `humanReview` section. Recording a `fail`
  result is a completed review — it fails the release honestly rather
  than degrading to a pending state.
- **No wall clock.** `reviewedAt` is authored data (the date the reviewer
  signed), validated as a real calendar date by pure arithmetic. The
  evaluation core never reads a clock; the record is data, not a
  timestamping authority.
