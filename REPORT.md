# SPR302 — Worker 65-h delivery (the research/matrix flight)

Manifest:

- work item: SPR302 — Neural v2v candidate shortlist + feasibility matrix (Owner: A, Wave: WAVE-1)
- branch: `work/spr302-v2v-feasibility` (from main @ 1a8e3e0; never pushed)
- evidence tree: `scripts/evidence/spr302-v2v-feasibility/` (probe scripts EXECUTED, matrix-record.json, fail-closed validator NEGATIVE-TESTED, summary.md, 41 recorded fetch attempts with fetch-meta)
- gates: `bun scripts/evidence/spr302-v2v-feasibility/validate-matrix.ts` exit 0 (+ 2 negative tests exit 1) · `bunx prettier --check .` clean · `bunx eslint` 0 errors on the touched TS · FROZEN contracts + the hf-portfolio/spr evidence trees untouched
- no model runs; zero weight bytes; no promotion (SPR303 owns the trial)

=== SPR302 FEASIBILITY REPORT ===

## 1. The shortlist (9 candidates across the landscape's classes — live probe facts)

Host measured live (2026-10-04T07:56Z, `results/shortlist-probe.json`): **4041.6 MiB total
RAM / 6.82 GiB free disk / 2 vCPU / no GPU.** Every hub size below is HUB-REPORTED
(API file listing, never downloaded); every reachability verdict is the executed
1-byte Range probe (the hf005/hf009 convention, zero weight body bytes).

| # | candidate (class) | HF repo(s) @ pinned rev | gated | size | license (recorded terms) | reachability |
|---|---|---|---|---|---|---|
| 1 | **AnimeGANv2** (per-frame NST) | `akhaliq/AnimeGANv2-pytorch`@5f2c6e4b, `vumichien/AnimeGANv2_{Hayao,Paprika,Shinkai}`@f84714b4/aff2c6fe/14924f86 | no (all) | 8.6 MB per style | MIT code (fetched); **NC weights terms on the mirrors** (fetched verbatim); film-frame training provenance (The Wind Rises / Shinkai / Paprika, fetched) | HTTP 206 (all 4) |
| 2 | **EbSynth** (example-based propagation) | none (a binary/CLI tool, not a hub model — recorded) | n/a | n/a | public-domain code + Adobe PatchMatch patent warning (fetched); tool terms fetched: "You retain full copyright to the videos you create in EbSynth if you own the copyright to the guiding video and keyframes"; "does not utilize AI or pre-trained models"; the SDXL keyframe trap recorded verbatim | n/a (site + repo fetched) |
| 3 | **ReReVST** (neural VST) | none on the hub (search 0); GitHub `daooshee/ReReVST-Code` (GPL-3.0, full text fetched) | n/a | weights off-hub (Google Drive/Baidu Pan per the fetched README) | GPL-3.0 code; weights terms unstated | n/a |
| 4 | **Diffutoon** (diffusion toon shading — the wave-3+ quality reference) | official: NOT FOUND (project page 404, GitHub 0 search hits + raw 404 both branches, no official hub repo); mirror `camenduru/Diffutoon`@f9672c4a | no (mirror) | **9.59 GiB** (mirror tree) | **license-terms-not-found** (all recorded official paths 404; the mirror is untagged) | HTTP 206 (mirror) |
| 5 | **ToonCrafter** (generative interpolation) | `Doubiiu/ToonCrafter`@7c56c5a2 | no | **11.34 GiB** | **Apache-2.0** (the LICENSE is IN the hub tree — fetched, byte-identical with the GitHub copy; the card: "Feel free to use it under the Apache-2.0 license") | HTTP 206 |
| 6 | **Pix2Video** (text-guided V2V editing) | none on the hub; GitHub code exists (README fetched) | n/a | GPU-class (SD-base dependency) | **Adobe Research License — "for non-commercial and research purposes only"** (fetched verbatim) | n/a |
| 7 | **vid2vid (NVIDIA)** (conditional V2V) | none on the hub (GitHub-only) | n/a | GPU-class | **CC BY-NC-SA 4.0** (LICENSE.txt fetched verbatim — the red flag CONFIRMED); the few-shot sibling has no license file at either recorded path (typed gap) | n/a |
| 8 | **FlowVid** (flow-conditioned V2V) | none — **artifact-absent**: the official README is titled "FlowVid (NO CODE)" and states "we are unable to release the FlowVid checkpoints" (fetched verbatim) | n/a | n/a | n/a | n/a |
| 9 | **CompoundVST** (compound VST) | none — **artifact-absent**: the GitHub repo README is a 69-byte website stub (fetched verbatim) | n/a | n/a | n/a | n/a |

## 2. The feasibility matrix (per candidate × the 5 axes — every cell recorded or typed)

Full machine-checkable record: `scripts/evidence/spr302-v2v-feasibility/matrix-record.json`.

### RESOURCE (CPU-host: 3.95 GiB RAM / 6.82 GiB disk / 2 vCPU / no GPU, measured)
- **AnimeGANv2 — FEASIBLE (this host)**: 8.6 MB weights = 0.13% of the measured disk;
  no GPU; cost arithmetic (class-judgment, labeled not-measured): 1190 frames × 2.5 s
  ≈ 49.6 min/clip on the b8 envelope.
- **EbSynth — CPU-class feasible** (class-judgment per the landscape: "no GPU
  required"; latency not-measured).
- **ReReVST — class-feasible on CPU** (a 2020-era compact CNN + flow; unmeasured).
- **Diffutoon — INFEASIBLE**: the 9.59 GiB mirror tree alone exceeds the 6.82 GiB
  disk; GPU-class. Adequate-host: GPU + ≥10 GiB disk.
- **ToonCrafter — INFEASIBLE**: 11.34 GiB > disk; GPU-class.
- **Pix2Video / vid2vid — INFEASIBLE** (GPU-class; vid2vid also needs per-frame
  semantic maps). **FlowVid / CompoundVST — N/A (artifact-absent).**

### LICENSE (recorded terms only, verbatim citations in the record; never legal advice)
- Permissive: AnimeGANv2 **code** (MIT); ToonCrafter (Apache-2.0 — the landscape's
  NC posture CORRECTED by the fetched LICENSE + card); EbSynth **code** (public
  domain, with the recorded Adobe PatchMatch patent warning).
- Non-commercial / research-only (recorded verbatim): vid2vid (CC BY-NC-SA 4.0),
  Pix2Video (Adobe Research License), AnimeGANv2 **weights** (the mirrors' own
  README: "freely available to academic and non-academic entities for
  non-commercial purposes… commercial use, please contact us").
- Not-found (typed gap): Diffutoon (no license text at any recorded official path).
- Copyleft: ReReVST code (GPL-3.0). N/A: FlowVid, CompoundVST (artifact-absent).

### CONTRACT-FIT vs the FROZEN SPE-v1 contract (docs/contracts/source-preserving-renderer.md)
- **EbSynth — STRONGEST BY CONSTRUCTION**: propagates OUR deterministic keyframes
  over the source frames (the substrate is the propagation domain; temporal
  consistency anchored to our keys; the terms' no-AI clause even simplifies the
  rights record). Typed gaps: propagation across cuts must be reseeded at every
  detected cut (the engine's cut-detect owns it — the same cut-reset contract as
  trail-accumulate); binary determinism unproven; occlusion/large-motion failure
  mode unmeasured.
- **AnimeGANv2 — COMPATIBLE-WITH-TYPED-GAPS**: per-frame 1:1 map (frame-count
  preserving; cuts not threatened by the model proper — no cross-frame state);
  audio passthrough container-level; typed gaps: bit-exact determinism and the
  temporal-identity axis are trial questions.
- **ReReVST — COMPATIBLE-BY-DESIGN-CLASS** (flow-guided temporal regularization
  targets exactly the flicker invariant; cut-gating of the flow propagation is the
  typed gap).
- **Diffutoon — PARTIAL-BY-DESIGN-CLASS** (on-mission toon shading; cuts/determinism
  are typed gaps — no cut model in diffusion conditioning).
- **Pix2Video / vid2vid / ToonCrafter — POOR-BY-CLASS / VIOLATES-BY-CLASS**:
  regeneration classes (the substrate is regenerated, not mapped; ToonCrafter's own
  card records the 2 s / 8 fps envelope — a 24× duration and 3× fps gap vs the b8
  substrate). **FlowVid / CompoundVST — N/A (artifact-absent).**

### IDENTITY-RISK (the "no slideshow-of-generated-frames" constraint; the scorecard axes)
- HIGH: AnimeGANv2 (per-frame independent mapping — the exact structure that
  collapsed the heuristic stylizers' identityConsistency/temporalConsistency:
  anime-npr min 1.80, cartoon-cel 1.53), Pix2Video, vid2vid (regeneration classes).
- LOW-MEDIUM: EbSynth (identity anchored to our keyframes; drift only between keys —
  keyframe cadence is the control), ReReVST (regularization by design; unmeasured).
- MEDIUM (class): Diffutoon (ControlNet+motion-module conditioning reduces per-frame
  independence; unmeasured — no diffusion candidate has any identity measurement in
  the repo's evidence). N/A: ToonCrafter (not a restyle engine — its own card records
  "slight flickering artifacts" from the lossy autoencoder), FlowVid, CompoundVST.

### WAVE-2 READINESS (the trial verdict + typed blockers)
- **READY: AnimeGANv2** — blockers: (a) NC weights terms (research-class trial only;
  production clearance NOT proven), (b) temporal identity not-measured, (c) bit-exact
  determinism not-measured, (d) hub mirrors are community conversions (provenance
  off-hub vs the canonical GitHub port).
- **READY: EbSynth** — blockers: (a) CLI automation work (an integration flight),
  (b) the recorded PatchMatch patent warning, (c) determinism not-measured, (d)
  occlusion/large-motion failure mode not-measured.
- PARTIAL: ReReVST (GPL-3.0 integration decision + unverifiable off-hub weights +
  painterly-not-anime styles).
- NOT READY: Diffutoon (resource + license-not-found + official distribution 404 +
  only an unlicensed mirror), ToonCrafter (class + resource + envelope), Pix2Video
  (research-only license + resource), vid2vid (NC license + resource), FlowVid
  (artifact-absent), CompoundVST (artifact-absent).

## 3. The recommendation (argued FROM the matrix)

**Wave-2 trial pick: AnimeGANv2 A/B on the b8 substrate (primary) + EbSynth
propagation seeded by our deterministic keyframes (second candidate).** The resource
axis is decisive on the measured host: only these two are CPU-host-feasible with
recorded terms. The A/B pairing IS the identity measurement design — a learned
per-frame map vs propagation-from-our-keys on the same substrate, scored by the
frozen tier-scorecard axes (the collapse axes to beat: identityConsistency /
temporalConsistency, anime-npr 1.80 / cartoon-cel 1.53 min-axis). SPR301's verdict
("preservation proven: sourceFidelity 4.88–5.0; the wave-2 neural target is exactly
stylizer visual quality") is what this pairing measures.

**The landscape's prior claims CHECKED against the live probe facts (8 checks in the
record):**
1. "AnimeGANv2 is the wave-2 trial with the best cost/benefit" — **CONFIRMED** on the
   resource axis (ungated, 206-reachable, 8.6 MB mirrors); the license leg SHARPENED
   to recorded NC weights terms (the production blocker is now recorded, not deferred).
2. "Diffutoon is the quality reference to chase in wave-3+" — **STANDS as a class
   judgment**, with a new recorded blocker: the official distribution point is 404 on
   every recorded path; only an unlicensed 9.59 GiB community mirror is reachable.
3. vid2vid "CC BY-NC-SA 4.0 RED FLAG" — **CONFIRMED VERBATIM** (LICENSE.txt fetched).
4. ToonCrafter "treat non-commercial until code license verified" — **CORRECTED on
   the license leg**: the hub-tree LICENSE + the GitHub LICENSE are Apache-2.0 (fetched,
   byte-identical) and the card says "use it under the Apache-2.0 license"; the
   benchmark-only class verdict STANDS on contract-fit grounds (generative
   interpolation regenerates motion; the card's own 2 s / 8 fps envelope).
5. FlowVid "research needs-gpu" — **SHARPENED to artifact-absent** (the maintainers'
   own README: checkpoints will not be released); the landscape's arxiv id corrected
   (2312.17681 per the README badge vs 2312.08126 in the landscape).
6. Pix2Video license deferred — **RESOLVED**: research-only (Adobe Research License,
   verbatim). 7. ReReVST/CompoundVST deferred — **RESOLVED**: GPL-3.0 / website-stub.
   8. EbSynth "read terms before production" — **RESOLVED**: the terms fetched and
   recorded; favorable for our deterministic-keyframe lane (the SDXL keyframe trap has
   a recorded avoidance path: never use the Generate-Image feature).

**No promotion**: SPR303 owns the executed trial ("only where legitimately
available"). This flight shortlists only — no renderer-registry change, no status
claim, no tier claim, no gating change.

## 4. The typed gaps (the honest open edges)

- `license-terms-not-found`: Diffutoon (all recorded official paths 404);
  few-shot-vid2vid (no license file at either recorded path).
- `weights-provenance-off-hub`: AnimeGANv2 (community ONNX mirrors vs the canonical
  GitHub port releases), ReReVST (Google Drive/Baidu Pan), Diffutoon (an untagged
  community mirror — provenance unverifiable).
- `artifact-absent`: FlowVid (explicit no-release), CompoundVST (website stub).
- `not-measured`: every identity/latency/determinism claim on this flight (no model
  ran — the fabrication guard enforces it in the validator).
- `class-judgment` (labeled): the CPU-feasibility classes for EbSynth/ReReVST and the
  AnimeGANv2 per-frame cost arithmetic (the landscape's 2–3 s/frame port speed,
  extrapolated to the b8 envelope — never presented as a measurement).
- The landscape's own recorded uncertainties it asked wave-2 to resolve — now
  resolved or sharpened per above (the AnimeGANv2 weights flag is RECORDED, not deferred).

## 5. Limitations

- No model execution: every resource/identity cell beyond the measured host facts and
  hub-reported sizes is a class judgment or a typed gap — by the work item's design
  (the matrix is the WAVE-1 deliverable; SPR303 runs the trial).
- License verdicts are recorded terms only, never legal advice; the AnimeGANv2
  mirrors' apache-2.0-tag-vs-NC-body contradiction is recorded, not adjudicated.
- The hub probes are anonymous (no token in this sandbox, per the worker contract) —
  the ungated verdicts are the anonymous-reachability facts.
- The Diffutoon official-distribution 404s are the facts AS RECORDED FROM THIS
  SANDBOX at the recorded timestamps (a re-probe later may find it again — the
  fetch-metas carry the timestamps).

=== END REPORT ===
