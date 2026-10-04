# SPR302 — the neural v2v candidate shortlist + feasibility matrix (evidence summary)

Flight: worker 65-h (SPR lane flight 14, Worker A's technology-evaluation wave, WAVE-1).
Work item (verbatim): "SPR302 — Neural v2v candidate shortlist + feasibility matrix.
Owner: A. Wave: WAVE-1."

**NO MODEL RAN.** The matrix is the research deliverable; the executed trial is
SPR303's WAVE-2 item ("only where legitimately available"). Zero weight bytes were
downloaded; the only fetches are bounded text documents (LICENSE / README /
model-card / terms pages), each with a `fetches/*.fetch-meta.json`.

## The evidence tree

| path | what it is |
|---|---|
| `probe_shortlist.py` | the EXECUTED bounded probe: hub metadata API (gated/sha/per-file hub-reported sizes/license tags) + 1-byte Range reachability (zero weight body bytes) + the first fetch pass → `results/shortlist-probe.json` |
| `probe_followup.py` | the EXECUTED corrected-path pass (the first pass's recorded 404s → corrected repo names/file names + the EbSynth terms + the upstream-weights provenance leg) → `results/followup-fetches.json` |
| `matrix-record.json` | THE FEASIBILITY MATRIX (9 candidates × 5 axes + prior-claims-checked + the recommendation, every cell a recorded fact or a typed gap) |
| `validate-matrix.ts` | the fail-closed validator (record-benchmark.ts convention): structure, probe-fact cross-match, license citations vs committed fetches, fabrication guard, no-promotion — NEGATIVE-TESTED (fabricated `perFrameMs` → exit 1; missing citation doc → exit 1; restored → exit 0) |
| `fetches/` | 41 fetch attempts recorded (20 HTTP-200 documents + 21 recorded 404/gap metas) |
| `results/` | the executed probe outputs (shortlist-probe.json, followup-fetches.json) |

Venv: `/home/z/hf-bench-12` (fresh, OUTSIDE the repo, `huggingface_hub` ONLY).
Host (measured live 2026-10-04T07:56Z): **4041.6 MiB RAM / 6.82 GiB free disk / 2 vCPU / no GPU.**

## The shortlist (the live facts)

| candidate | hub state | size (hub-reported) | license (recorded terms) | verdict |
|---|---|---|---|---|
| AnimeGANv2 | 4 mirrors, ungated, HTTP 206 | 8.6 MB per style (ONNX) | MIT code; NC weights terms on the mirrors (film-frame provenance: The Wind Rises / Shinkai / Paprika) | **READY (primary trial pick)** |
| EbSynth | not a hub model (binary/CLI) | n/a | public-domain code + Adobe PatchMatch patent warning; tool terms: output copyright ours, no-AI synthesis, SDXL keyframe trap | **READY (second trial pick)** |
| ReReVST | no hub repo; GPL-3.0 code on GitHub | weights off-hub (Google Drive) | GPL-3.0 (fetched full text) | PARTIAL |
| Diffutoon | official distribution NOT FOUND; camenduru mirror 9.59 GiB ungated unlicensed | 9.59 GiB > disk | license-terms-not-found (all official paths 404) | NOT READY (wave-3+ ref) |
| ToonCrafter | Doubiiu/ToonCrafter ungated, HTTP 206 | 11.34 GiB > disk | **Apache-2.0** (hub LICENSE + card — the landscape's NC posture CORRECTED) | NOT READY (generative class) |
| Pix2Video | code on GitHub; no hub weights | GPU-class | Adobe Research License — non-commercial (verbatim) | NOT READY |
| vid2vid (NVIDIA) | GitHub-only | GPU-class | CC BY-NC-SA 4.0 (verbatim — the red flag CONFIRMED) | NOT READY |
| FlowVid | **NO CODE — the maintainers' own README: "we are unable to release the FlowVid checkpoints"** | n/a | n/a | NOT READY (artifact-absent) |
| CompoundVST | 69-byte website stub (no code) | n/a | n/a | NOT READY (artifact-absent) |

## The recommendation (argued from the matrix)

Wave-2 trial pick: **AnimeGANv2 A/B on the b8 substrate (primary) + EbSynth
propagation seeded by our deterministic keyframes (second candidate)** — the only
two CPU-host-feasible classes with recorded terms; the A/B IS the identity
measurement design (a learned per-frame map vs propagation-from-our-keys on the
same substrate, scored by the frozen tier-scorecard axes — identityConsistency /
temporalConsistency are the collapse axes to beat: anime-npr 1.80 / cartoon-cel 1.53).
The landscape's "AnimeGANv2 best cost/benefit" claim is CONFIRMED on the resource
axis (8.6 MB, 206-reachable, ungated) with the license leg SHARPENED (the NC weights
terms are now recorded, not deferred). No promotion — SPR303 owns the trial.

## The unblock path for the not-ready rows

- Diffutoon (wave-3 reference): the official distribution + license must reappear
  (all recorded official paths 404 today); then a GPU host ≥ 10 GiB disk.
- ToonCrafter: license leg is now clean (Apache-2.0); the class verdict stands
  (generative interpolation regenerates motion; the card's own 2 s / 8 fps envelope).
- ReReVST: a pinned on-hub weight artifact would remove the provenance blocker;
  the GPL-3.0 posture is a TL integration decision.
