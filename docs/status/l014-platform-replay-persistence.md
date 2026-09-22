# L014 platform side — the durable live/replay record + recovery

Date: 2026-09-21 (Wave 3, Worker B — platform/media/live transport)
Branch: `work/l014-platform-j011-connection` (base `03d79f42`)
Design record: `docs/research/l014-platform-replay-persistence-and-recovery.md`

## What this delivers

The platform half of L014 (live/replay continuity) — exactly the boundary
Worker C's presentation side (merged @7d9a375) recorded in three places:
durable persistence of the recorded live-window state keyed to the session,
and reload/restart/redeploy recovery of the replayable state. Plus the
live connection/recovery hardening this lane owns.

### 1. The durable replay-record seam (extend-not-fork — no route, no wire)

- `apps/web/src/server/live/persistence.ts` — the `LiveReplayPersistence`
  port, the `liveReplaySink` adapter (the transport's recorded-window events
  → the persistence), and the `withDurableReplayRecord` decorator (the same
  pattern as `withLiveTelemetry`, OUTSIDE telemetry, recovery-read only).
- `apps/web/src/server/platform/live/sqlite-replay-store.ts` — the sqlite
  adapter (the J014 identity-plane discipline: `bun:sqlite`, WAL +
  busy-timeout, frames stored VERBATIM as wire documents, deep-clone-on-read,
  only genuinely completed windows serve, ordinal-1 reset for a new window,
  the interrupted-window listing for operator visibility).
- `apps/web/src/server/live/transport.ts` — the ADDITIVE `recordSink`
  option: the channel reports every finite-window frame it records and the
  window's completion — EXACTLY the in-memory record's data (absent →
  byte-identical behavior; the presentation battery re-run green).
- `apps/web/src/server/composition.ts` — the `liveReplay` option + the
  Bun-gated sqlite construction (`SPORTA_LIVE_REPLAY_DB`, default
  `db/live-replay.db`; the W911 shim refusal → the honest in-memory record +
  banner under the bundled Node runtime).

### 2. The restart/redeploy semantics (the L017 rehearsal)

| Platform state after a restart | Stream route | Replay route |
|---|---|---|
| persisted `complete` | **410 + replay pointer** (never a second live window over a session that completed one) | 200 — the persisted record, frames VERBATIM |
| partial rows only (interrupted window) | fresh window honestly runs (hello + ordinal 1) | `no-record` 200 (partial never serves) |
| nothing persisted | today's behavior | today's behavior |

The recovery precedence (the decorator): the in-memory `complete` /
`live-window-open` answers win (the live instance is authoritative for its
own window); `no-record`/null falls back to the PERSISTED complete record —
which also outlives the source registration (a session's replayable state
does not die with its live-source registration).

### 3. Evidence

- `apps/web/test/l014-platform-persistence.test.ts` — 10 tests: the sqlite
  store (verbatim frames, interrupted-never-serves, the completion
  authority, deep-clone-on-read, ordinal-1 reset, idempotency + close
  refusal), the sink (persists EXACTLY the in-memory record; a transport
  WITHOUT the sink byte-identical), the decorator (all four precedence
  cases).
- `apps/web/test/l014-platform-recovery.test.ts` — the REAL restart battery
  (the J014 three-process pattern): a real child process creates two REAL
  upload sessions with live-authorized policies, registers their finite
  sources, streams one window to completion through the REAL SSE route
  (24 wire frames recorded), partially streams a second (600-tick) window,
  and DIES mid-window; the RESTARTED process (cold boot over the same
  files) resolves the old token, answers the completed session's stream
  route with 410 + replay pointer + worldVersionLast, serves the persisted
  record with the frames VERBATIM (24 frames, meta equal), answers the
  interrupted session's replay route with the honest no-record, and opens a
  FRESH window from ordinal 1 — plus the direct sqlite-row assertions
  (bytes on disk). 4 tests, 74 assertions.
- The existing live presentation batteries re-run green on the branch:
  76/76 across live-replay, live-replay-routes, live-transport,
  live-tactical, live-routes, live-sse, live-telemetry.

## Honest boundaries

- The persisted record is the RECORDED PRESENTATION of the live window (the
  exact `LiveWorldFrameDoc`s the transport emitted). The durable store of
  the raw LIVE OBSERVATION journal (for full-pipeline re-derivation) is a
  later platform increment — it would ride the same store pattern.
- The hosted (Neon/R2) deployment shape has NO replay persistence yet (the
  local sqlite covers the restart/redeploy durability gate the way J014's
  local identity plane did; a hosted store is the production follow-up).
- Windows that complete only in the Node-runtime fallback keep today's
  honesty: per-instance record, restarts answer `no-record` (the banner
  says so).
- The L004 STALLED latch and C's receipt watchdog already render the
  degraded/stalled states; this lane adds no second canonical state and no
  new world truth (the transport seam only ever serves/records the ONE
  projection it emitted).

## Browser verification (production build, real headless browser)

The repo's own e2e posture: `next build` + `bun --bun run start -p 3005`
with `SPORTA_LIVE_TRANSPORT=sse` and the demo account password consciously
set. Verified in the REAL browser over the production HTTP server:

- the finite live session streams its window over the real SSE route, ends
  with the honest `live-window-complete`, and C's replay bar appears
  ("24 world frames, world v1 → v24") over MY transport changes;
- the stream route answers **410 live-window-complete + the replay pointer**
  from the page context (verified via the page's own fetch);
- the replay record serves the 24 frames with the recorded meta;
- the J011 console renders the full contextual navigation (the session LABEL
  as the Watch link — "Derby night at Kings Park — fixture story A" /
  "Friendly under the lights — fixture story B", not a bare id; the Context
  column with Watch session / Job details / Create / Provider state /
  Compute center; the expandable full job detail record with the metered
  usage), after a REAL dispatch driven from the page context.

**The environmental boundary (recorded honestly):** the Next server tree
(dev AND `next start`) spawns its server workers under NODE — the
composition in a Next-served process CANNOT construct any `bun:sqlite`
store, so the designed honest fallbacks + banners fire there (including my
"live replay records are IN-MEMORY this run" banner — verified verbatim in
the server logs). The RESTART durability itself is proven by the REAL
child-process battery above (real `bun` processes, real process death,
real sqlite rows on disk) — the same posture as the J014 battery.

## Cross-lane finding (pre-existing, NOT fixed here — C's file)

`apps/web/src/lib/use-live-world-stream.ts` builds the event-ticker keys as
`${worldVersion}:${entry.type}:${entry.atMs}` — a fresh window's FIRST
frame emits ~24 `entity-appeared` events at the SAME `atMs`, producing
duplicate React keys (console warnings in the production browser; cosmetic
— React still renders). The fix (adding the entry index to the key) is a
one-liner in C's presentation file — raised as a cross-lane request rather
than edited in this lane.
