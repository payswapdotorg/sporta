# W706 — Viewer Telemetry: Privacy Scope and Event Vocabulary

This document records the W706 design decisions: what viewer telemetry
collects, what it can structurally NEVER carry, the sink semantics, and the
boundary against W804 (product analytics). The code authority is
`src/telemetry-events.ts` (the closed, validated event vocabulary — tests
pin the shapes), `src/telemetry.ts` (the emitter), and the sink modules.

## §1 Purpose

W706's accept criterion: *"useful playback/renderer errors and quality
feedback are observable without collecting unnecessary sensitive data."*

The viewer shell (W702 + W705) already surfaces every failure through its
typed error model and every playback state through the state machine. W706
makes the same facts OBSERVABLE as a typed event stream at the viewer's real
lifecycle moments, so a host (test, dev server, or a future product
pipeline) can record them. Telemetry is strictly best-effort: the emitter
validates its own events and guards every sink call — a failing sink
degrades to a counted drop, never a viewer failure (the W007 logger
principle: observability must never take the product down).

## §2 The privacy-scope decision (privacy by construction)

**Collected** (the complete list — nothing else exists):

| Fact | Where it comes from |
| --- | --- |
| State-machine transitions (`from`/`to`) | the viewer core's actual status changes |
| Startup timings (`connect`, `load-output`) | measured on the INJECTED clock (deterministic epoch in tests, `performance.now` in the browser) — never a wall-clock read |
| Error occurrences (failure class, operation, message, remediation hint) | the typed error model (`src/errors.ts`), VERBATIM class/message; the hint from the viewer-owned table |
| Playback health: rebuffer-stall episodes (frame index/count/available) | the frame player's honest buffering seam (it stalls, never drops) |
| Playback health: integrity-verified (byte length, frame count) | the real W504 playback provider's client-side sha-256 + byte-length check |
| Structured user feedback (closed kinds) | the explicit `sendFeedback` command |
| Event identity (`sequence`, `atMs`, `sessionId`) | a deterministic 1-based counter; the injected clock; the OPAQUE control-plane session id |

**Structurally unrepresentable** (enforced by the schema, not by policy):
the validator accepts EXACTLY the closed key set per kind
(`TELEMETRY_EVENT_KEYS`) and rejects every other key by name. There is no
record/array field anywhere in the vocabulary — every field is a scalar
from a closed enum or a bounded number — so there is nowhere to put:

- an authorization policy or any rights document;
- media or artifact content (frame SVGs, segment documents, manifests);
- source-frame references or renderer payloads;
- free-form user text (the ONLY free-form string is the error `message`,
  which by construction comes from the typed error model, bounded at 2048
  characters — an over-bound message is DROPPED and counted, never stored);
- user identifiers, IP addresses, user agents, or any client fingerprint.

Correlation uses opaque ids only: the control-plane session id (`sess-<n>`)
— the same id family the control client already uses. Tests pin all of
this: unknown-key rejections for a battery of sensitive key names across
every kind, the exact key allowlists, and the scalar-only shape walk.

**Timestamps**: `atMs` is in the viewer's injected clock domain. In tests
that is the deterministic `TEST_EPOCH_MS`-anchored fake clock; in the
browser it is `performance.now()` (monotonic, no wall-clock read — the W702
DOM-edge precedent). The value is therefore not a real-world time, and no
timezone or date is ever derived from it.

## §3 The event vocabulary (schema version 1)

| Kind | Fields (beyond the envelope) | Emitted when |
| --- | --- | --- |
| `state-transition` | `from`, `to` | every ACTUAL viewer status change (no-op status writes emit nothing) |
| `operation-timing` | `operation` (`connect` \| `load-output`), `durationMs` | the timed operations' SUCCESS path (failures emit `error-occurred` instead) |
| `error-occurred` | `operation` (closed set), `failureClass`, `message`, `remediationHint` | every `fail()` transition — the typed error model, verbatim |
| `rebuffer-stall` | `frameIndex`, `frameCount`, `availableFrames` | exactly once per (playing && buffering) episode of the frame player |
| `integrity-verified` | `byteLength`, `frameCount` | a verified animated-segment arrival on the real W504 path (a failed check is a `media-invalid` error event) |
| `user-feedback` | `feedback` (`playback-good` \| `playback-stalled` \| `playback-poor`) | the explicit `sendFeedback` command (fire-and-forget) |

Envelope (every event): `schemaVersion: 1`, `kind`, `sequence` (deterministic
1-based counter — the authoritative total order), `atMs` (injected clock
domain), `sessionId` (opaque id or `null`).

Schema evolution: any vocabulary change (new kind, new field, removed
field) bumps `TELEMETRY_SCHEMA_VERSION`; consumers reject other versions
fail-loud. `TELEMETRY_OPERATIONS` / `TELEMETRY_TIMED_OPERATIONS` /
`USER_FEEDBACK_KINDS` are closed sets — an operation outside the set is
dropped and counted, never carried as free text. `TELEMETRY_OPERATIONS` is
EXACTLY the set of `run("...")` operation names `viewer-core.ts`
dispatches, pinned against the source by test (a viewer-core operation
without a vocabulary entry would silently drop its error events; a stale
entry fails the same pin).

## §4 The sink seam

`TelemetrySink` is the injectable port: `record(event): void` —
synchronous, no network in the port, no batching timers. Implementations:

- **In-memory** (`src/telemetry-sink.ts`) — the test sink: ordered,
  validating, stores clones.
- **JSONL file sink** (`src/telemetry-file-sink.ts`, node-only) — the
  structured-JSON-lines sink under a DECLARED path. `record` validates and
  buffers; NOTHING is on disk until the EXPLICIT `flush()` (one ordered
  `appendFileSync` of every buffered line, each terminated `\n`, returning
  the count THIS flush wrote); `close()` flushes then seals (recording
  after close throws fail-loud — closing is a lifecycle decision, never a
  silent drop). Parent directories are created at construction; the file is
  created by the first flush with lines. Single-writer assumption per path.
- **HTTP bridge** (`src/telemetry-http-sink.ts`, browser-safe) — the
  dev-grade browser wiring: POSTs each event to the dev viewer server's
  own `/telemetry` route (the W705 "real thing behind the same-origin
  server" pattern, mirrored). An internal ordered chain guarantees dispatch
  order = record order; transport failures are COUNTED (with the last
  reason) and never retried, never thrown. This sink IS network transport
  (the browser cannot write files) — that is the honest, labeled dev-grade
  consequence; the port and the file sink stay network-free.

Every sink validates before storing (the privacy boundary is enforced at
the sink too): garbage throws fail-loud to the CALLER. The emitter guards
its own emissions, so the viewer never sees those throws.

`serveViewer` hosts the routes: `POST /telemetry` (validate → record →
flush per event, dev-grade immediate durability), `POST /telemetry/flush`
(the explicit flush), `GET /telemetry` (counters + declared path only —
never event contents). Default path:
`<tmpdir>/sporta-viewer-telemetry/viewer-telemetry.jsonl` (outside the
repo, appended across runs — dev-grade accumulation); `telemetryPath: null`
disables the routes (typed 501 answers). The routes are unauthenticated and
local — the W701 trust boundary is inherited (no user auth exists yet).
`serveViewer.stop()` CLOSES the sink (flush of anything still buffered by
programmatic `server.telemetry.record()` users + seal; the ROUTES always
flushed per event, so browser-path events were already on disk).

## §5 Determinism

- Event ids are a deterministic 1-based counter (never uuid, never
  wall-clock).
- `atMs` comes from the injected clock; the browser injects
  `performance.now` at the DOM edge only (the W702 precedent).
- No `Math.random`, no `Date.now`, no `new Date()` anywhere in the
  telemetry path.
- The same command script over the same clock and sink yields a deep-equal
  event trace (pinned ×2 in `test/telemetry-core.test.ts` and, across the
  real HTTP chain, byte-equal telemetry files in
  `test/telemetry-e2e.test.ts`).

## §6 Honest limitations

- **No renderer-health fact is collected**: the W701 `RenderResult` carries
  `rendererHealth` (`lagMs`, `degraded`), but the viewer's view-model never
  surfaces it (no honest seam exists between the control-plane envelope and
  the players' view models) — so no telemetry kind carries it. The player
  health indicators that DO exist at real seams are the rebuffer-stall
  episode (the frame player's honest buffering seam) and the
  integrity-verified fact (the real W504 playback provider's client-side
  sha-256 + byte-length check). A future seam extends the vocabulary with a
  schema bump.
- **No dropped-frame signal exists**: both players are honest about it —
  the frame player STALLS at a missing frame and re-syncs on arrival; the
  SMIL segment player's document is complete at load. No dropped-frame fact
  is invented; the rebuffer-stall episode is the honest equivalent.
- **Rebuffer-stall is frame-player-only**: the segment path has no
  buffering by construction, so no stall events exist there.
- **File line order vs sequence order**: the file sink's line order equals
  its record order; across the HTTP bridge, arrival order is guaranteed by
  the sink's ordered dispatch chain in practice but `sequence` is the
  authoritative order for any reader (documented for W804).
- **The error `message` is trusted from the typed error model**: the
  control plane's messages are the source; a hostile server could in
  principle craft a message, but it is bounded (2048 chars) and is the same
  message the viewer already displays in its error banner. Messages longer
  than the bound are dropped (counted) rather than stored.
- **No aggregation**: no counting, funnels, or dashboards here — that is
  W804's product-analytics boundary. These events are the raw material.
- **The browser HTTP bridge is dev-grade**: unauthenticated local route,
  fire-and-forget with counted failures, no retry. A synchronous throw from
  the fetch seam (e.g. an invalid URL) is one counted failure — the dispatch
  chain is never poisoned, so the next event still dispatches (test-pinned).
  A production deployment replaces the sink behind the same port (or drops
  browser telemetry).
- **`GET /telemetry` exposes the declared path and counters** — a
  dev-grade introspection affordance, intentionally without event contents.
- **No consent workflow**: the privacy note is disclosed in the UI
  (`TELEMETRY_PRIVACY_NOTE`, rendered with the feedback affordance) and
  collection stops entirely when no sink is wired; a full
  consent/telemetry-preference UI is future product work (W804's territory).

## §7 The W804 boundary

W804 "Product analytics" (owner: Product, deps: W706) will build the
product funnel and failure metrics on top of a privacy-scoped event
collection. This package's events are deliberately RAW MATERIAL: they are
the privacy-audited, schema-enforced atoms any analytics layer may
aggregate. W806/W805 own dashboards and production observability on the
server side; W804 owns the product interpretation. Nothing in W706 counts
users, sessions, or conversion — the vocabulary cannot even represent them
beyond the opaque per-event session correlation.
