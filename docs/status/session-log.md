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

---

## Session S002 — 2026-09-14 — Post-reset recovery: M1 completion, G2 achieved, M2 through W402

**Tech lead:** resident implementation tech lead (operator-appointed).

### 1. Context

Continuation after a full sandbox reset (01:11 UTC) that wiped local state
(sporta clone, replay2, ~/.secrets). GitHub repos, chat.z.ai conversations,
and the operator survived. Recovery per lesson 118 (boot prompt): stack
redeploy, operator login, PAT restore, prompt extraction from the dead W206
chat, re-dispatch.

### 2. Session results

- **Push queue cleared**: W209 merge chain (d42a666) + evidence pushed; CI
  runs 33/34 success.
- **W206 COMPLETE** (re-dispatched via recovered prompt): merge 4db3641,
  1086/1086 tests, CI 35 success. TL review found the delivery faithful;
  the worker caught a real spec flaw (pan 0.5 zoom 1 tangency) honestly.
- **Gate G2 ACHIEVED**: `tests/e2e/m1-understanding.test.ts` (merge
  a33cd79) — the M1 exit demo, one synchronized store of player/ball
  observations + commentary-derived candidates. **M1 complete: 13/13.**
- **W401 COMPLETE** (multimodal world-model fusion, parallel dispatch):
  merge 2bf5389, 1158/1158 tests, CI 36 success. Explicit conflict ledger,
  idempotent re-fusion, honest uncertainty — constitution-faithful.
- **W402 COMPLETE** (temporal snapshots/events): merge 64d4ab6, 1201/1201
  tests. Deterministic bounded forward replay with corrections,
  checkpoints, fail-loud limits.

### 3. Session-end state (§14 record)

- **Current milestone:** M2 in progress (W401 ✓, W402 ✓; W403 next).
- **Completed this session:** W206, G2 gate, W401, W402.
- **Blocked:** none. Capacity sieges are fought, never awaited (operator
  policy; peak hours cost ~75 min on the G2 dispatch).
- **Active risks:** peak-hour GLM-5.3 capacity (mitigated by the assault
  machinery); renderer saturation on long agent turns (fresh-tab re-sync
  is the reliable diagnostic); queue_watch completion-gate regex does not
  match sporta report formats — retire watchers manually (kill + rm flags
  BEFORE done/void).
- **Architectural deviations/proposals:** none requiring an ADR. Noted
  future seams (worker-flagged, TL-accepted): typed event-candidate
  payload contract bump (W401 parser), engine-side detached-correction
  seam (W402), entity event-sourcing (W402 replay limitation).
- **Next executable work items:**
  1. **W403 replay/evaluation** (deps W402 ✓) — dispatching next.
  2. Then M3: W502 anime renderer prototype (deps W501 ✓, W402 ✓).
- **Worker ownership:** A = AI/domain (W2xx/W4xx/W5xx/W6xx), B = Platform,
  C = Product (first dependency-safe Product work: W701, deps W501).
- **Operator credentials:** PAT + composio keys in ~/.secrets/env.sh
  (never committed); workers receive the PAT via dispatch prompt
  (chat.z.ai redacts tokens in transcripts).

---

## Session S003 — 2026-09-14 — M2 complete (G3), M3 through W503, W301 landed

**Tech lead:** resident implementation tech lead (operator-appointed).
*Post-hoc reconstruction by the next session's tech lead: S003 died mid-wave
before writing this entry. Source: worklog entries S124–S130 and
S003-W502-A/W403-A/G3-A/W503-A/W301-B plus git history on main.*

### 1. Context

Continuation of S002. All dispatches ran as local subagent workers in
dedicated git worktrees (`/home/z/sporta-w*`); the recurring hazard was
workers dying after doing work but before committing/reporting — the
established posture (W502/W403/W503/W301) is: audit inherited work
line-by-line, complete rather than rewrite, fix real bugs, pin fixes
with tests.

### 2. Session results

- **W403 COMPLETE** (replay/evaluation): branch 16d6b17, merge 267f015.
  Fixed-fixture cross-run comparability, field-classified tolerance
  (EXACT/EPSILON/COUNT/SET), forced-constant volatile fields, golden
  baseline + mutation-detection negatives; 3 real bugs found in the
  inherited flight's code and fixed.
- **W502 COMPLETE** (anime renderer prototype): branch 13348f1, merge
  766e7f7. Deterministic SVG clip rendering from SWM snapshots,
  conformance 13/13, identity-stable palette, accounted dispositions,
  fail-closed rights beyond R2 baseline.
- **Gate G3 ACHIEVED** — M2 complete. Exit demo
  `tests/e2e/m2-world-model.test.ts`: branch a66cfb4, merge 16d4293.
  Five-wave streaming fusion, stateAt pins, a real correction through
  public seams (deriveEvent correctionOf + applyEvent), replay with
  supersession/orphan counted, idempotent re-fusion, deep-equal rerun.
- **W503 COMPLETE** (temporal consistency evaluation): branch fd775e7,
  merge 68d121c. Flicker/drift/artifact metrics over the W502 manifest,
  21 checks, 9/9 injected defects detected, THRESHOLDS.md pinned
  both directions.
- **W301 COMPLETE** (streaming ingress): branch fa5769d, merge 5cb4bc4.
  LiveSource seam, fixture feed, rights-gated admission, verbatim
  timestamps, bounded delivery, exact accounting balance.
- Status evidence commits: 4df59eb (W403+W502), 446c316 (G3+W503+W301).
  Final state: main 446c316, 1656/1656 tests, 27 packages, CI green.

### 3. Session-end state (§14 record)

- **Current milestone:** M2 COMPLETE (G3). M3 W501/W502/W503 done, W504
  next. M4 W301 done. M5 W701 done. M6/M7 not started.
- **In flight when the session died (wave of 3, worktrees at base
  446c316, all re-dispatched by S004):**
  - W302 bounded processing queues — worktree `sporta-w302`, clean, no
    inherited code.
  - W504 anime output pipeline — worktree `sporta-w504` carries
    UNCOMMITTED partial work: `packages/output-pipeline` (encode/store/
    errors/types + ENCODING.md + 2 test files) + control-api playback
    integration (playback.ts + app/http/errors/index modifications,
    ~+232 lines) + bun.lock +15.
  - W702 viewer shell — worktree `sporta-w702` carries UNCOMMITTED
    partial work: complete-looking `packages/viewer-shell` (12 src
    modules, 5 test files, web/index.html + bootstrap.ts) + bun.lock
    +16.
- **Blocked:** none.
- **Active risks:** worker flights dying post-work pre-report
  (mitigated by the audit-first posture + this reconstruction);
  sandbox resets (secrets + worklog are local-only — session-log on
  GitHub is the durable record).
- **Architectural deviations/proposals:** none new requiring an ADR.
  Open seams flagged by workers: W401 fusion derives no corrections
  (demo-authored policy only); typed event-candidate payload contract
  bump; engine-side detached-correction seam; entity event-sourcing.
- **Next executable work items (dependency-safe):** the W302/W504/W702
  wave, then W303 (needs W302), W703 (needs W701 ✓), W601 (needs
  W401 ✓), W805 (needs W007 ✓).
- **Operator credentials:** PAT + composio keys in ~/.secrets/env.sh
  (never committed); worktrees' origin remote carries the PAT for
  pushes (local .git/config only, never committed).
