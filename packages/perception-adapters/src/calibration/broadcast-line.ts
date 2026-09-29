/**
 * W303-class candidate: `BroadcastLineCalibrator` — REAL broadcast
 * perspective pitch calibration from frame PIXELS: local-contrast line
 * evidence, motion-compensated temporal aggregation, Hough lines, a
 * boundary-quad hypothesis search, and coordinate-descent refinement —
 * feeding the SAME W203 homography solver (wrap, never fork).
 *
 * WHY THIS CANDIDATE EXISTS (the R606 failure evidence, recorded in the
 * status ledger): the line-based candidate's envelope is near-axis-aligned
 * views with a bright-white (r,g,b >= 190) line predicate; real 640x360
 * broadcast frames carry pitch lines at brightness ~(130-180) on ~(90-120)
 * grass — the bright-white predicate fires on stands/scoreboards instead —
 * and real main-camera perspective smears the projection histograms. The
 * in-play R606 run therefore collapsed at the CALIBRATION stage (both
 * shipped candidates refusing or mapping nothing). This candidate is the
 * measured fix: LOCAL CONTRAST catches markings at ANY absolute brightness
 * (a 130-180 line on 90-120 grass exceeds its 13x13 neighborhood mean by
 * 40-70, exactly like a 245 line on synthetic 87 grass), and
 * motion-compensated temporal aggregation separates STATIC lines from
 * MOVING players.
 *
 * ALGORITHM (documented in full — every constant is part of the tested
 * contract; every step is pure and deterministic with a fixed scan order):
 *
 * 1. GREEN UNION: per frame, pitch-green pixels (`isPitchGreen`); the
 *    UNION over all frames (players punch holes that MOVE — the union
 *    robustly fills them); the union is dilated 3 iterations of 3x3
 *    (border-replicate edges), which fills the static white line "holes"
 *    and gives boundary-line pixels just outside the grass a green margin.
 *    Union < `minPitchFraction` (default 0.2) of the frame → typed refusal
 *    `broadcast-line.no-pitch-visible` (not enough pitch in view to
 *    calibrate honestly). An EMPTY frame sequence carries no line evidence
 *    → typed refusal `broadcast-line.insufficient-line-evidence` (mirrors
 *    the line-based candidate's empty-sequence refusal).
 * 2. MOTION ESTIMATION (the static-camera check WITH compensation): per
 *    frame, the green column-profile and row-profile (per-column /
 *    per-row green counts), smoothed with a 9-tap zero-padded box; each
 *    frame's profiles are cross-correlated against the MIDDLE (anchor)
 *    frame's over integer shifts in [-60, +60] px — the shift maximizing
 *    the dot product, first shift in ascending scan order on ties —
 *    yielding the frame's content translation (dx, dy) relative to the
 *    anchor. Any |dx| or |dy| > 40 — beyond the compensation envelope —
 *    is the typed refusal `broadcast-line.camera-motion` (panning
 *    cameras refuse honestly). [Documented constant deviation: the search
 *    window is +-60 px, not the +-30 of the original design note — a +-30
 *    search can never MEASURE a >40 px motion, which would make the >40
 *    refusal unreachable and the panning refusal untestable; +-60 covers
 *    the +-40 envelope with margin so the refusal fires on real evidence.]
 *    The pipeline passes every-25th-frame subsamples, so per-frame shifts
 *    against the anchor measure the slow wobble; integer compensation
 *    handles it.
 * 3. PER-FRAME LINE MASK (LOCAL CONTRAST — the reason this candidate sees
 *    real broadcast lines): an integral image of brightness (r+g+b) gives
 *    the local mean over a 13x13 box (radius 6, edge-clamped counts); a
 *    pixel is a LINE pixel when brightness − localMean > 14 AND it lies
 *    inside the dilated green union. The box mean ADAPTS to the local
 *    surface, so absolute brightness never matters — the documented
 *    reason the bright-white predicate fails on real broadcasts.
 * 4. MOTION-COMPENSATED TEMPORAL AGGREGATION: each frame's line mask is
 *    shifted by its measured (−dx, −dy) into anchor coordinates, dilated
 *    2 iterations of 3x3 (absorbs sub-pixel jitter), and accumulated; the
 *    STATIC mask = pixels set in >= 50% of frames. Lines are static →
 *    present in every frame; players move → excluded. Static mask < 500
 *    px → typed refusal `broadcast-line.insufficient-line-evidence`.
 * 5. HOUGH: 180 theta bins over [0, π), integer rho over [−diag, diag]
 *    (diag = ceil(hypot(width, height))); every static pixel votes for
 *    every theta. Iterative peak extraction: take the accumulator max
 *    (first in (theta, rho) scan order on ties), suppress theta ±4 bins ×
 *    rho ±12 (no cyclic theta wrap), repeat — up to 16 peaks, stopping
 *    early once the max falls below 30 votes (sub-30 peaks can never pass
 *    the vote filter). A peak becomes a DETECTED line when its votes >= 30
 *    AND its supporting pixels (static pixels within 2.5 px of the line)
 *    span >= 60 px along it (the extent filter keeps segments, kills
 *    circle/arc chords).
 * 6. HYPOTHESIS SEARCH (the solve): enumerate assignments of 4 detected
 *    lines to the 4 boundary roles — near touchline (y=0), far touchline
 *    (y=68), left goal line (x=0), right goal line (x=105). Only orderings
 *    consistent with the elevated main-camera prior survive the
 *    enumeration (the near-role line's mean supporting-pixel y > the
 *    far-role line's; the left-role line's mean x < the right-role
 *    line's) — the documented envelope cost. Intersect the two
 *    touchline-role lines with the two goal-line-role lines → 4 image
 *    corners (pixel → normalized); the quad must be finite, inside the
 *    plausible-view bounds ([−1, 2]² normalized — one frame-width of
 *    margin around the frame), strictly convex, and free of collinear
 *    triples; W203 `solveHomography` then maps [near∩left, near∩right,
 *    far∩right, far∩left] (the canonical tl, tr, br, bl corner roles)
 *    onto CANONICAL_PITCH_CORNERS. Score = the fraction of SCORED static
 *    pixels whose projection lands within 1.0 m of a model line/arc,
 *    looked up in the pitch-plane distance field (0.5 m cells over
 *    [−5, 110] × [−5, 73] to ALL canonical model lines and arcs —
 *    touchlines, goal lines, halfway, penalty fronts/tops/bottoms,
 *    goal-area fronts/tops/bottoms, the center circle, and the penalty
 *    arcs CLIPPED outside their penalty areas). HOARDINGS SUPPRESSION
 *    (hoardings are the documented dominant noise — static, bright,
 *    near-grass boards above the pitch, typically in the top rows of the
 *    frame): a static pixel is EXCLUDED from scoring when its row is
 *    above (green top row + 4) of its column, where the green top row is
 *    the topmost row of the DILATED green union in that column (columns
 *    with no green at all exclude everything). The search scores a
 *    deterministic row-major strided subsample of the scored set (<= 2000
 *    points) — the same subsample scores the refinement — while the
 *    final validation uses the FULL scored set (documented efficiency
 *    note, deterministic). Fewer than 4 detected lines, or no hypothesis
 *    surviving the sanity checks, → typed refusal
 *    `broadcast-line.no-consistent-homography`.
 * 7. REFINEMENT: the best hypothesis's 8 homography parameters (h0..h7,
 *    h8 = 1) are refined by coordinate descent on the combined objective —
 *    forward (the step-6 score) + backward chamfer reward (model line
 *    sample points — every 0.5 m along every model segment/arc —
 *    projected into the image through H⁻¹ via W203 `invertHomography`;
 *    in-frame points earn clamp(1 − d/12, 0, 1), where d is their 2-pass
 *    3-4 chamfer distance to the static mask) + green containment (the
 *    fraction of a deterministic row-major strided subsample of
 *    green-union pixels projecting inside the pitch + 3 m margin). Equal
 *    weights (each term in [0, 1]; documented). Per-parameter step =
 *    max(|h_i| * 0.008, 1e-5) (the floor only matters for exactly-zero
 *    parameters), halved when neither direction improves, 60 fixed
 *    rounds over the 8 parameters, strictly-greater acceptance —
 *    deterministic. Non-finite or non-invertible candidates score −∞ and
 *    are rejected.
 * 8. VALIDATION + CONFIDENCE (honest): final metrics over the FULL
 *    evidence — lineFit = fraction of scored static pixels within 1.0 m
 *    of model lines; backward = mean chamfer distance (px) of in-frame
 *    projected model points to the mask. lineFit < 0.55 or backward >
 *    12 px → typed refusal `broadcast-line.no-consistent-homography`
 *    (not good enough to project with — never a guessed mapping).
 *    Confidence (documented formula):
 *    clamp(0.25 + 0.45 * lineFit + 0.3 * max(0, 1 − backward / 12), 0, 1).
 * 9. OUTPUT: the refined H (image-normalized → pitch, h[8] = 1); the
 *    corner set = the four canonical pitch corners mapped through H⁻¹
 *    (W203 `invertHomography` + `applyHomography`) back to normalized
 *    image coordinates in "tl, tr, br, bl" order carrying the confidence;
 *    the `FieldMappingPayload` mapping with cameraHomographyRef
 *    `homography-<calibratorId>-<anchorFrame.frameId>`;
 *    correspondenceCount = 4 (the boundary anchors).
 *
 * v0.2.0 ADDITIVE INCREMENT — THE ELLIPSE/CIRCLE-CONSTRAINED SOLVE (the
 * R606 remaining gap, measured and recorded in the status ledger: the
 * minority-orientation family on the real 640x360 windows is ARC SEGMENTS,
 * not straight lines — the (2+2)-family search starves or its hypotheses
 * fail validation on arc-dominated views, while the CENTER CIRCLE is
 * strongly detected):
 *
 * E0. WHEN IT RUNS: NEVER before the v0.1.0 line path. Steps 1-8 run
 *     byte-identically first; a window the line path CALIBRATES returns
 *     its result unchanged (non-degradation by construction — the
 *     deterministic-recovery and pipeline expectations of v0.1.0 keep
 *     holding bit-for-bit). Only when the line path refuses with
 *     `broadcast-line.no-consistent-homography` (family starvation, no
 *     surviving hypothesis, or failed validation) does the ellipse path
 *     run. `ellipseConstrained: false` restores the exact v0.1.0 behavior
 *     surface (the measurement driver uses it to record the line-only
 *     path).
 * E1. ARC EVIDENCE: static-mask pixels (the same motion-compensated
 *     aggregate of step 4) that are NOT within
 *     ELLIPSE_LINE_EXPLAIN_PX of any detected Hough line, with the same
 *     hoardings suppression as the scored set (rows above green-top + 4
 *     excluded). Straight-line evidence is "explained" by the Hough
 *     lines; what remains is the curved evidence — the center circle
 *     (strongly detected on the measured windows) plus noise.
 *     v0.3.0 FLANK RECOVERY: the explain is STRAIGHTNESS-AWARE (default
 *     on) — a Hough line explains pixels only along contiguous
 *     along-line stretches with ≥ ELLIPSE_LINE_STRAIGHT_SUPPORT_PX of
 *     static support. Measured defect this fixes: the arc-chord Hough
 *     lines (chords THROUGH the near-straight circle flank) explained
 *     away the flank band, leaving ONE flank of arc evidence — a single
 *     flank underdetermines the conic (sliver conics → bad anchors →
 *     validation residuals 17-22 px). Real touchlines (200-600 px
 *     along-runs) keep explaining their bands.
 * E2. CONIC FIT (deterministic RANSAC): 5-point conic subsets — a fixed
 *     mix of structured spread subsets and fixed-seed LCG draws (integer
 *     arithmetic only — no Math.random, no clock; byte-deterministic) —
 *     each solving the 5x6 nullspace conic through its 5 points
 *     (Gaussian elimination, deterministic free-variable choice). A
 *     subset conic survives only as a REAL non-degenerate ellipse
 *     (B² − 4AC < 0) with sane extents (both semi-axes within
 *     [ELLIPSE_MIN_SEMI_AXIS_PX, ELLIPSE_MAX_SEMI_AXIS_PX], axis ratio
 *     ≤ ELLIPSE_MAX_AXIS_RATIO, center within the frame bounds + margin).
 *     Support = arc pixels within ELLIPSE_FIT_TOLERANCE_PX of the conic
 *     (radial distance approximation); the best conic by support (first
 *     in enumeration order on ties) is then RE-FIT by linear least
 *     squares over its full support set (constraint a + c = 1, valid for
 *     ellipses; singular system keeps the RANSAC conic) — hundreds of
 *     support points stabilize the thin-sliver ellipses real broadcast
 *     perspective produces.
 * E2b. CONIC SELECTION (v0.4.0 — the fallback chain): the RANSAC
 *     winner-by-support is NOT always the center circle (measured on the
 *     real corpus, VLM-verified on the overlays: the winner on b8p3-b/f
 *     is the hoarding/stand-boundary CURVE, and the b5-b winner is a
 *     degenerate off-frame conic). The winner (the v0.3.0 primary) is
 *     tried FIRST — its solve and its typed refusal are the v0.3.0
 *     surface exactly — and only on its refusal do the DISTINCT
 *     alternatives run, in source-priority order: the per-component fits
 *     of the sub-dominance arc components FIRST (a structure DROPPED by
 *     the dominance filter is recoverable ONLY there — its pixels never
 *     reach the global RANSAC; component fits skip the EM band
 *     re-extraction, which near neighboring structures DRIFTS the conic:
 *     measured semi 64 vs the true 100), then the global ranked re-fit
 *     runners-up. Every alternative is held to the SAME quota (support
 *     + coverage) and deduplicated by geometry (center/semi/rotation
 *     distance), capped at ELLIPSE_MAX_CONIC_CANDIDATES. Each candidate
 *     runs the FULL E4-E6 flow (the bar never lowers); the first
 *     validation pass wins; total failure rethrows the first
 *     quota-passer's typed refusal with the additive conicChain record
 *     (every candidate's measured outcome — nothing laundered). The
 *     quota refusal now fires only when NO candidate passes the quota
 *     (honest: SOME conic is well-evidenced exactly when one passes the
 *     same bar). OPT-IN (default false): the chain's b3-a
 *     machine-recovery (lineFit 0.731) FAILS the VLM visual gate — the
 *     grid misaligned on all three sharp checks, the winning conic
 *     anchored to the goal/net STRUCTURE (the static net satisfies the
 *     backward chamfer; the displaced grid's parallel line family
 *     satisfies lineFit — the machine bar's blind spot on behind-goal
 *     views). The measured next increment: pitch-line-vs-structure
 *     discrimination in the validation before the default flips.
 * E2c. v0.4.1 CHAIN-ONLY HARDENING, LEG 1 — THE CONIC GRASS-SUPPORT GATE:
 *     every quota-passing chain candidate's conic interior must be
 *     GRASS-supported before its solve runs: the MEDIAN over frames of
 *     the per-frame green fraction over a fixed 41x41 parametric interior
 *     grid must be >= ELLIPSE_CONIC_MIN_INTERIOR_GREEN_MEDIAN. A pitch
 *     circle is a thin painted band ON grass — its conic interior reads
 *     green in every frame (measured: the solve-reaching windows' primary
 *     conics 0.27-0.79 — b8p3-c 0.786 / b8p3-d 0.295 / b8p3-e 0.272 /
 *     b5-a 0.703; the synthetic fixture 0.90); the b3-a goal/net-structure
 *     conics measure 0.000-0.073 and the other corpus structure conics
 *     0.011-0.175 (stably non-green — the ANY-frame green UNION does NOT
 *     discriminate them cleanly: inside the b3-a winner the union lifts to
 *     0.164 vs the 0.073 median, one late frame reading 0.590 — ABOVE the
 *     threshold — so an ANY-frame or single-frame statistic passes the
 *     structure; the per-frame MEDIAN refuses it). A refused candidate is
 *     skipped (the chain continues), its typed refusal recorded as the
 *     chain entry — `broadcast-line.ellipse-conic-off-pitch`. Fires ONLY
 *     when ellipseMultiConicSelection is on: the default surface never
 *     runs it (byte-identical).
 * E3. EVIDENCE QUOTA (typed refusal below): support >=
 *     ELLIPSE_MIN_SUPPORT_PX AND angular coverage >=
 *     ELLIPSE_MIN_COVERAGE_BINS of the 36 10°-bins around the conic.
 *     These gates are what make an occluded/partial/tiny arc refuse
 *     honestly instead of fabricating a calibration.
 * E4. ELLIPSE-CONSTRAINED HYPOTHESES (the geometry): the world center
 *     circle (52.5, 34, r = 9.15) projects to the fitted conic. The
 *     anchors are incidence-preserving constructions (projective maps
 *     preserve pole-polar incidences and intersections):
 *     - the Q ANCHORS: the intersections of the fitted conic with the
 *       polar line of the detected line-pair's intersection S_i are the
 *       images of the world circle's intersections with the polar line
 *       of the model pair's intersection S_w (for a same-family parallel
 *       pair the world polar is the diameter x = 52.5 (y-pair) or y = 34
 *       (x-pair)) — two POINT correspondences per Q-flip (both
 *       enumerated), plus their CIRCLE-TANGENT line correspondences (the
 *       tangent to the conic at a Q is the image of the tangent to the
 *       circle at the world Q);
 *     - the line rows: both detected lines (SUB-PIXEL refined — the
 *       quantized Hough theta/rho start the solve ~2-3 m off and the
 *       descent stalls; measured) ↔ their model lines, and the polar
 *       line correspondence.
 *     Two same-family parallel lines + the conic leave exactly ONE degree
 *     of freedom (which conic point is the image of the world circle
 *     point at angle 0) that no collinear anchor can pin — the line rows
 *     and vanishing-point rows are scale-invariant in the channel blocks
 *     (measured: a near-null direction left a channel block at 1/31 of
 *     the truth). The 1-DOF SCAN closes it: a coarse pass over the conic
 *     parameter then a fine pass around the best, each candidate solving
 *     the LOCAL mixed points+lines DLT (Householder QR least squares over
 *     every anchor row — point rows in the W203 h[8] = 1 form + 3
 *     cross-product rows per line correspondence; the first-cut normal
 *     equations proved numerically worthless: a consistent system
 *     collapsed to rank ~2) and scored by a mini forward score. The
 *     first-cut POLE anchors (pole of each line w.r.t. conic ↔ pole
 *     w.r.t. circle) were REMOVED — poles of far lines are
 *     high-leverage (a 1 px conic error moved one 8.7 px; measured).
 *     This local solver is the ellipse path's INTERNAL hypothesis
 *     generator only; the output homography still flows through the W203
 *     contract surface (invertHomography for corners, canonical h[8] = 1,
 *     the same refinement + validation). Model assignments enumerate the
 *     SAME MODEL_X_FAMILY / MODEL_Y_FAMILY values as step 6 with the
 *     SAME elevated-camera ordering priors (far line above near line,
 *     larger-x right of smaller-x) over SAME-FAMILY line pairs only
 *     (cross-family pairs are the line path's (2+2) territory — the
 *     arc-window evidence shape is a parallel pair).
 * E4b. v0.5.0 ANCHOR CONVERSION (OPT-IN, default false — the
 *     `ellipseAnchorConversion` option; fires only inside the
 *     ellipse-constrained path, which itself runs only after the line
 *     path's solve/refusal per E0): the J-ORTHOGONAL EXACT CLOSURE of the
 *     ellipse path's scan solves. The E4 anchors satisfy the conic
 *     correspondence only approximately (the mixed DLT balances the
 *     conic-derived rows against the line rows; the E5 refinement then
 *     trades the ellipse residual against the line evidence — a measured
 *     compromise surface). The conversion makes the conic correspondence
 *     EXACT BY CONSTRUCTION, in the LORENTZ FRAME: canonicalize the image
 *     conic (in NORMALIZED image coordinates — the machinery's
 *     homographies map normalized image coords → pitch, NOT pixels:
 *     Q̂ = Sᵀ·C_px·S with S = diag(width, height, 1)) and the world circle
 *     to the Lorentz form J = diag(1, 1, −1) (G with GᵀJG = Q̂ and W with
 *     WᵀJW = C_w, via the Jacobi eigendecomposition with the odd-sign
 *     eigenvalue arranged last; the sign-twin conic canonicalizes
 *     identically — conic matrices are scale-free; the all-same-sign
 *     IMAGINARY class refuses), so H = W⁻¹·P·G with P J-ORTHOGONAL
 *     (PᵀJP = J): the conic correspondence is then P's DEFINING property,
 *     exact for every P. The scan enumerates as in E4 (the same swap ×
 *     same-family-pair × model-values × flip driver and the same 1-DOF
 *     coarse+fine parameter scan) with the NEAR-LINE POLE ROW added to
 *     every base's anchor rows (the pole of the pair's near line — the
 *     smaller model value, the near touchline / left goal line — w.r.t.
 *     the conic ↔ w.r.t. the world circle, a well-conditioned point
 *     correspondence; the FAR line's pole is the measured high-leverage
 *     class and stays excluded). Every mixed-DLT scan solve H_t becomes
 *     M₀ = W·H_t·G⁻¹ (the initial Lorentz map); N = M₀ᵀJM₀ measures the
 *     solve's conic correspondence (N = μ·J ⟺ exact). THE CLOSURE
 *     projects M₀ onto the J-orthogonal class: the FAST PATH (N ≈ μ·J
 *     within the documented tolerance ⟹ return M₀/√μ — the NEAREST
 *     J-orthogonal map; the eigendecomposition path's ULP-level tie order
 *     in the degenerate eigenpair composes the projection with an
 *     axis-swap reflection instead — a legitimate J-orthogonal map (the
 *     conic correspondence holds) but NOT the nearest one, breaking the
 *     true-H fixed point and needlessly rebalancing the line rows: the
 *     measured defect this fast path fixes) and otherwise the
 *     EIGENDECOMPOSITION PATH (Jacobi on N, B = √|Λ|·Vᵀ over the arranged
 *     eigenpairs, P̂ = M₀·B⁻¹), both under the fail-loud self-check
 *     (P̂ᵀJP̂ ∝ J with a positive scale — never a silently unverified map).
 *     The converted Ĥ = W⁻¹·P̂·G (canonical h[8] = 1) must pass THE
 *     ADMISSIBILITY BOUND (N's relative deviation from μ·J must be within
 *     the documented bound — only scan solves whose anchors were
 *     near-conic-consistent convert; measured ≈ 2.7% of enumerated scan
 *     solves corpus-wide), THE BIRTH CONIC GUARD (Ĥᵀ·C_w·Ĥ ≈ the conic
 *     the solve was born from — the algebraic identity, fail-loud) and
 *     THE CONIC HARD GUARD (the pixel-level mean conic residual vs the
 *     original px conic). The converted candidates run the E4 anti-
 *     collapse quick guards and the combined-objective finalist selection
 *     WITHOUT the E5 refinement (the closure IS the solve — the descent
 *     would trade the exactness away), then the UNCHANGED E6 validation
 *     bar: the closure rebalances the line rows globally, and when the
 *     conic-exact solve contradicts the line evidence the bar REFUSES
 *     honestly (the anchors-fight outcome — measured on the synthetic
 *     fixtures: conic-exact residuals ~ 3e-4..1e-2 px with backward > 10
 *     px where the compromise solve passed; nothing laundered). A
 *     candidate whose whole scan enumerated solves but converted nothing
 *     (or whose conic's canonicalization refused — the IMAGINARY class)
 *     refuses with the typed
 *     `broadcast-line.ellipse-anchor-unconvertible`; the per-candidate
 *     anchor record (scan solves enumerated / converted) rides every
 *     conversion-path refusal and every conicChain entry.
 * E5. REFINEMENT: the same coordinate descent as step 7 with THREE ADDED
 *     equal-weight terms, each a measured necessity:
 *     - the ELLIPSE REWARD: world-circle sample points (every 2°)
 *       projected through H⁻¹ must lie on the fitted conic;
 *     - the SMOOTH FORWARD: mean clamp(1 − d/5 m) of the scored pixels'
 *       model distances — the binary 1 m forward score has no gradient
 *       at the ~2-3 m starts (the descent stalled at lineFit 0.456);
 *     - the LINE CONSISTENCY: the hypothesis's model lines must map onto
 *       their detected lines — without it the descent "pinches" the
 *       pitch (both touchline images onto one world line, measured) and,
 *       relatedly, the anti-collapse percentile-spread guard runs DURING
 *       the descent as a hard −∞ rejection (a collapsed H once scored
 *       lineFit 0.67 / ellipseMean 0.46 while compressing the pitch onto
 *       a ~10 m blob).
 * E6. VALIDATION (the bar is NOT lowered): the v0.1.0 gates over the
 *     FULL scored set (lineFit >= 0.60, backward chamfer <= 10 px) PLUS
 *     the ellipse gates (mean conic residual <= ELLIPSE_VALIDATION_MAX_PX
 *     with >= 80% of in-frame circle points within 2× that). Failing
 *     either refuses honestly. Confidence (documented formula):
 *     clamp(0.20 + 0.40·lineFit + 0.20·max(0, 1 − backward/10) +
 *     0.20·ellipseReward, 0, 1) — the conic anchor replaces part of the
 *     line-evidence weight, never inflates it.
 * E6b. v0.4.1 CHAIN-ONLY HARDENING, LEG 2 — THE PROJECTED-GRID GEOMETRY
 *     GATE: a solve that passed every E6 machine gate must still project
 *     the pitch as a REAL quad: the four canonical pitch corners through
 *     H⁻¹ must be finite, pairwise distinct beyond
 *     ELLIPSE_GRID_MIN_CORNER_SEPARATION_PX, and their shoelace quad
 *     area must reach ELLIPSE_GRID_MIN_QUAD_AREA_FACTOR × the winning
 *     conic's ellipse area. The containment invariant makes this
 *     zero-false-positive for real cameras: the pitch rectangle's image
 *     CONTAINS the center circle's image (the conic) under any
 *     non-degenerate projective map, so a valid solve satisfies the area
 *     floor by construction (measured: the healthy synthetic chain solve
 *     at quad/conic = 41.1). The measured defect class (b3-a's withheld
 *     claim): a POINT-COLLAPSE — all four corners at image (575, 98),
 *     quad/conic = 0.0004 — that satisfied lineFit (the whole image maps
 *     onto a model-line cluster), backward (the pitch maps onto one
 *     static-mask point) AND the ellipse residual (the circle maps onto
 *     a single point ON the conic; the mean-residual gate is degenerately
 *     satisfiable by any point on the conic). Typed refusal
 *     `broadcast-line.ellipse-degenerate-grid` with the measured quad
 *     area / conic area / corner separation. Fires ONLY when
 *     ellipseMultiConicSelection is on: the default surface never runs
 *     it (byte-identical).
 * E7. OUTPUT: the same CalibrationResult shape; correspondenceCount = 5
 *     (the 4 circle/pole point anchors + the conic anchor; documented).
 *
 * ENVELOPE (honest, like the line-based candidate's):
 *
 * - Requires a STATIC camera across the input window: measured wobble is
 *   compensated up to ±40 px per frame against the anchor; panning beyond
 *   refuses (`broadcast-line.camera-motion`).
 * - Partial visibility OK — the hypothesis search and the refinement work
 *   from whatever boundary lines are visible — but the ENUMERATION needs
 *   the boundary quad anchors: views lacking 2 touchline-role + 2
 *   goal-line-role lines refuse `broadcast-line.no-consistent-homography`.
 * - Elevated main-camera geometry: the search's ordering prior assumes
 *   the near touchline below the far touchline and the left goal line
 *   left of the right goal line in the image; corner-mounted, inverted,
 *   or heavily rotated geometries fall outside the envelope and refuse
 *   honestly.
 * - 640x360-class web-rendered broadcast frames; works at other
 *   resolutions with the same constants (all thresholds are in pixels).
 * - Real lines are caught by LOCAL CONTRAST (the documented reason the
 *   bright-white predicate fails on real broadcasts): any marking ~40+
 *   brightness units above its 13x13 neighborhood inside the green union.
 * - The backward metric penalizes in-frame model points without painted
 *   evidence (occluded or unpainted line regions) — heavy occlusion of
 *   line regions drives backward up and the candidate refuses honestly
 *   rather than project through a wrong H.
 * - v0.2.0 ellipse path (additional, honest): needs the center circle's
 *   ARC evidence to pass the conic quota (support + angular coverage)
 *   and at least TWO line correspondences (any families, including a
 *   same-family parallel pair — the arc-window shape) for the pole-polar
 *   anchored solve; the fitted conic is INTERPRETED as the center circle
 *   (a penalty arc that outranks it in support would mis-solve and fail
 *   validation — the honest outcome). Views whose only curved evidence
 *   is a penalty arc, a partial/occluded circle below quota, or a
 *   degenerate sliver refuse `broadcast-line.ellipse-evidence-insufficient`
 *   with the measured support/coverage numbers; windows whose
 *   conic-anchored hypotheses all fail the guards or validation refuse
 *   `broadcast-line.ellipse-no-consistent-homography` with both paths'
 *   measured reasons.
 */
import type {
  FailureClassRecord,
  PerceptionAdapterDescriptor,
  ResourceRequirements,
  TechnologyLicenseRecord,
} from "@sporta/contracts";
import {
  CANONICAL_PITCH_CORNERS,
  applyHomography,
  invertHomography,
  solveHomography,
} from "@sporta/field-mapping";
import type { FieldCornerSet, Homography, Point2D } from "@sporta/field-mapping";
import type { FieldMappingPayload, PitchPoint } from "@sporta/contracts";
import type { DetectorFrameInput } from "@sporta/perception-detection";
import { assertDescriptorBinding, CandidateFailureError, perceptionDescriptor } from "../errors";
import { BROADCAST_LINE_FIELD_CALIBRATOR_LICENSE } from "../licenses";
import { isPitchGreen } from "../pixels";
import type { CalibrationResult, PitchCalibrationAdapter, PitchCalibrationInput } from "../adapter";

/**
 * Stable technology identity of this candidate. v0.5.0 (behavior-surface
 * change on the OPT-IN anchor-conversion path only, E4b): when
 * `ellipseAnchorConversion` is on, a conic candidate's ellipse-path flow is
 * replaced by the J-ORTHOGONAL EXACT CLOSURE — the image conic (in
 * NORMALIZED image coordinates) and the world circle canonicalize to the
 * Lorentz form J = diag(1,1,−1) (G with GᵀJG = Q̂, W with WᵀJW = C_w), the
 * unknown homography factors as H = W⁻¹·P·G with P J-orthogonal (the conic
 * correspondence exact by construction), and every mixed-DLT scan solve
 * H_t (as M₀ = W·H_t·G⁻¹, with N = M₀ᵀJM₀ measuring its conic
 * correspondence) is projected onto the J-orthogonal class — the FAST PATH
 * (N ≈ μ·J ⟹ M₀/√μ, the NEAREST map: the eigendecomposition path's
 * ULP-level tie order in the degenerate eigenpair composes an axis-swap
 * reflection instead — a legitimate J-orthogonal map but NOT the nearest
 * one, breaking the true-H fixed point: the measured defect the fast path
 * fixes) or the EIGENDECOMPOSITION PATH (B = √|Λ|·Vᵀ, P̂ = M₀·B⁻¹), both
 * under the fail-loud self-check — then the admissibility bound, the birth
 * conic guard and the conic hard guard. The converted candidates take the
 * UNCHANGED validation bar WITHOUT the coordinate-descent refinement; a
 * candidate whose scan converts nothing refuses with the typed
 * `broadcast-line.ellipse-anchor-unconvertible`, the per-candidate anchor
 * record (scan solves enumerated / converted) riding every refusal. The
 * DEFAULT surface (conversion off) is v0.4.1-exact byte-identical. v0.4.1
 * (behavior-surface change on the OPT-IN chain only, the R606
 * validation-gate hardening):
 * two ADDITIVE discrimination gates fire exclusively on the
 * ellipseMultiConicSelection path — (leg 1) a quota-passing chain
 * candidate's conic interior must be GRASS-supported (median over frames
 * of the per-frame green fraction; the b3-a goal/net-structure conics
 * measure 0.000-0.073 and the other corpus structure conics 0.011-0.175,
 * vs 0.27-0.79 for the solve-reaching windows' grass-backed primary
 * conics) — `broadcast-line.ellipse-conic-off-pitch`; (leg 2) a solve that
 * passed every machine gate must still project the pitch as a real quad:
 * the projected pitch quad's area must reach the winning conic's own
 * ellipse area (the containment invariant — a real camera's pitch image
 * contains the circle's image; the measured b3-a chain solve is a
 * point-collapse at quad/conic = 0.0004) —
 * `broadcast-line.ellipse-degenerate-grid`. The
 * DEFAULT surface (chain off) is v0.3.0-exact byte-identical. v0.4.0 (the
 * R606 conic-selection increment): the ellipse path's conic selection
 * becomes a FALLBACK CHAIN — the RANSAC winner-by-support is tried first
 * (the exact v0.3.0 primary), and only on its typed refusal do the
 * DISTINCT alternative conics run (the global RANSAC's ranked refit
 * candidates + per-component fits over the sub-dominance arc components),
 * each through the FULL hypothesis → refinement → validation flow (the
 * bar never lowers; the first validation pass wins). Measured defect
 * this addresses: on real broadcast windows the winner-by-support conic
 * is the hoarding/stand-boundary CURVE, not the center circle (b8p3-b:
 * the fitted conic is the top-left background curve while the visible
 * circle sits mid-frame; b8p3-f same class) — the validation gates
 * refused those solves correctly, but nothing ever retried with a
 * different conic. OPT-IN (default false — see
 * BROADCAST_LINE_DEFAULTS): the chain's b3-a machine-recovery failed the
 * VLM visual gate (the goal-structure conic class), which the v0.4.1
 * hardening now refuses at the machine bar (the b3-a outcome under the
 * hardened chain is the typed honest refusal). v0.3.0 (flank recovery):
 * the straightness-aware Hough-line explain —
 * `ellipseStraightnessAwareExplain: false` restores the exact v0.2.0
 * explain surface. v0.2.0: the additive ellipse/circle-constrained path
 * runs after a v0.1.0 line-path `no-consistent-homography` refusal;
 * windows the line path calibrates return byte-identical results. The
 * ADAPTER seam (class shape, method signature, output contract) is
 * unchanged — adapterVersion stays 0.1.0.
 */
export const BROADCAST_LINE_FIELD_CALIBRATOR_ID = "broadcast-line-calibrator";
export const BROADCAST_LINE_FIELD_CALIBRATOR_VERSION = "0.5.0";
export const BROADCAST_LINE_FIELD_CALIBRATOR_ADAPTER_VERSION = "0.1.0";

/**
 * Options for {@link BroadcastLineCalibrator}; every field is optional,
 * every field is validated fail-loud with `RangeError` at construction.
 */
export interface BroadcastLineCalibratorOptions {
  /** Component id (default `broadcast-line-calibrator-v1`). */
  readonly calibratorId?: string;
  /** Minimum green-union fraction of the frame (default 0.2). */
  readonly minPitchFraction?: number;
  /**
   * Local-contrast threshold in brightness units: line pixels must exceed
   * their 13x13 local mean by more than this (default 14 — real broadcast
   * lines measure 40-70 above grass).
   */
  readonly lineContrastThreshold?: number;
  /**
   * v0.2.0: run the ellipse/circle-constrained path when the v0.1.0 line
   * path refuses with `broadcast-line.no-consistent-homography`
   * (default true). `false` restores the EXACT v0.1.0 behavior surface —
   * the measurement driver uses it to record the line-only path.
   */
  readonly ellipseConstrained?: boolean;
  /**
   * v0.3.0: straightness-aware Hough-line explain in the arc-evidence
   * extraction (default true). A Hough line may explain arc-band pixels
   * only along contiguous along-line stretches whose static support
   * runs ≥ ELLIPSE_LINE_STRAIGHT_SUPPORT_PX — the arc-chord "fake" lines
   * (chords through the near-straight circle flank, ≤ ~110 px straight)
   * stop eating the flank band, while real touchlines (200-600 px runs)
   * keep explaining theirs. `false` restores the exact v0.2.0 explain
   * surface (the measurement driver uses it to record the v0.2.0 path).
   */
  readonly ellipseStraightnessAwareExplain?: boolean;
  /**
   * v0.4.0: multi-conic selection — the conic-selection fallback chain
   * (OPT-IN, default false). The RANSAC winner-by-support conic (the
   * v0.3.0 primary) is tried first; on its typed refusal the DISTINCT
   * alternative conics (the per-component fits over the sub-dominance
   * arc components, then the global ranked re-fit runners-up, each
   * quota-gated) run through the same full hypothesis → refinement →
   * validation flow. v0.4.1: the chain path now carries the
   * VALIDATION-GATE HARDENING (two additive discrimination gates — the
   * conic grass-support gate `broadcast-line.ellipse-conic-off-pitch`
   * and the projected-grid geometry gate
   * `broadcast-line.ellipse-degenerate-grid`; see the module docs E2c /
   * E6b) — the measured b3-a machine-recovery (a goal-structure-anchored
   * point-collapse that satisfied every v0.4.0 machine gate) now refuses
   * at the machine bar. The default stays false pending the TL's visual
   * acceptance of a hardened-chain calibration on the real corpus.
   */
  readonly ellipseMultiConicSelection?: boolean;
  /**
   * v0.5.0: the E4b anchor conversion — the J-orthogonal exact closure of
   * the ellipse path's scan solves (OPT-IN, default false). Fires only
   * inside the ellipse-constrained path (which itself runs only after the
   * line path's refusal, E0): the image conic and the world circle
   * canonicalize to the Lorentz form J (the homography factors as
   * H = W⁻¹·P·G with P J-orthogonal, the conic correspondence exact by
   * construction), and every mixed-DLT scan solve is projected onto the
   * J-orthogonal class (the fast path N ≈ μ·J ⟹ M₀/√μ, else the
   * eigendecomposition path) under the admissibility bound, the birth
   * conic guard and the conic hard guard. The converted candidates take
   * the UNCHANGED validation bar WITHOUT the coordinate-descent
   * refinement — the closure rebalances the line rows globally, so when
   * the conic-exact solve contradicts the line evidence the bar refuses
   * honestly (the anchors-fight outcome; measured: 0 newly-calibrated
   * real windows, the conic-exact residuals riding the refusals). A
   * candidate whose scan converts nothing refuses with the typed
   * `broadcast-line.ellipse-anchor-unconvertible`. `false` (the default)
   * restores the EXACT v0.4.1 behavior surface — the conversion never
   * runs (the measurement driver uses the option to record the v0.5.0
   * path).
   */
  readonly ellipseAnchorConversion?: boolean;
}

const BROADCAST_LINE_DEFAULTS = {
  calibratorId: "broadcast-line-calibrator-v1",
  minPitchFraction: 0.2,
  lineContrastThreshold: 14,
  ellipseConstrained: true,
  ellipseStraightnessAwareExplain: true,
  // v0.4.0 ships the conic-selection chain OPT-IN (default false): the
  // chain machine-recovers a window the single-conic surface refuses
  // (b3-a, lineFit 0.731), but the VLM visual gate FAILED that recovery
  // (the grid misaligned on all three sharp checks — the winning conic
  // anchors to the goal/net STRUCTURE, the machine bar's line-on-line
  // blind spot on behind-goal views where the static net satisfies the
  // backward chamfer). v0.4.1: the chain path carries the
  // validation-gate hardening (the conic grass-support gate + the
  // projected-grid geometry gate) — the b3-a class now refuses at the
  // machine bar with the typed classes; the default surface stays
  // v0.3.0-exact byte-identical (the hardening fires ONLY on the opt-in
  // chain path). The chain stays opt-in pending the TL's visual
  // acceptance of a hardened-chain calibration on the real corpus.
  ellipseMultiConicSelection: false,
  // v0.5.0 ships the anchor conversion OPT-IN (default false): the
  // J-orthogonal exact closure is CONIC-EXACT by construction (the
  // measured synthetic residuals ~ 3e-4..1e-2 px) but the unchanged
  // validation bar REFUSES the globally re-balanced solves on every
  // refusing window (the anchors-fight outcome — the closure makes the
  // conic/line inconsistency explicit instead of compromising it away);
  // 0 real windows newly calibrate under it. The mechanism and its honest
  // per-candidate records are the delivery; the recovery claim is NOT
  // made.
  ellipseAnchorConversion: false,
} as const;

/** Documented failure classes of the broadcast-line field calibrator. */
export const BROADCAST_LINE_FIELD_CALIBRATOR_FAILURE_CLASSES: readonly FailureClassRecord[] = [
  {
    failureClassId: "broadcast-line.no-pitch-visible",
    description:
      "The green-pitch union (over the whole sequence, dilated) covers less than " +
        "minPitchFraction of the frame, or a frame is degenerately small: not enough " +
        "pitch in view to calibrate honestly. Typed refusal, never a guessed mapping.",
    retryable: false,
  },
  {
    failureClassId: "broadcast-line.camera-motion",
    description:
      "A frame's measured content translation against the anchor frame exceeds the " +
        "±40 px compensation envelope (panning or cut cameras). The candidate needs a " +
        "static camera across the window; it refuses honestly instead of aggregating " +
        "across a moving viewpoint.",
    retryable: false,
  },
  {
    failureClassId: "broadcast-line.insufficient-line-evidence",
    description:
      "An empty frame sequence, or a motion-compensated static line mask below 500 " +
        "pixels: too little static line evidence to search for a homography. Typed " +
        "refusal.",
    retryable: false,
  },
  {
    failureClassId: "broadcast-line.no-consistent-homography",
    description:
      "No boundary hypothesis survived the quad sanity checks, or the best refined " +
        "homography failed validation (lineFit < 0.55 or backward chamfer > 12 px), " +
        "or the refined H is not invertible to image coordinates. Honest refusal: " +
        "not good enough to project with. Views lacking 2 touchline-role + 2 " +
        "goal-line-role lines land here (the documented partial-visibility limit).",
    retryable: false,
  },
  {
    failureClassId: "broadcast-line.ellipse-evidence-insufficient",
    description:
      "v0.4.0 ellipse path: the arc evidence (static-mask pixels unexplained by " +
        "detected lines) could not support ANY quota-passing conic fit — no " +
        "non-degenerate ellipse among the sampled subsets, or support/coverage " +
        "below the documented quota for every enumerated candidate (occluded " +
        "or partial circle, degenerate sliver view, or arc evidence below " +
        "quota). The primary's measured support and coverage numbers ride the " +
        "refusal details. Typed refusal, never a fabricated calibration.",
    retryable: false,
  },
  {
    failureClassId: "broadcast-line.ellipse-no-consistent-homography",
    description:
      "v0.4.0 ellipse path: quota-passing conic candidate(s) existed, but for " +
        "every candidate in the conic-selection chain no conic-anchored " +
        "hypothesis survived the guards, or the best refined homography failed " +
        "validation (the v0.1.0 lineFit/backward gates PLUS the ellipse " +
        "residual gates — the acceptance bar is never lowered for any " +
        "candidate). Both paths' measured reasons ride the refusal details, " +
        "with the per-candidate chain outcomes (conicChain) attached.",
    retryable: false,
  },
  {
    failureClassId: "broadcast-line.ellipse-conic-off-pitch",
    description:
      "v0.4.1 conic-selection chain (OPT-IN path only): a quota-passing conic " +
        "candidate's interior is not GRASS-supported — the MEDIAN over frames " +
        "of the per-frame green fraction inside the conic is below the " +
        "documented threshold. A pitch circle is a thin painted band ON grass " +
        "(its conic interior reads green in every frame); the goal/net " +
        "structure class (b3-a's winning conic, VLM-verified) is stably " +
        "non-green. The candidate is refused before its solve — the measured " +
        "median and sample count ride the refusal details. Typed refusal, " +
        "never a structure-anchored calibration.",
    retryable: false,
  },
  {
    failureClassId: "broadcast-line.ellipse-degenerate-grid",
    description:
      "v0.4.1 conic-selection chain (OPT-IN path only): the refined " +
        "homography passed every machine gate (lineFit, backward chamfer, " +
        "ellipse residual) but its PROJECTED PITCH GRID is degenerate — the " +
        "four canonical pitch corners project to a collapsed quad (area below " +
        "the conic's own ellipse area, corners within sub-pixel separation). " +
        "For any real camera homography the pitch's image CONTAINS the " +
        "circle's image (the conic) — the containment invariant; the measured " +
        "b3-a class is a point-collapse that collects the forward/backward/" +
        "ellipse rewards while mapping the entire pitch onto one image point " +
        "on the anchoring structure. The measured quad area, conic area, and " +
        "corner separation ride the refusal details. Typed refusal — the " +
        "claim is withheld, nothing laundered.",
    retryable: false,
  },
  {
    failureClassId: "broadcast-line.ellipse-anchor-unconvertible",
    description:
      "v0.5.0 anchor conversion (OPT-IN path only, E4b): the candidate's " +
        "anchors could not be converted into the J-orthogonal (Lorentz) " +
        "frame — either the conic's canonicalization refused (the " +
        "all-same-sign IMAGINARY signature class: a conic with no real " +
        "points cannot carry the x² + y² − z² = 0 form) or EVERY one of " +
        "the candidate's enumerated scan solves failed the conversion " +
        "guards (the admissibility bound: no scan solve's anchors were " +
        "near-conic-consistent; the closure self-check; the birth conic " +
        "guard; the conic hard guard). The per-candidate anchor record — " +
        "the scan solves enumerated and the count converted — rides the " +
        "refusal details. Typed refusal, never a fabricated closure.",
    retryable: false,
  },
];

/** Resource requirements: pure CPU, one core. */
export const BROADCAST_LINE_FIELD_CALIBRATOR_RESOURCES: ResourceRequirements = {
  gpuRequired: false,
  minCpuCores: 1,
};

// ---------------------------------------------------------------------------
// Frozen algorithm constants (each is part of the tested contract).
// ---------------------------------------------------------------------------

/** Dilations (3x3, border-replicate) of the per-frame green union. */
const GREEN_UNION_DILATIONS = 3;
/** Box taps for profile smoothing before cross-correlation. */
const PROFILE_SMOOTHING_TAPS = 9;
/**
 * Motion search window: integer shifts searched when correlating each
 * frame's green profiles against the anchor's. ±60 px (documented
 * deviation — see the module docs, step 2).
 */
const MOTION_SEARCH_LIMIT_PX = 60;
/** Motion refusal bound: the documented ±40 px compensation envelope. */
const MOTION_REFUSAL_LIMIT_PX = 40;
/** Local-mean radius for the line-mask local contrast: 13x13 box. */
const LOCAL_CONTRAST_RADIUS = 6;
/** Dilations (3x3) of each motion-compensated frame mask before counting. */
const MASK_DILATIONS = 2;
/** Static-mask threshold: pixel present in >= this fraction of frames. */
const STATIC_MASK_THRESHOLD = 0.5;
/** Minimum static line pixels to proceed (typed refusal below). */
const MIN_STATIC_LINE_PIXELS = 500;
/** Hough: theta bins over [0, π). */
const HOUGH_THETA_BINS = 180;
/**
 * Hough: maximum extracted peaks. 28 (not 16): the family split below
 * needs the WEAK minority-orientation lines too — on real 640x360 masks
 * the near-vertical family survives at ~50 votes while 16+ near-horizontal
 * peaks outrank it; a 16-line cap starves the minority family exactly where
 * it is needed (the measured R606 windows).
 */
/** Hough: per-orientation-family quota within the 28-line cap (see below). */
const HOUGH_FAMILY_QUOTA = 14;
/** Hough: suppression-iteration bound (quota-driven loop safety cap). */
const HOUGH_MAX_ITERATIONS = 160;
/** Hough: minimum votes for a peak to become a detected line. */
const HOUGH_MIN_VOTES = 30;
/**
 * Hough: minimum supporting-pixel extent along the line (px). 30 (not 60):
 * the minority-orientation (near-vertical) family on real 640x360 partial
 * views carries SHORT straight support — the halfway-line segments measured
 * ~38 px and the converging boundary segments ~50 px — and they are exactly
 * the anchors the family search needs; 60 (and even 40) rejected them all
 * and starved the search (measured R606). 30 px still implies line-ness;
 * blob noise rarely sustains 30 px of collinear support at >= 30 votes.
 */
const HOUGH_MIN_EXTENT_PX = 30;
/** Hough: supporting pixels lie within this distance of the line (px). */
const HOUGH_LINE_TOLERANCE_PX = 2.5;
/** Hough: peak suppression neighborhood, theta bins. */
const HOUGH_THETA_SUPPRESSION = 4;
/** Hough: peak suppression neighborhood, rho bins. */
const HOUGH_RHO_SUPPRESSION = 12;
/** Scoring: distance-to-model radius (m). */
const SCORE_RADIUS_M = 1.0;
/** Green containment: pitch + margin (m). */
const GREEN_CONTAINMENT_MARGIN_M = 3;
/** Hoardings suppression: rows above (green top row + this) are excluded. */
const HOARDINGS_ROW_MARGIN = 4;
/** Search + refinement forward scoring: subsample cap (points). */
const SEARCH_SCORE_MAX_POINTS = 2000;
/** Green-containment subsample cap (pixels). */
const GREEN_SAMPLE_MAX_POINTS = 2000;
/** Refinement: rounds of coordinate descent over h0..h7. */
const REFINEMENT_ROUNDS = 60;
/** Refinement: per-parameter step = max(|h_i| * this, STEP_FLOOR). */
const REFINEMENT_STEP_FRACTION = 0.008;
/** Refinement: step floor (only reachable for exactly-zero parameters). */
const REFINEMENT_STEP_FLOOR = 1e-5;
/** Validation: minimum acceptable lineFit (0.60: the behind-goal R606
 * window measured a 0.55-0.79 false-accept whose overlay was visually
 * misaligned — the gate is calibrated so a PASS means aligned). */
const VALIDATION_LINE_FIT_MIN = 0.6;
/** Validation: maximum acceptable backward chamfer (px). */
const VALIDATION_BACKWARD_MAX_PX = 10;
/** Plausible-view bound: pitch corners within [−1, 2]² normalized. */
const CORNER_BOUND = 1;

// ---------------------------------------------------------------------------
// The canonical pitch model (105 x 68) — lines, arcs, distance field.
// ---------------------------------------------------------------------------

/** One straight model marking, in canonical pitch meters. */
interface ModelSegment {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/**
 * One circular model marking (center circle or penalty arc), in canonical
 * pitch meters; `xMin`/`xMax` clip the circle to the painted arc (the
 * penalty arcs exist only OUTSIDE their penalty areas).
 */
interface ModelArc {
  readonly cx: number;
  readonly cy: number;
  readonly r: number;
  readonly xMin?: number;
  readonly xMax?: number;
}

/** Penalty-area front depth + half-heights (canonical 105 x 68 model). */
const PENALTY_FRONT_X = 16.5;
const PENALTY_HALF_HEIGHT = 20.16;
/** Goal-area front depth + half-heights (canonical 105 x 68 model). */
const GOAL_AREA_FRONT_X = 5.5;
const GOAL_AREA_HALF_HEIGHT = 9.16;
/** Center circle + penalty-arc radius (canonical model). */
const ARC_RADIUS_M = 9.15;
/** Penalty-spot centers, 11 m from each goal line. */
const PENALTY_SPOT_LEFT_X = 11;
const PENALTY_SPOT_RIGHT_X = 94;

const PITCH_LENGTH = 105;
const PITCH_WIDTH = 68;
const MID_X = PITCH_LENGTH / 2;
const MID_Y = PITCH_WIDTH / 2;

/** Every straight marking of the canonical model. */
const MODEL_SEGMENTS: readonly ModelSegment[] = [
  // Touchlines (y = 0 / y = 68) and goal lines (x = 0 / x = 105).
  { x0: 0, y0: 0, x1: PITCH_LENGTH, y1: 0 },
  { x0: 0, y0: PITCH_WIDTH, x1: PITCH_LENGTH, y1: PITCH_WIDTH },
  { x0: 0, y0: 0, x1: 0, y1: PITCH_WIDTH },
  { x0: PITCH_LENGTH, y0: 0, x1: PITCH_LENGTH, y1: PITCH_WIDTH },
  // Halfway line.
  { x0: MID_X, y0: 0, x1: MID_X, y1: PITCH_WIDTH },
  // Penalty-area fronts (x = 16.5 / 88.5, y 13.84..54.16).
  { x0: PENALTY_FRONT_X, y0: MID_Y - PENALTY_HALF_HEIGHT, x1: PENALTY_FRONT_X, y1: MID_Y + PENALTY_HALF_HEIGHT },
  { x0: PITCH_LENGTH - PENALTY_FRONT_X, y0: MID_Y - PENALTY_HALF_HEIGHT, x1: PITCH_LENGTH - PENALTY_FRONT_X, y1: MID_Y + PENALTY_HALF_HEIGHT },
  // Penalty-area tops/bottoms (goal line -> front, both ends).
  { x0: 0, y0: MID_Y - PENALTY_HALF_HEIGHT, x1: PENALTY_FRONT_X, y1: MID_Y - PENALTY_HALF_HEIGHT },
  { x0: 0, y0: MID_Y + PENALTY_HALF_HEIGHT, x1: PENALTY_FRONT_X, y1: MID_Y + PENALTY_HALF_HEIGHT },
  { x0: PITCH_LENGTH - PENALTY_FRONT_X, y0: MID_Y - PENALTY_HALF_HEIGHT, x1: PITCH_LENGTH, y1: MID_Y - PENALTY_HALF_HEIGHT },
  { x0: PITCH_LENGTH - PENALTY_FRONT_X, y0: MID_Y + PENALTY_HALF_HEIGHT, x1: PITCH_LENGTH, y1: MID_Y + PENALTY_HALF_HEIGHT },
  // Goal-area fronts (x = 5.5 / 99.5, y 24.84..43.16).
  { x0: GOAL_AREA_FRONT_X, y0: MID_Y - GOAL_AREA_HALF_HEIGHT, x1: GOAL_AREA_FRONT_X, y1: MID_Y + GOAL_AREA_HALF_HEIGHT },
  { x0: PITCH_LENGTH - GOAL_AREA_FRONT_X, y0: MID_Y - GOAL_AREA_HALF_HEIGHT, x1: PITCH_LENGTH - GOAL_AREA_FRONT_X, y1: MID_Y + GOAL_AREA_HALF_HEIGHT },
  // Goal-area tops/bottoms (goal line -> front, both ends).
  { x0: 0, y0: MID_Y - GOAL_AREA_HALF_HEIGHT, x1: GOAL_AREA_FRONT_X, y1: MID_Y - GOAL_AREA_HALF_HEIGHT },
  { x0: 0, y0: MID_Y + GOAL_AREA_HALF_HEIGHT, x1: GOAL_AREA_FRONT_X, y1: MID_Y + GOAL_AREA_HALF_HEIGHT },
  { x0: PITCH_LENGTH - GOAL_AREA_FRONT_X, y0: MID_Y - GOAL_AREA_HALF_HEIGHT, x1: PITCH_LENGTH, y1: MID_Y - GOAL_AREA_HALF_HEIGHT },
  { x0: PITCH_LENGTH - GOAL_AREA_FRONT_X, y0: MID_Y + GOAL_AREA_HALF_HEIGHT, x1: PITCH_LENGTH, y1: MID_Y + GOAL_AREA_HALF_HEIGHT },
];

/** Every circular marking: the center circle + both clipped penalty arcs. */
const MODEL_ARCS: readonly ModelArc[] = [
  { cx: MID_X, cy: MID_Y, r: ARC_RADIUS_M },
  { cx: PENALTY_SPOT_LEFT_X, cy: MID_Y, r: ARC_RADIUS_M, xMin: PENALTY_FRONT_X },
  { cx: PENALTY_SPOT_RIGHT_X, cy: MID_Y, r: ARC_RADIUS_M, xMax: PITCH_LENGTH - PENALTY_FRONT_X },
];

/** Point-to-segment distance, canonical pitch meters. */
function pointSegmentDistance(
  px: number,
  py: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): number {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const lengthSquared = dx * dx + dy * dy;
  let t = 0;
  if (lengthSquared > 0) {
    t = Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / lengthSquared));
  }
  return Math.hypot(px - (x0 + t * dx), py - (y0 + t * dy));
}

/** Point-to-clipped-arc distance, canonical pitch meters. */
function pointArcDistance(px: number, py: number, arc: ModelArc): number {
  const vx = px - arc.cx;
  const vy = py - arc.cy;
  const distance = Math.hypot(vx, vy);
  if (distance > 1e-12) {
    const nx = vx / distance;
    const onX = (arc.xMin === undefined || arc.cx + arc.r * nx >= arc.xMin) &&
      (arc.xMax === undefined || arc.cx + arc.r * nx <= arc.xMax);
    if (onX) return Math.abs(distance - arc.r);
  } else if (arc.xMin === undefined && arc.xMax === undefined) {
    return arc.r;
  }
  // Nearest point is an arc endpoint: the clip planes' chord ends.
  let best = Number.POSITIVE_INFINITY;
  for (const clip of [arc.xMin, arc.xMax]) {
    if (clip === undefined) continue;
    const halfChord = Math.sqrt(Math.max(0, arc.r * arc.r - (clip - arc.cx) ** 2));
    for (const sign of [-1, 1]) {
      best = Math.min(best, Math.hypot(px - clip, py - (arc.cy + sign * halfChord)));
    }
  }
  return best;
}

/** Distance-field grid constants: 0.5 m cells over [−5, 110] × [−5, 73]. */
const FIELD_ORIGIN_M = -5;
const FIELD_CELL_M = 0.5;
const FIELD_COLS = 230;
const FIELD_ROWS = 156;

/**
 * The pitch-plane distance field to ALL model lines + arcs, memoized at
 * module level: it is a pure function of the frozen canonical model (no
 * input dependency), so the cache is deterministic — identical values on
 * every call. Nearest-cell lookup (<= 0.25 m per-axis quantization).
 */
let cachedDistanceField: Float32Array | undefined;

function pitchModelDistanceField(): Float32Array {
  if (cachedDistanceField === undefined) {
    const field = new Float32Array(FIELD_COLS * FIELD_ROWS);
    for (let row = 0; row < FIELD_ROWS; row += 1) {
      const y = FIELD_ORIGIN_M + (row + 0.5) * FIELD_CELL_M;
      for (let col = 0; col < FIELD_COLS; col += 1) {
        const x = FIELD_ORIGIN_M + (col + 0.5) * FIELD_CELL_M;
        let best = Number.POSITIVE_INFINITY;
        for (const segment of MODEL_SEGMENTS) {
          best = Math.min(best, pointSegmentDistance(x, y, segment.x0, segment.y0, segment.x1, segment.y1));
        }
        for (const arc of MODEL_ARCS) {
          best = Math.min(best, pointArcDistance(x, y, arc));
        }
        field[row * FIELD_COLS + col] = best;
      }
    }
    cachedDistanceField = field;
  }
  return cachedDistanceField;
}

/** Distance (m) from a pitch point to the nearest model line/arc. */
function modelDistanceAt(x: number, y: number): number {
  const field = pitchModelDistanceField();
  const col = Math.min(
    FIELD_COLS - 1,
    Math.max(0, Math.round((x - FIELD_ORIGIN_M) / FIELD_CELL_M - 0.5)),
  );
  const row = Math.min(
    FIELD_ROWS - 1,
    Math.max(0, Math.round((y - FIELD_ORIGIN_M) / FIELD_CELL_M - 0.5)),
  );
  return field[row * FIELD_COLS + col]!;
}

/** Model sampling step for the backward chamfer term (m along the line). */
const MODEL_SAMPLE_STEP_M = 0.5;

/**
 * Model line sample points (pitch meters, `[x, y, ...]`), every
 * MODEL_SAMPLE_STEP_M along every segment and arc — memoized at module
 * level (a pure function of the frozen model, deterministic).
 */
let cachedModelSamples: Float64Array | undefined;

function pitchModelSamplePoints(): Float64Array {
  if (cachedModelSamples === undefined) {
    const points: number[] = [];
    for (const segment of MODEL_SEGMENTS) {
      const length = Math.hypot(segment.x1 - segment.x0, segment.y1 - segment.y0);
      const steps = Math.max(1, Math.ceil(length / MODEL_SAMPLE_STEP_M));
      for (let step = 0; step <= steps; step += 1) {
        const t = step / steps;
        points.push(segment.x0 + (segment.x1 - segment.x0) * t, segment.y0 + (segment.y1 - segment.y0) * t);
      }
    }
    for (const arc of MODEL_ARCS) {
      // The visible angle span: full circle, or the clipped arc sector.
      let angle0 = 0;
      let angleSpan = Math.PI * 2;
      if (arc.xMin !== undefined) {
        const half = Math.acos(Math.min(1, Math.max(-1, (arc.xMin - arc.cx) / arc.r)));
        angle0 = -half;
        angleSpan = 2 * half;
      } else if (arc.xMax !== undefined) {
        const half = Math.acos(Math.min(1, Math.max(-1, (arc.cx - arc.xMax) / arc.r)));
        angle0 = Math.PI - half;
        angleSpan = 2 * half;
      }
      const arcLength = arc.r * angleSpan;
      const steps = Math.max(1, Math.ceil(arcLength / MODEL_SAMPLE_STEP_M));
      for (let step = 0; step <= steps; step += 1) {
        const angle = angle0 + (angleSpan * step) / steps;
        points.push(arc.cx + arc.r * Math.cos(angle), arc.cy + arc.r * Math.sin(angle));
      }
    }
    cachedModelSamples = Float64Array.from(points);
  }
  return cachedModelSamples;
}

// ---------------------------------------------------------------------------
// Pure pixel machinery (fixed scan orders, no allocation-visible state).
// ---------------------------------------------------------------------------

/**
 * Binary 3x3 dilation, `iterations` rounds, border-replicate edges
 * (documented: clamped coordinates behave as replicated borders).
 * Returns a NEW mask (the input is never mutated). Deterministic.
 */
function dilate3x3(
  mask: Uint8Array,
  width: number,
  height: number,
  iterations: number,
): Uint8Array {
  let current = mask;
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const next = new Uint8Array(width * height);
    for (let y = 0; y < height; y += 1) {
      const up = y > 0 ? y - 1 : y;
      const down = y < height - 1 ? y + 1 : y;
      for (let x = 0; x < width; x += 1) {
        const index = y * width + x;
        if (current[index] !== 0) {
          next[index] = 1;
          continue;
        }
        const left = x > 0 ? x - 1 : x;
        const right = x < width - 1 ? x + 1 : x;
        if (
          current[up * width + left] !== 0 ||
          current[up * width + x] !== 0 ||
          current[up * width + right] !== 0 ||
          current[y * width + left] !== 0 ||
          current[y * width + right] !== 0 ||
          current[down * width + left] !== 0 ||
          current[down * width + x] !== 0 ||
          current[down * width + right] !== 0
        ) {
          next[index] = 1;
        }
      }
    }
    current = next;
  }
  return current;
}

/**
 * Shifts a mask's content by (−dx, −dy): `out(x, y) = mask(x + dx, y + dy)`
 * — the frame's content (measured at +dx/+dy relative to the anchor) moves
 * back into anchor coordinates. Out-of-range source pixels read as 0.
 * Deterministic.
 */
function shiftMask(
  mask: Uint8Array,
  width: number,
  height: number,
  dx: number,
  dy: number,
): Uint8Array {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < height; y += 1) {
    const sourceY = y + dy;
    if (sourceY < 0 || sourceY >= height) continue;
    for (let x = 0; x < width; x += 1) {
      const sourceX = x + dx;
      if (sourceX < 0 || sourceX >= width) continue;
      out[y * width + x] = mask[sourceY * width + sourceX]!;
    }
  }
  return out;
}

/**
 * One frame's green mask (row-major scan) — `isPitchGreen` per pixel.
 * Deterministic.
 */
function greenMaskOf(frame: DetectorFrameInput): Uint8Array {
  const { width, height, bytes } = frame;
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 3;
      if (isPitchGreen(bytes[index]!, bytes[index + 1]!, bytes[index + 2]!)) {
        mask[y * width + x] = 1;
      }
    }
  }
  return mask;
}

/**
 * One frame's green profiles: per-column and per-row green counts
 * (row-major scan). Deterministic.
 */
function greenProfiles(
  mask: Uint8Array,
  width: number,
  height: number,
): { column: Float64Array; row: Float64Array } {
  const column = new Float64Array(width);
  const row = new Float64Array(height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (mask[y * width + x] !== 0) {
        column[x]! += 1;
        row[y]! += 1;
      }
    }
  }
  return { column, row };
}

/**
 * Smooths a profile with a zero-padded 9-tap box (each output = the mean
 * of the 9 window values; out-of-range taps read as 0). Deterministic.
 */
function boxSmooth9(profile: Float64Array): Float64Array {
  const smoothed = new Float64Array(profile.length);
  const half = Math.floor(PROFILE_SMOOTHING_TAPS / 2);
  for (let i = 0; i < profile.length; i += 1) {
    let sum = 0;
    for (let k = -half; k <= half; k += 1) {
      const j = i + k;
      if (j >= 0 && j < profile.length) sum += profile[j]!;
    }
    smoothed[i] = sum / PROFILE_SMOOTHING_TAPS;
  }
  return smoothed;
}

/**
 * The integer shift in [−limit, +limit] maximizing the dot product
 * `Σ frame(x + s) · anchor(x)` (out-of-range reads as 0) — the frame's
 * content translation relative to the anchor. Ascending scan with strict
 * `>` (the SMALLEST maximizing shift wins ties; deterministic). The
 * correlation peaks where the profiles align: content translated by t
 * maximizes at s = t.
 */
function bestProfileShift(frame: Float64Array, anchor: Float64Array, limit: number): number {
  let bestShift = 0;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (let shift = -limit; shift <= limit; shift += 1) {
    let dot = 0;
    for (let x = 0; x < anchor.length; x += 1) {
      const shifted = x + shift;
      if (shifted < 0 || shifted >= frame.length) continue;
      dot += frame[shifted]! * anchor[x]!;
    }
    if (dot > bestScore) {
      bestScore = dot;
      bestShift = shift;
    }
  }
  return bestShift;
}

/**
 * One frame's line mask: LOCAL CONTRAST — integral image of brightness
 * (r+g+b) gives the local mean over a 13x13 edge-clamped box; a pixel is
 * a line pixel when `brightness − localMean > contrastThreshold` AND it
 * lies inside the dilated green union. Integer-exact comparison:
 * `b3 * boxCount − boxSum > 3 * threshold * boxCount`. Deterministic
 * (row-major scan).
 */
function lineMaskOf(
  frame: DetectorFrameInput,
  dilatedGreenUnion: Uint8Array,
  contrastThreshold: number,
): Uint8Array {
  const { width, height, bytes } = frame;
  const stride = width + 1;
  const integral = new Int32Array(stride * (height + 1));
  for (let y = 0; y < height; y += 1) {
    let rowSum = 0;
    for (let x = 0; x < width; x += 1) {
      const pixel = (y * width + x) * 3;
      rowSum += bytes[pixel]! + bytes[pixel + 1]! + bytes[pixel + 2]!;
      integral[(y + 1) * stride + (x + 1)] = integral[y * stride + (x + 1)]! + rowSum;
    }
  }
  const mask = new Uint8Array(width * height);
  const thresholdTimes3 = 3 * contrastThreshold;
  for (let y = 0; y < height; y += 1) {
    const boxY0 = Math.max(0, y - LOCAL_CONTRAST_RADIUS);
    const boxY1 = Math.min(height - 1, y + LOCAL_CONTRAST_RADIUS);
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (dilatedGreenUnion[index] === 0) continue;
      const boxX0 = Math.max(0, x - LOCAL_CONTRAST_RADIUS);
      const boxX1 = Math.min(width - 1, x + LOCAL_CONTRAST_RADIUS);
      const boxCount = (boxX1 - boxX0 + 1) * (boxY1 - boxY0 + 1);
      const boxSum =
        integral[(boxY1 + 1) * stride + (boxX1 + 1)]! -
        integral[boxY0 * stride + (boxX1 + 1)]! -
        integral[(boxY1 + 1) * stride + boxX0]! +
        integral[boxY0 * stride + boxX0]!;
      const brightness3 =
        bytes[index * 3]! + bytes[index * 3 + 1]! + bytes[index * 3 + 2]!;
      if (brightness3 * boxCount - boxSum > thresholdTimes3 * boxCount) {
        mask[index] = 1;
      }
    }
  }
  return mask;
}

/**
 * 2-pass 3-4 chamfer distance transform of a binary mask, in pixels
 * (forward pass top-left → bottom-right, backward pass reversed; the 3-4
 * weights are divided by 3). Deterministic.
 */
function chamferDistanceTransform(mask: Uint8Array, width: number, height: number): Float64Array {
  const large = Number.POSITIVE_INFINITY;
  const distance = new Float64Array(mask.length);
  for (let i = 0; i < mask.length; i += 1) distance[i] = mask[i] !== 0 ? 0 : large;
  const at = (x: number, y: number): number =>
    x < 0 || x >= width || y < 0 || y >= height ? large : distance[y * width + x]!;
  // Forward pass: west, north, north-west, north-east.
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (distance[index] === 0) continue;
      distance[index] = Math.min(
        distance[index]!,
        at(x - 1, y) + 3,
        at(x, y - 1) + 3,
        at(x - 1, y - 1) + 4,
        at(x + 1, y - 1) + 4,
      );
    }
  }
  // Backward pass: east, south, south-east, south-west.
  for (let y = height - 1; y >= 0; y -= 1) {
    for (let x = width - 1; x >= 0; x -= 1) {
      const index = y * width + x;
      if (distance[index] === 0) continue;
      distance[index] = Math.min(
        distance[index]!,
        at(x + 1, y) + 3,
        at(x, y + 1) + 3,
        at(x + 1, y + 1) + 4,
        at(x - 1, y + 1) + 4,
      );
    }
  }
  for (let i = 0; i < distance.length; i += 1) {
    distance[i] = distance[i]! === large ? large : distance[i]! / 3;
  }
  return distance;
}

// ---------------------------------------------------------------------------
// Hough line extraction.
// ---------------------------------------------------------------------------

/** One Hough-extracted line: theta/rho (px), votes, support statistics. */
interface HoughLine {
  /** Line angle in radians: rho = x·cosθ + y·sinθ. */
  readonly theta: number;
  /** Signed perpendicular distance from the origin (px). */
  readonly rho: number;
  /** Accumulator votes at the extracted peak. */
  readonly votes: number;
  /** Mean supporting-pixel x (px) — the ordering-prior statistic. */
  readonly meanX: number;
  /** Mean supporting-pixel y (px) — the ordering-prior statistic. */
  readonly meanY: number;
}

/**
 * Iterative Hough peak extraction over the static pixel list (`[x, y, ...]`
 * pairs, row-major order): 180 theta bins over [0, π), integer rho over
 * [−diag, diag]; every static pixel votes for every theta; peaks are taken
 * by accumulator max (first in (theta, rho) scan order on ties), suppressed
 * theta ±4 × rho ±12, up to 16 peaks; a peak becomes a detected line when
 * votes >= 30 AND the supporting pixels (within 2.5 px) span >= 60 px.
 * Deterministic.
 */
function houghExtractLines(
  staticPixels: readonly number[],
  width: number,
  height: number,
): HoughLine[] {
  const cos = new Float64Array(HOUGH_THETA_BINS);
  const sin = new Float64Array(HOUGH_THETA_BINS);
  for (let theta = 0; theta < HOUGH_THETA_BINS; theta += 1) {
    const angle = (theta * Math.PI) / HOUGH_THETA_BINS;
    cos[theta] = Math.cos(angle);
    sin[theta] = Math.sin(angle);
  }
  const diagonal = Math.ceil(Math.hypot(width, height));
  const rhoBins = 2 * diagonal + 1;
  const accumulator = new Int32Array(HOUGH_THETA_BINS * rhoBins);
  for (let p = 0; p < staticPixels.length; p += 2) {
    const x = staticPixels[p]!;
    const y = staticPixels[p + 1]!;
    for (let theta = 0; theta < HOUGH_THETA_BINS; theta += 1) {
      const rho = Math.round(x * cos[theta]! + y * sin[theta]!);
      accumulator[theta * rhoBins + rho + diagonal]! += 1;
    }
  }
  const lines: HoughLine[] = [];
  let horizontalQuota = HOUGH_FAMILY_QUOTA;
  let verticalQuota = HOUGH_FAMILY_QUOTA;
  let iterations = 0;
  // Iteration bound: the loop is QUOTA-driven (it continues suppressing
  // majority-family peaks past the extraction cap so minority-family peaks
  // can surface); the bound guards pathological accumulator landscapes.
  while (iterations < HOUGH_MAX_ITERATIONS) {
    iterations += 1;
    if (horizontalQuota <= 0 && verticalQuota <= 0) break;
    // Scan-order max: the first (theta, rho) in scan order wins ties.
    let bestTheta = -1;
    let bestRhoIndex = -1;
    let bestVotes = 0;
    for (let theta = 0; theta < HOUGH_THETA_BINS; theta += 1) {
      const base = theta * rhoBins;
      for (let rhoIndex = 0; rhoIndex < rhoBins; rhoIndex += 1) {
        const votes = accumulator[base + rhoIndex]!;
        if (votes > bestVotes) {
          bestVotes = votes;
          bestTheta = theta;
          bestRhoIndex = rhoIndex;
        }
      }
    }
    // Early stop (documented): sub-30 peaks can never pass the vote filter.
    if (bestVotes < HOUGH_MIN_VOTES) break;
    const theta = bestTheta;
    const rho = bestRhoIndex - diagonal;
    // PER-FAMILY QUOTA (the starvation fix): every peak is ALWAYS
    // suppressed (below), but a peak whose orientation family's quota is
    // full is not EXTRACTED — the weaker minority family (the near-vertical
    // anchors on real broadcast partial views, measured at ~31-55 votes
    // against 43-312 for the horizontal fan cluster) still gets its share
    // of the cap. A single shared 28-line cap let the fan cluster of arc
    // segments occupy every slot and starved the vertical family to zero
    // (measured R606).
    const thetaDegrees = (theta * 180) / HOUGH_THETA_BINS;
    const familyIsHorizontal = thetaDegrees >= 40 && thetaDegrees <= 140;
    const familyQuotaRemaining = familyIsHorizontal ? horizontalQuota : verticalQuota;
    // Suppress the neighborhood (no cyclic theta wrap; clamped bounds).
    const thetaLow = Math.max(0, bestTheta - HOUGH_THETA_SUPPRESSION);
    const thetaHigh = Math.min(HOUGH_THETA_BINS - 1, bestTheta + HOUGH_THETA_SUPPRESSION);
    const rhoLow = Math.max(0, bestRhoIndex - HOUGH_RHO_SUPPRESSION);
    const rhoHigh = Math.min(rhoBins - 1, bestRhoIndex + HOUGH_RHO_SUPPRESSION);
    for (let t = thetaLow; t <= thetaHigh; t += 1) {
      for (let r = rhoLow; r <= rhoHigh; r += 1) {
        accumulator[t * rhoBins + r] = -1;
      }
    }
    // Support pass: pixels within HOUGH_LINE_TOLERANCE_PX of the line.
    const c = cos[theta]!;
    const s = sin[theta]!;
    let count = 0;
    let sumX = 0;
    let sumY = 0;
    let minAlong = Number.POSITIVE_INFINITY;
    let maxAlong = Number.NEGATIVE_INFINITY;
    for (let p = 0; p < staticPixels.length; p += 2) {
      const x = staticPixels[p]!;
      const y = staticPixels[p + 1]!;
      if (Math.abs(x * c + y * s - rho) <= HOUGH_LINE_TOLERANCE_PX) {
        const along = -x * s + y * c;
        count += 1;
        sumX += x;
        sumY += y;
        if (along < minAlong) minAlong = along;
        if (along > maxAlong) maxAlong = along;
      }
    }
    const extent = count > 0 ? maxAlong - minAlong : 0;
    if (count > 0 && extent >= HOUGH_MIN_EXTENT_PX && familyQuotaRemaining > 0) {
      lines.push({ theta: (theta * Math.PI) / HOUGH_THETA_BINS, rho, votes: bestVotes, meanX: sumX / count, meanY: sumY / count });
      if (familyIsHorizontal) horizontalQuota -= 1;
      else verticalQuota -= 1;
    }
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Hypothesis search machinery.
// ---------------------------------------------------------------------------

/** Pixel Point2D -> normalized [0, 1] image coordinates. Deterministic. */
function normalized(point: Point2D, width: number, height: number): Point2D {
  return { x: point.x / width, y: point.y / height };
}

/**
 * Intersects two Hough lines; `undefined` when (near-)parallel. Pixel
 * coordinates. Deterministic.
 */
function intersectHoughLines(a: HoughLine, b: HoughLine): Point2D | undefined {
  const det = Math.cos(a.theta) * Math.sin(b.theta) - Math.cos(b.theta) * Math.sin(a.theta);
  if (Math.abs(det) < 1e-9) return undefined;
  const x = (a.rho * Math.sin(b.theta) - b.rho * Math.sin(a.theta)) / det;
  const y = (Math.cos(a.theta) * b.rho - Math.cos(b.theta) * a.rho) / det;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
  return { x, y };
}

/**
 * Quad sanity (normalized coordinates): all four corners finite and within
 * the plausible-view bounds [−1, 2]²; strictly convex (the four
 * consecutive-edge cross products share a sign); no three corners
 * collinear (each cross exceeds the degeneracy epsilon — the same
 * computation covers both). Deterministic.
 */
function quadIsSane(corners: readonly Point2D[]): boolean {
  for (const corner of corners) {
    if (!Number.isFinite(corner.x) || !Number.isFinite(corner.y)) return false;
    if (corner.x < -CORNER_BOUND || corner.x > 2 || corner.y < -CORNER_BOUND || corner.y > 2) {
      return false;
    }
  }
  let orientation = 0;
  for (let k = 0; k < 4; k += 1) {
    const p0 = corners[k]!;
    const p1 = corners[(k + 1) % 4]!;
    const p2 = corners[(k + 2) % 4]!;
    const cross = (p1.x - p0.x) * (p2.y - p1.y) - (p1.y - p0.y) * (p2.x - p1.x);
    if (Math.abs(cross) <= 1e-9) return false;
    const sign = cross > 0 ? 1 : -1;
    if (orientation === 0) orientation = sign;
    else if (sign !== orientation) return false;
  }
  return true;
}

/**
 * Safe (non-throwing) projection for SEARCH/SCORING inner loops: `undefined`
 * maps to "outlier" (a point at infinity is never within 1 m of a model
 * line). The canonical W203 `applyHomography` remains the contract
 * boundary; this local helper exists so enumeration loops never throw.
 * Assumes the canonical `h[8] = 1` form (always true in this module).
 */
function projectSafe(h: Homography, u: number, v: number): { x: number; y: number } | undefined {
  const denominator = h[6]! * u + h[7]! * v + 1;
  if (Math.abs(denominator) < 1e-12) return undefined;
  return {
    x: (h[0]! * u + h[1]! * v + h[2]!) / denominator,
    y: (h[3]! * u + h[4]! * v + h[5]!) / denominator,
  };
}

// ---------------------------------------------------------------------------
// The generalized family hypothesis search (step 6).
// ---------------------------------------------------------------------------

/**
 * The pitch model's two parallel line FAMILIES (canonical meters). Every
 * painted straight marking belongs to exactly one: the x-family runs along
 * the pitch WIDTH at a constant x; the y-family runs along the LENGTH at a
 * constant y. Under ANY projective camera the images of one family's lines
 * stay mutually non-crossing in the visible region, so a detected-line pair
 * from one image orientation family can anchor a MODEL pair from one family
 * — the (2+2)-line rectangle grid: the four pairwise intersections are the
 * image of a known model rectangle, and `solveHomography` closes over the
 * four corner correspondences. The full-pitch boundary quad (touchlines ×
 * goal lines) is the special case (0, 105) x (0, 68).
 */
const MODEL_X_FAMILY: readonly number[] = [
  0,
  GOAL_AREA_FRONT_X,
  PENALTY_FRONT_X,
  52.5,
  105 - PENALTY_FRONT_X,
  105 - GOAL_AREA_FRONT_X,
  105,
];
const MODEL_Y_FAMILY: readonly number[] = [
  0,
  34 - PENALTY_HALF_HEIGHT,
  34 - GOAL_AREA_HALF_HEIGHT,
  34 + GOAL_AREA_HALF_HEIGHT,
  34 + PENALTY_HALF_HEIGHT,
  68,
];

/** Image-orientation family split: theta (line NORMAL angle) in degrees. */
function lineThetaDegrees(line: HoughLine): number {
  return (line.theta * 180) / Math.PI;
}
/** `true` when the line's DIRECTION is near-horizontal (normal 40°-140°). */
function isHorizontalish(line: HoughLine): boolean {
  const deg = lineThetaDegrees(line);
  return deg >= 40 && deg <= 140;
}
/**
 * Angle between two lines' DIRECTIONS (degrees, [0, 90]). Lines whose
 * directions differ by less than the hypothesis guard never form a
 * rectangle grid — near-parallel families are the documented degeneracy
 * the boundary-only search fell into on real partial-visibility masks.
 */
function lineDirectionAngle(line: HoughLine): number {
  return lineThetaDegrees(line) + 90;
}
function directionAngleDelta(a: number, b: number): number {
  let delta = Math.abs(((a - b) % 180) + 180) % 180;
  if (delta > 90) delta = 180 - delta;
  return delta;
}

/**
 * Aspect-ratio consistency (the model-pair prune): the ratio of the two
 * image side lengths of the corner grid must be within a factor of
 * `ASPECT_TOLERANCE` of the model rectangle's side ratio — perspective
 * warps aspect, but not by unbounded factors within one view.
 */
const ASPECT_TOLERANCE = 1.2;
function aspectIsConsistent(
  imageSideA: number,
  imageSideB: number,
  modelSideA: number,
  modelSideB: number,
): boolean {
  if (imageSideA <= 1e-6 || imageSideB <= 1e-6 || modelSideA <= 0 || modelSideB <= 0) return false;
  return Math.abs(Math.log(imageSideA / imageSideB) - Math.log(modelSideA / modelSideB)) <= ASPECT_TOLERANCE;
}

/** Hypothesis families: max lines per orientation family entering the search. */
const FAMILY_MAX_LINES = 6;
/** Hypothesis guard: minimum direction angle between the two line pairs. */
const FAMILY_MIN_ANGLE_DEG = 20;
/** Quick-score subsample (points) during hypothesis enumeration. */
const QUICK_SCORE_POINTS = 96;
/** Hypotheses promoted from quick score to the full-score pass. */
const HYPOTHESIS_FINALISTS = 8;
/** Projection-spread guard (the anti-collapse guard, meters). */
const SPREAD_MIN_X_M = 20;
const SPREAD_MIN_Y_M = 8;
/** Quick green-containment floor during enumeration. */
const QUICK_GREEN_MIN = 0.35;
/**
 * Ellipse-path anti-collapse guard: the PERCENTILE spread (p90 − p10) of
 * the scored pixels' projections must span the visible pitch region. The
 * v0.1.0 min/max spread is ineffective on conic-anchored hypotheses — a
 * collapsed mapping (measured: the whole pitch compressed onto a ~10 m
 * blob) still shows a huge min/max spread because a few outlying
 * projections fly hundreds of meters away; the percentile spread is
 * robust to exactly those outliers.
 */
const ELLIPSE_SPREAD_PERCENTILE_MIN_X_M = 20;
const ELLIPSE_SPREAD_PERCENTILE_MIN_Y_M = 8;

// ---------------------------------------------------------------------------
// v0.2.0 — the ellipse/circle-constrained path (frozen constants; each is
// part of the tested contract).
// ---------------------------------------------------------------------------

/**
 * Arc evidence: a static pixel within this distance (px) of any detected
 * Hough line is "explained" as straight-line evidence and excluded from
 * the conic fit. 2 (not 3): with the run-length + component filters
 * guarding the fragments, a tighter radius recovers the circle band
 * beside the arc-chord Hough lines (measured: the 3 px radius left only
 * the bottom ~40% of the band, starving the minor axis).
 */
const ELLIPSE_LINE_EXPLAIN_PX = 2;
/**
 * v0.3.0 — the straightness-aware explain threshold (the flank-recovery
 * increment). A Hough line may explain arc-band pixels ONLY along
 * contiguous stretches where static pixels lie within
 * ELLIPSE_LINE_EXPLAIN_PX of the line for at least this many px ALONG
 * the line direction. Measured bounds (the ELLIPSE_RUN_MAX_PX note):
 * the flattest sliver-ellipse flank runs nearly straight ~110 px; real
 * touchlines run 200-600 px. The arc-chord Hough lines (chords THROUGH
 * the near-straight circle flank — the lines the v0.2.0 radius-explain
 * let eat the band, leaving one flank) max out below this threshold:
 * the flank's arc evidence SURVIVES them. 140 splits the classes the
 * same way ELLIPSE_RUN_MAX_PX (150) does for axis-aligned runs.
 */
const ELLIPSE_LINE_STRAIGHT_SUPPORT_PX = 140;
/**
 * Arc evidence: the RUN-LENGTH curvature pre-filter. A static pixel whose
 * horizontal row-run OR vertical column-run (contiguous static pixels
 * through it) exceeds this length belongs to a LONG STRAIGHT structure
 * (touchlines, the halfway line), not to the ~6 px-wide curved circle
 * band. 150 (not 60): the flattest parts of a sliver ellipse run nearly
 * straight for ~2·sqrt(2·(a²/b)·3) ≈ 110 px (measured: the 60 px filter
 * deleted the whole bottom band — the parametric-coverage gap — while
 * the touchline strips it exists to kill run 200-600 px). Without this
 * filter the Hough
 * explain radius faces a measured dilemma: 3 px leaves far-side strips of
 * the dilated touchline bands (long straight outliers that wreck the
 * conic subsets); 5 px eats the circle band beside the arc-chord Hough
 * lines (arcPixels 1523 → 434, coverage collapse).
 */
const ELLIPSE_RUN_MAX_PX = 150;
/** Arc evidence: minimum residual pixels to attempt a conic fit at all. */
const ELLIPSE_MIN_ARC_PIXELS = 30;
/**
 * Arc evidence: connected-component dominance filter. After the run-length
 * and Hough-line filters, short straight fragments that ENTER at the frame
 * edge (measured: a left-edge penalty-line sliver, ~150 px vs the circle's
 * ~600 px) remain as high-leverage outliers — a plain 12-point least
 * squares over subsets containing 2-3 of them collapses (measured: every
 * subset conic missed the truth; trimmed LS stayed in the wrong basin).
 * The center circle is the DOMINANT connected curved structure (the R606
 * record: "strongly detected"): components below this fraction of the
 * LARGEST component's size are dropped, as are specks below 20 px.
 */
const ELLIPSE_COMPONENT_DOMINANCE = 0.4;
/** Arc evidence: absolute speck floor per connected component (px). */
const ELLIPSE_COMPONENT_MIN_PX = 20;
/** RANSAC conic fit: total subsets sampled (stratified + LCG). */
const ELLIPSE_FIT_SUBSETS = 512;
/** RANSAC conic fit: stratified (block-spread) subsets among the total. */
const ELLIPSE_FIT_STRUCTURED_SUBSETS = 128;
/**
 * RANSAC conic fit: points per subset — 12, NOT the minimal 5. Broadcast
 * sliver ellipses (e.g. 100x19 px) make exact 5-point conics wildly
 * sensitive to the ±3 px band noise (the minor axis is pinned by 1-2
 * flank points); over-determined constrained least squares over 12 spread
 * points is the measured fix (the 5-point variants never approximated the
 * true conic on the synthetic arc window).
 */
const ELLIPSE_FIT_SUBSET_POINTS = 12;
/** RANSAC conic fit: fixed LCG seed (integer arithmetic, byte-deterministic). */
const ELLIPSE_LCG_SEED = 0x2f6e2b1;
/** RANSAC conic fit: arc pixel counts as support within this conic distance (px). */
const ELLIPSE_FIT_TOLERANCE_PX = 4;
/**
 * RANSAC conic fit: minimum 2-D spread of a subset (smallest covariance
 * eigenvalue ≥ this², px). 3 (not 6): the arc band of a sliver ellipse is
 * legitimately ~20 px tall (variance ≈ 33), which a 6 px floor rejects —
 * measured: 495 of 512 subsets spread-rejected, the fit starved.
 */
const ELLIPSE_SUBSET_SPREAD_PX = 3;
/** RANSAC conic fit: top subset conics re-fit over their support sets. */
const ELLIPSE_FIT_REFIT_CANDIDATES = 8;
/**
 * v0.4.0 — the conic-selection chain cap (the primary + up to this many
 * DISTINCT alternatives). Bounded so the fallback cost stays O(1) per
 * window in the chain length; the chain only runs after the primary's
 * typed refusal (measured: the alternatives that matter — the dropped
 * sub-dominant components and the ranked refit runners-up — number 1-3
 * on the real windows).
 */
const ELLIPSE_MAX_CONIC_CANDIDATES = 4;
/**
 * v0.4.0 — conic distinctness: minimum center distance (px) for two
 * candidate conics to count as DISTINCT chain members.
 */
const ELLIPSE_CONIC_DISTINCT_CENTER_PX = 20;
/** v0.4.0 — conic distinctness: minimum semi-axis difference (px). */
const ELLIPSE_CONIC_DISTINCT_SEMI_PX = 15;
/** v0.4.0 — conic distinctness: minimum rotation difference (degrees). */
const ELLIPSE_CONIC_DISTINCT_ROTATION_DEG = 12;
/**
 * Conic fit: the EM-style band re-extraction radius (px). The arc evidence
 * loses the band beside the arc-chord Hough lines (measured: only the
 * bottom ~2/3 of the band survived, biasing the minor axis 19.3 → 15 px);
 * after the RANSAC winner, the FULL band is re-extracted from the static
 * mask around the fitted conic and the fit repeated — the measured fix for
 * that bias.
 */
const ELLIPSE_BAND_REEXTRACT_PX = 7;
/** Conic fit: EM re-extraction iterations. */
const ELLIPSE_BAND_REEXTRACT_ITERATIONS = 2;
/** Conic sanity: minimum semi-axis (px) — slivers below this are degenerate. */
const ELLIPSE_MIN_SEMI_AXIS_PX = 6;
/** Conic sanity: maximum semi-axis (px) — 1.5x the frame diagonal. */
const ELLIPSE_MAX_SEMI_AXIS_FACTOR = 1.5;
/** Conic sanity: maximum axis ratio (major/minor). */
const ELLIPSE_MAX_AXIS_RATIO = 15;
/** Evidence quota: minimum supporting arc pixels. */
const ELLIPSE_MIN_SUPPORT_PX = 90;
/** Evidence quota: angular coverage bins (of 36, 10° each) that must be occupied. */
const ELLIPSE_MIN_COVERAGE_BINS = 12;
/** Evidence quota: pixels per 10° bin to count it occupied. */
const ELLIPSE_BIN_OCCUPANCY_PX = 2;
/** Hypothesis enumeration: max lines per image-orientation family entering the ellipse search. */
const ELLIPSE_FAMILY_MAX_LINES = 4;
/** Hypothesis enumeration: polar-line/circle intersection margin (m). */
const ELLIPSE_POLAR_CIRCLE_MARGIN_M = 0.5;
/** Refinement: ellipse term tolerance (px) — the soft gradient scale. */
const ELLIPSE_REFINE_TOLERANCE_PX = 8;
/**
 * Refinement (ellipse path): the SMOOTH forward term's distance radius
 * (m). The v0.1.0 binary forward score (within 1.0 m of a model line) has
 * NO gradient at the ~2-3 m misalignment the Hough-quantized anchors start
 * from — the descent stalled at lineFit 0.456 (measured). The smooth term
 * mean-clamps the scored pixels' model distances at this radius, giving
 * the descent a gradient all the way in.
 */
const ELLIPSE_SMOOTH_FORWARD_RADIUS_M = 5;
/** Refinement (ellipse path): coordinate-descent step-schedule restarts. */
const ELLIPSE_REFINEMENT_RESTARTS = 3;
/** Refinement (ellipse path): the line-consistency term's tolerance (px). */
const ELLIPSE_LINE_CONSISTENCY_PX = 10;
/** Scan closure: coarse conic-parameter steps over [0, 2π). */
const ELLIPSE_SCAN_COARSE = 24;
/** Scan closure: fine steps within ±one coarse step around the best. */
const ELLIPSE_SCAN_FINE = 12;
/** Scan closure: mini-forward scoring points (strided subsample). */
const ELLIPSE_SCAN_SCORE_POINTS = 24;
/** Refinement: world-circle sample points (every 2°). */
const ELLIPSE_CIRCLE_SAMPLES = 180;
/** Refinement: minimum fraction of circle samples in-frame for the term to count. */
const ELLIPSE_MIN_IN_FRAME_FRACTION = 0.3;
/** Validation: maximum mean conic residual (px) over in-frame circle points. */
const ELLIPSE_VALIDATION_MAX_PX = 4;
/** Validation: fraction of in-frame circle points within 2x the mean gate (px). */
const ELLIPSE_VALIDATION_INLIER_FRACTION = 0.8;
/** Hypothesis finalists promoted from quick score to full score. */
const ELLIPSE_HYPOTHESIS_FINALISTS = 8;

// ---------------------------------------------------------------------------
// v0.4.1 — the validation-gate hardening (the b3-a-class fix; frozen
// constants, each part of the tested contract). CHAIN-ONLY: both gates fire
// exclusively on the ellipseMultiConicSelection (opt-in) path — the default
// surface stays v0.3.0-exact byte-identical.
// ---------------------------------------------------------------------------

/**
 * v0.4.1 leg 1 — the conic grass-support gate: minimum MEDIAN over frames of
 * the per-frame green fraction inside a quota-passing chain candidate's
 * conic. Measured bounds (12-window corpus + the synthetic fixture): the
 * b3-a quota-passing conics — the goal/net structure — measure 0.000-0.073
 * (the net region is stably non-green; even its coverage-failing fourth
 * candidate measures 0.049) and the other corpus structure conics
 * 0.011-0.175; the solve-reaching windows' grass-backed primary conics
 * measure 0.27-0.79 (b8p3-c 0.786 / b8p3-d 0.295 / b8p3-e 0.272 / b5-a
 * 0.703) and the synthetic fixture's true circle 0.90. 0.2 splits the
 * measured classes. The ANY-frame green UNION is NOT the discriminating
 * statistic (measured: inside the b3-a winner the union lifts to 0.164 vs
 * the 0.073 median — the per-frame values span 0.000..0.590 and the LAST
 * frame reads ABOVE the threshold, so an ANY-frame/single-frame gate
 * passes the structure); the MEDIAN over frames is: static structure is
 * never green, moving occluders (players) clear it.
 */
const ELLIPSE_CONIC_MIN_INTERIOR_GREEN_MEDIAN = 0.2;
/** v0.4.1 leg 1 — the grass-support interior sampling grid steps per semi-axis (41x41 parametric). */
const ELLIPSE_CONIC_GREEN_GRID_STEPS = 20;
/**
 * v0.4.1 leg 1 — minimum in-bounds interior samples for the grass gate to
 * apply (conics whose interior is mostly out of frame cannot be measured;
 * the solve's own validation gates handle those).
 */
const ELLIPSE_CONIC_GREEN_MIN_SAMPLES = 50;
/**
 * v0.4.1 leg 2 — the projected-grid quad-area floor as a fraction of the
 * winning conic's ellipse area (the containment invariant): the image of
 * the pitch rectangle CONTAINS the image of the center circle (the conic)
 * for any real camera homography — projective maps preserve containment —
 * so area(quad) >= area(conic) holds by construction for every VALID solve;
 * a collapsed/folded mapping violates it. Measured bounds: the healthy
 * chain solve of the synthetic arc window measures quad/conic = 41.1; the
 * b3-a chain solve (the withheld claim — a point-collapse with all four
 * pitch corners at image (575, 98)) measures 0.0004. 0.5 sits far inside
 * both margins (the slack absorbs the fitted conic's inexactness: the
 * validation ties the projected world circle to the conic within 4 px, so
 * the two areas agree well inside a factor of 2).
 */
const ELLIPSE_GRID_MIN_QUAD_AREA_FACTOR = 0.5;
/**
 * v0.4.1 leg 2 — minimum projected pitch-corner separation (px). A
 * quota-passing conic has semi-axes >= 6 px (ELLIPSE_MIN_SEMI_AXIS_PX), so
 * a valid quad containing it spans >= ~12 px; collapsed quads put the four
 * corners within sub-pixel distances (b3-a: 0.1 px). 4 px is below every
 * healthy floor and far above the collapse signature.
 */
const ELLIPSE_GRID_MIN_CORNER_SEPARATION_PX = 4;
/**
 * v0.4.1 leg 2 — projected-corner magnitude bound (multiples of the frame
 * dimension): a corner that is non-finite or lands beyond 20x the frame
 * marks a folded/wrapped mapping (the pitch's finite region maps through
 * the vanishing line), not a real camera's image. The measured healthy
 * surfaces stay within 2.4x (b8p3-c's far corner at (-243, 873) px on
 * 640x360; the synthetic fixture's at 1429 px); 20x is a degeneracy
 * bound, not a tight calibration — the area/separation gates carry the
 * measured discrimination.
 */
const ELLIPSE_GRID_CORNER_BOUND_FACTOR = 20;

// ---------------------------------------------------------------------------
// v0.5.0 — the E4b anchor conversion (the Lorentz-frame J-orthogonal exact
// closure; OPT-IN, `ellipseAnchorConversion`, default false — module docs).
// ---------------------------------------------------------------------------

/**
 * v0.5.0 E4b — the FAST PATH tolerance: N = M₀ᵀJM₀ within this RELATIVE
 * deviation of μ·J (μ = (N₀₀ + N₁₁ − N₂₂)/3) means M₀ is already (near-)
 * J-orthogonal up to a positive scale, and the NEAREST J-orthogonal map is
 * M₀/√μ. THE MEASURED DEFECT THIS FIXES: in exactly that (near-)degenerate
 * case the eigendecomposition path's ULP-level tie order in the degenerate
 * eigenpair composes the projection with an arbitrary rotation/reflection of
 * the degenerate plane (B = √|Λ|·Vᵀ with V's pair-basis set by the noise,
 * the axis-swap reflection in the extreme case) — a LEGITIMATE J-orthogonal
 * map (the conic correspondence holds) but NOT the nearest one, which breaks
 * the true-H fixed point (the converted homography is the input conjugated
 * by a nontrivial projective map) and needlessly rebalances the line rows.
 * The true-H round trip measures ~1e-12..1e-11 relative; 1e-9 fires the
 * fast path there with ~100x headroom while staying far under the
 * admissibility bound's near-consistent class.
 */
const ELLIPSE_ANCHOR_FAST_PATH_TOL = 1e-9;
/**
 * v0.5.0 E4b — THE ADMISSIBILITY BOUND: a mixed-DLT scan solve converts only
 * when N = M₀ᵀJM₀ is within this RELATIVE deviation of μ·J — i.e. only scan
 * solves whose anchors were NEAR-CONIC-CONSISTENT convert (the least-squares
 * compromise between the conic-derived rows and the line rows stays small);
 * solves anchored to mutually inconsistent evidence (wrong model values,
 * wrong scan parameter, structure conics fighting the line rows) exceed the
 * bound and stay unconverted — the closure is never FABRICATED from anchors
 * that never agreed with the conic. Measured selectivity (the calibration
 * target): ≈ 0.6% of the enumerated scan solves convert on the synthetic
 * plain fixture, ≈ 2.3% on the real b8p3-b window, ≈ 2.7% corpus-wide.
 */
const ELLIPSE_ANCHOR_ADMISSIBILITY_BOUND = 1e-2;
/**
 * v0.5.0 E4b — the CLOSURE SELF-CHECK tolerance: the projected P̂ must
 * satisfy P̂ᵀJP̂ ≈ J (relative Frobenius, a POSITIVE scale — the negative
 * scale −J is the anti-J-orthogonal class and fails the same comparison).
 * The construction guarantees P̂ᵀJP̂ = J exactly (the eigendecomposition path)
 * or N/μ (the fast path, within the fast-path tolerance); a violation is a
 * numerical breakdown, and the map is NEVER used silently unverified.
 */
const ELLIPSE_ANCHOR_SELF_CHECK_REL = 1e-6;
/**
 * v0.5.0 E4b — the BIRTH CONIC GUARD tolerance: the converted Ĥ must satisfy
 * Ĥᵀ·C_w·Ĥ ≈ qCanon (relative Frobenius), the conic the solve was born from
 * (the J-matching representative of the normalized image conic) — the
 * algebraic identity of the factorization H = W⁻¹·P·G, verified rather than
 * assumed on every conversion.
 */
const ELLIPSE_ANCHOR_BIRTH_GUARD_REL = 1e-6;
/**
 * v0.5.0 E4b — the CONIC HARD GUARD (px): the mean pixel-level residual of
 * the world circle sample points projected through Ĥ⁻¹ onto the ORIGINAL
 * px conic. The closure is exact by construction (measured residuals
 * ~3e-4..1.4e-2 px on the real corpus — the 1.4e-2 case is the roundoff of
 * a wildly-conditioned converted homography, still 7x under the guard); a
 * coordinate-convention or normalization mistake lands orders of magnitude
 * above it — the guard catches what the algebraic identity cannot.
 */
const ELLIPSE_ANCHOR_CONIC_GUARD_PX = 0.1;
/**
 * v0.5.0 E4b — the canonicalization's degenerate-eigenvalue floor (relative
 * to the largest |eigenvalue|): a conic matrix with a ~zero eigenvalue is a
 * degenerate conic (a point / a line pair) and cannot carry the non-degenerate
 * x² + y² − z² = 0 Lorentz form.
 */
const ELLIPSE_ANCHOR_EIGEN_ZERO_REL = 1e-9;

// ---------------------------------------------------------------------------
// v0.2.0 — the ellipse/circle-constrained machinery (pure, deterministic).
// ---------------------------------------------------------------------------

/**
 * A planar conic in PIXEL coordinates:
 * `a·x² + b·xy + c·y² + d·x + e·y + f = 0`. The 3x3 symmetric matrix form
 * is `[[a, b/2, d/2], [b/2, c, e/2], [d/2, e/2, f]]`.
 */
export interface EllipseConic {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly e: number;
  readonly f: number;
}

/** A conic decomposed into center / semi-axes / rotation (pixel units). */
export interface EllipseGeometry {
  readonly centerX: number;
  readonly centerY: number;
  readonly semiMajor: number;
  readonly semiMinor: number;
  /** Major-axis angle (radians, atan2 convention). */
  readonly rotation: number;
}

/** Evaluates the conic's matrix form at the homogeneous point (x, y, 1). */
function conicMatrix(conic: EllipseConic): [number, number, number, number, number, number, number, number, number] {
  return [
    conic.a, conic.b / 2, conic.d / 2,
    conic.b / 2, conic.c, conic.e / 2,
    conic.d / 2, conic.e / 2, conic.f,
  ];
}

/**
 * Decomposes a conic into center / semi-axes / rotation. `undefined` unless
 * the conic is a REAL non-degenerate ellipse (`b² − 4ac < 0`) with positive
 * finite semi-axes. Deterministic; scale-invariant.
 */
function conicGeometry(conic: EllipseConic): EllipseGeometry | undefined {
  const { a, b, c, d, e, f } = conic;
  if (b * b - 4 * a * c >= 0) return undefined; // hyperbola / parabola / degenerate
  // Center: solve [2a, b; b, 2c]·[cx, cy] = [−d, −e].
  const determinant = 4 * a * c - b * b;
  if (Math.abs(determinant) <= 1e-12) return undefined;
  const centerX = (-2 * c * d + b * e) / determinant;
  const centerY = (b * d - 2 * a * e) / determinant;
  if (!Number.isFinite(centerX) || !Number.isFinite(centerY)) return undefined;
  // Translated constant term: the conic value at the center.
  const fPrime = a * centerX * centerX + b * centerX * centerY + c * centerY * centerY +
    d * centerX + e * centerY + f;
  // Eigenvalues of [[a, b/2], [b/2, c]] with their directions: λ1 = ht + rt
  // lies along θ1 = ½·atan2(b, a−c); λ2 = ht − rt along θ1 + 90°. Each
  // eigenvalue's semi-axis is sqrt(−f′/λ) — the CORRECT pairing of axis
  // length to direction (a first-cut version paired them swapped, which
  // corrupts every downstream distance for non-circular ellipses).
  const halfTrace = (a + c) / 2;
  const root = Math.sqrt(Math.max(0, ((a - c) / 2) ** 2 + (b / 2) ** 2));
  const lambda1 = halfTrace + root;
  const lambda2 = halfTrace - root;
  if (Math.abs(lambda1) <= 1e-12 || Math.abs(lambda2) <= 1e-12) return undefined;
  const axis1Squared = -fPrime / lambda1;
  const axis2Squared = -fPrime / lambda2;
  if (axis1Squared <= 0 || axis2Squared <= 0) return undefined;
  const axis1 = Math.sqrt(axis1Squared);
  const axis2 = Math.sqrt(axis2Squared);
  const theta1 = 0.5 * Math.atan2(b, a - c);
  let semiMajor: number;
  let semiMinor: number;
  let rotation: number;
  if (axis1 >= axis2) {
    semiMajor = axis1;
    semiMinor = axis2;
    rotation = theta1;
  } else {
    semiMajor = axis2;
    semiMinor = axis1;
    rotation = theta1 + Math.PI / 2;
  }
  if (!Number.isFinite(semiMajor) || !Number.isFinite(semiMinor)) return undefined;
  return { centerX, centerY, semiMajor, semiMinor, rotation };
}

/**
 * Approximate point-to-ellipse distance (px): the boundary radius along the
 * point's direction from the center, differenced with the point's radius.
 * Accurate near the boundary — exactly where support is scored.
 */
function pointConicDistancePx(geometry: EllipseGeometry, x: number, y: number): number {
  const dx = x - geometry.centerX;
  const dy = y - geometry.centerY;
  const cos = Math.cos(-geometry.rotation);
  const sin = Math.sin(-geometry.rotation);
  const ux = dx * cos - dy * sin;
  const uy = dx * sin + dy * cos;
  const radius = Math.hypot(ux, uy);
  if (radius <= 1e-12) return geometry.semiMinor;
  const theta = Math.atan2(uy, ux);
  const boundary =
    (geometry.semiMajor * geometry.semiMinor) /
    Math.hypot(geometry.semiMinor * Math.cos(theta), geometry.semiMajor * Math.sin(theta));
  return Math.abs(radius - boundary);
}

/** The POLAR LINE of a homogeneous point w.r.t. a conic (`C·p`). */
function polarOfPoint(conic: EllipseConic, point: readonly number[]): [number, number, number] {
  const m = conicMatrix(conic);
  return [
    m[0]! * point[0]! + m[1]! * point[1]! + m[2]! * point[2]!,
    m[3]! * point[0]! + m[4]! * point[1]! + m[5]! * point[2]!,
    m[6]! * point[0]! + m[7]! * point[1]! + m[8]! * point[2]!,
  ];
}

/** Normalizes a homogeneous line to unit (a, b) norm. */
function normalizeLine(line: [number, number, number]): [number, number, number] {
  const norm = Math.hypot(line[0], line[1]);
  if (norm <= 1e-12) return line;
  return [line[0] / norm, line[1] / norm, line[2] / norm];
}

/** Intersects two homogeneous lines; `undefined` when (near-)parallel. */
function intersectLines(
  a: readonly number[],
  b: readonly number[],
): [number, number, number] | undefined {
  const x = a[1]! * b[2]! - a[2]! * b[1]!;
  const y = a[2]! * b[0]! - a[0]! * b[2]!;
  const z = a[0]! * b[1]! - a[1]! * b[0]!;
  const scale = Math.max(Math.abs(x), Math.abs(y), Math.abs(z));
  if (scale <= 1e-12) return undefined;
  return [x, y, z];
}

/**
 * The 0-2 intersections of a line with a conic (px): parameterize the line
 * and solve the quadratic. Deterministic order (−√disc solution first).
 */
function lineConicIntersections(
  conic: EllipseConic,
  line: readonly number[],
): Array<{ x: number; y: number }> {
  const [a, b, c] = line as [number, number, number];
  // Unit-normalize the line; the closest point to the origin anchors it.
  const norm = Math.hypot(a, b);
  if (norm <= 1e-12) return [];
  const na = a / norm;
  const nb = b / norm;
  const nc = c / norm;
  const x0 = -na * nc;
  const y0 = -nb * nc;
  const dx = -nb;
  const dy = na;
  const alpha = conic.a * dx * dx + conic.b * dx * dy + conic.c * dy * dy;
  const beta = 2 * conic.a * x0 * dx + conic.b * (x0 * dy + y0 * dx) + 2 * conic.c * y0 * dy +
    conic.d * dx + conic.e * dy;
  const gamma = conic.a * x0 * x0 + conic.b * x0 * y0 + conic.c * y0 * y0 +
    conic.d * x0 + conic.e * y0 + conic.f;
  if (Math.abs(alpha) <= 1e-12) {
    if (Math.abs(beta) <= 1e-12) return [];
    const t = -gamma / beta;
    return [{ x: x0 + t * dx, y: y0 + t * dy }];
  }
  const discriminant = beta * beta - 4 * alpha * gamma;
  if (discriminant < 0) return [];
  const root = Math.sqrt(discriminant);
  const t1 = (-beta - root) / (2 * alpha);
  const t2 = (-beta + root) / (2 * alpha);
  return [
    { x: x0 + t1 * dx, y: y0 + t1 * dy },
    { x: x0 + t2 * dx, y: y0 + t2 * dy },
  ];
}

/**
 * The linear least-squares conic over a point set with the constraint
 * `a + c = 1` (valid for ellipses — a, c share sign), fitted in
 * CENTROID-NORMALIZED coordinates and transformed back to pixel
 * coordinates. Normalization is the measured fix for the conditioning
 * collapse of the raw-pixel fit (row entries up to x² ≈ 4·10⁵ make the
 * 5x5 normal equations worthless; the normalized fit is stable). The
 * back-transform of `a x² + b xy + c y² + d x + e y + f = 0` under
 * `x = s·x' + tx, y = s·y' + ty` is exact:
 *   a = a'/s², b = b'/s², c = c'/s²,
 *   d = (d' − 2a·s·tx − b·s·ty)/s, e = (e' − b·s·tx − 2c·s·ty)/s,
 *   f = f' − d·tx − e·ty − (a·tx² + b·tx·ty + c·ty²)   (evaluated last).
 * `undefined` when the system is singular or the result is not an ellipse.
 */
function refitConicOverSupport(
  points: ReadonlyArray<readonly [number, number]>,
): EllipseConic | undefined {
  if (points.length < 6) return undefined;
  let tx = 0;
  let ty = 0;
  for (const [x, y] of points) {
    tx += x;
    ty += y;
  }
  tx /= points.length;
  ty /= points.length;
  let meanDistance = 0;
  for (const [x, y] of points) {
    meanDistance += Math.hypot(x - tx, y - ty);
  }
  meanDistance /= points.length;
  if (meanDistance <= 1e-9) return undefined;
  const s = meanDistance;
  // Normal equations for [a, b, d, e, f] with c = 1 − a over the normalized
  // points: rows [x'²−y'², x'y', x', y', 1], rhs −y'².
  const g = Array.from({ length: 5 }, () => new Array<number>(5).fill(0));
  const rhs = new Array<number>(5).fill(0);
  for (const [x, y] of points) {
    const xn = (x - tx) / s;
    const yn = (y - ty) / s;
    const row = [xn * xn - yn * yn, xn * yn, xn, yn, 1];
    const target = -yn * yn;
    for (let i = 0; i < 5; i += 1) {
      for (let j = 0; j < 5; j += 1) {
        g[i]![j] = g[i]![j]! + row[i]! * row[j]!;
      }
      rhs[i] = rhs[i]! + row[i]! * target;
    }
  }
  const solution = solveDenseLinearSystem(g, rhs, 1e-10);
  if (solution === undefined) return undefined;
  const an = solution[0]!;
  const bn = solution[1]!;
  const cn = 1 - an;
  const dn = solution[2]!;
  const en = solution[3]!;
  const fn = solution[4]!;
  // Back-transform to pixel coordinates (exact algebra, see above).
  const a = an / (s * s);
  const b = bn / (s * s);
  const c = cn / (s * s);
  const d = (dn - 2 * a * s * tx - b * s * ty) / s;
  const e = (en - b * s * tx - 2 * c * s * ty) / s;
  const f = fn - d * tx - e * ty - (a * tx * tx + b * tx * ty + c * ty * ty);
  const conic: EllipseConic = { a, b, c, d, e, f };
  if (conicGeometry(conic) === undefined) return undefined;
  return conic;
}

/**
 * Gaussian elimination with partial pivoting on a dense square system
 * (`a·x = b`); `undefined` when rank-deficient at `tolerance` relative to
 * the matrix scale. Both inputs are copied (never mutated).
 */
function solveDenseLinearSystem(
  a: readonly (readonly number[])[],
  b: readonly number[],
  tolerance: number,
): number[] | undefined {
  const n = a.length;
  const matrix = a.map((row) => [...row]);
  const rhs = [...b];
  let scale = 0;
  for (const row of matrix) {
    for (const entry of row) scale = Math.max(scale, Math.abs(entry));
  }
  const threshold = tolerance * Math.max(scale, 1);
  for (let column = 0; column < n; column += 1) {
    let pivotRow = column;
    let pivotAbs = Math.abs(matrix[column]![column]!);
    for (let candidate = column + 1; candidate < n; candidate += 1) {
      const value = Math.abs(matrix[candidate]![column]!);
      if (value > pivotAbs) {
        pivotAbs = value;
        pivotRow = candidate;
      }
    }
    if (pivotAbs <= threshold) return undefined;
    if (pivotRow !== column) {
      const swapRow = matrix[column]!;
      matrix[column] = matrix[pivotRow]!;
      matrix[pivotRow] = swapRow;
      const swapRhs = rhs[column]!;
      rhs[column] = rhs[pivotRow]!;
      rhs[pivotRow] = swapRhs;
    }
    for (let lower = column + 1; lower < n; lower += 1) {
      const factor = matrix[lower]![column]! / matrix[column]![column]!;
      if (factor === 0) continue;
      for (let k = column; k < n; k += 1) {
        matrix[lower]![k] = matrix[lower]![k]! - factor * matrix[column]![k]!;
      }
      rhs[lower] = rhs[lower]! - factor * rhs[column]!;
    }
  }
  const solution = new Array<number>(n).fill(0);
  for (let row = n - 1; row >= 0; row -= 1) {
    let sum = rhs[row]!;
    for (let k = row + 1; k < n; k += 1) {
      sum = sum - matrix[row]![k]! * solution[k]!;
    }
    solution[row] = sum / matrix[row]![row]!;
  }
  return solution;
}

/** The arc-evidence fit result shared by the calibrator + diagnostics. */
interface ArcConicFit {
  readonly conic: EllipseConic;
  readonly geometry: EllipseGeometry;
  readonly supportPx: number;
  readonly coverageBins: number;
}

/**
 * Deterministic RANSAC conic fit over the arc evidence (module docs E2).
 * Broadcast-perspective center circles project to THIN sliver ellipses
 * (e.g. 100x19 px), where exact 5-point conics are wildly sensitive to the
 * ±3 px band noise — the measured failure of the first-cut fitter on the
 * synthetic arc window (every subset conic missed the truth; the winner
 * was a giant ellipse grazing the arc + outlier strips). The fit
 * therefore uses OVER-DETERMINED 12-point subsets fitted by the
 * a + c = 1 constrained least squares from the start:
 *  1. samples STRATIFIED subsets — one point from each twelfth of the
 *     row-major (y-ordered) arc list, LCG-drawn within each block — so
 *     every subset spans the arc (plus plain LCG subsets);
 *  2. REJECTS near-collinear subsets (smallest covariance eigenvalue of
 *     the 5 centered points < ELLIPSE_SUBSET_SPREAD_PX^2) before solving;
 *  3. keeps the top ELLIPSE_FIT_REFIT_CANDIDATES subset conics by support,
 *     re-fits EACH over its support by linear least squares, and scores
 *     the re-fit conics (a single re-fit of a garbage best conic cannot
 *     recover) — returned RANKED by (support desc, rank asc); rank 0 is
 *     the winner the v0.3.0 surface used (v0.4.0: the chain's primary).
 * All integer sampling is a fixed-seed LCG (no Math.random, no clock);
 * `undefined` when no subset produced a sane ellipse.
 */
/** One ranked re-fit candidate of the RANSAC conic fit (module docs E2). */
interface RankedConicRefit {
  readonly conic: EllipseConic;
  readonly geometry: EllipseGeometry;
  /** Support over the fit's point set, post-re-fit. */
  readonly support: number;
  /** Enumeration rank in the sorted candidate order. */
  readonly rank: number;
}

function rankedConicRefits(
  arcPixels: readonly number[],
  staticPixels: readonly number[],
  width: number,
  height: number,
): RankedConicRefit[] | undefined {
  const pointCount = arcPixels.length / 2;
  if (pointCount < ELLIPSE_MIN_ARC_PIXELS) return undefined;
  const points: Array<readonly [number, number]> = [];
  for (let p = 0; p < arcPixels.length; p += 2) {
    points.push([arcPixels[p]!, arcPixels[p + 1]!]);
  }
  const maxSemi = ELLIPSE_MAX_SEMI_AXIS_FACTOR * Math.hypot(width, height);
  const saneGeometry = (geometry: EllipseGeometry): boolean =>
    geometry.semiMajor >= ELLIPSE_MIN_SEMI_AXIS_PX &&
    geometry.semiMajor <= maxSemi &&
    geometry.semiMajor / Math.max(geometry.semiMinor, 1e-9) <= ELLIPSE_MAX_AXIS_RATIO &&
    geometry.centerX >= -width && geometry.centerX <= 2 * width &&
    geometry.centerY >= -height && geometry.centerY <= 2 * height;
  const supportOf = (geometry: EllipseGeometry): number => {
    let support = 0;
    for (const [x, y] of points) {
      if (pointConicDistancePx(geometry, x, y) <= ELLIPSE_FIT_TOLERANCE_PX) support += 1;
    }
    return support;
  };
  let lcgState = ELLIPSE_LCG_SEED >>> 0;
  const nextRandom = (): number => {
    lcgState = (lcgState * 1103515245 + 12345) % 2147483648;
    return lcgState;
  };
  // Near-collinearity guard: the smallest eigenvalue of the 5 centered
  // points' 2x2 covariance must exceed the spread floor.
  const spreadIsSufficient = (sample: ReadonlyArray<readonly [number, number]>): boolean => {
    let meanX = 0;
    let meanY = 0;
    for (const [x, y] of sample) {
      meanX += x;
      meanY += y;
    }
    meanX /= sample.length;
    meanY /= sample.length;
    let xx = 0;
    let yy = 0;
    let xy = 0;
    for (const [x, y] of sample) {
      const dx = x - meanX;
      const dy = y - meanY;
      xx += dx * dx;
      yy += dy * dy;
      xy += dx * dy;
    }
    xx /= sample.length;
    yy /= sample.length;
    xy /= sample.length;
    const trace = xx + yy;
    const det = xx * yy - xy * xy;
    const discriminant = Math.max(0, (trace / 2) ** 2 - det);
    const smallest = trace / 2 - Math.sqrt(discriminant);
    return smallest >= ELLIPSE_SUBSET_SPREAD_PX * ELLIPSE_SUBSET_SPREAD_PX;
  };
  const blockCount = ELLIPSE_FIT_SUBSET_POINTS;
  const blockSize = Math.floor(pointCount / blockCount);
  const candidates: Array<{ conic: EllipseConic; geometry: EllipseGeometry; support: number }> = [];
  const pushCandidate = (conic: EllipseConic, geometry: EllipseGeometry, support: number): void => {
    if (support <= 0) return;
    candidates.push({ conic, geometry, support });
    if (candidates.length > 64) {
      // Bound the candidate list: drop the worst (deterministic — first
      // worst in insertion order).
      let worstIndex = 0;
      for (let i = 1; i < candidates.length; i += 1) {
        if (candidates[i]!.support < candidates[worstIndex]!.support) worstIndex = i;
      }
      candidates.splice(worstIndex, 1);
    }
  };
  for (let subset = 0; subset < ELLIPSE_FIT_SUBSETS; subset += 1) {
    const sample: Array<readonly [number, number]> = [];
    if (subset < ELLIPSE_FIT_STRUCTURED_SUBSETS) {
      // Stratified: one LCG point from each twelfth of the row-major arc.
      for (let k = 0; k < blockCount; k += 1) {
        const blockStart = k * blockSize;
        const blockEnd = k === blockCount - 1 ? pointCount : (k + 1) * blockSize;
        const span = Math.max(1, blockEnd - blockStart);
        sample.push(points[blockStart + (nextRandom() % span)]!);
      }
    } else {
      for (let k = 0; k < blockCount; k += 1) {
        sample.push(points[nextRandom() % pointCount]!);
      }
    }
    if (!spreadIsSufficient(sample)) continue;
    // Over-determined constrained least squares over the 12-point subset.
    const conic = refitConicOverSupport(sample);
    if (conic === undefined) continue;
    const geometry = conicGeometry(conic);
    if (geometry === undefined || !saneGeometry(geometry)) continue;
    pushCandidate(conic, geometry, supportOf(geometry));
  }
  if (candidates.length === 0) return undefined;
  // Top candidates by support -> re-fit each over its support -> re-score.
  candidates.sort((a, b) => b.support - a.support || 0);
  const refits: RankedConicRefit[] = [];
  for (let index = 0; index < Math.min(candidates.length, ELLIPSE_FIT_REFIT_CANDIDATES); index += 1) {
    const candidate = candidates[index]!;
    let conic = candidate.conic;
    let geometry = candidate.geometry;
    const supportPoints: Array<readonly [number, number]> = [];
    for (const [x, y] of points) {
      if (pointConicDistancePx(candidate.geometry, x, y) <= ELLIPSE_FIT_TOLERANCE_PX) {
        supportPoints.push([x, y]);
      }
    }
    const refit = refitConicOverSupport(supportPoints);
    if (refit !== undefined) {
      const refitGeometry = conicGeometry(refit);
      if (refitGeometry !== undefined && saneGeometry(refitGeometry)) {
        conic = refit;
        geometry = refitGeometry;
      }
    }
    refits.push({ conic, geometry, support: supportOf(geometry), rank: index });
  }
  if (refits.length === 0) return undefined;
  // (support desc, rank asc) — rank 0 of this order is the v0.3.0 winner
  // (the max-support re-fit, first in enumeration order on ties: today's
  // strict `>` best-tracking, preserved exactly).
  refits.sort((a, b) => b.support - a.support || a.rank - b.rank);
  return refits;
}

/**
 * The EM-style band re-extraction (see ELLIPSE_BAND_REEXTRACT_PX):
 * re-extract the FULL circle band from the static mask around the current
 * conic — the arc evidence's Hough-line explanation punched holes in the
 * band — and re-fit over it. Deterministic; returns the refined pair
 * (the input pair unchanged when every iteration breaks early).
 */
function bandRefineConic(
  conicIn: EllipseConic,
  geometryIn: EllipseGeometry,
  staticPixels: readonly number[],
  width: number,
  height: number,
): { readonly conic: EllipseConic; readonly geometry: EllipseGeometry } {
  const maxSemi = ELLIPSE_MAX_SEMI_AXIS_FACTOR * Math.hypot(width, height);
  const saneGeometry = (geometry: EllipseGeometry): boolean =>
    geometry.semiMajor >= ELLIPSE_MIN_SEMI_AXIS_PX &&
    geometry.semiMajor <= maxSemi &&
    geometry.semiMajor / Math.max(geometry.semiMinor, 1e-9) <= ELLIPSE_MAX_AXIS_RATIO &&
    geometry.centerX >= -width && geometry.centerX <= 2 * width &&
    geometry.centerY >= -height && geometry.centerY <= 2 * height;
  let geometry = geometryIn;
  let conic = conicIn;
  for (let iteration = 0; iteration < ELLIPSE_BAND_REEXTRACT_ITERATIONS; iteration += 1) {
    const band: Array<readonly [number, number]> = [];
    for (let p = 0; p < staticPixels.length; p += 2) {
      const x = staticPixels[p]!;
      const y = staticPixels[p + 1]!;
      if (pointConicDistancePx(geometry, x, y) <= ELLIPSE_BAND_REEXTRACT_PX) {
        band.push([x, y]);
      }
    }
    if (band.length < ELLIPSE_MIN_ARC_PIXELS) break;
    const refit = refitConicOverSupport(band);
    if (refit === undefined) break;
    const refitGeometry = conicGeometry(refit);
    if (refitGeometry === undefined || !saneGeometry(refitGeometry)) break;
    conic = refit;
    geometry = refitGeometry;
  }
  return { conic, geometry };
}

/** Support and 36-bin coverage of a conic over a pixel list (module E3). */
function conicSupportAndCoverage(
  geometry: EllipseGeometry,
  arcPixels: readonly number[],
): { readonly supportPx: number; readonly coverageBins: number } {
  let supportPx = 0;
  const bins = new Array<number>(36).fill(0);
  for (let p = 0; p < arcPixels.length; p += 2) {
    const x = arcPixels[p]!;
    const y = arcPixels[p + 1]!;
    if (pointConicDistancePx(geometry, x, y) <= ELLIPSE_FIT_TOLERANCE_PX) {
      supportPx += 1;
      // Coverage bin over the conic PARAMETRIC angle t (atan2(uy/b, ux/a)),
      // NOT the polar angle: on sliver ellipses the polar angle of the
      // whole band collapses toward 0 degrees/180 degrees (measured: the
      // bottom 40% of the arc spanned only 6 of 36 polar bins) while the
      // parametric angle tracks the arc length — the quantity the quota
      // means.
      const dx = x - geometry.centerX;
      const dy = y - geometry.centerY;
      const cos = Math.cos(-geometry.rotation);
      const sin = Math.sin(-geometry.rotation);
      const ux = dx * cos - dy * sin;
      const uy = dx * sin + dy * cos;
      const safeMajor = Math.max(geometry.semiMajor, 1e-9);
      const safeMinor = Math.max(geometry.semiMinor, 1e-9);
      let bin = Math.floor(
        ((Math.atan2(uy / safeMinor, ux / safeMajor) + Math.PI) / (2 * Math.PI)) * 36,
      );
      if (bin < 0) bin = 0;
      if (bin > 35) bin = 35;
      bins[bin] = bins[bin]! + 1;
    }
  }
  let coverageBins = 0;
  for (const count of bins) {
    if (count >= ELLIPSE_BIN_OCCUPANCY_PX) coverageBins += 1;
  }
  return { supportPx, coverageBins };
}

/**
 * v0.4.0 — the conic DISTINCTNESS predicate: two candidate conics are
 * distinct chain members when their centers, semi-axes, or rotations
 * differ beyond the documented thresholds. Re-derivations of the same
 * conic by different subsets land within the thresholds and dedupe.
 */
function conicsDistinct(a: EllipseGeometry, b: EllipseGeometry): boolean {
  const centerDistance = Math.hypot(a.centerX - b.centerX, a.centerY - b.centerY);
  if (centerDistance >= ELLIPSE_CONIC_DISTINCT_CENTER_PX) return true;
  if (Math.abs(a.semiMajor - b.semiMajor) >= ELLIPSE_CONIC_DISTINCT_SEMI_PX) return true;
  if (Math.abs(a.semiMinor - b.semiMinor) >= ELLIPSE_CONIC_DISTINCT_SEMI_PX) return true;
  let rotationDelta = Math.abs(a.rotation - b.rotation);
  if (rotationDelta > Math.PI) rotationDelta = 2 * Math.PI - rotationDelta;
  return (rotationDelta * 180) / Math.PI >= ELLIPSE_CONIC_DISTINCT_ROTATION_DEG;
}

/**
 * v0.4.1 leg 1 — the conic grass-support measurement (module docs E2c):
 * the MEDIAN over frames of the per-frame green fraction over a fixed
 * (2·ELLIPSE_CONIC_GREEN_GRID_STEPS+1)² parametric grid inside the conic
 * (the same ellipse-frame convention as `conicPointAt`). `undefined` when
 * fewer than ELLIPSE_CONIC_GREEN_MIN_SAMPLES in-bounds samples exist (a
 * conic whose interior is mostly out of frame cannot be measured — the
 * solve's own gates handle it). Pure, deterministic.
 */
function conicInteriorGrassMedian(
  geometry: EllipseGeometry,
  greenMasks: readonly Uint8Array[],
  width: number,
  height: number,
): { readonly median: number; readonly samplesInBounds: number } | undefined {
  if (greenMasks.length === 0) return undefined;
  const cos = Math.cos(geometry.rotation);
  const sin = Math.sin(geometry.rotation);
  const safeMajor = Math.max(geometry.semiMajor, 1e-9);
  const safeMinor = Math.max(geometry.semiMinor, 1e-9);
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = -ELLIPSE_CONIC_GREEN_GRID_STEPS; i <= ELLIPSE_CONIC_GREEN_GRID_STEPS; i += 1) {
    for (let j = -ELLIPSE_CONIC_GREEN_GRID_STEPS; j <= ELLIPSE_CONIC_GREEN_GRID_STEPS; j += 1) {
      const u = (i / ELLIPSE_CONIC_GREEN_GRID_STEPS) * safeMajor;
      const v = (j / ELLIPSE_CONIC_GREEN_GRID_STEPS) * safeMinor;
      if ((u / safeMajor) ** 2 + (v / safeMinor) ** 2 > 1) continue;
      const x = Math.round(geometry.centerX + u * cos - v * sin);
      const y = Math.round(geometry.centerY + u * sin + v * cos);
      if (x < 0 || x >= width || y < 0 || y >= height) continue;
      xs.push(x);
      ys.push(y);
    }
  }
  if (xs.length < ELLIPSE_CONIC_GREEN_MIN_SAMPLES) return undefined;
  const perFrame: number[] = [];
  for (const mask of greenMasks) {
    let hits = 0;
    for (let p = 0; p < xs.length; p += 1) {
      if (mask[ys[p]! * width + xs[p]!] !== 0) hits += 1;
    }
    perFrame.push(hits / xs.length);
  }
  perFrame.sort((a, b) => a - b);
  return {
    median: perFrame[Math.floor((perFrame.length - 1) / 2)]!,
    samplesInBounds: xs.length,
  };
}

/**
 * v0.4.0 — the CONIC-SELECTION CANDIDATE CHAIN (module docs E2b). [0] is
 * the v0.3.0 primary EXACTLY: the global dominance-filtered RANSAC
 * winner (the rank-0 re-fit, band-refined, support/coverage over the
 * global arc pixels — the v0.3.0 pipeline verbatim, byte-identical).
 * With multiConic the DISTINCT alternatives follow in SOURCE-PRIORITY
 * order — the per-component fits of the sub-dominance components FIRST
 * (a DROPPED component is exactly where the center circle hides on
 * hoarding-curve-dominated windows, and it is recoverable ONLY there),
 * then the global ranked re-fit runners-up — each quota-gated (the same
 * support/coverage bar as the primary) and deduplicated by geometry,
 * capped at ELLIPSE_MAX_CONIC_CANDIDATES.
 * Deterministic (fixed LCG seed per fit invocation, fixed enumeration
 * order). Empty when the global fit found no sane ellipse.
 */
function fitArcConicCandidates(
  arcPixels: readonly number[],
  components: readonly (readonly number[])[],
  staticPixels: readonly number[],
  width: number,
  height: number,
  multiConic: boolean,
): readonly ArcConicFit[] {
  const pointCount = arcPixels.length / 2;
  if (pointCount < ELLIPSE_MIN_ARC_PIXELS) return [];
  const refits = rankedConicRefits(arcPixels, staticPixels, width, height);
  if (refits === undefined || refits.length === 0) return [];
  // The primary: the v0.3.0 pipeline verbatim.
  const primaryBand = bandRefineConic(
    refits[0]!.conic, refits[0]!.geometry, staticPixels, width, height,
  );
  const primarySc = conicSupportAndCoverage(primaryBand.geometry, arcPixels);
  const chain: ArcConicFit[] = [
    { conic: primaryBand.conic, geometry: primaryBand.geometry, ...primarySc },
  ];
  if (!multiConic) return chain;
  // The alternatives, in SOURCE-PRIORITY order (each support-gated to the
  // same quota, deduplicated by geometry, capped):
  //  1. the PER-COMPONENT fits of the sub-dominance components (size
  //     desc, discovery order on ties) — a structure DROPPED by the
  //     dominance filter can ONLY be recovered here (its pixels never
  //     reach the global RANSAC; measured: the center circle hides
  //     exactly here on hoarding-curve-dominated windows);
  //  2. the global ranked re-fit runners-up (support desc, rank asc) —
  //     structures present in the filtered evidence but ranked below the
  //     winner (the sliver-fit variations of the dominant curve mostly
  //     dedupe against the primary).
  // Component fits come FIRST because the cap must not fill with
  // variations of the dominant structure before a dropped distinct
  // structure gets its slot (measured on the hoarding-curve fixture:
  // three curve-variant runners-up flooded the chain at cap 4 while the
  // dropped circle component waited behind them).
  const alternatives: Array<{ fit: ArcConicFit }> = [];
  const orderedComponents = components
    .map((component, index) => ({ component, index }))
    .sort((a, b) => b.component.length - a.component.length || a.index - b.index);
  for (const { component } of orderedComponents) {
    if (component.length / 2 < ELLIPSE_MIN_ARC_PIXELS) continue;
    const componentRefits = rankedConicRefits(component, staticPixels, width, height);
    if (componentRefits === undefined || componentRefits.length === 0) continue;
    // NO band refinement for component fits (measured): the EM band
    // re-extracts static pixels within ELLIPSE_BAND_REEXTRACT_PX of the
    // current conic GLOBALLY — near a neighboring structure (the curve
    // band within 7 px of the circle's top flank on the hoarding-curve
    // fixture) it merges the neighbor's pixels into the refit and DRIFTS
    // the conic off the component's own evidence (semi 71 vs the true
    // 101, center 28 px off — measured). The component's OWN pixels are
    // the complete evidence for its structure; the support re-fit above
    // already stabilizes the subset conic.
    const best = componentRefits[0]!;
    const support = conicSupportAndCoverage(best.geometry, component);
    alternatives.push({ fit: { conic: best.conic, geometry: best.geometry, ...support } });
  }
  for (const refit of refits.slice(1)) {
    const band = bandRefineConic(refit.conic, refit.geometry, staticPixels, width, height);
    const support = conicSupportAndCoverage(band.geometry, arcPixels);
    alternatives.push({ fit: { conic: band.conic, geometry: band.geometry, ...support } });
  }
  for (const alternative of alternatives) {
    if (chain.length >= ELLIPSE_MAX_CONIC_CANDIDATES) break;
    const fit = alternative.fit;
    if (fit.supportPx < ELLIPSE_MIN_SUPPORT_PX || fit.coverageBins < ELLIPSE_MIN_COVERAGE_BINS) {
      continue;
    }
    if (chain.some((kept) => !conicsDistinct(kept.geometry, fit.geometry))) continue;
    chain.push(fit);
  }
  return chain;
}

// ---------------------------------------------------------------------------
// v0.2.0 — the mixed points+lines DLT hypothesis solver.
// ---------------------------------------------------------------------------

/** One image↔pitch point pair, image side in NORMALIZED coordinates. */
interface MixedPointPair {
  readonly u: number;
  readonly v: number;
  readonly x: number;
  readonly y: number;
}

/** One image↔pitch line pair, both sides as unit-normal homogeneous lines. */
interface MixedLinePair {
  /** Image line (a·u + b·v + c = 0, normalized image coordinates). */
  readonly image: readonly number[];
  /** Model line (a·x + b·y + c = 0, pitch meters). */
  readonly pitch: readonly number[];
}

/**
 * The mixed points+lines DLT (module docs E4), solved by Householder QR
 * least squares with unit-norm row equilibration. The first-cut normal
 * equations (AᵀA) proved numerically WORTHLESS on this construction (the
 * measured system was consistent at ~1e-12 residual yet AᵀA collapsed to
 * rank ~2 — squaring the condition number); QR factorizes A directly.
 * Rows: point pairs contribute the W203 `h[8] = 1` row pair; each line
 * pair contributes the 3 cross-product rows of `l_i × (Hᵀ l_w) = 0`.
 * `undefined` when the R diagonal shows a rank deficiency (the parallel
 * same-family pair WITHOUT its closure is exactly rank 7 — the free
 * direction measured as R[2][2] = 0). Deterministic.
 */
function solveMixedDlt(
  pointPairs: readonly MixedPointPair[],
  linePairs: readonly MixedLinePair[],
): Homography | undefined {
  const rawRows: Array<{ coefficients: number[]; rhs: number }> = [];
  for (const pair of pointPairs) {
    rawRows.push({
      coefficients: [pair.u, pair.v, 1, 0, 0, 0, -pair.x * pair.u, -pair.x * pair.v],
      rhs: pair.x,
    });
    rawRows.push({
      coefficients: [0, 0, 0, pair.u, pair.v, 1, -pair.y * pair.u, -pair.y * pair.v],
      rhs: pair.y,
    });
  }
  for (const pair of linePairs) {
    const [ia, ib, ic] = pair.image as [number, number, number];
    const [wa, wb, wc] = pair.pitch as [number, number, number];
    // Hᵀ·l_w = (m0, m1, m2): linear in h0..h7 with the h[8]=1 constant in m2.
    // m0 = wa·h0 + wb·h3 + wc·h6;  m1 = wa·h1 + wb·h4 + wc·h7;
    // m2 = wa·h2 + wb·h5 + wc (the constant rides the m2 row's rhs below).
    const m0 = [wa, 0, 0, wb, 0, 0, wc, 0];
    const m1 = [0, wa, 0, 0, wb, 0, 0, wc];
    const m2 = [0, 0, wa, 0, 0, wb, 0, 0];
    const m2Const = wc;
    const row1 = new Array<number>(8).fill(0);
    for (let k = 0; k < 8; k += 1) {
      row1[k] = ib * m2[k]! - ic * m1[k]!;
    }
    rawRows.push({ coefficients: row1, rhs: -ib * m2Const });
    const row2 = new Array<number>(8).fill(0);
    for (let k = 0; k < 8; k += 1) {
      row2[k] = ic * m0[k]! - ia * m2[k]!;
    }
    rawRows.push({ coefficients: row2, rhs: ia * m2Const });
    const row3 = new Array<number>(8).fill(0);
    for (let k = 0; k < 8; k += 1) {
      row3[k] = ia * m1[k]! - ib * m0[k]!;
    }
    rawRows.push({ coefficients: row3, rhs: 0 });
  }
  if (rawRows.length < 8) return undefined;
  // Unit-norm row equilibration (scale-free rank check + sensible weighting).
  const rows = rawRows.map((row) => {
    const norm = Math.hypot(...row.coefficients, row.rhs);
    if (norm <= 1e-12) return { coefficients: row.coefficients, rhs: row.rhs };
    return { coefficients: row.coefficients.map((v) => v / norm), rhs: row.rhs / norm };
  });
  const n = 8;
  const m = rows.length;
  const a = rows.map((row) => [...row.coefficients]);
  const b = rows.map((row) => row.rhs);
  // Householder QR.
  const rDiagonal = new Array<number>(n).fill(0);
  for (let k = 0; k < n; k += 1) {
    let norm = 0;
    for (let i = k; i < m; i += 1) norm += a[i]![k]! * a[i]![k]!;
    norm = Math.sqrt(norm);
    if (norm <= 1e-13) {
      rDiagonal[k] = 0;
      continue;
    }
    const alpha = a[k]![k]! > 0 ? -norm : norm;
    const v = new Array<number>(m).fill(0);
    v[k] = a[k]![k]! - alpha;
    for (let i = k + 1; i < m; i += 1) v[i] = a[i]![k]!;
    let vNorm2 = 0;
    for (let i = k; i < m; i += 1) vNorm2 += v[i]! * v[i]!;
    if (vNorm2 <= 1e-30) {
      rDiagonal[k] = 0;
      continue;
    }
    rDiagonal[k] = Math.abs(alpha);
    for (let j = k; j < n; j += 1) {
      let dot = 0;
      for (let i = k; i < m; i += 1) dot += v[i]! * a[i]![j]!;
      const f = (2 * dot) / vNorm2;
      for (let i = k; i < m; i += 1) a[i]![j] = a[i]![j]! - f * v[i]!;
    }
    let dotB = 0;
    for (let i = k; i < m; i += 1) dotB += v[i]! * b[i]!;
    const f = (2 * dotB) / vNorm2;
    for (let i = k; i < m; i += 1) b[i] = b[i]! - f * v[i]!;
  }
  // Rank check: every R diagonal must be non-negligible.
  let maxDiagonal = 0;
  for (const value of rDiagonal) maxDiagonal = Math.max(maxDiagonal, value);
  for (const value of rDiagonal) {
    if (value <= 1e-7 * Math.max(maxDiagonal, 1e-9)) return undefined;
  }
  const solution = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i -= 1) {
    let sum = b[i]!;
    for (let j = i + 1; j < n; j += 1) {
      sum = sum - a[i]![j]! * solution[j]!;
    }
    solution[i] = sum / a[i]![i]!;
  }
  if (!solution.every((value) => Number.isFinite(value))) return undefined;
  return [...solution, 1];
}

// ---------------------------------------------------------------------------
// v0.2.0 — world-circle pole-polar anchors (canonical pitch meters).
// ---------------------------------------------------------------------------

/** The center circle of the canonical model (52.5, 34, r = 9.15). */
const CIRCLE_CENTER_X = MID_X;
const CIRCLE_CENTER_Y = MID_Y;
const CIRCLE_R = ARC_RADIUS_M;

/**
 * The polar line of a model line pair's intersection w.r.t. the world
 * circle: the diameter x = 52.5 (same-family y pair), y = 34 (same-family
 * x pair), or polar_circle(corner) for a cross-family pair. `undefined`
 * when the polar line does not cross the circle (margin-guarded).
 */
function worldPolarLineOfModelPair(
  familyA: "x" | "y",
  valueA: number,
  familyB: "x" | "y",
  valueB: number,
): [number, number, number] | undefined {
  let line: [number, number, number];
  if (familyA === familyB) {
    if (familyA === "y") {
      line = [1, 0, -CIRCLE_CENTER_X];
    } else {
      line = [0, 1, -CIRCLE_CENTER_Y];
    }
  } else {
    // The corner (x-value, y-value) — which family supplies which axis.
    const cornerX = familyA === "x" ? valueA : valueB;
    const cornerY = familyA === "y" ? valueA : valueB;
    const dx = cornerX - CIRCLE_CENTER_X;
    const dy = cornerY - CIRCLE_CENTER_Y;
    // polar of (corner): (p−c)·(x−c) = r²  →  dx·x + dy·y − (dx·cx + dy·cy + r²) = 0.
    line = [dx, dy, -(dx * CIRCLE_CENTER_X + dy * CIRCLE_CENTER_Y + CIRCLE_R * CIRCLE_R)];
  }
  const normalized = normalizeLine(line);
  const distance = Math.abs(
    normalized[0] * CIRCLE_CENTER_X + normalized[1] * CIRCLE_CENTER_Y + normalized[2],
  );
  if (distance >= CIRCLE_R - ELLIPSE_POLAR_CIRCLE_MARGIN_M) return undefined;
  return normalized;
}

/**
 * The two intersections of a world line with the center circle (unit-normal
 * line input; `undefined` when it misses). Deterministic order (the
 * −halfChord side along (−b, a) first).
 */
function worldLineCircleIntersections(
  line: readonly number[],
): [{ x: number; y: number }, { x: number; y: number }] | undefined {
  const foot = -(line[0]! * CIRCLE_CENTER_X + line[1]! * CIRCLE_CENTER_Y + line[2]!);
  const fx = CIRCLE_CENTER_X + line[0]! * foot;
  const fy = CIRCLE_CENTER_Y + line[1]! * foot;
  const halfChordSquared = CIRCLE_R * CIRCLE_R - foot * foot;
  if (halfChordSquared <= 0) return undefined;
  const halfChord = Math.sqrt(halfChordSquared);
  const dirX = -line[1]!;
  const dirY = line[0]!;
  return [
    { x: fx - halfChord * dirX, y: fy - halfChord * dirY },
    { x: fx + halfChord * dirX, y: fy + halfChord * dirY },
  ];
}

/**
 * v0.3.0 — the straightness-aware explain mask (the flank-recovery
 * increment): a width×height bitmap where a set pixel may be explained
 * as straight-line evidence. For each Hough line, the along-line support
 * is walked in integer steps (clipped to the frame + explain radius);
 * contiguous stretches where static pixels lie within
 * ELLIPSE_LINE_EXPLAIN_PX of the line (the EXACT v0.2.0 explain
 * predicate) for ≥ ELLIPSE_LINE_STRAIGHT_SUPPORT_PX are "genuinely
 * straight" and their perpendicular ±ELLIPSE_LINE_EXPLAIN_PX band is
 * marked. Stretches below the threshold — the arc-chord "fake" lines
 * whose support IS the circle band — explain NOTHING: the flank's arc
 * evidence survives them. Deterministic (integer steps, fixed
 * thresholds, Math.round on the same inputs).
 */
function buildStraightExplainMask(
  lines: readonly HoughLine[],
  staticMask: Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  const mask = new Uint8Array(width * height);
  const r = ELLIPSE_LINE_EXPLAIN_PX;
  for (let l = 0; l < lines.length; l += 1) {
    const line = lines[l]!;
    const cos = Math.cos(line.theta);
    const sin = Math.sin(line.theta);
    const dx = -sin;
    const dy = cos;
    const fx = cos * line.rho;
    const fy = sin * line.rho;
    // clip the along-line parameter t to the frame padded by r
    let tLo = -Infinity;
    let tHi = Infinity;
    if (dx > 1e-9) {
      tLo = Math.max(tLo, (-r - fx) / dx);
      tHi = Math.min(tHi, (width + r - fx) / dx);
    } else if (dx < -1e-9) {
      tLo = Math.max(tLo, (width + r - fx) / dx);
      tHi = Math.min(tHi, (-r - fx) / dx);
    }
    if (dy > 1e-9) {
      tLo = Math.max(tLo, (-r - fy) / dy);
      tHi = Math.min(tHi, (height + r - fy) / dy);
    } else if (dy < -1e-9) {
      tLo = Math.max(tLo, (height + r - fy) / dy);
      tHi = Math.min(tHi, (-r - fy) / dy);
    }
    if (!Number.isFinite(tLo) || !Number.isFinite(tHi) || tHi <= tLo) continue;
    const tStart = Math.ceil(tLo);
    const tEnd = Math.floor(tHi);
    if (tEnd - tStart < ELLIPSE_LINE_STRAIGHT_SUPPORT_PX) continue;
    // walk; supported(t) uses the exact v0.2.0 explain predicate
    let runStart = -1;
    for (let t = tStart; t <= tEnd + 1; t += 1) {
      let supported = false;
      if (t <= tEnd) {
        const px = fx + t * dx;
        const py = fy + t * dy;
        for (let s = -r; s <= r && !supported; s += 1) {
          const qx = Math.round(px + s * cos);
          const qy = Math.round(py + s * sin);
          for (let oy = -1; oy <= 1 && !supported; oy += 1) {
            for (let ox = -1; ox <= 1; ox += 1) {
              const ax = qx + ox;
              const ay = qy + oy;
              if (ax < 0 || ax >= width || ay < 0 || ay >= height) continue;
              if (staticMask[ay * width + ax] === 0) continue;
              if (Math.abs(ax * cos + ay * sin - line.rho) <= r) {
                supported = true;
                break;
              }
            }
          }
        }
      }
      if (supported && runStart < 0) runStart = t;
      if (!supported && runStart >= 0) {
        if (t - runStart >= ELLIPSE_LINE_STRAIGHT_SUPPORT_PX) {
          for (let u = runStart; u < t; u += 1) {
            const ux = fx + u * dx;
            const uy = fy + u * dy;
            for (let s = -r; s <= r; s += 1) {
              const qx = Math.round(ux + s * cos);
              const qy = Math.round(uy + s * sin);
              if (qx < 0 || qx >= width || qy < 0 || qy >= height) continue;
              // The rounded perpendicular band (the walk positions are
              // rounded to the pixel grid). Measured: the EXACT-distance
              // predicate here (a narrower set) left the synthetic arc
              // window's probe error at 2.6166 m > the 2.5 m contract bar
              // (the extra unexplained pixels are penalty-arc band noise
              // near the model segments) while leaving every REAL window
              // outcome identical — the rounded band is the kept surface
              // (the synthetic proof is the tested contract; the real
              // corpus shows no difference, both recorded in the evidence).
              mask[qy * width + qx] = 1;
            }
          }
        }
        runStart = -1;
      }
    }
  }
  return mask;
}

/**
 * The arc evidence (module docs E1): static pixels below the hoardings line
 * that (a) belong to no long straight run (the run-length curvature
 * pre-filter — see ELLIPSE_RUN_MAX_PX) and (b) are NOT within
 * ELLIPSE_LINE_EXPLAIN_PX of any detected Hough line (sloped straight
 * segments the run filter cannot catch), as a row-major `[x, y, ...]`
 * pixel list. Deterministic.
 *
 * v0.3.0 (straightnessAware, default OFF at this seam — the calibrator
 * and the public diagnostics thread the option): (b) becomes the
 * straightness-aware predicate — only genuinely-straight along-line
 * stretches (see buildStraightExplainMask) explain pixels; the arc-chord
 * "fake" lines leave the near-straight circle flank in the evidence.
 *
 * v0.4.0: returns the DOMINANCE-FILTERED pixel list (today's output,
 * byte-identical — the primary path's RANSAC-mixing leverage guard, module
 * docs E1) ALONGSIDE the sub-dominance connected components (every
 * component ≥ the speck floor, pre-dominance, discovery order) — the
 * conic-selection chain's per-component fit source. Measured necessity:
 * on real windows the hoarding/stand-boundary curve dominates the largest
 * component and the CENTER-CIRCLE arc can fall below the dominance
 * threshold — its pixels are then absent from the filtered evidence, and
 * no global RANSAC subset can ever land on the circle; only the
 * per-component fit over the dropped component recovers it.
 */
interface ArcEvidence {
  /** The dominance-filtered arc pixels (the v0.2.0/v0.3.0 surface). */
  readonly pixels: number[];
  /**
   * Every connected component ≥ ELLIPSE_COMPONENT_MIN_PX, pre-dominance,
   * as flat `[x, y, ...]` lists in discovery order (row-major first
   * pixel). Deterministic.
   */
  readonly components: readonly (readonly number[])[];
}
function extractArcEvidence(
  staticPixels: readonly number[],
  lines: readonly HoughLine[],
  greenTop: Int32Array,
  staticMask: Uint8Array,
  width: number,
  height: number,
  straightnessAware: boolean = false,
): ArcEvidence {
  const cosines = lines.map((line) => Math.cos(line.theta));
  const sines = lines.map((line) => Math.sin(line.theta));
  const rhos = lines.map((line) => line.rho);
  // Per-pixel horizontal run length (one pass per row).
  const rowRuns = new Int32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    let runStart = -1;
    for (let x = 0; x <= width; x += 1) {
      const set = x < width && staticMask[y * width + x] !== 0;
      if (set && runStart < 0) runStart = x;
      if (!set && runStart >= 0) {
        const length = x - runStart;
        for (let k = runStart; k < x; k += 1) rowRuns[y * width + k] = length;
        runStart = -1;
      }
    }
  }
  // Per-pixel vertical run length (one pass per column).
  const columnRuns = new Int32Array(width * height);
  for (let x = 0; x < width; x += 1) {
    let runStart = -1;
    for (let y = 0; y <= height; y += 1) {
      const set = y < height && staticMask[y * width + x] !== 0;
      if (set && runStart < 0) runStart = y;
      if (!set && runStart >= 0) {
        const length = y - runStart;
        for (let k = runStart; k < y; k += 1) columnRuns[k * width + x] = length;
        runStart = -1;
      }
    }
  }
  const arcPixels: number[] = [];
  const explainMask = straightnessAware
    ? buildStraightExplainMask(lines, staticMask, width, height)
    : null;
  for (let p = 0; p < staticPixels.length; p += 2) {
    const x = staticPixels[p]!;
    const y = staticPixels[p + 1]!;
    if (y < greenTop[x]! + HOARDINGS_ROW_MARGIN) continue;
    if (rowRuns[y * width + x]! > ELLIPSE_RUN_MAX_PX) continue;
    if (columnRuns[y * width + x]! > ELLIPSE_RUN_MAX_PX) continue;
    let explained = false;
    if (explainMask !== null) {
      explained = explainMask[y * width + x] !== 0;
    } else {
      for (let l = 0; l < lines.length; l += 1) {
        if (Math.abs(x * cosines[l]! + y * sines[l]! - rhos[l]!) <= ELLIPSE_LINE_EXPLAIN_PX) {
          explained = true;
          break;
        }
      }
    }
    if (!explained) arcPixels.push(x, y);
  }
  // Connected-component dominance filter (see ELLIPSE_COMPONENT_DOMINANCE):
  // keep the components within the dominance fraction of the largest.
  if (arcPixels.length === 0) return { pixels: [], components: [] };
  const index = new Int32Array(width * height).fill(-1);
  for (let p = 0; p < arcPixels.length; p += 2) {
    index[arcPixels[p + 1]! * width + arcPixels[p]!] = p / 2;
  }
  const visited = new Uint8Array(arcPixels.length / 2);
  const componentOf = new Int32Array(arcPixels.length / 2);
  const componentSizes: number[] = [];
  for (let start = 0; start < arcPixels.length / 2; start += 1) {
    if (visited[start] !== 0) continue;
    const component = componentSizes.length;
    let size = 0;
    const stack: number[] = [start];
    visited[start] = 1;
    while (stack.length > 0) {
      const point = stack.pop()!;
      componentOf[point] = component;
      size += 1;
      const x = arcPixels[point * 2]!;
      const y = arcPixels[point * 2 + 1]!;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          const neighbor = index[ny * width + nx]!;
          if (neighbor >= 0 && visited[neighbor] === 0) {
            visited[neighbor] = 1;
            stack.push(neighbor);
          }
        }
      }
    }
    componentSizes.push(size);
  }
  let largest = 0;
  for (const size of componentSizes) largest = Math.max(largest, size);
  const keepThreshold = Math.max(
    ELLIPSE_COMPONENT_MIN_PX,
    Math.ceil(ELLIPSE_COMPONENT_DOMINANCE * largest),
  );
  const kept: number[] = [];
  // v0.4.0: materialize every component (pre-dominance, ≥ the speck
  // floor) in discovery order — the chain's per-component fit source.
  const allComponents: number[][] = componentSizes.map(() => []);
  for (let p = 0; p < arcPixels.length / 2; p += 1) {
    const component = componentOf[p]!;
    allComponents[component]!.push(arcPixels[p * 2]!, arcPixels[p * 2 + 1]!);
    if (componentSizes[component]! >= keepThreshold) {
      kept.push(arcPixels[p * 2]!, arcPixels[p * 2 + 1]!);
    }
  }
  const components = allComponents.filter(
    (component) => component.length >= 2 * ELLIPSE_COMPONENT_MIN_PX,
  );
  return { pixels: kept, components };
}

/**
 * Sub-pixel line refinement (ellipse path): the Hough (theta, rho) are
 * quantized (1° theta bins, 1 px rho) — anchors built from them start the
 * solve ~2-3 m off the truth and the coordinate descent then stalls in a
 * local basin that trades the lines for the ellipse term (measured: the
 * descent converged to lineFit 0.458 with a 0.3 px conic residual while
 * the true optimum sat far higher). This helper re-fits each detected
 * line by total least squares (PCA) over its supporting static pixels,
 * giving the anchors sub-pixel accuracy. Deterministic.
 */
function refineLineSubpixel(
  line: HoughLine,
  staticPixels: readonly number[],
): { theta: number; rho: number } {
  const c = Math.cos(line.theta);
  const s = Math.sin(line.theta);
  let count = 0;
  let sumX = 0;
  let sumY = 0;
  for (let p = 0; p < staticPixels.length; p += 2) {
    const x = staticPixels[p]!;
    const y = staticPixels[p + 1]!;
    if (Math.abs(x * c + y * s - line.rho) <= HOUGH_LINE_TOLERANCE_PX) {
      count += 1;
      sumX += x;
      sumY += y;
    }
  }
  if (count < 10) return { theta: line.theta, rho: line.rho };
  const meanX = sumX / count;
  const meanY = sumY / count;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (let p = 0; p < staticPixels.length; p += 2) {
    const x = staticPixels[p]!;
    const y = staticPixels[p + 1]!;
    if (Math.abs(x * c + y * s - line.rho) <= HOUGH_LINE_TOLERANCE_PX) {
      const dx = x - meanX;
      const dy = y - meanY;
      sxx += dx * dx;
      syy += dy * dy;
      sxy += dx * dy;
    }
  }
  // Principal direction: the eigenvector of the larger eigenvalue of
  // [[sxx, sxy], [sxy, syy]]; the line's NORMAL is perpendicular to it.
  const trace = sxx + syy;
  const det = sxx * syy - sxy * sxy;
  const discriminant = Math.max(0, (trace / 2) ** 2 - det);
  const largest = trace / 2 + Math.sqrt(discriminant);
  // Eigenvector for `largest`: (sxy, largest - sxx) (or (largest - syy, sxy)).
  let dirX: number;
  let dirY: number;
  if (Math.abs(sxy) > 1e-9 || Math.abs(largest - sxx) > Math.abs(largest - syy)) {
    dirX = sxy;
    dirY = largest - sxx;
  } else {
    dirX = largest - syy;
    dirY = sxy;
  }
  const dirNorm = Math.hypot(dirX, dirY);
  if (dirNorm <= 1e-9) return { theta: line.theta, rho: line.rho };
  dirX /= dirNorm;
  dirY /= dirNorm;
  // The line through (meanX, meanY) with direction (dirX, dirY); its normal
  // form: n·x = n·mean with n = (-dirY, dirX).
  const nX = -dirY;
  const nY = dirX;
  let theta = Math.atan2(nY, nX);
  if (theta < 0) theta += Math.PI;
  if (theta >= Math.PI) theta -= Math.PI;
  const rho = meanX * nX + meanY * nY;
  return { theta, rho };
}

/** World-circle sample points (every 2°) for the refinement/validation terms. */
function worldCircleSamples(): Float64Array {
  const samples = new Float64Array(ELLIPSE_CIRCLE_SAMPLES * 2);
  for (let i = 0; i < ELLIPSE_CIRCLE_SAMPLES; i += 1) {
    const angle = (i * 2 * Math.PI) / ELLIPSE_CIRCLE_SAMPLES;
    samples[i * 2] = CIRCLE_CENTER_X + CIRCLE_R * Math.cos(angle);
    samples[i * 2 + 1] = CIRCLE_CENTER_Y + CIRCLE_R * Math.sin(angle);
  }
  return samples;
}

/**
 * The ellipse term (module docs E5): mean clamp(1 − d/ELLIPSE_REFINE_
 * TOLERANCE_PX, 0, 1) over IN-FRAME projected world-circle sample points
 * (out-of-frame points carry no evidence); 0 when fewer than
 * ELLIPSE_MIN_IN_FRAME_FRACTION of the samples are in frame (a hypothesis
 * that pushes the circle out of view earns nothing). `width`/`height` are
 * pixel dims; the conic is in pixel coordinates.
 */
function ellipseRewardTerm(
  inverse: Homography,
  conic: EllipseConic,
  width: number,
  height: number,
): number {
  const geometry = conicGeometry(conic);
  if (geometry === undefined) return 0;
  const samples = worldCircleSamples();
  let reward = 0;
  let inFrame = 0;
  for (let p = 0; p < samples.length; p += 2) {
    const projected = projectSafe(inverse, samples[p]!, samples[p + 1]!);
    if (projected === undefined) continue;
    if (projected.x < 0 || projected.x > 1 || projected.y < 0 || projected.y > 1) continue;
    inFrame += 1;
    const x = projected.x * width;
    const y = projected.y * height;
    reward += Math.min(
      1,
      Math.max(0, 1 - pointConicDistancePx(geometry, x, y) / ELLIPSE_REFINE_TOLERANCE_PX),
    );
  }
  if (inFrame < ELLIPSE_MIN_IN_FRAME_FRACTION * ELLIPSE_CIRCLE_SAMPLES) return 0;
  return reward / ELLIPSE_CIRCLE_SAMPLES;
}

/** The mean conic residual (px) over in-frame projected circle points. */
function ellipseMeanResidualPx(
  inverse: Homography,
  conic: EllipseConic,
  width: number,
  height: number,
): { meanPx: number; inFrame: number; inlierFraction: number } {
  const geometry = conicGeometry(conic);
  if (geometry === undefined) return { meanPx: Number.POSITIVE_INFINITY, inFrame: 0, inlierFraction: 0 };
  const samples = worldCircleSamples();
  let sum = 0;
  let inFrame = 0;
  let inliers = 0;
  for (let p = 0; p < samples.length; p += 2) {
    const projected = projectSafe(inverse, samples[p]!, samples[p + 1]!);
    if (projected === undefined) continue;
    if (projected.x < 0 || projected.x > 1 || projected.y < 0 || projected.y > 1) continue;
    inFrame += 1;
    const distance = pointConicDistancePx(geometry, projected.x * width, projected.y * height);
    sum += distance;
    if (distance <= 2 * ELLIPSE_VALIDATION_MAX_PX) inliers += 1;
  }
  return {
    meanPx: inFrame > 0 ? sum / inFrame : Number.POSITIVE_INFINITY,
    inFrame,
    inlierFraction: inFrame > 0 ? inliers / inFrame : 0,
  };
}

/**
 * The line-consistency term (ellipse path): how well `h` maps each
 * hypothesis's MODEL lines onto their DETECTED image lines, in image space
 * (mean clamp(1 − d/ELLIPSE_LINE_CONSISTENCY_PX, 0, 1) over 5 deterministic
 * sample points per detected line, in normalized coordinates scaled to px).
 * MEASURED NECESSITY: without it the refinement can "pinch" the pitch — a
 * degenerate H mapped both touchline images onto essentially one world
 * line (y ≈ 25 ± 1.5 instead of 0 and 68) while keeping the circle on the
 * conic and collecting forward/backward/green rewards; the binary forward
 * score and the spread guards do not see this structure. The anchors' line
 * rows are evidence; the refinement must honor them.
 */
function lineConsistencyTerm(
  h: Homography,
  linePairs: readonly MixedLinePair[],
  width: number,
  height: number,
): number {
  if (linePairs.length === 0) return 0;
  let reward = 0;
  let samples = 0;
  for (const pair of linePairs) {
    const [ia, ib, ic] = pair.image as [number, number, number];
    if (Math.hypot(ia, ib) <= 1e-12) continue;
    // The image of the model line under h: points x_i with l_wᵀ·H·x_i = 0.
    const [wa, wb, wc] = pair.pitch as [number, number, number];
    const la = wa * h[0]! + wb * h[3]! + wc * h[6]!;
    const lb = wa * h[1]! + wb * h[4]! + wc * h[7]!;
    const lc = wa * h[2]! + wb * h[5]! + wc * 1;
    const modelNorm = Math.hypot(la, lb);
    if (modelNorm <= 1e-12) continue;
    // 5 deterministic sample points on the DETECTED line, in-frame: walk
    // the direction (-ib, ia) from the in-frame foot of the perpendicular.
    const nX = ia;
    const nY = ib;
    const footDistance = -ic; // distance from origin along the normal (unit line).
    const footU = nX * footDistance;
    const footV = nY * footDistance;
    const dirU = -nY;
    const dirV = nX;
    for (let k = -2; k <= 2; k += 1) {
      // Spread sample points over ±0.3 of the frame along the line.
      const u = footU + dirU * k * 0.15;
      const v = footV + dirV * k * 0.15;
      if (u < 0 || u > 1 || v < 0 || v > 1) continue;
      const distanceNormalized = Math.abs(la * u + lb * v + lc) / modelNorm;
      const distancePx = Math.hypot(distanceNormalized * width, distanceNormalized * height) / 2;
      reward += Math.min(1, Math.max(0, 1 - distancePx / ELLIPSE_LINE_CONSISTENCY_PX));
      samples += 1;
    }
  }
  return samples > 0 ? reward / samples : 0;
}

/** One detected line with its hypothesized model-family value (meters). */
interface AssignedModelLine {
  readonly line: HoughLine;
  readonly family: "x" | "y";
  readonly value: number;
}

/** The tangent line to a conic at one of its points (homogeneous, px). */
function conicTangentAt(conic: EllipseConic, point: { x: number; y: number }): [number, number, number] {
  const m = conicMatrix(conic);
  const p = [point.x, point.y, 1];
  return [
    m[0]! * p[0]! + m[1]! * p[1]! + m[2]! * p[2]!,
    m[3]! * p[0]! + m[4]! * p[1]! + m[5]! * p[2]!,
    m[6]! * p[0]! + m[7]! * p[1]! + m[8]! * p[2]!,
  ];
}

/** The tangent line to the world center circle at one of its points. */
function circleTangentAt(point: { x: number; y: number }): [number, number, number] {
  const a = point.x - CIRCLE_CENTER_X;
  const b = point.y - CIRCLE_CENTER_Y;
  return normalizeLine([
    a,
    b,
    -(CIRCLE_R * CIRCLE_R + a * CIRCLE_CENTER_X + b * CIRCLE_CENTER_Y),
  ]);
}

/** A homogeneous px line converted to normalized image coordinates. */
function pxLineToNormalized(
  line: readonly number[],
  width: number,
  height: number,
): [number, number, number] {
  return normalizeLine([line[0]! * width, line[1]! * height, line[2]!]);
}

/** A homogeneous px point converted to normalized image coordinates. */
function pxPointToNormalized(point: { x: number; y: number }, width: number, height: number) {
  return { u: point.x / width, v: point.y / height };
}

/** The base anchor set of one (pair, values, Q-flip) hypothesis. */
interface EllipseBaseAnchors {
  /** The Q point pairs (conic∩polar ↔ circle∩world-polar). */
  readonly points: ReadonlyArray<{ u: number; v: number; x: number; y: number }>;
  /** The line rows: both detected lines + the polar line + the Q tangents. */
  readonly lines: ReadonlyArray<{ image: readonly number[]; pitch: readonly number[] }>;
}

/**
 * The E4 base anchor construction for ONE same-family (pair, model values)
 * hypothesis, per Q-flip: the Q anchors (conic∩polar(intersection) ↔
 * circle∩world-polar — incidence-preserving, verified exact on the
 * synthetic ground truth) + the line rows (both detected lines + the polar
 * line + the circle tangents at the Q points). The construction is
 * POLE-FREE (poles of far lines are high-leverage: a 1 px conic error
 * moved one 8.7 px — measured) and needs the 1-DOF scan closure (see
 * `scanEllipseHypothesis`) because two parallel lines + the conic leave
 * exactly one degree of freedom that no collinear anchor can pin (the
 * line rows and vanishing-point rows are scale-invariant in the channel
 * blocks — measured: a near-null direction left the block at 1/31 of the
 * truth).
 *
 * v0.5.0 (E4b, ADDITIVE): the optional `nearPole` — the pole of the pair's
 * NEAR line (the smaller model value) w.r.t. the conic ↔ w.r.t. the world
 * circle, a well-conditioned point correspondence — is PREPENDED to the
 * base's point rows. The pole row fires ONLY on the anchor-conversion path
 * (the default path passes `undefined` and gets the exact v0.2.0-v0.4.1
 * anchor construction, byte-identical); it is SKIPPED (undefined) when the
 * pole is at/near infinity (the line passes through the conic's center —
 * e.g. the model halfway line x = 52.5) or outside the anchor bounds.
 */
function buildEllipseBaseAnchors(
  conic: EllipseConic,
  a: AssignedModelLine,
  b: AssignedModelLine,
  subpixel: ReadonlyMap<HoughLine, { theta: number; rho: number }>,
  width: number,
  height: number,
  nearPole?: { u: number; v: number; x: number; y: number },
): Array<EllipseBaseAnchors> {
  if (a.family !== b.family) return [];
  const linePx = (line: HoughLine): [number, number, number] => {
    const refined = subpixel.get(line) ?? { theta: line.theta, rho: line.rho };
    return [Math.cos(refined.theta), Math.sin(refined.theta), -refined.rho];
  };
  const lineNorm = (line: HoughLine): [number, number, number] => {
    const refined = subpixel.get(line) ?? { theta: line.theta, rho: line.rho };
    return pxLineToNormalized(
      [Math.cos(refined.theta), Math.sin(refined.theta), -refined.rho],
      width,
      height,
    );
  };
  const modelLineNorm = (family: "x" | "y", value: number): [number, number, number] =>
    family === "x" ? normalizeLine([1, 0, -value]) : normalizeLine([0, 1, -value]);

  const anchorBound = 5;
  const intersection = intersectLines(linePx(a.line), linePx(b.line));
  const polarWorld = worldPolarLineOfModelPair(a.family, a.value, b.family, b.value);
  if (intersection === undefined || polarWorld === undefined) return [];
  const polarPx = normalizeLine(polarOfPoint(conic, intersection));
  const imageQ = lineConicIntersections(conic, polarPx);
  const worldQ = worldLineCircleIntersections(polarWorld);
  if (imageQ.length !== 2 || worldQ === undefined) return [];
  if (
    Math.abs(imageQ[0]!.x) > anchorBound * width ||
    Math.abs(imageQ[0]!.y) > anchorBound * height ||
    Math.abs(imageQ[1]!.x) > anchorBound * width ||
    Math.abs(imageQ[1]!.y) > anchorBound * height
  ) {
    return [];
  }
  const results: EllipseBaseAnchors[] = [];
  for (let flip = 0; flip < 2; flip += 1) {
    const q0 = flip === 0 ? worldQ[0] : worldQ[1];
    const q1 = flip === 0 ? worldQ[1] : worldQ[0];
    results.push({
      points: [
        ...(nearPole !== undefined ? [nearPole] : []),
        { ...pxPointToNormalized(imageQ[0]!, width, height), x: q0.x, y: q0.y },
        { ...pxPointToNormalized(imageQ[1]!, width, height), x: q1.x, y: q1.y },
      ],
      lines: [
        { image: lineNorm(a.line), pitch: modelLineNorm(a.family, a.value) },
        { image: lineNorm(b.line), pitch: modelLineNorm(b.family, b.value) },
        { image: pxLineToNormalized(polarPx, width, height), pitch: polarWorld },
        { image: pxLineToNormalized(conicTangentAt(conic, imageQ[0]!), width, height), pitch: circleTangentAt(q0) },
        { image: pxLineToNormalized(conicTangentAt(conic, imageQ[1]!), width, height), pitch: circleTangentAt(q1) },
      ],
    });
  }
  return results;
}

/** The conic point at parametric angle t (px). */
function conicPointAt(geometry: EllipseGeometry, t: number): { x: number; y: number } {
  const cos = Math.cos(geometry.rotation);
  const sin = Math.sin(geometry.rotation);
  const ux = geometry.semiMajor * Math.cos(t);
  const uy = geometry.semiMinor * Math.sin(t);
  return {
    x: geometry.centerX + ux * cos - uy * sin,
    y: geometry.centerY + ux * sin + uy * cos,
  };
}

/** The scan's closing anchors: world circle point at angle 0 and its tangent. */
const SCAN_WORLD_POINT = { x: CIRCLE_CENTER_X + CIRCLE_R, y: CIRCLE_CENTER_Y };

/**
 * The E4 1-DOF scan closure: two same-family parallel lines + the conic
 * leave exactly one degree of freedom (which conic point is the image of
 * the world circle point at angle 0). The scan closes it deterministically:
 * a coarse pass (ELLIPSE_SCAN_COARSE steps over the full conic parameter),
 * then a fine pass around the coarse best (ELLIPSE_SCAN_FINE steps over
 * ±one coarse step), each candidate solved by the mixed DLT over the base
 * anchors + the scanned point pair + its tangent line row, scored by a
 * mini forward score (the line rows' violation grows with the parameter
 * error — the discriminator). The best-scoring candidate of the fine pass
 * is returned (or the coarse best if every fine solve fails).
 */
function scanEllipseHypothesis(
  conic: EllipseConic,
  geometry: EllipseGeometry,
  base: EllipseBaseAnchors,
  scanPoints: readonly number[],
  width: number,
  height: number,
): { homography: Homography; linePairs: readonly MixedLinePair[] } | undefined {
  const tangentWorld = circleTangentAt(SCAN_WORLD_POINT);
  const solveAt = (t: number): { homography: Homography; linePairs: readonly MixedLinePair[] } | undefined => {
    const p = conicPointAt(geometry, t);
    if (Math.abs(p.x) > 5 * width || Math.abs(p.y) > 5 * height) return undefined;
    const points: MixedPointPair[] = [
      ...base.points.map((point) => ({ u: point.u, v: point.v, x: point.x, y: point.y })),
      { ...pxPointToNormalized(p, width, height), x: SCAN_WORLD_POINT.x, y: SCAN_WORLD_POINT.y },
    ];
    const lines: MixedLinePair[] = [
      ...base.lines.map((line) => ({ image: line.image, pitch: line.pitch })),
      { image: pxLineToNormalized(conicTangentAt(conic, p), width, height), pitch: tangentWorld },
    ];
    const homography = solveMixedDlt(points, lines);
    if (homography === undefined) return undefined;
    return { homography, linePairs: lines };
  };
  const scoreAt = (candidate: { homography: Homography } | undefined): number => {
    if (candidate === undefined) return Number.NEGATIVE_INFINITY;
    return forwardScoreOnPoints(candidate.homography, scanPoints);
  };
  let bestT = Number.NaN;
  let best = undefined as ReturnType<typeof solveAt>;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (let step = 0; step < ELLIPSE_SCAN_COARSE; step += 1) {
    const t = (step * 2 * Math.PI) / ELLIPSE_SCAN_COARSE;
    const candidate = solveAt(t);
    const score = scoreAt(candidate);
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
      bestT = t;
    }
  }
  if (best === undefined || Number.isNaN(bestT)) return undefined;
  const coarseStep = (2 * Math.PI) / ELLIPSE_SCAN_COARSE;
  for (let step = 1; step < ELLIPSE_SCAN_FINE; step += 1) {
    const t = bestT - coarseStep + (2 * coarseStep * step) / ELLIPSE_SCAN_FINE;
    const candidate = solveAt(t);
    const score = scoreAt(candidate);
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}

/**
 * The mini forward score used by the scan (module twin of the calibrator's
 * `forwardScoreOn` — a pure function of the homography and points).
 */
function forwardScoreOnPoints(h: Homography, points: readonly number[]): number {
  if (points.length === 0) return 0;
  let inliers = 0;
  for (let p = 0; p < points.length; p += 2) {
    const projected = projectSafe(h, points[p]!, points[p + 1]!);
    if (projected !== undefined && modelDistanceAt(projected.x, projected.y) <= SCORE_RADIUS_M) {
      inliers += 1;
    }
  }
  return inliers / (points.length / 2);
}

// ---------------------------------------------------------------------------
// v0.5.0 — the E4b anchor-conversion machinery (the Lorentz-frame
// J-orthogonal exact closure; pure, deterministic; module docs E4b).
// ---------------------------------------------------------------------------

/** The Lorentz form J = diag(1, 1, −1) as a row-major 3x3 matrix. */
const LORENTZ_J: readonly number[] = [1, 0, 0, 0, 1, 0, 0, 0, -1];

/**
 * The world center circle's homogeneous conic matrix (pitch meters):
 * (x − cx)² + (y − cy)² − r²·z² = 0 for the canonical model circle
 * (52.5, 34, r = 9.15) — the W side of the E4b factorization.
 */
const WORLD_CIRCLE_CONIC: readonly number[] = [
  1, 0, -CIRCLE_CENTER_X,
  0, 1, -CIRCLE_CENTER_Y,
  -CIRCLE_CENTER_X, -CIRCLE_CENTER_Y,
  CIRCLE_CENTER_X * CIRCLE_CENTER_X + CIRCLE_CENTER_Y * CIRCLE_CENTER_Y - CIRCLE_R * CIRCLE_R,
];

/** Row-major 3x3 matrix product A·B. */
function mat3Mul(a: readonly number[], b: readonly number[]): number[] {
  const out = new Array<number>(9);
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      out[row * 3 + col] =
        a[row * 3]! * b[col]! +
        a[row * 3 + 1]! * b[3 + col]! +
        a[row * 3 + 2]! * b[6 + col]!;
    }
  }
  return out;
}

/** The congruence Mᵀ·C·M of row-major 3x3 matrices. */
function mat3Congruence(m: readonly number[], c: readonly number[]): number[] {
  const cm = mat3Mul(c, m);
  const out = new Array<number>(9);
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      out[row * 3 + col] =
        m[row]! * cm[col]! +
        m[3 + row]! * cm[3 + col]! +
        m[6 + row]! * cm[6 + col]!;
    }
  }
  return out;
}

/** The Lorentz congruence Mᵀ·J·M (J = diag(1, 1, −1)) of a row-major 3x3. */
function mat3JCongruence(m: readonly number[]): number[] {
  const out = new Array<number>(9);
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      out[row * 3 + col] =
        m[row]! * m[col]! +
        m[3 + row]! * m[3 + col]! -
        m[6 + row]! * m[6 + col]!;
    }
  }
  return out;
}

/** Relative Frobenius deviation ||a − b||_F / ||b||_F (0 when b = 0). */
function mat3RelativeFrobenius(a: readonly number[], b: readonly number[]): number {
  let diff = 0;
  let norm = 0;
  for (let k = 0; k < 9; k += 1) {
    diff += (a[k]! - b[k]!) ** 2;
    norm += b[k]! ** 2;
  }
  if (norm <= 0) return Number.POSITIVE_INFINITY;
  return Math.sqrt(diff / norm);
}

/**
 * The inverse of a row-major 3x3 matrix (the adjugate over the
 * determinant), or `undefined` for a (near-)singular or non-finite input.
 * Deterministic. [E4b: the frame's G⁻¹ / W⁻¹ and the conic inverse the pole
 * rows need; returns WITH its unit-contract test — the 6510a54 lint-fix
 * law: dead code never ships, live code ships tested.]
 */
export function invert3x3(m: readonly number[]): number[] | undefined {
  const [m0, m1, m2, m3, m4, m5, m6, m7, m8] = [
    m[0]!, m[1]!, m[2]!, m[3]!, m[4]!, m[5]!, m[6]!, m[7]!, m[8]!,
  ];
  if (![m0, m1, m2, m3, m4, m5, m6, m7, m8].every(Number.isFinite)) return undefined;
  let scale = 0;
  for (const entry of [m0, m1, m2, m3, m4, m5, m6, m7, m8]) {
    scale = Math.max(scale, Math.abs(entry));
  }
  const det =
    m0 * (m4 * m8 - m5 * m7) - m1 * (m3 * m8 - m5 * m6) + m2 * (m3 * m7 - m4 * m6);
  if (!Number.isFinite(det) || Math.abs(det) <= 1e-12 * Math.max(scale, 1e-300)) {
    return undefined;
  }
  const inverse = [
    (m4 * m8 - m5 * m7) / det, (m2 * m7 - m1 * m8) / det, (m1 * m5 - m2 * m4) / det,
    (m5 * m6 - m3 * m8) / det, (m0 * m8 - m2 * m6) / det, (m2 * m3 - m0 * m5) / det,
    (m3 * m7 - m4 * m6) / det, (m1 * m6 - m0 * m7) / det, (m0 * m4 - m1 * m3) / det,
  ];
  if (!inverse.every(Number.isFinite)) return undefined;
  return inverse;
}

/**
 * The POLE of a homogeneous line w.r.t. a symmetric row-major 3x3 conic
 * matrix: the point p = C⁻¹·l (the polar of p is l — the pole-polar
 * duality every projective map preserves). Returned normalized to
 * max-abs entry 1 (a homogeneous scale convention); `undefined` for a
 * singular conic or a non-finite result. Deterministic.
 * [E4b: the NEAR-LINE POLE ROW — the pole of the pair's near line w.r.t.
 * the normalized image conic ↔ w.r.t. the world circle, a well-conditioned
 * point correspondence; the FAR line's pole is the measured high-leverage
 * class and stays excluded. Returns WITH its unit-contract test.]
 */
export function poleOfLine(
  m: readonly number[],
  line: readonly number[],
): [number, number, number] | undefined {
  const inverse = invert3x3(m);
  if (inverse === undefined) return undefined;
  const x = inverse[0]! * line[0]! + inverse[1]! * line[1]! + inverse[2]! * line[2]!;
  const y = inverse[3]! * line[0]! + inverse[4]! * line[1]! + inverse[5]! * line[2]!;
  const z = inverse[6]! * line[0]! + inverse[7]! * line[1]! + inverse[8]! * line[2]!;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return undefined;
  const scale = Math.max(Math.abs(x), Math.abs(y), Math.abs(z));
  if (scale <= 1e-300) return undefined;
  return [x / scale, y / scale, z / scale];
}

/** The Jacobi eigendecomposition result of a symmetric 3x3 matrix. */
export interface JacobiEigenSym3 {
  /** The eigenvalues, in the Jacobi's own convergence order. */
  readonly values: readonly number[];
  /**
   * The eigenvector basis, row-major 3x3: COLUMN j is the unit eigenvector
   * of `values[j]` (A = V·diag(values)·Vᵀ).
   */
  readonly vectors: readonly number[];
}

/**
 * The JACOBI cyclic eigendecomposition of a symmetric row-major 3x3 matrix:
 * A = V·diag(values)·Vᵀ with V orthogonal, via the fixed pivot order
 * ((0,1), (0,2), (1,2)), the smaller-|t| rotation of the classic Jacobi
 * update, a fixed convergence threshold (off-diagonal Frobenius ≤ 1e-15 of
 * the matrix scale) and a 50-sweep cap. Deterministic: no sorting, no
 * randomness, no clock — the eigenpair order is the iteration's own.
 * [E4b: the Lorentz canonicalization (both conic sides) and the closure
 * projection's eigendecomposition of N. Returns WITH its unit-contract
 * test — including the defining A·v = λ·v contract for every eigenpair.]
 */
export function jacobiEigenSym3(m: readonly number[]): JacobiEigenSym3 {
  // Symmetrize defensively (the inputs are symmetric by construction; the
  // average kills any asymmetric roundtrip noise a caller might carry).
  const a = [
    (m[0]! + m[0]!) / 2, (m[1]! + m[3]!) / 2, (m[2]! + m[6]!) / 2,
    (m[3]! + m[1]!) / 2, (m[4]! + m[4]!) / 2, (m[5]! + m[7]!) / 2,
    (m[6]! + m[2]!) / 2, (m[7]! + m[5]!) / 2, (m[8]! + m[8]!) / 2,
  ];
  const v = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  let scale = 0;
  for (const entry of a) scale = Math.max(scale, Math.abs(entry));
  if (scale <= 1e-300) return { values: [0, 0, 0], vectors: v };
  const threshold = 1e-15 * scale;
  const pivots: ReadonlyArray<readonly [number, number]> = [[0, 1], [0, 2], [1, 2]];
  for (let sweep = 0; sweep < 50; sweep += 1) {
    const off = Math.hypot(a[1]!, a[2]!, a[5]!);
    if (off <= threshold) break;
    for (const [p, q] of pivots) {
      const apq = a[p * 3 + q]!;
      if (Math.abs(apq) <= threshold) continue;
      const app = a[p * 3 + p]!;
      const aqq = a[q * 3 + q]!;
      const tau = (aqq - app) / (2 * apq);
      // The smaller-|t| root; sign(0) → t = 1 (the 45° rotation zeroes the
      // off-diagonal for the exactly-degenerate diagonal pair too).
      const t = tau >= 0
        ? 1 / (tau + Math.sqrt(1 + tau * tau))
        : 1 / (tau - Math.sqrt(1 + tau * tau));
      const c = 1 / Math.sqrt(1 + t * t);
      const s = t * c;
      // A ← Jᵀ·A·J (the (p, q) plane rotation), applied column-wise then
      // row-wise on the symmetric accumulator.
      for (let k = 0; k < 3; k += 1) {
        const akp = a[k * 3 + p]!;
        const akq = a[k * 3 + q]!;
        a[k * 3 + p] = c * akp - s * akq;
        a[k * 3 + q] = s * akp + c * akq;
      }
      for (let k = 0; k < 3; k += 1) {
        const apk = a[p * 3 + k]!;
        const aqk = a[q * 3 + k]!;
        a[p * 3 + k] = c * apk - s * aqk;
        a[q * 3 + k] = s * apk + c * aqk;
      }
      // V ← V·J (the eigenvector accumulation).
      for (let k = 0; k < 3; k += 1) {
        const vkp = v[k * 3 + p]!;
        const vkq = v[k * 3 + q]!;
        v[k * 3 + p] = c * vkp - s * vkq;
        v[k * 3 + q] = s * vkp + c * vkq;
      }
    }
  }
  return { values: [a[0]!, a[4]!, a[8]!], vectors: v };
}

/**
 * Canonicalizes a symmetric row-major 3x3 conic matrix to the Lorentz form
 * J = diag(1, 1, −1): returns G with Gᵀ·J·G = ±q — the representative whose
 * inertia matches J (conic matrices are scale-free, so ±q is the SAME
 * conic; which sign appears is the representative the birth-conic guard
 * verifies against). The construction: the Jacobi eigendecomposition with
 * the odd-sign eigenvalue arranged LAST, G = diag(√|λ|)·Vᵀ over the
 * arranged eigenpairs. `undefined` for the IMAGINARY class (all-same-sign
 * eigenvalues — a conic with no real points cannot carry the
 * x² + y² − z² = 0 form) or a degenerate conic (a ~zero eigenvalue). The
 * SIGN TWIN −q canonicalizes IDENTICALLY (the arrangement is by sign class
 * and the representative by inertia, never by the input's sign).
 * Deterministic.
 */
function lorentzCanonicalize(q: readonly number[]): number[] | undefined {
  const eigen = jacobiEigenSym3(q);
  const values = eigen.values;
  if (!values.every(Number.isFinite)) return undefined;
  let maxAbs = 0;
  for (const value of values) maxAbs = Math.max(maxAbs, Math.abs(value));
  if (maxAbs <= 1e-300) return undefined;
  let positives = 0;
  let negatives = 0;
  for (const value of values) {
    if (value > 0) positives += 1;
    else negatives += 1;
  }
  // The IMAGINARY class: an all-same-sign (definite) conic matrix has no
  // real points, and no real congruence can carry it onto J.
  if (positives === 3 || negatives === 3) return undefined;
  // The degenerate class: a ~zero eigenvalue (a point / line-pair conic).
  for (const value of values) {
    if (Math.abs(value) <= ELLIPSE_ANCHOR_EIGEN_ZERO_REL * maxAbs) return undefined;
  }
  // Arrange the odd-sign eigenvalue LAST (a stable partition of the Jacobi's
  // own eigenpair order — deterministic, and invariant under the sign twin).
  const oddIndex = positives === 1
    ? values.findIndex((value) => value > 0)
    : values.findIndex((value) => value < 0);
  if (oddIndex < 0) return undefined;
  const order = [0, 1, 2].filter((index) => index !== oddIndex);
  order.push(oddIndex);
  const vectors = eigen.vectors;
  const g = new Array<number>(9);
  for (let row = 0; row < 3; row += 1) {
    const diagonal = Math.sqrt(Math.abs(values[order[row]!]!));
    for (let col = 0; col < 3; col += 1) {
      g[row * 3 + col] = diagonal * vectors[col * 3 + order[row]!]!;
    }
  }
  if (!g.every(Number.isFinite)) return undefined;
  return g;
}

/** The E4b Lorentz frame of one (image conic, world circle) correspondence. */
export interface BroadcastEllipseAnchorFrame {
  /** G with Gᵀ·J·G = qCanon (row-major 9; NORMALIZED image coordinates). */
  readonly g: readonly number[];
  /** G⁻¹ (row-major 9). */
  readonly gInverse: readonly number[];
  /** The J-matching representative of the normalized image conic (= GᵀJG). */
  readonly qCanon: readonly number[];
  /** W with Wᵀ·J·W = cCanon (row-major 9; pitch meters). */
  readonly w: readonly number[];
  /** W⁻¹ (row-major 9). */
  readonly wInverse: readonly number[];
  /** The J-matching representative of the world circle (= WᵀJW). */
  readonly cCanon: readonly number[];
}

/**
 * Builds the E4b Lorentz frame: the image conic (in NORMALIZED image
 * coordinates — the machinery's homographies map normalized image coords →
 * pitch, NOT pixels: Q̂ = Sᵀ·C_px·S with S = diag(width, height, 1)) and the
 * world circle both canonicalized to the Lorentz form J = diag(1, 1, −1)
 * (G with GᵀJG = qCanon, W with WᵀJW = cCanon), so the unknown homography
 * factors as H = W⁻¹·P·G with P J-ORTHOGONAL — the conic correspondence
 * Hᵀ·C_w·H = qCanon is then P's DEFINING property, exact for every P.
 * `undefined` when either canonicalization refuses (the IMAGINARY /
 * degenerate classes — a fitted real ellipse never refuses; the guard is
 * fail-loud for the typed unconvertible refusal). Validates its inputs
 * fail-loud (RangeError) per the diagnostic-export contract.
 */
export function buildBroadcastEllipseAnchorFrame(
  conic: EllipseConic,
  width: number,
  height: number,
): BroadcastEllipseAnchorFrame | undefined {
  if (
    !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0
  ) {
    throw new RangeError(
      `buildBroadcastEllipseAnchorFrame: width/height must be finite positive ` +
        `(got ${width}x${height})`,
    );
  }
  if (![conic.a, conic.b, conic.c, conic.d, conic.e, conic.f].every(Number.isFinite)) {
    throw new RangeError(
      "buildBroadcastEllipseAnchorFrame: the conic coefficients must all be finite",
    );
  }
  const cPx = conicMatrix(conic);
  // Q̂ = Sᵀ·C_px·S — the conic in NORMALIZED image coordinates.
  const qHat = [
    cPx[0]! * width * width, cPx[1]! * width * height, cPx[2]! * width,
    cPx[3]! * width * height, cPx[4]! * height * height, cPx[5]! * height,
    cPx[6]! * width, cPx[7]! * height, cPx[8]!,
  ];
  const g = lorentzCanonicalize(qHat);
  if (g === undefined) return undefined;
  const w = lorentzCanonicalize(WORLD_CIRCLE_CONIC);
  if (w === undefined) return undefined;
  const gInverse = invert3x3(g);
  const wInverse = invert3x3(w);
  if (gInverse === undefined || wInverse === undefined) return undefined;
  return {
    g,
    gInverse,
    qCanon: mat3JCongruence(g),
    w,
    wInverse,
    cCanon: mat3JCongruence(w),
  };
}

/**
 * The E4b conversion outcome of ONE homography: the J-orthogonal exact
 * closure (`converted`, carrying the canonical h[8] = 1 homography, the
 * measured relative deviation of N from μ·J, and whether the fast path
 * fired) or the guard that refused it (`unconverted`, with the reason).
 */
export type BroadcastEllipseAnchorConversion =
  | {
    readonly kind: "converted";
    readonly homography: Homography;
    readonly relativeDeviation: number;
    readonly fastPath: boolean;
  }
  | {
    readonly kind: "unconverted";
    readonly reason:
      | "conic-canonicalization"
      | "admissibility-bound"
      | "closure-self-check"
      | "birth-conic-guard"
      | "conic-hard-guard";
    readonly relativeDeviation: number;
  };

/**
 * The E4b J-ORTHOGONAL EXACT CLOSURE of one homography against one conic
 * (module docs E4b, the single-shot form — the scan loop calls the shared
 * per-frame core directly): M₀ = W·H·G⁻¹, N = M₀ᵀJM₀ measures the solve's
 * conic correspondence (N = μ·J ⟺ exact), and the projection onto the
 * J-orthogonal class runs the FAST PATH (N ≈ μ·J ⟹ M₀/√μ, the NEAREST map
 * — the eigendecomposition path's ULP-level tie order in the degenerate
 * eigenpair composes an arbitrary rotation of the degenerate plane instead,
 * a legitimate J-orthogonal map but NOT the nearest one, breaking the
 * true-H fixed point: the measured defect the fast path fixes) or the
 * EIGENDECOMPOSITION PATH (B with BᵀJB = N, P̂ = M₀·B⁻¹), both under the
 * fail-loud self-check (P̂ᵀJP̂ ≈ J, a positive scale), then the admissibility
 * bound, the birth conic guard and the conic hard guard. Validates its
 * inputs fail-loud (RangeError); refuses (never throws) on the conversion
 * guards — the typed unconvertible refusal carries the counts.
 */
export function convertBroadcastEllipseAnchor(
  conic: EllipseConic,
  width: number,
  height: number,
  homography: Homography,
): BroadcastEllipseAnchorConversion {
  if (
    !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0
  ) {
    throw new RangeError(
      `convertBroadcastEllipseAnchor: width/height must be finite positive ` +
        `(got ${width}x${height})`,
    );
  }
  if (homography.length !== 9 || !homography.every(Number.isFinite)) {
    throw new RangeError(
      "convertBroadcastEllipseAnchor: the homography must be 9 finite entries",
    );
  }
  const geometry = conicGeometry(conic);
  if (geometry === undefined) {
    return {
      kind: "unconverted",
      reason: "conic-canonicalization",
      relativeDeviation: Number.POSITIVE_INFINITY,
    };
  }
  const frame = buildBroadcastEllipseAnchorFrame(conic, width, height);
  if (frame === undefined) {
    return {
      kind: "unconverted",
      reason: "conic-canonicalization",
      relativeDeviation: Number.POSITIVE_INFINITY,
    };
  }
  return convertAnchorWithFrame(frame, geometry, width, height, homography);
}

/**
 * The E4b conversion core over a PRE-BUILT frame (the scan loop builds the
 * frame once per conic candidate and converts every enumerated solve
 * through it). Pure, deterministic, never throws.
 */
function convertAnchorWithFrame(
  frame: BroadcastEllipseAnchorFrame,
  geometry: EllipseGeometry,
  width: number,
  height: number,
  homography: Homography,
): BroadcastEllipseAnchorConversion {
  // M₀ = W·H_t·G⁻¹ — the initial Lorentz map of the scan solve.
  const m0 = mat3Mul(frame.w, mat3Mul(homography, frame.gInverse));
  if (!m0.every(Number.isFinite)) {
    return { kind: "unconverted", reason: "closure-self-check", relativeDeviation: Number.POSITIVE_INFINITY };
  }
  // N = M₀ᵀJM₀; μ = (N₀₀ + N₁₁ − N₂₂)/3 (the J-weighted trace over 3);
  // dev = max|N − μ·J| / |μ| (the relative deviation from μ·J).
  const n = mat3JCongruence(m0);
  let scale = 0;
  for (const entry of n) scale = Math.max(scale, Math.abs(entry));
  const mu = (n[0]! + n[4]! - n[8]!) / 3;
  if (!Number.isFinite(mu) || Math.abs(mu) <= 1e-12 * Math.max(scale, 1e-300)) {
    return { kind: "unconverted", reason: "admissibility-bound", relativeDeviation: Number.POSITIVE_INFINITY };
  }
  const deviation = Math.max(
    Math.abs(n[0]! - mu),
    Math.abs(n[4]! - mu),
    Math.abs(n[8]! + mu),
    Math.abs(n[1]!),
    Math.abs(n[2]!),
    Math.abs(n[5]!),
  ) / Math.abs(mu);
  let hRaw: number[];
  let fastPath = false;
  if (deviation <= ELLIPSE_ANCHOR_FAST_PATH_TOL && mu > 0) {
    // THE FAST PATH (the measured fixed-point defect's fix): M₀/√μ IS the
    // nearest J-orthogonal map; the eigendecomposition path here would
    // compose the projection with an arbitrary rotation of the degenerate
    // eigenpair's plane (the ULP-level tie order) — legitimate but not
    // nearest, breaking the true-H fixed point.
    fastPath = true;
    const rootMu = Math.sqrt(mu);
    const p = m0.map((entry) => entry / rootMu);
    const selfCheck = mat3JCongruence(p);
    if (mat3RelativeFrobenius(selfCheck, LORENTZ_J) > ELLIPSE_ANCHOR_SELF_CHECK_REL) {
      return { kind: "unconverted", reason: "closure-self-check", relativeDeviation: deviation };
    }
    // W⁻¹·(M₀/√μ)·G = H_t/√μ exactly (the algebra collapses the frame).
    hRaw = homography.map((entry) => entry / rootMu);
  } else {
    // THE ADMISSIBILITY BOUND: only near-conic-consistent anchors convert.
    if (deviation > ELLIPSE_ANCHOR_ADMISSIBILITY_BOUND) {
      return { kind: "unconverted", reason: "admissibility-bound", relativeDeviation: deviation };
    }
    // THE EIGENDECOMPOSITION PATH: B with BᵀJB = N (the same Lorentz
    // canonicalization, on N), P̂ = M₀·B⁻¹.
    const b = lorentzCanonicalize(n);
    if (b === undefined) {
      return { kind: "unconverted", reason: "closure-self-check", relativeDeviation: deviation };
    }
    const bInverse = invert3x3(b);
    if (bInverse === undefined) {
      return { kind: "unconverted", reason: "closure-self-check", relativeDeviation: deviation };
    }
    const p = mat3Mul(m0, bInverse);
    if (!p.every(Number.isFinite)) {
      return { kind: "unconverted", reason: "closure-self-check", relativeDeviation: deviation };
    }
    // THE FAIL-LOUD SELF-CHECK: P̂ᵀJP̂ must be ≈ J at a POSITIVE scale (the
    // construction guarantees it; the comparison to +J refuses −J).
    const selfCheck = mat3JCongruence(p);
    if (mat3RelativeFrobenius(selfCheck, LORENTZ_J) > ELLIPSE_ANCHOR_SELF_CHECK_REL) {
      return { kind: "unconverted", reason: "closure-self-check", relativeDeviation: deviation };
    }
    hRaw = mat3Mul(frame.wInverse, mat3Mul(p, frame.g));
  }
  if (!hRaw.every(Number.isFinite)) {
    return { kind: "unconverted", reason: "closure-self-check", relativeDeviation: deviation };
  }
  // THE BIRTH CONIC GUARD: Ĥᵀ·C_w·Ĥ ≈ qCanon — the conic the solve was born
  // from (the algebraic identity of H = W⁻¹·P·G, verified on every closure).
  const born = mat3Congruence(hRaw, WORLD_CIRCLE_CONIC);
  if (mat3RelativeFrobenius(born, frame.qCanon) > ELLIPSE_ANCHOR_BIRTH_GUARD_REL) {
    return { kind: "unconverted", reason: "birth-conic-guard", relativeDeviation: deviation };
  }
  // The canonical h[8] = 1 output form (the W203 contract surface).
  let hRawScale = 0;
  for (const entry of hRaw) hRawScale = Math.max(hRawScale, Math.abs(entry));
  if (Math.abs(hRaw[8]!) <= 1e-12 * Math.max(hRawScale, 1e-300)) {
    return { kind: "unconverted", reason: "conic-hard-guard", relativeDeviation: deviation };
  }
  const canonical = hRaw.map((entry) => entry / hRaw[8]!);
  // THE CONIC HARD GUARD: the pixel-level mean residual of the world circle
  // projected through Ĥ⁻¹ onto the ORIGINAL px conic.
  let inverse: Homography;
  try {
    inverse = invertHomography(canonical);
  } catch {
    return { kind: "unconverted", reason: "conic-hard-guard", relativeDeviation: deviation };
  }
  const samples = worldCircleSamples();
  let residualSum = 0;
  for (let p = 0; p < samples.length; p += 2) {
    const projected = projectSafe(inverse, samples[p]!, samples[p + 1]!);
    if (projected === undefined) {
      return { kind: "unconverted", reason: "conic-hard-guard", relativeDeviation: deviation };
    }
    residualSum += pointConicDistancePx(geometry, projected.x * width, projected.y * height);
  }
  if (residualSum / (samples.length / 2) > ELLIPSE_ANCHOR_CONIC_GUARD_PX) {
    return { kind: "unconverted", reason: "conic-hard-guard", relativeDeviation: deviation };
  }
  return {
    kind: "converted",
    homography: canonical,
    relativeDeviation: deviation,
    fastPath,
  };
}

// ---------------------------------------------------------------------------
// v0.2.0 — the shared evidence pipeline (steps 0-6 of `calibrate`, verbatim)
// + the public measurement/diagnostic exports.
// ---------------------------------------------------------------------------

/** Options of the evidence pipeline (the calibrator's first three options). */
export interface BroadcastEvidenceOptions {
  /** Minimum green-union fraction of the frame (default 0.2). */
  readonly minPitchFraction?: number;
  /** Local-contrast threshold in brightness units (default 14). */
  readonly lineContrastThreshold?: number;
  /**
   * v0.3.0: straightness-aware Hough-line explain in the arc-evidence
   * extraction (default true — the flank-recovery increment). `false`
   * restores the exact v0.2.0 explain surface (the measurement driver
   * uses it to record the v0.2.0 path).
   */
  readonly ellipseStraightnessAwareExplain?: boolean;
  /**
   * v0.4.0: multi-conic selection — the conic-selection fallback chain
   * (OPT-IN, default false — see the calibrator option). For the
   * diagnostics the option controls whether `conicCandidates` records
   * the full chain (on) or the primary alone (off); the primary and
   * every other field are identical either way.
   */
  readonly ellipseMultiConicSelection?: boolean;
}

/** The extracted evidence bundle (steps 0-6 of the calibrator). */
interface CalibrationEvidence {
  readonly width: number;
  readonly height: number;
  readonly anchorFrame: DetectorFrameInput;
  readonly staticMask: Uint8Array;
  readonly staticPixels: number[];
  readonly lines: HoughLine[];
  readonly horizontalCount: number;
  readonly verticalCount: number;
  readonly greenTop: Int32Array;
  readonly scoredFull: number[];
  readonly scoredSub: number[];
  readonly greenSub: number[];
  /**
   * v0.4.1: the PER-FRAME green masks (raw `isPitchGreen` per frame, in
   * input order) — the chain-only conic grass-support gate's evidence
   * (the median over frames; the calibrator's union/dilatedUnion stay
   * internal to the steps that consume them). Additive plumbing: the
   * masks were already computed in step 1; returning them changes no
   * prior computation.
   */
  readonly greenMasks: readonly Uint8Array[];
}

/**
 * The calibrator's steps 0-6, extracted verbatim (the SAME computations in
 * the SAME order — byte-identical behavior) so the public diagnostics below
 * and `calibrate` share one evidence pipeline. Throws the same typed
 * refusals as `calibrate` for the early stages (empty sequence, no pitch,
 * camera motion, insufficient static evidence).
 */
function extractCalibrationEvidence(
  input: PitchCalibrationInput,
  minPitchFraction: number,
  lineContrastThreshold: number,
): CalibrationEvidence {
  // -- 0. Input shape (untrusted media input, architecture-lock §13). ------
  if (input.frames.length === 0) {
    throw new CandidateFailureError(
      "BroadcastLineCalibrator: an empty frame sequence carries no line evidence",
      { failureClassId: "broadcast-line.insufficient-line-evidence" },
    );
  }
  const width = input.frames[0]!.width;
  const height = input.frames[0]!.height;
  if (width <= 1 || height <= 1) {
    throw new CandidateFailureError(
      "BroadcastLineCalibrator: frame too small to carry line evidence",
      { failureClassId: "broadcast-line.no-pitch-visible", width, height },
    );
  }
  for (const frame of input.frames) {
    if (frame.width !== width || frame.height !== height) {
      throw new RangeError(
        `BroadcastLineCalibrator: all frames must share one size (got ${frame.width}x${frame.height} ` +
          `after ${width}x${height}) — the masks are dimension-bound`,
      );
    }
  }
  const frameCount = input.frames.length;
  const anchorIndex = Math.floor((frameCount - 1) / 2);
  const anchorFrame = input.frames[anchorIndex]!;

  // -- 1. Green union (players' holes filled by the union; dilation fills
  //       the static white line holes + gives boundary lines a margin). ---
  const greenMasks = input.frames.map((frame) => greenMaskOf(frame));
  const union = new Uint8Array(width * height);
  let unionCount = 0;
  for (const mask of greenMasks) {
    for (let i = 0; i < union.length; i += 1) {
      if (mask[i] !== 0 && union[i] === 0) {
        union[i] = 1;
        unionCount += 1;
      }
    }
  }
  const unionFraction = unionCount / (width * height);
  if (unionFraction < minPitchFraction) {
    throw new CandidateFailureError(
      `BroadcastLineCalibrator: green-union fraction ${unionFraction.toFixed(4)} below the ` +
        `minimum ${minPitchFraction} — not enough pitch in view to calibrate honestly`,
      { failureClassId: "broadcast-line.no-pitch-visible", unionFraction },
    );
  }
  const dilatedUnion = dilate3x3(union, width, height, GREEN_UNION_DILATIONS);

  // -- 2. Motion estimation against the anchor (the static-camera check
  //       WITH compensation; panning beyond ±40 px refuses). --------------
  const anchorProfiles = greenProfiles(greenMasks[anchorIndex]!, width, height);
  const anchorColumn = boxSmooth9(anchorProfiles.column);
  const anchorRow = boxSmooth9(anchorProfiles.row);
  const dxs: number[] = [];
  const dys: number[] = [];
  for (const mask of greenMasks) {
    const profiles = greenProfiles(mask, width, height);
    dxs.push(bestProfileShift(boxSmooth9(profiles.column), anchorColumn, MOTION_SEARCH_LIMIT_PX));
    dys.push(bestProfileShift(boxSmooth9(profiles.row), anchorRow, MOTION_SEARCH_LIMIT_PX));
  }
  for (let frame = 0; frame < frameCount; frame += 1) {
    if (Math.abs(dxs[frame]!) > MOTION_REFUSAL_LIMIT_PX || Math.abs(dys[frame]!) > MOTION_REFUSAL_LIMIT_PX) {
      throw new CandidateFailureError(
        `BroadcastLineCalibrator: frame ${frame} content shift (${dxs[frame]}, ${dys[frame]}) px ` +
          `against the anchor exceeds the ±${MOTION_REFUSAL_LIMIT_PX} px compensation envelope — ` +
          `a panning camera; the candidate requires a static window`,
        {
          failureClassId: "broadcast-line.camera-motion",
          frame,
          dx: dxs[frame]!,
          dy: dys[frame]!,
        },
      );
    }
  }

  // -- 3+4. Per-frame local-contrast masks, motion-compensated into anchor
  //         coordinates, dilated, counted; static mask = >= 50% of frames.
  const counts = new Uint16Array(width * height);
  for (let frame = 0; frame < frameCount; frame += 1) {
    const lineMask = lineMaskOf(input.frames[frame]!, dilatedUnion, lineContrastThreshold);
    const compensated = shiftMask(lineMask, width, height, dxs[frame]!, dys[frame]!);
    const dilated = dilate3x3(compensated, width, height, MASK_DILATIONS);
    for (let i = 0; i < counts.length; i += 1) {
      if (dilated[i] !== 0) counts[i]! += 1;
    }
  }
  const staticMask = new Uint8Array(width * height);
  const staticPixels: number[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (counts[index]! / frameCount >= STATIC_MASK_THRESHOLD) {
        staticMask[index] = 1;
        staticPixels.push(x, y);
      }
    }
  }
  if (staticPixels.length / 2 < MIN_STATIC_LINE_PIXELS) {
    throw new CandidateFailureError(
      `BroadcastLineCalibrator: static line mask carries only ${staticPixels.length / 2} px ` +
        `(minimum ${MIN_STATIC_LINE_PIXELS}) — insufficient line evidence for a homography search`,
      { failureClassId: "broadcast-line.insufficient-line-evidence", staticPixels: staticPixels.length / 2 },
    );
  }

  // -- 5. Hough lines. -----------------------------------------------------
  const lines = houghExtractLines(staticPixels, width, height);
  const horizontalCount = lines.filter((line) => isHorizontalish(line)).length;
  const verticalCount = lines.length - horizontalCount;

  // -- 6. Scored static set + hoardings suppression. -----------------------
  // Per-column top edge of the dilated green union; rows above (top + 4)
  // are hoardings and never score. Columns with no green exclude all.
  const greenTop = new Int32Array(width).fill(height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (dilatedUnion[y * width + x] !== 0 && greenTop[x]! === height) {
        greenTop[x] = y;
      }
    }
  }
  const scoredFull: number[] = [];
  for (let p = 0; p < staticPixels.length; p += 2) {
    const x = staticPixels[p]!;
    const y = staticPixels[p + 1]!;
    if (y >= greenTop[x]! + HOARDINGS_ROW_MARGIN) {
      scoredFull.push(x / width, y / height);
    }
  }
  // Deterministic row-major strided subsample for search + refinement.
  const pointCount = scoredFull.length / 2;
  const stride = Math.max(1, Math.ceil(pointCount / SEARCH_SCORE_MAX_POINTS));
  const scoredSub: number[] = [];
  for (let point = 0; point < pointCount; point += stride) {
    scoredSub.push(scoredFull[point * 2]!, scoredFull[point * 2 + 1]!);
  }
  // Green-union pixels (row-major) with the same strided subsampling.
  const greenPixels: number[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (dilatedUnion[y * width + x] !== 0) greenPixels.push(x / width, y / height);
    }
  }
  const greenStride = Math.max(1, Math.ceil(greenPixels.length / 2 / GREEN_SAMPLE_MAX_POINTS));
  const greenSub: number[] = [];
  for (let point = 0; point < greenPixels.length / 2; point += greenStride) {
    greenSub.push(greenPixels[point * 2]!, greenPixels[point * 2 + 1]!);
  }

  return {
    width,
    height,
    anchorFrame,
    staticMask,
    staticPixels,
    lines,
    horizontalCount,
    verticalCount,
    greenTop,
    scoredFull,
    scoredSub,
    greenSub,
    greenMasks,
  };
}

/** Diagnostics of the ellipse-path arc evidence (module docs E1-E3). */
export interface BroadcastEllipseEvidenceDiagnostics {
  /** Residual (arc) pixels after the detected lines explained the mask. */
  readonly arcPixels: number;
  /**
   * Whether the PRIMARY conic (the v0.3.0 RANSAC winner) passed the full
   * quota (support + coverage + sanity).
   */
  readonly fitted: boolean;
  /** Conic center (px), when a sane conic exists. */
  readonly centerPx?: { readonly x: number; readonly y: number };
  /** Semi-major axis (px), when a sane conic exists. */
  readonly semiMajorPx?: number;
  /** Semi-minor axis (px), when a sane conic exists. */
  readonly semiMinorPx?: number;
  /** Major-axis rotation (degrees), when a sane conic exists. */
  readonly rotationDeg?: number;
  /** Supporting arc pixels within the fit tolerance. */
  readonly supportPx?: number;
  /** Occupied 10° coverage bins (of 36). */
  readonly coverageBins?: number;
  /** The fitted conic coefficients (px) — for overlay rendering. */
  readonly conic?: EllipseConic;
  /**
   * v0.4.0: the conic-selection candidate chain (the primary first, then
   * the DISTINCT quota-passing alternatives), each with its geometry,
   * support, coverage, and quota flag — the measured conic-selection
   * record the R606 driver captures per window.
   */
  readonly conicCandidates?: readonly BroadcastConicCandidateDiagnostics[];
  /**
   * v0.4.0: the arc evidence's connected components (pre-dominance,
   * discovery order) with their sizes and centroids — the evidence
   * structure the dominance filter and the chain operate on.
   */
  readonly arcComponents?: readonly BroadcastArcComponentDiagnostics[];
}

/** One arc-evidence connected component (the v0.4.0 diagnostics). */
export interface BroadcastArcComponentDiagnostics {
  /** Component size (px). */
  readonly sizePx: number;
  /** Component centroid (px). */
  readonly centerPx: { readonly x: number; readonly y: number };
}

/** One entry of the diagnostics' conic-selection candidate chain. */
export interface BroadcastConicCandidateDiagnostics {
  /** Candidate conic center (px). */
  readonly centerPx: { readonly x: number; readonly y: number };
  /** Candidate semi-major axis (px). */
  readonly semiMajorPx: number;
  /** Candidate semi-minor axis (px). */
  readonly semiMinorPx: number;
  /** Candidate major-axis rotation (degrees). */
  readonly rotationDeg: number;
  /** Supporting pixels of the candidate's own evidence set. */
  readonly supportPx: number;
  /** Occupied 10° coverage bins (of 36) of the candidate's own evidence. */
  readonly coverageBins: number;
  /** Whether this candidate passes the support + coverage quota. */
  readonly quotaPassed: boolean;
}

/**
 * The ellipse-path arc-evidence diagnostics (module docs E1-E3): re-runs the
 * shared evidence pipeline, extracts the arc evidence, and fits the conic.
 * PURE MEASUREMENT — not part of the calibration contract; the R606 evidence
 * driver and the tests use it to record what the ellipse path sees. Throws
 * the same typed early-stage refusals as `calibrate` (empty sequence, no
 * pitch, camera motion, insufficient static evidence). Deterministic.
 */
export function fitBroadcastEllipseEvidence(
  input: PitchCalibrationInput,
  options: BroadcastEvidenceOptions = {},
): BroadcastEllipseEvidenceDiagnostics {
  const minPitchFraction = options.minPitchFraction ?? BROADCAST_LINE_DEFAULTS.minPitchFraction;
  const lineContrastThreshold =
    options.lineContrastThreshold ?? BROADCAST_LINE_DEFAULTS.lineContrastThreshold;
  const straightnessAware =
    options.ellipseStraightnessAwareExplain ??
    BROADCAST_LINE_DEFAULTS.ellipseStraightnessAwareExplain;
  const multiConic =
    options.ellipseMultiConicSelection ?? BROADCAST_LINE_DEFAULTS.ellipseMultiConicSelection;
  validateEvidenceOptions(minPitchFraction, lineContrastThreshold, straightnessAware, multiConic);
  const evidence = extractCalibrationEvidence(input, minPitchFraction, lineContrastThreshold);
  const arc = extractArcEvidence(
    evidence.staticPixels,
    evidence.lines,
    evidence.greenTop,
    evidence.staticMask,
    evidence.width,
    evidence.height,
    straightnessAware,
  );
  const arcPixels = arc.pixels;
  // The chain with the caller's multi-conic surface so the diagnostics
  // record every candidate (the [0] primary is identical for either
  // option value — the option only appends alternatives).
  const fits = fitArcConicCandidates(
    arcPixels, arc.components, evidence.staticPixels, evidence.width, evidence.height,
    multiConic,
  );
  const fit = fits.length > 0 ? fits[0] : undefined;
  const quotaPassed =
    fit !== undefined &&
    fit.supportPx >= ELLIPSE_MIN_SUPPORT_PX &&
    fit.coverageBins >= ELLIPSE_MIN_COVERAGE_BINS;
  return {
    arcPixels: arcPixels.length / 2,
    fitted: quotaPassed,
    ...(fit !== undefined
      ? {
          centerPx: { x: fit.geometry.centerX, y: fit.geometry.centerY },
          semiMajorPx: fit.geometry.semiMajor,
          semiMinorPx: fit.geometry.semiMinor,
          rotationDeg: (fit.geometry.rotation * 180) / Math.PI,
          supportPx: fit.supportPx,
          coverageBins: fit.coverageBins,
          conic: fit.conic,
        }
      : {}),
    arcComponents: arc.components.map((component) => {
      const count = component.length / 2;
      let sumX = 0;
      let sumY = 0;
      for (let p = 0; p < component.length; p += 2) {
        sumX += component[p]!;
        sumY += component[p + 1]!;
      }
      return {
        sizePx: count,
        centerPx: { x: sumX / count, y: sumY / count },
      };
    }),
    ...(fits.length > 0
      ? {
          conicCandidates: fits.map((candidate) => ({
            centerPx: { x: candidate.geometry.centerX, y: candidate.geometry.centerY },
            semiMajorPx: candidate.geometry.semiMajor,
            semiMinorPx: candidate.geometry.semiMinor,
            rotationDeg: (candidate.geometry.rotation * 180) / Math.PI,
            supportPx: candidate.supportPx,
            coverageBins: candidate.coverageBins,
            quotaPassed:
              candidate.supportPx >= ELLIPSE_MIN_SUPPORT_PX &&
              candidate.coverageBins >= ELLIPSE_MIN_COVERAGE_BINS,
          })),
        }
      : {}),
  };
}

/** Fail-loud validation of the shared evidence options (constructor parity). */
function validateEvidenceOptions(
  minPitchFraction: number,
  lineContrastThreshold: number,
  straightnessAware?: boolean,
  multiConic?: boolean,
): void {
  if (!Number.isFinite(minPitchFraction) || minPitchFraction <= 0 || minPitchFraction > 1) {
    throw new RangeError(
      `fitBroadcastEllipseEvidence: minPitchFraction must be in (0, 1] (got ${minPitchFraction})`,
    );
  }
  if (!Number.isFinite(lineContrastThreshold) || lineContrastThreshold <= 0) {
    throw new RangeError(
      `fitBroadcastEllipseEvidence: lineContrastThreshold must be > 0 (got ${lineContrastThreshold})`,
    );
  }
  if (straightnessAware !== undefined && typeof straightnessAware !== "boolean") {
    throw new RangeError(
      `fitBroadcastEllipseEvidence: ellipseStraightnessAwareExplain must be a boolean ` +
        `(got ${typeof straightnessAware})`,
    );
  }
  if (multiConic !== undefined && typeof multiConic !== "boolean") {
    throw new RangeError(
      `fitBroadcastEllipseEvidence: ellipseMultiConicSelection must be a boolean ` +
        `(got ${typeof multiConic})`,
    );
  }
}

/** Fit-quality metrics of a homography against the broadcast evidence. */
export interface BroadcastLineFitMetrics {
  /** Fraction of scored static pixels within 1.0 m of a model line/arc. */
  readonly lineFit: number;
  /** Mean chamfer distance (px) of in-frame projected model points. */
  readonly backwardPx: number | null;
  /** The scored static pixel count the lineFit was measured over. */
  readonly scoredPixels: number;
  /** Mean conic residual (px) of the projected center circle — when the arc
   * evidence passed its quota. */
  readonly ellipseMeanPx?: number;
  /** Ellipse-path support pixels, when the arc evidence passed its quota. */
  readonly ellipseSupportPx?: number;
  /** Ellipse-path coverage bins (of 36), when the arc evidence passed its quota. */
  readonly ellipseCoverageBins?: number;
}

/**
 * Fit-quality metrics of a GIVEN homography against the same evidence the
 * calibrator extracts (PURE MEASUREMENT — not part of the calibration
 * contract): the v0.1.0 lineFit over the full scored set, the backward
 * chamfer, and — when the arc evidence passes its quota — the projected
 * center-circle's residual against the fitted conic. Throws the same typed
 * early-stage refusals as `calibrate`. Deterministic.
 */
export function evaluateBroadcastLineFit(
  input: PitchCalibrationInput,
  homography: Homography,
  options: BroadcastEvidenceOptions = {},
): BroadcastLineFitMetrics {
  if (
    !Array.isArray(homography) ||
    homography.length !== 9 ||
    !homography.every((value) => Number.isFinite(value))
  ) {
    throw new RangeError(
      `evaluateBroadcastLineFit: homography must be an array of 9 finite numbers ` +
        `(got length ${Array.isArray(homography) ? homography.length : "non-array"})`,
    );
  }
  const minPitchFraction = options.minPitchFraction ?? BROADCAST_LINE_DEFAULTS.minPitchFraction;
  const lineContrastThreshold =
    options.lineContrastThreshold ?? BROADCAST_LINE_DEFAULTS.lineContrastThreshold;
  const straightnessAware =
    options.ellipseStraightnessAwareExplain ??
    BROADCAST_LINE_DEFAULTS.ellipseStraightnessAwareExplain;
  validateEvidenceOptions(minPitchFraction, lineContrastThreshold, straightnessAware);
  const evidence = extractCalibrationEvidence(input, minPitchFraction, lineContrastThreshold);
  const { width, height, staticMask, scoredFull, staticPixels, lines, greenTop } = evidence;

  // lineFit over the FULL scored set (the validation-grade measurement).
  let inliers = 0;
  for (let p = 0; p < scoredFull.length; p += 2) {
    const projected = projectSafe(homography, scoredFull[p]!, scoredFull[p + 1]!);
    if (projected !== undefined && modelDistanceAt(projected.x, projected.y) <= SCORE_RADIUS_M) {
      inliers += 1;
    }
  }
  const lineFit = scoredFull.length > 0 ? inliers / (scoredFull.length / 2) : 0;

  // Backward chamfer of the in-frame projected model points.
  const inverse = invertHomography(homography);
  const chamfer = chamferDistanceTransform(staticMask, width, height);
  const modelSamples = pitchModelSamplePoints();
  let backwardSum = 0;
  let backwardCount = 0;
  for (let p = 0; p < modelSamples.length; p += 2) {
    const projected = projectSafe(inverse, modelSamples[p]!, modelSamples[p + 1]!);
    if (projected === undefined) continue;
    if (projected.x < 0 || projected.x > 1 || projected.y < 0 || projected.y > 1) continue;
    backwardCount += 1;
    backwardSum += chamfer[
      Math.min(height - 1, Math.max(0, Math.floor(projected.y * height))) * width +
        Math.min(width - 1, Math.max(0, Math.floor(projected.x * width)))
    ]!;
  }
  const backwardPx = backwardCount > 0 ? backwardSum / backwardCount : null;

  // Ellipse residual, when the arc evidence passes its quota. v0.4.0:
  // measured against the conic-selection chain's BEST-MATCHING candidate —
  // the conic the validation actually gated the homography on (the
  // min-over-chain; with multiConicSelection: false the chain is the
  // primary alone, the exact v0.3.0 surface).
  const arc = extractArcEvidence(
    staticPixels, lines, greenTop, staticMask, width, height, straightnessAware,
  );
  const multiConic =
    options.ellipseMultiConicSelection ?? BROADCAST_LINE_DEFAULTS.ellipseMultiConicSelection;
  const chainFits = fitArcConicCandidates(
    arc.pixels, arc.components, staticPixels, width, height, multiConic,
  );
  const quotaChain = chainFits.filter(
    (candidate) =>
      candidate.supportPx >= ELLIPSE_MIN_SUPPORT_PX &&
      candidate.coverageBins >= ELLIPSE_MIN_COVERAGE_BINS,
  );
  const fit = quotaChain[0];
  const quotaPassed=
    fit !== undefined &&
    fit.supportPx >= ELLIPSE_MIN_SUPPORT_PX &&
    fit.coverageBins >= ELLIPSE_MIN_COVERAGE_BINS;
  let ellipseMeanPx: number | undefined;
  let ellipseSupportPx: number | undefined;
  let ellipseCoverageBins: number | undefined;
  if (quotaPassed && fit !== undefined) {
    // The minimum mean residual over the quota-passing chain (the primary
    // first when it alone passes — the v0.3.0 surface, byte-identical).
    for (const candidate of quotaChain) {
      const residual = ellipseMeanResidualPx(inverse, candidate.conic, width, height).meanPx;
      if (ellipseMeanPx === undefined || residual < ellipseMeanPx) {
        ellipseMeanPx = residual;
        ellipseSupportPx = candidate.supportPx;
        ellipseCoverageBins = candidate.coverageBins;
      }
    }
  }
  return {
    lineFit,
    backwardPx,
    scoredPixels: scoredFull.length / 2,
    ...(ellipseMeanPx !== undefined
      ? {
          ellipseMeanPx,
          ellipseSupportPx: ellipseSupportPx,
          ellipseCoverageBins: ellipseCoverageBins,
        }
      : {}),
  };
}

/**
 * v0.4.1 — the PROJECTED-GRID GEOMETRY measurement (module docs E6b, the
 * validation-gate hardening leg 2): where a solved image→pitch homography
 * (canonical h[8] = 1) maps the four canonical pitch corners, and whether
 * that quad is a REAL camera's image of the pitch rectangle containing the
 * winning conic (the center circle's image — the containment invariant).
 * PURE MEASUREMENT — not part of the calibration contract; the
 * conic-selection chain's validation gate and the tests/evidence driver
 * use it to measure and regression-lock the degenerate-grid class (the
 * b3-a point-collapse). `ok` is false exactly when the projected quad is
 * degenerate: a corner non-finite / beyond the 20x-frame bound, corners
 * closer than ELLIPSE_GRID_MIN_CORNER_SEPARATION_PX, or the shoelace quad
 * area below ELLIPSE_GRID_MIN_QUAD_AREA_FACTOR x the conic's ellipse area.
 * Deterministic; validates its inputs fail-loud (RangeError).
 */
export interface BroadcastEllipseGridGeometry {
  /** The projected pitch-corner image positions (px, canonical order). */
  readonly cornersPx: readonly { readonly x: number; readonly y: number }[];
  /** Shoelace area of the projected quad (px²). */
  readonly quadAreaPx: number;
  /** The conic's ellipse area π·semiMajor·semiMinor (px²). */
  readonly conicAreaPx: number;
  /** Minimum pairwise projected-corner distance (px). */
  readonly cornerMinSeparationPx: number;
  /** False = the degenerate-grid class (see the module docs E6b). */
  readonly ok: boolean;
}

export function evaluateBroadcastEllipseGridGeometry(
  homography: Homography,
  conic: EllipseConic,
  width: number,
  height: number,
): BroadcastEllipseGridGeometry {
  if (
    !Array.isArray(homography) ||
    homography.length !== 9 ||
    !homography.every((value) => Number.isFinite(value))
  ) {
    throw new RangeError(
      `evaluateBroadcastEllipseGridGeometry: homography must be an array of 9 finite numbers ` +
        `(got length ${Array.isArray(homography) ? homography.length : "non-array"})`,
    );
  }
  if (
    conic === null ||
    typeof conic !== "object" ||
    ![conic.a, conic.b, conic.c, conic.d, conic.e, conic.f].every((value) =>
      Number.isFinite(value as number),
    )
  ) {
    throw new RangeError(
      "evaluateBroadcastEllipseGridGeometry: conic must carry 6 finite coefficients (a..f)",
    );
  }
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 1 || height <= 1) {
    throw new RangeError(
      `evaluateBroadcastEllipseGridGeometry: width/height must be integers > 1 ` +
        `(got ${width}x${height})`,
    );
  }
  const geometry = conicGeometry(conic);
  if (geometry === undefined) {
    throw new RangeError(
      "evaluateBroadcastEllipseGridGeometry: conic is not a real non-degenerate ellipse",
    );
  }
  const conicAreaPx = Math.PI * geometry.semiMajor * geometry.semiMinor;
  let inverse: Homography;
  try {
    inverse = invertHomography(homography);
  } catch {
    return {
      cornersPx: [],
      quadAreaPx: 0,
      conicAreaPx,
      cornerMinSeparationPx: 0,
      ok: false,
    };
  }
  const bound = Math.max(ELLIPSE_GRID_CORNER_BOUND_FACTOR * width, ELLIPSE_GRID_CORNER_BOUND_FACTOR * height);
  const cornersPx: Array<{ x: number; y: number }> = [];
  for (const corner of CANONICAL_PITCH_CORNERS) {
    const projected = applyHomography(inverse, { x: corner.x, y: corner.y });
    const x = projected.x * width;
    const y = projected.y * height;
    if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > bound || Math.abs(y) > bound) {
      return {
        cornersPx,
        quadAreaPx: 0,
        conicAreaPx,
        cornerMinSeparationPx: 0,
        ok: false,
      };
    }
    cornersPx.push({ x, y });
  }
  let shoelace = 0;
  for (let i = 0; i < cornersPx.length; i += 1) {
    const p = cornersPx[i]!;
    const q = cornersPx[(i + 1) % cornersPx.length]!;
    shoelace += p.x * q.y - q.x * p.y;
  }
  const quadAreaPx = Math.abs(shoelace / 2);
  let cornerMinSeparationPx = Number.POSITIVE_INFINITY;
  for (let i = 0; i < cornersPx.length; i += 1) {
    for (let j = i + 1; j < cornersPx.length; j += 1) {
      cornerMinSeparationPx = Math.min(
        cornerMinSeparationPx,
        Math.hypot(cornersPx[i]!.x - cornersPx[j]!.x, cornersPx[i]!.y - cornersPx[j]!.y),
      );
    }
  }
  const ok =
    quadAreaPx >= ELLIPSE_GRID_MIN_QUAD_AREA_FACTOR * conicAreaPx &&
    cornerMinSeparationPx >= ELLIPSE_GRID_MIN_CORNER_SEPARATION_PX;
  return { cornersPx, quadAreaPx, conicAreaPx, cornerMinSeparationPx, ok };
}

// ---------------------------------------------------------------------------
// The candidate.
// ---------------------------------------------------------------------------

/**
 * The W303-class broadcast-line field calibrator (the R606 fix path).
 *
 * Construct with options; call {@link calibrate} with the frame sequence —
 * the pixels are the evidence (the input's optional `cornerSet` is IGNORED
 * by this candidate, documented: it detects its own anchors). The input
 * sequence must share one frame size (media-derived input is untrusted —
 * a mismatch refuses loudly with `InvalidAdapterInputError`).
 */
export class BroadcastLineCalibrator implements PitchCalibrationAdapter {
  readonly descriptor: PerceptionAdapterDescriptor;
  readonly license: TechnologyLicenseRecord = BROADCAST_LINE_FIELD_CALIBRATOR_LICENSE;
  readonly failureClasses: readonly FailureClassRecord[] =
    BROADCAST_LINE_FIELD_CALIBRATOR_FAILURE_CLASSES;
  readonly resourceRequirements: ResourceRequirements = BROADCAST_LINE_FIELD_CALIBRATOR_RESOURCES;
  readonly calibratorId: string;
  private readonly minPitchFraction: number;
  private readonly lineContrastThreshold: number;
  private readonly ellipseConstrained: boolean;
  private readonly ellipseStraightnessAware: boolean;
  private readonly ellipseMultiConicSelection: boolean;
  private readonly ellipseAnchorConversion: boolean;

  constructor(options: BroadcastLineCalibratorOptions = {}) {
    const calibratorId = options.calibratorId ?? BROADCAST_LINE_DEFAULTS.calibratorId;
    const minPitchFraction = options.minPitchFraction ?? BROADCAST_LINE_DEFAULTS.minPitchFraction;
    const lineContrastThreshold =
      options.lineContrastThreshold ?? BROADCAST_LINE_DEFAULTS.lineContrastThreshold;
    const ellipseConstrained = options.ellipseConstrained ?? BROADCAST_LINE_DEFAULTS.ellipseConstrained;
    const ellipseStraightnessAware =
      options.ellipseStraightnessAwareExplain ??
      BROADCAST_LINE_DEFAULTS.ellipseStraightnessAwareExplain;
    const ellipseMultiConicSelection =
      options.ellipseMultiConicSelection ?? BROADCAST_LINE_DEFAULTS.ellipseMultiConicSelection;
    const ellipseAnchorConversion =
      options.ellipseAnchorConversion ?? BROADCAST_LINE_DEFAULTS.ellipseAnchorConversion;
    if (typeof calibratorId !== "string" || calibratorId.length < 1) {
      throw new RangeError("BroadcastLineCalibrator: calibratorId must be a non-empty string");
    }
    if (!Number.isFinite(minPitchFraction) || minPitchFraction <= 0 || minPitchFraction > 1) {
      throw new RangeError(
        `BroadcastLineCalibrator: minPitchFraction must be in (0, 1] (got ${minPitchFraction})`,
      );
    }
    if (!Number.isFinite(lineContrastThreshold) || lineContrastThreshold <= 0) {
      throw new RangeError(
        `BroadcastLineCalibrator: lineContrastThreshold must be > 0 (got ${lineContrastThreshold})`,
      );
    }
    if (typeof ellipseConstrained !== "boolean") {
      throw new RangeError(
        `BroadcastLineCalibrator: ellipseConstrained must be a boolean (got ${typeof ellipseConstrained})`,
      );
    }
    if (typeof ellipseStraightnessAware !== "boolean") {
      throw new RangeError(
        `BroadcastLineCalibrator: ellipseStraightnessAwareExplain must be a boolean ` +
          `(got ${typeof ellipseStraightnessAware})`,
      );
    }
    if (typeof ellipseMultiConicSelection !== "boolean") {
      throw new RangeError(
        `BroadcastLineCalibrator: ellipseMultiConicSelection must be a boolean ` +
          `(got ${typeof ellipseMultiConicSelection})`,
      );
    }
    if (typeof ellipseAnchorConversion !== "boolean") {
      throw new RangeError(
        `BroadcastLineCalibrator: ellipseAnchorConversion must be a boolean ` +
          `(got ${typeof ellipseAnchorConversion})`,
      );
    }
    this.calibratorId = calibratorId;
    this.minPitchFraction = minPitchFraction;
    this.lineContrastThreshold = lineContrastThreshold;
    this.ellipseConstrained = ellipseConstrained;
    this.ellipseStraightnessAware = ellipseStraightnessAware;
    this.ellipseMultiConicSelection = ellipseMultiConicSelection;
    this.ellipseAnchorConversion = ellipseAnchorConversion;
    this.descriptor = perceptionDescriptor({
      technologyId: BROADCAST_LINE_FIELD_CALIBRATOR_ID,
      technologyVersion: BROADCAST_LINE_FIELD_CALIBRATOR_VERSION,
      adapterVersion: BROADCAST_LINE_FIELD_CALIBRATOR_ADAPTER_VERSION,
      task: "perception.pitch-calibration",
      inputContract: "contracts/normalized-video-frame-sequence@1",
      outputContract: "contracts/observation.field-mapping@1",
    });
    assertDescriptorBinding(this.descriptor, "perception.pitch-calibration");
  }

  calibrate(input: PitchCalibrationInput): CalibrationResult {
    // -- 0-6. The shared evidence pipeline (verbatim steps: input shape,
    //         green union, motion estimation + compensation, the static
    //         mask, Hough lines, and the scored/hoardings-suppressed sets).
    //         v0.2.0 extracted these into `extractCalibrationEvidence` so the
    //         public diagnostics share ONE pipeline — a pure move; the
    //         computations and their order are unchanged.
    const evidence = extractCalibrationEvidence(
      input,
      this.minPitchFraction,
      this.lineContrastThreshold,
    );
    const {
      lines, width, height, staticMask, staticPixels, scoredFull, scoredSub, greenSub,
      greenTop, anchorFrame, horizontalCount, verticalCount,
    } = evidence;

    // -- 6a. The LINE PATH (the v0.1.0 steps 6-8, byte-identical). ----------
    // It runs FIRST and its calibration result returns unchanged; only a
    // `no-consistent-homography` refusal hands over to the v0.2.0 ellipse
    // path (module docs E0 — non-degradation by construction).
    let linePathFailure: CandidateFailureError | undefined;
    if (horizontalCount < 2 || verticalCount < 2) {
      const starvation = new CandidateFailureError(
        `BroadcastLineCalibrator: Hough families carry ${horizontalCount} near-horizontal and ` +
          `${verticalCount} near-vertical lines — the (2+2)-line rectangle-grid search needs at ` +
          `least two of each (partial-visibility views whose boundary/interior lines of one ` +
          `orientation are all sub-threshold refuse honestly)`,
        {
          failureClassId: "broadcast-line.no-consistent-homography",
          detectedLines: lines.length,
          horizontalCount,
          verticalCount,
        },
      );
      if (!this.ellipseConstrained) throw starvation;
      linePathFailure = starvation;
    } else {
      try {
        return this.linePathSolve({
          lines,
          width,
          height,
          staticMask,
          scoredFull,
          scoredSub,
          greenSub,
          anchorFrame,
        });
      } catch (error) {
        if (
          !(error instanceof CandidateFailureError) ||
          error.details.failureClassId !== "broadcast-line.no-consistent-homography" ||
          !this.ellipseConstrained
        ) {
          throw error;
        }
        linePathFailure = error;
      }
    }

    // -- 6b. The v0.2.0 ELLIPSE/CIRCLE-CONSTRAINED PATH (module docs E1-E7). -
    return this.ellipseConstrainedSolve({
      lines,
      width,
      height,
      staticMask,
      staticPixels,
      scoredFull,
      scoredSub,
      greenSub,
      greenTop,
      greenMasks: evidence.greenMasks,
      anchorFrame,
      linePathFailure: linePathFailure!,
    });
  }

  /** The shared line-path evidence bundle (v0.1.0 steps 6-8 inputs). */
  private linePathSolve(evidence: {
    readonly lines: readonly HoughLine[];
    readonly width: number;
    readonly height: number;
    readonly staticMask: Uint8Array;
    readonly scoredFull: readonly number[];
    readonly scoredSub: readonly number[];
    readonly greenSub: readonly number[];
    readonly anchorFrame: DetectorFrameInput;
  }): CalibrationResult {
    const { lines, width, height, staticMask, scoredFull, scoredSub, greenSub, anchorFrame } =
      evidence;

    const best = this.searchFamilyHypotheses(lines, width, height, scoredSub, greenSub);
    if (best === undefined) {
      throw new CandidateFailureError(
        "BroadcastLineCalibrator: no family hypothesis survived the guards (quad sanity, " +
          "direction-angle spread, aspect consistency, projection spread, green containment) " +
          "over any (2+2)-line rectangle grid — no consistent homography on this evidence",
        { failureClassId: "broadcast-line.no-consistent-homography", detectedLines: lines.length },
      );
    }

    // -- 7. Refinement: coordinate descent on forward + backward + green. ----
    const chamfer = chamferDistanceTransform(staticMask, width, height);
    const modelSamples = pitchModelSamplePoints();
    const chamferAt = (u: number, v: number): number => {
      const x = Math.min(width - 1, Math.max(0, Math.floor(u * width)));
      const y = Math.min(height - 1, Math.max(0, Math.floor(v * height)));
      return chamfer[y * width + x]!;
    };
    const forwardScore = (h: Homography): number => {
      if (scoredSub.length === 0) return 0;
      let inliers = 0;
      for (let p = 0; p < scoredSub.length; p += 2) {
        const projected = projectSafe(h, scoredSub[p]!, scoredSub[p + 1]!);
        if (projected !== undefined && modelDistanceAt(projected.x, projected.y) <= SCORE_RADIUS_M) {
          inliers += 1;
        }
      }
      return inliers / (scoredSub.length / 2);
    };
    const objective = (h: Homography): number => {
      if (!h.every((value) => Number.isFinite(value))) return Number.NEGATIVE_INFINITY;
      let inverse: Homography;
      try {
        inverse = invertHomography(h);
      } catch {
        return Number.NEGATIVE_INFINITY;
      }
      const forward = forwardScore(h);
      let reward = 0;
      let inFrame = 0;
      for (let p = 0; p < modelSamples.length; p += 2) {
        const projected = projectSafe(inverse, modelSamples[p]!, modelSamples[p + 1]!);
        if (projected === undefined) continue;
        if (projected.x < 0 || projected.x > 1 || projected.y < 0 || projected.y > 1) continue;
        inFrame += 1;
        reward += Math.min(1, Math.max(0, 1 - chamferAt(projected.x, projected.y) / VALIDATION_BACKWARD_MAX_PX));
      }
      const backwardReward = inFrame > 0 ? reward / inFrame : 0;
      let contained = 0;
      for (let p = 0; p < greenSub.length; p += 2) {
        const projected = projectSafe(h, greenSub[p]!, greenSub[p + 1]!);
        if (
          projected !== undefined &&
          projected.x >= -GREEN_CONTAINMENT_MARGIN_M &&
          projected.x <= PITCH_LENGTH + GREEN_CONTAINMENT_MARGIN_M &&
          projected.y >= -GREEN_CONTAINMENT_MARGIN_M &&
          projected.y <= PITCH_WIDTH + GREEN_CONTAINMENT_MARGIN_M
        ) {
          contained += 1;
        }
      }
      const greenFraction = greenSub.length > 0 ? contained / (greenSub.length / 2) : 0;
      return forward + backwardReward + greenFraction;
    };
    let refined = [...best.homography];
    let currentScore = objective(refined);
    const steps = refined.map((value) =>
      Math.max(Math.abs(value) * REFINEMENT_STEP_FRACTION, REFINEMENT_STEP_FLOOR),
    );
    for (let round = 0; round < REFINEMENT_ROUNDS; round += 1) {
      for (let parameter = 0; parameter < 8; parameter += 1) {
        if (steps[parameter]! <= 1e-12) continue;
        const up = [...refined];
        up[parameter] = up[parameter]! + steps[parameter]!;
        const upScore = objective(up);
        if (upScore > currentScore) {
          refined = up;
          currentScore = upScore;
          continue;
        }
        const down = [...refined];
        down[parameter] = down[parameter]! - steps[parameter]!;
        const downScore = objective(down);
        if (downScore > currentScore) {
          refined = down;
          currentScore = downScore;
          continue;
        }
        steps[parameter] = steps[parameter]! / 2;
      }
    }

    // -- 8. Validation over the FULL scored set + honest confidence. ---------
    let inliers = 0;
    for (let p = 0; p < scoredFull.length; p += 2) {
      const projected = projectSafe(refined, scoredFull[p]!, scoredFull[p + 1]!);
      if (projected !== undefined && modelDistanceAt(projected.x, projected.y) <= SCORE_RADIUS_M) {
        inliers += 1;
      }
    }
    const lineFit = scoredFull.length > 0 ? inliers / (scoredFull.length / 2) : 0;
    let inverse: Homography;
    try {
      inverse = invertHomography(refined);
    } catch {
      throw new CandidateFailureError(
        "BroadcastLineCalibrator: the refined homography is not invertible to image coordinates — " +
          "refusing rather than emit an unmappable calibration",
        { failureClassId: "broadcast-line.no-consistent-homography", lineFit },
      );
    }
    let backwardSum = 0;
    let backwardCount = 0;
    for (let p = 0; p < modelSamples.length; p += 2) {
      const projected = projectSafe(inverse, modelSamples[p]!, modelSamples[p + 1]!);
      if (projected === undefined) continue;
      if (projected.x < 0 || projected.x > 1 || projected.y < 0 || projected.y > 1) continue;
      backwardCount += 1;
      backwardSum += chamferAt(projected.x, projected.y);
    }
    const backward = backwardCount > 0 ? backwardSum / backwardCount : Number.POSITIVE_INFINITY;
    if (lineFit < VALIDATION_LINE_FIT_MIN || backward > VALIDATION_BACKWARD_MAX_PX) {
      throw new CandidateFailureError(
        `BroadcastLineCalibrator: refined homography failed validation (lineFit ${lineFit.toFixed(3)} ` +
          `< ${VALIDATION_LINE_FIT_MIN}, backward ${backwardCount > 0 ? backward.toFixed(2) : "∞"} px > ` +
          `${VALIDATION_BACKWARD_MAX_PX}) — not good enough to project with; refusing honestly`,
        {
          failureClassId: "broadcast-line.no-consistent-homography",
          lineFit,
          backwardPx: backwardCount > 0 ? backward : undefined,
          scoredPixels: scoredFull.length / 2,
        },
      );
    }
    const confidence = Math.min(
      1,
      Math.max(0, 0.25 + 0.45 * lineFit + 0.3 * Math.max(0, 1 - backward / VALIDATION_BACKWARD_MAX_PX)),
    );

    // -- 9. Output: refined H, canonical corners back through H⁻¹. -----------
    const imageCorners: Point2D[] = [];
    for (const pitchCorner of CANONICAL_PITCH_CORNERS) {
      imageCorners.push(applyHomography(inverse, { x: pitchCorner.x, y: pitchCorner.y }));
    }
    const cornerSet: FieldCornerSet = {
      corners: [
        imageCorners[0]!,
        imageCorners[1]!,
        imageCorners[2]!,
        imageCorners[3]!,
      ],
      cornerOrder: "tl, tr, br, bl",
      confidence,
    };
    const mapping: FieldMappingPayload = {
      kind: "field-mapping",
      pitchCorners: imageCorners.map((corner) => ({ x: corner.x, y: corner.y })),
      cameraHomographyRef: `homography-${this.calibratorId}-${anchorFrame.frameId}`,
    };
    return {
      mapping,
      homography: refined,
      cornerSet,
      confidence,
      correspondenceCount: 4,
    };
  }

  /**
   * The v0.2.0 ELLIPSE/CIRCLE-CONSTRAINED path (module docs E1-E7). Runs ONLY
   * after the v0.1.0 line path refused with `no-consistent-homography` (the
   * recorded refusal rides every ellipse-path refusal's details). Either
   * returns a validated calibration anchored on the center-circle conic + the
   * available line correspondences, or refuses with the measured reason —
   * never a fabricated mapping. Deterministic throughout.
   */
  private ellipseConstrainedSolve(evidence: {
    readonly lines: readonly HoughLine[];
    readonly width: number;
    readonly height: number;
    readonly staticMask: Uint8Array;
    readonly staticPixels: readonly number[];
    readonly scoredFull: readonly number[];
    readonly scoredSub: readonly number[];
    readonly greenSub: readonly number[];
    readonly greenTop: Int32Array;
    readonly greenMasks: readonly Uint8Array[];
    readonly anchorFrame: DetectorFrameInput;
    readonly linePathFailure: CandidateFailureError;
  }): CalibrationResult {
    const {
      lines, width, height, staticMask, staticPixels,
      greenTop, greenMasks, linePathFailure,
    } = evidence;
    const linePathDetails = {
      linePathFailureClass: linePathFailure.details.failureClassId,
      linePathFailureDetails: linePathFailure.details,
    };

    // E1. Arc evidence: static pixels the detected lines do not explain
    //     (v0.4.0: the sub-dominance components ride alongside the
    //     dominance-filtered pixel list — the chain's per-component source).
    const arc = extractArcEvidence(
      staticPixels, lines, greenTop, staticMask, width, height, this.ellipseStraightnessAware,
    );
    const arcPixels = arc.pixels;
    const arcCount = arcPixels.length / 2;

    // E2 + E3 + E2b. The conic-selection candidate chain + the quota gates.
    // The chain's [0] is the v0.3.0 primary EXACTLY (the global
    // dominance-filtered RANSAC winner); the DISTINCT alternatives (the
    // ranked re-fits + the per-component fits over sub-dominance
    // components) follow only when multiConic is on, each held to the SAME
    // quota as the primary.
    const fits = fitArcConicCandidates(
      arcPixels, arc.components, staticPixels, width, height, this.ellipseMultiConicSelection,
    );
    const primary = fits.length > 0 ? fits[0] : undefined;
    const quotaFits = fits.filter(
      (candidate) =>
        candidate.supportPx >= ELLIPSE_MIN_SUPPORT_PX &&
        candidate.coverageBins >= ELLIPSE_MIN_COVERAGE_BINS,
    );
    if (primary === undefined || quotaFits.length === 0) {
      const fit = primary;
      throw new CandidateFailureError(
        `BroadcastLineCalibrator: ellipse path — arc evidence insufficient (${arcCount} arc ` +
          `pixels; ` +
          (fit === undefined
            ? "no sane non-degenerate ellipse among the sampled subsets"
            : `conic support ${fit.supportPx} px (< ${ELLIPSE_MIN_SUPPORT_PX}) / coverage ` +
              `${fit.coverageBins} of 36 bins (< ${ELLIPSE_MIN_COVERAGE_BINS})`) +
          `) — the center circle is not evidenced well enough to constrain a solve`,
        {
          failureClassId: "broadcast-line.ellipse-evidence-insufficient",
          arcPixels: arcCount,
          supportPx: fit?.supportPx,
          coverageBins: fit?.coverageBins,
          detectedLines: lines.length,
          ...linePathDetails,
        },
      );
    }

    // E2b (v0.4.0): the CONIC-SELECTION FALLBACK CHAIN. The first
    // quota-passer is the primary whenever the primary passes the quota —
    // the v0.3.0 surface, byte-identical (its solve and its refusal are
    // today's). On the primary's typed refusal the DISTINCT alternatives
    // run through the SAME full hypothesis -> refinement -> validation
    // flow; the first validation pass wins; the acceptance bar never
    // lowers for any candidate.
    // E2c (v0.4.1, CHAIN-ONLY): before a candidate's solve, the CONIC
    // GRASS-SUPPORT GATE — a quota-passing conic whose interior is not
    // grass-supported (median over frames below the documented threshold)
    // anchors to OFF-PITCH structure (the b3-a goal/net class) and is
    // refused with the typed class, the chain continuing with the next
    // candidate. The default surface (chain off) never runs this gate.
    const chainFailures: Array<Record<string, unknown>> = [];
    let firstFailure: CandidateFailureError | undefined;
    for (let candidateIndex = 0; candidateIndex < quotaFits.length; candidateIndex += 1) {
      const candidate = quotaFits[candidateIndex]!;
      if (this.ellipseMultiConicSelection) {
        const grass = conicInteriorGrassMedian(candidate.geometry, greenMasks, width, height);
        if (grass !== undefined && grass.median < ELLIPSE_CONIC_MIN_INTERIOR_GREEN_MEDIAN) {
          const refusal = new CandidateFailureError(
            `BroadcastLineCalibrator: conic-selection chain — quota-passing conic candidate ` +
              `${candidateIndex} (center (${candidate.geometry.centerX.toFixed(1)}, ` +
              `${candidate.geometry.centerY.toFixed(1)}) px, semis ` +
              `${candidate.geometry.semiMajor.toFixed(1)}x${candidate.geometry.semiMinor.toFixed(1)}) is ` +
              `not GRASS-supported: the median over frames of its interior green fraction is ` +
              `${grass.median.toFixed(3)} < ${ELLIPSE_CONIC_MIN_INTERIOR_GREEN_MEDIAN} over ` +
              `${grass.samplesInBounds} in-bounds samples — the conic anchors to OFF-PITCH ` +
              `structure (the goal/net class: a pitch circle is a thin painted band ON grass, ` +
              `green in every frame; static structure is not), so its solve is refused before ` +
              `it runs — never a structure-anchored calibration`,
            {
              failureClassId: "broadcast-line.ellipse-conic-off-pitch",
              conicIndex: candidateIndex,
              greenInteriorMedian: grass.median,
              samplesInBounds: grass.samplesInBounds,
              supportPx: candidate.supportPx,
              coverageBins: candidate.coverageBins,
              conicCenterPx: {
                x: candidate.geometry.centerX,
                y: candidate.geometry.centerY,
              },
              conicSemiPx: {
                major: candidate.geometry.semiMajor,
                minor: candidate.geometry.semiMinor,
              },
              ...linePathDetails,
            },
          );
          if (candidateIndex === 0) firstFailure = refusal;
          chainFailures.push({
            conicIndex: candidateIndex,
            failureClassId: "broadcast-line.ellipse-conic-off-pitch",
            greenInteriorMedian: grass.median,
            samplesInBounds: grass.samplesInBounds,
            supportPx: candidate.supportPx,
            coverageBins: candidate.coverageBins,
          });
          continue;
        }
      }
      try {
        return this.ellipseSolveForConic(
          candidate, evidence, linePathDetails, arcCount,
        );
      } catch (error) {
        if (!(error instanceof CandidateFailureError)) throw error;
        if (candidateIndex === 0) firstFailure = error;
        // v0.5.0: the per-candidate ANCHOR RECORD (scan solves enumerated /
        // converted) rides every chain entry whose candidate ran the
        // conversion (pre-solve grass refusals carry none — their scan
        // never ran).
        chainFailures.push({
          conicIndex: candidateIndex,
          failureClassId: error.details.failureClassId,
          lineFit: error.details.lineFit,
          backwardPx: error.details.backwardPx,
          ellipseMeanPx: error.details.ellipseMeanPx,
          hypotheses: error.details.hypotheses,
          ...(error.details.anchorScanSolves !== undefined
            ? {
              anchorScanSolves: error.details.anchorScanSolves,
              anchorConverted: error.details.anchorConverted,
            }
            : {}),
        });
      }
    }
    // Every quota-passing conic candidate refused honestly: rethrow the
    // FIRST quota-passer's refusal (the v0.3.0-exact class, message, and
    // details when the primary passes the quota; the v0.4.1 grass gate's
    // typed refusal when the first candidate was refused pre-solve) with
    // the additive per-candidate chain record attached — nothing
    // laundered, every candidate's measured outcome recorded.
    const failure = firstFailure!;
    throw new CandidateFailureError(failure.message, {
      ...failure.details,
      failureClassId: failure.details.failureClassId as string,
      conicChain: chainFailures,
    });
  }

  /**
   * E4-E7 for ONE conic candidate (module docs): the conic-anchored
   * hypotheses (pole-polar anchors + the mixed DLT + the 1-DOF scan), the
   * combined-objective finalist selection, the coordinate-descent
   * refinement, and the FULL validation gates (never lowered). Throws the
   * typed refusals of the v0.2.0/v0.3.0 surface verbatim; called per
   * candidate by the conic-selection chain.
   */
  private ellipseSolveForConic(
    fit: ArcConicFit,
    evidence: {
      readonly lines: readonly HoughLine[];
      readonly width: number;
      readonly height: number;
      readonly staticMask: Uint8Array;
      readonly staticPixels: readonly number[];
      readonly scoredFull: readonly number[];
      readonly scoredSub: readonly number[];
      readonly greenSub: readonly number[];
      readonly greenTop: Int32Array;
      readonly anchorFrame: DetectorFrameInput;
      readonly linePathFailure: CandidateFailureError;
    },
    linePathDetails: { linePathFailureClass: unknown; linePathFailureDetails: unknown },
    arcCount: number,
  ): CalibrationResult {
    const {
      lines, width, height, staticMask, staticPixels, scoredFull, scoredSub, greenSub,
      anchorFrame,
    } = evidence;

    // E4. Conic-anchored hypotheses (pole-polar anchors + the mixed DLT).
    // E4b (v0.5.0, OPT-IN): when `ellipseAnchorConversion` is on, the flow
    // is REPLACED by the J-ORTHOGONAL EXACT CLOSURE (module docs E4b): the
    // conic and the world circle canonicalize to the Lorentz frame, the
    // SAME enumeration driver runs with the near-line pole row added, and
    // EVERY scan solve is projected onto the J-orthogonal class under the
    // conversion guards — the per-candidate anchor record (scan solves
    // enumerated / converted) rides every conversion-path refusal below.
    let anchorRecord: { readonly scanSolves: number; readonly converted: number } | undefined;
    let hypotheses: Array<{ homography: Homography; linePairs: readonly MixedLinePair[] }>;
    if (this.ellipseAnchorConversion) {
      const frame = buildBroadcastEllipseAnchorFrame(fit.conic, width, height);
      if (frame === undefined) {
        // The conic's canonicalization REFUSED (the IMAGINARY class: a
        // conic with no real points cannot carry the x² + y² − z² = 0
        // Lorentz form; the degenerate class) — the typed unconvertible
        // refusal, never a fabricated closure.
        throw new CandidateFailureError(
          `BroadcastLineCalibrator: ellipse path (anchor conversion) — the candidate's conic ` +
            `canonicalization REFUSED (the all-same-sign IMAGINARY signature class: a conic ` +
            `with no real points cannot carry the x² + y² − z² = 0 Lorentz form) — the anchors ` +
            `cannot be converted into the J-orthogonal (Lorentz) frame; refusing with the ` +
            `typed class rather than fabricating a closure`,
          {
            failureClassId: "broadcast-line.ellipse-anchor-unconvertible",
            anchorReason: "conic-canonicalization-refused",
            anchorScanSolves: 0,
            anchorConverted: 0,
            supportPx: fit.supportPx,
            coverageBins: fit.coverageBins,
            arcPixels: arcCount,
            ...linePathDetails,
          },
        );
      }
      const convertedScan = this.ellipseConvertedHypotheses(
        fit, frame, lines, staticPixels, scoredSub, width, height,
      );
      anchorRecord = { scanSolves: convertedScan.scanSolves, converted: convertedScan.converted };
      if (convertedScan.scanSolves === 0) {
        throw new CandidateFailureError(
          `BroadcastLineCalibrator: ellipse path (anchor conversion) — no conic-anchored ` +
            `hypothesis could be built from ${lines.length} detected line(s) (the pole-polar ` +
            `anchored solve needs at least two line correspondences with usable anchors) — ` +
            `no consistent homography on this evidence`,
          {
            failureClassId: "broadcast-line.ellipse-no-consistent-homography",
            detectedLines: lines.length,
            arcPixels: arcCount,
            supportPx: fit.supportPx,
            coverageBins: fit.coverageBins,
            hypotheses: 0,
            anchorScanSolves: 0,
            anchorConverted: 0,
            ...linePathDetails,
          },
        );
      }
      if (convertedScan.converted === 0) {
        // EVERY enumerated scan solve failed the conversion guards (the
        // admissibility bound: no solve's anchors were near-conic-
        // consistent; the closure self-check; the birth conic guard; the
        // conic hard guard) — the typed unconvertible refusal with the
        // per-candidate anchor record.
        throw new CandidateFailureError(
          `BroadcastLineCalibrator: ellipse path (anchor conversion) — NONE of the candidate's ` +
            `${convertedScan.scanSolves} enumerated scan solves converted to the J-orthogonal ` +
            `(Lorentz) frame (every solve failed the conversion guards: the admissibility ` +
            `bound — no solve's anchors were near-conic-consistent; the closure self-check; ` +
            `the birth conic guard; the conic hard guard) — refusing with the typed class ` +
            `rather than fabricating a closure`,
          {
            failureClassId: "broadcast-line.ellipse-anchor-unconvertible",
            anchorReason: "scan-converted-nothing",
            anchorScanSolves: convertedScan.scanSolves,
            anchorConverted: 0,
            supportPx: fit.supportPx,
            coverageBins: fit.coverageBins,
            arcPixels: arcCount,
            hypotheses: 0,
            ...linePathDetails,
          },
        );
      }
      hypotheses = convertedScan.hypotheses;
    } else {
      hypotheses = this.ellipseHypotheses(fit.conic, lines, staticPixels, scoredSub, width, height);
    }
    if (hypotheses.length === 0) {
      throw new CandidateFailureError(
        `BroadcastLineCalibrator: ellipse path — no conic-anchored hypothesis could be built ` +
          `from ${lines.length} detected line(s) (the pole-polar anchored solve needs at least ` +
          `two line correspondences with usable anchors) — no consistent homography on this ` +
          `evidence`,
        {
          failureClassId: "broadcast-line.ellipse-no-consistent-homography",
          detectedLines: lines.length,
          arcPixels: arcCount,
          supportPx: fit.supportPx,
          coverageBins: fit.coverageBins,
          hypotheses: 0,
          ...linePathDetails,
        },
      );
    }

    // Quick guards + quick score → finalists (the same guard structure and
    // subsample construction as the line path's search).
    const quickStride = Math.max(1, Math.ceil(scoredSub.length / 2 / QUICK_SCORE_POINTS));
    const quickPoints: number[] = [];
    for (let point = 0; point * quickStride < scoredSub.length / 2; point += 1) {
      const index = point * quickStride * 2;
      quickPoints.push(scoredSub[index]!, scoredSub[index + 1]!);
    }
    const quickGreen = greenSub.slice(0, 32 * 2);
    const finalists: Array<{ homography: Homography; quick: number; linePairs: readonly MixedLinePair[] }> = [];
    const pushFinalist = (homography: Homography, quick: number, linePairs: readonly MixedLinePair[]): void => {
      if (quick <= 0) return;
      if (finalists.length < ELLIPSE_HYPOTHESIS_FINALISTS) {
        finalists.push({ homography, quick, linePairs });
        return;
      }
      let worstIndex = 0;
      for (let i = 1; i < finalists.length; i += 1) {
        if (finalists[i]!.quick < finalists[worstIndex]!.quick) worstIndex = i;
      }
      if (quick > finalists[worstIndex]!.quick) {
        finalists[worstIndex] = { homography, quick, linePairs };
      }
    };
    for (const hypothesis of hypotheses) {
      const homography = hypothesis.homography;
      if (!this.ellipseGuardsOk(homography, quickPoints, quickGreen)) continue;
      let inverse: Homography;
      try {
        inverse = invertHomography(homography);
      } catch {
        continue;
      }
      const quick =
        this.forwardScoreOn(homography, quickPoints) +
        ellipseRewardTerm(inverse, fit.conic, width, height) +
        lineConsistencyTerm(homography, hypothesis.linePairs, width, height);
      pushFinalist(homography, quick, hypothesis.linePairs);
    }
    // The finalist selection uses the COMBINED objective (forward + ellipse
    // reward + line consistency over the scored subsample) — the same
    // evidence mix as the quick score and the refinement. Selecting by
    // forward alone lets a line-fit-friendly but conic-inconsistent
    // mapping win (measured: a penalty-area placement scored forward 0.928
    // with a 108 px conic residual while the true hypothesis sat at
    // forward 0.653 / 2.5 px).
    let best: { homography: Homography; score: number; linePairs: readonly MixedLinePair[] } | undefined;
    for (const finalist of finalists) {
      let inverse: Homography;
      try {
        inverse = invertHomography(finalist.homography);
      } catch {
        continue;
      }
      const score =
        this.forwardScoreOn(finalist.homography, scoredSub) +
        ellipseRewardTerm(inverse, fit.conic, width, height) +
        lineConsistencyTerm(finalist.homography, finalist.linePairs, width, height);
      if (best === undefined || score > best.score) {
        best = { homography: finalist.homography, score, linePairs: finalist.linePairs };
      }
    }
    if (best === undefined) {
      throw new CandidateFailureError(
        `BroadcastLineCalibrator: ellipse path — ${hypotheses.length} conic-anchored ` +
          `hypotheses built but none survived the anti-collapse guards (projection spread, ` +
          `green containment) — no consistent homography on this evidence`,
        {
          failureClassId: "broadcast-line.ellipse-no-consistent-homography",
          hypotheses: hypotheses.length,
          arcPixels: arcCount,
          supportPx: fit.supportPx,
          coverageBins: fit.coverageBins,
          ...(anchorRecord !== undefined
            ? { anchorScanSolves: anchorRecord.scanSolves, anchorConverted: anchorRecord.converted }
            : {}),
          ...linePathDetails,
        },
      );
    }

    // E5. Refinement: coordinate descent on forward + backward + green +
    //     ellipse (the same descent structure as the line path, one added
    //     equal-weight term).
    const chamfer = chamferDistanceTransform(staticMask, width, height);
    const modelSamples = pitchModelSamplePoints();
    const chamferAt = (u: number, v: number): number => {
      const x = Math.min(width - 1, Math.max(0, Math.floor(u * width)));
      const y = Math.min(height - 1, Math.max(0, Math.floor(v * height)));
      return chamfer[y * width + x]!;
    };
    const forwardScore = (h: Homography): number => {
      if (scoredSub.length === 0) return 0;
      let inliers = 0;
      for (let p = 0; p < scoredSub.length; p += 2) {
        const projected = projectSafe(h, scoredSub[p]!, scoredSub[p + 1]!);
        if (projected !== undefined && modelDistanceAt(projected.x, projected.y) <= SCORE_RADIUS_M) {
          inliers += 1;
        }
      }
      return inliers / (scoredSub.length / 2);
    };
    // The SMOOTH forward term (see ELLIPSE_SMOOTH_FORWARD_RADIUS_M): the
    // mean clamp(1 − d/radius) of the scored pixels' model distances.
    const forwardSmooth = (h: Homography): number => {
      if (scoredSub.length === 0) return 0;
      let reward = 0;
      for (let p = 0; p < scoredSub.length; p += 2) {
        const projected = projectSafe(h, scoredSub[p]!, scoredSub[p + 1]!);
        const d = projected === undefined ? ELLIPSE_SMOOTH_FORWARD_RADIUS_M : modelDistanceAt(projected.x, projected.y);
        reward += Math.min(1, Math.max(0, 1 - d / ELLIPSE_SMOOTH_FORWARD_RADIUS_M));
      }
      return reward / (scoredSub.length / 2);
    };
    const objective = (h: Homography): number => {
      if (!h.every((value) => Number.isFinite(value))) return Number.NEGATIVE_INFINITY;
      // ANTI-COLLAPSE HARD REJECTION (measured necessity): without this the
      // coordinate descent can slide into a compressed mapping that still
      // collects forward + green + ellipse rewards (a collapsed H scored
      // lineFit 0.67 / backward 7.4 / ellipseMean 0.46 while mapping the
      // whole pitch onto a ~10 m blob). The spread + green-containment
      // guards run on every candidate DURING the descent, not only before
      // it.
      if (!this.ellipseGuardsOk(h, quickPoints, quickGreen)) return Number.NEGATIVE_INFINITY;
      let inverse: Homography;
      try {
        inverse = invertHomography(h);
      } catch {
        return Number.NEGATIVE_INFINITY;
      }
      const forward = forwardScore(h);
      let reward = 0;
      let inFrame = 0;
      for (let p = 0; p < modelSamples.length; p += 2) {
        const projected = projectSafe(inverse, modelSamples[p]!, modelSamples[p + 1]!);
        if (projected === undefined) continue;
        if (projected.x < 0 || projected.x > 1 || projected.y < 0 || projected.y > 1) continue;
        inFrame += 1;
        reward += Math.min(1, Math.max(0, 1 - chamferAt(projected.x, projected.y) / VALIDATION_BACKWARD_MAX_PX));
      }
      const backwardReward = inFrame > 0 ? reward / inFrame : 0;
      let contained = 0;
      for (let p = 0; p < greenSub.length; p += 2) {
        const projected = projectSafe(h, greenSub[p]!, greenSub[p + 1]!);
        if (
          projected !== undefined &&
          projected.x >= -GREEN_CONTAINMENT_MARGIN_M &&
          projected.x <= PITCH_LENGTH + GREEN_CONTAINMENT_MARGIN_M &&
          projected.y >= -GREEN_CONTAINMENT_MARGIN_M &&
          projected.y <= PITCH_WIDTH + GREEN_CONTAINMENT_MARGIN_M
        ) {
          contained += 1;
        }
      }
      const greenFraction = greenSub.length > 0 ? contained / (greenSub.length / 2) : 0;
      return (
        forward +
        forwardSmooth(h) +
        backwardReward +
        greenFraction +
        ellipseRewardTerm(inverse, fit.conic, width, height) +
        lineConsistencyTerm(h, linePairsEvidence, width, height)
      );
    };
    const linePairsEvidence = best.linePairs;
    let refined = [...best.homography];
    if (this.ellipseAnchorConversion) {
      // E4b: NO E5 refinement — the closure IS the solve (the coordinate
      // descent would trade the conic exactness away; module docs E4b).
      // The E6 validation bar below runs on the closure's best finalist,
      // unchanged.
    } else {
      let currentScore = objective(refined);
      for (let restart = 0; restart < ELLIPSE_REFINEMENT_RESTARTS; restart += 1) {
        const steps = refined.map((value) =>
          Math.max(Math.abs(value) * REFINEMENT_STEP_FRACTION, REFINEMENT_STEP_FLOOR),
        );
        for (let round = 0; round < REFINEMENT_ROUNDS; round += 1) {
          for (let parameter = 0; parameter < 8; parameter += 1) {
            if (steps[parameter]! <= 1e-12) continue;
            const up = [...refined];
            up[parameter] = up[parameter]! + steps[parameter]!;
            const upScore = objective(up);
            if (upScore > currentScore) {
              refined = up;
              currentScore = upScore;
              continue;
            }
            const down = [...refined];
            down[parameter] = down[parameter]! - steps[parameter]!;
            const downScore = objective(down);
            if (downScore > currentScore) {
              refined = down;
              currentScore = downScore;
              continue;
            }
            steps[parameter] = steps[parameter]! / 2;
          }
        }
      }
    }

    // E6. Validation over the FULL scored set + the ellipse gates — the same
    //     lineFit/backward bar as the line path, never lower. On the E4b
    //     conversion path the bar runs on the anchor-converted (conic-exact)
    //     homography: the closure rebalances the line rows globally, and when
    //     the conic-exact solve contradicts the line evidence the bar REFUSES
    //     honestly (the anchors-fight outcome — the measured synthetic
    //     residuals ride the refusal; nothing laundered).
    const solvedLabel = this.ellipseAnchorConversion
      ? "anchor-converted (conic-exact) homography"
      : "refined homography";
    if (!this.ellipseGuardsOk(refined, quickPoints, quickGreen)) {
      throw new CandidateFailureError(
        `BroadcastLineCalibrator: ellipse path — the ${solvedLabel} collapsed (failed the ` +
          `projection-spread / green-containment guards) — refusing honestly`,
        {
          failureClassId: "broadcast-line.ellipse-no-consistent-homography",
          hypotheses: hypotheses.length,
          ...(anchorRecord !== undefined
            ? { anchorScanSolves: anchorRecord.scanSolves, anchorConverted: anchorRecord.converted }
            : {}),
          ...linePathDetails,
        },
      );
    }
    let inliers = 0;
    for (let p = 0; p < scoredFull.length; p += 2) {
      const projected = projectSafe(refined, scoredFull[p]!, scoredFull[p + 1]!);
      if (projected !== undefined && modelDistanceAt(projected.x, projected.y) <= SCORE_RADIUS_M) {
        inliers += 1;
      }
    }
    const lineFit = scoredFull.length > 0 ? inliers / (scoredFull.length / 2) : 0;
    let inverse: Homography;
    try {
      inverse = invertHomography(refined);
    } catch {
      throw new CandidateFailureError(
        `BroadcastLineCalibrator: ellipse path — the ${solvedLabel} is not invertible to ` +
          "image coordinates — refusing rather than emit an unmappable calibration",
        {
          failureClassId: "broadcast-line.ellipse-no-consistent-homography",
          lineFit,
          ...(anchorRecord !== undefined
            ? { anchorScanSolves: anchorRecord.scanSolves, anchorConverted: anchorRecord.converted }
            : {}),
          ...linePathDetails,
        },
      );
    }
    let backwardSum = 0;
    let backwardCount = 0;
    for (let p = 0; p < modelSamples.length; p += 2) {
      const projected = projectSafe(inverse, modelSamples[p]!, modelSamples[p + 1]!);
      if (projected === undefined) continue;
      if (projected.x < 0 || projected.x > 1 || projected.y < 0 || projected.y > 1) continue;
      backwardCount += 1;
      backwardSum += chamferAt(projected.x, projected.y);
    }
    const backward = backwardCount > 0 ? backwardSum / backwardCount : Number.POSITIVE_INFINITY;
    const ellipseMetrics = ellipseMeanResidualPx(inverse, fit.conic, width, height);
    if (
      lineFit < VALIDATION_LINE_FIT_MIN ||
      backward > VALIDATION_BACKWARD_MAX_PX ||
      ellipseMetrics.meanPx > ELLIPSE_VALIDATION_MAX_PX ||
      ellipseMetrics.inlierFraction < ELLIPSE_VALIDATION_INLIER_FRACTION
    ) {
      throw new CandidateFailureError(
        `BroadcastLineCalibrator: ellipse path — ${solvedLabel} failed validation ` +
          `(lineFit ${lineFit.toFixed(3)} < ${VALIDATION_LINE_FIT_MIN}, backward ` +
          `${backwardCount > 0 ? backward.toFixed(2) : "∞"} px > ${VALIDATION_BACKWARD_MAX_PX}, ` +
          `ellipse residual ${Number.isFinite(ellipseMetrics.meanPx) ? ellipseMetrics.meanPx.toFixed(2) : "∞"} px > ` +
          `${ELLIPSE_VALIDATION_MAX_PX} or inlier fraction ` +
          `${(ellipseMetrics.inlierFraction * 100).toFixed(0)}% < ` +
          `${(ELLIPSE_VALIDATION_INLIER_FRACTION * 100).toFixed(0)}%) — the bar is not lowered; ` +
          `refusing honestly`,
        {
          failureClassId: "broadcast-line.ellipse-no-consistent-homography",
          lineFit,
          backwardPx: backwardCount > 0 ? backward : undefined,
          ellipseMeanPx: Number.isFinite(ellipseMetrics.meanPx) ? ellipseMetrics.meanPx : undefined,
          ellipseInlierFraction: ellipseMetrics.inlierFraction,
          scoredPixels: scoredFull.length / 2,
          hypotheses: hypotheses.length,
          ...(anchorRecord !== undefined
            ? { anchorScanSolves: anchorRecord.scanSolves, anchorConverted: anchorRecord.converted }
            : {}),
          ...linePathDetails,
        },
      );
    }

    // E6b (v0.4.1, CHAIN-ONLY): the PROJECTED-GRID GEOMETRY GATE — the
    // machine gates above are degenerately satisfiable (the measured b3-a
    // class: a point-collapse H collects lineFit from the whole image
    // mapping onto a model-line cluster, backward from the pitch mapping
    // onto one static-mask point, and the ellipse residual from the
    // circle mapping onto a single point ON the conic). The containment
    // invariant is not: the pitch's image must contain the conic — a real
    // camera's quad carries the area floor by construction. The default
    // surface (chain off) never runs this gate.
    if (this.ellipseMultiConicSelection) {
      const grid = evaluateBroadcastEllipseGridGeometry(refined, fit.conic, width, height);
      if (!grid.ok) {
        throw new CandidateFailureError(
          `BroadcastLineCalibrator: conic-selection chain — the solved homography passed every ` +
            `machine gate (lineFit ${lineFit.toFixed(3)}, backward ` +
            `${Number.isFinite(backward) ? backward.toFixed(2) : "∞"} px, ellipse residual ` +
            `${Number.isFinite(ellipseMetrics.meanPx) ? ellipseMetrics.meanPx.toFixed(2) : "∞"} px) ` +
            `but its PROJECTED PITCH GRID is degenerate: the four pitch corners project to a ` +
            `collapsed quad (area ${grid.quadAreaPx.toFixed(1)} px² vs the winning conic's ` +
            `${grid.conicAreaPx.toFixed(1)} px² — the containment invariant says a real camera's ` +
            `pitch image CONTAINS the circle's image; minimum corner separation ` +
            `${grid.cornerMinSeparationPx.toFixed(2)} px) — the solve collapsed the pitch onto ` +
            `the anchoring structure, collecting the machine rewards degenerately; the claim is ` +
            `WITHHELD, nothing laundered`,
          {
            failureClassId: "broadcast-line.ellipse-degenerate-grid",
            lineFit,
            backwardPx: backwardCount > 0 ? backward : undefined,
            ellipseMeanPx: Number.isFinite(ellipseMetrics.meanPx)
              ? ellipseMetrics.meanPx
              : undefined,
            quadAreaPx: grid.quadAreaPx,
            conicAreaPx: grid.conicAreaPx,
            cornerMinSeparationPx: grid.cornerMinSeparationPx,
            cornersPx: grid.cornersPx,
            supportPx: fit.supportPx,
            coverageBins: fit.coverageBins,
            scoredPixels: scoredFull.length / 2,
            hypotheses: hypotheses.length,
            ...(anchorRecord !== undefined
              ? { anchorScanSolves: anchorRecord.scanSolves, anchorConverted: anchorRecord.converted }
              : {}),
            ...linePathDetails,
          },
        );
      }
    }
    const ellipseReward = Math.min(
      1,
      Math.max(0, 1 - ellipseMetrics.meanPx / ELLIPSE_VALIDATION_MAX_PX),
    );
    const confidence = Math.min(
      1,
      Math.max(
        0,
        0.2 +
          0.4 * lineFit +
          0.2 * Math.max(0, 1 - backward / VALIDATION_BACKWARD_MAX_PX) +
          0.2 * ellipseReward,
      ),
    );

    // E7. Output: the same shape; 5 anchors (4 point anchors + the conic).
    const imageCorners: Point2D[] = [];
    for (const pitchCorner of CANONICAL_PITCH_CORNERS) {
      imageCorners.push(applyHomography(inverse, { x: pitchCorner.x, y: pitchCorner.y }));
    }
    const cornerSet: FieldCornerSet = {
      corners: [imageCorners[0]!, imageCorners[1]!, imageCorners[2]!, imageCorners[3]!],
      cornerOrder: "tl, tr, br, bl",
      confidence,
    };
    const mapping: FieldMappingPayload = {
      kind: "field-mapping",
      pitchCorners: imageCorners.map((corner) => ({ x: corner.x, y: corner.y })),
      cameraHomographyRef: `homography-${this.calibratorId}-${anchorFrame.frameId}`,
    };
    return {
      mapping,
      homography: refined,
      cornerSet,
      confidence,
      correspondenceCount: 5,
    };
  }

  /**
   * The E4 conic-anchored hypothesis enumeration: every pair of detected
   * lines (any families — INCLUDING a same-family parallel pair, the
   * arc-window shape) × every model-value assignment consistent with the
   * v0.1.0 ordering priors, each solved by the mixed points+lines DLT over
   * the pole-polar anchor set (with the exact midline closure for the
   * same-family parallel cases — see `buildEllipseAnchors`). Deterministic
   * enumeration order: (swap, pair, valueA, valueB, flip).
   */
  private ellipseHypotheses(
    conic: EllipseConic,
    lines: readonly HoughLine[],
    staticPixels: readonly number[],
    scoredSub: readonly number[],
    width: number,
    height: number,
  ): Array<{ homography: Homography; linePairs: readonly MixedLinePair[] }> {
    // Sub-pixel (theta, rho) per detected line (see refineLineSubpixel) —
    // the anchors are built from these, not the quantized Hough values.
    const subpixel = new Map<HoughLine, { theta: number; rho: number }>();
    for (const line of lines) {
      subpixel.set(line, refineLineSubpixel(line, staticPixels));
    }
    // The scan's mini-forward scoring points (even strided subsample).
    const scanStride = Math.max(1, Math.ceil(scoredSub.length / 2 / ELLIPSE_SCAN_SCORE_POINTS));
    const scanPoints: number[] = [];
    for (let point = 0; point * scanStride < scoredSub.length / 2; point += 1) {
      const index = point * scanStride * 2;
      scanPoints.push(scoredSub[index]!, scoredSub[index + 1]!);
    }
    const geometry = conicGeometry(conic);
    if (geometry === undefined) return [];
    // Family split + per-family caps (top votes first, as the line path).
    const horizontal: HoughLine[] = [];
    const vertical: HoughLine[] = [];
    for (const line of lines) {
      if (isHorizontalish(line)) horizontal.push(line);
      else vertical.push(line);
    }
    horizontal.sort((a, b) => b.votes - a.votes);
    vertical.sort((a, b) => b.votes - a.votes);
    const familyH = horizontal.slice(0, ELLIPSE_FAMILY_MAX_LINES);
    const familyV = vertical.slice(0, ELLIPSE_FAMILY_MAX_LINES);

    interface Assigned {
      readonly line: HoughLine;
      readonly family: "x" | "y";
    }
    const hypotheses: Array<{ homography: Homography; linePairs: readonly MixedLinePair[] }> = [];
    for (let swap = 0; swap < 2; swap += 1) {
      const familyForH: "x" | "y" = swap === 0 ? "y" : "x";
      const familyForV: "x" | "y" = swap === 0 ? "x" : "y";
      // Same-family pairs only (the arc-window shape; cross-family pairs
      // are the line path's (2+2) territory — documented scope).
      const pairs: Array<[Assigned, Assigned]> = [];
      for (let i = 0; i < familyH.length; i += 1) {
        for (let j = i + 1; j < familyH.length; j += 1) {
          pairs.push([
            { line: familyH[i]!, family: familyForH },
            { line: familyH[j]!, family: familyForH },
          ]);
        }
      }
      for (let i = 0; i < familyV.length; i += 1) {
        for (let j = i + 1; j < familyV.length; j += 1) {
          pairs.push([
            { line: familyV[i]!, family: familyForV },
            { line: familyV[j]!, family: familyForV },
          ]);
        }
      }
      for (const [a, b] of pairs) {
        const valuesFor = (family: "x" | "y"): readonly number[] =>
          family === "x" ? MODEL_X_FAMILY : MODEL_Y_FAMILY;
        for (const valueA of valuesFor(a.family)) {
          for (const valueB of valuesFor(b.family)) {
            if (valueA === valueB) continue;
            // The v0.1.0 elevated-camera ordering priors, per model family:
            // the larger model y sits HIGHER (smaller meanY); the larger
            // model x sits RIGHT (larger meanX).
            if (a.family === "y") {
              const [near, far] = valueA < valueB ? [a, b] : [b, a];
              if (far.line.meanY >= near.line.meanY) continue;
            } else {
              const [left, right] = valueA < valueB ? [a, b] : [b, a];
              if (right.line.meanX <= left.line.meanX) continue;
            }
            const bases = buildEllipseBaseAnchors(
              conic,
              { line: a.line, family: a.family, value: valueA },
              { line: b.line, family: b.family, value: valueB },
              subpixel,
              width,
              height,
            );
            for (const base of bases) {
              const candidate = scanEllipseHypothesis(
                conic,
                geometry,
                base,
                scanPoints,
                width,
                height,
              );
              if (candidate === undefined) continue;
              hypotheses.push(candidate);
            }
          }
        }
      }
    }
    return hypotheses;
  }

  /**
   * The E4b CONVERSION-PATH hypothesis enumeration (v0.5.0, fires only when
   * `ellipseAnchorConversion` is on): the SAME driver as `ellipseHypotheses`
   * — the same swap × same-family-pair × model-values × flip enumeration
   * with the same ordering priors, the same sub-pixel refinements, and the
   * same 1-DOF coarse+fine parameter scan — with the NEAR-LINE POLE ROW
   * added to every base's anchor rows (the pole of the pair's near line —
   * the smaller model value — w.r.t. the conic ↔ w.r.t. the world circle)
   * and with EVERY enumerated scan solve run through the J-orthogonal exact
   * closure (module docs E4b) instead of keeping only each base's
   * best-scoring solve: each successful mixed-DLT solve H_t becomes M₀ =
   * W·H_t·G⁻¹ and is projected onto the J-orthogonal class under the
   * admissibility bound, the closure self-check, the birth conic guard and
   * the conic hard guard. Returns the CONVERTED candidates plus the
   * per-candidate anchor record (the scan solves enumerated / converted)
   * that rides every conversion-path refusal. Deterministic.
   */
  private ellipseConvertedHypotheses(
    fit: ArcConicFit,
    frame: BroadcastEllipseAnchorFrame,
    lines: readonly HoughLine[],
    staticPixels: readonly number[],
    scoredSub: readonly number[],
    width: number,
    height: number,
  ): {
    hypotheses: Array<{ homography: Homography; linePairs: readonly MixedLinePair[] }>;
    scanSolves: number;
    converted: number;
  } {
    const conic = fit.conic;
    const geometry = fit.geometry;
    const subpixel = new Map<HoughLine, { theta: number; rho: number }>();
    for (const line of lines) {
      subpixel.set(line, refineLineSubpixel(line, staticPixels));
    }
    // The scan's mini-forward scoring points (even strided subsample — the
    // same construction as `ellipseHypotheses`).
    const scanStride = Math.max(1, Math.ceil(scoredSub.length / 2 / ELLIPSE_SCAN_SCORE_POINTS));
    const scanPoints: number[] = [];
    for (let point = 0; point * scanStride < scoredSub.length / 2; point += 1) {
      const index = point * scanStride * 2;
      scanPoints.push(scoredSub[index]!, scoredSub[index + 1]!);
    }
    const lineNorm = (line: HoughLine): [number, number, number] => {
      const refined = subpixel.get(line) ?? { theta: line.theta, rho: line.rho };
      return pxLineToNormalized(
        [Math.cos(refined.theta), Math.sin(refined.theta), -refined.rho],
        width,
        height,
      );
    };
    const modelLineNorm = (family: "x" | "y", value: number): [number, number, number] =>
      family === "x" ? normalizeLine([1, 0, -value]) : normalizeLine([0, 1, -value]);
    // Family split + per-family caps (top votes first, as the line path).
    const horizontal: HoughLine[] = [];
    const vertical: HoughLine[] = [];
    for (const line of lines) {
      if (isHorizontalish(line)) horizontal.push(line);
      else vertical.push(line);
    }
    horizontal.sort((a, b) => b.votes - a.votes);
    vertical.sort((a, b) => b.votes - a.votes);
    const familyH = horizontal.slice(0, ELLIPSE_FAMILY_MAX_LINES);
    const familyV = vertical.slice(0, ELLIPSE_FAMILY_MAX_LINES);

    const hypotheses: Array<{ homography: Homography; linePairs: readonly MixedLinePair[] }> = [];
    let scanSolves = 0;
    let converted = 0;
    const anchorBound = 5;
    // The scan's closing anchor pair (the same constants as
    // `scanEllipseHypothesis`): the world circle point at angle 0 + tangent.
    const tangentWorld = circleTangentAt(SCAN_WORLD_POINT);
    const solveAt = (
      base: EllipseBaseAnchors,
      t: number,
    ): { homography: Homography; linePairs: readonly MixedLinePair[] } | undefined => {
      const p = conicPointAt(geometry, t);
      if (Math.abs(p.x) > 5 * width || Math.abs(p.y) > 5 * height) return undefined;
      const points: MixedPointPair[] = [
        ...base.points.map((point) => ({ u: point.u, v: point.v, x: point.x, y: point.y })),
        { ...pxPointToNormalized(p, width, height), x: SCAN_WORLD_POINT.x, y: SCAN_WORLD_POINT.y },
      ];
      const lines: MixedLinePair[] = [
        ...base.lines.map((line) => ({ image: line.image, pitch: line.pitch })),
        { image: pxLineToNormalized(conicTangentAt(conic, p), width, height), pitch: tangentWorld },
      ];
      const homography = solveMixedDlt(points, lines);
      if (homography === undefined) return undefined;
      return { homography, linePairs: lines };
    };
    const convertSolve = (candidate: { homography: Homography; linePairs: readonly MixedLinePair[] }): void => {
      scanSolves += 1;
      const outcome = convertAnchorWithFrame(frame, geometry, width, height, candidate.homography);
      if (outcome.kind !== "converted") return;
      converted += 1;
      hypotheses.push({ homography: outcome.homography, linePairs: candidate.linePairs });
    };
    for (let swap = 0; swap < 2; swap += 1) {
      const familyForH: "x" | "y" = swap === 0 ? "y" : "x";
      const familyForV: "x" | "y" = swap === 0 ? "x" : "y";
      // Same-family pairs only (the arc-window shape; cross-family pairs
      // are the line path's (2+2) territory — the SAME scope as
      // `ellipseHypotheses`).
      interface Assigned {
        readonly line: HoughLine;
        readonly family: "x" | "y";
      }
      const pairs: Array<[Assigned, Assigned]> = [];
      for (let i = 0; i < familyH.length; i += 1) {
        for (let j = i + 1; j < familyH.length; j += 1) {
          pairs.push([
            { line: familyH[i]!, family: familyForH },
            { line: familyH[j]!, family: familyForH },
          ]);
        }
      }
      for (let i = 0; i < familyV.length; i += 1) {
        for (let j = i + 1; j < familyV.length; j += 1) {
          pairs.push([
            { line: familyV[i]!, family: familyForV },
            { line: familyV[j]!, family: familyForV },
          ]);
        }
      }
      for (const [a, b] of pairs) {
        const valuesFor = (family: "x" | "y"): readonly number[] =>
          family === "x" ? MODEL_X_FAMILY : MODEL_Y_FAMILY;
        for (const valueA of valuesFor(a.family)) {
          for (const valueB of valuesFor(b.family)) {
            if (valueA === valueB) continue;
            // The v0.1.0 elevated-camera ordering priors, per model family
            // (the SAME priors as `ellipseHypotheses`): the larger model y
            // sits HIGHER (smaller meanY); the larger model x sits RIGHT
            // (larger meanX).
            if (a.family === "y") {
              const [near, far] = valueA < valueB ? [a, b] : [b, a];
              if (far.line.meanY >= near.line.meanY) continue;
            } else {
              const [left, right] = valueA < valueB ? [a, b] : [b, a];
              if (right.line.meanX <= left.line.meanX) continue;
            }
            // THE NEAR-LINE POLE ROW (E4b): the pole of the pair's near
            // line (the smaller model value — the near touchline / left
            // goal line) w.r.t. the NORMALIZED image conic ↔ w.r.t. the
            // world circle — a well-conditioned point correspondence. The
            // FAR line's pole is the measured high-leverage class and
            // stays excluded. Skipped when the pole is at/near infinity
            // (the line through the conic center — e.g. the model halfway
            // line) or outside the anchor bounds.
            const nearAssigned = valueA < valueB ? a : b;
            const nearImageLine = lineNorm(nearAssigned.line);
            const nearModelLine = modelLineNorm(
              nearAssigned.family,
              Math.min(valueA, valueB),
            );
            let nearPole: { u: number; v: number; x: number; y: number } | undefined;
            const imagePole = poleOfLine(frame.qCanon, nearImageLine);
            const worldPole = poleOfLine(WORLD_CIRCLE_CONIC, nearModelLine);
            if (imagePole !== undefined && worldPole !== undefined) {
              const iz = imagePole[2];
              const wz = worldPole[2];
              if (Math.abs(iz) > 1e-6 && Math.abs(wz) > 1e-6) {
                const u = imagePole[0]! / iz;
                const v = imagePole[1]! / iz;
                const poleX = worldPole[0]! / wz;
                const poleY = worldPole[1]! / wz;
                if (
                  Number.isFinite(u) && Number.isFinite(v) &&
                  Number.isFinite(poleX) && Number.isFinite(poleY) &&
                  Math.abs(u) <= anchorBound && Math.abs(v) <= anchorBound &&
                  Math.abs(poleX) <= 1000 && Math.abs(poleY) <= 1000
                ) {
                  nearPole = { u, v, x: poleX, y: poleY };
                }
              }
            }
            const bases = buildEllipseBaseAnchors(
              conic,
              { line: a.line, family: a.family, value: valueA },
              { line: b.line, family: b.family, value: valueB },
              subpixel,
              width,
              height,
              nearPole,
            );
            for (const base of bases) {
              // The SAME 1-DOF coarse+fine scan driver as
              // `scanEllipseHypothesis` (the coarse grid, then the fine
              // grid around the coarse best by the mini forward score) —
              // but EVERY enumerated solve is CONVERTED (E4b) instead of
              // only the base's best surviving.
              let bestT = Number.NaN;
              let bestScore = Number.NEGATIVE_INFINITY;
              for (let step = 0; step < ELLIPSE_SCAN_COARSE; step += 1) {
                const t = (step * 2 * Math.PI) / ELLIPSE_SCAN_COARSE;
                const candidate = solveAt(base, t);
                if (candidate === undefined) continue;
                const score = forwardScoreOnPoints(candidate.homography, scanPoints);
                convertSolve(candidate);
                if (score > bestScore) {
                  bestScore = score;
                  bestT = t;
                }
              }
              if (Number.isNaN(bestT)) continue;
              const coarseStep = (2 * Math.PI) / ELLIPSE_SCAN_COARSE;
              for (let step = 1; step < ELLIPSE_SCAN_FINE; step += 1) {
                const t = bestT - coarseStep + (2 * coarseStep * step) / ELLIPSE_SCAN_FINE;
                const candidate = solveAt(base, t);
                if (candidate === undefined) continue;
                convertSolve(candidate);
              }
            }
          }
        }
      }
    }
    return { hypotheses, scanSolves, converted };
  }

  /**
   * The step-6 GENERALIZED family hypothesis search. Detected lines split
   * into two image-orientation families (near-horizontal / near-vertical);
   * each family anchors a MODEL line family (x-const / y-const — both
   * assignments tried: the swap covers behind-goal / rotated cameras). For
   * every (2 detected H-lines x 2 detected V-lines) pair combination whose
   * directions differ by >= FAMILY_MIN_ANGLE_DEG and whose corner-grid quad
   * passes the sanity check, every model pair from both families with an
   * aspect-consistent rectangle and every line-identity orientation solves
   * a W203 `solveHomography` over the four grid-corner correspondences.
   * Every solved hypothesis passes the ANTI-COLLAPSE guards (projection
   * spread over the scored subsample; quick green containment) and a
   * QUICK forward score (first QUICK_SCORE_POINTS scored points); the
   * HYPOTHESIS_FINALISTS best by quick score get the FULL forward score.
   * Deterministic: strict `>` acceptance — the FIRST hypothesis in
   * enumeration order wins ties; enumeration order is (swap, H-pair,
   * V-pair, model pair, orientation), all in index order.
   */
  private searchFamilyHypotheses(
    lines: readonly HoughLine[],
    width: number,
    height: number,
    scoredSub: readonly number[],
    greenSub: readonly number[],
  ): { homography: Homography; score: number } | undefined {
    // Family split + per-family caps (top votes first — the strongest
    // evidence anchors first; index order breaks vote ties).
    const horizontal: HoughLine[] = [];
    const vertical: HoughLine[] = [];
    for (const line of lines) {
      if (isHorizontalish(line)) horizontal.push(line);
      else vertical.push(line);
    }
    horizontal.sort((a, b) => b.votes - a.votes);
    vertical.sort((a, b) => b.votes - a.votes);
    const familyH = horizontal.slice(0, FAMILY_MAX_LINES);
    const familyV = vertical.slice(0, FAMILY_MAX_LINES);

    // Quick-scoring sets: EVEN strided subsamples spanning the whole scored
    // set (a row-major PREFIX would score only the top rows — the far
    // touchline region that near-degenerate hypotheses also align, which
    // tied every finalist at the same quick score and starved the correct
    // hypothesis; measured on the synthetic recovery fixture).
    const quickStride = Math.max(1, Math.ceil(scoredSub.length / 2 / QUICK_SCORE_POINTS));
    const quickPoints: number[] = [];
    for (let point = 0; point * quickStride < scoredSub.length / 2; point += 1) {
      const index = point * quickStride * 2;
      quickPoints.push(scoredSub[index]!, scoredSub[index + 1]!);
    }
    const quickGreen = greenSub.slice(0, 32 * 2);

    // Finalists by quick score (bounded insertion, deterministic order).
    const finalists: Array<{ homography: Homography; quick: number }> = [];
    const pushFinalist = (homography: Homography, quick: number): void => {
      if (quick <= 0) return;
      if (finalists.length < HYPOTHESIS_FINALISTS) {
        finalists.push({ homography, quick });
        return;
      }
      let worstIndex = 0;
      for (let i = 1; i < finalists.length; i += 1) {
        if (finalists[i]!.quick < finalists[worstIndex]!.quick) worstIndex = i;
      }
      if (quick > finalists[worstIndex]!.quick) {
        finalists[worstIndex] = { homography, quick };
      }
    };

    for (let swap = 0; swap < 2; swap += 1) {
      // swap=0: image-horizontal family <-> model y-family (the elevated
      // sideline-camera geometry); swap=1: <-> model x-family (behind-goal
      // and rotated views). The OTHER image family takes the other model
      // family in both cases.
      const modelFamilyForH = swap === 0 ? MODEL_Y_FAMILY : MODEL_X_FAMILY;
      const modelFamilyForV = swap === 0 ? MODEL_X_FAMILY : MODEL_Y_FAMILY;
      for (let hA = 0; hA < familyH.length; hA += 1) {
        for (let hB = hA + 1; hB < familyH.length; hB += 1) {
          const lineHA = familyH[hA]!;
          const lineHB = familyH[hB]!;
          for (let vA = 0; vA < familyV.length; vA += 1) {
            for (let vB = vA + 1; vB < familyV.length; vB += 1) {
              const lineVA = familyV[vA]!;
              const lineVB = familyV[vB]!;
              // Angle guard: the two pairs' directions must differ.
              const angleH = lineDirectionAngle(lineHA);
              const angleV = lineDirectionAngle(lineVA);
              if (directionAngleDelta(angleH, angleV) < FAMILY_MIN_ANGLE_DEG) continue;
              // The four grid corners (pixel coords), computed once per
              // (H-pair, V-pair): c00 = HA x VA, c01 = HA x VB,
              // c11 = HB x VB, c10 = HB x VA.
              const c00 = intersectHoughLines(lineHA, lineVA);
              const c01 = intersectHoughLines(lineHA, lineVB);
              const c11 = intersectHoughLines(lineHB, lineVB);
              const c10 = intersectHoughLines(lineHB, lineVA);
              if (c00 === undefined || c01 === undefined || c11 === undefined || c10 === undefined) {
                continue;
              }
              const sideH0 = Math.hypot(c01.x - c00.x, c01.y - c00.y);
              const sideH1 = Math.hypot(c11.x - c10.x, c11.y - c10.y);
              const sideV0 = Math.hypot(c10.x - c00.x, c10.y - c00.y);
              const sideV1 = Math.hypot(c11.x - c01.x, c11.y - c01.y);
              const imageSideH = Math.max(sideH0, sideH1);
              const imageSideV = Math.max(sideV0, sideV1);
              // Model pairs (both orders handled by the orientation loop).
              for (let mA = 0; mA < modelFamilyForH.length; mA += 1) {
                for (let mB = mA + 1; mB < modelFamilyForH.length; mB += 1) {
                  const valueH0 = modelFamilyForH[mA]!;
                  const valueH1 = modelFamilyForH[mB]!;
                  const spanH = Math.abs(valueH1 - valueH0);
                  for (let mC = 0; mC < modelFamilyForV.length; mC += 1) {
                    for (let mD = mC + 1; mD < modelFamilyForV.length; mD += 1) {
                      const valueV0 = modelFamilyForV[mC]!;
                      const valueV1 = modelFamilyForV[mD]!;
                      const spanV = Math.abs(valueV1 - valueV0);
                      // Aspect prune (the image grid vs the model rectangle).
                      if (!aspectIsConsistent(imageSideH, imageSideV, spanH, spanV)) continue;
                      // Orientations: which detected line anchors the
                      // smaller model value in each family (4 combinations).
                      for (let flipH = 0; flipH < 2; flipH += 1) {
                        for (let flipV = 0; flipV < 2; flipV += 1) {
                          // The two documented ordering priors (the same
                          // "elevated main-camera" convention the line-based
                          // candidate documents): (a) the model-FAR (larger
                          // y) line sits HIGHER in the image than the
                          // model-NEAR one; (b) the model-LARGER-x line sits
                          // RIGHT of the smaller-x one. Without (b) the
                          // mirror-symmetric line evidence cannot resolve
                          // x <-> 105-x and the search picks mirrored
                          // homographies with the same forward score
                          // (measured: 0.817 vs the truth's symmetry).
                          const lineForSmallModelValue = flipH === 0 ? lineHA : lineHB;
                          const lineForLargeModelValue = flipH === 0 ? lineHB : lineHA;
                          if (swap === 0) {
                            // H family anchors the model y-family: far line above.
                            if (lineForLargeModelValue.meanY >= lineForSmallModelValue.meanY) continue;
                          } else {
                            // H family anchors the model x-family: larger-x right.
                            if (lineForLargeModelValue.meanX <= lineForSmallModelValue.meanX) continue;
                          }
                          const vLineForSmallModelValue = flipV === 0 ? lineVA : lineVB;
                          const vLineForLargeModelValue = flipV === 0 ? lineVB : lineVA;
                          if (swap === 0) {
                            // V family anchors the model x-family: larger-x right.
                            if (vLineForLargeModelValue.meanX <= vLineForSmallModelValue.meanX) continue;
                          } else {
                            // V family anchors the model y-family: far line above.
                            if (vLineForLargeModelValue.meanY >= vLineForSmallModelValue.meanY) continue;
                          }
                          // The corner pairing in canonical order
                          // (small-x,small-y), (large-x,small-y), (large-x,large-y), (small-x,large-y).
                          // Whichever family anchors the model X coordinate supplies the
                          // X-lines (small/large by the flip); the other family supplies the
                          // Y-lines. Corner (i, j) = Y-line_i x X-line_j — the grid, in
                          // canonical traversal order.
                          const lineXSmall = swap === 0
                            ? (flipV === 0 ? lineVA : lineVB)
                            : (flipH === 0 ? lineHA : lineHB);
                          const lineXLarge = swap === 0
                            ? (flipV === 0 ? lineVB : lineVA)
                            : (flipH === 0 ? lineHB : lineHA);
                          const lineYSmall = swap === 0
                            ? (flipH === 0 ? lineHA : lineHB)
                            : (flipV === 0 ? lineVA : lineVB);
                          const lineYLarge = swap === 0
                            ? (flipH === 0 ? lineHB : lineHA)
                            : (flipV === 0 ? lineVB : lineVA);
                          const cornerPx: Array<Point2D | undefined> = [
                            intersectHoughLines(lineYSmall, lineXSmall),
                            intersectHoughLines(lineYSmall, lineXLarge),
                            intersectHoughLines(lineYLarge, lineXLarge),
                            intersectHoughLines(lineYLarge, lineXSmall),
                          ];
                          if (cornerPx.some((corner) => corner === undefined)) continue;
                          const imageCorners: Point2D[] = cornerPx.map((corner) =>
                            normalized(corner!, width, height),
                          );
                          const xSmallValue = swap === 0
                            ? (flipV === 0 ? valueV0 : valueV1)
                            : (flipH === 0 ? valueH0 : valueH1);
                          const xLargeValue = swap === 0
                            ? (flipV === 0 ? valueV1 : valueV0)
                            : (flipH === 0 ? valueH1 : valueH0);
                          const ySmallValue = swap === 0
                            ? (flipH === 0 ? valueH0 : valueH1)
                            : (flipV === 0 ? valueV0 : valueV1);
                          const yLargeValue = swap === 0
                            ? (flipH === 0 ? valueH1 : valueH0)
                            : (flipV === 0 ? valueV1 : valueV0);
                          const pitchCorners: PitchPoint[] = [
                            { x: xSmallValue, y: ySmallValue },
                            { x: xLargeValue, y: ySmallValue },
                            { x: xLargeValue, y: yLargeValue },
                            { x: xSmallValue, y: yLargeValue },
                          ];
                          if (!quadIsSane(imageCorners)) continue;
                          let homography: Homography;
                          try {
                            homography = solveHomography(imageCorners, pitchCorners);
                          } catch {
                            continue;
                          }
                          // Anti-collapse guards + quick score.
                          if (!this.passesQuickGuards(homography, quickPoints, quickGreen)) continue;
                          const quick = this.forwardScoreOn(homography, quickPoints);
                          pushFinalist(homography, quick);
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
    let best: { homography: Homography; score: number } | undefined;
    for (const finalist of finalists) {
      const score = this.forwardScoreOn(finalist.homography, scoredSub);
      if (best === undefined || score > best.score) {
        best = { homography: finalist.homography, score };
      }
    }
    return best;
  }

  /**
   * The anti-collapse quick guards: the scored static evidence must project
   * SPREAD over a real pitch extent (>= SPREAD_MIN_X_M x SPREAD_MIN_Y_M —
   * degenerate solutions that collapse the image onto one dense line
   * cluster fail here), and the quick green-containment floor. The collapse
   * failure class is the measured real-mask degeneracy of the un-guarded
   * score (a solution mapping everything near the x=105 goal-area line
   * cluster scores ~1.0 forward but is geometric garbage).
   */
  private passesQuickGuards(
    homography: Homography,
    quickPoints: readonly number[],
    quickGreen: readonly number[],
  ): boolean {
    if (quickPoints.length === 0) return false;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let p = 0; p < quickPoints.length; p += 2) {
      const projected = projectSafe(homography, quickPoints[p]!, quickPoints[p + 1]!);
      if (projected === undefined) continue;
      if (projected.x < minX) minX = projected.x;
      if (projected.x > maxX) maxX = projected.x;
      if (projected.y < minY) minY = projected.y;
      if (projected.y > maxY) maxY = projected.y;
    }
    if (maxX - minX < SPREAD_MIN_X_M || maxY - minY < SPREAD_MIN_Y_M) return false;
    if (quickGreen.length === 0) return true;
    let contained = 0;
    for (let p = 0; p < quickGreen.length; p += 2) {
      const projected = projectSafe(homography, quickGreen[p]!, quickGreen[p + 1]!);
      if (
        projected !== undefined &&
        projected.x >= -GREEN_CONTAINMENT_MARGIN_M &&
        projected.x <= PITCH_LENGTH + GREEN_CONTAINMENT_MARGIN_M &&
        projected.y >= -GREEN_CONTAINMENT_MARGIN_M &&
        projected.y <= PITCH_WIDTH + GREEN_CONTAINMENT_MARGIN_M
      ) {
        contained += 1;
      }
    }
    return contained / (quickGreen.length / 2) >= QUICK_GREEN_MIN;
  }

  /**
   * The ellipse-path anti-collapse guard: percentile projection spread +
   * the same green-containment floor as the line path's quick guard. Used
   * pre-finalist, DURING the refinement descent (hard −∞ rejection), and
   * post-refinement — the collapsed-mapping failure mode is measured and
   * documented on each of those three stages.
   */
  private ellipseGuardsOk(
    homography: Homography,
    quickPoints: readonly number[],
    quickGreen: readonly number[],
  ): boolean {
    if (quickPoints.length === 0) return false;
    const xs: number[] = [];
    const ys: number[] = [];
    for (let p = 0; p < quickPoints.length; p += 2) {
      const projected = projectSafe(homography, quickPoints[p]!, quickPoints[p + 1]!);
      if (projected === undefined) continue;
      xs.push(projected.x);
      ys.push(projected.y);
    }
    if (xs.length < 4) return false;
    xs.sort((a, b) => a - b);
    ys.sort((a, b) => a - b);
    const spreadAt = (values: readonly number[], fractionLow: number, fractionHigh: number): number => {
      const low = values[Math.floor((values.length - 1) * fractionLow)]!;
      const high = values[Math.floor((values.length - 1) * fractionHigh)]!;
      return high - low;
    };
    if (
      spreadAt(xs, 0.1, 0.9) < ELLIPSE_SPREAD_PERCENTILE_MIN_X_M ||
      spreadAt(ys, 0.1, 0.9) < ELLIPSE_SPREAD_PERCENTILE_MIN_Y_M
    ) {
      return false;
    }
    if (quickGreen.length === 0) return true;
    let contained = 0;
    for (let p = 0; p < quickGreen.length; p += 2) {
      const projected = projectSafe(homography, quickGreen[p]!, quickGreen[p + 1]!);
      if (
        projected !== undefined &&
        projected.x >= -GREEN_CONTAINMENT_MARGIN_M &&
        projected.x <= PITCH_LENGTH + GREEN_CONTAINMENT_MARGIN_M &&
        projected.y >= -GREEN_CONTAINMENT_MARGIN_M &&
        projected.y <= PITCH_WIDTH + GREEN_CONTAINMENT_MARGIN_M
      ) {
        contained += 1;
      }
    }
    return contained / (quickGreen.length / 2) >= QUICK_GREEN_MIN;
  }

  /** Forward score over a normalized `[u, v, ...]` point list. */
  private forwardScoreOn(homography: Homography, points: readonly number[]): number {
    if (points.length === 0) return 0;
    let inliers = 0;
    for (let p = 0; p < points.length; p += 2) {
      const projected = projectSafe(homography, points[p]!, points[p + 1]!);
      if (projected !== undefined && modelDistanceAt(projected.x, projected.y) <= SCORE_RADIUS_M) {
        inliers += 1;
      }
    }
    return inliers / (points.length / 2);
  }
}
