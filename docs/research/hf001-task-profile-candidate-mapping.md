# HF001 — Logical Task Profiles → Concrete Candidate Mapping

Status: MAPPED (Wave 1, Worker A — HF001)
Date: 2026-09-21
Related: `docs/contracts/technology-task-profiles.md` (FROZEN — the logical profiles), `docs/technology/hugging-face-candidates.yaml` (the candidate registry; license states verbatim), ADR-011 (the portfolio decision + the three-way license rule), `docs/research/j012-perception-licensing-and-production-path.md` (the J012 three-way analysis pattern), `docs/architecture/technology-plane.md` (registration conventions)

## Purpose

HF001 maps every FROZEN logical task profile onto the concrete candidates
that exist today — the Hugging Face portfolio entries (license/provenance
states carried VERBATIM from `docs/technology/hugging-face-candidates.yaml`)
plus the repo's own in-repo Technology-Plane registrations — and records the
honest gaps (profiles with no candidate yet). No model name enters a domain
contract (ADR-011 constraint 1); this document is the discovery/mapping
record, not a production approval (constraint 3: commercial-use status must
be resolved before production promotion — unresolved states stay unresolved
here, verbatim).

## The three-way license notation (ADR-011)

Every candidate below records CODE / CHECKPOINT / DATASET separately.
"repo" = the repository's own unresolved root license (the shared posture of
all shipped in-repo code). "—" = component absent (pure-code candidates).
HF states are quoted verbatim from the registry yaml.

## Perception profiles

### football.playerDetection

| Candidate | Code | Checkpoint | Dataset | State |
| --- | --- | --- | --- | --- |
| `contrast-context-detector` (in-repo, J012 production path) | repo | — | — | PRODUCTION (default chain head; license-clean by construction) |
| `heuristic-color-detector` (in-repo) | repo | — | — | candidate (weak baseline) |
| `model-backed-detector` (in-repo, Ultralytics YOLOv8n class) | repo | AGPL-3.0 (copyleft, evaluation-only) | COCO terms (unresolved) | candidate (refuses pre-W303; never the production path per the J012 decision) |
| `hf.rfdetr.soccernet` | "apache-2.0" | "apache-2.0" (model card; operator-download permitted, never vendored) | SoccerNet corpus terms (unresolved) | candidate — benchmark-track registered in `@sporta/perception-benchmark` (L010); refuses until the W303/L011 runtime; promotion benchmark-required |

### football.playerSegmentation

| Candidate | Code | Checkpoint | Dataset | State |
| --- | --- | --- | --- | --- |
| `hf.sam3` | "sam-license-gated" | gated | gated | research-watchlist (per the yaml: `promotion: research-watchlist`) — no in-repo registration |

Honest gap: NO license-clean segmentation candidate exists yet. Profile is
unstaffed beyond the watchlist entry.

### football.playerTracking

| Candidate | Code | Checkpoint | Dataset | State |
| --- | --- | --- | --- | --- |
| `greedy-iou-tracker` (in-repo, W204 wrap) | repo | — | — | candidate (baseline) |
| `hungarian-tracker` (in-repo) | repo | — | — | candidate |

No HF candidate registered for this profile (tracking is served by in-repo
deterministic association this wave; identity-continuity benchmarking is the
existing per-family benchmark).

### football.eventSpotting

| Candidate | Code | Checkpoint | Dataset | State |
| --- | --- | --- | --- | --- |
| `hf.spivak.soccernet` | "cc-by-4.0" | cc-by-4.0 | SoccerNet lineage (unresolved) | candidate — `promotion: benchmark-required`; no in-repo registration yet (Wave 2+ benchmark when the runtime seam exists) |

### football.eventReasoning

| Candidate | Code | Checkpoint | Dataset | State |
| --- | --- | --- | --- | --- |
| `hf.soccerchat.qwen2vl` | "apache-2.0" | apache-2.0 (model card) | unresolved lineage | candidate — `promotion: benchmark-required`; GPU-gated (7B VLM); Wave 2+ |

Also in-repo: the commentary-understanding pipeline's candidate events (W209
candidate stream) feed the same profile's input contract; no model
registration.

### football.commentaryASR.streaming

| Candidate | Code | Checkpoint | Dataset | State |
| --- | --- | --- | --- | --- |
| `hf.vibevoice.asr.streaming` | "verify-current-card" | verify-current-card | — | candidate — `promotion: license-and-benchmark-required`; license verification is the blocking item (verbatim state from the yaml) |

### football.commentaryASR.multilingual

| Candidate | Code | Checkpoint | Dataset | State |
| --- | --- | --- | --- | --- |
| `hf.qwen3.asr` | "apache-2.0" | apache-2.0 | lineage unresolved | candidate — `promotion: benchmark-required` |

### football.commentarySpeakerDiarization

| Candidate | Code | Checkpoint | Dataset | State |
| --- | --- | --- | --- | --- |
| `hf.pyannote.community1` | "cc-by-4.0-current-card" | cc-by-4.0 (current card) | — | candidate — `promotion: license-and-benchmark-required` |

## Geometry profiles

### scene.metric3DReconstruction / scene.depth / scene.cameraPose / scene.covisibility

| Candidate | Code | Checkpoint | Dataset | State |
| --- | --- | --- | --- | --- |
| `hf.mapanything.apache` | "apache-2.0" | apache-2.0 | lineage unresolved | candidate — `promotion: benchmark-required`; covers ALL FOUR geometry profiles per the yaml's task list; GPU-gated |
| `hf.da3.giant` | "non-commercial-current-card" | non-commercial | non-commercial | research-watchlist — isolated from production (ADR-011 constraint 9) |

In-repo geometry today: the W203 homography/line-based calibration family
(pitch calibration, not metric 3D) serves the pipeline's current needs;
metric-3D profiles are unstaffed by in-repo candidates.

## Rendering profiles

### renderer.cinematicReCamera

| Candidate | Code | Checkpoint | Dataset | State |
| --- | --- | --- | --- | --- |
| `hf.wan22.fun.control-camera` | "apache-2.0" | apache-2.0 | lineage unresolved | candidate — `promotion: benchmark-required` |
| `hf.recammaster` | "mit-code-check-model-terms" | check model terms | — | candidate — `promotion: license-and-benchmark-required` |
| `hf.meridian` | "research-only-until-cleared" | research-only | — | candidate — `promotion: benchmark-and-legal-review` |
| `hf.viewcrafter25` | "apache-2.0-current-card" | apache-2.0 (current card) | — | candidate — `promotion: benchmark-only` |

(Worker C's lane owns the renderer benchmarks — HF010-HF013; recorded here
for mapping completeness.)

### renderer.characterAnimation

| Candidate | Code | Checkpoint | Dataset | State |
| --- | --- | --- | --- | --- |
| `hf.wan22.animate` | "verify-current-card" | verify-current-card | — | candidate — `promotion: license-and-benchmark-required` |

### renderer.neuralVideo / renderer.audioVideoGeneration / renderer.upscale

| Candidate | Code | Checkpoint | Dataset | State |
| --- | --- | --- | --- | --- |
| `hf.ltx23` | "ltx-2-community" | ltx-2 community terms | — | candidate — `promotion: license-and-benchmark-required`; covers all three profiles per the yaml |

## Honest gap summary

- NO license-clean candidate exists yet for: `football.playerSegmentation`
  (watchlist only).
- License verification is the BLOCKING state (verbatim) for:
  `hf.vibevoice.asr.streaming`, `hf.wan22.animate`, `hf.recammaster`
  (model terms), `hf.meridian` (legal review).
- Every HF candidate is benchmark-required or license-and-benchmark-required
  before any production promotion; HF003-HF009 actual benchmarks are Wave 2+
  (GPU-gated, the W303/L011 runtime seam) — nothing here is production
  approval.
- In-repo registrations (the perception-adapter families + the L010
  benchmark-track RF-DETR registration) carry the repo's unresolved root
  license as their CODE component (the shared honest posture; promotion is
  fail-closed until the repo declares a license).

## Change discipline

This mapping is a DISCOVERY/EVIDENCE record. The frozen profiles live in
`docs/contracts/technology-task-profiles.md`; the candidate registry lives in
`docs/technology/hugging-face-candidates.yaml` (TL-owned). If a profile needs
a shape change (input/output/metrics), that is a contract-change REQUEST to
the TL, never a patch here.
