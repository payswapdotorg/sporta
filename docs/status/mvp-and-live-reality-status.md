# Sporta MVP + Live Reality Status

Status: WAVE 4 CLOSED 2/2 — WORKER A LANE MERGED @70ac991 (CI green: J001 + J002 + J003 product-truth surfaces + the ticker-key carry) + WORKER B LANE MERGED @5f5fa85 (CI green: the J008/J009/J010 UI surfaces over the wave-3 domain seams, composition-first; TL post-merge full battery 930 pass / 0 fail / 26 skip, env -u DATABASE_URL; the lane's honest re-delivery: the original session's sandbox recycled mid-close-out after pushing a stale-base tip fe4fbfb — the continuation re-cloned from current main and force-pushed the fresh-history delivery, fe4fbfb recoverable by SHA). Wave 3 CLOSED 3/3 (A @fd41352, B @e1c367b, C @7d9a375). Wave 2 FULLY CLOSED (A @a90ef12 + B @6bd9753 + C @ae075b5, all CI green). NEXT: wave 5 — the TL-owned final acceptance (J015 final journey acceptance, then R606 human visual acceptance, then R607 public MVP acceptance; workers fix-only)
Date: 2026-09-22 (Wave 4 closed; wave 5 next)

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
- J008: MERGED @fd41352 (Worker A wave 3, CI green) at the domain+enforcement seam: the rights editor — recordCreation (W902 re-attestation: a caller never asserts their own assertedBy), editPolicy (widen|narrow classified by REAL derivation, the W917 intersectCaps narrow-only ceiling mirrored: an edit can never widen past the creation attestation), revoke (the contract's own time bound — effective expiresAtIso = now-1 → DENY_ALL) — over durable stores (`SqliteRightsStore`: effective-policy + append-only audit tables, restart-survival pinned; in-memory twins), every change audit-recorded (who/what/when/from/to + editKind); the REVOCATION-AWARE SERVING SEAM (packages/output-pipeline/src/rights-aware.ts): retrieval/listing re-resolve the session's CURRENT effective capabilities via an injected resolver and FAIL CLOSED (PlaybackRightsDeniedError BEFORE existence is revealed) even when the caller still holds a stale full-allow W701 policy — the grant→serve→revoke→DENIED e2e against the REAL domain stores pins it, belt-and-suspenders with the inner caller-supplied gate (composed, never replaced), fail-closed on null resolution, typed propagation of resolver failures. HONEST PARTIAL: the operator/rights-holder EDITING UI is a later UI lane (the J006 B/C split); "publication" beyond the segment-serving seam composes through the same resolver contract.
- J009: MERGED @fd41352 (Worker A wave 3, CI green) at the domain seam: the role-gated audit discoverability query — `createRightsAuditQueryService.auditTrailFor(account, sessionId)` (packages/session/src/rights-audit-query.ts) over the frozen audit store shape: a rights holder reaches their OWN sessions' trails (resource-owner), an operator reaches every trail (grant:operator), every other role the honest 403 (not-resource-owner), unauthenticated the honest 401, a session with no ownership record the uniform 403 unknown-resource (no existence oracle) — via the NEW closed-vocabulary `rights-audit.read` identity action (packages/identity/src/policy.ts, matrix pinned in its battery). HONEST PARTIAL: "from their workspaces" UI reachability is a later UI lane; this lane owns the domain query seam + the role gates the UI will call.
- J010: MERGED @fd41352 (Worker A wave 3, CI green) at the domain+persistence seam: the analyst annotations service (packages/session/src/analyst-annotations.ts) — media-time markers (moment `atMs` / clip `startMs`-`endMs`) saved ONLY where backed by a REAL timeline (the session's SessionTimeline durationMs snapshotted at save, or a render output verified through an injected existence port; closed refusal vocabulary: session-unknown / no-timeline / out-of-range / render-unknown / render-lookup-unavailable), notes attached to saved markers (bounded text, author + injected-clock timestamp), the revisit seams (listMarkers in save order, getMarker with notes in attach order), access through the NEW `analyst-annotation.read`/`write` identity actions (owner / operator / analyst grant — honest 401/403, the 401 boundary BEFORE any marker lookup: no existence oracle), durable `SqliteAnalystAnnotationStore` (validated JSON documents, deep-clone-on-read, restart-safe gap-free ids `mk-<sessionId>-<n>` / `nt-<markerId>-<n>`), NO fake clip bytes PINNED BY TEST (the persisted shape is time ranges + backing references ONLY — no byte-shaped member exists to fill; clip byte rendering is a later media lane, never fabricated here).
- J001: DELIVERED (Worker A wave 4, branch work/j001-j002-j003-product-truth — awaiting TL harvest): Home capability truth — the stale renderer/Create wording is GONE (the hardcoded "Prototype/Reference renderer registered"/"No renderer registered yet" chips, the "Coming to Sporta" kicker, the deferred home-create "Not available yet" panel on a shelf whose entry IS real, and the "(Create Studio arrives with W906)" library line). The four-realities grid is now LIVE-capability-driven: every card's status chip derives from the real seams (the Create Studio's own `derivedRealities[]` offered/reason rows when signed in — the J004 seam; the public capability response's renderer registry through the pinned `HOME_REALITY_PRODUCERS` vocabulary otherwise, honest for anonymous visitors: original = the authorized source itself, served-by naming per producer, degraded when registered-but-not-serving, unavailable when no producer exists). The create shelf exposes the REAL Create entry (`/create`, the W906 surface — the hero CTA + the shelf's "Open the Create Studio" card, click-through verified) with its live state (offered realities + the upload answer), keeping the honest no-recommendation-plane note for the personalized-ideas part. The client reality→producer vocabulary is DRIFT-PINNED against the server composition's own `realityProducers` declarations by test. Evidence: apps/web/test/home-reality-grid.test.ts (22 tests incl. the W901-fixture honest matrix + the stale-wording-removal pins).
- J002: DELIVERED (Worker A wave 4, same branch): global + workspace navigation — role workspaces now SUPPLEMENT the core product navigation instead of replacing it: `navForRole` = PRIMARY_NAV + `workspaceSupplements(role)` (the matrix's workspace surfaces deduplicated by base path, so every role retains Home/Live/Explore/Library/Following/Create — the OPERATOR workspace no longer hides global Home/discovery entirely, the J002 trap), `navGroupsForRole` renders the labeled workspace group (desktop sidebar heading; the mobile tab bar one scrollable core-first row), the workspace MODEL itself is UNCHANGED (the matrix's surface map verbatim, entry points, safe-return membership — all W907 pins stand). Browser-verified over the real demo account (all five roles): operator switch lands on /operations with the full core nav + the labeled "Operator / Admin workspace" supplement; analyst switch keeps the core + Watch/Match Lab/Clips/Notes; mobile tabbar scrollable with Home first. Evidence: 8 new tests in apps/web/test/role-workspaces.test.ts.
- J003: DELIVERED (Worker A wave 4, same branch): deferred-surface honesty — every deferred surface (Following, Clips, Notes, Audit) now carries a REAL next action to an existing surface (Following → Explore, Clips/Notes → Match Lab, Audit → the Rights Center's policy audit — all click-through verified, never circular, pinned to real routes by test). The wave-3 domain seams are worded honestly: clips/notes say the J010 data plane EXISTS at the domain level (real timeline-backed markers, durable, no fake bytes) with the PAGE arriving via the "J010 UI (wave-4 lane)" — no "no data plane exists" wording that would contradict Worker B's incoming surfaces; audit names the two REAL audit surfaces that exist today (the W917 rights policy audit + the W918 operations remediation audit) plus the J009 domain query, with the page's unified view arriving via the "J009 UI (wave-4 lane)"; the home-create deferred entry is REMOVED (the shelf became real with J001) per the module's own can-never-regrow rule. Evidence: 16-test battery in apps/web/test/deferred-surfaces.test.ts.
- ALSO (the TL-assigned wave-3 cross-lane carry): the ticker-key one-line fix in Worker C's `use-live-world-stream.ts` — ticker keys now carry each entry's own per-frame discriminator (its index), so a fresh live window's first frame (~24 entity-appeared events at one atMs) no longer collides on duplicate React keys; the row construction moved into the exported pure `tickerRowsForFrame` (the hook calls it verbatim — one surgical change, nothing else in C's component touched); pinned by 7 tests + browser-verified (fresh window under console observation: zero warnings).
- J008 (UI surface, Worker B wave 4, branch work/j008ui-j009ui-j010ui): MERGED @5f5fa85 (Worker B wave 4, CI green) — the Rights Holder EDIT/REVOKE surface over the REAL domain seam: `@sporta/session`'s rights-editor `editPolicy`/`revoke` now back BOTH edit surfaces (the W917 policy console's routes AND the Rights Center's J008 panel — `RightsCenterService.setPolicy`/`revoke` delegate to `server.rightsEditor`, the ONE editor; the W917-era in-service validation/re-attestation/classification code is REPLACED by the domain seam's own, never forked). Every edit is contract-validated, RE-ATTESTED with the verified editor id (W902 — a caller's assertedBy claim never survives, pinned by test), lands in the SAME EffectivePolicyStore every serving seam re-derives from (fail-closed per read), and appends the domain-classified audit entry (`editKind` grant/widen/narrow/revoke — additive on the app-layer PolicyAuditEntry). W917 narrow-only is VISIBLE in the UI (the panel explains the intersection rule; a widen is stored + audited honestly but has no capability effect — pinned). REVOCATION verified end-to-end FROM THE UI: the "Check the serving state now" action drives `GET /api/rights/policies/[sessionId]/serving` — the watch verdict (playback DENIED/rights-denied) PLUS the composed J008 rights-aware SERVING SEAM's answer under the creation-time (stale) policy: the REAL `PlaybackRightsDeniedError` message rendered verbatim (the output-pipeline's `createRightsAwareSegmentStore` is now composed at the composition's pipeline seam — belt-and-suspenders under the rights-governed control plane, never a replaced gate). Honest deltas documented: a re-revocation now sets the domain editor's own `now-1ms` time-bound (both instants in the past — DENY_ALL unchanged; the W917 "never push later" pin updated to the domain rule), and revocation records TWO append-only entries (the domain rights revocation + the app-layer visibility flip — one decision per entry). Evidence: apps/web/test/j008-rights-editor-surface.test.ts (10 tests: the delegation semantics, re-attestation, narrow-only, malformed/already-expired refusals, the center model's additive fields, the serving route pre/post-revocation, the stale-policy pipeline denial, no over-blocking) + the browser journey (narrow edit → revoke → serving check renders PlaybackRightsDeniedError).
- J009 (UI surface, Worker B wave 4, same branch): MERGED @5f5fa85 (Worker B wave 4, CI green) — the workspace-reachable AUDIT surface: `/audit` is REAL behind `GET /api/audit/trail` (`?session=` for the per-session drill-down), both composed through `@sporta/session`'s role-gated domain query seam (`auditTrailInScope`/`auditTrailFor`) over the SAME append-only log: a rights holder reaches their OWN sessions' trails, an operator every trail, every other role the honest 403, anonymous the honest 401 (the domain seam's own boundaries mapped verbatim; the ownership SENTINEL composition keeps the per-session denial uniform — no existence oracle, pinned byte-identical). The trail is the domain vocabulary ONLY (policy/revocation entries with `editKind`); publication-visibility events stay on the Rights Center's policy console trail — honestly linked from the surface, as are the operations audit surfaces. The async→sync bridge (the domain service's synchronous `ownerIdOf`/`sessionIdsOfOwner` ports over the app's async ownership store) pre-resolves the REAL values per request — the domain seam still makes every authorize decision. Workspace reachability: the rights-holder and operator workspaces already list /audit by route (pinned by test — no guessed URLs); the deferred-surface entry is REMOVED per the module's own can-never-regrow rule and /audit joined REAL_SURFACE_ROUTES. Evidence: apps/web/test/j009-audit-trail.test.ts (14 tests) + the browser journey (operator trail renders the narrow + revoke entries with the domain summaries; the focused ?session= view; the anonymous sign-in panel).
- J010 (UI surface, Worker B wave 4, same branch): MERGED @5f5fa85 (Worker B wave 4, CI green) — the Analyst CLIPS/NOTES minimum surfaces: `/clips` and `/notes` are REAL behind `/api/annotations/**` (`GET/POST markers`, `GET markers/[markerId]`, `POST notes`), composed through `@sporta/session`'s analyst-annotations domain service over the composition's annotation store (durable `SqliteAnalystAnnotationStore` under Bun at `db/analyst-annotations.db` (env `SPORTA_ANNOTATIONS_DB`), the honest in-memory fallback + banner under the bundled Node runtime — the W911 doctrine, restart-survival pinned by a second composition over the same file). The REAL timeline backing: the session's original-reality artifact → its durable hash-verified SourceAsset's `durationMs` (the R101 ffmpeg normalization) — a story-only session honestly answers `no-timeline` with the upload next-action (never a guessed extent). The closed refusal vocabulary answers typed with useful next actions (out-of-range/no-timeline/render-unknown → 422 `annotation-refused`, marker-unknown → 404, malformed → 400); access is the domain's own rule (owner/operator/analyst grant; anonymous 401; the unknown-session gate denial is uniform — no oracle). THE NO-BYTES PIN IS INTACT AND VISIBLE: markers are time ranges + backing references only (no byte-shaped member in any API document — pinned by test), the UI states it, and clip byte rendering remains a later media lane. Evidence: apps/web/test/j010-analyst-annotations.test.ts (16 tests over a REAL ffmpeg-generated MP4 upload: the timeline backing, moment + clip saves, notes + revisit, every refusal, the NO-BYTES pin, the second-composition persistence) + the browser journey (real upload → 3000ms timeline → moment + clip markers → note attached → deep-link revisit → the honest no-timeline panel on a story session).
- J015 (final journey acceptance, TL-owned, executed 2026-09-22 over the merged main @eaba0a4): DELIVERED WITH FINDINGS — the FULL journey ran through a REAL fresh browser (agent-browser, zero cookies) against the production build (next build + start, zero state: SPORTA_DISABLE_DEV_SEED=1, scratch planes, no fixture sessions, no developer API calls): fresh browser -> register (creator+analyst, real /api/auth/register) -> Create Studio -> REAL MP4 upload (the server-side R101 boundary: 640x480 8s pitch-marked clip, ffprobe-verified, magic-byte-sniffed) -> rights declaration (analysis+transformation+derivative+storage, future expiry) -> ALL THREE derived realities selected -> compute: PLATFORM CHOSE sporta.compute.hosted (the broker's deterministic order) -> ONE submission -> the J004 plan: 4/4 SUCCEEDED (original artifact stored + tactical r-1 + 3D r-2 + anime r-3, real jobs through the in-process compute plane) -> FOUR OUTPUTS (real h264 videos, ffprobe-verified distinct encodes) -> Watch: REAL playback (HTML5 video, artifact content routes, 8s original + 4s derived) -> Reality Switcher: all four READY, switched x4 (URL + artifact source verified per switch) -> Jobs surface (real job states) -> role switch (Creator <-> Analyst, workspace-aware navigation) -> REFRESH: full recovery (all four realities READY after reload). FINDINGS (honest, user-visible): [F1] the Library/catalog render rows report "0 stored outputs / Not watchable" for a session the Watch surface serves all four artifacts of — the J004 derived-reality MP4s land in the MEDIA platform's artifact store (by design, the R508 landing) but the catalog's hasStoredOutputs reads ONLY the render-output segment store (listRenderOutputs) — a cross-surface integration defect (fix lane); [F2] the REDEPLOY leg (restart -> return to result) honestly FAILS at the Next-server boundary: the production server tree cannot construct bun:sqlite (the documented Node-worker environmental boundary; every plane's in-memory banner logged) so the session is honestly gone after restart ("No such match session — the real answer, not a placeholder") — the durable seams ARE proven at the route level (the J014 three-process Bun battery; the hosted W912/W914 plane needs credentials this deployment lacks). The media artifacts survive on disk. Evidence: 19 browser screenshots + the API evidence + ffprobe + the VLM visual assessment (R606 prep) under the TL's j015-evidence scratch.; J008-J010 MERGED @fd41352 (domain-side; UI surfaces later); J011 MERGED @e1c367b (Worker B wave 3: operator contextual navigation); J014 MERGED @6bd9753 (Worker B: sqlite identity plane + real three-process restart battery + public-route in-memory audit)

R606: EVIDENCE PREPARED (TL, 2026-09-22) — the four J015 outputs are real h264 videos (ffprobe: distinct encodes 640x480/8s original + 640x360/4s x3 derived), visually distinct per the VLM assessment (four different visual languages: the original clip, the tactical schematic with numbered players + scoreboard, the retro/pixelated 3D, the smooth stylized-3D), same-event derivation pinned by the artifact manifests' SWM provenance (session-bound, snapshot lineage). The honest note: the fixed-t frame extractions show different moments (the derived renders condense the 8s source to 4s), so the visual same-instant comparison is partial — the derivation chain is the manifest's, not the frames'. AWAITS the human reviewer's confirmation (the operator gate)
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
| L012 multi-source evidence fusion | MERGED @fd41352 (Worker A wave 3, CI green, TL-verified 474/474 scoped on the merged tree; branch checkpoints 0d9b606 + c442214): packages/live-fusion — the composing driver over L004→L003 into the ONE canonical engine (the seam decision recorded in docs/designs/l012-multi-source-fusion.md: a NEW package — L004's own doc defers cross-source fusion to this lane, live-swm's per-batch semantics untouched); D1 no-coobservation drains pass VERBATIM (Wave 2 behavior preserved); D3/D4 movement-plausibility conflicts (per-kind speed bases) → ConflictRecords in the ONE @sporta/fusion vocabulary (bridge-scheme ids); D5 same-time ties decided by the CANONICAL REPLAY ORDER (sourceId, sequence) so the frozen §8 live-to-replay equality holds BY CONSTRUCTION for every arrival order (the precedence-survivor draft diverged for late arrivals — caught by the replay-equality test, recorded honestly), losers WITHHELD + counted + ledger-recorded, never silently averaged; D6 source loss = the L004 STALLED latch consumed VERBATIM (source-lost/recovered events, fallbackActive); D7 §9 accounting per-batch + per-source VERBATIM with fusion-layer counters never double-counted; D8 replay equality pinned for conflicted/agreeing/lossy compositions; D9 all-withheld batches suppressed (never invalid documents); 41 tests incl. the three-REAL-sources integration (L002 tracking + L011 broadcast-perception over a real generated MP4 + L007 SkillCorner format-fixture replay) |
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
