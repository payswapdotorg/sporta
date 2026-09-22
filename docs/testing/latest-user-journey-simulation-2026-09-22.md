# Latest Product User-Journey Simulation — Sporta

Date: 2026-09-22
Audit tip: fe2710ec8b09abb761ceb9f1e0667e003901f907

## Method

This is a repo-first journey simulation using the current main branch's route/components, merged work-item evidence, acceptance batteries and prior real-browser gate records. It is not a claim that a fresh external deployment was clicked during this session.

## Overall result

The product's main control and creator journeys are now coherent and discoverable.

The remaining gaps are not hidden basic navigation failures. They are capability-depth gaps:

1. final human visual acceptance of generated realities;
2. hosted public durability across the actual deployment plane;
3. genuine authorized ongoing-match feed acceptance for live mode;
4. live final latency/continuity/recovery gates;
5. real commentary ingestion on uploaded-user sessions rather than only dev-seed story data;
6. highlights production remains intentionally unavailable;
7. stored-render Camera control is intentionally unavailable; Camera is currently a live capability.

## Journey 1 — First-time viewer

Path:

Home -> Explore -> Search -> Watch -> Reality Switcher -> Stats/Tactics/Commentary/Highlights -> Live

### Evidence

Home now reflects live capability state and exposes Create; global navigation is retained across role workspaces; Watch has a same-session Reality Switcher with shareable/refresh-stable reality selection; Live exposes the real transport capability rather than a fake live badge.

### Result

PASS for discoverability of currently backed viewer capabilities.

### Important states

- Camera tab correctly says camera control is not available for stored renders and directs the capability concept to live production.
- Commentary is backed by the existing story/event chain when present, but real uploaded sessions may honestly have no commentary.
- Highlights are explicitly unavailable until a real highlight dataset/output exists.

These are honest states, not hidden dead ends.

## Journey 2 — Creator

Path:

Home -> Create Studio -> Upload -> Rights -> select realities -> Compute -> Submit -> Processing -> Watch -> Library -> Jobs

### Evidence

The Create Studio now supports one submission containing Original plus selected derived realities. Rights are declared and re-derived server-side. Compute selection is shown transparently. The plan polls all admitted realities. A J015 fix makes Library stored-output truth agree with the Watch reality catalog.

### Result

PASS for the user-visible create journey.

### Remaining boundary

The final MVP is still blocked by R606/R607 because human visual acceptance and production/public deployment conditions remain open.

## Journey 3 — Compute / BYOC

Path:

Account -> Compute connections -> connect/verify/disconnect -> Create -> choose execution goal/provider -> submit -> Watch provenance

### Evidence

Compute Center is a first-class account destination. Provider adapters are behind the Connection Center. Master passwords are refused. Create and Watch carry the same compute transparency fields and honest no-plane/unmeasured states.

### Result

PASS.

## Journey 4 — Role switching

Path:

Header account -> active role -> switch Viewer/Creator/Analyst/Rights Holder/Operator -> workspace -> return to global Home/Live/Explore/Library/Following/Create

### Evidence

J002 makes workspace navigation supplementary. The role switcher is grants-only, presentation-only and safe-returning. Every role retains core product discovery.

### Result

PASS.

## Journey 5 — Analyst

Path:

Analyst -> Match Lab -> Watch -> Clips -> Notes

### Evidence

Match Lab is backed by timeline/SWM evidence. Clips and Notes now use real timeline/render backing, durable annotation storage and a no-fake-bytes contract.

### Result

PASS for the minimum implemented analyst loop.

## Journey 6 — Rights Holder

Path:

Rights Holder -> Rights Center -> inspect/edit/revoke -> Audit -> attempt Watch/publication

### Evidence

Rights edits are narrow-only, re-attested and append-only audited. Revocation re-derives current capabilities and the serving seam fails closed even against stale broad policies. J009 exposes role-gated rights audit with no existence oracle.

### Result

PASS.

## Journey 7 — Operator

Path:

Operator -> Operations -> health/providers/queue/jobs/audit -> affected session -> Watch/Create/Compute

### Evidence

J011 added direct contextual links from jobs/failures to Watch, Create, Providers and Compute Center plus expanded job details and audit-to-Watch links.

### Result

PASS.

## Journey 8 — Live tactical / 3D

Path:

Live -> select tactical source -> 2D tactical or 3D -> observe live state -> finite window completion -> replay controls

### Evidence

The Live surface uses the real SSE network transport when capability is active; L005 provides the tactical renderer, L013 provides 3D over the same world stream, and L014 replays the recorded world through the same renderer contracts.

### Result

PASS for the implemented deterministic/replay live capability.

### Not yet final

This is not yet the strongest product claim of an authorized ongoing professional match. L009 remains blocked on authorized provider feed access, and L015-L017 remain final acceptance gates.

## Journey 9 — Live failure/recovery

Path:

Live -> transport interruption/drop -> degraded/stalled state -> reconnect -> continue/replay

### Evidence

Dropout/degraded state, bounded transport, explicit recovery semantics and persisted completed-window replay are implemented and tested.

### Result

PASS at the current deterministic/replay scope; final live gate still pending.

## Journey 10 — Fresh restart / redeploy

Path:

Create/Watch/Library -> restart process -> refresh -> recover -> redeploy -> recover

### Evidence

Real Bun child-process restart batteries prove the durable SQLite identity/replay paths. The bundled Node/Next runtime honestly falls back to in-memory stores where bun:sqlite is unavailable. Hosted Neon/R2 cross-instance deployment is not yet proven in this sandbox.

### Result

PASS for local durable process restart; BLOCKED for the final public hosted durability claim.

## Architecture-to-UX capability audit

| Architecture capability | User-visible surface | Current result |
|---|---|---|
| Original reality | Watch / Create | PASS |
| Tactical reality | Watch / Live | PASS |
| 3D reality | Watch / Live | PASS |
| Anime/NPR reality | Watch | PASS |
| Reality Switcher | Watch | PASS |
| Live tactical world | Live | PASS at deterministic/replay scope |
| Live 3D | Live | PASS at deterministic/replay scope |
| Commentary intelligence | Watch / Match Lab | PARTIAL — real dev-seed/story-backed data exists; real user-upload commentary path is not yet the general production path |
| Tactics/SWM evidence | Watch / Match Lab | PASS |
| Stats | Watch | PASS |
| Highlights | Watch tab | UNAVAILABLE — honest, but capability not yet implemented |
| Camera control | Live | PASS for live capability; correctly unavailable on stored renders |
| Rights/authorization | Create / Rights Center / Audit | PASS |
| Compute selection/BYOC | Create / Account / Watch | PASS |
| Operations/observability | Operations | PASS |
| Library / Jobs | Library / Jobs | PASS |
| Analyst clips/notes | Analyst workspace | PASS |
| Role switching | Header | PASS |
| Search / Explore | Global navigation | PASS |
| Durable persistence | Library / Watch / identity | PARTIAL — local restart proven; hosted redeploy/cross-instance gate remains |
| Neural re-camera | Technology Plane only | CANDIDATE — not a current user-facing reality |
| HF model evolution | Technology Plane only | CANDIDATE / benchmark track |

## Discoverability verdict

The primary navigation is now coherent enough that a new user should discover the currently implemented product without knowing internal URLs.

The main remaining discoverability problems are capability-depth rather than routing:

- a viewer can see the Commentary and Highlights tabs, but Highlights is not yet backed and real uploaded-session Commentary may be unavailable;
- Camera is discoverable but correctly constrained to live rather than stored renders;
- Live is discoverable, but the strongest “ongoing authorized match” claim requires the provider and final live gates;
- neural re-camera and the HF technology portfolio are intentionally not user-facing product surfaces yet.

## Recommended next product gates

1. R606 human visual acceptance.
2. R607 public MVP / hosted durability acceptance.
3. L015-L017 final live acceptance.
4. Real uploaded-session commentary path.
5. Real highlight production or removal of the Highlights tab until backed.
6. Later promotion of cinematic re-camera/HF candidates only after benchmark and provenance gates.
