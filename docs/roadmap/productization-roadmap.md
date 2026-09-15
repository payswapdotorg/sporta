# Sporta Productization Roadmap

Current implementation program: **50/50 core work items complete**. The next roadmap converts the verified engine into a hosted product users can install/use.

```text
M0-M7 CORE ENGINE
        |
        v
P0 PRODUCT SHELL
  W901 -> W902 -> W903
        |       |
        |       +--> W904 --> W905 --> W909
        |                    |
        +--> W906 --> W907 -> W908
        |
        v
P2 HOSTED BETA
 W910 -> W911
     |-> W912
     |-> W913
 W914 -----------------> W915
        |
        v
P3 TRUST + OPERATIONS
 W916 -> W917
 W918 -> W919
        \      /
         W920 PUBLIC BETA
```

## Product gates

### G9 — Installable product shell
Pass when a clean browser opens `apps/web`, can install the PWA where supported, authenticate, navigate Home/Live/Explore/Library/Create and switch roles.

### G10 — YouTube-like watch experience
Pass when a user can discover content, open a watch page, play a real Sporta output, search/navigate around content, inspect related renderings and switch realities without leaving the match.

### G11 — Hosted control plane
Pass when auth/session/job state survives redeploys using the hosted deployment stack and the API is reachable from a public URL.

### G12 — Hosted media + render path
Pass when an authorized upload reaches hosted processing, artifacts persist in R2, output playback works from a fresh browser, and compute is dispatched through a real adapter.

### G13 — Real live
Pass when one authorized live source reaches the public system through real network transport and the UI reports measured live status/latency.

### G14 — Public beta
Pass when a fresh user can complete the viewer flow and creator flow while rights, quotas, role switching, degraded states, and operations are all real rather than demo-only.

## Definition of success

Only after G9-G14 are green may Sporta be described in the repository as:

1. installable and usable by a fresh user;
2. publicly deployed using the documented free/low-cost stack at beta scale;
3. a YouTube-like sports viewing product with a distinct Sporta interface and multiple role workspaces.
