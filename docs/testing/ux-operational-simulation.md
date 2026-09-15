# Sporta UX ↔ Operational Architecture Simulation

Purpose: validate that the UX architecture can be executed by the existing control/media/intelligence/rendering/delivery system without inventing hidden backend capabilities.

## Simulation A — New viewer

1. User opens public Sporta URL.
2. Edge serves web app.
3. Auth state is resolved.
4. Home requests capability-filtered catalog.
5. User selects a match.
6. Watch page obtains an authorized playback session.
7. Reality Switcher lists only renderers backed by real capability responses.
8. Viewer changes Original -> Anime.
9. Control plane requests the existing output/playback surface.
10. Player consumes the stored/streamed output.

Expected result: no UI step requires direct access to SWM internals.

## Simulation B — Creator uploads a clip

```text
Create Studio
 -> select file
 -> rights declaration
 -> control API creates MediaSession
 -> W101-W104 ingestion/normalization
 -> W201-W209 perception/commentary
 -> W401-W403 SWM
 -> W501-W504 renderer/output
 -> R2 artifact
 -> job/session state
 -> Creator sees progress
 -> Watch page consumes output
```

Required states: processing, degraded, denied, failed, ready.

## Simulation C — User switches roles

Viewer -> Creator -> Analyst -> Rights Holder.

The active role changes navigation/workspace only. Control API reauthorizes each action. A Creator cannot gain Rights Holder capabilities merely by selecting that role; the account must actually possess that capability.

## Simulation D — Rights denial

1. User selects media without an authorization policy.
2. Control API rejects before media existence is revealed.
3. UI shows `denied`, explains the next allowed action, and does not offer retry loops.
4. No source bytes are exposed to the browser.

## Simulation E — Provider quota exhaustion

1. R2/Neon/Upstash/Worker quota approaches its configured guardrail.
2. Observability reports degraded capacity.
3. New expensive jobs stop admitting before the provider hard-fails.
4. UI changes to `degraded` with an actionable explanation.
5. Existing authorized playback remains available when possible.

## Simulation F — Real-time

The UI labels live only when the delivery adapter reports actual live-network capability. The current in-process W305/W704 path cannot claim that state. Public beta therefore requires the real network transport work order before the Live page is promoted to production live.

## Simulation G — Watch-page reality switch

The same match session is held constant while the renderer changes. The control plane issues a new renderer request against the same SWM-backed session; the player does not reload the match page. Renderer-specific controls remain scoped to that renderer.

## Validation verdict

The UX fits the operational architecture provided that:

- `apps/web` is a client of stable control/delivery APIs;
- role state remains presentation context;
- rights remain server-side;
- live labels are evidence-driven;
- provider health/quota becomes first-class UI state;
- R2 object references are never exposed without authorization;
- the watch page treats renderer selection as a capability surface, not an implementation detail.

No architecture change to the SWM/media/intelligence/rendering core is required.
