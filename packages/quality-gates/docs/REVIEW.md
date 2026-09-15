# W803 human review — the checklist and the record format

The human half of the W803 release gates. The machine gates (temporal
stability, scene correctness) measure what the evaluation packages measure;
this gate records that a HUMAN looked at the output and signed off — the
acceptance criterion's "human/automated quality checks".

## The checklist

A completed review records a result for every item (pinned to
`HUMAN_CHECKLIST` in `src/policy.ts`):

1. **`one-rendered-clip-per-renderer-path-inspected`** — one rendered clip
   per renderer path (the anime batch path, the 3D match path, the 3D
   directed path) visually inspected: entities visible where the scene says
   they should be, HUD readable, no visible flicker/teleport artifacts on
   playback.
2. **`gate-report-read-in-full`** — the release report (gate table,
   measured summaries, accounting) read in full; every FAIL or
   NOT-RUNNABLE reason understood, not just the verdict.
3. **`sign-off-recorded`** — the reviewer's name/role and date recorded in
   this record (the sign-off IS this record).

Item results: `pass` | `fail` | `not-checked` (an incomplete review is
`not-checked` on something — and the gate goes PENDING-HUMAN-REVIEW,
never PASS).

## The record format (JSON)

```json
{
  "recordVersion": "sporta/quality-gates/human-review@1",
  "reviewer": "<name or role>",
  "reviewedAtMs": 1789500000000,
  "checklist": {
    "one-rendered-clip-per-renderer-path-inspected": "pass",
    "gate-report-read-in-full": "pass",
    "sign-off-recorded": "pass"
  },
  "notes": "<bounded free text: what was inspected, anything noteworthy>"
}
```

Parsed fail-closed by `src/human.ts`: a missing, malformed, or incomplete
record makes the release **PENDING-HUMAN-REVIEW** — never PASS, never
silently skipped. A complete record with a `fail` item is a completed
review that FAILS the gate (a real finding, not a process gap).

## Honesty: the demo record is NOT a human attestation

The checked-in record (`DEMO_RECORD` in `src/human.ts`) is the automated
pipeline's SELF-CHECK: it proves the gate machinery reads and honors
records, and that the CLI's demo run has a complete record to consume. Its
`reviewer` field says so explicitly. A REAL release sign-off requires a
REAL record — a human reviewer who did the checklist above, with their name
on it. The gate cannot tell the difference (a forged record with a human
name would parse) — reviewing is a trust act; this format makes it a
RECORDED one.

## What this gate does NOT do

- It cannot verify review QUALITY (that the human looked carefully).
- It cannot force a review to happen (it can only refuse to pass without
  one).
- It does not capture screenshots or render output (the clips live in the
  packages' fixtures; the review inspects them where they render).
