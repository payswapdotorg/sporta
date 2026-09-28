# R606 — the ellipse/circle-constrained calibration solve: machine measurement

Session: r606/ellipse-constrained-solve (Lane A — the 2026-09-26 closure
lanes), 2026-09-27. Base: `0cc47ae` (origin/main, Lane-0 docs
reconciliation). Substrate: the committed corpus bytes
(`scripts/evidence/spr-corpus-bytes/`), sha-256-verified byte-exact at
driver startup against `scripts/evidence/spr-wave2-corpus/corpus.json`
(4/4 clips).

## WHAT this measures

`BroadcastLineCalibrator` v0.2.0 (`packages/perception-adapters/src/
calibration/broadcast-line.ts`) — the additive ellipse/circle-constrained
path. Both paths measured per window:

- **v0.1.0 line-only** — `new BroadcastLineCalibrator({ ellipseConstrained:
  false })`, the exact v0.1.0 behavior surface;
- **v0.2.0 ellipse-constrained** — `new BroadcastLineCalibrator()` (the
  default; the ellipse path runs only after a line-path
  `no-consistent-homography` refusal).

Per window: calibrated (confidence, correspondenceCount, the W203-conformant
solved homography, and the fit metrics — lineFit over the full scored set,
backward chamfer, ellipse residual vs the fitted conic) or refused (the
typed failure class + the measured numbers riding the refusal). Per-frame
single-frame runs for both paths ride every window record (diagnostics).
The synthetic proof (arc-window recovery within 1.38 m worst probe error,
refusal classes, non-degradation, determinism) lives in the package test
suite: `packages/perception-adapters/test/calibration-ellipse.test.ts`
(9 tests; the package battery is 137 pass / 0 fail, typecheck clean).

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
bun test                              # 137 pass / 0 fail
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

**Headline (honest): 0 windows newly calibrated** (2/12 calibrated, the
same two; non-degradation exact — b8p3-c/d byte-identical confidences
0.832/0.988; camera-motion windows unchanged; cross-clip determinism
b1-a ≡ b8p3-a, b1-b ≡ b8p3-e holds). **The evidence quality improves
dramatically; the solve still refuses — at DIFFERENT, later stages.**

| window | v0.2.0 (recorded) | v0.3.0 (measured) |
|---|---|---|
| b8p3-b | insufficient (arc 871, cov 10/36) | **quota PASSES** (arc 3738, support 1063, cov 34/36) → refuses `ellipse-no-consistent-homography` (lineFit 0.249, backward 3.13, ellipse residual 19.6) |
| b8p3-e | noCH (sup 100, cov 16/36; lineFit 0.662, bw 21.6, res 13.9) | insufficient (arc 1609, sup 641, cov 11/36 — coverage is conic-relative; the fitted conic changed) |
| b8p3-f | noCH (sup 191, cov 23/36; lineFit 0.606, bw 17.6, res 6.3) | noCH (arc 1970, sup 561, cov 18/36; lineFit 0.315, bw 22.0, **res 1.42 — the fitted conic is now tightly supported**) |
| b8p3-g | noCH (cov 26/36) | insufficient (arc 3585, sup 1056, cov 9/36) |
| b3-a | insufficient (arc 1236, cov 11/36) | insufficient (arc 12177, sup 1359, cov 10/36) |
| b5-a | insufficient (cov 8/36) | **quota PASSES** (arc 1271, sup 678, cov 19/36) → refuses noCH (lineFit 0.280, bw 19.4, res 4.86) |
| b5-b | insufficient (arc 570, cov 11/36) | **quota PASSES** (arc 3106, sup 426, cov 14/36) → refuses noCH (lineFit 0.351, bw 0, res 46.7) |

VLM overlay check (b8p3-f): the fitted conic does NOT coincide with the
visible white circle arc (offset, floating in green) — visually
consistent with the honest refusal; the conic-selection machinery is the
next gap, not the evidence.

## Tests (the battery)

- `calibration-ellipse.test.ts` 9/9 (the two occluded/partial-window
  tests UPDATED to the v0.3.0 refusal stage with the v0.2.0 surface
  asserted reproducible via the option-off path — the honest note: the
  flank recovery admits the fixture's penalty arcs as quota-passing
  evidence; the refusal moves to the LATER stage, the bar is unchanged).
- Full package battery **137/137 pass**, tsc clean.
- Determinism: the driver re-run reproduces every arcPixels/support/
  coverage value exactly (b8p3-b 3738 = 3738, b8p3-e 1609 = 1609,
  b8p3-f 1970 = 1970, b5-a 1271 = 1271); the deep-equal calibration test
  passes.

## The NEXT measured gap (precise)

The flank recovery admits more curved evidence (incl. penalty arcs and
crowd noise) — the RANSAC's winning conic is **not always the center
circle**: on b8p3-b the projected model circle lands 19.6 px from the
fitted conic (the conic is something else); on b5-b backward chamfer is
0 with ellipse residual 46.7 (a degenerate-ish anchor set). The evidence
problem is now substantially solved; the remaining gap is **conic
selection + anchor conversion**: (a) circle-vs-other-conic
discrimination in the RANSAC winner (e.g., a model-circle prior or
multi-conic hypothesis family), (b) the mixed DLT/pole-polar anchor
machinery converting a well-fitted center-circle conic into a
homography that passes the lineFit/backward gates on arc-dominated
windows. Both are recorded as the next increment candidates (measured
order: (a) first — b8p3-b's conic is the blocker).

Incident (honest): one intermediate exact-predicate marking variant was
measured (synthetic probe 2.6166 m > the 2.5 m bar; real-window outcomes
identical) and reverted to the rounded band — recorded in the
buildStraightExplainMask comment.
