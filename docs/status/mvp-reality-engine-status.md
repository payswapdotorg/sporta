# Sporta MVP Reality Engine Status

**Status as of 2026-09-17:** APPROVED / NOT YET MVP-COMPLETE

## Important truth

W001-W921 remain valuable and are recorded complete in their respective ledgers. They establish the contracts, SWM, control plane, product shell, and beta infrastructure.

They do **not** by themselves prove the customer-visible MVP. The old beta gate accepted fixture/in-process/SVG-backed evidence that is insufficient for the newly approved product-result definition.

The MVP Reality Engine program therefore starts with all R001-R605 in `NOT_STARTED` until the Tech Lead verifies executable evidence.

## MVP definition

The MVP is complete only when a fresh browser can:

```text
real authorized football MP4
  -> real perception
  -> canonical SWM
  -> Original MP4
  -> Tactical MP4
  -> 3D Game MP4
  -> Anime/NPR MP4
  -> persistent artifacts
  -> HTML5 playback
  -> Reality Switcher for the same match/session
```

This must pass on two materially different real clips and receive human visual acceptance.

## Execution control

### Wave 0 — Tech Lead only

Freeze/verify shared contracts before any parallel implementation:

- TechnologyCandidate / TechnologyProfile;
- BenchmarkRun / EvaluationReport / PromotionRecord;
- PerceptionAdapter;
- ComputeRequest / Quote / Job / Provider;
- SourceAsset / MediaManifest / RenderArtifactManifest;
- GameEngineAdapter / RendererAdapter;
- upload/session/job state transitions.

### Wave 1 — 3 workers concurrent

Worker A: `R001-R005`

Worker B: `R101-R104` + `R401`

Worker C: `R301` + `R302`

### Wave 2 — 3 workers concurrent

Worker A: `R201-R206`

Worker B: `R402-R405`

Worker C: `R303-R304`

### Wave 3 — dependency integration

Worker A: `R207-R208`

Worker B: `R406-R409`

Worker C: `R305-R307`

### Wave 4 — product integration

Worker B: backend portions of `R501-R503` and real compute/media hardening.

Worker C: `R501-R507` browser/product path.

Worker A: evidence/benchmark remediation only; no new shared-contract changes without TL approval.

### Wave 5 — final proof

Tech Lead: `R601-R605`.

All workers are fix-only and may only receive narrowly isolated tasks that cannot mutate shared contracts or reset earlier gates without TL approval.

## Wave 1 execution ledger (post reset #4)

Program history: the original wave-1 (2026-09-17 morning) was lost with sandbox
reset #4 (all local merges unpushed). Recovered via lesson-118 chat-tree rails:
Wave-0 re-frozen byte-verbatim from the worker-prompt embeds (merged locally),
wave-1 re-dispatched 2026-09-17 22:30-22:33 UTC through the replay dispatcher.

### R101-R104 + R401 — Worker B — COMPLETE (merged locally @7e8914c)

- Delivered via agents-tab session chat d9e46cfd (GLM-5.3, Full-Stack);
  one mid-report stall recovered by continuation send.
- Delivery: branch work/r101-media-loop @a652639 (5 commits, sandbox-local,
  push refused PAT-less); 36 files harvested via the workspace files API after
  a visibility nudge (clone lived at /home/z/sporta, outside the API root).
- Contents: packages/media-platform (real upload w/ fail-closed rights +
  magic-byte + ffprobe validation on received bytes; real ffmpeg
  normalization w/ measured manifests; restart-durable job ledger over the
  W914 vocabulary; original-reality artifact with the full
  upload->asset->normalized->artifact->playback hash chain + Range
  semantics), apps/web media routes, R401 ComputeBrokerPort +
  InMemoryComputeBroker (additive; closed 5-member refusal vocabulary).
- TL battery on the integrated tree: 5238 pass / 0 fail / 26 skip (93923
  expects); lint clean; format clean; 0 TS errors. Frozen media-artifact.ts
  zero-drift confirmed (worker-embed dual-source).
- Push backlog: 2e42e73..7e8914c awaiting operator PAT restoration.

### R001-R005 — Worker A — COMPLETE (merged locally)

- Delivered via agents-tab session chat b5a9c75a (GLM-5.3, Full-Stack);
  one mid-content stall recovered by continuation send.
- Delivery: branch work/r001-technology-registry (sandbox-local, +27816/-32,
  38 files); harvested via the workspace files API after the visibility nudge.
- Contents: NEW packages/technology-registry — R001 registry/resolution/store
  (InMemory + SQLite), R002 fixture-set with the synthetic-diagnostic MP4
  (sha256-pinned, VLM-verified), R003 deterministic evaluation runner,
  R004 two-gate license registry, R005 evidence-gated promotion pipeline
  with append-only audit trail. Frozen contracts applied verbatim.
- TL battery on the integrated tree (post-B-merge base): 5387 pass / 0 fail /
  26 skip (94238 expects); lint clean; format clean; 0 TS errors.

### R301 + R302 — Worker C — COMPLETE (merged locally)

- Delivered via agents-tab session chat 747444cf (GLM-5.3, Full-Stack);
  two mid-task stalls recovered by continuation sends.
- Delivery: branch work/r301-renderer-seams @d55f7c5 (3 commits, 31 files,
  +6089 lines); harvested via the workspace files API after the visibility
  nudge.
- Contents: NEW packages/renderer-tactical (R301 — SWM-driven tactical MP4
  renderer with real deterministic ffmpeg output, W501 conformance 13/13)
  and NEW packages/game-engine-adapter (R302 — SoftwareSceneEngine reference
  adapter behind the frozen vendor-neutral seam, stylized-3d + cel-shaded
  styles, G1-G13 conformance).
- TL battery on the integrated tree: 5469 pass / 0 fail / 26 skip (94508
  expects); lint clean; format clean; 0 TS errors.

## Wave 1 COMPLETE (A + B + C)

All three lanes delivered and merged locally: R001-R005, R101-R104, R401,
R301, R302. Integration battery on merged main: 5469 pass / 0 fail.
The wave-1 integration gate review (contracts/adapter seams/provider
leakage/no-drift audit) precedes the wave-2 dispatch.

## Wave 2 execution ledger

### Worker A — R201-R206 COMPLETE (merged @0f7760a, 2026-09-18)

- Worker chat 2e1f95e6 (dispatched 03:05 UTC); report rendered ~05:00 with
  the full completion marker; the server tree rolled the content back
  (peak-hour commit failure) — the report was recovered from the DOM via
  the CodeMirror extractor (30,639 chars).
- Branch `work/r201-perception-adapters` in the sandbox (4 commits:
  ddc267d, 0d0155d, 0cd6b75, 4f8d3f2); push refused (PAT-less, by design)
  — harvested via the visibility-copy rail: 62/62 changed files by path.
- NEW `packages/perception-adapters`: 6 family interfaces
  (PlayerDetectionAdapter, BallDetectionAdapter, TrackingAdapter,
  BallStateAdapter, CalibrationAdapter, TeamAssignmentAdapter), 13
  candidates (2 per family + 2 extra ball-detection), deterministic
  per-family benchmarks, registry bindings, honest license records
  (YOLOv8n weights AGPL-3.0 evaluation-only, fail-closed commercial use).
- R206 contract change (the wave's one additive change, exactly per
  packet): `TeamAssignmentPayload` appended to the `ObservationPayload`
  union; observation.json golden regenerated (+1 oneOf member); 1 valid +
  1 invalid fixture added.
- Pinned weights asset reproduced from the sanctioned URL:
  yolov8n.pt, sha256 f59b3d833e2ff32e194b5bb8e08d211dc7c5bdf144b90d2c8412c
  47ccfc83b36 (gitignored, never committed).
- TL verification: 5550 pass / 0 fail / 26 skip (97,844 expects) on merged
  main; lint 0 errors (1 benign no-console warning); format clean; all
  package typechecks 0 errors. No-drift audit: vendor names only in
  license records / display names / asset filenames (TechnologyCandidate
  data), contract seams neutral; Date.now only in the documented opt-in
  REAL-clock seam (tests never use it).
- Incident + correction: a prior session misread the server-tree rollback
  as "never fired" and voided the lane + created a phantom re-dispatch;
  registry corrected (latest-wins truth record) before harvest.

### Worker B — R402-R405 COMPLETE (merged @dd84e4b, 2026-09-18)

- Re-run chat 84435f50 (landed 06:34 UTC via the supervisor fighter after
  two delayed-rollback phantoms); report rendered ~07:42 with the full
  completion marker; extracted from the DOM (25,399 chars).
- Branch `work/r402-r405-provider-adapters` in the sandbox (8 commits,
  2e42e73..4e5e66f); push refused (PAT-less, by design) — harvested via
  the visibility-copy rail: 77/77 changed files by path.
- NEW `packages/compute-provider-adapters`: four provider adapters
  (Modal, Lightning AI, RunPod, Local via Bun.spawn + nvidia-smi probe)
  behind the frozen R401 ComputeBrokerPort seam; typed refusal mapping to
  W914 failure classes; credentialStatus vocabulary extended with
  `invalid` + `not-applicable` (disclosed deviation, argued: a real 401
  must not report present-unverified); two-tier tests (recorded fixtures
  + env-gated conditional integration tiers — api.modal.co egress blocked
  in the sandbox, honestly recorded).
- TL verification: 5656 pass / 0 fail / 30 skip (99,133 expects) on
  merged main; lint 0 errors; format clean; 44 package typechecks 0
  errors. R401 contract surface byte-identical to wave-1 (the
  verbatim-embed prompt pattern — zero seam fixes needed). No-drift
  scans clean: no Math.random/Date.now in src, no master-password
  patterns (API-key-as-Bearer only), provider names only as adapter
  data.

### Worker C — R303+R304 COMPLETE (merged @d56bcae, 2026-09-18)

- Re-run chat ef9cd24c (landed 06:28 UTC); report rendered but the tab's
  renderer FROZE mid-view (lesson 36 pattern — static DOM, no Stop
  button); a fresh tab at the same URL resynced to server truth and
  revealed the completed report (lesson 37 recovery without loss).
- Frozen-turn revival + nudge battles: the capacity modal blocked the
  visibility nudge (lesson 34 loop: modal Cancel + composer re-Enter,
  landed after retries); the server committed the nudge and the worker
  executed the copy (tree 78 → 1,333 files; 1,255 sporta paths).
- Branch `work/r303-r304-renderers` (2 commits) in the sandbox; push
  refused (PAT-less, by design) — harvested via the visibility-copy
  rail: 30/30 changed files by path.
- packages/renderer-3d extended IN PLACE (disclosed deviation, argued:
  the W602/W603 SVG prototype already owned the @sporta/renderer-3d
  name on public main): NEW src/game/ — Software3DEngine
  (painter's-algorithm software 3D engine behind the frozen
  GameEngineAdapter seam), Game3DRenderer (stylized-3d) +
  AnimeNprRenderer (cel-shaded/NPR) plugins, typed ffmpeg codec,
  content-addressed artifact staging + test/game/ (conformance,
  same-event integrity, ADR-009 difference, per-build determinism).
- Real measured MP4 outputs (SD + HD; honest per-build byte-determinism
  caveat — x264 SEI embedded).
- TL verification: 5746 pass / 0 fail / 30 skip (99,468 expects) on
  merged main; lint 0 errors; format clean; 44 typechecks 0 errors.
  Seam fix: contracts index.ts restored to the local superset
  (technology exports + R206 TeamAssignmentPayload). No-drift clean:
  Date.now metrics-only (rendererHealth), Godot only in doc comments.

## Wave 2 COMPLETE (A + B + C)

All three lanes delivered and merged locally: R201-R206, R402-R405,
R303, R304. Integration battery on merged main: 5746 pass / 0 fail.
Wave-2 integration gate review PASSED: SWM contract core untouched
(world-model/event zero diff; observation.ts = the packet-sanctioned
R206 additive only); provider names only in sanctioned adapter data
(compute-provider-adapters' own clients, doc comments); frozen
contracts seam-neutral. WAVE 3 REMAINS BLOCKED ON PAT RESTORATION
(R207/R208 need the full perception-adapters + media-platform source
on public main; 21-commit push backlog ready).

### Wave-2 lanes B and C (incident record)

- Worker C (R303+R304, chat c36c3c45): report RENDERED and extracted
  (23,107 chars, completion marker present) but its workspace was released
  before the visibility-copy nudge could land (capacity gate blocked the
  send; 13 failed attempts in the prior session) — the file work was lost
  (W205-class platform TTL loss). RESOLVED by the re-run (see the Worker C
  COMPLETE entry above).
- Worker B (R402-R405, chat e7eea490): first generation died at
  thought-start (172 chars streamed, chat never updated again); lane
  voided by the prior session; re-dispatch resolved the lane (see the
  Worker B COMPLETE entry above).


## Wave 3 (R207-R208 A / R406-R409 B / R305-R307 C) — COMPLETE (A + B + C all merged)

### Worker B — R406+R407+R408+R409 COMPLETE (merged @1967fd3, 2026-09-19)

- Chat 7d2f009c. The original flight stalled mid-work (turn open, 14h
  idle) and its sandbox was TTL-wiped to the default scaffold — the
  unpushed WIP was unrecoverable (W205/W801-class platform loss).
  Recovery per §3.10: two continuation nudges (both VERIFIED into the
  transcript) — the worker re-cloned, re-created the full delivery
  from its chat context, and landed the completion marker.
- PUSH initially blocked: the platform transcript render redacts
  tokens (`x-access-token:[REDACTED:github_token]` in the DOM while
  the API-side message carries the real PAT) — the worker read the
  rendered form and fell back to a committed git bundle
  (`/home/z/sporta-r406-r409-connection-center.bundle`, the documented
  GIT TRANSIT rail). The TL re-issued the push command with the real
  PAT inline (lesson-117 substitution; first re-issue carried a
  template artifact `${PAT}` — corrected on the second send) and the
  worker pushed cleanly, reporting token hygiene (used only for the
  two git commands, never echoed/committed; rotation advised).
- DELIVERED VIA THE PUSH RAIL: branch
  `work/r406-r409-connection-center` on GitHub at
  18cd5507d4366f183bcc870654a9491f5914ed64, ls-remote verified.
  Six commits on baseline ddac9e7: R406 (connection center, master-
  password refusal), R407 (auditable selection), R408 (BYOC usage
  ledger), R409 (managed compute seam), the full product-tier test
  commit, plus one provider-ledger fix (envelope attached BEFORE the
  terminal event fans out — the W914 awaitCompletion contract shape,
  doc-commented, test-pinned).
- NEW `packages/connection-center` (25 files, +8,257/−61 incl. one
  cross-package fix + bun.lock): connections (typed master-password
  refusal, credential fingerprints never plaintext), selection
  (SelectionDirector with auditable explanations), ledger (W919
  guardrail composition), managed seam (provider-independent
  allowance/admission), W004-pattern stores, live/recorded-fixture/
  env-gated/boundary/vocabulary test tiers.
- TL verification on merged main (1967fd3): bun test 6,073 pass /
  14 fail / 33 skip — the identical 14 environmental failures
  already verified byte-identically on pre-lane-C baseline 0d00bcc
  (apps/web embedded-server/live-route timeouts under resident
  replay-stack load + the perception benchmark flake; classes
  untouched by this lane; lane B's own +145 tests all green —
  5,928→6,073 with zero new failures). Serial per-package typecheck:
  0 `error TS`. lint: 0 errors (1 pre-existing warning). prettier
  --check: clean. Determinism scan (new src + the adapter fix):
  clean. Frozen contracts: zero-diff. Vendor-leakage scan: only
  sanctioned shapes (README data vocabulary, credential-class
  comments, anti-leakage test deny-lists, env-gated integration
  imports; exported vocabularies clean). Cross-package adapter fix
  gate-reviewed: contract-coherent, additive helper, ordering-only.

### Worker C — R305+R306+R307 COMPLETE (merged @9219076, 2026-09-18)

- Chat b922d058 ("Sporta MVP Engine Tasks: R305-R307", re-armed after
  the 3c193113 delayed-rollback phantom); server tree holds the prompt
  (11,176 chars) + the final report rendered in the live DOM —
  completion marker `SPORTA-COMPLETION-REPORT R305-R307 END` present
  (marker count 2 = prompt echo + answer) alongside the report
  artifact panel; re-attach post-reset verified the report fully.
- DELIVERED VIA THE PUSH RAIL: branch
  `work/r305-r307-presentation-encoding` on GitHub at
  0c3e67312fcc864fab8d79d4b79fac43e5748898, tip sha named in the
  report and verified via ls-remote — byte-exact. Four commits on
  baseline ddac9e7: R305 (presentation director wrapping W604),
  R306 (real video encoding plane behind FrameEncoderPort), R307
  (visual correctness gate, policy w803@1 → w803@2), and a final
  chore (prettier + unused-import lint fixes).
- NEW `packages/presentation-director` (19 files: deterministic
  event/camera presentation policy, golden fixture, validation,
  selfcheck) + NEW `packages/encoding` (20 files: ffmpeg-backed real
  encoding, manifests, content-addressed store, verification,
  bridges) + ADDITIVE `packages/quality-gates` extension (new
  `src/visual-correctness.ts` +757 lines, gate-id union extended with
  `"visual-correctness"`, GATES.md row-for-row test-pinned update,
  report/policy/gates additive deltas +905/-23) + bun.lock.
  53 files, +8,544/−40. CONTRACT CHANGES: none (frozen contracts
  zero-diff verified).
- TL verification on merged main (9219076): bun test 5928 pass /
  14 fail / 30 skip — all 14 failures reproduce byte-identically on
  pre-merge baseline 0d00bcc in the same session (13 × 5,000ms
  embedded-server/live-route timeouts under the resident replay-stack
  load in apps/web tests + 1 perf-flake in
  perception-adapters benchmark.test.ts, a package this lane does not
  touch): environmental, not regressions. Lane-C's own +147 tests all
  pass. Serial per-package typecheck: 0 `error TS`. lint: 0 errors
  (1 pre-existing no-console warning in media-platform). prettier
  --check: clean. Determinism scan (new src): no Date.now /
  Math.random / new Date(). Vendor-leakage scan: none. Diff scoped
  to the two new packages + the sanctioned quality-gates extension +
  bun.lock.

### Worker A — R207+R208 COMPLETE (merged @fc7b39b, 2026-09-18)

- Chat b4b310ce (landed 17:32 UTC after 5+ hours of phantom-eating
  through the morning+evening capacity peaks — 10+ create attempts
  rolled back; the void+re-arm loop + phantom sentinel closed the
  cycle autonomously); report rendered ~18:43 with the completion
  marker; extracted from the DOM (18,258 chars).
- DELIVERED VIA THE PUSH RAIL (the boot-prompt-sanctioned one-off
  remote): branch `work/r207-r208-real-to-swm` on GitHub at
  ebb8cda7bebc6670eb91afbf4bcfc518720936ea, tip sha named in the
  report and verified via ls-remote — the first worker delivery to
  arrive as a durable server-side branch (harvest fallback not
  needed).
- NEW `packages/real-to-swm` (+4,666 lines, 27 files incl. bun.lock):
  decode → perception adapters → observation bridge → canonical SWM
  → content-addressed artifacts, plus the R208 reconstruction gate.
  R208 ran on the two REAL gate clips only (fx-001, fx-004 —
  byte-identical to the TL media-drop pins, sha256-verified in the
  gate review); pipeline end-to-end on fx-001: 250 frames,
  252 entities, 35 event candidates, ~3s. Licenses carried verbatim
  in every artifact (fx-001 CC0-1.0, …). CONTRACT CHANGES: none.
- Worker-reported battery: 5782 pass / 0 fail / 30 env-gated skips
  (baseline 5746/0/30 + 36 package tests); lint clean; prettier
  clean; typecheck clean.
- TL verification on merged main (fc7b39b): 5781 pass / 1 fail /
  30 skip — the single failure is the R101 121s-encode test timing
  out at its 5,000ms budget; the identical test fails identically on
  baseline main ddac9e7 on this host (encode throughput under load —
  a manual 121s testsrc+libx264 encode takes >70s here) and passes
  in the worker's own run: environmental, not a regression. All
  other 5,781 green; determinism scan clean (no Date.now/Math.random
  in src); vendor-leakage scan clean; frozen contracts zero-diff;
  diff scoped to the new package + bun.lock only.
- Honest-risk disclosure (per the report): perception quality on the
  two REAL clips is honestly WEAK (heuristic detector's documented
  off-envelope behavior); ball-impulse candidates are conservative
  image-space statements; the default tracking chain is the
  greedy-iou baseline (hungarian candidate supported);
  football state initialized with documented no-evidence defaults.
  BLOCKERS: none. ARCHITECTURE-DEVIATION PROPOSAL: (empty).

### Reset #5 incident (2026-09-18 ~18:47 UTC)

- The sandbox environment executed a full reset mid-session: /home/z
  wiped except my-project (which reverted to a pre-R-program
  checkpoint), all machinery processes killed, the default my-project
  dev server restarted on :3000. No program state was lost that lived
  in durable stores: sporta main + worker branches on GitHub, the
  three wave-3 chats server-side on the platform, and the TL session
  context. Local-only artifacts (replay2 deployment, browser profile
  + login session, wave-3/4 prompt files, extracted worker reports,
  fixtures-real working copies) were destroyed and were/are being
  rebuilt. Worker A's merge was executed AFTER the reset from the
  re-cloned repo (branch tip re-verified byte-exact before merge).


## Wave 4 (R501-R503 B / R504-R507 C) — B COMPLETE, C pending

### Worker B — R501+R502+R503 COMPLETE (merged @41f6f75, 2026-09-19)

- Chat fc6c51aa (flight 10 — the only flight to survive the platform's
  GLM-5.3 CAPACITY SIEGE: between ~05:00-09:30 UTC, 9 prior B flights
  and 5 C flights were capacity-rolled-back (delayed, list-then-gone),
  queue-limbo'd (500 + destroyed records), or turn-zombied; the
  postmortem lives in the TL worklog).
- The worker landed, verified HEAD ed67199, created the branch, ran the
  baseline battery, and pushed the full delivery — then the delayed
  capacity rollback wiped the chat record (the surviving server record
  shows the 9,451-char prompt with an empty assistant message). Worker
  died POST-PUSH PRE-REPORT (W909 class): the delivery is real and on
  the push rail; the completion report is unrecoverable. TL ran the
  verification battery per the audit-first precedent.
- DELIVERED VIA THE PUSH RAIL: branch `work/r501-r503-product-plane`
  on GitHub at 9b01a12, ls-remote verified. Five commits on baseline
  ed67199: R501 (the real authorized upload flow — durable upload
  sessions over the R101+R207 seams), R501/R502 (the Create Studio UI
  — upload source, compute step, honest processing states),
  R503 (the reality artifact catalog — one session's four-reality
  artifact set), the R501-R503 test batteries, one format commit.
- SCOPE: apps/web only + bun.lock (25 files, +3,792/−243):
  upload-sessions / artifacts / compute-preview routes,
  create-studio UI (+682), create-studio-service (+625),
  honest-job-state (+278), catalog-service (+277), durable-control-
  plane / composition / http-errors extensions, api-types /
  client-api / create-flow, and three new test batteries
  (studio-upload-flow 532 lines, studio-upload-durable 222,
  honest-job-state 207).
- TL verification on the branch (@9b01a12): the lane's own tests all
  green. Full battery 4,941 pass / 16 fail / ~60 skip — the 16 are the
  pre-existing environmental class (apps/web embedded-server /
  live-route / quota 5s timeouts + the perception benchmark flake),
  verified same-or-worse on the pre-merge baseline ed67199 itself
  under the same resident replay-stack load; classes untouched by this
  lane; zero new failures. Scoped @sporta/web typecheck (the only
  touched package): 0 errors. eslint on the lane's files: 0 errors.
  prettier --check apps/web: clean.
- Lane C incident note: no R504-R507 flight survived the siege (all
  capacity-culled; the 09:49 final assault send left a stale B-prompt
  duplicate chat 0caab88d that never generated — voided). C re-dispatch
  follows after this merge.

## Worker evidence requirement

Every worker reports:

```text
worker / work items / start commit / end commit
changed files / contract changes / tests
acceptance evidence / fixture-vs-real boundary
license+model provenance / resource+cost evidence
risks / blockers / proposed architecture deviation
```

An architecture deviation blocks downstream work until the Tech Lead decides whether ADR-009 or the architecture lock must change.

## Current product gap

The current public web path still contains fixture/in-process and animated-SVG boundaries. Those are useful engineering harnesses but do not satisfy the MVP gate.

## Technology policy

All replaceable technology must enter through versioned adapters and be benchmarked through the Technology Evaluation Plane. Candidate technology may be replaced, combined, cascaded or used as fallback without changing product/domain contracts.

Every production candidate must carry version/provenance, resource requirements, license/commercial-use status, benchmark identity, cost/throughput evidence, and known failure semantics.

## Compute policy

The initial user-owned/hosted candidates are Modal, Lightning AI, RunPod and local GPU. Hugging Face/ZeroGPU is experimental only. Sporta-managed compute is a future service tier over the same Compute Broker, not a separate execution architecture.

## Final gate

`R601-R605` must pass `docs/testing/mvp-reality-engine-acceptance.md`. Only then may the repository describe Sporta as MVP-complete.