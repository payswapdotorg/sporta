# Lane coordination — 2026-09-15 15:00 UTC

Split declared by session A (the replay-console TL; console recovered on the
session-A box, operator logged in 14:46 UTC, lesson-121 dispatch ruling
restorable there). Written to main so the other lane's next fresh-fetch
surfaces it before dispatching the remaining items. New file — no conflict
with in-flight merges.

## Claims

- **Session A:** W803 (visual quality gates) — dispatches through the replay
  console as a watchable agents-tab session the moment W605 merges (its only
  unmet dependency). Branch will be `w803-visual-quality-gates` (matching the
  existing naming convention). Session A also owns W806 (release readiness) —
  TL-owned per `docs/work-items/work-items.md`, executed as the TL review
  with the same evidence standards.
- **Session B (unchanged, in flight):** W605 flight 2 + W804 flight 2
  (transit WIPs `ce518f9` / `6fd6fd3`), plus verify+merge of both.

## Collision guards (both sides)

- Before dispatching any item, check branch existence (`git ls-remote`):
  `w803-visual-quality-gates` exists = session A already dispatched; stand
  down any duplicate (the W305 stand-down precedent).
- Before merging, fresh-fetch; a docs-only main movement (like this note) is
  not a collision — rebase/merge over it.
- Evidence rows and session-log entries stay in the existing files; session A
  will append, never rewrite.

## Rationale

The remaining critical path to 50/50 by midnight UTC is serial after W605:
W803 (needs W605) then W806 (needs W801-W805 all complete). Splitting the
 undispatched remainder across lanes removes the single-lane bottleneck while
keeping every delivery behind the same TL-verification gate.

## Lane coordination — 2026-09-26 closure lanes (supersedes the 2026-09-15 split)

Declared by the TL station after the 2026-09-26 verdict ("handoff
accepted, execution not yet resumed"). The repository had not moved since
the Wave-4-B merge `239b6fd` (2026-09-25 16:09 UTC). This note re-opens
execution with the three closure lanes the verdict specified, run in
parallel where the 4 GB sandbox allows, all behind the same TL
verification gate as before.

### Lane A — R606 / SWM / HF

- First increment: the **ellipse/circle-constrained calibration solve**
  (the measured next step recorded in the R606 row: calibrator v0.1.0
  refuses the majority-orientation windows because the visible family is
  arc segments; the center circle is strongly detected).
- Measured on the committed corpus bytes (`scripts/evidence/spr-corpus-bytes/`:
  b8p3, b5, b3, b1-wide) — real in-play 640×360 broadcast frames, no
  synthetic substitution. Higher-resolution acquisition remains the
  alternative path but the acquisition chain is reset-dead; corpus-first.
- Branch: `r606/ellipse-constrained-solve`. Honest outcome required:
  calibrated windows with measured confidence + validation, or a typed
  refusal with the next measured increment — never a lowered bar.

### Lane B — R607 / platform / providers

- First increment: the **hosted-acceptance proof shape executed locally**
  — current main → fresh-browser golden path (upload → rights → compute →
  processing → four outputs → Watch → Reality Switcher → Library) →
  full process stop/restart (the local analog of redeploy) → same
  identity/session/library/watch/artifacts recover.
- The true hosted redeploy (Vercel) is **PAT-blocked** this session: the
  sandbox reset wiped the token chain. Record the blocker + the exact
  acceptance evidence captured locally; the hosted run re-executes when
  credentials return. No mock substitutes.
- Branch: `r607/local-golden-path-recovery`.

### Lane C — SPR quality / visual QA / live presentation

- First increment: the **Tier-2 push on subject-toon** (identity 3.20 /
  motion 3.13 / scene 2.73 / critical 15 vs the frozen bar: every axis
  ≥ 4.0, 0 critical, TL approval). Iterate the renderer quality within
  the frozen engine contract (determinism + preservation gates must hold
  byte-exact on regression cells); re-run the frozen-protocol VLM
  scorecard; record near-misses honestly if the bar is not reached.
- Second increment: the deferred neon scorecard + the live presentation
  surface (the Realities Lab pattern) with TL visual review.
- Branch: `spr/w5a/tier2-push`.

### Collision guards (same as before)

- Branch existence check before starting (`git ls-remote` unavailable for
  push this session — check local branches + the fresh-clone remote refs;
  the remote has not moved, verified at session start).
- TL merges each lane only after independent verification of its evidence.
- Status rows and session-log entries are appended by the TL only after
  verification; workers never self-record completion.
