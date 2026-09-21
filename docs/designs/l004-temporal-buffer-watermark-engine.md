# L004 — Temporal Buffer / Watermark Engine: Design

Status: DESIGN (Wave 1, Worker A) — for TL review; Wave 2 implementation
Date: 2026-09-21
Related: `docs/contracts/live-reality.md` (FROZEN §3-§4, §9), ADR-010, `docs/status/mvp-and-live-reality-status.md` (Wave 0 mapping decisions), `packages/live-source` (L002 — the six delivery scenarios this engine must survive), the L003 design (the consumer of this engine's output), `docs/work-items/mvp-and-live-reality-work-items.md` (L004 acceptance)

## 1. The problem being solved

Live sources deliver observations with jitter, delay, drops, out-of-order
swaps and reconnects (L002's six configurable scenarios, all deterministic
and seeded). The frozen temporal rules require: event time authoritative, a
BOUNDED reorder window, out-of-order handled explicitly, extrapolation
marked, lag exposed rather than hidden, and "when a source falls behind the
renderer, the system exposes lag/degraded state rather than pretending the
feed is current."

L004 is the engine between the source and the L003 updater: it buffers,
reorders, watermarks, accounts lag, and hands the L003 updater a
deterministic, in-order, honestly-accounted observation stream.

## 2. Design decisions

### D1 — The watermark is EVENT-TIME and PER-SOURCE

The engine tracks, per `sourceId`:

```text
SourceWatermarkState {
  watermark: Watermark           // frozen shape { watermarkMs, sequence }
  maxEventTimeMs                 // largest event time ever seen
  lastContiguousSequence         // largest source sequence with no hole below it
}
```

Watermark rule (conservative, the frozen §1 semantics of L002's emission
watermark plus the engine's own reorder accounting):

```text
watermark.watermarkMs = min(
   sourceEmissionWatermark,                      // what the source guarantees
   maxEventTimeMs - reorderWindowMs              // the bounded reorder window
)
watermark.sequence  = the largest CONTIGUOUS applied sequence (holes visible)
```

The engine NEVER advances the watermark past an unfilled sequence hole or an
observation younger than the reorder window. The watermark is MONOTONIC
(the frozen §3 rule: "monotonically advancing version and match-time
watermark"): a new minimum can only hold it back, never regress it.

### D2 — The bounded reorder window and the buffer admission rule

`reorderWindowMs` (default 250 ms — 2x the L002 default tick of 100 ms;
configurable per session, MUST be > 0, validated fail-llosed). Admission:

1. An arriving observation with `eventTimeMs >= watermark.watermarkMs` is
   ADMITTED to the buffer.
2. An arriving observation with `eventTimeMs < watermark.watermarkMs` is
   LATE: it is counted (`lateDropped`) and DROPPED — the window has already
   closed; the frozen rules forbid unbounded reordering ("A bounded reorder
   window is allowed" — bounded means drops beyond it are honest).
3. The buffer is BOUNDED: `maxBufferedBatches` (default 64). When full, the
   OLDEST in-window observation is FLUSHED to the updater ahead of watermark
   closure (applied in order with its event time; the flush is counted in
   `bufferOverflows`) — the engine never blocks the source and never drops
   in-window data due to fullness without accounting.

### D3 — The watermark/lag state machine (the core)

Per source, five states (explicit, honest, operator-visible):

```text
                ┌────────────────────────────────────────────────┐
                v                                                │
  BOOT ──first obs──> NOMINAL ──hole/delay──> REORDERING ──hole filled──> NOMINAL
                        │                          │
                        │ watermark lag >          │ buffer full OR
                        │ lagBudgetMs              │ no progress for
                        │                          │ stallBudgetMs
                        v                          v
                     DEGRADED  <──recovery──  STALLED
                        │                          │
                        └──── source recovery accounting ──────────────┘
```

- `BOOT`: no observations yet. First observation → `NOMINAL`.
- `NOMINAL`: gaps ≤ the reorder window; watermark advances with arrivals.
- `REORDERING`: a sequence hole or an out-of-order arrival is open; the
  buffer holds younger observations until the hole fills or the window
  closes them. Exit: hole filled → `NOMINAL`; window closes → flush
  in-order → `NOMINAL` (the drop is counted); no progress for
  `stallBudgetMs` → `STALLED`.
- `DEGRADED`: `renderClockMs - watermark.watermarkMs > lagBudgetMs` (the
  source is behind the renderer beyond the budget). The frozen rule is
  explicit: expose lag/degraded state rather than pretending currency. The
  state is carried on the live view (the L005 renderer consumes it), the
  watermark keeps advancing honestly underneath, and the §9 `watermark-lag`
  telemetry is fed continuously. Exit: lag back within budget → `NOMINAL`.
- `STALLED`: no in-window progress for `stallBudgetMs` (default 3000 ms).
  The engine flushes the buffer (in-order, honest event times), reports
  `stalled` and holds. A subsequent observation (post-reconnect, carrying
  L002's `recovery` accounting) → gap accounting → `DEGRADED` (recovery
  window) → `NOMINAL`.

Determinism: the state transitions are pure functions of
`(observation arrivals, renderClock ticks)` — both injected; no wall clock
inside the engine.

### D4 — Dropout and reconnect handling against L002's six scenarios

The engine's contract is the six `LiveScenarioKind` behaviors (the L002
test matrix doubles as the L004 acceptance matrix):

| L002 scenario | Engine behavior (pinned by Wave 2 tests) |
| --- | --- |
| `normal` | state `NOMINAL`; watermark = min(emission, maxEvent − window); zero drops; zero extrapolations |
| `jitter` (±60 ms schedule jitter) | arrival order is jittered but event times are not: no reordering needed beyond the window; state stays `NOMINAL`; `lateDropped = 0` |
| `delay` (a window of +1500 ms latency) | watermark falls behind the render clock by the delay → `DEGRADED` for the window's duration (the §4 rule: expose lag); on recovery the watermark catches up monotonically; no drops (the delayed data is still in-window when it arrives IF delay < window… when delay > reorderWindowMs the late arrivals are dropped and counted — honest) |
| `drop` (15% per-tick loss) | sequence holes: the engine holds younger observations in `REORDERING` until `min(emission watermark, window)` closes each hole; closed holes increment `droppedObservations`; the watermark still advances (bounded staleness) |
| `out-of-order` (adjacent swaps) | swapped arrivals re-sort in the buffer (the `(eventTimeMs, sequence)` order); zero or minimal `lateDropped` when the penalty < window; the updater receives the corrected order |
| `reconnect` (an 8-tick gap + recovery window) | `STALLED` after the stall budget; the first post-reconnect observation carries `recovery` — the engine consumes the accounting VERBATIM (`missedUpdates`, `gapDurationMs` — surfaced in telemetry, never smoothed), enters `DEGRADED` for the recovery window, then `NOMINAL`; the missed window is a visible hole in `watermark.sequence` (never renumbered) |

### D5 — Interpolation/extrapolation markers (live layer, per the Wave 0 decision)

The engine itself does NOT interpolate positions (interpolation invents
data). It MARKS:

- `carried` (the L003 `detected:false` path): the source's own honest
  last-known carry — passed through, counted as `extrapolatedObservations`.
- `gap`: a closed hole or reconnect window — emitted as a
  `GapMarker { fromSequence, toSequence, gapDurationMs }` in the stream
  report (the L002 `recovery` accounting generalized to engine-detected
  holes).

The frozen `UncertaintyStatus` is NOT extended (Wave 0 decision); markers
live in the live-layer stream report and the §9 counters.

### D6 — Lag accounting (the §9 counters the engine owns)

Per source, per report window:

```text
TemporalEngineStats {
  lateDropped              // beyond-window arrivals (counted, never silent)
  droppedObservations      // sequence holes closed by the watermark
  bufferOverflows          // fullness flushes
  extrapolatedObservations // carried (detected:false) applications
  reconnects               // recovery-accounted reconnects
  watermarkLagMs           // renderClock - watermark (the §9 watermark lag)
  effectiveUpdateRate      // applied observations / elapsed session time
  state                    // BOOT | NOMINAL | REORDERING | DEGRADED | STALLED
}
```

`source-to-ingest` and `ingest-to-SWM` latencies come from the observation
dual clocks + the L003 report timestamps; `SWM-to-render` is the L005/L006
lane. The engine exports its counters for the L006 aggregation.

### D7 — Module plan (Wave 2)

```text
packages/live-temporal/          // Worker A, Wave 2 (with L003's live-swm)
src/
  engine.ts        // TemporalBufferEngine: admit(LiveObservation),
                   //   tick(renderClockMs) -> DrainResult
  watermark.ts     // the D1 arithmetic (pure, property-tested)
  states.ts        // the D3 state machine (pure transitions)
  stats.ts         // D6 counters + canonical serialization
test/
  scenarios.test.ts  // the D4 matrix over L002's six scenarios (seeded)
  watermark.test.ts  // monotonicity, boundedness, hole visibility
  stall.test.ts      // STALLED/DEGRADED transitions, reconnect accounting
```

The engine's `DrainResult` (in-order observations + gap markers + stats) is
the L003 updater's input — the two packages compose:
`LiveSource → TemporalBufferEngine → LiveSwmUpdater → WorldModelEngine`.

## 3. Acceptance mapping (L004 work item)

| Acceptance clause | Design element | Wave 2 test |
| --- | --- | --- |
| bounded reorder window | D2 (admission + late-drop accounting) | late-beyond-window arrivals are counted and dropped; in-window arrivals are reordered and applied in event-time order |
| interpolation/extrapolation markers | D5 (carried + gap markers, live layer) | `detected:false` → carried counter; reconnect → gap marker with the L002 accounting verbatim |
| lag accounting | D6 (`watermarkLagMs`, DEGRADED state) | the delay scenario drives lag > budget → DEGRADED surfaced; recovery → NOMINAL |
| explicit degraded state | D3 (the state machine) | every state transition is pure and pinned per scenario |
| no fabricated certainty | D1/D2/D5 (monotonic conservative watermark; drops counted; gaps visible; no interpolation) | hole in `watermark.sequence` never renumbered; zero fabricated positions |

## 4. Contract-change requests

NONE. `Watermark {watermarkMs, sequence}` is used verbatim (frozen); the
`LiveObservation` input is L002's shape (including the TL-accepted additive
`recovery`); all engine additions (`SourceWatermarkState`, `GapMarker`,
`TemporalEngineStats`, the state vocabulary) are live-layer data outside
`packages/contracts`, consistent with the Wave 0 mapping decisions.

## 5. Risks (honest)

- The default budgets (window 250 ms, lag 2000 ms, stall 3000 ms) are
  calibrated against L002's default scenario knobs, not a real provider —
  real-provider calibration is L008/L009 work (Wave 2+) when a real feed
  exists.
- The buffer-fullness flush (D2.3) applies slightly-out-of-order data in the
  pathological case; the flush is counted and the watermark arithmetic keeps
  the SWM's own ordering guarantees intact (L003's rewind protection).
- Render-clock injection at the transport layer (L005/L006) must use the
  same deterministic clock discipline (no wall clock in the core) — an
  integration constraint recorded for the C/B lanes.
