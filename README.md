# Sporta

Sporta is an AI-powered universal sports rendering platform. It ingests licensed or user-authorized sports media, reconstructs the underlying sporting event as a structured Sports World Model, and renders that event into multiple visual realities such as anime, arcade/game-style, tactical, and future immersive formats.

## Current repository state

The repository contains a verified engineering foundation (W001-W806), productization work (W901-W921), and the approved **MVP Reality Engine** program. The current public web deployment is a product shell/beta environment, but the repository does **not** claim MVP-complete status until the real-video Reality Engine gate passes.

The authoritative current state is in `docs/status/mvp-reality-engine-status.md`.

## Source of truth

The repository is the authoritative source of truth. Do not depend on chat history or undocumented assumptions.

Read in order:

1. `AGENTS.md`
2. `docs/architecture/architecture-lock.md`
3. `docs/architecture/architecture.md`
4. `docs/architecture/technology-plane.md`
5. `docs/architecture/compute-broker.md`
6. `docs/architecture/ux-architecture.md`
7. `docs/architecture/deployment-architecture.md`
8. `docs/architecture/role-experience-matrix.md`
9. `docs/adr/ADR-009-mvp-reality-engine-and-technology-neutrality.md`
10. `docs/roadmap/roadmap.md`
11. `docs/roadmap/productization-roadmap.md`
12. `docs/roadmap/mvp-reality-engine-roadmap.md`
13. `docs/work-items/work-items.md`
14. `docs/work-items/productization-work-orders.md`
15. `docs/work-items/mvp-reality-engine-work-items.md`
16. `docs/testing/ux-operational-simulation.md`
17. `docs/deployment/free-tier-matrix.md`
18. `docs/agent-handoff/mvp-reality-engine-tech-lead.md`

## Product experience

Sporta is a sports viewing and creation product, not only a backend API. The web experience is organized around:

`Home | Live | Explore | Library | Create | Following | Search | Role switcher`

A user can hold multiple roles and switch among Viewer, Creator, Analyst/Commentator, Rights Holder, and Operator/Admin workspaces without changing identity. The Watch page contains the **Reality Switcher** so the same sporting event can be experienced through available renderers.

## The real MVP

The MVP is not considered complete merely because an adapter, fixture, SVG artifact, or in-process seam passes tests.

The MVP result is:

`authorized real football MP4 -> real perception -> SWM -> Original + Tactical + 3D Game + Anime/NPR actual video -> R2 -> HTML5 playback -> Reality Switcher`

A clean browser must be able to upload a real authorized football clip, observe actual processing, receive real video outputs, watch them, and switch realities for the same match/session. This must work on at least two materially different clips.

## Technology neutrality

No product/domain capability may depend directly on one specific AI model, tracker, renderer, game engine, or GPU provider. Replaceable technologies enter through versioned adapters and are evaluated through the Sporta Technology Evaluation Plane.

Sporta supports replacement, ensemble, cascade, and fallback strategies. Candidate technologies must carry benchmark, provenance, version and licensing metadata before promotion.

See `docs/architecture/technology-plane.md` and `docs/adr/ADR-009-mvp-reality-engine-and-technology-neutrality.md`.

## Compute strategy

GPU execution is provider-neutral through the Compute Broker. Initial provider candidates include Modal, Lightning AI, RunPod and local/self-hosted GPU workers. Hugging Face/ZeroGPU may be used for bounded experiments.

Users will be able to choose between Sporta-managed compute and connected user-owned compute through the Compute Connection Center. Future Sporta compute subscriptions use the same broker and contracts.

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
