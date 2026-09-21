# Sporta MVP + Live Reality Status

Status: WAVE 2 — ALL THREE LANES DELIVERED. A lane MERGED on main (L003/L004/L007/L008/L011 @a90ef12, CI green @ae075b5); C lane MERGED (L005/L013/J006-UI/J013 @ae075b5 + the Wave-3 follow-on l014pres-fidelity-anime); B lane DELIVERED on branch work/j006b-j014-l006-l009 (J006 backend + J014 + L006 + L009; L006 TL-verified PASS at its checkpoint; gates on the branch: lint/typecheck/format clean, lane batteries green — the full-battery baseline note below)
Date: 2026-09-21 (Wave 2)

## Completed foundation

- W001-W921: COMPLETE
- R001-R510: COMPLETE
- R601-R605: VERIFIED (gate-audit doc @fb0a708; live R602 four-reality evidence)
- CI on main: GREEN as of 06461e8 — the standing redness since ddac9e7
  root-caused to the GitHub runner lacking ffmpeg (FfmpegUnavailableError
  cascades through every real-media test family + the default
  runVisualCorrectnessGate NOT-RUNNABLE); fixed by installing ffmpeg in
  ci.yml (2c19f75). The last documented machine-variance failure (the
  detection-benchmark model-backed degradation assertion, which depended
  on an uncommitted weights asset) is now pinned deterministically with a
  controlled temp weightsDir covering BOTH honest postures
  (inference-backend-not-wired + weights-unavailable) @06461e8.
  First green CI run since the R-era 2e42e72.

## Remaining batch MVP

J001-J015:
- J004: COMPLETE (Worker C wave 1, merged @7e0a810 + lint fix @41f5b83, CI
  GREEN): the one-submission multi-reality Create — frozen contract
  implemented verbatim (additive realities field, one compute directive,
  per-reality honest independent failures, plan state on existing
  surfaces, honest capability-gated multi-select).
- J005: COMPLETE (Worker B wave 1, merged @d785e93 + style @08dd215)
- J007: COMPLETE at the local-substitute scope (Worker B wave 1, merged
  @d785e93); the HOSTED Neon/R2 durability gate remains BLOCKED on
  operator credentials (external dependency below). J014's final
  redeploy acceptance may leverage the same local durable path when the
  hosted gate stays unavailable.
- J012: IN FLIGHT (Worker A) — checkpoint 1 pushed and TL-reviewed PASS
  (work/j012-l003-l004-l010 @925feab: the three-way licensing survey +
  the pure-code contrast-context-detector production-path decision);
  implementation + sensitivity tests pending (peak-hours capacity churn
  killed the worker's turn; sentinel re-nudges; sandbox TTL expired —
  re-entry law resumes from the branch).
- J006: COMPLETE (both halves). UI: Worker C wave 2, MERGED @ae075b5 — the
  compute-transparency panels on Create AND Watch rendering the six facts
  (compute source, provider, selection reason, measured allowance/cost,
  privacy posture, fallback state) from the EXISTING route contracts
  (compute-status + compute-preview + the J004 plan selection + the job
  views), honest unknowns everywhere (never invented numbers), the declared
  no-silent-fallback posture + typed refusal rendering, 22-test
  pure-derivation battery. BACKEND: Worker B wave 2, branch
  work/j006b-j014-l006-l009 (@44525c4 + fixup @c338189) — the six
  acceptance fields served by the API layer on EVERY compute-carrying
  route (compute-status `transparency` document; the SAME
  `StudioComputeSelectionRecord` riding compute-preview/dispatch/jobs/
  session-state/watch), measured allowance/cost strictly from the existing
  compute-adapter metering + W901 quota seams (estimates and measurements
  separately labeled, never conflated), the no-plane fail-closed posture
  (nulls + posture "no-plane", never invented facts), the refusal posture
  (explicit selections refuse loudly — the typed 422 with every recorded
  reason, never a silent substitution), route-level battery 18/18
  (apps/web/test/j006-compute-transparency.test.ts, 532 lines) + the exact
  wire-shape handoff doc (docs/status/j006-backend-compute-transparency.md);
  reconciled additively with C's UI at merge (the UI derives its views from
  the existing contracts; the backend documents are the same data computed
  once at the decision moment + the measured/fail-closed increments).
- J014: COMPLETE (Worker B wave 2, branch work/j006b-j014-l006-l009 @25c238c)
  — the local durable IDENTITY plane closes J007's documented gap: sqlite
  account + session stores over `bun:sqlite` (the W911 port shapes
  mirrored; only SHA-256 token hashes on disk; WAL + busy-timeout), wired
  at the composition's env gate (the honest in-memory fallback + banner
  under the bundled Node runtime; Neon remains the production shape), the
  honest health surface (identity row reports sqlite with a LIVE read —
  /api/platform/health + the Operations board), and the REAL
  process-restart battery (apps/web/test/j014-restart-redeploy.test.ts:
  three REAL child processes over one scratch — fresh journey → restart
  resolves the STILL-OLD token + Library/Watch/bytes recover → redeploy
  serves the anonymous public path; bytes-on-disk proof; 4/4 + 38
  assertions; server+tests in ONE invocation) + the public-route
  in-memory audit (every family classified durable/reconstructed/
  ephemeral-by-design/per-instance — no undisclosed in-memory state on the
  public path; docs/status/j014-restart-redeploy-durability.md). The
  hosted Neon/R2 redeploy gate remains J007's recorded external
  dependency.
- J013: DELIVERED (Worker C wave 2, MERGED @ae075b5) — the sensitivity gate —
  pure verdict/premise derivations (the material-difference measurement + the
  4-verdict truth table incl. the explicit equivalence explanation) + the
  full-pipeline battery over the NEW calibratable pitch-marked test media
  (positions project to canonical pitch meters) + tactical + 3D e2e gates
  PASS (different SWMs → different real artifact hashes) + the
  content-addressed dedup control pair + the renderer-side sensitivity proof
  for BOTH game realities (5 tests). The Wave-2 honest findings were BOTH
  resolved/dispositioned in Wave 3 (Worker C, branch
  work/l014pres-fidelity-anime): (a) the UNMARKED-pitch fidelity gap remains
  the J012-documented honest measurement (calibration refuses without
  landmarks → entities omitted — no renderer-side honest fix identified;
  NOT faked); (b) the anime-budget tension is RESOLVED renderer-side per the
  TL decision — the anime capability's default profile is now the "on twos"
  SD profile (640×360@12 fps, anime-npr.prototype@0.2.0): the populated-
  pitch default render measures 650 036–671 203 B ≈ 65 % of the untouched
  1 MB fail-closed platform budget (the previous 25 fps default measured
  1 038 993–1 082 922 B — OVER), and the J013 anime leg GRADUATED into the
  full sensitivity gate (the test's built-in graduation path: the leg now
  runs the SAME matrix as tactical/3D + asserts the budget fit; evidence in
  docs/research/l014-anime-budget-and-live-replay-presentation.md).
- J001-J003, J015: NOT_STARTED (final hardening waves); J008-J010 DELIVERED domain-side @wave-3 A (UI surfaces later); J011 NOT_STARTED (wave-3 B); J014 MERGED @6bd9753 (Worker B: sqlite identity plane + real three-process restart battery + public-route in-memory audit)

R606: BLOCKED pending human visual acceptance and final fidelity conditions
(J012/J013 fidelity + J014 durability + J015 journey must pass first).
R607: BLOCKED until J001-J015 and final proof conditions pass.

## Live Reality

| Item | State |
|---|---|
| L001 contract freeze | VERIFIED — docs/contracts/live-reality.md is FROZEN FOR IMPLEMENTATION; Wave 0 verified logical-to-implemented contract compatibility (mapping recorded in the Wave 0 log below) |
| L002 synthetic/replay live source | COMPLETE (Worker B wave 1: packages/live-source — frozen §1/§2 shapes verbatim, 6 delivery scenarios, seeded splitmix32 determinism, honest gap accounting; merged @d785e93) |
| L005 live tactical renderer | FULL (Worker C wave 2, MERGED @ae075b5 — TL-verified incl. 777/777 web battery clean-env): the pure view projection (apps/web/src/lib/live-tactical-view.ts — exact-math fixture battery: coordinates, radii, colors, STABLE identity labels, watchdog math) + the full browser surface (identity-continuous markers with stable labels, pinned entity inspector, honest event ticker, receipt-watchdog stall overlay — never a frozen picture) + event-driven updates over W915 (no polling) + one seeded session per L002 delivery scenario (all six: normal/jitter/delay/drop/out-of-order/reconnect) + 21-test battery (fixtures + every scenario's honest signature + identity-continuity pinning across every window) |
| L003 incremental SWM updater | MERGED @a90ef12 (TL-verified 193/193 + typecheck x5 + lint + format; CI green @ae075b5): packages/live-swm — a DRIVER over the injected canonical WorldModelEngine (no second world model), the batch pass's own no-op guard + per-entity replay frontier (beyond-window lates dropped with an explicit counter, never a position rewind), verbatim confidence/provenance/uncertainty, extrapolation marking (§9), the memoryless incremental possession recompute (the batch formula/tie rule, reused verbatim), the D5 LiveUpdateReport, the W005 continuity bridge with replay-equality proven across all six L002 scenarios (36/36 tests) |
| L004 temporal buffer/watermark | MERGED @a90ef12 (TL-verified 193/193 + typecheck x5 + lint + format; CI green @ae075b5): packages/live-temporal — per-source event-time watermarks (frozen shape, conservative + monotone, property-tested), bounded reorder buffer with honest late/duplicate/overflow accounting, recompute-based sequence-hole model, STALLED/DEGRADED latch + flush, verbatim L002 recovery consumption, every §9 counter this stage owns; the D4 six-scenario acceptance matrix pinned (57/57 tests) |
| L006 live telemetry | WORKER-B HALF COMPLETE (Wave 2, branch work/j006b-j014-l006-l009, TL-verified PASS at the L006 checkpoint): packages/live-source/src/telemetry.ts — the frozen §9 counter core (source-to-ingest, ingest-to-SWM, SWM-to-render, end-to-end latency; dropped/extrapolated updates + frame drops; real clocks only at the delivery seams, injectable everywhere) + apps/web server/live/telemetry.ts — the transport decorator (delivery-boundary stamps + per-session producer probe injection; the wire bytes unchanged) + GET /api/operations/live-telemetry (operator-gated ops surface) — 857 lines of deterministic batteries (packages/live-source/test/telemetry.test.ts 568 + apps/web/test/live-telemetry.test.ts 289) driving the L002 delivery scenarios to EXACT counts; the §9 counters ride the same seams L004/L003 already expose. Worker C's UI half lands with C's lane |
| L007 SkillCorner/open-data replay adapter | MERGED @a90ef12 (TL-verified 193/193 + typecheck x5 + lint + format; CI green @ae075b5): packages/live-open-data — the SkillCorner opendata replay adapter (the recorded published schema, fetched 2026-09-21; provider fields normalize at the seam — the possession hypothesis and image-corner projection never reach a product contract) driving the EXACT live path (adapter → L004 → L003 → the canonical engine, with the D6 replay equality); DEV-TIME real-data verification recorded (15 real frames of match 2017461 through the full composition); NO sample data committed (format-fixtures only) (17/17 tests) |
| L008 live provider TechnologyProfile | MERGED @a90ef12 (TL-verified 193/193 + typecheck x5 + lint + format; CI green @ae075b5): packages/live-open-data/src/profiles.ts — SkillCorner opendata registered as the REAL candidate (code+dataset MIT per the repository LICENSE fetched 2026-09-21, blockingLicenseIssues EMPTY) and Metrica sample-data registered as the EXPLICITLY BLOCKED candidate (NO license file — attribution request only — both components unresolved, blockingLicenseIssues non-empty: the R004 fail-closed rule), both through the frozen TechnologyProfile contract with capabilities/data format/rate/provenance/license/failure classes |
| L009 authorized live provider adapter | BLOCKED ON FEED ACCESS — ADAPTER SHAPE DELIVERED (Worker B, Wave 2, branch work/j006b-j014-l006-l009): packages/live-authorized — the env-driven SkillCorner gate (the provider SDK's own binding names SKILLCORNER_USERNAME/PASSWORD/MATCH_ID; incomplete sets = the honest `blocked` with the exact missing names, secrets never surface), the pull-based adapter over the RECORDED endpoint (GET /api/match/{id}/tracking, HTTP Basic, DRF pagination — every transport fact FETCHED 2026-09-21 from the provider's own SDK v3.2.0 + the opendata schema of record), strict-on-consumed/ counting-unknown frame parsing (unknownFieldKinds = the activation verification hook), the §6 TechnologyProfile with the honestly-unresolved DATASET component (blockingLicenseIssues non-empty — R004 fail-closed), and the operator-visible liveAuthorized panel on GET /api/operations/providers (36/36 + 3/3 tests; format-fixtures only, no sample data). Activation = the three bindings + the first-pull schema review + the data-use record — see docs/status/l009-authorized-provider-adapter.md |
| L010 broadcast-to-live perception benchmark | HARNESS COMPLETE (Worker A wave 1, merged bccf89c); the Wave 2 runtime-backed increment is delivered as the L011 seam evidence (a real decoded clip through the production perception path, per frame, with the L011 integration test measuring the full live composition); real model inference remains W303-blocked (RF-DETR weights never committed) |
| L011 broadcast perception runtime seam | MERGED @a90ef12 (TL-verified 193/193 + typecheck x5 + lint + format; CI green @ae075b5): packages/live-perception — the per-frame seam (tracked boxes + ball detections + the required pitch calibration → frozen LiveObservation with sourceType BROADCAST_PERCEPTION; the batch-bridge projection imported, not forked; track ids verbatim) + the clip-driven source (decode → the contrast-context production path → track → the seam, incremental); the integration test drives a real generated MP4 through L004 → L003 into the ONE canonical engine with NO renderer changes and NO second SWM (11/11 tests) |
| L012 multi-source evidence fusion | NOT_STARTED (Wave 3, Worker A) |
| L013 live 3D renderer | COMPLETE (Worker C wave 2, MERGED @ae075b5): the additive renderer-3d live view-model adapter (packages/renderer-3d/src/live.ts — identity-continuous scene carry, honest last-known carries, the pure orbit/zoom/pan camera whose look-at basis is PINNED equivalent to cameraFromSlot by test, the renderer's own projection math reused) + the browser interactive 3D view over the SAME W915 world stream (shared useLiveWorldStream hook — one transport, one world shape, two presentations; camera state the world never touches; pointer/wheel/keyboard camera; no restart on frames) + the Live surface 2D/3D view-mode toggle + 11-test battery (scene-graph math, camera bounds/equivalence, interactivity-during-updates, update continuity) |
| L014 live/replay continuity | PRESENTATION SIDE DELIVERED (Worker C wave 3, branch work/l014pres-fidelity-anime — awaiting TL harvest): after a live window ends, the SAME tactical/3D surfaces replay the RECORDED session state through the SAME view-model contracts — the finite live window (the additive `live-window-complete` close), the transport's verbatim replay record (ordinals/world versions/watermarks/event times never re-stamped), the replay route (/api/live/[sessionId]/replay, the fail-closed ladder + 409 while the window is open), the honest 410 + replay pointer on the stream route, and the client replay presentation (the shared scrub/step/play cursor driving BOTH views through the same projections + the pure replayContinuityVerdict making the versions/timecodes alignment VISIBLE and asserted). PARTIAL BY DESIGN: the platform side — durable persistence of live observations/world versions + reload/redeploy recovery — is Worker B's lane (the record is the transport instance's own memory; a restart honestly answers no-record). Evidence: docs/research/l014-anime-budget-and-live-replay-presentation.md + the 82-test live battery |
| L015 live tactical gate | NOT_STARTED (Wave 5, TL) |
| L016 live tracking -> SWM -> tactical journey | NOT_STARTED (Wave 5, TL) |
| L017 live-to-replay recovery gate | NOT_STARTED (Wave 5, TL) |

## Wave 0 record (2026-09-20, Tech Lead)

Repository state:

- Local was 28 commits behind origin/main (docs-only: the operator authored
  the full J/L phase doc set). Fast-forwarded to 9feb623. Clean tree except
  deliberately untracked `gate-clips/` (licensed evidence media, provenance
  recorded in the gate-audit doc; no committed binaries).
- Battery evidence: full suite 6184 pass / 1 fail (documented perception
  benchmark variance) / 33 skip recorded at 5703a0b (pre-docs commits);
  contracts + observation suites re-run green post-fast-forward. Lint/typecheck
  clean per the prior session's record.
- No architecture drift found: composition, renderer contracts, SWM
  invariants and technology-plane adapter conventions match the frozen docs.

Contract compatibility verdict (live-reality.md → implemented contracts):

- `LiveObservation` maps onto the existing Observation envelope patterns
  (dual clocks `eventTimeMs`/`ingestTimeMs`, provenance, confidence) plus an
  ADDITIVE live entity-observation payload (xMeters/yMeters/zMeters,
  detected, sourceLocalTrackId). No frozen shape changes.
- `LiveWorldState` maps onto `WorldSnapshot` + `WorldEventStreamEntry`;
  `worldVersion` → snapshotVersionAfter/sequence; clock/score live in the
  football extension; confidenceSummary/sourceSummary are a live VIEW-layer
  projection, NOT WorldSnapshot mutations.
- Event-time vs ingest-time: exactly the two documented clocks (timestamps.ts).
- Watermark: `Watermark {watermarkMs, sequence}` unchanged.
- Bounded reorder window: contract-allowed today; implementation is L004.
- TL DECISION (extrapolation marking): the frozen `UncertaintyStatus`
  ["known","unknown","uncertain"] is NOT extended. Extrapolation is marked at
  the LIVE layer (live-envelope provenance + the §9 telemetry
  extrapolated-observations counter); live-view slots carry "uncertain" +
  confidence + provenance. Workers raise a contract-change request if this
  proves insufficient.
- Live render input/output maps onto `RenderRequest`
  (snapshotVersion/eventsSinceSequence/outputProfile/rightsCapabilities) and
  `RenderResult` (watermarkAfter + RendererHealth lag/degraded) —
  renderClock/outputMode are live-layer additions.
- Multi-reality Create request: FROZEN in
  `docs/contracts/multi-reality-create.md` (additive `realities` field on the
  upload route; one compute directive; per-reality honest independent
  failures; existing job/render surfaces carry the plan state).
- Session identity / live-to-replay: the session id remains the constant;
  live observations + world versions persist keyed to the same session.

Implementation-state notes for the lanes:

- J004 seam verified: Create Studio UI + renders route are single-renderer
  today (`draft.rendererId` radio; one render per POST). The frozen contract
  above is the J004 implementation target.
- J005 base exists: `packages/connection-center` (connect/verify/disconnect/
  status + master-password refusal) and 4 compute provider adapters (modal,
  lightning, runpod, local).
- J007 seams exist (Neon/R2/Upstash behind env gates — W910-W914/W921) but
  NO hosted credentials exist in this sandbox (external dependency below).
  The local durable path (bun:sqlite `SqliteMediaPlatformStore`) runs only
  under the real Bun runtime; the Node deployment honestly falls back
  in-memory (W911).
- J012 seam verified: `packages/real-to-swm` runs detect→track→ball→
  calibrate→team→bridge→fuse→emit with an honest degradation ledger. The
  gate clips' empty-event SWM came from model-backed weights being
  not-downloaded → heuristic fallback → weak detections. Weights candidates
  (yolov8n.pt / yolov5nu.onnx) are AGPL-licensed assets — the J012
  investigation must evaluate licensing vs alternatives before download.
- L-series base exists: the W915 SSE live transport lane
  (`apps/web/src/server/live/` + `/api/live/*` routes) is a REAL network
  transport (bounded buffers, counted drops) whose producer currently cycles
  the dev-seed story timeline. The L-program re-points generation at the
  canonical live SWM — do not discard the transport.
- `packages/fusion` (`runWorldFusion`) is the batch SWM seam L003 extends to
  incremental updates.

## Hugging Face Technology Portfolio

HF001-HF015: NOT_STARTED

The portfolio is now part of the active program.

P1 discovery/benchmark candidates:
- RF-DETR SoccerNet
- MapAnything
- SoccerChat
- VibeVoice/Qwen3-ASR
- Spivak
- Wan2.2-Fun-Control-Camera
- ReCamMaster
- Meridian
- ViewCrafter

Research/watchlist:
- SAM3
- DA3-GIANT
- non-commercial soccer VLM candidates

No candidate is production-approved. The model cards establish discovery/provenance inputs only; Sporta benchmark and license/commercial-use evidence are required.

## Current architectural insight

Live tactical rendering is not a separate product stack. It is a live input + temporal SWM + renderer path using the same canonical domains as batch rendering.

The first live milestone can use synthetic/replay/open-data tracking. A real commercial provider is an optional dependency, not a prerequisite for proving the architecture.

## Doc-consistency finding (minor, non-blocking)

The HF portfolio is documented in docs/research/hugging-face-sporta-model-portfolio.md and its work items in docs/work-items/hf-model-portfolio-work-items.md. The J001-J015 definitions live in
`docs/work-items/mvp-user-journey-hardening-work-items.md`, whose own header
marks it "historical/superseded" while the active work-items doc incorporates
J001-J015 by reference. The ownership assignments are consistent across both
files; recommend a later docs-only commit folding the J definitions into the
active work-items doc. Not blocking Wave 1.

## Next safe wave

Wave 1 continues (per the handoff): Worker A (J012 investigation + L003/L004
design + L010 benchmark harness), Worker C (J004 + L005 scaffold) — Worker
B's lane is DONE and merged; B's next lane is Wave 2 (J006 backend + J014 +
L006 + L009-when-feed-access). Shared contracts frozen: live-reality.md
(verified), multi-reality-create.md (frozen). Workers raise
contract-change requests, never patch around ambiguity.

Dispatch precondition (post-reset): the worker-dispatch machinery must be
re-established — see the session record below.

## Post-reset Wave 1 session record (2026-09-20, Tech Lead)

Environment: the sandbox was RESET (sixth full reset). /home/z was wiped to
a pre-R-program checkpoint; sporta/replay2 clones, ~/.secrets PAT,
git-credentials and the replay stack (console :3000, replayd :3100, Chrome
CDP :9222) were all lost. The my-project default dev server was restarted
on :3000 by the platform. GitHub main carried 13 NEW operator docs commits
(the approved Hugging Face technology portfolio + active-handoff wiring).

Wave 0 re-verification (repo-first, per the no-conversation-dependency
rule): all mandated docs re-read from the fresh clone
(AGENTS.md, architecture-lock, TL handoff, work-items, status, worker
packets, live-reality.md, multi-reality-create.md, ADR-009/010/011,
technology-task-profiles.md, gate-audit, HF portfolio docs). Contracts
remain FROZEN — no drift found.

Worker B lane harvest (delivered pre-reset, branch work/j005-j007-l002
@7bd7057, base a0f288e):

- TL battery on the branch: 6254 pass / 33 skip / 18 fail — the 18 are 17
  environmental app-boot timeouts (full-battery contention on the 2-CPU
  post-reset box; the IDENTICAL timeout family exists on baseline main:
  6156/17/33) + the documented detection-benchmark variance failure. The
  branch's own test files re-run isolated with extended timeouts: ALL PASS
  (J007 6/6 incl. the live-read health test; golden-path + compute-center
  28/28; live-source contract suite green).
- typecheck: every @sporta/* package exit 0 when run sequentially (the
  parallel fan-out OOM-kills tsc on this 2-CPU/4GiB box — environmental;
  the pre-reset machine did not hit this).
- lint: 0 errors. Format: 16 worker files drifted (prettier not run by the
  worker) — TL style remediation @08dd215 (whitespace-only; format:check
  green; spot tests re-green after the workspace relink `bun install`).
- Contract review: VERDICT PASS (recorded in the merge commit d785e93).
  Notable accepted addition: the live-layer `recovery` member on
  LiveObservation (documented in packages/live-source/src/observation.ts;
  implements the frozen temporal rule "reconnect … explicit gap
  accounting"; additive outside frozen packages/contracts — consistent
  with the Wave 0 mapping decision).
- Merged --no-ff d785e93 on local main. CI could not be observed: PUSH IS
  BLOCKED (no PAT after the reset — external dependency #6 below).

Process deviations recorded (Worker B): prettier not run (fixed by TL);
no on-repo report artifact (the branch's 3 commit messages + design doc
carry the report content; acceptable this once — the report contract is
enforced for future lanes).

## External dependencies

1. Authorized live tracking provider/feed credentials if L009 is attempted.
2. Legally permitted benchmark data for any public-data benchmark.
3. Authorized broadcast media for L010 when real broadcast inference is benchmarked.
4. Neon/R2 (or equivalent hosted Postgres/object-storage) credentials for
   J007's cross-instance/redeploy durability gate — NOT present in this
   sandbox. J007 implementation and seam tests can proceed; the final
   durability gate is blocked until the operator supplies credentials.
5. Operator's section-I human visual acceptance (R606) on the live app.
6. ~~OPERATOR PAT~~ RESOLVED (restored by the operator post-reset): pushes
   work; wave-1 Worker B merge + CI fixes + status evidence pushed
   (d881700 → 2c19f75 → 06461e8).
7. ~~Operator chat.z.ai login~~ RESOLVED (logged in through the rebuilt
   replay console). Worker A + Worker C Wave 1 lanes DISPATCHED and
   generating (sessions wave1-a / wave1-c, GLM-5.3, Full-Stack; branches
   work/j012-l003-l004-l010 and work/j004-l005-hf).

## No-conversation-dependency rule

This status, the ADR, contracts, research note, work items and handoff are the implementation context. Agents must not assume any undocumented decision from prior chat history.
