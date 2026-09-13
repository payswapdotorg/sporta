# Contributing to Sporta

## Setup

Sporta is a [Bun](https://bun.sh) monorepo. Install Bun (the required version is
declared in the `engines` field of the root `package.json`), then:

```bash
git clone https://github.com/payswapdotorg/sporta.git
cd sporta
bun install
```

## Commands

Run everything from the repository root:

```bash
bun run lint         # ESLint (flat config + typescript-eslint)
bun run format       # Prettier (write)
bun run format:check # Prettier (check only; used by CI)
bun run typecheck    # tsc --noEmit in every @sporta/* workspace
bun test             # Bun test runner (all workspaces)
```

A change is only ready for review when `lint`, `typecheck`, `test`, and
`format:check` all pass. CI (`.github/workflows/ci.yml`) runs the same commands
on every push to `main` and on every pull request.

## Workspace conventions

- First-party code lives in `packages/*` and is named under the `@sporta/*` scope.
- Every workspace package owns its own `tsconfig.json` (extending the root
  `tsconfig.base.json`) and its own tests.
- Shared tooling (ESLint, Prettier, TypeScript) and cross-workspace scripts live
  at the repository root; packages declare only the dependencies they need.

## Contract-first rule

`docs/contracts/` is the authority for cross-package interfaces, and code never
silently overrides it. Any change under `docs/contracts/` requires tech-lead
approval before it can be merged. If you believe a contract needs to change,
raise it with the tech lead instead of editing contract documents yourself.

## Frozen documents

Do not modify `docs/architecture/`, `docs/adr/`, `docs/contracts/`,
`docs/roadmap/`, or `docs/work-items/` as part of normal implementation work,
and never edit `docs/status/` (tech-lead only). See `AGENTS.md` for the full
authority hierarchy and no-drift rules.

## Worker reporting

Work is assigned per work item (see `docs/work-items/work-items.md`). Workers
are implementation specialists, not architects: implement the assigned
specification, keep changes scoped, add or update tests together with the
implementation, and never introduce secrets into the repository. On completion,
a worker reports:

- summary of the implementation;
- files changed;
- tests run and their results;
- evidence (branch and commit);
- known limitations;
- architectural concerns, if any;
- work items blocked by the result.

The full contract is in `docs/agent-handoff/worker-contract.md`.

## Testing conventions

The test harness is documented in [`docs/testing/HARNESS.md`](docs/testing/HARNESS.md)
(`docs/testing/testing-strategy.md` remains the authority). In short:

- **Layers**: unit tests live in each package's `test/` directory; contract
  fixtures live in `packages/contracts/fixtures/`; cross-package e2e tests
  live in `tests/e2e/` at the repository root (template:
  `tests/e2e/m0-pipeline.test.ts`).
- **Deterministic data**: use the `@sporta/testing` builders and sequences
  with a fixed seed — `buildMediaSession(overrides?, seed?)`,
  `observationTimeline({ count, fromMs, stepMs, seed })`, etc. No
  `Math.random`, no `Date.now`, no `new Date()` in tests; time is always an
  explicit millisecond value, and wall clocks are injected constants
  (`TEST_EPOCH_MS`).
- **All tests run from the root**: `bun test` discovers everything, and CI
  runs `lint`, `typecheck`, `test`, and `format:check` on every push and pull
  request.
