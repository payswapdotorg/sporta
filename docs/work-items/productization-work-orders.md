# Sporta Productization Work Orders

These work orders extend the completed W001-W806 program. They are the authoritative executable backlog for turning the verified engine into a hosted, installable, user-facing beta.

## P0 — Product shell and contracts

### W901 Product capability contract
Owner: Tech Lead + Platform. Depends on W701.
Deliver: capability discovery for auth state, roles, renderers, live/batch, quotas, provider health, and content availability.
Accept: frontend can render entirely from capability responses; contract fixtures cover every deny/degraded path.

### W902 Identity + multi-role authorization
Owner: Platform. Depends on W701, W901.
Deliver: real user auth, account model, role grants, server-side policy enforcement, session ownership.
Accept: fresh browser can sign in; role switching never expands authority; unauthorized media/output access is denied before bytes are exposed.

### W903 Web product shell
Owner: Product. Depends on W901.
Deliver: `apps/web` installable PWA-capable application shell, navigation, search, responsive layout, accessibility baseline.
Accept: fresh browser loads hosted shell; app can be installed where supported; route/state tests pass.

## P1 — Media/product experience

### W904 Home/Live/Explore/Library
Owner: Product. Depends on W903, W901.
Accept: catalog surfaces match status, renderer availability, authorization/availability state, and real session links.

### W905 Watch page + Reality Switcher
Owner: Product. Depends on W904, W701, W504.
Accept: user watches a real stored output and switches among available renderers without leaving the match; no fake live state.

### W906 Create Studio
Owner: Product. Depends on W902, W904.
Accept: authorized upload -> rights declaration -> render recipe -> progress -> output is executable end-to-end.

### W907 Multi-role workspaces
Owner: Product. Depends on W902, W905, role-experience matrix.
Accept: Viewer/Creator/Analyst/Rights Holder/Operator workspaces are coherent and switchable from one identity.

### W908 UX operational states
Owner: Product + Platform. Depends on W901-W907.
Accept: loading/ready/processing/degraded/denied/unavailable/failed states are backed by real control-plane state; UX simulation fixtures pass.

### W909 Browser E2E
Owner: Product + Platform. Depends on W905, W906, W908.
Accept: real browser tests cover sign-in, watch, render, rights denial, role switch, output playback, and accessibility smoke.

## P2 — Hosted public beta

### W910 Production edge/API deployment
Owner: Platform. Depends on W902, W903.
Deliver: Cloudflare Pages/Workers deployment, environment separation, secrets/config, custom-domain routing.
Accept: public URL works from a clean browser; deployment is reproducible from repository configuration.

### W911 Neon persistence
Owner: Platform. Depends on W902, W910.
Accept: hosted auth/session/job/control state persists across deploys and browser sessions.

### W912 R2 artifact storage
Owner: Platform. Depends on W504, W910.
Accept: authorized input/output artifacts persist in R2; private objects remain access-controlled; playback uses short-lived/authorized delivery.

### W913 Upstash queue/cache/rate limits
Owner: Platform. Depends on W910.
Accept: hosted jobs use bounded queue/cache state; quota guards and degradation paths are tested.

### W914 Compute adapter deployment
Owner: Platform + AI. Depends on W303, W304, W504, W910.
Accept: hosted control plane can dispatch at least one real compute adapter; provider selection is configuration-driven and metered.

### W915 Real network live transport
Owner: Platform. Depends on W305, W910, W914.
Accept: at least one authorized live source reaches the hosted system over a real network and browser playback uses a real transport; latency is measured end-to-end.

## P3 — Discovery and beta safety

### W916 Catalog/content model
Owner: Platform + Product. Depends on W902, W905, W910.
Accept: public/private/role-scoped content is discoverable only where authorized; alternate realities are linked to the same match/session.

### W917 Rights/publication center
Owner: Platform + Product. Depends on W902, W912, W916.
Accept: rights policies can be inspected/changed by authorized rights holders; revoked content stops playback/publication.

### W918 Operational console
Owner: Product + Platform. Depends on W910-W914.
Accept: operator sees hosted health, queues, provider quotas, failed jobs and safe remediation actions.

### W919 Cost/usage guardrails
Owner: Platform. Depends on W911-W914, W918.
Accept: provider usage counters, user/job quotas, spend alarms and fail-closed admission exist.

### W920 Public beta release
Owner: Tech Lead. Depends on W909, W915, W917, W919, W803-W806.
Accept: fresh user can sign up, discover a match, watch, switch renderer, upload authorized media, render, view the result, switch roles, and observe accurate degraded/denied states from a public URL.

## Three-worker dispatch model

### Worker A — Product/UI
W903, W904, W905, W906, W907, W908, W909, later W916-W918 UI portions.

### Worker B — Platform/Deployment
W901, W902, W910, W911, W912, W913, W915, W919 and backend portions of W916-W918.

### Worker C — AI/Rendering integration
W914, hosted renderer wiring, real compute adapter, live rendering validation, quality/evaluation extensions needed by W915/W920.

The tech lead may parallelize A/B/C only after their shared contracts are frozen for the current slice. Avoid parallel edits to the same contract or app shell foundations.

## Completion rule

Do not mark W901-W920 complete from local mocks alone. Each item needs a real hosted or browser-visible evidence path at the boundary it claims to deliver.
