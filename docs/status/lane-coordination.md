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
