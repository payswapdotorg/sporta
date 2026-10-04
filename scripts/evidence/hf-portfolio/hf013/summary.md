# HF013 — the LTX-2.3 joint audio-video benchmark evidence (flight 10, worker 65-d)

**Verdict: TYPED REFUSAL (resource-infeasible-host) + the substantial partial** — the license
documentation FIRST-CLASS (the acceptance's own words), the evidence-chain exclusion
machine-checked, the three-profile metric designs implemented + self-checked, the upscaling
comparison vs the repo's own output pipeline, the contract mapping machine-checked. No promotion
(gatingState stays `candidate`; HF015 owns adjudication).

## The candidate (the ledger row echoed VERBATIM in benchmark-record.json)

`LTX-2.3` = Lightricks/LTX-2.3 @ `3c6a4e66e5d0a684231950b9c74dd4ded7b6fadc` — modelLicense
`other (ltx-2-community-license-agreement — per card license_link to Lightricks/LTX-2 LICENSE-2)`;
codeLicense `unknown`; commercialUse `unclear`; datasetProvenance `unknown`; DiT-based audio-video
foundation model; checkpoint family `ltx-2.3-22b` (dev, distilled, distilled-LoRA) plus
spatial/temporal upscalers, per card.

## The executed preflight (bounded probes ONLY — weights never downloaded)

- The pinned revision verified: the live resolve returns the ledger's own sha
  (`3c6a4e66…`; HEAD is the same sha — no drift). `gated=False`; the anonymous 1-byte
  Range probe on the 42.980 GiB dev checkpoint returned 206 — **NO auth wall** (the contrast with
  HF010's Meridian/VGGT-Omega manual gate).
- The pinned tree: 12 files, **145.295 GiB** (three 42.980 GiB 22B transformers; two 7.083 GiB
  distilled LoRAs; 1.015 + 0.927 GiB spatial upscalers; 0.244 GiB temporal upscaler; LICENSE +
  README + png). The repo carries ONLY the transformers + latent upscalers — NO text encoder, NO
  VAEs, NO tokenizer: the documented loading recipe (the card → the LTX-2 codebase →
  ltx-pipelines, fetched bounded and sha-pinned) takes the Gemma text encoder (~55.6 GiB, 12
  shards), the video VAE (2.277 GiB), the audio VAE (0.099 GiB), the vocoder, and the tokenizer
  from the Lightricks/LTX-2 component tree (probed metadata-only; ungated).
- The refusal arithmetic (host: 3.95 GiB RAM / ~1.04 GiB free disk / 2 vCPU / no GPU): the whole
  tree = **140.1x free disk**; the minimal single-checkpoint composition = **~98.9 GiB = 95.4x**;
  the bf16 transformer+encoder working set = **96.2 GiB = 24.4x TOTAL RAM**; the documented recipe
  is GPU-first (CUDA > 12.7, PyTorch ~2.7 — no CPU-only path); 2-vCPU latency infeasibility; even
  the 0.244 GiB temporal upscaler is a LATENT-space stage with no standalone runnable path.
  **Exit 3 EXECUTED** (`--mode preflight`).

## THE LICENSE POSTURE (first-class — "document community-license/commercial-use constraints")

The three sources of the ledger row's own URLs distinguished, fetched bounded as TEXT documents
(never weights), sha-verified byte-identical against the committed research-phase fetches:

| document | what it is | role |
| --- | --- | --- |
| `LICENSE` (537 B) | the switchboard index | dates + applies the two agreements: "LTX-2 … including LTX-2.3 **until August 11, 2026**"; "LTX-2.x … all LTX-2.5 versions released since August 11, 2026, and all future releases of LTX-2.x under this license" |
| `LICENSE-2` (19 197 B) | the **LTX-2 Community License Agreement** (Jan 5 2026) | what the card YAML `license_link` + the ledger row name; what the HF repo's own LICENSE file (fetched at the PINNED revision, 21 399 B, agreement-identical) carries |
| `LICENSE-2_x` (30 399 B) | the **LTX-2.x Community License Agreement** (Aug 11 2026) | what the card's PROSE license link names ("You can use the models … for purposes under the [license](LICENSE-2_x)") |

The shared substance (verbatim citations in `results/license-posture.json`): entities with annual
revenues ≥ $10,000,000 ("Commercial Entities") must obtain a paid Commercial Use Agreement
(commercial use otherwise "strictly prohibited and … deemed a material breach"; LICENSE-2 adds
liquidated damages at double fees; LICENSE-2_x §2.2 adds a Non-Commercial Purpose carve-out for
Commercial Entities — testing/evaluation/non-commercial R&D); sub-threshold entities get the
community license "for any purpose, subject to the restrictions set forth in Attachment A"
(impersonation/deepfake, PII, discrimination, malware, military, competing-model training, and
competition-with-Licensor restrictions). The **governing agreement for THIS pinned snapshot is an
OPEN EDGE**: the card's own sources point at BOTH agreements and the snapshot's lastModified
(2026-10-02) post-dates the index's August 11 switch date. `codeLicense unknown` CONFIRMED by a
bounded GitHub API probe (NOASSERTION — the repo root carries only the model community-license
documents); `datasetProvenance unknown` stands. **Verdict: research-grade /
watchlist-pending-terms** — argued from recorded terms only; never legal advice.

## THE EVIDENCE-CHAIN EXCLUSION (the load-bearing verdict)

**Generated commentary audio can NEVER be evidence-chain audio.** HF007 ruled free-form generated
text not compatible with the observation evidence chain; HF008 reversed it ONLY for
transcription-of-observed-audio (W207: modality `audio`, provenance `OBSERVED`, payload kind
`transcription`, text verbatim; W208 derives over it). LTX-2.3's joint audio-video generation
inherits the boundary. Machine-checked in `benchmark_ltx23.py`
(`generated_audio_evidence_exclusion`, self-checked in FOUR directions: the generated-audio plan
REFUSED with the violation named; the W207 shape ACCEPTED; the W208 shape ACCEPTED; unknown
shapes REFUSED fail-closed — the ProvenanceKind vocabulary has no GENERATED member by design).
Generated audio remains a MEASURAND or a rights-gated render product (`derivativeGeneration`
explicitly allowed by a currently-valid AuthorizationPolicy) — never evidence.

## The three-profile metric designs (implemented, typed not-measured, 31/31 self-check)

- **renderer.audioVideoGeneration**: `av_onset_sync_error_ms`, `av_cross_correlation_peak_lag_ms`
  (audio↔video sync), `commentary_wer` (adherence to the conditioning commentary text — NEVER
  evidence), `audio_hallucination_rate` (the audio counterpart of hf010's video metric) + the
  video hallucination metric IMPORTED from hf010.
- **renderer.neuralVideo**: the HF010-shared vocabulary (temporal SSIM / flow residual /
  hallucinated-region rate / identity stability / cost — IMPORTED, never re-implemented) +
  `reference_frame_fidelity` for the i2v surface; camera-path adherence honestly typed
  **N/A — no camera conditioning surface**.
- **renderer.upscale** — THE NO-LYING constraint: `roundtrip_fidelity` (upscaled→back-to-source
  geometry vs the SOURCE), `no_invented_content_rate` (tolerance pinned to the bilinear control),
  `detail_preservation_gain` (reported separately so sharpness can never masquerade as
  faithfulness), `temporal_upscale_motion_coherence`, `artifact_block_boundary_rate`.

## The upscaling comparison vs the repo's own pipeline (STATIC + design)

The repo today: the closed four-reality MP4 pipeline (RealityKind original | tactical |
three-d-game | anime-npr; avc1.42E01E/mp4a.40.2), fixed OutputProfiles (640x360/1280x720 at
12/12.5/25 fps), the R102 normalization chain (canonical encoding — normalize, never enhance),
the frozen-argv deterministic encoding, the 1 000 000-byte hosted budget, and **NO upscaling
stage anywhere**. LTX-2.3 would add latent-space x1.5/x2 spatial + x2 temporal upscaling inside
its own multiscale pipeline — the honest mapping for existing repo artifacts is the two-stage
generation-conditioned-on-the-source design, policed by the no-lying metrics. The 8-axis
capability-delta table + the adequate-host comparison design (the repo's OWN authorized output
artifacts as source inputs — never new content; three lanes: repo-HD / LTX-conditioned / bilinear
control) are in `results/upscaling-pipeline-comparison.json`.

## Gates (all executed by this worker)

- `--mode preflight` EXECUTED → **exit 3** (the typed refusal, bounded probes only).
- `--mode selfcheck` EXECUTED → **31/31 cases, exit 0** (labeled implementation evidence, NOT a
  model measurement).
- `--mode full` NEGATIVE-TESTED → **exit 3 fail-closed** on this host (below the 64 GiB RAM /
  256 GiB disk / CUDA floor; no download attempted; verified without pipe-masking).
- `bun scripts/evidence/hf-portfolio/hf013/record-benchmark.ts` → **exit 0** + NEGATIVE-TESTED
  (a fabricated `avOnsetSyncErrorMs` injected into the quality block → exit 1 refused with the
  key/value named → restored → exit 0).
- `bun scripts/evidence/hf-portfolio/hf013/contract_compatibility.ts` → **exit 0** (9 authorities
  needle-checked; the ProvenanceKind vocabulary carries NO GENERATED member — the exclusion is
  vocabulary-enforced).
- `bunx prettier --check .` clean; eslint clean on both new TS files; no FROZEN-contract edits
  (technology-task-profiles.md, provenance-ledger.json, the hf010/hf011/hf012 trees — the only
  fetches-tree changes are NEW files: the HF LICENSE at the pinned revision + the ltx-pipelines
  README with fetch-metas).

## The evidence tree

```
scripts/evidence/hf-portfolio/hf013/
  benchmark_ltx23.py            # preflight / selfcheck / full (the metric designs + the exclusion)
  contract_compatibility.ts     # the machine-checked mapping (9 authorities)
  record-benchmark.ts           # the fail-closed record validator (negative-tested)
  benchmark-record.json         # the ledger row VERBATIM + the refusal + the partial record
  summary.md                    # this file
  results/
    preflight-refusal.json      # the EXECUTED typed refusal (exit 3)
    load-analysis.json          # per-member composition + host-gap arithmetic
    license-posture.json        # FIRST-CLASS: the three sources + the HF LICENSE + the open edges
    model-io-surface.json       # the documented I/O surface (+ the card's limitations verbatim)
    metric-selfcheck.json       # 31/31 hand-computed cases + the exclusion proof
    upscaling-pipeline-comparison.json  # the 8-axis static delta + the adequate-host design
    contract-compatibility.json # the emitted mapping (input/output/evidence-chain/rights/seam/metrics)
```

Venv: `/home/z/hf-bench-10` (lean: huggingface_hub 2.1.1 ONLY; torch NOT installed by design).
Re-run note: the preflight regenerates live host stats (availableRam/freeDisk bytes) — the
committed bytes are this executing worker's canonical evidence (the hf010/hf011/hf012 precedent).
