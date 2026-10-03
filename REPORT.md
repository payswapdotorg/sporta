===== 64-b REPORT BEGIN =====

# Worker 64-b delivery — HF004: the MapAnything geometry benchmark evidence

## Manifest

- Branch: `work/hf004-mapanything-benchmark` (from main @ 065714b; never pushed)
- Commit: `rel(64-b): HF004 — the MapAnything geometry benchmark evidence (CPU-host, fixtures + fx-001)`
- Work item: HF004 (docs/work-items/hf-model-portfolio-work-items.md)
- Task profiles: `scene.metric3DReconstruction`, `scene.depth`,
  `scene.cameraPose`, `scene.covisibility`
  (docs/contracts/technology-task-profiles.md, FROZEN — untouched)
- Evidence tree (all committed in-repo):
  - `scripts/evidence/hf-portfolio/hf004/benchmark_mapanything.py` — the benchmark (preflight EXECUTED on this host: exit 3, the typed refusal; full path ready-to-run on an adequate host)
  - `scripts/evidence/hf-portfolio/hf004/schema_introspect.py` — the source-verified output-schema extractor (EXECUTED, fail-closed)
  - `scripts/evidence/hf-portfolio/hf004/contract_compatibility.ts` — the machine-checkable compatibility verdict (EXECUTED, exit 0)
  - `scripts/evidence/hf-portfolio/hf004/record-benchmark.ts` — the fail-closed validator (EXECUTED, exit 0)
  - `scripts/evidence/hf-portfolio/hf004/benchmark-record.json` — the ledger-shaped HF004 record
  - `scripts/evidence/hf-portfolio/hf004/summary.md` — the markdown summary
  - `scripts/evidence/hf-portfolio/hf004/results/preflight-refusal.json` — the EXECUTED typed refusal
  - `scripts/evidence/hf-portfolio/hf004/results/download-probe.json` — the bounded 8 MiB reachability probe
  - `scripts/evidence/hf-portfolio/hf004/results/model-output-schema.json` — the source-verified output schema
  - `scripts/evidence/hf-portfolio/hf004/results/contract-compatibility.json` — the field-level compatibility verdict
- Not committed (by design): the checkpoint (4.91 GB, apache-2.0 — CANNOT
  even be stored on this host), the mapanything source clone, and the
  python venv (/home/z/hf-bench-2 — a NEW venv, 64-a's not reused).
- FROZEN contracts untouched; provenance-ledger.json untouched; architecture-lock untouched.
- Guard batteries green: packages/testing hf-ledger.test.ts 8/8;
  packages/perception-benchmark harness.test.ts (the L010 battery) green.

=== HF004 BENCHMARK REPORT ===

## THE HONEST HEADLINE — a typed refusal, not a benchmark run

The pinned candidate CANNOT run on this benchmark host. This is arithmetic,
not a stall and not a mid-run error:

| Constraint | Needed | Host | Verdict |
|---|---|---|---|
| Disk: checkpoint + torch-hub DINOv2-giant backbone | 4,914,062,480 + ~1,150,000,000 B | 1,355,993,088 B free | infeasible |
| RAM: fp32 weights (~4.58 GiB) + activations | ~5.58 GiB (est.) | 4,041.6 MiB total | infeasible |

The download path itself is reachable (bounded 8 MiB probe: 3.76 MiB/s —
`results/download-probe.json`). `benchmark_mapanything.py --preflight` was
EXECUTED on this host and emitted the typed refusal
`resource-infeasible-host` with exit code 3 (`results/preflight-refusal.json`).
Per the worker brief, the honest delivery is the typed refusal + the
partial: **the load analysis, the static contract-compatibility review,
and the ready-to-run script. No quality, latency, or memory number exists
in this flight, and none is fabricated to stand in** —
`record-benchmark.ts` fail-closes on any measurement-shaped key.

## The model + version + loading recipe

- Candidate (HF002 ledger row, echoed VERBATIM into benchmark-record.json):
  `facebook/map-anything-apache` @ revision
  `00f9c245bbcb60522d1ed7f9e9d88462c6e3f38a` (apache-2.0 model + code;
  datasetProvenance `unknown` — the card states no training corpus).
- Checkpoint: `model.safetensors`, 4,914,062,480 B; sha256
  `fa06c0fdccefc5048e072c85935d5789b1e36b307f3859033c17f9dcb9fd5201`
  (the HF LFS etag of the pinned blob — hub-reported; not locally
  verifiable on this host, honestly labeled). Never committed, never
  vendored — the repo records only pins and digests.
- Architecture (the pinned repo's config.json): DINOv2-giant encoder (24
  of 40 blocks, torch-hub, patch 14) + 16-layer 1536-dim
  alternating-attention info sharing + dpt+pose heads
  (`raydirs+depth+pose+confidence+mask` adaptor) + 1-dim exp metric scale
  head → the ~1.23B-param fp32 checkpoint.
- Code pin: mapanything 1.1.4 (not on PyPI) = facebookresearch/map-anything
  @ git `3d10cf7a3016fc0f9bb13a071ee66c47b10be0d9`, cloned OUTSIDE the
  repo at /home/z/hf-bench-2/map-anything-src; venv /home/z/hf-bench-2
  (uv, python 3.12.14 — NEW; 64-a's venv not reused); torch NOT installed
  (the install + load is the infeasibility).
- Loading recipe (ready-to-run, in benchmark_mapanything.py):
  snapshot_download @ the pinned revision → LOCAL sha256 verification vs
  the pinned etag sha → `MapAnything.from_pretrained(<local dir>)`
  (construction fetches DINOv2-giant via torch.hub) → `infer(views, ...)`
  on stride-10 frame windows of the two clips (load_images
  longest_side/512, fp32 on CPU, memory_efficient_inference, minibatch 1).

## The fixtures + ground-truth story

1. `synthetic-diagnostic-01` (sha-pinned technology-registry fixture) —
   the camera-motion FALLBACK input per the brief. Typed gap: **no
   ground-truthed camera-motion fixture exists in the repo** (the repo's
   camera contracts are the five FIXED W601 slots + the R606 pitch-ellipse
   calibration — neither is a camera-motion fixture with pose/depth
   ground truth); the fixture itself carries no geometry ground truth →
   unscored.
2. `fx-001` (CC0 FIFA Beach Soccer 2021 penalty, the repo's authorized
   licensed gate clip, sha-pinned) — no geometry ground truth → unscored.

Both: status `not-run-resource-refusal` (the model never ran). The
ready-to-run path would sample stride 10 by decode order (the L010
convention — 30 + 25 frames, the same frames HF003 saw).

## The honest metrics

- **Quality: NOT MEASURED (typed refusal).** No ground truth exists for
  geometry on either clip anyway — even on adequate hardware the ceiling
  is unscored-structural evidence (depth consistency, pose sanity,
  determinism — all implemented in the ready-to-run path).
- **Latency: NOT MEASURED (typed refusal).** The convention is implemented
  (per-inference CPU wall-clock, median + nearest-rank p95).
- **Memory: NOT MEASURED (typed refusal).** GPU honestly N/A on this host;
  RSS would be the substitute metric; the only honest memory figure in
  this flight is the refusal arithmetic (4,041.6 MiB total RAM vs ~4.58
  GiB fp32 weights).
- **Structural/compatibility verdict (EXECUTED, machine-checkable)**: see
  below.

## The Camera-Director contract-compatibility verdict

`contract_compatibility.ts` (exit 0) verified 15 field-level rows against
the repo's OWN authorities (FROZEN task profiles, renderer contract, SWM
contract, camera-director sources, scene-projection constants):

- `scene.depth` — **compatible-with-adapter** (depth_z + per-pixel conf;
  adapter adds the SWM envelope).
- `scene.cameraPose` — **compatible-with-adapter with typed gaps**:
  camera_poses/cam_trans/cam_quats (cam2world, OpenCV convention) give the
  trajectory geometry; the model emits NO timestamps (view order only) and
  NO pose-level confidence; the world gauge is the model's canonical
  frame, not the pitch frame.
- `scene.metric3DReconstruction` — **compatible-with-adapter, metric
  claim unverified** (pts3d + poses + intrinsics; metric_scaling_factor is
  the model's own prediction, unscored).
- `scene.covisibility` — **partial** (no covisibility output; the model's
  cross-view depth-consistency mechanism is a proxy at best).
- **Camera Director INPUT — NOT COMPATIBLE (inverse direction)**: the
  director consumes a policy + W603 match-timeline steps + W209 event
  candidates and emits cameraSlotId windows over the FIVE canonical fixed
  slots; NO pose/depth field exists in its contract (source-scanned).
  MapAnything ESTIMATES cameras from images; the director DICTATES fixed
  cameras from match state — inverse directions. The model's real
  consumers are the SWM observation side (via a future envelope-writing
  adapter) and the renderer.cinematicReCamera "geometry/depth guidance"
  input (the HF014 provider-neutral camera-intent seam is the referral,
  not a claim — it is not built).
- SWM envelope — **does-not-map**: the model emits tensors only;
  sessionId/schemaVersion/eventTime/source-provenance/confidence-envelope
  fields must all be synthesized by an observation adapter.

**Overall: PARTIAL COMPATIBILITY, HONESTLY TYPED.** There is also no
baseline comparison: the repo has NO dense-geometry production path (the
geometry incumbents — R606 pitch-ellipse calibration, fixed scene-projection
slots — produce no dense depth/pointmaps).

## The ledger/record path

- `scripts/evidence/hf-portfolio/hf004/benchmark-record.json` — the
  ledger-shaped HF004 record (provenance echo verbatim + the typed refusal
  + the partial-deliverable pointers).
- `scripts/evidence/hf-portfolio/hf004/record-benchmark.ts` — the
  fail-closed validator: EXECUTED, exit 0 (echo vs the HF002 ledger,
  candidate gating state, executed-refusal pinning, no-fabricated-numbers
  checks, resolving pointers, honest caveats).
- `scripts/evidence/hf-portfolio/provenance-ledger.json` — untouched (its
  row schema is pinned by hf-ledger.test.ts; the run is recorded in
  benchmark-record.json, not as a ledger row).

## Limitations

- Zero executed model evidence of any kind on this host (the typed
  refusal) — the HF003 precedent (executed-but-domain-mismatched evidence)
  is NOT met here.
- No geometry ground truth reachable in this sandbox even on adequate
  hardware (unscored-structural ceiling).
- The schema review is a source-scan of the pinned code (fail-closed,
  construction-site-verified), not an import-executed introspection —
  torch + the model are exactly the infeasibility.
- The metric-scale claim and the world-gauge alignment to the Sporta pitch
  frame are unverified by any executed evidence.

## Promotion-gate referral

The MapAnything candidate remains `candidate` — UNCHANGED. Observed
blockers for HF015: (1) zero executed benchmark evidence (the typed
refusal); (2) no geometry ground truth reachable (unscored ceiling); (3)
datasetProvenance `unknown` — the HF015 license review has not happened;
(4) the metric claim unverified. This flight recommends NOTHING; the TL
decides at the HF015 gate alone.

=== END REPORT ===

===== 64-b REPORT END =====
