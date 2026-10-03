# Worker 64-a delivery — HF003: the RF-DETR SoccerNet benchmark evidence

## Manifest

- Branch: `work/hf003-rfdetr-benchmark` (from main @ ee0dbfe; never pushed)
- Commit: `rel(64-a): HF003 — the RF-DETR benchmark evidence (CPU-host, fixture + corpus)`
- Work item: HF003 (docs/work-items/hf-model-portfolio-work-items.md)
- Task profile: `football.playerDetection` (docs/contracts/technology-task-profiles.md, FROZEN — untouched)
- Evidence tree (all committed in-repo):
  - `scripts/evidence/hf-portfolio/hf003/benchmark_rfdetr.py` — the model benchmark
  - `scripts/evidence/hf-portfolio/hf003/fixture_threshold_sweep.py` — the zero-recall diagnostic
  - `scripts/evidence/hf-portfolio/hf003/run-baseline.ts` — the current-detector baseline (repo L010 harness)
  - `scripts/evidence/hf-portfolio/hf003/record-benchmark.ts` — the ledger-pinning validator (exit 0)
  - `scripts/evidence/hf-portfolio/hf003/benchmark-record.json` — the ledger-shaped HF003 record
  - `scripts/evidence/hf-portfolio/hf003/summary.md` — the markdown summary
  - `scripts/evidence/hf-portfolio/hf003/results/rfdetr-synthetic-diagnostic-01.json`
  - `scripts/evidence/hf-portfolio/hf003/results/rfdetr-fx-001.json`
  - `scripts/evidence/hf-portfolio/hf003/results/rfdetr-fixture-threshold-sweep.json`
  - `scripts/evidence/hf-portfolio/hf003/results/baseline-current-detector.json`
- Not committed (by design): the checkpoint (1.57 GB, apache-2.0, operator
  download at /home/z/hf-bench — never vendored) and the python venv.
- FROZEN contracts untouched; provenance-ledger.json untouched (its row schema is
  test-pinned to exactly the twelve provenance fields; the benchmark run is
  recorded in benchmark-record.json, which `record-benchmark.ts` pins to the
  ledger verbatim).

=== HF003 BENCHMARK REPORT ===

## Summary

HF003 asked for the first model-portfolio benchmark flight: run the RF-DETR
SoccerNet candidate against the Sporta benchmark fixtures and at least one
authorized real clip, compare it against the current detector, record
latency/GPU-memory/quality, and promote NOTHING without evidence. All four
measurement legs ran in this sandbox on a CPU-only 2-vCPU host; every number
below is a single measured run, honestly labeled.

## The model + version + how loaded

- Candidate (HF002 ledger row): `julianzu9612/RFDETR-Soccernet` @ revision
  `1e388b922a64f2be39cbf1925e5fd5fc4f7dd771`, apache-2.0 (model card), dataset
  lineage unresolved (SoccerNet corpus terms), codeLicense `unknown`. RF-DETR-Large
  fine-tuned on SoccerNet-Tracking 2023 (42,750 images; 4 classes:
  ball/player/referee/goalkeeper).
- Runtime: python 3.12 venv OUTSIDE the repo (/home/z/hf-bench), rfdetr 1.11.1
  (PyPI), torch 2.14.1+cpu, opencv-python-headless 5.0.0. Checkpoint
  `weights/checkpoint_best_regular.pth` (1,566,066,207 bytes; sha256
  b9ade4bcc2316259582674ebeebbd27bb2e956480428c54114ace567237eb5f9) downloaded
  from the pinned revision 2026-10-03; never committed.
- Loading (the honest recipe for a legacy checkpoint on the current package):
  `rfdetr.from_checkpoint` mis-resolves this checkpoint to the new patch-16
  RFDETRLarge and stalls on a starter-weights download, so the flight constructs
  `RFDETRLargeDeprecated` (the original RF-DETR-Large) with every
  hyperparameter read from the checkpoint's own `args` (dinov2_windowed_base,
  hidden 384, 3 decoder layers, patch 14, 4 windows, PE 37, 300 queries,
  group_detr 13, resolution 560), with `num_classes=3` so the package's
  `num_classes+1` head reproduces the legacy 4-row class head, then loads the
  state dict (strict=False: missing = `['_kp_active_mask']` — an inert keypoint
  buffer; unexpected = none). Class mapping per the pinned config.json:
  0=ball, 1=player, 2=referee, 3=goalkeeper.
- Load validation before any fixture run: the model's own committed sample frame
  (1920x1080) → 18 detections at threshold 0.5 (14 player, 2 ball, 2 referee,
  confidences 0.56–0.89). The model functions.

## The fixture + real-clip story

- `synthetic-diagnostic-01` (the Sporta benchmark fixture pair, sha-pinned;
  annotation coordinate convention verified against the L010 generator math —
  max center delta 0.0005 px): 30 frames sampled at stride 10 by decode order
  (the L010 harness convention), SCORED against the exact annotations.
- `fx-001` — the AUTHORIZED REAL licensed clip (FIFA Beach Soccer World Cup
  2021 penalty, Wikimedia Commons, CC0-1.0; one of the repo's two L010 gate
  clips, sha-pinned): 25 frames at stride 10, recorded UNSCORED (no annotations
  exist — never fabricated). A real clip WITH ground-truth annotations is not
  reachable in this sandbox; that gap is recorded as a limitation (the
  annotation-scored comparison exists only on the synthetic fixture).

## Quality (vs annotations AND vs the current detector, IoU 0.5, the repo's
own greedy label-aware matching)

| Candidate | precision | recall | f1 | ball recall |
|---|---|---|---|---|
| RF-DETR SoccerNet (threshold 0.5) | 0.000 | 0.000 | 0.000 | 0.367 (11/30) |
| RF-DETR (person classes merged) | 0.000 | 0.000 | 0.000 | — |
| contrast-context-detector (current, J012 production path) | 0.605 | 0.557 | 0.580 | n/a |
| heuristic-color-detector (weak baseline, context) | 0.993 | 0.987 | 0.990 | n/a |

The honest reading: RF-DETR produces ZERO player detections on the synthetic
fixture at the model-card threshold; the threshold-sweep diagnostic
(results/rfdetr-fixture-threshold-sweep.json) shows the flat colored discs never
exceed 0.17 confidence while the true 8 px ball is found at 0.49–0.56 — the
fixture is out-of-distribution for a broadcast-trained detector, so these scores
measure domain mismatch, not model quality. On the authorized real clip
(unscored — no annotations exist for either candidate), RF-DETR emits sensible
output: 107 player + 7 ball + 1 referee + 1 goalkeeper detections over 25 frames
(4.6 dets/frame, 1 zero-detection frame); the current detector's fx-001 run is
likewise unscored.

## Latency (per-frame wall-clock CPU, 2 vCPU; nearest-rank p50/p95 — the repo
convention)

| Candidate | fixture mean / p50 / p95 | fx-001 mean / p95 |
|---|---|---|
| RF-DETR SoccerNet | 2899 / 2829 / 3211 ms | 3123 / 3335 ms |
| contrast-context (current) | 29.6 / 23 / 110 ms | 26.1 / 41 ms |

~100x slower than the current detector ON THIS CPU HOST. The model card claims
12–30 FPS on GPU; this flight has NO GPU evidence — the CPU numbers are honest
wall-clock readings, labeled as such.

## Memory

**GPU memory: N/A (no GPU on the benchmark host); process RSS recorded
instead.** RF-DETR inference VmRSS 1136.5–1177.5 MiB per frame, process peak
(ru_maxrss) 1446.1 MiB; the current-detector baseline process RSS 285.1 MiB.

## The ledger record

`scripts/evidence/hf-portfolio/hf003/benchmark-record.json` — the ledger-shaped
HF003 record: the twelve provenance fields echo the RF-DETR row of
`scripts/evidence/hf-portfolio/provenance-ledger.json` VERBATIM (the ledger's row
schema is test-pinned to exactly those fields, so the run is recorded here, not
as a ledger row), plus the run's evidence pointers, numbers, and resource
caveats. `scripts/evidence/hf-portfolio/hf003/record-benchmark.ts` (exit 0)
machine-checks the echo, the unchanged `candidate` gating state, the evidence
pointers, and the caveats. gatingState stays `candidate` — no promotion.

## Limitations

1. No authorized real clip with ground-truth annotations is reachable in this
   sandbox → the annotation-scored comparison exists only on the
   domain-mismatched synthetic fixture.
2. CPU-only host → no GPU latency or GPU-memory evidence; the model card's GPU
   figures are unverified by this flight.
3. Single measured run per clip (30 + 25 sampled frames, stride 10).
4. Detection-level only: identity-handoff compatibility (a task-profile metric)
   not measured.
5. The checkpoint loads only via the legacy-variant recipe recorded above (the
   current rfdetr `from_checkpoint` mis-resolves it) — reproducibility depends
   on that recipe plus the pinned revision.

## Promotion-gate referral

The RF-DETR candidate remains `candidate`; this benchmark recommends NOTHING
production. Observed HF015 blockers: (1) no scored real-media evidence in this
flight; (2) CPU-host latency two orders of magnitude above the current detector
(no GPU evidence); (3) SoccerNet dataset-lineage terms unresolved (the HF015
license review has not happened). Promotion is the Tech Lead's HF015 gate alone.

=== END REPORT ===
