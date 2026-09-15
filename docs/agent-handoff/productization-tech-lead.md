# Sporta Productization Tech-Lead Handoff

This is the next-stage handoff after the verified W001-W806 core program. The mission is to turn the deterministic engine into a public, installable, multi-role sports product.

## Current truth

The core roadmap is complete, but RC3/public beta is not delivered. The existing viewer shell is a development/browser seam, not the final product UI. The release review records four real boundaries: no production deployment/auth/telemetry, no real-network transport, no real-browser paint E2E, and no system deployment rollback. Do not describe the current repo as a hosted product.

## Read first

1. `AGENTS.md`
2. `docs/architecture/architecture-lock.md`
3. `docs/architecture/architecture.md`
4. `docs/architecture/ux-architecture.md`
5. `docs/architecture/deployment-architecture.md`
6. `docs/architecture/role-experience-matrix.md`
7. `docs/work-items/productization-work-orders.md`
8. `docs/testing/ux-operational-simulation.md`
9. `docs/deployment/free-tier-matrix.md`
10. `docs/release/RELEASE-READINESS.md`
11. `docs/status/work-item-status.md`
12. the relevant existing package docs/contracts before editing their seams

## Mission

Deliver all of the following as real, browser-verifiable capabilities:

- installable web/PWA product;
- public hosted deployment;
- authenticated users and server-side authorization;
- YouTube-like discovery/watch interaction model without copying another service's protected design;
- multi-role account with safe role switching;
- creator studio;
- rights/publication center;
- hosted R2 artifact path;
- hosted Neon control plane;
- hosted Upstash queue/cache/rate layer;
- real compute adapter;
- at least one real-network live transport path;
- browser E2E and accessibility verification;
- cost/quota guardrails.

## Non-negotiable product architecture

`apps/web` is the product frontend.

`packages/viewer-shell` remains the headless viewer/control state package.

The frontend consumes capability-aware control/delivery contracts. It must not import or mutate SWM internals.

The role selector changes workspace context only. It never grants authority. Every protected action is reauthorized server-side.

The watch-page Reality Switcher is the central Sporta interaction: one event/session, multiple visual realities.

## Worker plan

### Worker A — Product/UI

Start with W903 and move through W909. Own the shared shell, Home/Live/Explore/Library/Create, Watch page, Reality Switcher, role workspaces, UX state handling, PWA installability, accessibility and real browser tests.

### Worker B — Platform/Deployment

Own W901/W902 and W910-W913/W915/W919. Build the public edge/API boundary, auth, Neon, R2, Upstash, quotas and real network delivery. Keep provider bindings behind adapters.

### Worker C — AI/Rendering integration

Own W914 and any renderer/compute changes needed to connect the already-complete renderers to hosted execution. Extend evaluation only where real hosted behavior needs evidence.

## Parallelization sequence

### Wave 1
A: W903.
B: W901 + W902.
C: audit W914 compute adapter against existing W303/W304/W504 contracts and prepare implementation.

### Wave 2
A: W904 + W905.
B: W910 + W911 + W912 + W913.
C: W914.

### Wave 3
A: W906 + W907 + W908.
B: W915 + W919.
C: hosted rendering quality/latency validation needed by W915.

### Wave 4
A: W909 + UI portions of W916-W918.
B: backend W916-W919.
C: hosted render/live reliability fixes.

### Wave 5
Tech lead integrates and executes W920.

Do not let workers edit the same contract simultaneously. Freeze contract changes first, then parallelize implementations.

## UX freedom rule

Workers are explicitly encouraged to make Sporta visually excellent and distinctive. Allow creative freedom in composition, card design, motion, navigation patterns, renderer controls and storytelling.

Do not allow creative changes to redefine:

- rights semantics;
- role authority;
- SWM truth;
- capability state;
- live-state claims;
- delivery guarantees;
- renderer contract semantics.

## Simulation gate

Before declaring any UX milestone complete, run `docs/testing/ux-operational-simulation.md` end-to-end and update it when the real implementation exposes a mismatch.

The key test is: every visible UI state must be explainable by a real operational state from the control/media/rendering/delivery architecture. There must be no "the UI pretends" paths.

## Provider strategy

Use **Vercel Hobby as the initial web deployment target** for personal/non-commercial beta validation, with Cloudflare Workers + R2, Neon, Upstash and an isolated compute adapter for the supporting control/data plane. Apify is optional for bounded managed jobs. Vercel's current terms restrict Hobby to personal/non-commercial use, so the tech lead must keep a clear deployment boundary: use Hobby for the initial non-commercial beta, and upgrade to a commercially permitted Vercel plan or migrate `apps/web` before commercial operation. citeturn918436search0turn918436search1

Free-tier is a deployment target, not a promise of unlimited free video/GPU processing. Enforce quotas and surface degradation explicitly.

## Final acceptance: W920

A clean browser must be able to:

1. open the public URL;
2. create/sign into an account;
3. land on Home and discover a permitted match;
4. open Watch;
5. play a real Sporta-rendered artifact;
6. switch Original/Anime/3D/Tactical when available;
7. use Search/Explore/Library;
8. switch roles without losing identity;
9. enter Create Studio;
10. upload an authorized fixture;
11. observe actual processing state;
12. view the generated artifact;
13. receive a real rights denial for unauthorized material;
14. experience correct degraded states when provider quotas/availability constrain work;
15. use the Live surface only when real-network transport is actually active;
16. pass browser accessibility smoke tests.

The release is not complete if any of those are mocked or simulated.
