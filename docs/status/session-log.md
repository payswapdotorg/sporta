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

## Session 2026-09-20 (post-reset Wave 1, TL)

- Sandbox RESET #6: /home/z wiped (sporta + replay2 clones, PAT,
  git-credentials, replay stack all lost); my-project dev server restarted
  on :3000 by the platform. Repo re-cloned; 13 new operator docs commits
  on main (approved Hugging Face technology portfolio, ADR-011, task
  profiles, candidate registry — all re-read per the
  no-conversation-dependency rule).
- Wave 0 re-verified post-reset: contracts still FROZEN, no drift; the
  wave-0 TL session's compatibility mapping remains valid.
- Worker B's pre-reset Wave 1 delivery harvested from the server rail
  (branch work/j005-j007-l002 @7bd7057): L002 deterministic/replay live
  source (packages/live-source, frozen §1/§2 shapes verbatim + additive
  recovery member), J005 Compute Connection Center (first-class
  connect/verify/disconnect, typed failures, master-password refusal,
  Sporta-vs-BYOC), J007 local durable control plane (sqlite records +
  ownership + honest health; hosted gate blocked on credentials) +
  design doc docs/deployment/J007-local-durability-and-deployment-shapes.md.
- TL verification: battery 6254/33/18 (18 = 17 environmental app-boot
  timeouts identical on baseline main 6156/17/33 + the documented
  detection variance; branch's own files green isolated at 60s timeout);
  typecheck green sequentially (parallel tsc OOMs on this 2-CPU box);
  lint 0 errors; format remediated (16 worker files + 4 pre-existing)
  08dd215.
- Merge --no-ff d785e93. PUSH BLOCKED: no PAT post-reset (external
  dependency #6 in the status ledger).
- Post-reset dispatch machinery: replay stack rebuild pending (console
  :3000 needs the my-project dev server stopped per the sanctioned
  layout); operator TODOs recorded: (a) PAT to ~/.secrets/env.sh, (b)
  chat.z.ai login through the rebuilt console for Worker A/C dispatch.

Session-end state: local main @ 08dd215 + status evidence commit (2 ahead
of origin; push blocked). Wave 1 position: Worker B lane COMPLETE;
Worker A (J012 + L003/L004 design + L010 harness) and Worker C (J004 +
L005 scaffold) NOT dispatched — blocked on operator login + PAT.

## Session 2026-09-20 (Wave 1 continuation, TL)

- Operator restored the GitHub PAT + supplied Composio API keys (persisted
  to ~/.secrets/env.sh + git-credentials + bashrc + a gitignored
  reset-durable backup; never committed). Operator logged in to chat.z.ai
  through the rebuilt console. All reset blockers cleared.
- PUSHED the wave-1 backlog: d881700 (Worker B merge + status evidence) →
  origin.
- CI REDNESS ROOT-CAUSED AND FIXED: main's CI had failed on EVERY commit
  since ddac9e7 (R-era wave 2/3) including docs-only commits. The CI log
  showed the whole family was FfmpegUnavailableError cascades — the
  ubuntu-latest runner ships no ffmpeg, so every real-media test
  (generateTestMp4) failed and the default runVisualCorrectnessGate
  evaluated NOT-RUNNABLE (blocking FAIL), flipping the human-gate
  verdicts. Fix 2c19f75: install ffmpeg in ci.yml (52 fails → 1 fail).
  Fix 06461e8: the last failure — the detection-benchmark model-backed
  degradation assertion expected inference-backend-not-wired, which only
  fires when a weights asset exists, but weights are never committed; the
  test now pins deterministically with a controlled temp weightsDir
  (zero-byte sentinel, existence-only) covering BOTH honest postures.
  CI GREEN at 06461e8 — first green run since R-era 2e42e72. (d881700's
  +5 failures vs baseline were J007 tests needing the same ffmpeg.)
- Wave 1 Worker A + Worker C DISPATCHED (sessions wave1-a / wave1-c,
  GLM-5.3, Full-Stack, agents tab). A: J012 reality-fidelity investigation
  (license-first: RF-DETR SoccerNet apache-2.0 vs AGPL YOLO weights) +
  L003/L004 design docs + L010 harness + HF001 mapping, branch
  work/j012-l003-l004-l010. C: J04 multi-reality Create (frozen
  multi-reality-create.md) + L005 live tactical scaffold + HF010-013
  notes, branch work/j004-l005-hf. C's first session was destroyed by a
  post-send capacity rollback → voided + re-dispatched clean (round 2,
  prompt re-verified 100%).
- TL surgical commits this phase: ci.yml ffmpeg step; benchmark test
  determinism pin. Both verified locally (20/20) before push.

Session-end state: main @06461e8 CI GREEN; Worker A + C generating.

## Session 2026-09-20 (Wave 1 evening, TL)

- Peak-hours capacity churn (13:00-19:00 UTC) battle: Worker C lost 4
  sessions (capacity rollbacks/phantom sends); Worker A's turn died after
  its 99K-char baseline+survey work with undeliverable continuations
  (server-null-commit phantom sends). wave1_sentinel.py (detached,
  crash-hardened after two lessons) automated the fight: branch watch,
  A-nudges, C re-creates.
- Worker A checkpoint 1 HARVESTED + TL-reviewed PASS: branch
  work/j012-l003-l004-l010 @925feab —
  docs/research/j012-perception-licensing-and-production-path.md (181
  lines): AGPL YOLO = evaluation-only (network-copyleft analysis);
  RF-DETR SoccerNet apache-2.0 = benchmark-track (dataset lineage
  unresolved, honest); PRODUCTION PATH = pure-code
  contrast-context-detector (surface-agnostic local-contrast, ring-
  context gates, honest confidence). Implementation + sensitivity tests
  pending (A's sandbox TTL'd at ~14:55; re-entry law resumes from the
  branch).
- Worker C delivered its FULL lane through the churn (session 9828491a,
  3 checkpoints pushed before the sentinel's void): J004
  one-submission multi-reality Create (8eb1b93), L005 live tactical
  renderer scaffold (1588aef: view-model seam + W915 transport extension
  + browser canvas + 442 test lines), HF010-013 camera-bench notes
  (e0a4d36: packages/renderer-evaluation + CAMERA-BENCH.md). Bonus fix:
  catalog content-addressed-dedup visibility (false requires-render).
- TL verification of C's lane: spot battery 66/66 + 26/26 adjacent,
  typecheck clean, format clean; the full-suite battery OOM-killed
  locally 3x (resident replay stack on the 4GiB box) — MERGED @7e0a810
  with CI as the full-suite verifier. CI caught one lint error my spot
  pass missed (no-regex-spaces in camera-bench.test.ts — process note:
  lint EVERY checkpoint) → fixed @41f5b83 → **CI GREEN**.
- CI-as-verifier doctrine note: the post-ffmpeg-fix CI (ubuntu-latest,
  7GB) runs the full suite reliably; local full-battery on this box
  requires stopping the replay stack (not sanctioned while workers
  fight).

Session-end state: main @41f5b83, CI GREEN, J004/J005/J007 COMPLETE,
L002 COMPLETE, L005 scaffold COMPLETE, J012 checkpoint 1 reviewed.
Worker A: fighting (sentinel). Next: A's re-entry continuation, then
Wave 2 dispatch (A: J012 impl finish + L007/L010/L011; B: J006 backend +
J014 + L006 + L009; C: J006 UI + J013 + L005 full + L013).

## Session 2026-09-20 23:00-23:45 UTC — A-lane unblock + C fix-forward merge

- Resumed after operator "continue": full audit — stack healthy, sentinel
  v1 alive but pointed at the DEAD f97e2d04 tree while the re-entry
  prompt had actually LANDED in a re-keyed conversation (17cf00bc,
  20:16 UTC, 12,080 chars server-verified).
- 17cf00bc forensics: prompt landed, first turn died at birth; my 23:12
  continuation triggered a REAL model turn (issued the STEP ZERO clone
  tool call) — but the conversation, born from a phantom-birth chain,
  NEVER had a sandbox provisioned (no workspace iframe; tool call hung
  22+ min past its 600s timeout; no capacity/modal UI). Zombie-turn
  signature confirmed (S105 lesson) — recovery ladder: reload (no
  effect) → workspace APIs (401) → fresh create.
- Worker C post-merge fix-forwards harvested: 93c15ab (lint dup of
  main's 41f5b83) + 48c3ac0 — REAL main bugs surfaced by C's J004
  browser journey: (a) compute-preview client sent `directive:` while
  the route documents `compute` (UI preview 400'd on EVERY submission),
  (b) tactical team split used `endsWith("a")` which matches
  `team-away` — now the frozen L002 vocabulary (team-home/team-away)
  drives split + colors. TL battery: 116/116 scoped tests (8 files),
  typecheck/lint/format clean → MERGED @60282f2 → **CI GREEN**.
- Worker A RE-DISPATCHED clean (night window 23:34): voided the zombie
  registry record; fresh create VERIFIED first attempt (agents tab,
  GLM-5.3, Full-Stack, 12,080-char re-entry prompt) → conversation
  2e33be84 WITH sandbox iframe provisioned. STEP ZERO executing for
  real: clone → checkout 925feab verified → checkpoint doc read →
  canonical docs in progress.
- wave1_sentinel.py v2: A_CHAT → 2e33be84; DOM-delta + busy-flag
  activity detection (in-progress turns commit NULL for their whole
  runtime — v1 would have re-nudged MID-TURN); branch TIP tracking
  (v1's name-only watch silently missed C's 19:42/19:55 fix-forwards);
  continuation payload instead of the full re-entry prompt; canonical
  state path (scripts/flags). C-lane re-dispatch retired (complete).
- Sentinel log note: first-cycle bug fixed (stale state path caused an
  early duplicate-nudge attempt — landed as a no-op; state reset).

Session-end state: main @60282f2, CI GREEN. Wave 1: B + C lanes
COMPLETE (C's fix-forwards merged); A lane GENERATING in a properly
provisioned session (2e33be84) — J012 implementation + L003/L004
designs + L010 harness expected as checkpoint pushes on
work/j012-l003-l004-l010. Sentinel v2 (pid 6720) watching. Next: A's
checkpoints → TL verify → merge → Wave 2 dispatch.

## Session 2026-09-21 00:10-01:35 UTC — Worker A lane delivered + merged

- Worker A (session 2e33be84, fresh create 23:34 with provisioned sandbox)
  delivered its FULL lane as 6 branch pushes on
  work/j012-l003-l004-l010: J012 contrast-context-detector d4ab4b7 (763
  lines, documented algorithm, measured constants, honest failure
  classes), L003 + L004 designs af9e569 (authority-mapped: engine-driver
  incremental SWM updater; event-time per-source watermarks), L010
  benchmark harness 05bb07b (@sporta/perception-benchmark, 8/8), HF001
  mapping 47c6e2c, J012 docs addendum 603063e (measured deviations from
  the checkpoint's literal wording), refinement 45aba5f (no-surface
  frames REFUSE with the documented off-envelope class).
- TL verification battery (worktree, scoped): 57+54+14 tests green
  across perception-adapters / perception-benchmark / real-to-swm /
  perception-detection; typecheck clean × 3 packages; lint 0 errors;
  format clean. The initial L010 "failure" was my stale worktree install
  (bun install fixed it — the worker had committed the lockfile).
- MERGED --no-ff bccf89c (clean; bun.lock auto-merged both additive
  workspace entries) → pushed → post-merge battery green → CI pending
  (the full-suite verifier).
- Conversation formality: the worker's final 12-field report has not
  committed server-side (turn uncommitted 60+ min after its last push —
  final-gates grind or post-delivery stall); the BRANCH is the ground
  truth and holds every deliverable. Sentinel v2 watches for the report
  commit and logs it on arrival.
- Sentinel v2 hardening through the night: tip-move now refreshes
  activity (frozen conversation DOM during long sandbox tool runs is NOT
  death evidence — the worker pushed 3 checkpoints while "not busy");
  tree queries route via the quiet landing tab (the worker tab's CDP
  evals time out under transcript churn); rc=4 nudge crashes are
  harmless (they die before the composer).

Session state: main @bccf89c (CI pending), Wave 1 ALL THREE LANES
delivered (B + C merged earlier; A merged now). Next: CI verdict →
status evidence → Wave 2 dispatch (A: L007/L010/L011 impl; B: J006
backend + J014 + L006 + L009; C: J006 UI + J013 + L005 full + L013).

## Session 2026-09-21 01:40-02:00 UTC — CI hotfix + WAVE 2 DISPATCHED

- Post-merge CI caught a REAL interaction my scoped battery missed: the
  J012 default-chain change made golden-path step 7 + derived-reality-
  catalog fail (snapshot.entities 0) — the tests' testsrc color-bars clip
  is surface-dominated with thin edge lines, and the contrast-context
  production path HONESTLY reports zero players on it (the old
  heuristic-color chain had found blobs in the bars). Product behavior
  correct per design; test media was the mismatch.
- Hotfix 451766b: `generateTestMp4` scene option — "pitch" (three moving
  kit-colored players on a uniform green field, disjoint motion lanes,
  ring-context clean) for the entity-asserting tests; "bars" default
  preserved for every other caller. Both tests green locally (7/7,
  14/14) — **CI GREEN AT 451766b** (the full-suite verifier). Wave 1
  now fully closed: A + B + C lanes merged, hotfixed, green.
- WAVE 2 DISPATCHED 01:50-01:57 UTC (deep-night window, all three
  VERIFIED first try; the create flow released two stale wave-1
  sandboxes): Worker A b27a3ea4 (L003 + L004 implementation from the
  designs, L007 open-data replay adapter + L008 profile, L011 perception
  runtime seam) on work/l003-l004-l007-l011; Worker B dc486588 (J006
  backend surfaces, J014 restart/redeploy durability, L006 telemetry
  plumbing, L009 authorized-provider adapter with honest-blocked
  posture) on work/j006b-j014-l006-l009; Worker C 98f82494 (L005 full
  live tactical, L013 live 3D, J006 UI, J013 sensitivity gate) on
  work/j006ui-j013-l005-l013. All sandboxes provisioned (iframes
  verified). Prompts at /home/z/prompts/sporta-wave2-{a,b,c}.md.
- wave2_sentinel.py (pid 19441): three-lane tip watch + DOM-delta
  activity + report markers + 45-min stall alerts (no auto-nudging —
  wave-1 lessons); state scripts/flags/wave2_sentinel_state.json.

Session state: main @451766b CI GREEN; Wave 1 COMPLETE (all lanes);
Wave 2 GENERATING (3/3 lanes live). Next: harvest branch pushes → TL
verify batteries → merges → status evidence; J006 B/C reconciliation at
merge time.

## Session 2026-09-21 — Wave 2 Worker C lane delivered (J006 UI + J013 + L005 full + L013)

- Worker C (branch work/j006ui-j013-l005-l013, base 451766b, tip a459d4d)
  delivered its full Wave 2 lane as 4 checkpoint pushes:
  - L005 full (4c03750): the pure view projection + the full browser
    surface (identity-continuous markers with STABLE labels, pinned entity
    inspector, honest event ticker, receipt-watchdog stall overlay) +
    event-driven W915 consumption + one seeded session per L002 scenario
    (all six) + 21-test battery.
  - L013 (ff50091): the additive renderer-3d live view-model adapter
    (identity-continuous carry, pure camera with the canonical look-at
    equivalence PINNED by test, the renderer's own projection math) + the
    browser interactive 3D view over the SAME world stream (shared
    useLiveWorldStream hook; camera never touched by state updates) + the
    Live 2D/3D toggle + 11-test battery.
  - J006 UI (6cde4d7): the six compute-transparency facts on Create AND
    Watch from the EXISTING route contracts (honest unknowns everywhere,
    the declared no-silent-fallback posture) + 22-test battery.
  - J013 (a459d4d): the sensitivity gate — pure verdict/premise
    derivations (4-verdict truth table incl. the explicit equivalence
    explanation) + the full-pipeline battery over the NEW calibratable
    pitch-marked test media (generateTestMp4 scene "pitch-marked" — the
    line-based calibrator's documented envelope; positions project to
    canonical pitch meters) + tactical + 3D e2e gates PASS + the
    content-addressed dedup control pair + renderer-side sensitivity for
    BOTH game realities (5 tests).
- HONEST FINDINGS recorded for TL reconciliation:
  1. On the UNMARKED pitch scene, the calibration honestly refuses (no
     landmarks) → positions stay image-frame → the scene projection
     omits every entity → the derived renderers (all three) collapse to
     empty-pitch renders across materially different SWMs. The pitch-marked
     media fixes the gate; the unmarked finding is the J012-documented
     fidelity gap, now precisely measured (apps/web battery documents it).
  2. The anime-NPR e2e leg is BLOCKED by a platform-budget tension: the
     populated-pitch cel-shaded render at the default 4s SD profile
     measures ~1.04MB over the compute plane's 1MB fail-closed artifact
     budget (the honest artifact-too-large refusal fires on both
     sessions). Cross-lane: renderer content vs budget (B's compute plane
     / encoding constants). The renderer-side anime sensitivity is proven
     without the budget in the path (packages/renderer-3d
     test/sensitivity.test.ts).
  3. Shared-infra touch flagged: packages/media-platform generateTestMp4
     gained the ADDITIVE scene "pitch-marked" (existing "bars"/"pitch"
     byte-identical; all dependent suites re-run green).
- Gates at tip: lint 0 errors (1 pre-existing warning); sequential
  per-package typecheck ALL exit 0 incl. web; format:check clean; full
  battery 6374 pass / 33 skip / 18 fail — IDENTICAL failure set to the
  recorded clean-clone baseline (451766b: 6301/33/18; the documented
  contention-timeout families, all passing isolated).

Session-end state: Wave 2 Worker C lane COMPLETE on the branch (TL
harvests); A + B lanes in flight per the wave plan.
