# @sporta/webrtc-output — the live output transport (W305)

The M4 delivery stage. **Acceptance (docs/work-items/work-items.md W305):**
"live rendered output is viewable end-to-end in supported browsers."

Delivered at the **W301 honest-seam posture**: a typed, versioned,
zod-validated wire protocol (negotiation offer/answer, frame-window delivery
records, failure classes, integrity metadata) PLUS a deterministic in-process
reference implementation (`LoopbackLiveOutputTransport`) that actually moves
frame-window payloads from a W304-style orchestrated render stream to a
viewer-side port, in delivery order, with exact never-silent accounting —
and the viewer-side consumption seams (`LiveOutputEndpoint` /
`LiveViewerSession`) a real player (W704) plugs into.

```
W304 RenderOrchestrator.onOutput(record)          ← the intake seam
  └─ transport.sendWindow(emission)                (an awaited receipt — the
       └─ fail-closed gates: rights (re-derived EVERY send), phase,          │
          session budget, payload shape, negotiated-track profile            │
          └─ W104 BoundedChannel (block / reject / drop-oldest,   backpressure
             byte budget — VERBATIM)                              propagates
             └─ viewer-driven pull (one tryReceive per wakeup)   upstream)
                  └─ integrity verification at the delivery boundary
                     (sha-256 recomputed per frame + per window)
                  └─ LiveDeliveryEvent stream:
                       window | window-skipped | reconnect-gap |
                       connection-lost | session-closed
                       └─ LiveViewerSession: idempotent application keyed by
                          the watermark-derived window id, in-order
                          verification, presentation timing from the PAYLOAD's
                          own timestamps, the honest live-state surface
                          (phase, lag, buffer depth), arrival telemetry
```

Runtime dependencies are workspace-only (`@sporta/contracts`,
`@sporta/observability`, `@sporta/transport`) plus the sanctioned `zod`
(the `@sporta/contracts` schema precedent). Dev-only:
`@sporta/gpu-worker`, `@sporta/render-orchestration`, `@sporta/temporal`,
`@sporta/testing`, `@sporta/world-model` (the W304 e2e fixture drives the
REAL orchestrator over a REAL W006 engine through the W402 seams). No
external network stack, no SDP/ICE/DTLS/SRTP, no browser APIs, no real
timers — the only clock is the injected `LiveOutputClock`.

## 1. The honest boundary (what this is NOT)

A real WebRTC stack cannot be implemented under this monorepo's
zero-external-runtime-dependency and vendor-neutrality rules
(architecture-lock §9). This package is therefore the **contract + the
deterministic reference implementation**: a real WebRTC implementation (or
any measured low-latency transport — the streaming contract allows "WebRTC
or another measured low-latency transport") satisfies the SAME seams —
`sendWindow` / `viewerEndpoint` / `close` on the host side, the
`LiveViewerTransportBinding` interface on the viewer side — behind a
network. The protocol documents (`src/types.ts`) are the WebRTC-shaped
negotiation/delivery vocabulary such an implementation speaks.

W704 (live playback integration) wires `LiveViewerSession` into the real
viewer shell; W306 (latency benchmark) consumes the per-window timing
records (`src/telemetry.ts`) — both surfaces are pinned by test here.

## 2. Negotiation (offer/answer, two grammars)

The host mints a `LiveOutputOffer` (one video track declared from the render
output profile, VERBATIM; the W104 session controls) only after the
fail-closed rights gate re-derives `canDeliverLive` on the injected clock
(no rights → no offer, no stream, terminal `rights-denied`). The viewer
endpoint answers with a typed accept or reject:

- The **strict wire schema** (`LiveOutputOffer`) is what a v1 host mints and
  what establishes a session: ≥ 1 track, every track v1 `"video"`, the v1
  protocol-version literal.
- The **answer-side intake grammar** (`src/negotiation.ts`) is what the
  viewer decides over: offer-shaped documents with empty/future-kind tracks
  or foreign protocol versions — because `no-video-track` and
  `unsupported-protocol-version` are NEGOTIATION outcomes (a typed reject
  answer), not parse errors. Only non-offer-shaped documents throw the typed
  `protocol-violation`.

Rights are re-derived on EVERY `sendWindow`; a mid-stream lapse terminates
the session LOUD (`rights-lapsed`, every in-link window abandoned and
accounted).

## 3. Delivery (bounded, in-order, integrity-checked, never silent)

- Every `sendWindow` resolves to EXACTLY ONE typed receipt: `admitted`,
  `skipped-stale` (measured watermark lag, original watermark preserved),
  `refused` (rights / resource-limit / session-limit / session-closed),
  `dropped` (a window that can never fit the byte budget, under
  drop-oldest), or `abandoned` (closed-under while parked under `block`).
- The link is the W104 `BoundedChannel` VERBATIM; the awaited receipt means
  backpressure propagates upstream into the W304 emission chain (the e2e
  pins the bound end-to-end).
- The viewer's stream accounts EVERY admitted ordinal exactly once — as a
  `window` or an inline `window-skipped` (eviction or stale, with measured
  lag); reconnect gaps are announced BEFORE any replay; re-deliveries under
  a stable window id are counted duplicates (the streaming contract's
  Recovery rule).
- Integrity is verified at BOTH the delivery boundary and the viewer's
  application boundary (defense in depth): sha-256 per frame and per
  window, recomputed from the payload's own bytes; a mismatch fails the
  session LOUD (`integrity-violation`), never presents corrupted frames.
- Degradation: skip-stale at admission AND dequeue, measured in MEDIA time
  (watermark lag — clock-independent); the session phase degrades on the
  first policy loss and recovers on a fresh in-bound delivery; every
  transition counted, logged, metered.

## 4. The never-silent ledger

The master identity, runtime-asserted at every settle (an imbalance REJECTS
the settle promise — never a lying result):

```
windowsIn === windowsDelivered + windowsSkippedStale + windowsDroppedByPolicy
           + windowsRefused + windowsAbandoned + windowsFailed + windowsInFlight
```

split into the receipt identity (`windowsIn === admitted + skippedStale +
refused + dropped + abandoned` receipts), the admitted-terminal identity,
and the roll-up checks (see `assertLiveOutputAccounting`, `src/types.ts`).
The consumer-side identity is asserted by the session itself:
`appliedWindows + skippedWindows === accountedOrdinals`. Malformed send
documents are refused at the door (`windowsRejectedInvalid`) and never enter
the ledger. The settle contract: close() awaits every send already on the
chain before minting — never a receipt after the result is minted.

## 5. Close semantics

- `close({ mode: "drain" })` — orderly: the viewer drains the link; the
  settle completes when everything staged/streamed is resolved. REQUIRES a
  receiving consumer: a disconnected viewer that never reconnects parks the
  drain forever (the documented W302 posture) — call `cancel` instead.
- `close({ mode: "cancel" })` — everything in the link and everything staged
  is abandoned, accounted, logged, metered; the session settles immediately.
- `reason: "stream-complete"` settles `completed`; anything else `stopped`.
  Terminal failures (rights, integrity, profile mismatch, negotiation,
  transport) settle `failed` with the typed failure class.

## 6. Determinism

No wall-clock reads (the only clock is the injected `LiveOutputClock` —
structurally satisfied by the W303 `VirtualGpuClock`, so one domain can
drive the whole pipeline; the e2e shares the clock with the render stage),
no `Math.random`, no real network. Every timestamp on every document is a
reading of the injected clock or the payload's OWN media timestamp (carried
verbatim, never re-stamped). The `new Date(nowMs)` calls in the rights gate
are explicit-millisecond derivations for the contracts' expiry semantics.

## 7. Honest limitations

- No real network, no SDP/ICE/DTLS/SRTP, no browser APIs — the reference
  transport is in-process loopback (this is the seam contract, documented
  above, not a gap silently papered over).
- v1 carries VIDEO tracks only (`kind: "video"`); audio is future work (the
  answer boundary already rejects audio-only offers with the typed
  `no-video-track`, so future track kinds negotiate instead of crashing).
- The e2e carries the W502 anime prototype's declared profile (latency class
  `offline`) VERBATIM — it is the only real renderer today; the transport is
  profile-agnostic and the live-class negotiation paths are unit-pinned. A
  live-class renderer lands with its own work item; the transport needs no
  change.
- The transport supports ONE viewer endpoint (one session per transport);
  fan-out to many viewers is a host-side concern behind the same seam.
- Retention for reconnect is bounded (`retransmitRetention`, default 8
  delivered windows); a resume point older than retention surfaces a counted
  `reconnect-gap` — the viewer is told exactly what it lost.
