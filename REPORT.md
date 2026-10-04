# Sporta — Worker 65-b Delivery Report (HF011)

Branch: `work/hf011-viewcrafter-benchmark` (from main @ 19a09f0)
Work item: HF011 — Novel-view baseline benchmark (flight 8, Worker C's renderer wave)
Evidence tree: `scripts/evidence/hf-portfolio/hf011/` (committed in-repo)
Run record: `scripts/evidence/hf-portfolio/hf011/benchmark-record.json` (validated fail-closed by `record-benchmark.ts`, exit 0 + negative-tested)
Manifest: 1 python benchmark (`benchmark_novelview.py` — preflight/selfcheck/full), 2 TS validators (`contract_compatibility.ts`, `record-benchmark.ts`), `benchmark-record.json`, `summary.md`, `fixtures/` (none authored — the HF010 fixture set is CONSUMED, sha-pinned), 8 results JSONs. The lean venv `/home/z/hf-bench-8` (uv, python 3.12, huggingface_hub 2.1.1 ONLY) lives OUTSIDE the repo; weights were NEVER downloaded.

=== HF011 BENCHMARK REPORT ===

## The verdict (the honest shape on this host)

ViewCrafter's compute leg REFUSED — typed refusal `resource-infeasible-host`, the EXECUTED preflight (exit 3; `results/preflight-refusal.json`; bounded probes ONLY — HF API file-tree metadata, the 290-byte card, the candidate's own GitHub docs, a zero-body DUSt3R HEAD; weights never downloaded, never committed, never vendored). The delivery is the HF004/HF007/HF008/HF009/HF010 convention: the refusal + the SUBSTANTIAL partial — THE same-fixture comparison design (the acceptance's core), the metric + adapter implementations (self-checked 23/23), the fixtures-consumption report, the load analysis, the license posture, the machine-checked conditioning-class contract mapping. NO model ran; NO quality/latency/memory number exists in this flight; every metric-shaped value is a design, a hand-computed self-check case, a card-reported figure labeled as such, or a refusal.

## The candidate (the ledger row echoed VERBATIM in the record; gatingState stays `candidate`)

**ViewCrafter** = `Drexubery/ViewCrafter_25` @ `35af104d9781e9ed5cdaddfcfbbdca5835e1c36f` (apache-2.0 / apache-2.0, commercialUse yes; weights: "video diffusion model generating consistent novel views (25 frames) from single/sparse-image conditioning, per card; no further weight origin stated on the card."; datasetProvenance unknown).

**Load analysis** (`results/load-analysis.json`, EXECUTED): the pinned repo is a BARE checkpoint tree — `model.ckpt` 10.44 GB (9.72 GiB, hub-reported with LFS sha256) + the 290-byte card. The LOADING RECIPE (the candidate's own documented surface): the code + docs live in the card's own pointer (`https://github.com/Drexubery/ViewCrafter`); every shipped run script (`run.sh`, `run_sparse.sh`, `run_eval.sh`) REQUIRES the auxiliary pose/geometry model `DUSt3R_ViTLarge_BaseDecoder_512_dpt.pth` (2,285,005,731 B, served from naverlabs — NOT the HF hub; HEAD 200 anonymous, zero body bytes fetched) via `--model_path`; the sparse-view leg additionally pins `Drexubery/ViewCrafter_25_sparse` (`model_sparse.ckpt` 10.44 GB — "specifically trained for the sparse view NVS task and performs better than ViewCrafter_25 on this task"); the pinned runtime stack is torch 1.13.1 + pytorch3d 0.7.5 cu117 on python 3.9.16 (`requirements.txt` + the README setup block, verbatim). **No point-track auxiliary is documented** — DUSt3R (pose/geometry) is the only recorded dependency; the "point-track" vocabulary in the metric design refers to ViewCrafter's own point-cloud-rendering pipeline (DUSt3R points rendered as the diffusion condition), not a second model.

**The resource arithmetic** (host: 3.95 GiB total RAM, ~1.04 GiB free disk, 2 vCPU, no GPU):
- single-view composition **11.85 GiB = 11.4x free disk** (model.ckpt + DUSt3R);
- the sparse-view leg the acceptance names: **21.57 GiB = 20.7x** (adds `model_sparse.ckpt`);
- the repo's OWN model table (verbatim): "ViewCrafter_25|576x1024|25| **23.5GB & 120s** (perframe_ae=True)" on a 40G A100, ddim 50 steps ≈ **5.5x this host's TOTAL RAM** before any DUSt3R/point-cloud/activation memory;
- every shipped inference command pins `--device 'cuda:0'` — a CUDA-class stack; this host has NO CUDA device;
- latency: the reference take is 120 s on a 40G A100; 2 vCPU is orders of magnitude beyond benchmark-grade wall-clock (typed as latency, never as "could never run").

**Reachability**: the pinned repo is `gated: false`, anonymously reachable — **NO auth wall anywhere** (the honest contrast with HF010's Meridian/VGGT-Omega manual gate): the sparse sibling is likewise ungated and the DUSt3R dependency HEADs 200 anonymously. No operator access request is required on any host.

## The license posture (recorded terms only, never legal advice)

apache-2.0 on BOTH sides — the card frontmatter (`license: apache-2.0`) and the GitHub repo LICENSE (the full Apache-2.0 text, 11,357 B fetched + sha-pinned in `load-analysis.json`); the ledger records commercialUse yes. **Production-eligible-by-recorded-terms**, with the recorded open edges: (1) datasetProvenance unknown — the training corpus is not in the recorded terms (an HF015 input, not a license block); (2) the README's own disclaimer (verbatim): "This is an open-source research exploration rather than a commercial product" — a recorded posture note, NOT a license term; (3) the weights' further origin is not stated on the card. This is a benchmark-planning verdict only — NOT a legal determination and NOT a promotion; HF015 owns every adjudication.

## THE same-fixture comparison design (the acceptance's core — `results/comparison-design.json`, typed not-measured)

The acceptance: "compare single/sparse-view novel-view fidelity against HF010 under the same camera-path/geometry fixtures." The SAME fixtures are CONSUMED, never re-authored: `hf010.camera-paths@1` (sha256 `66ef1b4a…`, 6 deterministic windows × 81 provider-neutral poses), sha-verified TWICE (the python preflight's fail-closed exit-2 gate + `contract_compatibility.ts`) — the same-fixture mandate is enforced, not asserted.

**(a) The SOURCE-IMAGE design.** The fixtures are pure parametric camera paths WITHOUT imagery. The honest in-repo answer: the repo's OWN renderer-3d output frames rendered from the fixture windows — per window, the ground-truth sequence G = [g_0..g_80] rendered at the window's 81 authored poses (bun, renderer-3d, the anchor slot's `cameraSlotId` seam, the W603 1280x720 profile). This is the honest provider-neutral source: the synthetic pitch is the repo's own — no broadcast pixels, no rights surface — and it serves THREE roles at once: the ViewCrafter reference image(s) (single-view: **G[0]**, the repo's own convention "We use the first frame as the reference image"; sparse-view: **{G[0], G[24]}**, the maximal-baseline pair matching the repo's own two-view examples), the HF010 lane's source clip, and the novel-view GROUND TRUTH for both lanes (the repo's own `run_eval.sh` convention: first frame = reference, subsequent frames = target novel views). Designed, not executed — rendering G is the adequate host's first driver step.

**(b) The frame-horizon rule.** The fixtures are 81 poses/window; ViewCrafter generates 25 frames; the HF010 lane is 81-frame class. The pinned rule: `resample_pose_indices(81, 25)` = `round(80*i/24)` — endpoint-inclusive, strictly monotone; BOTH lanes are scored at exactly these 25 shared target poses (ViewCrafter generates its 25 frames at them; HF010's 81-frame outputs are evaluated at the same indices, its extra coverage recorded as its own — never silently dropped).

**(c) The metric split.** SHARED (identical implementations — *imported* from hf010's `benchmark_renderer.py`, never re-implemented): camera adherence (PnP-estimated pose per output frame vs the authored path — endpoint translation m, endpoint+mean angular deg, corner-reprojection px, lens focal %), temporal consistency (8×8-mean-filter SSIM + flow warp residual), hallucinated-region rate (vs the geometry-projected visible set), novel-view pixel fidelity vs the ground-truth renders (PSNR + SSIM, in the model-native output space), cost/latency (wall-clock per output second + cold-start bytes; GPU peak N/A-typed here). HF011-SPECIFIC: sparse-view geometric consistency (the depth/point-track reprojection check per ViewCrafter own documented DUSt3R pipeline — ground-truth 3D track points reprojected into each generated view's PnP-estimated camera, mean px residual + point-recovery fraction; reported for the 1-view AND 2-view legs), source-content identity across synthesized views (patch-level SSIM under the estimated correspondence + the pair-frame identity-stability convention), the 1-view-vs-2-view ablation (the conditioning-class measurement the acceptance's "single/sparse" axis names). HF010-side comparators typed: lens control (Wan2.2-Fun's CameraCtrl lens seam vs ViewCrafter's ABSENT lens surface — the fixture's adversarial pure-optical-zoom window is the DESIGNED discriminator: a d_r dolly is not a zoom), source-video dynamics vs static-image conditioning (the bullet-time window is the ALIGNED case for ViewCrafter; the plain-move windows exercise the gap), the 81-vs-25 horizon.

**(d) The head-to-head scoring design.** Per-window side-by-side table (6 rows = the 6 fixture windows), one column group per metric family, per-cell verdicts (win/tie/**N/A-typed** — ViewCrafter's lens column: N/A-no-surface; the hf010 lane's sparse-geometric column: N/A-wrong-conditioning-class — never silent zeros). Fairness rules: same fixtures (sha-enforced), same implementations (the import), same 25 target poses, same resolution adapter (center-crop 405×720 → 576×1024 applied IDENTICALLY to both lanes' references so all pixel metrics live in the same native space). Output: `results/head-to-head.json` + per-window traces — emitted only by `--mode full` on an adequate host, never fabricated. The table is EVIDENCE for HF015, never a promotion.

**The adapter itself is implemented + self-checked**: the fixture's metric eye/look → ViewCrafter's relative spherical grammar (origin := the reference pose's look point — ViewCrafter's own "point cloud corresponding to the center pixel of the reference image"; r₀ := |eye₀−look₀| — the documented center-pixel depth default; d_phi positive = camera right, d_theta = −Δelevation per the doc's "a negative d_theta moves the camera up", d_r the relative fraction matching run.sh's `--d_r -.2`). Every window's ready-to-run `traj_txt` conditioning is emitted in `results/fixtures-consumption.json` with its typed gaps.

## The contract mapping (machine-checkable — `contract_compatibility.ts`, exit 0)

11 needle-checked repo authorities (the FROZEN task profile, the CameraPlan/slot language, the slot-selector policy, CANONICAL_CAMERA_SLOTS, the renderer-3d identity/camera/render seams, the rights-provenance contract, the consumed fixture (sha-pinned), the shared-estimator authority, the HF010 lane's own summary). 5 INPUT rows + 3 OUTPUT rows + the 6-axis CONDITIONING-CLASS COMPARISON + the rights table.

**The key honest question** — does single/sparse-IMAGE novel-view synthesis satisfy "Inputs: source references permitted by rights, SWM snapshot/events, camera path, geometry/depth guidance, output profile"? The source-reference input **maps-with-adapter** (image references ARE source references; rights-clean by construction via the repo's own renderer-3d renders — the same adapter posture as HF010's candidates, whose procedural contrast is `requiresSourceFrames: false`); the camera path **maps-with-adapter** (the relative-spherical grammar with the implemented adapter; lens absent, moving-look approximate); the SWM snapshot/events input **partial** — NO model surface (a fixed prompt is not an SWM) and the static-image class does not consume the SWM's dynamic content at all: the profile's input list is satisfiable end-to-end only via the upstream procedural renderer, with the dynamic-content risk typed (bullet-time-aligned vs plain-move). Geometry/depth guidance **partial** (internalized estimate-only via DUSt3R — no authored external depth seam; which is exactly why the sparse-view geometric consistency is an EXTERNAL measurement). Output profile **maps-with-adapter** (576×1024/25-frame vs the repo's 1280×720 profiles — the resolution adapter + the horizon rule). Outputs: the alternate-view video **maps** (the 25-frame novel-view video IS an alternate-view video); renderer telemetry + geometry/SWM consistency metadata **do-not-map** (external measurements only — the same trust rule as all three HF010 candidates).

**What the gaps mean for HF014's provider-neutral intent**: ViewCrafter's camera grammar is the most provider-neutral *vocabulary* of the renderer wave so far — generic spherical deltas, no vendor camera API, no auth gate anywhere — but it can serve the provider-neutral camera intent only as the novel-view lane for frozen-source (review/bullet-time-class) windows unless the hallucination risk for live windows is adjudicated; the 25-frame horizon and the absent lens control are recorded gaps, never silent zeros.

## The gates this evidence stands on (all EXECUTED)

- `--mode preflight` exit 3 (the fixture sha gate passed FIRST — fail-closed exit 2 on drift; bounded probes only)
- `--mode selfcheck` **23/23** (implementation evidence, NOT a model measurement)
- `--mode full` NEGATIVE-TESTED on THIS host (fail-closed exit 3: RAM 3.95 < 32 GiB, disk 1.04 < 64 GiB, no CUDA)
- `bun contract_compatibility.ts` exit 0
- `bun record-benchmark.ts` exit 0 + **negative-tested** (a fabricated `novelViewPsnrDb` injected into the quality block → exit 1 refused → restored → exit 0)
- `bunx prettier --check .` clean; eslint on both new TS files 0 errors

## The limitations (honest)

- ZERO executed model evidence: no novel-view fidelity number exists — the compute leg is resource-refused on this host (and the HF010 comparison lane is likewise refused: 20–85 GB compositions), so the head-to-head has NO executable leg here. Everything measurement-shaped is a design, a hand-computed self-check case, a card-reported figure explicitly labeled as such, or a refusal.
- The G frames are DESIGNED, not rendered: the renderer-3d render of the fixture windows is the adequate host's first driver step (no frames exist in this flight).
- The spherical adapter is validated against the candidate's own documented sign conventions and run.sh's example values — NOT against a model run.
- The license posture is an engineering reading of the recorded terms only — never legal advice.

## Promotion-gate referral

UNCHANGED — candidate. This benchmark recommends NOTHING production; HF015 (the TL's gate) owns every adjudication. The recorded blockers: zero executed evidence; the adequate-host requirement for BOTH lanes (≥ 32 GiB RAM / ≥ 64 GiB disk + CUDA); datasetProvenance unknown; the sparse-view class's dynamic-content risk (unadjudicated); the lens-control gap (the adversarial pure-zoom window can never be conditioned faithfully on this candidate — the divergence is the measurement, not a defect to hide).

=== END REPORT ===
