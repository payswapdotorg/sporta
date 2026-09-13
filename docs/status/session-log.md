# Sporta Session Log

Append-only record of tech-lead sessions. One entry per session, newest last.
The newest entry is the authoritative operational state of the project for the
next session (per §14 of the tech-lead brief). Do not edit past entries.

---

## Session S001 — 2026-09-13 — Bootstrap audit + M0 foundation execution

**Tech lead:** resident implementation tech lead (operator-appointed).

### 1. Audit performed (per §13)

Read in order: `AGENTS.md`, `architecture-lock.md`, `architecture.md`,
`dependency-graph.md`, `roadmap.md`, `work-items.md`, all three contracts
(`sports-world-model.md`, `renderer.md`, `streaming.md`),
`testing-strategy.md`, `rights-security.md`, `worker-contract.md`; plus
`README.md`, both ADRs, `docs/agent-handoff/tech-lead.md`.

Repository state at session start:

- 2 commits on `main` (`0e15d39` bootstrap handoff, `6e59864` docs).
- 16 files, documentation only. No code, no tests, no CI, no package manifest.
- All work items `NOT_STARTED`. Gate G0 (handoff-ready) is achieved; M0 not started.

Cross-document verification:

- Authority hierarchy (AGENTS.md) ↔ tech-lead handoff ↔ user brief: consistent.
- Pipeline definition in architecture-lock §2 ↔ architecture.md §1: consistent.
- Three-worker model and ownership boundaries: consistent across AGENTS.md,
  work-items owners, tech-lead.md.
- Milestone dependency summary ↔ roadmap gates: consistent.
- Rights boundary, vendor neutrality, renderer abstraction: no contradictions.

**One dependency inconsistency found and resolved (documented here):**

- `work-items.md` W003 lists dependencies `W001`; `dependency-graph.md` adds the
  edge `W002 -> W003`. Conservative resolution: W003 requires **both W001 and
  W002** (the stricter edge set governs; it changes no execution order because
  W001 and W002 are both in the first execution batch anyway).
  `work-items.md` was corrected to list `W001, W002` for W003.
- Everywhere else the two documents agree, or `work-items.md` is stricter
  (e.g. W201/W202 additionally require W102) — stricter edges govern; no edits.

No architecture-lock violations exist (no implementation exists yet).
No ADR required: nothing infeasible discovered; only a doc-level correction.

### 2. Execution plan for this session

M0 is the only dependency-safe milestone. Worker C (Product) has no
dependency-safe work in M0 (first Product item W701 needs W004 + W501) —
deliberately unassigned, per the parallelization rules.

- Worker B (Platform): W001 → W003 → W004 → W007.
- Worker A (AI): W002 (tech-lead co-owned; schema design authored by tech lead)
  → W005 + W006.
- Worker C: unassigned this session.

Stack decisions (implementation defaults per architecture.md §13, not frozen):
bun workspaces monorepo, TypeScript strict, zod v4 schemas as contract source
of truth with JSON Schema export and golden-schema compatibility tests,
`bun test` as the test runner, eslint + prettier, GitHub Actions CI.

### 3. Session results — M0 COMPLETE (Gate G1 satisfied)

All M0 work items COMPLETE with recorded evidence (see
`docs/status/work-item-status.md`):

| Item | Worker session | Worker commit | Merge on main |
|------|----------------|---------------|----------------|
| W001 | w001-repo-bootstrap | e4dfad5 | bc18272 |
| W002 | w002-domain-contracts | c35bb90 | d851e44 (evidence 7392cf4) |
| W004 | w004-session-model | b338854 | f5656d7 |
| W005 | w005-observation-model | 1870cae | f5656d7 wave |
| W006 | w006-swm-contract | 2445c7b | f5656d7 wave |
| W003 | w003-test-ci-foundation | 806e649 | 74a955b (evidence 7e845b1) |
| W007 | w007-observability | 41803d1 | d6d6150 (evidence 02c6b4a) |

Final M0 state: **356 tests, 24 test files, 0 failures**; lint/typecheck/format
clean; CI green on every merge (final: run on 02c6b4a, success). Packages:
`@sporta/contracts` (14 zod v4 modules, 13 exported JSON schemas, golden
compat enforcement), `@sporta/session` (lifecycle, fail-closed rights,
in-memory + bun:sqlite repositories), `@sporta/observation` (store,
evidence-linked derivation, deterministic replay), `@sporta/world-model`
(versioned entities, at-T snapshots, bounded reorder, football extension),
`@sporta/testing` (deterministic builders/sequences), `@sporta/observability`
(logger/correlation/metrics/trace, zero-dep). E2E: `tests/e2e/m0-pipeline`
(vertical slice) + `tests/e2e/m0-observability` (6-stage correlated trace).

Gate G1 exit evidence: CI green ✓; contracts validate fixtures ✓
(fixtures.test.ts); media/session lifecycle tests green ✓; tracing correlation
works ✓ (m0-observability.test.ts).

### 4. Session-end state (§14 record)

- **Current milestone:** M0 complete; entering M1 (football perception +
  commentary).
- **Completed:** W001-W007 (all evidence above).
- **Blocked:** none.
- **Active risks:**
  - GLM-5.3 peak-hour capacity (W007 queued-capacity ~40 min before
    generating; two-state policy handled it — accepted sends must never be
    cancelled; plan for queue delays during peak hours).
  - Display-layer ANSI-swallow artifact (`[m` sequences, e.g. `branches: ain]`)
    has now fooled two independent viewers — byte-verify with `od -c` before
    ever "fixing" corrupted-looking text (also seen by W003 worker; no patch
    applied, bytes verified `[main]`).
  - chat.z.ai transcripts are virtualized/collapsed — `check` char counts are
    not cumulative progress; branch push + final-report markers are the
    reliable completion signals.
- **Architectural deviations/proposals:** none. Accepted documented worker
  micro-deviations: UncertainValue lives in src/uncertainty.ts (avoids
  circular module deps); Score.status typed as UncertainValue<enum>;
  root package.json carries workspace devDeps for e2e imports.
- **Next executable work items (M1, dependency order):**
  1. **W101 source ingestion** (deps: W004 ✓) — UNBLOCKED, dispatching now.
  2. W102 demux/decode normalization (needs W101).
  3. Then parallel wave: W103 timeline sync + W201/W202/W203 perception
     (all need W102; W201/W202 also need W005 ✓); W207 STT adapter (needs W103).
- **Worker ownership:** A = AI/domain (W2xx, W4xx, W5xx, W6xx); B = Platform
  (W1xx, W3xx, W7xx-platform, W8xx); C = Product (W7xx-product) — first
  dependency-safe Product work is W701 (needs W004 ✓ + W501).
- **Operator credentials:** PAT + composio keys stored in ~/.secrets/env.sh
  (never committed); workers receive push-only token via prompt; chat.z.ai
  redacts tokens in transcripts.
