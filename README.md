# Sporta

Sporta is an AI-powered universal sports rendering platform. It ingests licensed or user-authorized sports media, reconstructs the underlying sporting event as a structured world model, and renders that event into multiple visual realities such as anime, arcade/game-style, tactical, and future immersive formats.

## Repository status

This repository has been bootstrapped as a clean-room implementation handoff. No production implementation has started yet.

## Source of truth

The repository is the authoritative source of truth for the project. An implementation agent must not depend on chat history or undocumented assumptions.

Read, in order:

1. `AGENTS.md`
2. `docs/architecture/architecture-lock.md`
3. `docs/architecture/architecture.md`
4. `docs/architecture/dependency-graph.md`
5. `docs/roadmap/roadmap.md`
6. `docs/work-items/work-items.md`
7. the relevant contracts under `docs/contracts/`
8. the relevant acceptance gates under `docs/testing/`

## Product thesis

Sporta is not fundamentally a video filter. Its core asset is a Sports World Model that fuses video, audio/commentary, tracking, event detection, rules, and optional metadata into a time-consistent representation of the sporting event. Renderers consume that representation and remain replaceable.

## Initial product

The first production scope is football. The first demonstrable experience is a user-authorized short football clip rendered into multiple styles, followed by near-real-time and real-time streaming. The architecture must remain sport-agnostic at the domain boundary so additional sports can be added later without rewriting the platform core.

## Legal/product boundary

Sporta must only ingest and transform media for which the operator/user has the required rights or authorization. The project must not assume that transformation, stylization, or re-rendering automatically eliminates copyright, broadcast, trademark, publicity, or personality-rights obligations.

## Implementation rule

No work item is considered complete because code exists. It is complete only when its acceptance criteria, tests, observability, documentation, and architecture conformance requirements are satisfied.

## Development

### Setup

Requires [Bun](https://bun.sh); the required version is declared in the `engines`
field of the root `package.json`.

```bash
bun install
```

### Commands

Run from the repository root:

```bash
bun run lint         # ESLint (flat config + typescript-eslint)
bun run format       # Prettier (write)
bun run format:check # Prettier (check only; used by CI)
bun run typecheck    # tsc --noEmit in every @sporta/* workspace
bun test             # Bun test runner (all workspaces)
```

CI (`.github/workflows/ci.yml`) runs lint, typecheck, tests, and
`format:check` on every push to `main` and on every pull request.

### Workspace layout

```text
.
├── AGENTS.md            # agent operating contract
├── CONTRIBUTING.md      # contributor guide
├── docs/                # authority documents (frozen; see AGENTS.md)
├── packages/
│   └── contracts/       # @sporta/contracts — shared contract definitions
├── tsconfig.base.json   # shared TypeScript compiler options
└── package.json         # root scripts and shared dev tooling
```

See `CONTRIBUTING.md` for workspace conventions, the contract-first rule, and
the worker reporting rules.
