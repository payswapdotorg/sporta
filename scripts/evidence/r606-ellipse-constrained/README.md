# R606 — the ellipse/circle-constrained calibration solve: machine measurement

Session: r606/conic-selection (Lane A — the v0.4.0 conic-selection
increment), 2026-09-28. Base: `6a104aa` (origin/main, the w5h3 TL-audit
merge). Substrate: the committed corpus bytes
(`scripts/evidence/spr-corpus-bytes/`), sha-256-verified byte-exact at
driver startup against `scripts/evidence/spr-wave2-corpus/corpus.json`
(4/4 clips).

## WHAT this measures

`BroadcastLineCalibrator` v0.4.0 (`packages/perception-adapters/src/
calibration/broadcast-line.ts`) — the additive ellipse/circle-constrained
path + the v0.4.0 CONIC-SELECTION FALLBACK CHAIN (opt-in). FOUR paths
measured per window:

- **v0.1.0 line-only** — `new BroadcastLineCalibrator({ ellipseConstrained:
  false })`, the exact v0.1.0 behavior surface;
- **v0.4.0 DEFAULT** — `new BroadcastLineCalibrator()` — the v0.3.0-exact
  single-conic surface (the chain is OPT-IN: see the b3-a visual-gate
  record below);
- **v0.3.0 surface (explicit control)** — `new BroadcastLineCalibrator({
  ellipseMultiConicSelection: false })` — must be IDENTICAL to the default
  (the non-degradation control; aggregate `v040NonDegradationViolations`
  must be 0);
- **v0.4.0 chain (opt-in)** — `new BroadcastLineCalibrator({
  ellipseMultiConicSelection: true })` — the conic-selection chain: the
  RANSAC winner-by-support (the v0.3.0 primary) is tried first; on its
  typed refusal the DISTINCT quota-passing alternatives run (the
  per-component fits of the sub-dominance arc components first — a
  dominance-DROPPED structure is recoverable only there — then the global
  ranked re-fit runners-up), each through the FULL hypothesis →
  refinement → validation flow, the bar never lowered.

Per window: calibrated (confidence, correspondenceCount, the W203-conformant
solved homography, and the fit metrics — lineFit over the full scored set,
backward chamfer, the ellipse residual vs the chain's best-matching conic)
or refused (the typed failure class + the measured numbers + the additive
`conicChain` record — every candidate's measured outcome). Per-frame
single-frame runs for the v0.1.0/default paths ride every window record
(diagnostics). The arc-evidence diagnostics record the full candidate
chain (`conicCandidates`) + the component structure (`arcComponents`).
The synthetic proof (the chain's refusal surface, the candidate-chain
records, the option validation, determinism; the package battery 143
pass / 0 fail, typecheck clean) lives in the package test suite:
`packages/perception-adapters/test/calibration-ellipse.test.ts` (15
tests) + `test/arc-window-fixture.ts` (the shared pinhole fixture).

## WHY

The R606 record's remaining gap: "the minority-orientation family on these
views is ARC SEGMENTS, not straight lines — the next increment is the
ellipse/circle-constrained solve (the center circle IS strongly detected)".
This measurement answers, on REAL committed-corpus bytes (no synthetic
substitution): does the increment calibrate windows the line path refuses?

## COMMANDS (re-runnable; the TL re-runs these at the branch tip)

```bash
# 1. Verify the substrate + run both calibration paths over the windows:
cd packages/perception-adapters
bun run scripts/r606-ellipse-measurement.ts
#    → scripts/evidence/r606-ellipse-constrained/measurement.json
#    → scripts/evidence/r606-ellipse-constrained/frames/<window>.rgb

# 2. Render the overlay PNGs (fitted conic + solved grids + measured labels):
cd scripts/evidence/r606-ellipse-constrained
python3 render_overlays.py            # → overlays/<window>.png

# 3. The synthetic proof + full package battery:
cd packages/perception-adapters
bun test                              # 143 pass / 0 fail
bunx tsc --noEmit                     # clean
```

Windows (6 sampled frames each, stride 20; media times = clip start +
frame/25):

| window | clip | frames | media range (s) |
|---|---|---|---|
| b8p3-c | b8p3.mp4 | 600–700 | 1827.84–1831.84 |
| b8p3-d | b8p3.mp4 | 1040–1140 | 1845.44–1849.44 |
| b8p3-a | b8p3.mp4 | 40–140 | 1805.44–1809.44 |
| b8p3-b | b8p3.mp4 | 220–320 | 1812.64–1816.64 |
| b8p3-e | b8p3.mp4 | 245–345 | 1813.64–1817.64 |
| b8p3-f | b8p3.mp4 | 270–370 | 1814.64–1818.64 |
| b8p3-g | b8p3.mp4 | 295–395 | 1815.64–1819.64 |
| b3-a | clip-b3-fast-action.mp4 | 20–120 | 2046.80–2050.80 |
| b5-a | clip-b5-camera-move.mp4 | 20–120 | 1987.80–1991.80 |
| b5-b | clip-b5-camera-move.mp4 | 120–220 | 1991.80–1995.80 |
| b1-a | clip-b1-wide-broadcast.mp4 | 40–140 | 1805.44–1809.44 |
| b1-b | clip-b1-wide-broadcast.mp4 | 245–345 | 1813.64–1817.64 |

b1 is a byte-exact prefix of b8p3 (`-c copy` cut, corpus.json), so b1-a ≡
b8p3-a and b1-b ≡ b8p3-e are CROSS-CLIP DETERMINISM checks — the driver's
records for those pairs are byte-identical (verified; see measurement.json).

## RESULTS

Aggregate (12 windows): v0.1.0 calibrates 2 / refuses 10; v0.2.0 calibrates
2 / refuses 10; **v0.2.0 calibrates 0 windows that v0.1.0 refuses; v0.2.0
refuses 0 windows that v0.1.0 calibrates** (non-degradation holds
everywhere, including byte-identical confidences on the calibrated pair).

| window | v0.1.0 line-only | v0.2.0 ellipse-constrained |
|---|---|---|
| b8p3-c | CALIBRATED conf 0.832 (lineFit 0.761, backward 2.00 px) | CALIBRATED conf 0.832 — identical result (ellipse path never ran) |
| b8p3-d | CALIBRATED conf 0.988 (lineFit 0.973, backward 0.00 px) | CALIBRATED conf 0.988 — identical result |
| b8p3-a | REFUSED camera-motion | REFUSED camera-motion — identical (the ellipse path never runs) |
| b8p3-b | REFUSED no-consistent-homography | REFUSED ellipse-evidence-insufficient (871 arc px; support 299 ≥ 90 but coverage 10/36 < 12) |
| b8p3-e | REFUSED no-consistent-homography | REFUSED ellipse-no-consistent-homography (quota PASSED: support 100, coverage 16/36; validation NEAR-MISS: lineFit 0.662 ≥ 0.6 ✓ but backward 21.6 px > 10, ellipse residual 13.9 px > 4) |
| b8p3-f | REFUSED no-consistent-homography | REFUSED ellipse-no-consistent-homography (quota PASSED: support 191, coverage 23/36; validation NEAR-MISS: lineFit 0.606 ≥ 0.6 ✓ but backward 17.6 px > 10, ellipse residual 6.3 px > 4) |
| b8p3-g | REFUSED no-consistent-homography | REFUSED ellipse-no-consistent-homography (quota passed: coverage 26/36; validation far: lineFit 0.087) |
| b3-a | REFUSED no-consistent-homography | REFUSED ellipse-evidence-insufficient (1236 arc px; coverage 11/36) |
| b5-a | REFUSED no-consistent-homography | REFUSED ellipse-evidence-insufficient (coverage 8/36) |
| b5-b | REFUSED no-consistent-homography | REFUSED ellipse-evidence-insufficient (570 arc px; coverage 11/36) |
| b1-a | REFUSED camera-motion | REFUSED camera-motion — identical to b8p3-a (cross-clip determinism ✓) |
| b1-b | REFUSED no-consistent-homography | REFUSED ellipse-no-consistent-homography — identical to b8p3-e (cross-clip determinism ✓) |

**Honest headline: on the committed corpus the increment does NOT yet
calibrate real windows.** The synthetic proof stands (the arc-window class
recovers within 1.38 m worst probe error, confidence 0.911, lineFit 0.859 /
backward 0.02 px / ellipse residual 0.64 px, with typed refusals for
occluded / partial / degenerate evidence — `test/calibration-ellipse.test.ts`),
and non-degradation holds on every real window, but the real arc windows
refuse with MEASURED reasons (never a lowered bar):

1. **Quota refusals (5 windows: b8p3-b, b3-a, b5-a, b5-b and the
   camera-motion-free remainder):** the arc evidence's angular coverage is
   8–11 of 36 parametric bins against the 12-bin quota.
2. **Validation near-misses (2 windows: b8p3-e/f):** the lineFit gate
   PASSES (0.662 / 0.606) — the conic-anchored hypotheses are close — but
   the backward chamfer (21.6 / 17.6 px vs ≤ 10) and the ellipse residual
   (13.9 / 6.3 px vs ≤ 4) fail honestly.

### The next measured gap (precise)

The arc-evidence extraction on real frames recovers only ONE FLANK of the
center circle's band. Visual verification of b8p3-f (overlays/b8p3-f.png;
per-cell VLM pass in the session log): the visible white circle arc on the
LEFT of the frame carries NO arc evidence (the near-straight flank is
"explained" away by the arc-chord Hough lines at the 2 px explain radius),
while a single coherent curved segment survives on the right. A single
flank underdetermines the conic — the RANSAC locks onto small sliver
conics (23–58 × 4 px) that graze the surviving segment, and the anchors
built from such slivers start the solve too far off for the refinement
(the measured b8p3-e/f validation residuals above). An explain-radius
experiment (2 px → 1 px) made BOTH the synthetic proof and the real
windows worse (synthetic test failure; real coverage collapse 16/36 →
6/36) — reverted; the measured trade-off is recorded here. The R606
record's "center circle IS strongly detected" was measured on DIFFERENT
windows (media 2074.84/2462.84/3067.84 s — the w6 evidence pack, not in
the committed corpus); the corpus's arc windows show the circle only
partially. The next increment candidates, in measured order: (a) arc
evidence that survives beside near-straight flanks (a straightness-aware
explain step — the chord lines are FAKE lines; the real touchlines they
mimic are the ones that should explain), (b) conic fitting robust to
single-flank evidence (e.g., a flank-constrained fit family), (c)
higher-resolution acquisition (the recorded alternative path).

## KNOWN CLASSES (the failure taxonomy on this substrate)

- `broadcast-line.camera-motion` — panning cameras (both paths identical).
- `broadcast-line.no-consistent-homography` — the v0.1.0 line-path refusal
  (family starvation / validation failure) on the arc windows.
- `broadcast-line.ellipse-evidence-insufficient` — the conic quota (support
  ≥ 90 px AND coverage ≥ 12/36 parametric bins) fails on the real arc
  evidence; measured support/coverage ride every refusal.
- `broadcast-line.ellipse-no-consistent-homography` — the quota passed but
  no conic-anchored hypothesis survived the anti-collapse guards or the
  validation (lineFit ≥ 0.6 / backward ≤ 10 px / ellipse residual ≤ 4 px
  — the same line-path bar plus the ellipse gates); the measured
  lineFit/backward/ellipse residuals ride every refusal.

## ARTIFACTS

- `measurement.json` — the full record (substrate verification, per-window
  both-path outcomes with homographies + metrics, per-frame single-frame
  runs, aggregate).
- `frames/<window>.rgb` — the anchor frames (raw rgb24, 640×360).
- `overlays/<window>.png` — the visual evidence: the anchor frame dimmed,
  the fitted conic (cyan) when a sane conic exists, the v0.1.0 grid (green)
  and v0.2.0 grid (orange) when calibrated, with the measured labels.
- Driver: `packages/perception-adapters/scripts/r606-ellipse-measurement.ts`
  (bun; ffmpeg for extraction only — the solve is pure deterministic
  computation). Overlay renderer: `render_overlays.py` (python + cv2).

---

# v0.3.0 ADDENDUM — the straightness-aware explain (the flank-recovery increment), 2026-09-28

Branch `r606/straightness-explain` (lane A continuation). Base: main @
6a104aa (+ the R607 status-doc correction 59bae7f). The calibrator is now
`broadcast-line-calibrator` **v0.3.0**; the driver's "v0.2.0" labels in
its console output/JSON refer to the ELLIPSE-CONSTRAINED path slot (it
exercises the calibrator default — now v0.3.0).

## The increment

`buildStraightExplainMask`: a Hough line may explain arc-band pixels ONLY
along contiguous along-line stretches whose static support runs ≥
`ELLIPSE_LINE_STRAIGHT_SUPPORT_PX` = 140 px (the exact v0.2.0 distance
predicate in the support test). Measured bounds: the flattest
sliver-flank runs ~110 px (below); real touchlines 200-600 px (above).
The arc-chord "fake" lines (chords through the near-straight circle
flank — the lines the v0.2.0 radius-explain let eat the band) stop
explaining the flank: **the flank's arc evidence survives them.**
`ellipseStraightnessAwareExplain: false` restores the exact v0.2.0
explain surface (tested — both occluded-window tests assert it).

## RESULTS (the 12-window real corpus, sha-verified)

**Headline (honest, 2026-09-28 — the v0.4.0 conic-selection increment):**

- **The DEFAULT surface stays v0.3.0-exact** (the chain is opt-in): 2/12
  calibrated, byte-identical to the recorded v0.3.0 confidences
  (b8p3-c 0.832, b8p3-d 0.988); `v040NonDegradationViolations: 0`;
  the quota-refusal classes identical (b8p3-e/g, b3-a, b1-b stay
  `ellipse-evidence-insufficient`).
- **The OPT-IN chain machine-recovers ONE window**: b3-a (a behind-goal
  view) calibrates at conf 0.831 / lineFit 0.731 / backward ≤ 10 /
  ellipse residual ≤ 4 — **BUT THE VLM VISUAL GATE FAILS IT**: the
  projected grid misaligns on all three sharp checks (goal line, penalty
  box, center circle placement), and the winning conic (574.3, 79.0,
  semi 20.3) sits on the GOAL/NET STRUCTURE, not a pitch circle (the
  frame's only visible arc is the penalty arc, mid-left; the center
  circle is out of view). The claim is WITHHELD — the same doctrine as
  the w5h2 Tier-1 attempt: machine metrics met, visual gate failed, the
  honest record kept. **This is why the chain ships opt-in (default
  false)** — the machine bar has a measured blind spot on behind-goal
  views: the static net satisfies the backward chamfer and the displaced
  grid's parallel line family satisfies lineFit (the "line-on-line"
  class); the conic anchor itself is the only cue, and nothing in the
  machine gates discriminates a goal-structure conic from a pitch circle.
- The remaining refusing windows (b8p3-b/f, b5-a/b) now carry the
  additive `conicChain` record — every quota-passing candidate's measured
  outcome (lineFit, backward, ellipse residual) — the honest per-conic
  evidence for the next increment. The 12-window candidate diagnostics
  (`conicCandidates`, `arcComponents`) are in the per-window
  `ellipseEvidence` records.

| window | v0.3.0 surface (default) | v0.4.0 chain (opt-in) |
|---|---|---|
| b8p3-c | CALIBRATED conf 0.832 | CALIBRATED conf 0.832 (the primary — byte-identical, the chain never fires) |
| b8p3-d | CALIBRATED conf 0.988 | CALIBRATED conf 0.988 (the primary — byte-identical) |
| b8p3-a / b1-a | camera-motion | camera-motion (the chain never runs) |
| b8p3-b | noCH (em 19.6 on the hoarding-curve primary) | noCH — the chain tried 4 candidates (the primary + 3 distinct alternatives; none passes validation; the per-candidate outcomes recorded) |
| b8p3-e / b8p3-g / b1-b | `ellipse-evidence-insufficient` (the primary) | noCH — the chain's quota-passing alternatives (the sub-dominance components) reach the solve and refuse at validation (the class shift is the honest "SOME conic is well-evidenced" semantics) |
| b8p3-f | noCH (em 1.42 on the background-curve primary) | noCH — 4 candidates tried, incl. one at lineFit 0.73 (em 28.1); the honest per-candidate record |
| b3-a | `ellipse-evidence-insufficient` | **CALIBRATED conf 0.831 lineFit 0.731 — VLM VISUAL GATE FAIL (the goal-structure conic class; claim withheld, the chain stays opt-in)** |
| b5-a | noCH (em 4.86) | noCH — 4 candidates (em 4.9/31.6/160.6/44.3; the b8p3-f-class circle candidate not evidenced) |
| b5-b | noCH (em 46.7 — the degenerate anchor set) | noCH — 4 candidates (the degenerate primary + 3 alternatives, all refused with measured outcomes) |

VLM overlay checks (2026-09-28): b3-a's chain-calibrated grid MISALIGNS
(sharp checks: the goal line, the penalty box, the center-circle
placement — all displaced; the winning conic on the goal structure);
b8p3-c/d (the long-calibrated windows) unchanged. The overlays draw the
candidate chain (cyan primary / magenta alternatives / yellow winner)
and the chain's grid in red — the visual record of the withheld claim.

## Tests (the battery)

- `calibration-ellipse.test.ts` **11/11** (the v0.4.0 test: the line-only
  refusal, the DEFAULT (= v0.3.0-exact) refusal, the OPT-IN chain's
  per-candidate record with the circle candidate's ellipse gates PASSING
  (em ≤ 4, backward ≤ 10) where the primary's fail — the conic-selection
  mechanism proven; the fixture's synthetic curve mass blocks the
  lineFit bar (the honest synthetic boundary, documented in the test);
  the option validation + determinism + the diagnostics' chain record).
  The two v0.2.0-surface reproduction tests now pass BOTH post-v0.2.0
  options off (straightness + multi-conic) — each increment's surface is
  reproducible via its own option.
- Full package battery **139/139 pass**, tsc clean.
- Determinism: the deep-equal diagnostics test + the driver re-run
  reproduce every value exactly.

## The NEXT measured gap (precise)

1. **The validation-gate hardening (the b3-a class)**: the machine bar's
   line-on-line blind spot on behind-goal views — the static net
   satisfies the backward chamfer and a displaced parallel line family
   satisfies lineFit. The conic anchor is the only cue: a
   pitch-line-vs-structure discrimination is needed (candidates: the
   winning conic's support must lie on GREEN-UNION-INTERIOR pixels —
   the goal structure stands in front of far grass so greenTop alone
   does not discriminate; a goal-line/corner consistency check on the
   solved grid; a penalty-arc-conic prior for behind-goal views). Until
   it lands, the chain stays opt-in.
2. The b8p3-b/f anchor-conversion classes (the chain's circle candidates
   not evidenced or failing the line gates) — the mixed DLT/pole-polar
   machinery increments, now with the per-candidate measured records to
   design against.

Incident (honest): one intermediate exact-predicate marking variant was
measured (synthetic probe 2.6166 m > the 2.5 m bar; real-window outcomes
identical) and reverted to the rounded band — recorded in the
buildStraightExplainMask comment. The 2026-09-28 session's fixture
engineering (the hoarding-curve synthetic) is recorded in the test's
fixture comments: the 150°-arc partial-coverage fit is ill-conditioned
(measured: the component RANSAC fits semi 64 vs the true 100), so the
fixture proves the chain at the conic level; the full synthetic recovery
stays bounded by the fixture's lineFit noise floor — the real corpus
carries the machine-recovery evidence (b3-a) and the visual-gate record.

---

# v0.4.1 ADDENDUM — the validation-gate hardening (the b3-a class), 2026-09-29

Branch `r606/validation-gate-hardening` (lane A continuation #3). Base:
main @ 39863ff (the w5g TL-audit merge). The calibrator is now
`broadcast-line-calibrator` **v0.4.1** — a behavior-surface change on the
OPT-IN CHAIN ONLY: **the DEFAULT (chain off) stays v0.3.0-exact
byte-identical** (verified below; the hardening gates fire exclusively
when `ellipseMultiConicSelection` is on).

## The increment (two additive, chain-only discrimination gates)

The measured defect (the v0.4.0 withheld claim): the b3-a chain solve was
a **POINT-COLLAPSE** — all four pitch corners projected to image
(575, 98), quad area / conic area = 0.0004 — that degenerately collected
every machine reward (lineFit: the whole image maps onto a model-line
cluster; backward: the pitch maps onto one static-mask point on the net;
ellipse residual: the world circle maps onto a single point ON the
conic). The winning conic (574.3, 79.0) anchors to the goal/net
STRUCTURE. Two gates close the class:

1. **The conic grass-support gate**
   (`broadcast-line.ellipse-conic-off-pitch`, module docs E2c): BEFORE a
   quota-passing chain candidate's solve, the MEDIAN over frames of the
   per-frame green fraction over a fixed 41×41 parametric interior grid
   must be ≥ `ELLIPSE_CONIC_MIN_INTERIOR_GREEN_MEDIAN` = 0.2. A pitch
   circle is a thin painted band ON grass — its interior reads green in
   every frame; static structure does not. Measured bounds (verified at
   this branch): the b3-a quota-passing conics 0.073 / 0.000 / 0.012 (and
   the coverage-failing fourth candidate 0.049 — the window's ENTIRE
   candidate set is structure); the other corpus structure conics
   0.011–0.175; the solve-reaching windows' grass-backed primary conics
   0.27–0.79 (b8p3-c 0.786 / b8p3-d 0.295 / b8p3-e 0.272 / b5-a 0.703);
   the synthetic fixture's true circle 0.90. The ANY-frame green UNION is
   NOT the discriminating statistic (measured inside the b3-a winner: the
   union lifts to 0.164 vs the 0.073 median; the per-frame values span
   0.000–0.590 and the LAST frame reads ABOVE the threshold — an
   ANY-frame/single-frame gate PASSES the structure; the MEDIAN refuses
   it: static structure is never green, moving occluders — players —
   clear it). A refused candidate is SKIPPED (the chain continues); its
   typed refusal is recorded as the chain entry.
2. **The projected-grid geometry gate**
   (`broadcast-line.ellipse-degenerate-grid`, module docs E6b): a solve
   that passed every machine gate must still project the pitch as a REAL
   quad — the four canonical pitch corners through H⁻¹ finite, within the
   20×-frame degeneracy bound, pairwise distinct beyond 4 px, and the
   shoelace quad area ≥ 0.5 × the winning conic's ellipse area (the
   CONTAINMENT INVARIANT: the pitch rectangle's image CONTAINS the
   circle's image under any non-degenerate projective map — zero false
   positives for real cameras by construction; measured: the healthy
   synthetic chain solve at quad/conic = 41.1, the frozen b3-a solve at
   0.0004). The new `evaluateBroadcastEllipseGridGeometry` diagnostic
   export + the frozen-record test regression-lock the class.

## RESULTS (the 12-window real corpus, sha-verified; driver re-run ×2
deep-equal modulo durationMs)

Aggregate: `v010Calibrated` 2 · `v030Calibrated` 2 ·
`v040NonDegradationViolations` **0** · `v040ChainOptInCalibrated` **2**
(previously 3) · `v040ChainOptInNewlyCalibratedWhereV030Refused` **0**.

- **The DEFAULT surface is byte-identical**: every v0.1.0 / default /
  v0.3.0-control window record (and every per-frame diagnostic) deep-equals
  the committed v0.4.0 measurement.json modulo durationMs; the calibrated
  pair unchanged (b8p3-c 0.832, b8p3-d 0.988 — byte-identical ON THE CHAIN
  too: healthy solves pass both hardening gates).
- **b3-a REFUSED at the machine bar** — `broadcast-line.ellipse-conic-off-pitch`:
  ALL THREE quota-passing candidates measure interior-green medians 0.073
  / 0.000 / 0.012 over full in-bounds grids (1257/1253/1257 samples) —
  the goal/net-structure class — so the chain refuses every candidate
  PRE-SOLVE and rethrows the typed refusal with the additive per-candidate
  `conicChain` record. The v0.4.0 machine-recovery (conf 0.831, lineFit
  0.731, VLM-refuted) is now an honest typed refusal AT THE MACHINE BAR —
  not a withheld claim riding the opt-in surface. VLM verification of the
  refusal (overlays/b3-a.png, 2026-09-29, verbatim): "(1) The CYAN ellipse
  sits on the **goal/net structure** (specifically, the white goal frame
  and the netting behind it). (2) The interior of the CYAN ellipse is
  **predominantly non-green structure** (it contains the white goal frame,
  the dark netting, and the crowd/stands visible through the net). (3)
  **No**, a white painted circle-on-grass is not clearly or fully visible
  in the frame; only fragments of other pitch lines are present." — the
  machine refusal MATCHES the visual truth.
- **The chain's calibrated set collapses to the default's** (3/12 → 2/12;
  the lost calibration is exactly the visually-refuted b3-a — the honest
  outcome; no calibration the default achieves was lost).
- Three other windows' chain REFUSALS moved earlier with the typed class
  (b8p3-b: first quota-passer green 0.175 — the hoarding-curve primary;
  b8p3-g: 0.093; b5-b: 0.011): in v0.4.0 those first candidates' solves
  already failed validation (b8p3-b primary lineFit 0.596 / em 156.95;
  b8p3-g and b5-b same class), so no honest solve was lost — the refusal
  is now typed and pre-solve. b8p3-e and b5-a unchanged (their first
  quota-passers are grass-backed; their solves still refuse at validation
  with the measured numbers).

## Tests

`calibration-ellipse.test.ts` **15/15** — four new v0.4.1 tests: (a) the
healthy chain calibration is byte-identical with the hardening on
(chain-on plain window deep-equals chain-off); (b) the b3-a class — the
new `netStructure` fixture (a static filled white disk ON the grass,
≥ 10 m from every marking, the center circle omitted = the real window's
out-of-view fact; its rim band is a quota-passing conic) — refuses with
the typed grass class pre-solve (measured median ~0.02 over ≥ 50
in-bounds samples vs 0.90 for the plain fixture's real circle) while the
DEFAULT surface refuses the same fixture with the v0.3.0 quota class;
(c) the frozen-b3a-record degenerate-grid gate (the committed v0.4.0
measurement's homography + winning conic at full recorded precision:
quad/conic 0.0004, corner separation < 1 px, vs the healthy fixture's
quad/conic > 10× and separation > 100 px; fail-loud RangeErrors; the
pure-export determinism); (d) the failure-taxonomy additivity (the two
new typed classes present exactly once; every prior class intact). Full
package battery **143/143** (baseline 139 + 4), tsc clean (workspace-wide),
real-to-swm 38/38 (the calibration seam safe).

## The NEXT measured gap (precise)

b3-a's ENTIRE conic candidate set is structure-anchored — the quota-
passing candidates measure green medians 0.073/0.000/0.012 and even the
coverage-failing fourth candidate (a 388×34 px sliver, support 1359,
coverage 10) measures 0.049 — so NO grass-backed conic is evidenced
anywhere in the window (the center circle is out of view; the visible
penalty arc yields no quota-passing candidate). The hardening therefore
cannot be followed by a b3-a recovery without first EVIDENCING a
grass-backed conic on behind-goal views: the penalty-arc-conic prior (the
fixed-geometry, grass-backed family) or the b8p3-b/f anchor-conversion
increments (whose per-candidate measured records the chain now carries).

---

# ADDENDUM — v0.5.0 (E4b): the anchor-conversion delivery, Worker 61-b

Session: r606/anchor-conversion (Worker 61-b), 2026-09-29/30. Base: `8d45a75`
(the E4b WIP checkpoint on `r606/anchor-conversion`, on top of `6b4560e`).
Substrate: unchanged (the committed corpus bytes, sha-256-verified 4/4 at
driver startup — the same frozen contract). The driver is now SIX-path
(`measurement.json` schemaVersion 1.1): the four pre-existing paths are
byte-identical to the committed v0.4.1 record (verified below), the two new
paths are the v0.5.0 OPT-IN anchor conversion — (e) on the default
single-conic surface (`ellipseAnchorConversion: true`) and (f) stacked on
the conic-selection chain (`ellipseAnchorConversion: true,
ellipseMultiConicSelection: true`).

## WHAT v0.5.0 is (module docs E4b)

The J-ORTHOGONAL EXACT CLOSURE of the ellipse path's scan solves: the image
conic (in NORMALIZED image coordinates — the machinery's homographies map
normalized coords → pitch, NOT px) and the world circle canonicalize to the
Lorentz form J = diag(1, 1, −1) (G with GᵀJG = qCanon, W with WᵀJW = C_w,
via the Jacobi eigendecomposition with the odd-sign eigenvalue arranged
last), so the homography factors as H = W⁻¹·P·G with P J-orthogonal — the
conic correspondence is then P's DEFINING property, exact for every P. The
same enumeration driver as E4 runs with the NEAR-LINE POLE ROW added, and
EVERY enumerated mixed-DLT scan solve H_t becomes M₀ = W·H_t·G⁻¹ and is
projected onto the J-orthogonal class (the fast path N ≈ μ·J ⟹ M₀/√μ, else
the eigendecomposition path) under the admissibility bound, the closure
self-check, the birth conic guard and the conic hard guard. The converted
candidates run the anti-collapse guards + the combined-objective finalist
selection WITHOUT the refinement (the closure IS the solve), then the
UNCHANGED validation bar — when the conic-exact solve contradicts the line
evidence the bar refuses honestly (the anchors-fight outcome).

## THE 61-b RECALIBRATION (an honest deviation, measured before anything else)

The inherited `ELLIPSE_ANCHOR_ADMISSIBILITY_BOUND = 1e-2` — whose doc claimed
a ≈ 0.6% / 2.3% / 2.7% synthetic/b8p3-b/corpus-wide selectivity measured at
the PRIOR era's pre-convention-fix tree — sat BELOW the fitted-conic noise
floor of this tree's coordinate-convention-correct machinery. Measured
first, on the adopted WIP:

- the TRUE fixture homography itself deviates **0.0262** against the plain
  fixture's FITTED conic (the single-shot closure refuses it
  `admissibility-bound` — the fit error of a 2–3 px painted band on a
  101×19.6 px ellipse IS the floor);
- at 1e-2, NOTHING converted anywhere: every enumerated scan solve on every
  measured window (synthetic plain/offsetCircle, real b8p3-b) exceeded the
  bound — min observed deviation 1.47e-2 (synthetic) / 1.98e-2 (real) — so
  every conversion-path window refused
  `broadcast-line.ellipse-anchor-unconvertible` with the full-scan record
  (30240/0) and the documented anchors-fight outcome class was UNREACHABLE;
- the fresh deviation distribution over the 30,240 enumerated solves per
  candidate is cleanly BIMODAL: a right-model/right-scan-parameter cluster
  in **[0.015, 0.1)** (the conic-fit noise floor: 8 solves on the synthetic
  plain fixture, 12 on offsetCircle, 14 on b8p3-b), a thin wrong-scan-
  parameter drift in [0.1, 0.3), and the wrong-model mass at [0.3, ∞)
  (median ≈ 1.9).

The bound is recalibrated to **0.1** — the measured edge of the
near-consistent cluster: the documented intent (admit near-conic-consistent;
exclude wrong-model AND wrong-scan-parameter) now holds on this tree's own
numbers. The full record rides the constant's doc comment in
`broadcast-line.ts`. Everything below is measured at the recalibrated bound.

## RESULTS (the 12-window real corpus, sha-verified; driver re-run ×2
deep-equal modulo durationMs — PASS)

Aggregate: `v050AnchorConversionCalibrated` **2** (b8p3-c conf 0.832 /
b8p3-d conf 0.988 — byte-identical to every pre-existing path: the line
path calibrates those windows first, the ellipse path never runs) ·
`v050AnchorConversionNewlyCalibratedWhereV030Refused` **0** ·
`v050AnchorConversionNonDegradationViolations` **0**; the chain-stacked
variant identical (2 / 0 / 0). Every pre-existing path's record — and every
per-frame diagnostic — deep-equals the committed v0.4.1 measurement.json
(the byte-compatibility gate of the driver extension).

**The honest headline, matching the prior era's own claim: 0/12 windows
newly calibrate under the opt-in conversion.** The mechanism and its
per-candidate records are the delivery; the recovery claim is NOT made.

The anchors-fight on real evidence — every window whose conversion scan ran
(path e) refuses at the UNCHANGED validation bar with MACHINE-EPSILON
conic-exact residuals riding the refusal:

| window | anchor record (scan/conv) | lineFit (< 0.60) | backward (> 10 px) | ellipse residual |
|---|---|---|---|---|
| b8p3-b | 30240 / 14 | 0.139 | 13.12 px | 7.96e-14 px |
| b8p3-f | 30240 / 42 | 0.185 | 20.22 px | 1.30e-12 px |
| b5-a | 30240 / 6 | 0.414 | 19.08 px | 3.09e-12 px |
| b5-b | 27720 / 19 | 0.177 | 17.12 px | 9.49e-13 px |

(the closure makes the conic/line inconsistency EXPLICIT — the same windows'
v0.4.x compromise solves scored lineFit 0.596–0.662 with ellipse residuals
6–157 px; the conic-exact closures land at lineFit 0.14–0.41 with BOTH gates
failing, nothing laundered. b8p3-e/g, b3-a, b1-b refuse at
`ellipse-evidence-insufficient` on path (e) — the single-conic quota never
passed, the conversion never ran; b8p3-a/b1-a refuse `camera-motion`
identically on every path.)

On the chain-stacked path (f) the chain candidates that pass the grass gate
run the same closure: b8p3-e 30240/6 refusing at lineFit 0.142 / backward
11.10 / ellipseMean 1.33e-13, b1-b identical (the cross-clip determinism
check b1-b ≡ b8p3-e holds byte-exact), b8p3-f and b5-a identical to path
(e) (their first quota-passer IS the primary). The typed
`broadcast-line.ellipse-anchor-unconvertible` refusal fires **0 times as a
window outcome** and **exactly once as a chain candidate** (b8p3-b's
conv+chain chain[1]: 20160/0 — a hoarding-adjacent candidate whose whole
scan exceeded the bound; recorded, not laundered).

Corpus-wide E4b anchor records (summed over every conicChain entry that ran
the conversion scan): path (e) **118,440** scan solves enumerated / **81**
converted (0.068%); path (f) **440,987** / **147** (0.033%); combined
**559,427 / 228** (0.041%).

## Tests

`calibration-ellipse.test.ts` **25/25** (15 prior + **10 new** v0.5.0 tests):
(a–c) the unit contracts of the returned helpers — `invert3x3` (both-side
identity composition, singular/non-finite refusal), `poleOfLine` (the
polar-of-the-pole round trip + the analytic Lorentz pole + singular
refusal), `jacobiEigenSym3` (A·v = λ·v per eigenpair, V orthogonal, the
exact {2−√2, 2, 2+√2} spectrum, determinism); (d) the ground-truth conic
canonicalization — Q_px = S⁻ᵀ(H_GTᵀC_wH_GT)S⁻¹ constructed from the pinhole
truth, GᵀJG = Q̂ re-derived independently in the test (1.3e-15), W·W⁻¹ = I,
the sign twin −Q_px canonicalizing bit-identically AND converting, the
IMAGINARY class refusing, and the px-vs-normalized coordinate-convention
trap pinned by the construction itself; (e) the fixed point (the closure of
the true H against the ground-truth conic is H EXACTLY, fast path) + the
perturbed-H₀ conic-exact closure (eigendecomposition path, world-circle
round-trip residual 4.6e-27 m² < 1e-6) + the bound's refusing leg (a
direction-changing scale error stays unconverted); (f–g) the anchors-fight
pipeline records — the plain fixture (30240/8, lineFit 0.467 < 0.60,
ellipseMean 5.56e-13 px, the conic-exact refusal where the default surface's
compromise calibrates at conf 0.921) and the offsetCircle fixture (30240/12,
lineFit 0.340 / backward 11.37 — both gates); (h) the option/export
validation (RangeError on every malformed config); (i) the refusal-record
determinism (two runs deep-equal on both fixtures); (j) the taxonomy
additivity (the new class once, every prior class intact, no duplicates).
Full package battery **153/153**, tsc clean, real-to-swm 38/38, eslint 0
errors on the three touched files.

## DEVIATIONS from the prior era's recorded orientation (honest, measured)

- **The admissibility-bound recalibration** (the record above): the prior
  era's 1e-2 admitted ≈ 2.7% corpus-wide under its pre-convention-fix
  deviation distribution; the corrected machinery's distribution is
  fundamentally different and 1e-2 admitted NOTHING (not even the true
  homography). The fresh selectivity at 0.1 is 0.041% combined.
- **Per-candidate anchor records**: prior era b8p3-b 21451/488, b8p3-f
  21088/133, b5-a 21121/257, b5-b 19184/74; fresh 30240/14, 30240/42,
  30240/6, 27720/19. The enumeration counts differ (the prior tree's
  solve-success profile differed — the adopted tree's enumeration is
  family-cap saturated at 30240 on most windows, 27720 on b5-b with fewer
  detected lines), and the converted counts sit in the measured
  near-consistent cluster only.
- **Corpus-wide totals**: prior ≈ 565,629 / 15,202 (2.7%); fresh combined
  559,427 / 228 (0.041%) — the enumeration volume reproduces to within
  ~1%, the conversion volume does not (the bound + distribution record).
- **The typed unconvertible refusal**: prior era 0 firings on real
  evidence; fresh: 0 window outcomes, 1 chain candidate (b8p3-b chain[1],
  20160/0).
- **The synthetic anchors-fight numbers**: prior era plain 21033/131 with
  backward > 10; fresh plain 30240/8 refusing on lineFit 0.467 (backward
  4.79 — the lineFit gate is the refusing one on this tree). offsetCircle:
  prior 20857/73, lineFit ≈ 0.459, backward ≈ 21.2; fresh 30240/12,
  lineFit 0.340, backward 11.37 (both gates, same class).
- **The conic-exact residuals**: prior orientation ~3e-4..1e-2 px; fresh
  ~1e-13 px (machine epsilon) on every measured refusal.
- The prior era's HEADLINE claims reproduce exactly: 0/12 newly calibrating
  under the opt-in conversion; 2/12 on every pre-existing path (b8p3-c
  conf 0.832 / b8p3-d conf 0.988, byte-identical); non-degradation
  violations 0 on every path.

## The NEXT measured gap (precise)

The anchors-fight refusals carry lineFit 0.139–0.414 on the four
solve-reaching real windows — the conic-exact closures contradict the line
evidence HARD (the fitted conic's own noise floor sits ~0.015–0.1 in N
deviation while the line rows want the compromise). Any future recovery
claim needs the two evidence legs to AGREE: either the conic fit tightens
(sub-pixel conic refinement before the closure) or the line-evidence
weighting inside the anchor rows is re-examined — a TL decision, recorded
here rather than laundered. The E4b mechanism itself is delivered and
measured: exact, deterministic, guarded, and honestly refusing.

---

# ADDENDUM — v0.6.0 (E2d) + flight 4: the penalty-arc-conic prior and the world-circle class closure, Worker 62-b

Session: r606/penalty-arc-prior (Worker 62-b, flight 4), 2026-10-03. Base:
`d22d4e8` (the leg-B gate checkpoint on `r606/penalty-arc-prior`, on top
of `c284d7c` — flight 3's v0.6.0 implementation). Substrate: unchanged
(the committed corpus bytes, sha-256-verified 4/4 at driver startup — the
same frozen contract). The driver is now SEVEN-path (measurement.json
schemaVersion 1.2): the six pre-existing paths are field-by-field
byte-identical to the committed v0.5.0 record (verified below), the new
path (g) is the v0.6.0 OPT-IN penalty-arc-conic prior stacked on the
conic-selection chain (`v060PriorPath`: ellipseConstrained +
ellipseMultiConicSelection + penaltyArcPrior all on).

## WHAT v0.6.0 is (module docs E2d)

The FIXED-GEOMETRY candidate family for behind-goal views (OPT-IN
`penaltyArcPrior`, default false): the prior SUPPLIES (image conic, FIXED
world circle) pairs — the world side is the penalty arc's circle from the
canonical pitch-model constants (spots 11/94, cy 34, r 9.15, the painted
clip at 16.5/88.5; BOTH ends enumerated), the image side comes from the
SAME arc-evidence fit machinery the chain uses, gated by the penalty-arc
FAMILY quota (support ≥ 90 px UNCHANGED + coverage ≥ 10 bins — the floor
of the painted "D" arc's own ~106.10° span, derived from the fixed
geometry). Prior candidates run AFTER every evidence-derived candidate,
each through the FULL hypothesis → refinement → validation flow with the
bar never lowered, PLUS the prior family's own gates: the E2c grass gate,
the E6b degenerate-grid gate, the geometric quad-containment gate
(`broadcast-line.ellipse-prior-quad-containment`), and flight 4's
WORLD-CIRCLE / HORIZON gate (`broadcast-line.ellipse-prior-world-circle`).
Prior provenance (`prior: "penalty-arc"` + `priorEnd`) rides every chain
entry and refusal record. Option-off ⇒ the v0.5.0 surface byte-identical.

## THE CLASS CLOSURE (flight 4's headline — flight 3's honest finding, closed)

Flight 3 recorded (c284d7c, the pre-gate tree): the synthetic
occluded-circle fixture CALIBRATED on the prior path at machine-passing
gates (lineFit 0.666 / backward 9.65 px / ellipse residual 0.755 px /
conf 0.636) with a worst probe error of **116.5 m** over the 6
PROBE_PITCH_POINTS (per-probe 21.9/48.1/19.4/116.5/19.6/56.2 m) — a
convex, containment-passing, GLOBALLY-WRONG solve class the then-current
gates did NOT close. Flight 4 reproduced that solve exactly at c284d7c
(measured in a side worktree: worst probe 116.51661751121266 m; the
frozen homography + the calibrated prior candidate's geometry are pinned
in the test) and closed the class with the world-circle/horizon gate: at
this tree the SAME fixture refuses — the prior candidate (the RIGHT
family paired with an arc-crumb sliver conic) passes every machine gate
at the flight-3 numbers (lineFit 0.6657 / backward 9.6508 / residual
0.7547) and is refused by the world-circle leg at a measured world-side
worst error **8.2279 m > 1.0 m** (the calibration's OWN SCORE_RADIUS_M)
over 180 full-ellipse probes (mean 1.9792 m; the horizon leg alone
passes on this solve — both legs ride the record). The pure export
`evaluateBroadcastPriorWorldCircle` regression-locks the frozen pre-gate
solve: worst 8.2279 m (right family) / 73.364 m (left family), while the
one-directional quad-containment gate PASSES it (ok=true, convex) — the
measured record of exactly which gap the world-circle leg closes. The
quad-containment gate itself is pinned live on two fixtures (a
machine-passing solve at lineFit 0.8371 / backward 7.30 / residual 1.14
refused on a non-convex quad with the conic center 12.4 px outside; a
chain-level refusal at lineFit 0.6135), and the grass gate's
non-re-entry on prior candidates at measured interior-green medians
0.000–0.073. VERDICT: **CLOSED at the machine bar** — typed class, gate,
frozen-record regression lock, and battery.

## RESULTS (the 12-window real corpus, sha-verified; driver re-run ×2
deep-equal modulo durationMs)

Aggregate (additive keys): `v060PriorPathCalibrated` **2** (b8p3-c conf
0.832 / b8p3-d conf 0.988 — byte-identical to every pre-existing path:
the line path calibrates those windows first, the prior never runs) ·
`v060PriorPathNewlyCalibratedWhereV030Refused` **0** ·
`v060PriorPathNonDegradationViolations` **0** ·
`v060PriorPathSeededCandidates` **64** (8 windows × 8 candidates: 4
conics × 2 ends) · grass-refused prior candidates **30** ·
world-circle / quad-containment / unevidenced window firings **0 / 0 /
0**. The six pre-existing paths: every per-window record (12 windows ×
13 keys) and every per-frame diagnostic field-by-field EQUAL to the
committed v0.5.0 measurement.json; all 29 committed aggregate keys
equal; the two driver runs byte-identical modulo durationMs (206,312
chars of sorted JSON deep-compared).

**The honest headline: on the committed corpus the prior path newly
calibrates 0/12 windows** — the supply is real (64 prior-seeded
candidates over the 8 windows that reached the ellipse path, family
best support 428–1316 px / coverage 10–34 bins recorded per window) but
every one of them refuses honestly at the machine bar:

| window | v0.6.0 prior (opt-in) | prior-seeded candidates' outcomes |
|---|---|---|
| b8p3-c / b8p3-d | CALIBRATED conf 0.832 / 0.988 (the line path first — the prior never ran; byte-identical) | — |
| b8p3-a / b1-a | camera-motion (identical on every path) | — |
| b8p3-b | REFUSED ellipse-conic-off-pitch | 8 seeded (best 1052 px/34 bins): 4 grass-refused, 4 validation (lineFit ≤ 0.60) |
| b8p3-e / b1-b | REFUSED ellipse-no-consistent-homography | 8 seeded (best 587/32): 6 validation (lineFit 0.11–0.28), 2 grass (0.112) — cross-clip determinism b1-b ≡ b8p3-e byte-exact |
| b8p3-f | REFUSED ellipse-no-consistent-homography | 8 seeded (best 750/21): 4 validation, 4 grass |
| b8p3-g | REFUSED ellipse-conic-off-pitch | 8 seeded (best 428/32): 2 grass, 6 validation |
| b3-a | REFUSED ellipse-conic-off-pitch | 8 seeded (best 1316/10): **ALL 8 grass-refused** (interior-green medians 0.000–0.073 — the goal/net-structure class; the behind-goal target window behaves exactly as designed) |
| b5-a | REFUSED ellipse-no-consistent-homography | 8 seeded (best 678/19): 6 validation, 2 grass |
| b5-b | REFUSED ellipse-conic-off-pitch | 8 seeded (best 663/19): 6 grass, 2 validation |

No real-window prior candidate reached a machine-passing solve (0
world-circle / 0 quad-containment firings — the 116.5 m class is
synthetic; on real evidence the prior's candidates die earlier, at the
grass gate or validation).

## VLM overlay checks (2026-10-03; overlays/b3-a.png, overlays/b8p3-e.png,
overlays/b8p3-c.png — the white prior-seeded conics + the labels)

- **b3-a** (the prior's target window): "The frame shows a **behind-the-goal
  camera view** … the large flat ellipse's interior is mostly non-green
  content (scoreboard/graphics, stands/crowd); the small top-right
  ellipses' interiors are mostly non-green (text/logos, stadium
  structure)" — the machine's grass-gate refusals (medians 0.000–0.073)
  MATCH the visual truth. The one thin bottom-right sliver reads
  "mostly green" in the single anchor frame — the documented
  single-frame-vs-median case (the gate's median over the window's
  frames is 0.012: the region is not durably grass; the v0.4.1 record
  established the ANY-frame green union does not discriminate).
- **b8p3-e**: "a white painted pitch arc is visible … the penalty 'D' arc
  on the right side of the frame" — but "the WHITE ellipses do NOT align
  with the visible painted arc … positioned over open pitch space" —
  the machine record matches: the prior's seeded conics sit away from
  the visible arc and refuse at validation (lineFit 0.11–0.28) / grass
  (0.112). No claim made; the refusal is visually honest.
- **b8p3-c** (the long-calibrated pair, unchanged): "the GREEN and ORANGE
  projected grids align with each other and the visible white pitch
  lines … the CYAN ellipse sits ON a visible white painted arc … no
  obvious misalignments" — the non-degradation is visually confirmed.

## Tests

`calibration-ellipse.test.ts` **35/35** (25 prior + **10 new** v0.6.0
tests): (a) option validation fail-loud + the default proven OFF
behaviorally (the discriminating fixture's default chain carries no
prior entries; prior-on gains 8); (b) identity — explicit `false`
byte-identical to the default on plain/occluded/netStructure fixtures
(full-result JSON), the diagnostics surface identical, and the option
never fires outside the ellipse path (line-only ≡ v0.1.0); (c) the
healthy window never reaches the prior (prior-on ≡ default, conf 0.921
byte-identical, while the diagnostics prove the prior WOULD seed); (d)
quota/provenance — the below-family-quota fixture (touchlines + 40°
arcs) refuses `ellipse-penalty-arc-prior-unevidenced` (prior seeded 0,
851 arc px) with the full-paint control seeding 2 at support 186/32
(the painted "D" passes its own family quota); (e) the grass
non-re-entry (netStructure: 8 prior-seeded, 2 grass-refused at median
0.0231 over 1257 samples, provenance riding); (f) the quad-containment
gate live at both levels (chain: lineFit 0.6135 machine-passing; window:
lineFit 0.8371 / backward 7.30 / residual 1.14 machine-passing, quad
non-convex, conic center −12.4 px outside); (g) determinism — two
prior-path runs serialize byte-identically on every fixture class; (h)
LEG B closure — the occluded-circle fixture refuses with the typed
world-circle class (worst 8.2279 m > 1.0 bar, 180 samples, mean 1.9792,
horizon consistent — the world-probe leg is the refusing one; the
refused solve's machine numbers pinned); (i) the frozen pre-gate
regression lock via the pure exports (8.2279 right / 73.364 left /
quad-containment ok=true on the frozen 116.5 m solve) + the exports'
fail-loud input contracts; (j) taxonomy additivity (the three new
classes exactly once, retryable false). Full package battery **163/163**
(153 baseline + 10), tsc clean, eslint 0 errors, prettier clean on every
touched file.

## The NEXT measured gap (precise)

On all 8 prior-reachable real windows the family quota's quota-passing
image-side sources are structure/crumb conics — 30 of 64 prior-seeded
candidates grass-refused at interior-green medians 0.012–0.112 and the
rest refused at validation with lineFit 0.11–0.28 against the 0.60 bar —
while the VISIBLE painted "D" arcs (VLM-verified on b8p3-e: the arc is
clearly visible at 1609 arc px) yield no seeded conic aligned with them,
so the next increment is an image-side fit that locks onto the true
painted penalty-arc band before the prior can calibrate a single real
window.
