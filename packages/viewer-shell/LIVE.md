# W704 — Live Playback Integration: The Delivered Path and Its Honest Boundaries

This document records the W704 design decisions: what the live playback
path is, how it reconnects safely, what its status/latency telemetry means,
and where it deliberately stops (the in-process seam). The code authority is
`src/live-ports.ts` (the port contracts + the failure-class map),
`src/live-client.ts` (the in-process adapter over a REAL W305 transport),
`src/live-player.ts` (the presentation model), `src/live-backoff.ts` (the
pure reconnect schedule), `src/live-plan.ts` (the pure status surface), and
the live paths of `src/viewer-core.ts` (the state machine).

## §1 Purpose

W704's accept criterion: *"live output reconnects safely and displays
latency/status telemetry appropriate for users."*

W305 delivered the live output transport CONTRACT (typed offer/answer
negotiation, frame-window delivery with never-silent accounting, the
in-process `LoopbackLiveOutputTransport`). W704 is the viewer that CONSUMES
it: the headless viewer state machine grew first-class live statuses
(`live-connecting → live-playing ⇄ live-reconnecting → live-ended`), the
`openLive` command runs the full negotiation through an injected
`LiveClient` port, the presentation joins at the live edge, and a PURE
deterministic backoff schedule governs reconnects.

## §2 The composition (all layers, all real)

| Layer | Module | What it owns |
| --- | --- | --- |
| Port contracts | `src/live-ports.ts` | `LiveClient`, `LiveStreamHandle`, the browser-safe views (offer summary, accounting, status), and the W305 → viewer failure-class map (browser-safe pure data; type-only W305 imports) |
| In-process adapter | `src/live-client.ts` (NODE-side) | the offer dance over a REAL `LoopbackLiveOutputTransport`: `createOffer` → exact-key check → W305's answer-side zod grammar + endpoint policy → `acceptAnswer` → `connect`; typed rejects, never guesses |
| Presentation | `src/live-player.ts` | pure live playback model: join at the live edge, grow-as-delivered buffer, honest re-buffer stall seam, injected-domain latency; absent metrics stay absent |
| Reconnect policy | `src/live-backoff.ts` | the PURE schedule (below) + the retryability table |
| Status surface | `src/live-plan.ts` | the pure plan for the live section (headline, status line, accounting line, degradation, reconnect countdown, outcome) — what the bootstrap renders |
| State machine | `src/viewer-core.ts` | the live statuses, `openLive`/`closeLive`/`tick` wiring, the consumption loop, the reconnect window driver, the W706 telemetry edges |
| DOM edge | `src/dom-plan.ts`, `src/dom-adapter.ts`, `web/bootstrap.ts` | the pure live DOM plan (svg swap, buffering overlay, stage status line) and the browser glue (compile-checked; see §7) |

One presentation at a time is the machine's honest shape: `openLive` tears
down a mounted batch playback; `selectRender` tears down a mounted live
stream. A live presentation has no pause/seek — live content is consumed at
the live edge; `closeLive` is the live equivalent.

## §3 The open dance (fail-closed on both sides of the seam)

1. **Viewer-side rights pre-check** (the W701-derived surface): a session
   whose authorization policy does not grant `canDeliverLive` never sends a
   request — the error is `rights-denied`, NOT retryable (never a retry
   storm on a denial), and the transport factory is never even called.
2. **`transport.createOffer()`** — W305's own fail-closed gate runs inside
   (a policy without live delivery throws the typed rights error; the
   session dies terminally — defense in depth, both gates are real).
3. **The exact-key check** (W704's strictness on top of the grammar): the
   offer document may carry EXACTLY the v1 grammar's fields at every level
   — an unknown field anywhere is a typed `media-invalid` reject naming the
   field (carrying `details.liveFailureClass: "protocol-violation"`), never
   a silent zod strip.
4. **`endpoint.answer(offer, { supportedCodecs })`** — W305's REAL
   answer-side zod grammar (`AnswerableLiveOutputOffer`) + the endpoint
   policy: a foreign protocol version is a typed reject (never a
   downgrade), a non-svg track is a typed `unsupported-codec` reject (this
   viewer presents SVG frame documents).
5. **`acceptAnswer` → `connect`** — the host establishes on the accept;
   the consuming `LiveViewerSession` is wrapped as the core's
   `LiveStreamHandle` and the machine enters `live-playing`.

Every W305 failure maps onto the viewer's typed error model with the W305
class VERBATIM in `details.liveFailureClass` (the W702 verbatim-evidence
pattern — the user-facing label/retryability come from the mapped viewer
class; the map is total over the W305 vocabulary and test-pinned per
class).

## §4 Reconnect safety (the acceptance core)

The schedule is PURE and DETERMINISTIC (`src/live-backoff.ts`,
test-pinned as the contract itself):

```text
delay(n) = min(500 · 2^(n-1), 4000) ms     attempts 1..4: 500, 1000, 2000, 4000
```

- **No jitter of any kind** — no `Math.random`, no seedable source; the
  same attempt count always yields the same delay. Jitter is a documented
  extension point, deliberately omitted (no seam here supplies honest
  entropy).
- **No timers, no wall clock** — the delay is a number in the injected
  clock domain; the core schedules the attempt at `now + delay` and the
  host-driven `tick` fires it when due. A host that stops ticking stops
  the schedule (the constitution's price, paid knowingly).
- **Bounded, cumulative**: at most 4 reconnect attempts per ATTACHED live
  stream (one `openLive`), cumulative across separate losses — a stream
  that drops repeatedly stops honestly once its budget is spent; a fresh
  `openLive` starts a fresh budget. The loss after the 4th fired attempt
  is TERMINAL (`attempts-exhausted`, named in the error state — never a
  5th attempt, never a retry storm).
- **Retryability is the class table, fail-closed**: only `connection-lost`
  (the classless delivery event) and `transport-failed` (the W305 class)
  reconnect. Every other W305 class is a deliberate, non-transient
  verdict — `rights-denied`/`rights-lapsed`, `negotiation-*`,
  `protocol-violation`, `integrity-violation` all land TERMINAL, whatever
  the attempt count (the class check runs first). An UNKNOWN class never
  reconnects (never guessed retryable — the W702 verbatim-passthrough
  lesson applied to the live path).
- **The presentation holds its frame** while reconnecting (content is not
  flowing — the honest wait; no fake stall, no teardown), and the
  playhead is HELD until the resume lands (the reconnect report is carried
  verbatim in the view: resume ordinal, replay count, gap skipped).

The consumption seam detail that keeps a reconnect REAL: W305 allows one
active pull stream per viewer session, so the adapter COMPLETES a
suspended pull stream (running the generator's `finally`) before
answering the typed "not consumable now" `null` — leaving it suspended
would make the first post-reconnect pull resume the DYING stream and the
presentation would freeze silently. Pinned end-to-end: windows sent after
a drop APPLY after the resume.

## §5 Accounting and telemetry (never silent, never widened)

- **Delivery accounting is W305's own, surfaced verbatim**: the live
  section carries the session's receipts (`applied`, `duplicates`,
  `skipped`, `accountedOrdinals`, `lastAppliedOrdinal`). The viewer-side
  backstop identity `appliedWindows + skippedWindows === accountedOrdinals`
  is asserted at every e2e checkpoint, including a REAL skip-stale
  composition (windows that go stale during a disconnect are accounted as
  skipped at resume; the degradation reason surfaces verbatim while
  degraded and clears on recovery — W305's own vocabulary).
- **Telemetry stays inside W706's closed vocabulary** (schema v1, no new
  kind, no new field): the live statuses are `state-transition`s; the open
  dance is the timed `openLive` operation; live failures are
  `error-occurred` events from the typed error model (the W305 class rides
  verbatim in the error view, but the EVENT carries the closed fields
  only); the live player's stall seam emits the same `rebuffer-stall`
  shape the frame player's seam does; a live presentation is rateable via
  the same closed `user-feedback` kinds. The privacy surface is NOT widened
  by the live path (frame SVGs, offer documents, and payloads stay
  unrepresentable in events — see `TELEMETRY.md` §2).
- **Latency is the INJECTED-domain stream position**: `now − the newest
  applied window's emittedAtMs` (W305's own `latencyToLatestWindowMs`
  semantics, one shared clock across the transport and the viewer at the
  in-process seam). It is presented as "delivery latency", never as
  network latency — real-network measurement is W306's boundary, SLO
  formalization W802's. Before the first applied window there is no frame,
  no latency, no accounting (absent metrics stay absent — never a faked 0).

## §6 The rights posture

Both gates are real and independent (pinned end-to-end): the viewer's
fail-closed derived-rights pre-check (no request leaves without
`canDeliverLive`), and W305's own gate at the offer (a transport policy
without live delivery denies there). A denial is terminal and named —
the error state says `rights-denied` with the reason, and the Retry
affordance does not appear for it.

## §7 Honest boundaries (the deliberate stops)

- **The in-process seam IS the boundary**: no real `RTCPeerConnection`
  exists in this monorepo (W305's documented boundary). The delivered
  adapter runs a REAL `LoopbackLiveOutputTransport` in-process — the same
  contract a real network stack would satisfy behind
  `createOffer`/`answer`/`sendWindow`/pull.
- **The BROWSER build wires NO live client**: W305 defined no HTTP wire
  for the offer dance, and inventing one here would be a new protocol —
  out of scope. So the served browser's `live` section carries the honest
  unavailable note (`LIVE_UNAVAILABLE_NOTE`), while the state machine,
  adapter, player, backoff, status plan, and DOM plans are the SAME code a
  future bridge would run (the bootstrap glue is complete; no surgery
  needed). The full path is exercised headlessly over the real transport
  in `test/live-e2e.test.ts` (the W705 posture for the batch path).
- **No real-browser paint E2E** (OPEN — the standing W705/W706 boundary):
  the served module graph is smoke-tested (transpiles, zero bare
  `@sporta/*` specifiers, live modules' W305 imports type-only —
  source-pinned in `test/boundary.test.ts`, transpile-pinned in
  `test/serve.test.ts`), never claimed as browser-executed.
- **Tick-driven reconnect**: no timers by constitution — a host that
  stops ticking stops the schedule (documented above, by design).
- **Latency is not network latency** (see §5) and the reconnect delays
  are wall-clock-blind numbers in the injected domain.

## §8 Test map

| File | Pins |
| --- | --- |
| `test/live-backoff.test.ts` | the schedule table, the decision function over class × attempts, the retryability table (every W305 class + the classless loss), the loud refusals |
| `test/live-client.test.ts` | the golden open over the real transport, the rights gate, the session guard, the exact-key rejects (every level), the typed negotiation rejects, the total failure-class map |
| `test/live-player.test.ts` | join-at-live-edge, buffer growth, the stall seam, malformed-window rejects, idempotent re-application, determinism |
| `test/live-plan.test.ts` | every section state's status lines, the accounting/degradation/countdown/outcome lines, absent-metrics-absent, purity |
| `test/live-e2e.test.ts` | the golden walk (offer verbatim, windows at the edge, telemetry spine), the reconnect path + the suspended-stream fix, the attempt cap terminal, fail-closed rights both gates + the failed-open reset, skip-stale accounting, one-presentation-at-a-time, determinism ×2 |
| `test/boundary.test.ts` | the source-scan pins: isolation, constitution (zero clock/RNG calls in src), the browser-graph type-only rule |
| `test/serve.test.ts` | the transpiled browser graph (zero bare `@sporta/*`), the node-side client outside it |
