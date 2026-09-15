# Sporta Product + UX Architecture

Status: ADDITIVE — preserves the frozen SWM/media/intelligence/rendering architecture.

## Product shape

Sporta is a sports viewing + creation product built on the Sports World Model. It should feel as approachable as a modern video platform while exposing possibilities ordinary sports players cannot offer.

Shared navigation: `Home | Live | Explore | Library | Create | Following | Search | Role switcher`.

One account may hold many roles. The active role changes the workspace, not permissions. Rights and authorization remain control-plane decisions.

## Roles and workspaces

- **Viewer:** discover/watch matches, switch realities, inspect events/commentary, save authorized content.
- **Creator:** upload authorized media, define render recipes, monitor jobs, manage derivatives and publish permissions.
- **Analyst / Commentator:** inspect timeline, commentary, events, tactics, SWM evidence, clips and notes.
- **Rights Holder:** manage authorization, territories/audiences, derivative permissions, revocation and audit.
- **Operator / Admin:** inspect queues, health, jobs, renderer/model availability, incidents, abuse and audit state.

## Watch experience

The watch page is the main product surface.

```text
+------------------------------------------------------------------+
| Sporta | Search                         | Role | Profile        |
+------------------------------------------------------------------+
| Match / teams / status / LIVE                                    |
| +-------------------------------+------------------------------+ |
| |                               | Reality Switcher            | |
| |         PRIMARY PLAYER        | Original / Anime / 3D /   | |
| |            SURFACE             | Tactical / available...    | |
| |                               |                              | |
| +-------------------------------+------------------------------+ |
| Timeline + playback + event markers                             |
| Renderer | Camera | Commentary | Tactics | Stats | Highlights    |
| Commentary narrative / event context / provenance               |
+------------------------------------------------------------------+
```

The **Reality Switcher** is first-class: viewers switch visual representations without leaving the match. Availability is capability-driven and rights-aware.

## Home and Explore

Expose three categories together:

1. live/upcoming matches;
2. alternate realities of those matches;
3. things users can create.

Cards expose sport, event status, renderer, creator/rights state and availability without overwhelming users.

## Create Studio

Guided flow: authorized source -> desired experience -> renderer/style -> commentary/camera/tactical behavior -> rights preview -> render -> quality/progress -> publish/private.

Workers may be creative with visual style, layout, transitions and micro-interactions, but may not invent rights semantics, fake live state, hidden capabilities or unmeasured performance claims.

## Role switching

The role switcher shows current role, available roles, pending work and safe return. Switching roles does not mutate identity, sessions or authorization policies.

## UX state contract

Major screens represent: `loading | ready | processing | degraded | denied | unavailable | failed`.

Permanent rights denial must not become a retrying UI. Controlled/in-process streaming must never be presented as real live network streaming.

## Accessibility

Desktop-first but responsive. Keyboard/focus order, captions/transcripts, reduced motion, contrast, semantic controls and screen-reader names are release-gated.

## Frontend boundary

Create `apps/web` as the product frontend. Keep `packages/viewer-shell` as the headless viewer/control state package and browser compatibility seam. The app consumes stable control/delivery contracts and never reaches directly into SWM internals.
