# HF010 — the camera-controlled neural renderer benchmark evidence (flight 7, the renderer-wave opener)

**Verdict: ALL THREE candidates REFUSED `resource-infeasible-host` (the EXECUTED preflight, exit 3) + the SUBSTANTIAL partial delivered — the authored camera-path fixtures, the license-posture verdicts, the five metric designs (implemented, self-checked 14/14), and the machine-checked contract mappings. No model ran. No promotion.**

## The three candidates (provenance-ledger rows echoed VERBATIM in benchmark-record.json)

| Candidate | Repo @ revision | License posture (recorded terms) | The refusal arithmetic (this host: 3.95 GiB RAM, 1.05 GiB free disk, 2 vCPU, no GPU) |
| --- | --- | --- | --- |
| Wan2.2-Fun-Control-Camera | alibaba-pai/Wan2.2-Fun-A14B-Control-Camera @ da1f119dcf56 | apache-2.0 / apache-2.0, commercial yes — **production-eligible-by-recorded-terms** (datasetProvenance unknown is the open edge) | repo tree 71.06 GB = **63x free disk**; dual-expert A14B + T5 + VAE working set ≈ 71 GB ≈ **17x TOTAL RAM** |
| ReCamMaster | KlingTeam/ReCamMaster-Wan2.1 @ 4f3f7391 | apache-2.0 model / mit code, commercial yes — **production-eligible-by-recorded-terms** (the paper's internal T2V is not open; the open ckpt is a Wan2.1 migration the repo itself says may underperform) | even the smallest documented composition (Wan2.1-T2V-1.3B 17.574 GB + ckpt 2.981 GB ≈ 20.56 GB) = **~19x free disk**; benchmark-grade 14B ≈ 85 GB = ~79x |
| Meridian | Viggle/Meridian @ 9c57d46f | minimax-h3-community-license (covers the weights AND their outputs) + code apache-2.0 + VGGT-Omega **FAIR Noncommercial** — **research-only / watchlist** (two independent recorded blockers) | composition ≈ 82.04 GB (H3 transformer+vae 76.70 GB + adapters 5.33 GB) = **~76x free disk**; card-reported runtime peak ~88 GiB = **~22x TOTAL RAM**; **CUDA required by its own doc**; the VGGT-Omega dependency is HF-**gated (manual)** — anonymous weight access is 401 (bounded HEAD probe, zero body bytes) |

All three candidate repos are **anonymously reachable** (gated=False) — the auth wall is only Meridian's VGGT-Omega dependency, exactly as the brief predicted (the HF009 auth-gate convention: gate type `manual`, recorded as a fact, never faked, never bypassed).

## The partial (the real value — the HF014 runway)

1. **THE AUTHORED CAMERA-PATH FIXTURES** — `fixtures/hf010-camera-paths.json` (`hf010.camera-paths@1`): the "common benchmark with authored camera paths": 6 deterministic camera-intent windows × 81 poses (dolly-in / orbit / pan / crane / an adversarial pure optical zoom / **bullet time as the CameraPlan's own review kind**), anchored to the canonical W601 slots, in the CameraPlan directed-window language (live/review + window + cameraSlotId), exported **provider-neutral** (per-frame `tMs/eye/look/focalMultiplier/sourceFrame`). Pure parametric math — no RNG, no solver; byte-identical regeneration proven; sha256-pinned (`66ef1b4a…`); the selfcheck re-verifies. Any adequate host feeds all three candidates this ONE identical input set.
2. **THE LICENSE-POSTURE VERDICTS** (first-class acceptance criterion) — `results/license-posture.json`: argued from the recorded terms only, verbatim citations, never legal advice, never a promotion.
3. **THE FIVE METRIC DESIGNS** — implemented in `benchmark_renderer.py`, typed not-measured, exact definitions in the module docstring: camera adherence (PnP-estimated poses vs the authored path: endpoint translation m / endpoint+mean angular deg / corner-reprojection px / lens focal %), player/ball identity (pair-frame identity stability + ball presence recall vs the SWM entity ids), temporal consistency (8×8-mean-filter SSIM + flow warp residual), hallucinated-region rate (vs the geometry-projected visible set, the Meridian grey-reference convention as the contrast signal), cost/latency (wall-clock per second of output + GPU peak honestly N/A-typed + cold-start download bytes). **Self-check 14/14** (12 hand-computed metric cases + 2 fixture-determinism checks) — implementation evidence, NOT a model measurement.
4. **THE CONTRACT MAPPING** — `contract_compatibility.ts` → `results/contract-compatibility.json`: 15 task-profile INPUT rows + 9 OUTPUT rows + the 3-row camera-path-conditioning table (the HF014 design surface) + the 3-row rights table + the profile verdict, machine-checked against 9 repo authorities (the FROZEN task profile, the CameraPlan/slot language, the renderer-3d identity/camera/render seams, the rights-provenance contract, the fixture vocabulary).

**Profile verdict (PARTIAL):** no candidate maps the full frozen `renderer.cinematicReCamera` profile. Camera-path conditioning: **Meridian maps** (the keyframe path IS the profile's camera path; the geometry stage internalizes geometry/depth guidance) > **Wan2.2-Fun maps-with-adapter** (the CameraCtrl lens-parameter seam) > **ReCamMaster partial** (preset-indexed `--cam_type 1..10`, not authored paths). Renderer telemetry + geometry/SWM consistency metadata: **does-not-map or partial for ALL three** — both outputs are the benchmark's external measurements, never model claims.

## The gates this evidence stands on

- `--mode preflight` EXECUTED (exit 3, the typed refusal; bounded probes only — weights never downloaded, never committed, never vendored)
- `--mode author-fixtures` EXECUTED (byte-identical regeneration proven: sha256 `66ef1b4a…` twice)
- `--mode selfcheck` EXECUTED (14/14; fixture sha pinned + recomputation byte-identical + canonical-slot vocabulary)
- `--mode full` NEGATIVE-TESTED on THIS host (fail-closed exit 3: RAM/disk/CUDA blockers printed)
- `bun contract_compatibility.ts` exit 0 (9 authorities, all needles present)
- `bun record-benchmark.ts` exit 0 (ALL THREE ledger rows echoed verbatim; no promotion; no fabricated numbers) + **negative-tested**: a fabricated `cameraEndpointAngularErrorDeg`/`meanConsecutiveSsim` injected → exit 1 refused → restored → exit 0

## Promotion gate: UNCHANGED (candidate)

The benchmark recommends NOTHING production. HF015 (the TL's gate) owns every adjudication; the recorded blockers: no run anywhere yet, the unconsumed-fixture fact, Meridian's license terms (independent of resources), and the telemetry trust rule (external measurement only). See `benchmark-record.json` → `promotionGate`.

**Never legal advice. No promotion. All weights undownloaded.**
