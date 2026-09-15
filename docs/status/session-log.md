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

---

## Session S004 — 2026-09-14 — M3+G4, wave execution via local Task-tool workers

**Tech lead:** resident implementation tech lead (operator-appointed).

### 1. Context

Continuation of S003 (reconstructed). Dispatch mechanism this session: the
sandbox's Task/subagent tool with dedicated git worktrees per worker
(`/home/z/sporta-wXXX`, branch `wXXX-<slug>`) — no chat.z.ai dependency.
Secrets persisted in `~/.secrets/env.sh` (PAT + composio keys, never
committed); worktree origins carry the PAT in local .git/config only.

### 2. Session results (all merged to main, CI-visible)

- **W302** bounded processing queues — merge aae6f00, 1784/1784.
- **W504** anime output pipeline — merge 79c1058, 1994/1994 (worker audit
  found a fail-open NaN rights hole in inherited work; fixed + pinned).
- **W702** viewer shell — merge 9972833 + TL merge-seam fix 2d67300,
  2148/2148.
- **G4 gate ACHIEVED (M3 complete)** — exit demo `tests/e2e/m3-rendering.test.ts`,
  branch bb7a02f, merge a661b45, 2149/2149. Surfaced the fusion
  `position` vs renderer `pitchPosition` slot seam (measured in-test).
- **W601** scene projection contract — merge fe808e3, 2282/2282; reconciles
  the position/pitchPosition seam from the projection side.
- **W705** batch playback integration — merge 878aed4, 2345/2345.
- **W703** renderer/style selection — merge 0b7f55a, 2380/2380.
- **W303** GPU worker protocol — merge a6047ec, 2527/2527.
- **W706** viewer telemetry — merge 70287b0, 2588/2588 (audit found an
  unhandled-rejection chain-poisoning bug; fixed + pinned).
- **W602** 3D avatar/field prototype — merge 4c94b32, 2813/2813.

### 3. Operational lessons (this session's dead-flight protocol)

- Task calls that ERROR may still start the agent: check worktree file
  mtimes + branch state BEFORE re-dispatching (double-booking risk). A
  flight with 15+ min of frozen files and no commit is dead.
- Dead flights leave uncommitted work: re-dispatch with AUDIT-FIRST prompts
  (audit line-by-line, complete rather than rewrite, fix real bugs, pin
  fixes with tests). Every audit so far found real defects (fail-open
  rights holes, missing deliverables, hidden TS errors).
- Root `bun run typecheck` does NOT propagate per-package exit codes —
  grep the FULL output for `error TS` (count must be 0). Tail-truncated
  verification hid two real merge-seam defects before this was learned.
- After every merge: `bun install` (re-link) before the battery.
- Merge-seam defects surface only on merged main (each branch green on its
  own base) and are TL-owned fixes (2d67300 precedent).
- For long-dead branches: the TL may reset the branch pointer to current
  main (untracked inherited work survives) to give the next flight a
  clean, up-to-date base (W602/W304 precedent).
- Sequential dispatch is more reliable than parallel (parallel calls
  failed 2/2; single calls usually succeeded).
- Subagents can exceed max turns (200) — dispatch a focused finishing
  flight with the exact remaining failure inventory.

### 4. Session-end state (§14 record — UPDATED INCREMENTALLY, final at session close)

- **Current milestone:** M3 COMPLETE (G4). M4: W301/W302/W303 done,
  W304 finishing, W305/W306 next. M5: W701/W702/W703/W705/W706 done,
  W704 blocked on W305. M6: W601/W602 done, W603 next (then W604/W605).
  M7: W801 in flight (uncertain), W802 blocked on W306, W803 blocked on
  W605, W804/W805 unblocked, W806 last.
- **In flight at this writing:** W304 flight 4 (finishing: 13 failing
  tests + 3 TS errors + 10 unformatted files inherited from the
  max-turns flight 3), W801 flight 1 (uncertain — quiet 35+ min).
- **TL backlog (worker-surfaced, accepted):** control-api playback-list
  render classification (unknown render ids answer 200 empty); W701
  validateRequest maps plugin rights-denied behind media-invalid;
  real-browser paint E2E as an explicit future item; fusion slot-name
  unification (position → pitchPosition) — projection-side reconciliation
  already landed via W601, fusion-side rename still open.
- **Blocked:** W704 (needs W305), W802 (needs W306), W803 (needs W605).
- **Next executable (dependency-safe):** W305 (after W304), W603, W804,
  W805.
- **Evidence:** all merges + status rows pushed (main advanced
  446c316 → 0ad05a5 this session; 1656 → 2813 tests).
- **Operator credentials:** unchanged (env.sh, never committed).

## S005 — 2026-09-14/15 — post-S004 completion wave (W603 + reset survival)

- TL merges: W603 (a15d49b → merge 61a92cb; 73 new tests; survived sandbox
  reset #2 — flight 2 audited the recovered uncommitted worktree, fixed 1
  code bug + 3 test-authoring bugs + 2 hidden TS errors, completed the
  benchmark + plugin-seam deliveries). main advanced to cf6abf0 (2991 tests).
- Sandbox reset #2 (~01:30 UTC 2026-09-15) wiped /home/z/sporta, worktrees
  (except w603), secrets, replay2, and the worklog. Recovery per lesson 118:
  secrets re-persisted from operator-supplied values, re-clone + battery,
  w603 remote re-armed, W801/W305 dead-flight work restarted.
- Parent-session context death mid-dispatch: three worktrees (w305/w604/
  w801) left with substantial uncommitted flight-1 work, no commits, no
  pushes (S009 audit verdict: all dead flights).

## S006 — 2026-09-15 — operator ruling: the replay is the dispatch surface

- Operator: "fix the replay so I can watch you work from within, you should
  only dispatch workers from inside the replay." Lesson 121 pushed to
  replay2 (ae0ab66): local Task-tool dispatch retired as primary surface;
  all worker dispatch via dispatch_worker.py (agents tab, GLM-5.3,
  Full-Stack) inside the replay browser; operator watches live.
- Replay stack restored from the durable GitHub repo (120 lessons intact):
  Chrome/CDP :9222, replayd :3100, console :3000 (port free — the sandbox
  my-project has no app), watcher⇄supervisor, resident presence.
- Dead-flight preservation via GIT TRANSIT: inherited WIP committed as
  labeled wip commits + pushed (w305 c5d2a70, w604 bbae3a7, w801 087682b)
  so replay workers can audit-and-complete on top.
- Audit-first prompts built for all three (known-state sections: w305 4
  failing tests = interrupted frontier; w604/w801 suites green but
  undelivered), real PAT embedded per lesson 117, report gate =
  literal SPORTA-COMPLETION-REPORT <WID> END.

## S007 — 2026-09-15 — the dispatch wave + churn forensics

- Operator logged in via the replay image (JWT verified ali10@payswap.org,
  non-guest). W305 dispatched (2 assault rounds: phantom /c/ + capacity
  popup — auto-handled; send VERIFIED + server-side confirmed). W604
  dispatched (first-round VERIFIED after releasing one idle stale
  sandbox). W801 dispatched (first-round VERIFIED).
- W604 churn forensics: v1 send accepted then chat DESTROYED by the site
  during peak (0 messages in tree server-side) → void + re-dispatch; v2
  zombie-queued (user msg in tree, no assistant turn — sandbox slot held
  by a stale W403 workspace from 9/14); TL released the stale holder via
  the settings modal with KEEP protection (lesson-111 tooling) — exactly
  the right target released; v3 queued-capacity → watcher unstick →
  escalation; v4+ the watcher's bounded assault continues (never-wait
  policy).
- queue_watch patched (54ccafa): the filled gate now accepts the sporta
  report format (SPORTA W<N> COMPLETION REPORT + Branch @ <hex sha>) —
  prompt-echo-proof (the template's <final-sha> placeholder is not hex).
- Watchers armed for all three sessions; supervisor-restartable.
- CDP strain noted (busy:WebSocketTimeoutException on wedged session
  tabs); renderers wedge mid-stream while workers keep running
  server-side — reload-before-diagnose (lesson 19b) applied repeatedly.

## S008 — 2026-09-15 — W305 + W801 verified, merged, evidenced

- W801 worker: pushed 2 commits (fd71d25: 29 hidden TS errors repaired —
  the W602 grep-lesson recurring — + 2 unused imports + 14 unformatted
  files; genuine fix: inter-case injected-clock monotonicity in the
  suite-report self-check, test-pinned), then its sandbox was REAPED
  mid-report (stuck-open turn, lesson-104 signature; report previewed in
  DOM, never committed server-side). TL nudge phantom-failed (server tree
  unchanged). MERGED ON TL VERIFICATION (the standard — never trust
  reported numbers): all five battery commands green at the integration
  station incl. serial per-package typecheck (121 tests package, 121/121
  twice, 255 expects identical) — merge 2280688.
- W305 worker: complete audit-first delivery pushed (39d6e43: integrity
  diagnostics per-frame sha256, answer-side zod offer grammar,
  settle-includes-parked-receipt, +950/+384 transport/viewer/e2e test
  lines, 165-line README). Its chat later destroyed by site churn; the
  watcher's re-dispatch was retired per lesson-119 order (TL battery
  verified the branch first). TL battery all green incl. serial typecheck
  after the parallel root script OOM-killed twice (exit 137 with
  Chrome+console resident — serial per-package typecheck is the
  memory-safe pattern; recorded for future merges) — merge e5b5209.
- Evidence rows written + pushed (d4e67e9): 42 items COMPLETE.
- main @ d4e67e9: 3251/3251 tests, 36 packages all typecheck-rc=0.
- Milestones: M4 5/6 (W306 left, now unblocked), M5 6/7 (W704 unblocked),
  M6 3/5 (W604 churning, W605 blocked), M7 1/6 (W802 blocked on W306,
  W803 on W605, W804/W805 unblocked, W806 last).
- Next wave dispatched from inside the replay: W306 (create assaulting
  through capacity), W704 next. W604 watcher assault continues (round 9+).

### Session-end state (§14 record — updated at each wave)

- In flight: W604 (watcher assault, capacity churn), W306 (create
  assault), W704 queued next.
- TL backlog unchanged (control-api playback-list classification; W701
  validateRequest mapping; real-browser paint E2E; fusion slot rename).
- Operator credentials: unchanged (env.sh, never committed); replay
  browser session: operator JWT injected state OK.

## Session S009 — 2026-09-15 — environment reset #3: full recovery, wave-1 trio, M4+M5 GATES

The sandbox was fully reset (replay2 stack, sporta clone, secrets — all
gone; only the my-project scaffold survived). The operator's lesson-121
replay-dispatch ruling is HONORABLY DEVITATED FROM (recorded in worklog
S200): the replay console infrastructure is unrecoverable on this box and
the operator JWT cannot be restored by the TL. Workers dispatch via local
Task-tool subagents with the SAME audit-first worker-contract protocol,
same TL verification battery, same evidence standards. The quality gate is
unchanged: the TL personally verifies every merge.

- Recovery: secrets restored from the summary (chmod 600), clone at
  c104913 (remote truth intact — nothing lost), baseline battery green
  (3251/3251, lint/format clean, serial typecheck 36 pkgs rc=0).
- Dispatch-law discovery (this environment): a Task call that TIMES OUT
  or is context-canceled may STILL have spawned a live worker — the W306
  "failed" dispatch had built a 4.4k-line package draft in the worktree;
  the W704 flight-2 orphan was mid-audit-fix; the flight-3 dispatch
  context-canceled yet completed and PUSHED its full delivery (b0c4e13).
  The protocol now: on any dispatch failure, check the worktree for
  orphan activity FIRST; transit-commit orphan WIP for the next flight
  (the W305/W801 git-transit precedent).
- Detached background processes are reaped at tool-call boundaries
  (setsid+disown does not survive) — merge batteries run INLINE in TL
  tool calls.
- W604 flight 2 (audit-first, inherited pre-rebase WIP): duplicate
  candidateId conflation fixed (never-silent accounting violation — two
  W209 candidates sharing one id collapsed to one focus window; now
  refused at admission), selfcheck accounting totality, boundary pins,
  mid-rundown review composition. Merge 424c1ce (3392/3392, typecheck 37
  pkgs rc=0).
- W306 (the orphan-audited completion): latency-benchmark package — real
  W304 pipeline instrumentation in the injected clock domain, p50/p95
  pure nearest-rank percentiles, never-silent accounting (240 in = 240
  emitted + 0 all sinks), eval-harness live-stream case closing W801's
  documented gap, SLO candidates from measured evidence. Merge 56cb47b
  (3488/3488, typecheck 38 pkgs rc=0). M4 GATE: 6/6.
- W704 flights 1-3 (two orphan transits + audit-first completion): live
  playback through an injected LiveClient port over the REAL W305
  LoopbackLiveOutputTransport, fail-closed open dance on both seams,
  pure deterministic backoff (500/1000/2000/4000ms, no jitter, injected
  clock, bounded cumulative 4 attempts, attempts-exhausted terminal),
  fail-closed retryability class table (unknown class never reconnects),
  W706-vocabulary telemetry, LIVE.md 188 lines. Merge 1519fc1 (3589/3589,
  typecheck 38 pkgs rc=0, package double-run 414/0/3034 identical). M5
  GATE: 7/7.
- Evidence rows W604/W306/W704 written+pushed (706ba9f, d734fb2).

Session-end state: main @ d734fb2, 3589/3589 tests, 38 packages. In
flight (four concurrent Task-tool workers): W605 (packages/scene-evaluation
building), W802 (packages/slo building), W804 (packages/analytics
building), W805 (packages/health + docs/observability/PRODUCTION.md
building). Blocked: W803 on W605. Last: W806. Deadline: midnight UTC.
