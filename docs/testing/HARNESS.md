# Sporta Test Harness

How tests are written, where they live, and how they stay deterministic. The
**authority for the test layers and their intent is
[`docs/testing/testing-strategy.md`](./testing-strategy.md)** — this document
describes the concrete harness that implements it (introduced by work item
W003). ML-evaluation and performance layers from the strategy are out of scope
here until their work items land.

## Layers

| Layer | Where | What it validates |
| --- | --- | --- |
| Unit | `packages/*/test/*.test.ts` | One package's domain logic in isolation (schema validation, state machines, timeline math, provenance handling). |
| Contract | `packages/contracts/test/` + JSON fixtures in `packages/contracts/fixtures/` | The `@sporta/contracts` zod schemas accept their golden valid fixtures and reject single-defect invalid fixtures; exported JSON Schemas match `fixtures/schemas-golden/`. |
| Integration (cross-package e2e) | `tests/e2e/*.test.ts` (repository root) | Vertical slices across public package APIs — the M0 template is `tests/e2e/m0-pipeline.test.ts` (session lifecycle → observation store → event derivation → world model → replay). |

There is deliberately no second runner or config: the root `bun test`
discovers everything under `packages/*/test/` and `tests/e2e/` automatically,
and CI (`.github/workflows/ci.yml`) runs exactly that after `lint` and
`typecheck`.

## Where fixtures live

- `packages/contracts/fixtures/` — versioned **JSON contract fixtures**:
  `valid/` (must parse with their schema), `invalid/` (single-defect variants,
  must be rejected), and `schemas-golden/` (exported JSON-Schema snapshots,
  regenerated via `bun run export-schemas` in `packages/contracts`).
- `packages/*/test/fixtures/` — package-local JSON fixtures plus a small
  `load.ts` (see `packages/session/test/fixtures/` for the pattern).
- Inline typed fixtures — small `helpers.ts` factories next to the tests they
  serve, with only the fields under test varied.

Prefer builders or inline fixtures for new unit tests; add JSON contract
fixtures only when the point of the test is the fixture itself (schema
compatibility, golden snapshots).

## Deterministic test data: `@sporta/testing`

`packages/testing` is the shared test-data library. It has one rule:
**same seed in, same data out** — deep-equal across runs, machines, and CI.

- `createRng(seed)` — mulberry32 PRNG; `seedFromString("m0-e2e")` — FNV-1a
  hash for named seeds. Pinned regression values live in
  `packages/testing/test/rng.test.ts`.
- Builders — `buildMediaSession`, `buildObservation`, `buildEventEnvelope`,
  `buildWorldSnapshot`, `buildAuthorizationPolicy`, `buildRenderRequest`,
  `buildStageMessage` — each takes `(overrides?, seed?)`, deep-merges the
  overrides onto valid defaults (objects merge; arrays replace), and validates
  the result with the contracts zod schema, so invalid overrides throw the
  zod error instead of leaking invalid documents.
- Sequences — `observationTimeline({ count, fromMs, stepMs, modalities?, sessionId?, seed })`
  and `eventSequence({ count, fromMs, stepMs, eventTypeRefs?, sessionId?, seed })`
  spread schema-valid items across the canonical media timeline, alternating
  modalities (vision/audio/metadata) or event types.

### The determinism rules

1. **No `Math.random`** in any test or helper — every draw comes from a seeded
   `createRng`/builder.
2. **No `Date.now`/`new Date()` in tests** — wall-clock values are explicit
   constants (`TEST_EPOCH_ISO`/`TEST_EPOCH_MS` from `@sporta/testing`); when a
   service needs a clock, inject one (e.g. `SessionLifecycle({ now })`,
   `WorldModelEngine.create(..., { now })`).
3. **Time is always explicit milliseconds** on the canonical media timeline
   (`fromMs`, `stepMs`, `eventTimeMs`, ...), never "now"-relative.
4. **Prefer a named seed** (`seedFromString("...")` or a literal) at the top
   of the test so the fixture is identifiable when it fails.
5. Statistical properties belong in ML evaluation with fixed seeds and
   tolerances (see the strategy document), not in unit tests — the only
   distribution check in the harness uses fixed-seed pinned bounds.

## The e2e template

`tests/e2e/m0-pipeline.test.ts` is the template for future e2e fixtures: one
deterministic linear slice through public package APIs, commented per
section, with fixed seeds and explicit times, asserting the cross-package
invariants (watermarks, entity versioning, provenance, uncertainty
preservation, replay determinism). New e2e files follow the same shape and
naming (`tests/e2e/<milestone-or-flow>.test.ts`).

The e2e tests import the workspace packages by name; they resolve through the
root `package.json` `devDependencies` (`@sporta/*` → `workspace:*`), which is
what makes the root `tests/` directory a first-class consumer of the
workspaces.

## Checklist for a new test

- [ ] Unit test? Put it in the owning package's `test/` directory.
- [ ] Cross-package behavior? Put it in `tests/e2e/` and follow the template.
- [ ] Data from `@sporta/testing` builders/sequences with a fixed seed — no
      `Math.random`, no clock reads.
- [ ] Overrides on builders, not hand-written documents, unless the test is
      specifically about an invalid document (then assert the zod rejection).
- [ ] `bun test`, `bun run lint`, `bun run typecheck`, and
      `bun run format:check` all pass from the repository root.
