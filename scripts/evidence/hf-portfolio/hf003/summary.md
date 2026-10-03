# HF003 — RF-DETR SoccerNet benchmark evidence (Worker A, flight 1 / worker 64-a)

Work item HF003: "run against Sporta benchmark fixtures and at least one authorized
real clip; compare against current detector; record latency/GPU memory/quality; no
promotion without evidence."

Branch: `work/hf003-rfdetr-benchmark` (from main @ ee0dbfe). Nothing here promotes
anything — the output is EVIDENCE for the TL's HF015 gate. `gatingState` stays
`candidate` (verified by `record-benchmark.ts`).

## The model and how it was loaded

- Candidate (HF002 ledger row, provenance echoed verbatim into
  `benchmark-record.json`): `julianzu9612/RFDETR-Soccernet` @ revision
  `1e388b922a64f2be39cbf1925e5fd5fc4f7dd771`, model license apache-2.0, dataset
  lineage (SoccerNet corpus terms) honestly unresolved, codeLicense `unknown`.
- Checkpoint: `weights/checkpoint_best_regular.pth`, 1,566,066,207 bytes,
  sha256 `b9ade4bcc2316259582674ebeebbd27bb2e956480428c54114ace567237eb5f9`,
  downloaded 2026-10-03 from the pinned revision into `/home/z/hf-bench/` (OUTSIDE
  the repo — weights are never committed, never vendored; apache-2.0 permits the
  operator download for benchmark evaluation).
- Runtime: python 3.12 venv outside the repo (`/home/z/hf-bench/hf-env`), `rfdetr`
  1.11.1 (PyPI) + `torch 2.14.1+cpu` + `opencv-python-headless` 5.0.0.
- Loading recipe (honest, recorded in `benchmark_rfdetr.py` and in the results
  JSONs' `loadInfo`): the checkpoint was trained with an older rfdetr codebase; the
  current package's `from_checkpoint` mis-resolves it to the new RFDETRLarge
  (patch 16) and attempts a starter-weights download. The flight instead constructs
  `RFDETRLargeDeprecated` — the ORIGINAL RF-DETR-Large (dinov2_windowed_base,
  hidden 384, 3 decoder layers, patch 14, 4 windows, PE 37, 300 queries,
  group_detr 13, resolution 560) — with every hyperparameter read from the
  checkpoint's own `args` entry, `num_classes=3` so the package's
  `num_classes + 1` head reproduces the legacy checkpoint's exactly-4-row class
  head, then loads the state dict (strict=False; missing = `['_kp_active_mask']`
  only — an inert keypoint buffer; unexpected = none).
- Class mapping (model card `config.json` @ the pinned revision): `0=ball,
  1=player, 2=referee, 3=goalkeeper`.
- Load validation BEFORE any fixture run: the model's own committed sample frame
  (`examples/sample_soccer_frame.jpg`, 1920x1080) → 18 detections at threshold
  0.5 (14 player, 2 ball, 2 referee; confidences 0.56–0.89). The model functions.

## The fixtures

1. **`synthetic-diagnostic-01`** — the Sporta benchmark fixture pair
   (`packages/technology-registry/fixtures`, sha-pinned; the annotation JSON's
   coordinate convention was verified against the L010 generator math before
   scoring: max center delta 0.0005 px — pixel centers + radius, 640x360).
   Sampled 30 frames (stride 10 by decode order — the L010 harness convention).
2. **`fx-001`** — the authorized REAL licensed clip (FIFA Beach Soccer World Cup
   2021 penalty, Wikimedia Commons, CC0-1.0; the repo's L010 gate clip,
   sha-pinned). Sampled 25 frames (stride 10). No annotations exist → recorded
   UNSCORED (never fabricated). This satisfies "at least one authorized real
   clip"; a real clip WITH ground-truth annotations is not reachable in this
   sandbox (recorded as a limitation — the quality-vs-annotations comparison
   exists only on the synthetic fixture).

## Quality (vs the fixture annotations, IoU 0.5, the repo's own greedy
label-aware matching convention)

| Candidate | precision | recall | f1 | ball recall |
|---|---|---|---|---|
| RF-DETR SoccerNet (threshold 0.5, strict player class) | 0.000 | 0.000 | 0.000 | 0.367 (11/30 frames) |
| RF-DETR (person classes merged) | 0.000 | 0.000 | 0.000 | — |
| **contrast-context-detector (current production path)** | **0.605** | **0.557** | **0.580** | n/a (no ball-labeled output) |
| heuristic-color-detector (weak baseline, context) | 0.993 | 0.987 | 0.990 | n/a |

**The honest reading:** the RF-DETR candidate produces ZERO player detections on
the synthetic fixture at the model-card threshold 0.5. The threshold-sweep
diagnostic (`results/rfdetr-fixture-threshold-sweep.json`) shows the flat colored
discs never exceed 0.17 confidence (mostly classified ball/goalkeeper) while the
true white 8 px ball is found at 0.49–0.56 — the fixture is
out-of-distribution for a broadcast-trained detector. The fixture scores measure
DOMAIN MISMATCH, not model quality. On the authorized real clip (unscored),
RF-DETR emits sensible output: 107 player, 7 ball, 1 referee, 1 goalkeeper
detections over 25 frames (4.6 dets/frame; 1 zero-detection frame); the current
detector's fx-001 run is likewise unscored (no annotations exist for either).

## Latency (per-frame wall-clock CPU, 2 vCPU, torch 2 threads; nearest-rank
percentiles — the repo convention)

| Candidate | fixture steady mean | p50 | p95 | fx-001 steady mean | p95 |
|---|---|---|---|---|---|
| RF-DETR SoccerNet | 2899 ms | 2829 ms | 3211 ms | 3123 ms | 3335 ms |
| contrast-context (current) | 29.6 ms | 23 ms | 110 ms | 26.1 ms | 41 ms |

RF-DETR is ~100x slower than the current detector ON THIS CPU HOST. The model
card itself reports 12–30 FPS on GPU — this flight has NO GPU evidence; the CPU
numbers are honest wall-clock readings, labeled as such.

## Memory

- **GPU memory: N/A (no GPU on the benchmark host); process RSS recorded
  instead.**
- RF-DETR inference VmRSS: 1136.5–1177.5 MiB per frame; process peak
  (ru_maxrss) 1446.1 MiB (includes torch + fp32 weights ~540 MiB + activations;
  the checkpoint file itself is 1.57 GB on disk, outside the repo).
- Current-detector baseline process RSS: 285.1 MiB (whole bun process incl.
  the L010 harness).

## Files

- `benchmark_rfdetr.py` — the model benchmark (fixture scored + real clip
  unscored; latency, RSS, honesty caveats).
- `fixture_threshold_sweep.py` — the zero-player-recall diagnostic.
- `run-baseline.ts` — the current-detector baseline through the repo's OWN L010
  harness (`@sporta/perception-benchmark`), same clips + stride.
- `record-benchmark.ts` — the validator that pins the benchmark record to the
  HF002 provenance ledger (verbatim echo), the unchanged `candidate` gating
  state, resolving evidence pointers, and the resource caveats. Exits non-zero
  on drift.
- `benchmark-record.json` — the ledger-shaped HF003 record (provenance echo +
  the run's numbers, caveats, and the promotion-gate referral).
- `results/*.json` — the measured evidence (RF-DETR fixture, RF-DETR fx-001,
  threshold sweep, current-detector baseline).

## Limitations (all recorded in the results and the record)

- No authorized real clip WITH ground-truth annotations is reachable in this
  sandbox → the annotation-scored comparison exists only on the
  domain-mismatched synthetic fixture.
- CPU-only host → no GPU latency/memory evidence at all; the GPU figures on the
  model card are unverified by this flight.
- Single measured run per clip (a machine claim stands on a single measured
  run); 30 + 25 sampled frames, stride 10.
- Identity-handoff compatibility (task-profile metric) not measured —
  detection-level only, per the HF003 scope.

## Promotion-gate referral

The RF-DETR candidate remains `candidate`. Observed blockers for HF015: (1) no
scored real-media evidence in this flight; (2) CPU-host latency two orders of
magnitude above the current detector (no GPU evidence); (3) the SoccerNet
dataset-lineage terms remain unresolved (the HF015 license review has not
happened). The TL decides at the HF015 gate; this evidence recommends nothing.
