# Sporta MVP User Journey Simulation

Date: 2026-09-20

## Purpose

Test whether the product architecture is discoverable and usable from a normal user's point of view. A feature can be technically implemented and still fail this simulation if a normal user cannot find, understand, or complete it.

## Journey 1 — First-time visitor -> discover -> watch

Expected: Home -> Explore/Search -> match card -> Watch -> Reality Switcher.

Verified:
- Home, Explore and Search are real product surfaces.
- Catalog cards carry real session/availability/rights state.
- Watch uses HTML5 MP4 playback.
- Reality switching remains on one session and is URL-addressable.
- Four reality artifacts were verified by the gate audit for both real clips.

Findings:
- Home still contains stale language implying Tactical/3D are unregistered.
- Home still describes creation as deferred even though real upload/render exists.
- Following is visible although its data plane is deferred.
- Private-session fail-closed behavior is correct but needs clear user-facing wording.
- Watch exposes Camera/Commentary/Tactics/Stats/Highlights without clearly distinguishing backed versus deferred panels.

Required outcome: the first-time experience must clearly communicate watch, Reality Switcher and real creation capabilities without stale contradictions.

## Journey 2 — Creator -> upload -> rights -> compute -> render -> watch

Verified:
- Real browser upload exists.
- Rights preview is server-derived and fail-closed.
- Compute selection is real and auditable.
- Job states are real.
- Four real MP4 realities can be produced.

Findings:
- Create Studio still submits one selected renderer per submission.
- The final gate had to dispatch additional realities through the API to create the four-reality acceptance state.
- Users should request all desired realities in one render plan.
- Compute selection must be understandable without infrastructure knowledge.

Required outcome: one Create Studio submission can request Original, Tactical, 3D Game and Anime/NPR without developer/API intervention.

## Journey 3 — Compute / BYOC

Verified:
- Compute Broker is provider-neutral.
- Modal, Lightning AI, RunPod and local adapters exist.
- Selection is auditable.
- Provider-specific behavior stays behind adapters.

Findings:
- Compute Connection Center is not yet a first-class persistent product destination.
- Users need a clear Sporta compute versus BYOC distinction.
- Connection, verification, disconnect, quota and cost context need one consistent UX.

Required outcome: a Compute Center is reachable from account/settings and Create Studio and uses the same broker as future managed Sporta compute.

## Journey 4 — Viewer -> Creator -> Analyst -> Rights Holder -> Operator

Verified:
- Role switching is grants-only.
- Server-side authorization remains authoritative.
- Safe-return routing exists.

Findings:
- Role-aware navigation can hide core discovery/watch surfaces.
- Analyst Clips and Notes are visible but deferred.
- Rights Holder Audit is deferred.
- Rights Center is read-only although the architecture calls for editing/revocation.
- Operator Operations is functional but needs contextual links into affected Watch/Create/session surfaces.

Required outcome: separate global product navigation from workspace navigation. Every visible capability must either work or have an explicit useful unavailable state.

## Journey 5 — Library / Jobs / persistence

The final audit used an in-memory fallback because DATABASE_URL was absent. The Tech Lead verified that the earlier anonymous unknown-session observation was the correct fail-closed privacy posture, not a data-loss event.

Finding: in-memory public runtime is not sufficient as the durable product boundary.

Required outcome:
- Neon-backed durable control state;
- R2-backed durable artifacts;
- cross-instance reads;
- redeploy persistence;
- Library/Jobs/Watch recovery without developer intervention.

## Journey 6 — Rights Holder

Finding: Rights Center currently exposes policy inspection but not the complete edit/revoke/audit loop.

Required outcome: real edit/revoke -> capability re-derivation -> fail-closed playback/publication -> audit record.

## Journey 7 — Analyst / Commentator

Match Lab is real and useful. Clips and Notes are intentionally deferred.

Required outcome: implement a minimal backed Clips/Notes loop or remove those destinations from the active workspace until backed.

## Journey 8 — Operator

Operations exposes real health, queues, providers, jobs and remediation audit.

Required outcome: direct contextual navigation from incident/job/provider state to the affected session and Watch/Create surfaces.

## Journey 9 — Reality fidelity

This is the principal product-result blocker.

The gate audit shows R601 and R602 both produced four actual MP4s. However, their 3D Game and Anime/NPR artifact ids are identical because both runs materialized the same empty-event SWM state. The audit also records heuristic perception because model weights were unavailable.

This proves the rendering pipe exists, but it does not yet prove the strongest Sporta promise: the alternate reality is a rendering of the actual uploaded sporting event.

Required outcome: materially different inputs with materially different reconstructed football states must yield materially different SWM-driven derived realities. An empty/default SWM fallback must not silently pass final reality-fidelity acceptance.

## Journey 10 — Public first-run

Final journey:

fresh browser -> sign up -> Creator -> Create -> real upload -> rights -> choose realities -> choose/connect compute -> submit once -> real processing -> four outputs -> Watch -> switch realities -> Library/Jobs -> role switch -> refresh/redeploy -> return to result.

No developer API calls, manual database edits, hidden fixture sessions or operator-only render dispatches are allowed.

## Simulation verdict

The engineering engine is now materially beyond the earlier prototype state: real browser upload, real processing, real MP4 outputs and real Reality Switching are verified.

The customer-visible MVP is still not final.

Release remains blocked on:
1. reality fidelity;
2. one-submission multi-reality creation;
3. durable public deployment proof;
4. navigation/discoverability truth;
5. role-workspace completeness for promised capabilities;
6. human visual acceptance after the preceding corrections.