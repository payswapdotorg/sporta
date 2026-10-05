# R606 visual-gate prep — the flight that makes the HUMAN gate performable

## The gate (the operator's, never a worker's)

**R606 — the human visual gate** (`docs/roadmap/mvp-reality-engine-roadmap.md`):
"A human can watch the outputs and identify the same match/event and see
meaningful stylistic differences." MVP success requires R601–R607
(`docs/roadmap/mvp-and-live-reality-roadmap.md` — R606 ⬜ and R607 ⬜ are the
open product gates after the R306 arc's closure).

The gate's VERDICT is the operator's eyes. This flight (the prep) never
judges the visuals — it makes the gate PERFORMABLE: the four realities
rendered through the REAL pipeline, exported OUTSIDE the repo for watching.

## What this flight did (measured, typed)

- **The driver** (`visual-gate-prep.ts`): the golden-path battery's own walk
  shape — the same server composition (in-process, the deterministic
  stepping clock, the seeded selection plane), the same REAL pitch-scene
  clip (320×240, 2 s, audio — `generateTestMp4`, no committed fixture), the
  same four render dispatches (`anime.prototype` + `tactical.prototype` +
  `game-3d.prototype` + `anime-npr.prototype`, the user-explicit compute
  selection), the same polls to terminal, the same watch acquisition, and
  the same four kinds' byte-route reads — **sha-256 re-verified at the
  receiving boundary + the `ftyp` container magic + the byte-length claim**
  — then the bytes EXPORTED (never committed; the no-committed-media
  doctrine stands).
- **The run (2026-10-05T20:36Z, first flight)**: all four walks green —
  the media job terminal `succeeded`, the four render jobs terminal
  `succeeded`, the watch playback `authorized`, the four reads 200 with
  integrity verified. The exports: `original` 38 331 B / `tactical`
  15 297 B / `three-d-game` 288 485 B / `anime-npr` 503 707 B (the full
  shas in the record). The record: `visual-gate-prep.json`.
- **The console surfacing (the TL station's own)**: the outputs + a
  manifest (`manifest.json`) land in the operator-viewing dir (the replay
  console's public surface) — the console page carries the gate's question,
  the four players, and the verdict line "the verdict is the OPERATOR'S".
  The operator answers in the chat; the verdict lands as its own record
  flight.

## The honest scope (what this flight is NOT)

- This is NOT the gate itself — no verdict is recorded here, none is
  implied. The outputs are the golden-path battery's own fixture class
  (the 2 s synthetic pitch scene); a longer or real-footage re-run is one
  command away (`--duration-seconds`, `--scene`) — the gate's substance
  (the same event + the stylists' differences) is carried honestly by the
  REAL pipeline renders.
- The hosted plane's 4/4 closure is a SEPARATE measurement
  (`scripts/evidence/r306-hosted-reflight/`, REPORT.md §11) — this flight
  is local-only by design (the hosted outputs are ephemeral at the
  keep-alive, the ephemerality doctrine).

## Re-run

See `commands.md`. The driver is fail-closed: any step's unexpected HTTP
status, terminal state, sha mismatch, or container magic → exit 1 with the
typed message, nothing exported laundered.

## The validator

`validate-evidence.ts` — re-hashes the exported files against the record
(when present) + verifies the record's own shape (four outputs, integrity
flags, the closed set of kinds); the negative battery refuses a tampered
record (exit 1, the check named).
