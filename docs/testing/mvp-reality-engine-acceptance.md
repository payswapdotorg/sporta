# Sporta MVP Reality Engine — Acceptance Contract

This is the customer-visible acceptance contract for R601-R605. It supersedes any interpretation that fixture, SVG, in-process, or adapter-only evidence is sufficient for the MVP.

## A. Input

- Clean browser over HTTPS.
- Authenticated user with an explicit transformation right.
- Real football MP4 supplied by the user.
- MVP support envelope documented by the upload validator (duration, resolution, codec, camera envelope).

## B. Processing

The browser must show real server-backed states:

`uploading -> queued -> running -> collecting -> succeeded|failed|cancelled`

No client-generated percentage is acceptance evidence.

## C. Canonical reconstruction

The same upload produces one canonical session and one SWM. The SWM must preserve provenance/confidence and explicit uncertainty. Renderer-specific implementations cannot become the canonical source of match truth.

## D. Required outputs

For each accepted MVP clip:

1. Original MP4 — the normalized source/original reality.
2. Tactical MP4 — tactical visualization driven by the SWM.
3. 3D Game MP4 — stylized 3D game-style rendering driven only by the SWM.
4. Anime/NPR MP4 — non-photorealistic/cel-shaded rendering of the same SWM scene.

Each output must have a content-addressed or otherwise integrity-verifiable artifact manifest and be playable in a normal HTML5 video element.

## E. Same-event integrity

All realities for a session must reference the same canonical session/SWM. The final evidence must verify:

- event ordering;
- game clock/score where available in the supported input;
- ball trajectory continuity within the declared envelope;
- player/track continuity within the declared envelope;
- no renderer silently invents or changes canonical events.

## F. Reality Switcher

From one Watch session, the user can switch among the available output realities without navigating to another match. The selected artifact may change; the match/session identity may not.

## G. Technology evaluation

Every promoted production technology must have:

- version and provenance;
- code/model/checkpoint/dataset license status;
- capability/resource profile;
- benchmark report;
- cost/throughput evidence;
- known failure modes;
- promotion decision record.

The same benchmark fixtures and metrics must be reusable for candidate replacement, ensemble, cascade and fallback evaluation.

## H. Two-clip requirement

R601 and R602 must each pass with materially different real football clips. At least one clip should contain camera movement/cuts and ball/player occlusion representative of the declared MVP envelope.

## I. Human visual acceptance

A human reviewer must confirm:

- outputs are actual videos;
- outputs are visibly different realities;
- outputs clearly depict the same underlying match/event;
- output artifacts are not merely debug visualizations;
- the product is understandable without developer intervention.

The reviewer must record the actual artifact URLs/IDs and the test environment.

## J. Public MVP acceptance

A fresh browser must complete:

```text
Create
 -> upload real authorized MP4
 -> declare rights
 -> choose/use compute
 -> observe real processing
 -> receive four real video outputs
 -> open Watch
 -> play Original
 -> switch Tactical
 -> switch 3D
 -> switch Anime/NPR
 -> remain on the same match/session
```

The acceptance run must be repeatable after a fresh deployment and must not depend on a pre-seeded fixture session.

## K. Automatic rejection conditions

Reject the MVP gate if any of these occur:

- only a checked-in fixture can demonstrate the path;
- output is SVG/PNG/JSON rather than actual video;
- progress is simulated;
- compute did not actually execute;
- reality switch changes session/match;
- a missing fact is silently fabricated;
- rights are bypassed;
- renderer implementation is directly embedded into the product/domain contract;
- a provider/model/game engine is required by a frozen domain interface.
