# L014 platform side + live connection/recovery hardening — Wave 3 Worker B design record

Date: 2026-09-21 (Wave 3, Worker B — platform/media/live transport)
Branch: `work/l014-platform-j011-connection` (base `03d79f42`, the wave-3 main)

---

## 1. The boundary this lane owns

Worker C's L014 presentation side (merged @7d9a375) replays the finite live
window's RECORDED world frames through the same views — with the honest
boundary recorded in three places (the replay route's comment, the
`LiveReplayRecordDoc` doc, the research note):

> the record is the transport's own in-memory record of THIS instance's
> window — durable persistence of live observations/world versions keyed to
> the session, and reload/redeploy recovery of the replayable state, are the
> PLATFORM side of L014 (Worker B's lane). A restart honestly answers
> `no-record` until a new window runs.

This lane delivers exactly that platform side, plus the live
connection/recovery hardening and J011 (operator contextual navigation).

## 2. The acceptance slice

> **L014 (platform)**: the completed live window's recorded world frames —
> ordinals, world versions, watermarks, event times, VERBATIM (never
> re-stamped) — persist durably (J014-grade: sqlite under the real Bun
> runtime, honest per-instance fallback under the bundled Node runtime) and
> survive reload/restart/redeploy. After a restart the replay route serves
> the PERSISTED record through the SAME route contract, and the stream route
> answers the honest 410 (the window already completed — never a second
> live window over the same session, never silent replay-as-live).
>
> **Recovery hardening**: recovery resumes from platform state. An
> INTERRUPTED window (process death mid-window) never serves partial frames
> as a complete record — the partial rows are retained as honest provenance
> but only a genuinely completed window is replayable; the live view
> honestly restarts (the L002 deterministic source re-runs the same scripted
> window). The L004 STALLED latch (Worker A, merged) and C's receipt
> watchdog render degraded/stalled states; this lane adds no second
> canonical state and no new world truth.

## 3. The architecture (extend-not-fork, the W915/SSE seams)

Three additive seams — NO route changes, NO wire changes, NO forked
transport:

1. **The recorded-window SINK** (`transport.ts`, additive option): the
   channel already records every finite-window world frame it emits
   (`recordedFrames`). It now ALSO reports each recorded frame and the
   window's completion to an injected `recordSink`
   (`SseLiveTransportOptions.recordSink`, absent → byte-identical
   behavior). The sink receives EXACTLY the frames and meta the in-memory
   replay record serves — one source of truth, two sinks.

2. **The persistence port + sqlite adapter** (`server/live/persistence.ts`
   + `server/platform/live/sqlite-replay-store.ts`): `appendRecordedFrame`
   (incremental, idempotent by session+ordinal; ordinal 1 resets the
   session's rows — a new window supersedes the old record), and
   `markWindowComplete` (flips the window row; the meta stored verbatim).
   `findCompleteRecord` serves ONLY genuinely completed windows
   (deep-clone-on-read). The sqlite adapter follows the J014 identity-plane
   discipline: `bun:sqlite`, WAL + busy-timeout, one db file
   (`SPORTA_LIVE_REPLAY_DB ?? db/live-replay.db`), the W911 shim refusal
   caught by the composition → the honest in-memory (per-instance) record +
   banner under the bundled Node runtime.

3. **The durable decorator** (`withDurableReplayRecord`, the same pattern
   as `withLiveTelemetry`): wraps the transport (OUTSIDE telemetry). Its
   `replayRecord(sessionId)` applies the recovery precedence:
   - the in-memory answer `complete` → returned (and the sink already
     persisted it);
   - the in-memory answer `live-window-open` → returned (the window is
     streaming NOW — the honest 409 posture; a re-opened window takes
     precedence while it is genuinely live);
   - the in-memory answer `no-record` or `null` → the PERSISTED complete
     record when one exists (recovery: the record outlives the process and
     even the source registration), else the in-memory answer verbatim.

   Every other method passes through. The wire is untouched.

### Why the decorator and not route changes

The replay route and the stream route both already consult
`live.replayRecord(sessionId)` at their seams (the 409-while-open ladder
and the 410-on-complete terminal). Serving the persisted record THROUGH
the transport seam keeps C's route logic byte-identical — the platform
layer composes under the presentation layer, exactly the lane split.

## 4. The restart/redeploy semantics (the L017 rehearsal)

| Platform state after a restart | Stream route | Replay route |
|---|---|---|
| persisted `complete` | 410 + replay pointer (never a second window) | 200 the persisted record |
| partial rows only (interrupted window) | fresh window honestly runs (hello + ordinal 1) | `no-record` 200 (partial never served) |
| nothing persisted | today's behavior | today's behavior |

The dev seed re-registers the finite-window session every boot (same
deterministic L002 config). With a persisted complete record the 410 wins
BEFORE subscribe — the completed window never re-runs as live. That is
the "no second canonical window / no silent replay-as-live" rule enforced
at the platform layer.

## 5. J011 — operator contextual navigation (additive, role-gated)

The console's jobs table showed raw session ids with NO navigation. The
J011 acceptance (operations jobs/failures link directly to affected
session, Watch, Create/job details and relevant provider state) is
delivered as:

1. **The session label join** (`operations-service.ts`, additive server
   field): `jobListingInternal` joins each job's session id to the control
   plane's own `sourceLabel` (one `listSessions` read) — the operator sees
   WHICH session, never a bare id to guess about.
2. **Per-job contextual links** (`operations-console.tsx`, additive):
   - **Watch** → `/watch?session=<id>` (the existing session-addressable
     watch route);
   - **Job details** → the row's expandable detail panel (the full honest
     record: admission, dispatcher, dispatch time, renderer, render id,
     the never-silent completion envelope, the metered usage) — the console
     serves its own job details (no guessing URLs);
   - **Create** → the Create studio (`/create`) — where a re-submission is
     launched;
   - **Provider state** → the console's own Providers & quotas panel
     (in-page anchor) + `/account/compute` (the compute connection
     center).
3. **The audit panel** joins the same treatment: every remediation record
   carrying a session id gets the Watch link.

The whole console stays operator-grant-gated server-side (the real
401/403); the links are plain anchors over REAL data — nothing is
fabricated, an unknown/absent label renders as the honest session id.

## 6. Honest boundaries

- The persisted record is the RECORDED PRESENTATION of the live window
  (the exact `LiveWorldFrameDoc`s the transport emitted). The durable
  store of the underlying LIVE OBSERVATIONS (the L002 source's raw
  observation stream) is NOT separately persisted — the replay contract
  this wave serves is the recorded world-frame presentation, which is
  what C's views replay. Persisting the raw observation journal for
  full-pipeline re-derivation is a later platform increment (recorded as
  the boundary; it would ride the same store pattern).
- Windows that complete ONLY in memory (the Node-runtime fallback) keep
  today's honesty: the record lives with the process, restarts answer
  `no-record` (the banner says so).
- L009's authorized provider remains BLOCKED on feed access (unchanged);
  the recovery seam here is transport-level, provider-agnostic.
