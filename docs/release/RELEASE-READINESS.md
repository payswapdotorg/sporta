# Sporta Release Readiness Review — W806

**Work item W806 (M7):** "security, rights policy enforcement, performance,
tests, docs, rollback, and known limitations reviewed." · Owner: Tech Lead ·
Dependencies: W801–W805 (all COMPLETE; verified in the ledger).

Reviewed by the resident Tech Lead. Evidence rule: every claim below cites
executable evidence (commit, test, or checked-in artifact); anything not
verifiable is recorded as a gap, never assumed.

**Status: final draft — §4/§7/§8 and the verdict complete at the final
battery + gate-suite run (the post-W803 refresh); every other section is
final as of main @ 002f39e.**

## Review method

- The final battery personally re-run by the TL on the final main: `bun
  install` → serial per-package typecheck (`grep "error TS"` == 0) →
  `bun run lint` → `bun run format:check` → `bun test` (§4 records the
  numbers). The never-trust-reported-numbers standard (the ledger preamble).
- The release gate suite run: `packages/quality-gates` (W803) CLI verdict
  over the repo fixtures (§8).
- Doc accuracy spot-checks against code (the pinned-both-directions
  convention: THRESHOLDS.md, SLOs.md, POLICY.md, GATES.md).
- Every known limitation aggregated from the per-item ledger rows (§7).

## 1. Security

Control document: `docs/security/rights-security.md`. Control-by-control:

| Control | Implementation evidence |
|---|---|
| Rights/authorization fail-closed | `@sporta/control-api` (W701): SessionWithRights, ControlRightsDeniedError, deny-before-existence; real-user HTTP E2E 19/19 incl. fail-closed rights + the dual-side playback gate |
| Media security (untrusted inputs) | decoding-path validation (W101); bounded queues + backpressure (W302/W304); integrity verified at the W504 sha-256 seam (W706 telemetry re-verifies over served bytes) |
| Tenant isolation | W701 session scoping; W706 privacy-by-construction telemetry (exact-key allowlists make policies/artifact bytes/source frames/renderer payloads/user ids UNREPRESENTABLE — pinned across 23 sensitive key names × every event kind + scalar-only shape walks + re-validation at every sink) |
| Model safety | the commentary pipeline (W207–W209) extracts typed deterministic candidates; no path from commentary text into privileged instructions exists anywhere in the repo (EventCandidate is typed data, not instructions) |
| Provider isolation | secrets never in repo files: the repo's only secret stores are gitignored; worker packets carry credentials in push URLs only, never committed; secret scans precede every push from this station |
| Abuse controls | resource caps everywhere: bounded queues (W302), MAX_RENDER_FRAMES 3600 fail-loud (W603), decoding duration/size caps (W101), GPU lease bounds (W303), bounded findings collectors (W503/W605) |

## 2. Rights policy enforcement

- W701: authorization policy per media session (allowed operations:
  analysis, transformation, live delivery, storage, derivatives, sharing);
  fail-closed when a decision is missing; real-user HTTP E2E green.
- W704: liveDelivery rights fail-closed on BOTH sides of the live seam
  (viewer-side canDeliverLive pre-check — denial never sends a request and
  is never retryable; transport.createOffer runs W305's own gate inside) +
  the retryability class table (rights denials land TERMINAL).
- W705: outputs scoping (list/segment routes under render scope; the W504
  LIST-route seam documented and pinned as intended).
- Recorded gap: no user-authentication layer (the W701 boundary — dev-grade
  serve; production auth is a deployment concern outside repo scope).

## 3. Performance

- Measured evidence: `@sporta/latency-benchmark` (W306) — the checked-in
  byte-reproducible fixture run (n=140 batches / n=240 frames,
  nearest-rank percentiles, never-silent accounting: 240 in = 240 emitted
  + 0 across all sinks; the eval-harness live-stream case closes W801's
  documented gap).
- Formalization: `@sporta/slo` (W802) — 16 objectives adopted VERBATIM from
  W306's SLO_CANDIDATES + 4 frame rows by a documented rule; 33-alert
  catalog; degradation policy table; partition invariant; SLOs.md pinned
  row-for-row to code in both directions (drift fails the suite).
- Honest boundary (verbatim from SLOs.md §1): every number lives in the
  injected-virtual clock domain — the pipeline's ALGORITHMIC latency
  structure, not wall-clock or real-network SLOs; the compliance window is
  one benchmark run; the operational gap (no production telemetry
  pipeline) is documented, with W804/W805 named as the future field
  measurement surfaces.
- The roadmap's rule is honored repo-wide: "Any target or latency number
  not backed by benchmark evidence is an aspiration, not an SLO" — no
  aspirational numbers found in the SLO surface (checked: every SLO row
  cites the W306 evidence table or the documented derivation rule).

## 4. Tests

- Baseline battery on main @ 2ef2be9 (pre-W605), personally re-run by the
  TL: 3937 pass / 0 fail / 85,214 expect() calls across 279 files
  (40.9 s); serial per-package typecheck 0 `error TS` across 41 packages;
  lint clean; format clean. Matched the lane's recorded 3937/3937 exactly.
- W605 merge battery (c0ae5a7, personally re-run on the merged tree):
  4056 pass / 0 fail / 88,406 expect() calls across 285 files (46.3 s);
  42 packages, 0 `error TS`; lint + format clean; package double-run
  119/0/3192 identical across separate invocations.
- Cross-subprocess determinism is pinned per package (W603/W604/W704/W802/
  W805/W605 ledger rows — SHA-256 byte-identical suite outputs).
- Final numbers (post-W803): recorded in §8 with the gate-suite verdict.

## 5. Docs

- Per-package normative docs (24 incl. W605): POLICY.md (camera-director),
  THRESHOLDS.md ×2 (renderer-evaluation, scene-evaluation), SLOs.md ×2
  (latency-benchmark, slo), LIVE.md + TELEMETRY.md (viewer-shell),
  PRODUCTION.md + FOUNDATION.md (observability), RENDERER.md (renderer-3d),
  FUNNEL.md (analytics), README per package — each pinned to code by test
  where normative (drift fails the suite, both directions).
- The status ledger + session log form a complete audit trail: every one
  of the 48 completed items carries an evidence row with merge commit,
  test counts, TL verification statement, and honest limitations.
- Recorded gap: no top-level deployment/runbook doc — matching the
  no-deployment reality (nothing is deployed; PRODUCTION.md covers the
  observability side of that future).

## 6. Rollback

- What exists today: (a) render-output encode rollback (W705's
  encoding-renderer: r-\<n\> prediction + rollback on failed stores);
  (b) determinism as the data-level rollback story — the entire program is
  deterministic-by-construction (byte-identical reports, checked-in
  fixtures, no wall clock/randomness anywhere — enforced by per-package
  constitution source scans), so any prior output is reproducible by
  re-running its input; (c) the W802 error-budget machinery + W805 health
  rollup are the seed of future rollback triggers.
- Honest gap (recorded): no system-level deployment rollback story —
  nothing is deployed; a rollback runbook becomes meaningful only with a
  deployment target (the RC3 boundary below).

## 7. Known limitations (aggregated register)

Aggregated from the per-item honest-limitations in the ledger — the
standing boundaries of the delivered system:

- No real-network transport: W305's in-process seams; W704's live
  playback runs over the loopback transport (the adapter/player/backoff/
  plan layers are the code a future bridge would run).
- No real-browser paint E2E (the standing W705/W706 OPEN item).
- No real 3D engine: SVG-only delivery; camera CUTS only (fixed W601
  geometry, no camera motion); linear motion inference (no
  acceleration/turning/physics) — W603/W604.
- Latency numbers live in the injected-virtual clock domain; no production
  telemetry pipeline yet (W306/W802/W804/W805's documented operational
  gap).
- Dev-grade serve/auth boundaries (W701/W705): serve.ts is a dev harness;
  no user auth.
- One segment per render; WebCrypto required (W705).
- Evaluation is manifest/state-level, not pixel-level (W503/W605); the
  visual/pixel gate is W803's human-review composition, not a machine
  vision claim.
- W605's source-truth layer pins per-step snapshot documents captured at
  construction time (the SWM has no history — documented in the package).
- No consent workflow in telemetry (the W804 analytics boundary).
- W605 evaluation-internal: none beyond the above (the six-axis benchmark
  carries its own boundaries in README).

## 8. Release-candidate mapping + final verdict

The roadmap's definitions, honestly mapped:

- **RC0 deterministic offline analysis fixture: DELIVERED** — the
  eval-harness case registry + checked-in fixtures (W801) run
  byte-reproducibly.
- **RC1 offline anime renderer demo: DELIVERED** — W502 render + W503
  temporal evaluation + W705 batch playback through the real encoding
  pipeline.
- **RC2 controlled live streaming prototype: DELIVERED in the controlled
  domain** — the W303→W304→W305 pipeline + W704 live playback over the
  in-process transport, with measured latency structure (W306) and
  formalized SLOs (W802); the real-network boundary is documented.
- **RC3 public beta: NOT DELIVERED** — requires deployment + auth + the
  production telemetry pipeline (the recorded operational gap; out of
  repo scope by design).
- **RC4 production release: this review is the gate.**

**Verdict: ⟨FINAL — recorded with the final battery + gate-suite run at
the post-W803 refresh; the review's position as of main @ 002f39e: the
program is READY as the deterministic offline + controlled-live system
itself defined — fully tested, evidenced, and boundary-honest, with the
RC3 deployment gap recorded rather than papered over.⟩**
