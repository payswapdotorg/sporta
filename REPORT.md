===== 64-c REPORT BEGIN =====

# Worker 64-c delivery — HF006: the Spivak action-spotting benchmark evidence

## Manifest

- Branch: `work/hf006-spivak-benchmark` (from main @ f4be9a2; never pushed)
- Commit: `rel(64-c): HF006 — the Spivak action-spotting benchmark evidence (CPU-host, fixtures + fx-001)`
- Work item: HF006 (docs/work-items/hf-model-portfolio-work-items.md)
- Task profile: `football.eventSpotting`
  (docs/contracts/technology-task-profiles.md, FROZEN — untouched)
- Evidence tree (all committed in-repo):
  - `scripts/evidence/hf-portfolio/hf006/benchmark_spivak.py` — the benchmark (EXECUTED end-to-end on this host: feature extraction → normalization → model inference → NMS → structural metrics)
  - `scripts/evidence/hf-portfolio/hf006/record-benchmark.ts` — the fail-closed validator (EXECUTED, exit 0; pins the record's numbers to the results JSONs)
  - `scripts/evidence/hf-portfolio/hf006/benchmark-record.json` — the ledger-shaped HF006 record (provenance echo verbatim + the executed run + the typed gaps)
  - `scripts/evidence/hf-portfolio/hf006/summary.md` — the markdown summary
  - `scripts/evidence/hf-portfolio/hf006/results/spivak-synthetic-diagnostic-01.json` — the executed fixture run
  - `scripts/evidence/hf-portfolio/hf006/results/spivak-fx-001.json` — the executed real-clip run
- Not committed (by design): the checkpoint (74,155,300 B, cc-by-4.0 — sha256-verified vs the HF LFS oid, outside the repo at /home/z/hf-bench-3/hf-model), the ResNet-152 front-end weights, the spivak source clone, and the python venv (/home/z/hf-bench-3 — a NEW venv; 64-a's and 64-b's not reused).
- FROZEN contracts untouched; provenance-ledger.json untouched; architecture-lock untouched.
- Guard batteries green: packages/testing hf-ledger.test.ts 8/8;
  packages/perception-benchmark harness.test.ts (the L010 battery) 8/8.

=== HF006 BENCHMARK REPORT ===

## THE HONEST HEADLINE — executed evidence, honestly unscored

The Spivak action-spotting model RAN end-to-end on this host (the EXECUTED
convention, the HF003 shape): the full chain — keras ResNet-152 feature
extraction at 2 fps, the zoo MaxAbsScaler normalization, the dense-UNet
confidence model over its 112-s window, the package's own flexible NMS —
executed on the Sporta fixture AND the authorized real clip fx-001 (CC0).
**Temporal precision/recall is NOT MEASURED** because NO event ground truth
(timestamps + labels) exists anywhere in the repo for benchmarkable media
— the honest typed gap, with unscored structural evidence recorded instead.
**Zero detections fired at the model's own 0.5 threshold** on either clip
(max anchor confidence 0.139 fixture / 0.012 fx-001) — the model functions
(calibrated, non-degenerate outputs) but 10-12 s fragments in ~90%-padded
112-s windows are far outside its full-broadcast-game training regime.

## The model + version + loading recipe

- Candidate (HF002 ledger row, echoed VERBATIM into benchmark-record.json):
  `yahoo-inc/spivak-action-spotting-soccernet` @ revision
  `1dced1b7a921f95ab741cad59325ee2e4dc08496` (model cc-by-4.0, code
  apache-2.0, commercial use yes; weightsProvenance: Yahoo-trained
  action-spotting models (dense detection anchors), first place in the
  SoccerNet Challenge 2022, per card; datasetProvenance: SoccerNet).
- Checkpoint: the zoo's Challenge-Validated resnet_normalized CONFIDENCE
  model — `variables/variables.data-00000-of-00001`, 74,155,300 B, sha256
  `af234e7040cde800587cca70ff960bfb93f967df2f66bceb5e2df43b777cf444`
  (the HF LFS oid at the pinned revision, VERIFIED LOCALLY). Never
  committed, never vendored.
- Code pin: github yahoo/spivak @ git
  `a1a67483966123097447cd9312366c15ca04e9ff` (apache-2.0), cloned
  OUTSIDE the repo. Runtime: python 3.12.14 venv at /home/z/hf-bench-3
  (TF 2.21.0-cpu + tf_keras 2.21.0 + tensorflow-probability 0.25.0).
- Loading recipe (the recorded forensics):
  1. `tf_keras.models.load_model(compile=False)` — the Keras-2 compat
     load of the Keras-2-era SavedModel on TF 2.21 — wrapped in the
     spivak package's own DensePredictor (heads, chunk iterator, flexible
     NMS), parameterized by the model dir's own shared_args.pkl
     (chunk_duration 112.0 → 224 frames @ 2 fps, chunk_prediction_border
     50.0 s, UNet backbone, dense confidence head, 17 challenge classes).
  2. Feature chain: keras ResNet-152 (avg_pool, 2048-d, 2 fps) → the zoo
     MaxAbsScaler (`models/resnet_normalizer.pkl`) — the FORENSIC: the
     scaler's 2048-d fit proves the resnet_normalized family consumes the
     RAW ResNET_TF2 features, NOT the PCA512 branch of extraction.py.
  3. Recorded shims: tensorflow_addons (archived, training-only
     optimizers; raises if ever constructed), skvideo (the skvideo
     grabber only — the benchmarked path is the DEFAULT opencv/FrameCV
     grabber), the pre-sklearn-1.1 `clip` attribute patched to False on
     the zoo scaler (the 1.0.2 semantics).
  4. Load validation (no committed sample media exists in the zoo):
     the run itself — healthy feature ranges (raw avg_pool ∈ [0, 26.5]),
     24 + 20 feature frames at 2 fps matching the clip durations,
     calibrated non-saturating confidences; the zoo's own
     validation_evaluation aggregate is the training-regime quality
     REFERENCE (not this flight's measurement).

## The fixtures + ground-truth story

1. `synthetic-diagnostic-01` (sha-pinned technology-registry fixture):
   its annotations carry per-frame SPATIAL discs (players/ball) — NO
   event timestamps+labels.
2. `fx-001` (CC0 FIFA Beach Soccer 2021 penalty, the repo's authorized
   licensed gate clip, sha-pinned): no annotations.

The repo-wide event-ground-truth search (eval-harness cases,
technology-registry fixtures, L010 corpus conventions, the J-lane event
contracts, SWM event timelines) found NONE: real-to-swm EMITS typed event
candidates (its own model outputs — the W209 candidates-not-applied
pattern), the reality-lab robustness benchmark's sim events are a
different domain (simulator ticks, not video media). **Both fixtures are
therefore UNSCORED structural evidence, labeled as such.**

## The honest metrics

- **Temporal precision/recall: NOT MEASURED (typed gap — no ground
  truth).** The explicit matching rule IS stated exactly in
  benchmark-record.json: class-equal + |t_pred − t_gt| ≤ tolerance with a
  ±1/2/5 s sweep (the SoccerNet tight/average-tolerance convention the
  spivak configs carry), greedy confidence-descending one-to-one matching
  — implemented, zero ground-truth rows to match in this sandbox.
- **Early-detection latency**: the model's own per-window compute latency
  measured (CPU wall-clock, steady, nearest-rank percentiles):
  - fixture window mean 93.89 ms / p50 94.28 / p95 100.15 ms;
  - fx-001 window mean 99.92 ms / p50 89.21 / p95 184.26 ms;
  - front-end ResNet-152 extraction: 10,508 ms (24 feature frames) /
    10,808 ms (20 frames) — ~438 ms per feature frame on this 2-vCPU host;
  - the detection-offset-vs-event-onset distribution: NOT MEASURED
    (typed — requires event onsets, which do not exist);
  - measurement kind labeled: repeated-window microbenchmark (the SAME
    single zero-padded 112-s window run repeatedly; first two lazy-init
    calls excluded).
- **Structural (unscored) results**: zero spotted events at threshold
  0.5 on both clips; max anchor confidence 0.1385 (Kick-off) on the
  fixture, 0.0121 (Ball out of play) on fx-001; confidence histograms
  (406/408 and 340/340 anchors below 0.1) + per-class stats committed in
  the results JSONs.
- **Memory**: GPU honestly N/A; process RSS 1,568.6 MiB after the run
  (peak ru_maxrss 1,568.8 MiB).

## The cascade cost verdict (the work item's core question)

On THIS CPU host the Spivak cascade is **NOT cheap**: ≈ 876 ms of compute
per second of video (2 ResNet-152 feature frames × ~438 ms + ~0.9 ms
amortized spotting) vs ≈ 740 ms/s for the repo's own vision event path
(the contrast-context detector at 29.6 ms/frame mean × 25 fps, measured in
HF003 on this same host, + pure-function impulse logic per
real-to-swm/src/events.ts). The "cheap cascade before expensive event
reasoning" premise is a GPU-economics claim — unverified here (no GPU;
the model card's GPU figures are N/A on this host). The repo has NO
expensive event-reasoning production path today (HF007 SoccerChat is the
portfolio plan, not a present cost) — the absence is recorded. Verdict:
on a CPU host the cascade order does not pay; revisit with GPU evidence
before HF015.

## The ledger/record path

- `scripts/evidence/hf-portfolio/hf006/benchmark-record.json` — the
  ledger-shaped HF006 record (the twelve provenance fields echoing the
  Spivak row verbatim + the executed run's evidence pointers, numbers,
  typed gaps, and caveats).
- `scripts/evidence/hf-portfolio/hf006/record-benchmark.ts` — the
  fail-closed validator: EXECUTED, exit 0 (echo vs the HF002 ledger,
  candidate gating state, EXECUTED-run numbers PINNED to the committed
  results JSONs — any drift refuses, typed-gap statements present,
  resolving pointers, honest caveats).
- `scripts/evidence/hf-portfolio/provenance-ledger.json` — untouched
  (its row schema is pinned by hf-ledger.test.ts; the run is recorded in
  benchmark-record.json, not as a ledger row).

## Limitations

- No event ground truth reachable in this sandbox — temporal P/R has an
  unscored ceiling here, and the onset-offset distribution cannot exist.
- Zero detections at the model's own threshold on the only reachable
  clips (short OOD fragments): no positive spotting evidence at all.
- The zoo's second temporal-displacement (delta) phase NOT run
  (confidence-only spotting; timestamps are dense-anchor positions at
  2 fps).
- The Keras-2-era checkpoint runs via the tf_keras compat package with
  recorded archived-dependency shims — an integration risk.
- The latency numbers are CPU wall-clock on a 2-vCPU host (repeated-window
  microbenchmark), NOT deployment latency.

## Promotion-gate referral

The Spivak candidate remains `candidate` — UNCHANGED. Observed blockers
for HF015: (1) no event ground truth reachable (temporal P/R
unmeasurable in this sandbox); (2) zero detections on the only reachable
clips — no positive spotting evidence; (3) the cascade cost story is
unfavorable on CPU hosts (no GPU evidence); (4) the Keras-2-era stack
integration risk + the SoccerNet dataset lineage unresolved per the
ledger. This flight recommends NOTHING; the TL decides at the HF015 gate
alone.

=== END REPORT ===

===== 64-c REPORT END =====
