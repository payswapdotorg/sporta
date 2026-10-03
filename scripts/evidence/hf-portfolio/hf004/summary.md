# HF004 — MapAnything geometry benchmark evidence (Worker A, flight 2 / worker 64-b)

Work item HF004: "benchmark camera/depth/reconstruction quality on Sporta
camera-motion fixtures and authorized real footage; output compatible with
SWM/Camera Director contracts."

Branch: `work/hf004-mapanything-benchmark` (from main @ 065714b). Nothing
here promotes anything — the output is EVIDENCE for the TL's HF015 gate.
`gatingState` stays `candidate` (verified by `record-benchmark.ts`).

## THE HONEST HEADLINE: this flight ends in a typed refusal

The pinned candidate cannot run on this benchmark host — not stalled, not
errored mid-run: **arithmetically impossible**, twice over:

| Constraint | Needed | Host | Verdict |
|---|---|---|---|
| Disk (checkpoint + torch-hub DINOv2-giant backbone) | 4,914,062,480 + ~1,150,000,000 B | 1,355,993,088 B free | infeasible |
| RAM (fp32 weights ~4.58 GiB + activations) | ~5.58 GiB est. | 4,041.6 MiB total | infeasible |

The download itself is REACHABLE (bounded 8 MiB probe: 3.76 MiB/s —
`results/download-probe.json`; a 16 MiB exploratory probe earlier in the
flight measured 6.24 MiB/s) — the block is resource arithmetic, not
network. `benchmark_mapanything.py --preflight` was EXECUTED on this host
and emitted the typed refusal `resource-infeasible-host` (exit code 3;
`results/preflight-refusal.json`).

Per the worker brief, the honest delivery is the typed refusal + the
partial: the load analysis, the static contract-compatibility review, and
the ready-to-run script. **No quality, latency, or memory number exists in
this flight — none is fabricated to stand in.**

## The model (the load analysis)

- Candidate (HF002 ledger row, echoed VERBATIM into
  `benchmark-record.json`): `facebook/map-anything-apache` @ revision
  `00f9c245bbcb60522d1ed7f9e9d88462c6e3f38a`, model license apache-2.0,
  code license apache-2.0, datasetProvenance `unknown` (the card states no
  training corpus).
- Checkpoint: `model.safetensors`, 4,914,062,480 bytes, sha256
  `fa06c0fdccefc5048e072c85935d5789b1e36b307f3859033c17f9dcb9fd5201`
  (the HF LFS etag of the pinned blob — hub-reported; NOT locally
  verified, honestly, because the file cannot be stored on this host).
  Weights are never committed, never vendored; the repo records only the
  pins and digests.
- Architecture (the pinned repo's `config.json`, digested in
  `results/model-output-schema.json`): DINOv2-giant encoder (24 of 40
  blocks kept, torch-hub construction, patch 14) + a 16-layer 1536-dim
  alternating-attention information-sharing stage + dpt+pose prediction
  heads with the `raydirs+depth+pose+confidence+mask` adaptor and a 1-dim
  exp-activated metric scale head.
- Code side pin: mapanything 1.1.4 (NOT on PyPI) — the source is
  facebookresearch/map-anything @ git
  `3d10cf7a3016fc0f9bb13a071ee66c47b10be0d9`, shallow-cloned OUTSIDE the
  repo at `/home/z/hf-bench-2/map-anything-src` (the flight's NEW venv:
  `/home/z/hf-bench-2`, uv, python 3.12.14 — 64-a's venv was not reused).
  Torch was NOT installed into it: the install + load is exactly the
  infeasibility above.
- Ready-to-run loading recipe (implemented in `benchmark_mapanything.py`):
  `snapshot_download` @ the pinned revision, LOCAL sha256 verification
  against the pinned etag sha, `MapAnything.from_pretrained(<local dir>)`
  (construction fetches the DINOv2-giant backbone via torch.hub), then
  `infer(views, ...)` on stride-10 frame windows of the two clips.

## The fixtures (the camera-motion story, honestly typed)

1. **`synthetic-diagnostic-01`** — the technology-registry fixture pair
   (sha-pinned). Role: the camera-motion FALLBACK input per the worker
   brief. The typed gap: **no ground-truthed camera-motion fixture exists
   in the repo** — the repo's camera contracts are the five FIXED W601
   slots (`packages/scene-projection/src/constants.ts`) and the R606
   pitch-ellipse calibration (`scripts/evidence/r606-ellipse-constrained/`);
   neither is a camera-motion fixture with pose/depth ground truth. The
   fixture also has no geometry ground truth → unscored if it ever runs.
2. **`fx-001`** — the authorized REAL licensed clip (CC0, FIFA Beach
   Soccer World Cup 2021 penalty; the repo's L010 gate clip, sha-pinned).
   No geometry ground truth exists → unscored.

Both clips: status `not-run-resource-refusal` (the model never ran). The
ready-to-run path would sample them at stride 10 by decode order (the L010
harness convention — 30 + 25 frames, the same frames the HF003 flight saw).

## The contract-compatibility verdict (the machine-checkable part)

`contract_compatibility.ts` (EXECUTED, exit 0) checks every claim against
the repo's OWN authorities — the FROZEN task profiles, the renderer
contract, the SWM contract, the camera-director sources, the
scene-projection constants — and emits 15 needle-verified field-level rows
(`results/contract-compatibility.json`):

| Contract target | Verdict |
|---|---|
| `scene.depth` | **compatible-with-adapter** — `depth_z` (B,H,W,1) + per-pixel `conf` match the profile's "depth maps with confidence"; the adapter must add the SWM envelope (timestamps/provenance/session) |
| `scene.cameraPose` | **compatible-with-adapter (typed gaps)** — `camera_poses` (B,4,4 cam2world, OpenCV convention) / `cam_trans` / `cam_quats` give the trajectory GEOMETRY; the model emits NO timestamps (view order only) and NO pose-level confidence (per-pixel `conf` does not aggregate to one); the world gauge is the model's canonical frame, not the Sporta pitch frame |
| `scene.metric3DReconstruction` | **compatible-with-adapter (metric claim unverified)** — `pts3d` + poses + `intrinsics` are the geometry and camera relationships; the metric scale is the model's own factored prediction (`metric_scaling_factor`), unverified by any ground truth in this flight |
| `scene.covisibility` | **partial** — no covisibility output; the model's own optional cross-view depth-consistency confidence is a proxy an adapter could derive, not the profile's output |
| **Camera Director INPUT** (`packages/camera-director`) | **not-compatible (inverse direction)** — the director's inputs are a policy + the W603 match-timeline steps (SWM pitch-frame state) + W209 event candidates, and its output is a rundown of `cameraSlotId` windows over the FIVE canonical fixed slots; no pose/depth field exists anywhere in its contract (source-scanned). MapAnything ESTIMATES a camera trajectory from images; the director DICTATES fixed named cameras from match state — inverse directions. The model cannot drive the director, and the director needs nothing the model produces |
| SWM required fields | **does-not-map** — the model emits tensors only; every envelope field (sessionId, schemaVersion, eventTime, ingestTime, source/provenance, stable local IDs) must be synthesized by a future observation adapter (OBSERVED → DERIVED; an Observation never silently becomes fact) |
| `renderer.cinematicReCamera` "geometry/depth guidance" | **maps-with-adapter** — `depth_z`/`pts3d` are exactly such guidance; the estimated pose trajectory is camera-path material for the HF014 provider-neutral camera-intent seam (a REFERRAL — the seam is not built) |

**Overall: PARTIAL COMPATIBILITY, HONESTLY TYPED.** No baseline comparison
exists either: the repo has NO dense-geometry production path to baseline
against (the geometry incumbents are the R606 pitch-ellipse calibration and
the fixed scene-projection slots — neither produces dense depth/pointmaps).

## Latency / memory

**Not measured — the model never ran.** The conventions are implemented in
the ready-to-run path (per-inference CPU wall-clock, median + nearest-rank
p95; VmRSS per inference + ru_maxrss peak; GPU honestly N/A on this host),
and `record-benchmark.ts` fail-closes on any measurement-shaped key in the
record (the refusal may not be laundered into numbers).

## Files

- `benchmark_mapanything.py` — the benchmark: `--preflight` EXECUTED here
  (exit 3, the typed refusal); the full path READY-TO-RUN on an adequate
  host (≥16 GB RAM, ≥8 GB free disk) — sha-verified pinned download, the
  two clips at stride 10, sliding view windows, unscored-structural
  metrics (pose sanity, cross-view depth consistency, determinism, live
  schema capture), latency/RSS conventions.
- `schema_introspect.py` — EXECUTED: the source-verified output schema
  (fail-closed construction-site checks against the pinned code).
- `contract_compatibility.ts` — EXECUTED (exit 0): the needle-verified
  field-level compatibility verdict.
- `record-benchmark.ts` — EXECUTED (exit 0): the fail-closed validator
  (provenance echo verbatim, candidate gating state, executed-refusal
  pinning, NO-fabricated-numbers checks, resolving evidence pointers,
  honest caveats).
- `benchmark-record.json` — the ledger-shaped HF004 record.
- `results/*.json` — the executed evidence (preflight refusal, download
  probe, source-verified schema, compatibility verdict).

## Guard batteries (this flight's evidence ran around them)

- `packages/testing/test/hf-ledger.test.ts` — 8/8 green (the provenance
  ledger pin — untouched by this flight).
- `packages/perception-benchmark/test/harness.test.ts` — the L010 harness
  battery, green (the fixture/frame-sampling conventions this flight's
  ready-to-run path follows).
- FROZEN contracts, `provenance-ledger.json`, architecture-lock: untouched
  (verified by `git status` at commit time).

## Limitations

- The benchmark did not run: zero executed quality/latency/memory
  evidence exists in this flight (the typed refusal is the honest record).
- Even on adequate hardware, no geometry ground truth is reachable in this
  sandbox — quality evidence would be unscored-structural only.
- The schema review is a SOURCE-SCAN of the pinned code, not an
  import-executed introspection (torch + the model are the infeasibility);
  every field is construction-site-verified, fail-closed.
- The metric-scale claim and the model's world-gauge alignment to the
  Sporta pitch frame are both unverified by any executed evidence.

## Promotion-gate referral

The MapAnything candidate remains `candidate`. Observed blockers for
HF015: (1) zero executed benchmark evidence of any kind on this host (the
typed refusal — the HF003 precedent of executed-but-domain-mismatched
evidence is NOT met); (2) no geometry ground truth reachable even on
adequate hardware (unscored-structural ceiling); (3) datasetProvenance
`unknown` (the HF015 license review has not happened); (4) the metric
claim unverified. The TL decides at the HF015 gate; this evidence
recommends nothing.
