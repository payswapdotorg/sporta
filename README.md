# Sporta

Sporta is an AI-powered universal sports rendering platform. It ingests licensed or user-authorized sports media, reconstructs the underlying sporting event as a structured Sports World Model, and renders that event into multiple visual realities such as anime, arcade/game-style, tactical, and future immersive formats.

## Current repository state

The core engineering program W001-W806 is complete and verified. The productization program is now extending that engine into a hosted, installable, multi-role public beta.

**Important:** the repository is not yet a claim that Sporta is publicly deployed. The authoritative release state is in `docs/status/` and `docs/release/RELEASE-READINESS.md`.

## Source of truth

The repository is the authoritative source of truth. Do not depend on chat history or undocumented assumptions.

Read in order:

1. `AGENTS.md`
2. `docs/architecture/architecture-lock.md`
3. `docs/architecture/architecture.md`
4. `docs/architecture/ux-architecture.md`
5. `docs/architecture/deployment-architecture.md`
6. `docs/architecture/role-experience-matrix.md`
7. `docs/architecture/dependency-graph.md`
8. `docs/roadmap/roadmap.md`
9. `docs/roadmap/productization-roadmap.md`
10. `docs/work-items/work-items.md`
11. `docs/work-items/productization-work-orders.md`
12. relevant `docs/contracts/`
13. `docs/testing/ux-operational-simulation.md`
14. `docs/deployment/free-tier-matrix.md`
15. `docs/agent-handoff/productization-tech-lead.md`

## Product experience target

Sporta is a sports viewing and creation product, not only a backend API. The target web experience has a modern video-platform information architecture:

`Home | Live | Explore | Library | Create | Following | Search | Role switcher`

A user can hold multiple roles and switch among Viewer, Creator, Analyst/Commentator, Rights Holder, and Operator/Admin workspaces without changing identity. The main Watch page contains the **Reality Switcher** so the same sporting event can be experienced through available renderers without leaving the match.

## Productization goal

The next release gates require Sporta to become:

- installable as a browser/PWA product;
- publicly hosted;
- authenticated and server-authorized;
- backed by Neon, Cloudflare R2, Upstash and an isolated compute adapter;
- usable through a YouTube-like discovery/watch model;
- capable of real browser E2E;
- capable of at least one real-network live path;
- explicit about provider quotas, rights and degraded states.

The free-tier strategy is documented with current provider limits and caveats; sustained GPU/video workloads are not assumed to be free.

## Legal/product boundary

Sporta must only ingest and transform media for which the operator/user has the required rights or authorization. Transformation does not automatically eliminate copyright, broadcast, trademark, publicity or personality-rights obligations.

## Development

Requires Bun >=1.3.14.

```bash
bun install
bun run lint
bun run format:check
bun run typecheck
bun test
```

CI runs lint, typecheck, tests, and format checks on pushes to `main` and pull requests.
