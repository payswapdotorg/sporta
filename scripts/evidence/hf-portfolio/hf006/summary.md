# HF006 — the Spivak action-spotting benchmark (Worker 64-c, flight 3)

**Work item (verbatim)**: "HF006 — Spivak event-spotting benchmark — Owner:
Worker A. Acceptance: measure temporal precision/recall and early-detection
latency; evaluate as a cheap cascade before expensive event reasoning."

**Verdict in one line**: the model RAN end-to-end (EXECUTED evidence, the
HF003 shape) — temporal P/R is honestly **NOT MEASURED (typed gap: no event
ground truth exists anywhere in the repo)**, early-detection latency is
measured as the per-window CPU wall-clock (median + nearest-rank p95) with
the onset-offset distribution typed not-measured for the same reason, and
the cascade-cost verdict is **unfavorable on this CPU host** (the ResNet-152
front-end dominates; the "cheap cascade" premise is GPU economics, unverified
here — no GPU).

## The run

- **Model**: `yahoo-inc/spivak-action-spotting-soccernet` @ revision
  `1dced1b7a921f95ab741cad59325ee2e4dc08496` (cc-by-4.0 model /
  apache-2.0 code) — the zoo's Challenge-Validated resnet_normalized
  CONFIDENCE model
  (`models/spotting_challenge_validated_resnet_normalized_confidence_zoo_lr5e-4_dwd2e-4_sr0.02_mu0.0/best_model`).
  Checkpoint `variables.data-00000-of-00001` = 74,155,300 B, sha256
  `af234e7040cde800587cca70ff960bfb93f967df2f66bceb5e2df43b777cf444`
  (the HF LFS oid at the pinned revision — **verified locally**). Never
  committed, never vendored.
- **Code pin**: github yahoo/spivak @ git
  `a1a67483966123097447cd9312366c15ca04e9ff`, cloned OUTSIDE the repo
  (`/home/z/hf-bench-3/spivak-src`); venv `/home/z/hf-bench-3/.venv`
  (python 3.12.14, TF 2.21.0-cpu + tf_keras 2.21.0 + tfp 0.25.0) — a NEW
  venv; 64-a's and 64-b's not reused.
- **Loading recipe (the recorded forensics)**:
  - tf_keras (Keras-2 compat) `load_model(compile=False)` of the
    Keras-2-era SavedModel, wrapped in the spivak package's own
    DensePredictor (heads + VideoChunkIteratorProvider + flexible NMS),
    parameterized by the model dir's own `shared_args.pkl` (chunk 112 s →
    224 frames @ 2 fps, border 50 s, UNet backbone, dense confidence head,
    17 challenge classes).
  - **Feature-chain forensic**: the zoo `resnet_normalizer.pkl` is a
    MaxAbsScaler fitted on **2048-dim** features → the `resnet_normalized`
    family consumes the RAW ResNET_TF2 features (keras ResNet-152 avg_pool
    @ 2 fps), NOT extraction.py's PCA512 branch. The ResNet-152 weights
    (`resnet152_weights_tf_dim_ordering_tf_kernels.h5`, 242,900,224 B,
    keras-applications) live outside the repo.
  - **Recorded shims**: tensorflow_addons (archived; training-only
    optimizers — raises if ever constructed), skvideo (skvideo grabber
    only; the benchmarked path is the DEFAULT opencv/FrameCV grabber); the
    zoo MaxAbsScaler's pre-sklearn-1.1 `clip` attribute patched to False
    (the 1.0.2 semantics).
- **Fixtures** (the brief's contract): `synthetic-diagnostic-01` (sha-pinned
  technology-registry fixture) + the authorized real clip `fx-001` (CC0,
  sha-pinned gate clip). Both run as ONE zero-padded 112-s window each
  (10-12 s clips vs a 112-s model window — the package's own
  VideoChunkIterator zero-padding convention, recorded as a caveat).

## The honest numbers

| Measurement | synthetic-diagnostic-01 | fx-001 (CC0 real) |
|---|---|---|
| Feature frames (2 fps, 2048-d) | 24 | 20 |
| Front-end extraction (CPU wall-clock) | 10,508 ms | 10,808 ms |
| Per-window spotting (steady mean) | 93.89 ms | 99.92 ms |
| Per-window p50 / p95 (nearest-rank) | 94.28 / 100.15 ms | 89.21 / 184.26 ms |
| Spotted events @ threshold 0.5 | 0 | 0 |
| Max anchor confidence | 0.1385 (Kick-off) | 0.0121 (Ball out of play) |
| Anchors (frames × 17 classes) | 408 | 340 |
| Process RSS | — | 1,568.6 MiB (peak 1,568.8) |

- **Temporal precision/recall: NOT MEASURED (typed)**. The repo search
  (eval-harness cases, technology-registry fixtures, L010 corpus
  conventions, J-lane event contracts, SWM event timelines) found NO event
  ground truth (timestamps + labels) for any benchmarkable media: the
  fixture annotations carry per-frame SPATIAL discs only; real-to-swm
  EMITS typed event candidates (its own model outputs, the W209
  candidates-not-applied pattern); the SWM timelines are derived state.
  The explicit matching rule is stated in benchmark-record.json
  (`quality.temporalMatchingRule`: class-equal + |t_pred − t_gt| ≤
  tolerance, ±1/2/5 s sweep, greedy confidence-descending one-to-one) —
  implemented, never executed on real ground truth in this flight.
- **Early-detection latency**: per-window wall-clock measured above
  (repeated-window microbenchmark — the same single window run
  repeatedly, labeled as such); the detection-offset-vs-onset
  distribution is NOT MEASURED (typed — requires event onsets).
- **Structural evidence**: the model produces calibrated, non-degenerate
  outputs (per-class differentiation, no saturation: 406/408 anchors
  < 0.1 on the fixture; 340/340 < 0.1 on fx-001) but fires NO detections
  at its own 0.5 threshold on 10-12 s fragments — each clip is ~90%
  zero-padding inside the 112-s window, far outside the full-game
  broadcast context the model was trained on (beach soccer adds a domain
  shift for fx-001). The zoo's own `validation_evaluation` aggregate (the
  model's challenge-validation metrics) is the quality REFERENCE for the
  training regime — not this flight's measurement.
- **Cascade cost (the work item's core question)**: on THIS 2-vCPU host,
  the Spivak pipeline costs ≈ **876 ms of compute per second of video**
  (2 ResNet-152 feature frames × ~438 ms + ~0.9 ms amortized spotting)
  vs the repo's own vision event path ≈ **740 ms/s**
  (contrast-context detector at 29.6 ms/frame mean × 25 fps, measured in
  HF003 on this same host, + pure-function impulse logic). The "cheap
  cascade before expensive event reasoning" premise does NOT hold on a
  CPU host; the repo has no expensive event-reasoning production path
  today (HF007 SoccerChat is the portfolio plan, not a present cost) —
  the honest verdict is recorded with both citations.
- **Memory**: GPU honestly N/A; process RSS 1,568.6 MiB (interpreter +
  TF 2.21 + ResNet-152 front-end + the 74 MB model + the 224×2048 window).

## The typed gaps

1. No event ground truth in the repo ⇒ temporal P/R unmeasurable here
   (not merely unmeasured) — unscored structural evidence per the brief.
2. Early-detection offset-vs-onset not measured (same root cause).
3. The zoo's second temporal-displacement (delta) phase NOT run —
   confidence-only spotting; timestamps are dense-anchor positions @ 2 fps.
4. Short-clip regime: one zero-padded 112-s window per clip (~90%
   padding) — measures THIS regime, not the challenge regime.
5. Keras-2-era stack on TF 2.21 (tf_keras compat load, archived-dep
   shims) — an integration risk, recorded.
6. Repeated-window latency microbenchmark: identical input, labeled.

## The guard batteries + delivery

- `record-benchmark.ts` (this tree) — EXECUTED, exit 0: provenance echo
  verbatim vs the HF002 ledger, EXECUTED-run numbers pinned to the
  results JSONs (fail-closed on drift), typed gaps present, no promotion.
- hf-ledger.test.ts 8/8; perception-benchmark harness.test.ts (L010) 8/8
  (re-run post-flight, unchanged); eslint 0 on the touched files;
  prettier clean.
- Branch `work/hf006-spivak-benchmark` (never pushed). FROZEN contracts,
  provenance-ledger.json, architecture-lock: untouched.
- NO promotion: gatingState stays `candidate`; the HF015 gate (TL)
  owns it. Observed blockers recorded in benchmark-record.json
  (`promotionGate.blockersObserved`).
