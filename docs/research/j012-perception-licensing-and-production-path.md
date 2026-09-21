# J012 — Reality-Fidelity Perception: Licensing Survey & Production-Path Decision

Status: DECIDED + IMPLEMENTED (Wave 1, Worker A) — the contrast-context production path is the default player-detection chain head; benchmark-track candidates registered in `@sporta/perception-benchmark` (L010)
Date: 2026-09-20 (decision); 2026-09-21 (implementation addendum §6)
Related: J012 (`docs/work-items/mvp-user-journey-hardening-work-items.md`), ADR-011 (HF portfolio; the three-way license rule), `docs/technology/hugging-face-candidates.yaml`, `docs/testing/mvp-reality-engine-gate-audit.md` (the failure evidence), `docs/architecture/technology-plane.md` (license policy: permissive code ≠ usable checkpoint)

## 1. The problem being solved

The R601/R602 gate-audit walk proved the honest-degradation machinery works and
simultaneously exposed the fidelity gap this work item owns: on that
deployment the player-detection family degraded to `heuristic-color-detector`
(model weights not downloaded), whose pitch-green/white suppression predicate
is calibrated for broadcast grass views. Both gate clips then materialized an
empty-event SWM and the derived realities (3D Game, Anime/NPR) — deterministic
over the canonical SWM — produced byte-identical artifacts across two
materially different real matches. J012 acceptance requires the opposite:
supported real footage produces meaningful entities/events, materially
different clips yield materially different reconstructed football states, and
an empty/default SWM cannot pass the final derived-reality gate.

## 2. License survey (the three-way rule applied)

Per ADR-011 and the technology-plane license policy, every candidate is
recorded as THREE separate components — code / model checkpoint / training
dataset — because permissive code licensing does not make a checkpoint
commercially usable, and an unreviewed commercial-use verdict is recorded as
absent, never fabricated.

### 2.1 Ultralytics YOLOv8n / YOLOv5nu (the currently wired model-backed class)

| Component | Status | Terms |
| --- | --- | --- |
| Code (adapter) | repo (unresolved root license) | our own adapter plane |
| Checkpoint `yolov8n.pt` / `yolov5nu.onnx` | **copyleft, AGPL-3.0** | Ultralytics AGPL-3.0 + separate commercial dual-licensing track; evaluation-only |
| Training dataset (COCO) | unresolved | mixed Flickr image terms + COCO annotation terms; commercial use not affirmed |

AGPL-3.0 impact analysis:

- AGPL §13 network-copyleft: serving detection results from an unmodified OR
  modified AGPL model to network users triggers source-offering obligations
  for the whole derived work under AGPL. Sporta's deployment shape (a hosted
  multi-tenant rendering service) is squarely in scope — there is no "SaaS
  loophole".
- Ultralytics' own position is that their commercial license is required for
  commercial deployment without AGPL obligations. That is a per-seat/per-rev
  commercial dependency Sporta has not accepted.
- Vendoring the weights into the repository would distribute AGPL material —
  prohibited for this codebase's posture; downloading them into a deployment
  makes that deployment AGPL-bound.
- Verdict: **not the production path.** The candidate remains registered,
  honestly labeled evaluation-only (existing `MODEL_BACKED_DETECTOR_LICENSE`
  record is correct), with its refusal classes
  (`model-backed.weights-unavailable`,
  `model-backed.inference-backend-not-wired`) intact. No weights are
  downloaded, no weights are committed; the weights dir stays an
  explicitly-injected option (`assets/` default documented, never populated).

### 2.2 RF-DETR SoccerNet (`hf.rfdetr.soccernet`)

| Component | Status | Terms |
| --- | --- | --- |
| Code (RF-DETR architecture) | apache-2.0 | Roboflow RF-DETR lineage |
| Checkpoint (HF `julianzu9612/RFDETR-Soccernet`) | apache-2.0 (model card) | permitted download for benchmark evaluation; NEVER committed to the repo |
| Training dataset (SoccerNet) | **unresolved** | SoccerNet corpus terms are challenge/research-oriented; commercial use not affirmed by Sporta review |

- The apache-2.0 checkpoint license removes the AGPL network-copyleft
  problem for evaluation. The dataset-lineage component remains unresolved —
  honest record, no fabrication.
- Sporta has NO inference runtime wired today: the model-backed seam
  (`ModelInferenceBackend`) is the documented W303 GPU-worker-protocol
  integration point. A checkpoint without a runtime cannot be the production
  path this wave.
- Verdict: **benchmark-track candidate.** Registered through the Technology
  Plane conventions (identity, provenance, three-way license, failure
  classes) in the L010 benchmark harness (`@sporta/perception-benchmark`);
  weights may be downloaded by an operator for benchmark evaluation under
  apache-2.0 but are never vendored. Production promotion is
  benchmark-required + runtime-seam-required (W303/L011), Wave 2+.

### 2.3 Improved pure-code perception (zero external components)

| Component | Status | Terms |
| --- | --- | --- |
| Code | repo (unresolved root license) | our own code — same posture as every shipped adapter |
| Checkpoint | **absent** | no model, no weights file, nothing to download |
| Dataset | **absent** | no training data; deterministic algorithm |

- Zero license risk by construction: nothing enters the deployment but our
  own code. Nothing to vendor, nothing to download, no network copyleft, no
  dataset lineage.
- The existing `heuristic-color-detector` is the weak baseline of this class
  (documented merge/kit/off-envelope limits; grass-calibrated suppression).
- Verdict: **the production path.** A materially stronger pure-code candidate
  (`contrast-context-detector`, §3) ships as the first-choice player
  detector with the color baseline retained behind it as the final fallback.

## 3. The production path: `contrast-context-detector`

Design grounded in frame evidence from BOTH committed gate clips (fx-001
beach soccer on sand, CC0; fx-004 1944 newsreel film, CC BY-SA 3.0 nl) plus
the synthetic diagnostic fixture — the analysis scripts sampled frames and
measured color statistics (green fraction ~0 on both real clips — the
grass-calibrated predicate's failure mode) and local-contrast response
distributions (players are local-contrast outliers on ANY uniform surface:
sand, grass, or film gray).

Algorithm (documented in full in the adapter; every constant is part of the
tested contract):

1. **Local-contrast foreground mask** — per-channel integral images give the
   local mean over a square neighborhood; a pixel is foreground when its
   Chebyshev channel distance from the local mean exceeds a threshold. This
   is surface-agnostic: it fires on a player against sand, grass, or
   grayscale film exactly the same way.
2. **Morphological majority cleanup** — a 3×3 majority vote removes speckle
   without introducing any ordering nondeterminism.
3. **Dominant-surface restriction** — the mask is block-downsampled, the
   low-contrast blocks eroded, and the largest connected region is the
   playing surface. Beach sand, pitch grass, and newsreel gray all qualify.
4. **Connected components + geometric gates** — area / aspect-ratio /
   compactness envelopes tuned to player blobs (crowds and lines are excluded
   by shape; the ball by area).
5. **Ring-context surface membership** — a surviving blob is kept only when
   the ring around its bounding box is majority playing-surface: players
   STAND ON the surface. This is the gate that kills crowd/stand/background
   detections on broadcast footage.
6. **Confidence** — the product of blob compactness and ring surface
   fraction, clamped to (0, 1]: how convincingly the blob fills its box AND
   sits on the playing surface. No flooring, no averaging — partial players
   and off-surface blobs carry visibly lower confidence (architecture-lock
   §6: no silent confidence collapse).

Determinism: pure function of `(options, frame)` — integral images, fixed
scan order, no RNG, no clock, no I/O. CPU-only. Honest failure classes
(merged players, suppressed low-contrast kits, off-envelope framings) are
documented and carried in the registry binding exactly like every other
candidate.

Pipeline wiring: the DEFAULT player-detection chain becomes
`contrast-context-detector → model-backed-detector → heuristic-color-detector`
(production path first; the model-backed candidate keeps its honest
weights-unavailable refusal posture and stays registered; the color baseline
remains the final fallback). The default chain IS the production path —
`apps/web` constructs `RealToSwmPipeline` with default config.

Expected fidelity effect on the two committed gate clips (asserted by the
J012 sensitivity tests): materially different entity populations and event
populations between fx-001 and fx-004 — different participant counts,
different per-snapshot positions, different ball-impulse candidate sets —
while every existing gate assertion (participants > 0, balls > 0, uncertain
positions with confidence, verbatim provenance, calibration-unavailable
degradations, resolvable evidence, replayability) continues to hold
unchanged.

## 4. Sensitivity obligations (what the tests must pin)

1. Two substantively different real clips → substantively different SWM
   state: entity-count divergence, position divergence, and event-candidate
   divergence between fx-001 and fx-004 artifacts (not byte-identical
   derived inputs).
2. No weakened assertions: every pre-existing gate/determinism/pipeline
   assertion passes with the new default chain.
3. Determinism preserved: same clip + same config → byte-identical artifact
   content hash (the pipeline determinism suite).
4. Honest degradation preserved: the calibration refusals, the model-backed
   refusal classes, the fallback ledger entries all remain recorded.

## 5. Rejected / deferred alternatives (recorded honestly)

- **Vendor AGPL weights into the repo** — rejected: distributes AGPL
  material; violates the repo's licensing posture.
- **Download YOLO weights into the sandbox deployment** — rejected as the
  production path: makes the deployment AGPL-bound; also no inference
  runtime exists pre-W303, so it would not even run.
- **Download RF-DETR SoccerNet weights and run real inference now** —
  deferred to the L010/L011 benchmark track: apache-2.0 permits evaluation,
  but there is no wired runtime this wave; the harness registers the
  candidate with full three-way provenance and the operator may benchmark it
  when the seam exists. Never committed.
- **Weakening the sensitivity assertions to make the current state pass** —
  prohibited by the work item and the honest-degradation doctrine.

## 6. Implementation addendum (2026-09-21, Worker A)

The production path is implemented as
`packages/perception-adapters/src/detection/contrast-context.ts`
(`contrast-context-detector@0.1.0`), wired as the DEFAULT player-detection
chain head (`contrast-context → model-backed → heuristic-color`), with the
J012c sensitivity suite at
`packages/real-to-swm/test/sensitivity.test.ts` and the L010 harness
registration in `packages/perception-benchmark`. The measured effect on the
committed gate clips through the default pipeline: fx-001 → 311 final-snapshot
participants / 15 ball-impulse candidates / artifact `b692ff40…`; fx-004 →
520 participants / 58 candidates / artifact `00a8f32c…` — materially
different reconstructed football state (the audited failure mode
reconstructed both into the same empty-event state).

Honest deviations from §3's literal algorithm wording, each forced by
measurement during calibration (all documented in the adapter's contract
docs; all pinned by tests):

1. **Two-pass local mean (background-restricted) + deep-contrast restore**
   instead of a single-pass local mean. A single-pass mean is polluted by
   bright clutter (pitch lines, goal frames) and manufactures (a) a "wedge"
   of shallow-contrast foreground around dense clutter crossings and (b) a
   halo around every blob. Pass 2 recomputes the mean over pass-1 background
   pixels only; a pass-1 pixel whose deviation exceeds 2× the threshold
   (genuine structure edge: 60–150 measured) is restored so close-up
   boundary rings do not thin below the erosion density. Shallow artifacts
   (32–45) stay suppressed.
2. **5-cross majority (≥ 4 of self + 4-neighbours)** instead of a 3×3 box
   majority: the box majority welds players standing next to pitch lines
   into the line's full-height bar (the merged blob dies on the aspect
   gate). The cross element removes speckle without filling 1-pixel gaps.
3. **Surface-or-background ring membership** instead of "the largest
   connected region of surface blocks": a thin foreground wall (a chalk
   line's blocks) partitions any region graph and evicts every player on
   the wrong side of the line (measured on the marked synthetic fixtures).
   The implemented ring counts a pixel as surface when it lies in a
   surface block OR is itself cleaned-mask background — the same
   crowd/stand gate without the partition failure; out-of-frame ring
   positions count as non-surface (frame-filling clutter cannot smuggle a
   clean ring past the gate).
4. **Block erosion retained at 0.35** (the low-density-block erosion): the
   measured noise floor without it is 30–70 noise detections per real frame
   (film grain clumps, compression speckle); with it, straight blob walls
   (≥ 0.35 block fraction in their core blocks) survive.

Honest quality limits recorded (carried in the registry binding's failure
classes): merged players/shadows (undercount), suppressed low-contrast kits
(the newsreel case), off-envelope framings (no dominant uniform surface →
honest zero), and entity-population overcount on noisy footage (the
min-track-lifetime gate and the ledger record it; per-frame detection
density above the plausible-player envelope is ledgered as
off-envelope-detection).
