# HF002 Research Notes — Technology Provenance Ledger

Worker: 62-d (HF002 flight). Date: 2026-10-03.
Companion to `docs/contracts/technology-provenance-ledger.md` and
`provenance-ledger.json`. The ledger is strictly schema'd; everything material that
did not fit the schema lives here, each entry with the source URL it was read from.

## Methodology notes (measured, this flight)

- Every ledger field was read from a live fetch on 2026-10-03 (~01:39–01:40 UTC);
  raw snapshots are under `fetches/`, produced by `fetch-provenance.sh` (re-runnable,
  no authentication). `revision` values are the `sha` returned by the Hugging Face
  model API at fetch time.
- Gated repositories (`facebook/sam3`, `pyannote/speaker-diarization-community-1`)
  return HTTP 401 on `/raw/` but serve README.md and LICENSE through `/resolve/` —
  the harness falls back automatically. Weight files were never fetched.
- The GitHub REST API was rate-limited from this host, so code licenses were read
  from `raw.githubusercontent.com` license files directly (measured fetches, saved
  under `fetches/github/`).
- Org aliasing was observed and resolved to canonical URLs: HF reports the
  ReCamMaster checkpoint's canonical id as `KlingTeam/ReCamMaster-Wan2.1` (the
  `KwaiVGI/...` path redirects); GitHub serves the same ReCamMaster content under
  `KwaiVGI/ReCamMaster` and `KlingAIResearch/ReCamMaster` (the portfolio research
  input cites the latter).
- `commercialUse` derivation policy (applied consistently): permissive SPDX
  licenses (apache-2.0, mit, cc-by-4.0) ⇒ `yes`; explicitly non-commercial
  licenses (cc-by-nc-4.0, FAIR-NC) ⇒ `no`; custom/community licenses with
  conditional or ambiguous commercial terms ⇒ `unclear`, with the conditions
  spelled out below.

## Per-candidate nuance

### RF-DETR (HF003)

Community fine-tune by an individual (`julianzu9612`), not an official Roboflow
release: the card's citation block still contains the placeholder
`https://huggingface.co/YOUR-USERNAME/rf-detr-soccernet` and credits the generic
"Computer Vision Research Team". The card's usage depends on Roboflow's `rfdetr`
pip package (github.com/roboflow/rf-detr), whose license was NOT verified this
flight — the row's `codeLicense` is therefore `unknown`, not inferred from the
package. All metrics (85.7 mAP@50 etc.) are model-card claims, which HF003's
acceptance already requires Sporta to re-measure.
Source: https://huggingface.co/julianzu9612/RFDETR-Soccernet/raw/main/README.md

### MapAnything (HF004)

License split across checkpoints: the default `facebook/map-anything` is CC-BY-NC
4.0 while the ledger's `facebook/map-anything-apache` is Apache-2.0; the GitHub
README states the two differ in "training data composition and resulting license
terms" and directs commercial users to the apache variant. The card defers to the
GitHub repo and cites the 3DV 2026 paper; neither the card nor the repo README
names the training datasets (the paper is the reference). The row intentionally
records the apache variant — benchmarks must pin that exact checkpoint id.
Sources: https://raw.githubusercontent.com/facebookresearch/map-anything/main/README.md ,
https://huggingface.co/facebook/map-anything-apache/raw/main/README.md

### SAM3 (HF005)

Gated repository (manual approval) that collects personal data before granting
access (first/last name, date of birth, country, affiliation, job title, IP
location) under the Meta Privacy Policy. The SAM License text contains NO
non-commercial clause — it grants a broad, worldwide, royalty-free license to use,
reproduce, distribute, modify and create derivative works — but §8 lets Meta
modify the agreement unilaterally and effectively immediately, and redistribution
must occur under the same agreement; that combination is why `commercialUse` is
recorded `unclear` rather than `yes`, pending the explicit license review HF005's
acceptance mandates. The card introduces the SA-CO benchmark (270K unique
concepts, "75-80% of human performance") — an eval benchmark, not training data.
Sources: https://huggingface.co/facebook/sam3/resolve/main/LICENSE ,
https://huggingface.co/facebook/sam3/resolve/main/README.md

### Spivak (HF006)

Clean model/code license split, stated on both sides: the HF card carries an
explicit copyright section ("contents of this repository are (c) by Yahoo Inc"
under CC-BY-4.0) while the linked code repo `yahoo/spivak` is Apache-2.0. The
card sets `inference: false` (no hosted inference) and its provenance trail is
the two cited arXiv papers (2205.10450, 2206.07846) plus the SoccerNet 2022
Challenge results paper. No conflicts found.
Sources: https://huggingface.co/yahoo-inc/spivak-action-spotting-soccernet/raw/main/README.md ,
https://raw.githubusercontent.com/yahoo/spivak/master/LICENSE

### SoccerChat (HF007)

The model and its code are Apache-2.0, but the TRAINING DATASET's video content
is SoccerNet broadcast footage under the SoccerNet NDA: the dataset card states
the ≤10s video clips "are not MIT licensed and remain subject to the SoccerNet
NDA. Redistribution or commercial use is not permitted" (annotations/metadata are
MIT; dataset access is gated). This is precisely ADR-011 constraint 2 — model vs
dataset licensing recorded separately — so the row's `commercialUse: yes` stands
on the model's own licenses, and dataset-terms obligations are a separate review
item before any production promotion. Second nuance: the code repo
`simula/SoccerChat` declares Apache-2.0 via README badge/section but ships no
standalone LICENSE file at its main branch.
Sources: https://huggingface.co/datasets/SimulaMet/SoccerChat/resolve/main/README.md ,
https://raw.githubusercontent.com/simula/SoccerChat/main/README.md

### VibeVoice-ASR-Streaming (HF008)

The card states no training data whatsoever, so both provenance fields are honest
`unknown`s; the linked technical report (arXiv 2609.02812, linked from the card)
is where training details would live and was not fetched/verified this flight.
Minor card defect: the code badge link text reads "icrosoft/VibeVoice" (truncated
"Microsoft") but resolves to github.com/microsoft/VibeVoice (MIT, verified).
Card claims 10-language support with speaker attribution and customized hotwords.
Source: https://huggingface.co/microsoft/VibeVoice-ASR-Streaming-1.5B/raw/main/README.md

### Qwen3-ASR (HF008)

The card claims "streaming / offline unified inference with single model" for the
1.7B/0.6B family, so the row's multilingual-primary profile mapping (per the
portfolio research input) understates its streaming capability — HF008's
benchmark should exercise Qwen3-ASR on BOTH ASR profiles rather than assuming
VibeVoice owns streaming. No training datasets are named on the card; the
weights-provenance statement (Qwen3-Omni foundation + large-scale speech data) is
the card's entirety on origin. A Qwen3-ForcedAligner-0.6B companion model
(timestamps, 11 languages) is described on the same card and may be relevant to
commentary/transcript alignment later.
Source: https://huggingface.co/Qwen/Qwen3-ASR-1.7B/raw/main/README.md

### pyannote (HF009)

The work-items doc names no candidate for HF009; the row records
`pyannote/speaker-diarization-community-1` because the portfolio status doc
(docs/status/hf-model-portfolio-status.md) and the portfolio research input pin
it — flagged here so the TL can drop the row if they prefer an empty HF009
section. The card markets a commercial sibling (`precision-2`, pyannoteAI cloud)
and compares `community-1` (CC-BY-4.0) against legacy `speaker-diarization-3.1`
(MIT per that repo's own page — NOT re-verified this flight); the gated prompt
promises the community pipeline "will always remain freely accessible". Training
corpora are not named on the card; the twelve eval benchmarks are recorded in the
row's datasetProvenance.
Source: https://huggingface.co/pyannote/speaker-diarization-community-1/resolve/main/README.md

### Wan2.2-Fun-Control-Camera (HF010)

The card is bilingual (Chinese primary) with the camera variant described as
"Wan2.2-Fun-14B 相机镜头控制权重" (camera-lens-control weights), trained at 81
frames / 16 fps across 512/768/1024 resolutions; the card's license section
(许可证) points at the Apache License 2.0 text, matching the frontmatter and the
VideoX-Fun code repo. The base model Wan-AI/Wan2.2-I2V-A14B is itself
Apache-2.0, so the composite is permissive end-to-end. No training datasets are
named anywhere on the card. The card also references CameraCtrl
(hehao13/CameraCtrl) among the technique credits — a code-level lineage note,
not a weights dependency.
Source: https://huggingface.co/alibaba-pai/Wan2.2-Fun-A14B-Control-Camera/raw/main/README.md

### ReCamMaster (HF010)

The open checkpoint is a Wan2.1 MIGRATION, not the paper's model: "Due to company
policy restrictions, we are unable to open-source the model used in the paper...
Consequently, we migrated ReCamMaster to Wan2.1" — the README explicitly warns
the open version "may not achieve the same performance as the model in our
paper", so HF010 benchmarks measure the open checkpoint, not the ICCV'25 oral
results. URL aliasing: the portfolio research input cites
github.com/KlingAIResearch/ReCamMaster; GitHub serves identical content from
github.com/KwaiVGI/ReCamMaster (README self-references), and the HF checkpoint's
canonical id is KlingTeam/ReCamMaster-Wan2.1 — the ledger records the canonical
KlingTeam URL. Checkpoint Apache-2.0 + code MIT is a clean composite.
Sources: https://raw.githubusercontent.com/KwaiVGI/ReCamMaster/main/README.md ,
https://huggingface.co/api/models/KlingTeam/ReCamMaster-Wan2.1

### Meridian (HF010)

Three-layer license stack, stated on the card itself: (1) adapter weights AND
their outputs are governed by the MiniMax H3 Community License Agreement, whose
grant is limited to the "Applicable Territory" — worldwide EXCLUDING the European
Union, the United Kingdom, the Republic of Korea and the United States (§I.3,
I.5, V.4); commercial products must display "MiniMax H3" (§IV.2) and entities
above US$20M yearly revenue need MiniMax authorization (§IV.1). (2) Code is
Apache-2.0 (LICENSE-CODE in the repo). (3) The REQUIRED geometry model,
VGGT-Omega, is gated and licensed FAIR Noncommercial Research License v1 — the
card warns "the code license does not cover the weights or remove VGGT-Omega's
noncommercial restrictions", so the as-shipped pipeline is non-commercial
regardless of territory. `commercialUse: unclear` records the
territory-conditional weights; the VGGT-Omega dependency makes any deployment of
the full pipeline non-commercial until a replacement geometry stage exists.
Sources: https://huggingface.co/Viggle/Meridian/resolve/main/LICENSE ,
https://huggingface.co/Viggle/Meridian/raw/main/README.md ,
https://raw.githubusercontent.com/facebookresearch/vggt-omega/main/LICENSE

### ViewCrafter (HF011)

The HF card is minimal (license + two sentences), so provenance depth lives in
the GitHub repo: the pipeline downloads a pretrained DUSt3R model as a dependency
whose license was NOT verified this flight — an open dependency-provenance gap to
close before HF011 benchmarks. Two checkpoints exist: `ViewCrafter_25`
(single-view) and `ViewCrafter_25_sparse` (sparse-view; "performs better than
ViewCrafter_25" on that task per README) — HF011's "single/sparse-view" scope
should pin which checkpoint is benched. Code repo is Apache-2.0, matching the
checkpoint card.
Source: https://raw.githubusercontent.com/Drexubery/ViewCrafter/main/README.md

### Wan2.2-Animate (HF012)

The card reuses the Wan2.2 family README, whose training-data statements are
aggregate marketing only ("+65.6% more images, +83.2% more videos" vs Wan2.1) —
no dataset is named, hence `datasetProvenance: unknown`. The release note dates
Wan2.2-Animate-14B to Sep 19, 2025 and describes it as a unified character
animation AND replacement model. Practical warning for HF012: the card says
LoRAs trained on base `Wan2.2` are NOT recommended with Wan-Animate ("weight
changes during training may lead to unexpected behavior") — benchmark harnesses
must not assume base-model LoRA compatibility.
Source: https://huggingface.co/Wan-AI/Wan2.2-Animate-14B/raw/main/README.md

### LTX-2.3 (HF013)

Dual-agreement ambiguity, measured on the live repo: the top-level LICENSE is an
index pointing at LICENSE-2 ("LTX-2 Community License Agreement", dated
2026-01-05, "applicable to all LTX-2 versions released since January 5, 2026,
including LTX-2.3 until August 11, 2026") and LICENSE-2_x ("LTX-2.x Community
License Agreement", dated 2026-08-11, "applicable to all LTX-2.5 versions
released since August 11, 2026, and all future releases of LTX-2.x"). The HF
card's frontmatter cites LICENSE-2 while its "Direct use license" section links
LICENSE-2_x — as of this fetch (2026-10-03, after the 2026-08-11 cutover) which
agreement governs a fresh LTX-2.3 download is genuinely ambiguous, reinforcing
`commercialUse: unclear`. LICENSE-2's commercial clause: entities with annual
revenues ≥ US$10M must obtain a paid Commercial Use Agreement, with liquidated
damages of double the owed fees for unauthorized use. The repo root contains no
permissive code license file (only the community agreements), so `codeLicense`
is `unknown` — note the predecessor LTX-Video repo was Apache-2.0, which must
NOT be inferred onto LTX-2.
Sources: https://raw.githubusercontent.com/Lightricks/LTX-2/main/LICENSE ,
https://raw.githubusercontent.com/Lightricks/LTX-2/main/LICENSE-2 ,
https://raw.githubusercontent.com/Lightricks/LTX-2/main/LICENSE-2_x

### DA3-GIANT (watchlist)

Explicitly non-commercial twice over: CC-BY-NC 4.0 on the card frontmatter AND a
prominent "⚠️ Non-commercial use only" warning in the body, while the CODE repo
(ByteDance-Seed/depth-anything-3) is Apache-2.0 — the weights are the restrictive
half of the pair. The card's arXiv link is a placeholder (empty
`https://arxiv.org/abs/`), so the paper reference resolves only through the
project page. Training data is described only as "public academic datasets
only". Per ADR-011 constraint 9 this candidate can never silently become a
production dependency; it stays `watchlist` unless ByteDance's terms change.
Source: https://huggingface.co/depth-anything/DA3-GIANT/raw/main/README.md

## Honest-gap histogram (per ledger row)

| candidate | unknown fields |
|---|---|
| RF-DETR | codeLicense |
| MapAnything | datasetProvenance |
| SAM3 | — |
| Spivak | — |
| SoccerChat | — |
| VibeVoice-ASR-Streaming | weightsProvenance, datasetProvenance |
| Qwen3-ASR | datasetProvenance |
| pyannote | — |
| Wan2.2-Fun-Control-Camera | datasetProvenance |
| ReCamMaster | — |
| Meridian | datasetProvenance |
| ViewCrafter | datasetProvenance |
| Wan2.2-Animate | datasetProvenance |
| LTX-2.3 | codeLicense, datasetProvenance |
| DA3-GIANT | — |

Totals: weightsProvenance 1, datasetProvenance 8, codeLicense 2, all other
categories 0. The dominant gap is dataset provenance — model cards across the
industry simply do not name training corpora; where the surrounding material
does (SoccerChat's dataset card, ReCamMaster's released dataset), it is recorded
in the row or here.
