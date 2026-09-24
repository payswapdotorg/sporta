# SPR-W2-C — Stylizer Upgrade Trials Report (Lane C)

Task: neural/advanced stylizer feasibility trials · Branch `spr/w2c/stylizer-trials`
· Base `805a5fc` · Engine SPE-v1 (frozen contract untouched: no existing
renderer/stage/registry row was modified; trials live in
`scripts/source-preserving/spe/trials/**` and render through their own driver).

Mandate context (Tier-2 diagnosis, `docs/status/source-preserving-reality-status.md`):
preservation is SOLVED (sourceFidelity 4.88–5.0); the gap is VISUAL QUALITY of the
heuristic stylizers — aggressive styles destroy player identity/structure, subtle
styles draw borderline limb-morphology counts. Every candidate below attacks that
gap; every claim below was actually run in this session (commands + raw JSON
evidence in this directory).

---

## 1. Substrate verification (run first, as dispatched)

```
$ sha256sum scripts/evidence/spr-corpus-bytes/b8p3.mp4 scripts/evidence/spr-corpus-bytes/b8-b12.mp4
969af7c6fdb172091ff00705b25fa37b7073f4332d722416b9754a4a7579917a  scripts/evidence/spr-corpus-bytes/b8p3.mp4
7cb3d728cc349720043c74e32258de55f0ea87b9314515d8e5d4020853143421  scripts/evidence/spr-corpus-bytes/b8-b12.mp4
```

Matches the dispatch expectations (`969af7c6fdb17209…`, `7cb3d728cc349720…`).
b12 = `sprclip-b12-determinism-cut` (640×360@25, **301 frames decoded**, 12.04 s,
AAC). b8 = `sprclip-b8-inplay-original` (640×360@25, 1190 frames, 47.62 s, AAC);
per the packet the b8 trials render **only the first 300 frames** (`--max-frames 300`).

### Substrate findings recorded honestly (pre-existing, NOT introduced by this lane)

1. **b12 stale stream metadata**: `ffprobe -show_entries stream=nb_frames` reports
   **338**, decode-true count is **301** (`-count_frames`). `qa_check.py`'s T1 reads
   the metadata field, so b12 gate runs against the raw substrate show a spurious
   `338==301` T1 fail. Evidence + remedy: a metadata-normalized full-window gate
   reference was built (`substrate/b12-gate.mp4`, nb_frames=301, video re-encoded
   deterministically crf-20/bitexact, audio stream copy, sha256
   `00df1574232e2f9e12cbee42ce9bd6120c54758733b356f680a86c069d5a5539`) — the same
   class of derived reference as the b8 300-frame window below. Both runs are
   preserved side-by-side (`qa/qa-*-b12.json` raw-substrate vs
   `qa/qa-*-b12-gateref.json`); the decode-true timeline is 301==301 everywhere.
   The TL may want to fix the substrate's container metadata in wave-3.
2. **Frozen-encoder `-shortest` trailing-frame drop on b12**: `spe.encode.encode_bitexact`
   muxes with `-shortest -c:a copy`; b12's audio ends ~33 ms before its last video
   frame, so the muxer drops trailing video packets — measured on my first b12
   renders (298–300 of 301 frames) AND on the FROZEN wave-1 renderer itself
   (`baseline/cartoon-cel-b12.mp4` decodes to 300/301). Wave-1 never gated T1 on
   b12 (it was the determinism cut), so this was never exposed. Remedy (wave-1
   w6-spr-2 precedent: "the substrate adapts to the engine"): the trial driver
   prepares a deterministic **apad-padded AAC derivative** of the substrate audio
   (`renders/b8-b12.apad-audio.m4a`, `-af apad -t 12.54`, 192 k, broadcast sound
   unchanged + trailing silence, one AAC generation) whenever the source audio
   falls short of the rendered window. All shipped b12 trial renders mux all 301
   frames. This deviation is recorded in each render's provenance `styleConfig`
   (hashed) and result JSON `audioSource`. b8-300 renders keep true passthrough
   (the 47.62 s audio covers the 12 s window; `-shortest` trims it at the video end).

### Derived gate references (deterministic, sha-recorded)

- `substrate/b8-first300.mp4` — first 300 frames of b8 (12.000 s, AAC,
  byte-deterministic creation verified by regeneration, sha256
  `9efa9b99aa74c0e365a4e22417ec3e4eece60633c6e3aac5cdd2cad6e3ec889b`;
  creation: `ffmpeg -i scripts/evidence/spr-corpus-bytes/b8p3.mp4 -frames:v 300
  -t 12 -c:v libx264 -crf 20 -preset medium -threads 1 -pix_fmt yuv420p -g 50
  -fflags +bitexact -flags:v +bitexact -map_metadata -1 -c:a copy <out>`).
  The b8 trial renders read the FROZEN b8 substrate with `--max-frames 300`; the
  gates compare against this window reference (same window, correct metadata).

---

## 2. Candidates selected (from `docs/technology/source-preserving-candidates.yaml`)

All three are CPU-only, deterministic-classical, zero new runtime dependencies
(OpenCV BSD-3 + numpy BSD-3, already the frozen engine's toolset), no model
downloads, license-clean. AnimeGANv2 (wave2 rank 3) was NOT selected: its yaml
entry carries `license_red_flag: animeganv2-weights-provenance` ("upstream usage
terms verification deferred") — this lane's selection rule was permissively-
licensed weights or classical CV only. Full EbSynth (wave2 rank 1) was NOT
selected as a binary: `license_red_flag: ebsynth-terms` + external proprietary
binary download; its keyframe+propagation CONCEPT is trial C below on the
license-clean `flow.farneback.cv2` enabler.

### A. `kuwahara-paint` ← yaml `spr103.det.kuwahara-aniso` + wave2 `w2.kuwahara-aniso-numpy` (rank 2)

Yaml fields justifying selection: "anisotropic Kuwahara filter (Kyprianidis 2009,
published for images AND video) implemented in numpy over flow-aligned windows";
license "algorithm-public (paper) … own numpy implementation; TD port GPL-3 (do
not copy)"; runtime cpu-only; quality "painterly abstraction with edge
preservation; anisotropic variant avoids classic-Kuwahara clustering artifacts";
temporal_consistency "good (deterministic; edge-flow crawl mitigated by temporal
pre-smoothing)"; classification "preferred-implementation-candidate (wave-2
trial)"; wave2 why: "biggest painterly-quality jump with zero new dependencies";
wave2 trial instruction: "budget-test on b12 first (heaviest deterministic stage)".

**Implemented** (`spe/trials/kuwahara_paint.py`, own numpy/OpenCV, nothing copied
from GPL ports): half-resolution (320×180) abstraction core = median(3) + one
bilateral pre-consolidation pass; structure tensor (Sobel + Gaussian σ2.5) with
temporal EMA (α=0.45, cut-reset — the yaml's "temporal pre-smoothing");
isophote orientation quantized to N=8 angles via coherence-gated doubled-angle
soft blending (γ=10, weight-map Gaussian σ2); per orientation: deterministic
rotate (getRotationMatrix2D, BORDER_REFLECT_101) → 4-quadrant anisotropic
Kuwahara with quadrant means combined by SOFT inverse-variance weights
(exp(−3·var/meanVar), variance fields Gaussian-smoothed σ2) → rotate back;
per-pixel soft orientation blend; bilinear upsample; bilateral field
consolidation ×2 (d=9 σ75); saturation lift 1.14; grain 1.5 (frame-index-seeded,
frozen `stages.grain` pattern). Budget answer for the yaml's "budget-test":
**~0.15 s/frame (45–47 s per 300-frame render incl. analysis+encode)** — the
"heaviest deterministic stage" concern is retired at half-res.

**Engineering findings during tuning** (smoke iterations v1→v10, all recorded in
the session): (i) hard per-pixel orientation argmax → orientation-boundary
seams; fixed by coherence-gated soft blending (without the coherence gate, the
normalized tensor direction is pure noise in isotropic texture and the ^γ
weights degenerate into random per-pixel orientation picks = blotches);
(ii) hard quadrant argmin → switching blotches on grass/net; fixed by the soft
inverse-variance quadrant blend; (iii) XDoG edge overlay + palette re-quantization
both re-amplified the residual 8-orientation blend residue on the goal net into
"ghost" speckle — stage-isolation diagnostics (montage, VLM-assisted) identified
the blend residue as the root cause and the clean rendition as
Kuwahara+bilateral alone; both stages were dropped (pipeline records why).

### B. `subject-toon` ← yaml `matting.mog2.cv2` + `flow.farneback.cv2` (+ `spr202.det.framediff` pan-robustness rationale)

Yaml fields justifying selection: `matting.mog2.cv2` — "MOG2 background
subtraction", license BSD-3/weights none, runtime cpu-only, latency real-time-class,
integration "**SPE-v1 subject-masking stage + global-motion compensation reuse**",
classification preferred-implementation-candidate, cpu-local-runnable; its own
failure_modes field ("broadcast pans corrupt model") plus `spr202.det.framediff`
("pan-robust, weaker semantics") is why the mask fuses MOG2 with the engine's
camera-compensated Farneback residual (`spe.stages.flow_magnitude`, translation+
zoom least-squares fit) instead of raw MOG2; `flow.farneback.cv2` —
temporal_consistency exact-deterministic, "dense flow adequate for trail masks
and temporal smoothing at 640x360". This candidate attacks the Tier-2 diagnosis
head-on ("aggressive styles destroy player identity") with a dual-path pipeline.

**Implemented** (`spe/trials/subject_toon.py`): subject mask = OR(camera-compensated
Farneback residual > 1.8 px @320×180, MOG2 foreground [history 150, varThreshold
25, no shadows, learningRate 0.05, re-initialized at every detected cut — no
cross-cut model bleed]), morphology open3/close5/dilate5, temporal persistence
EMA (max-decay 0.90, cut-reset), Gaussian feather σ4; **background path** = full
cartoon stack (median 5 + bilateral ×3 d9 σ75 + fixed-per-clip LAB palette K=10
+ region-smooth 5 + boundary contour lines floor 0.30 + sat 1.22);
**subject path** = gentle identity pass (median 3 + bilateral ×1 d7 σ50 + thin
floored XDoG lines 0.70 + sat 1.10, **no palette quantization** — kit colors,
numbers, limb structure stay source-true); soft-mask composite. Fixed palette →
temporally stable background; MOG2 + Farneback are deterministic → bit-exact.

### C. `flow-prop-toon` ← yaml `styl.ebsynth` concept on `flow.farneback.cv2`

Yaml fields justifying selection: `styl.ebsynth` — "example-based stylization
propagation (paint keyframe, propagate)", quality "hand-painted quality with
temporal consistency by construction", temporal_consistency "strong
(propagated)", runtime cpu-only ("no GPU required"), wave2 rank 1
(`w2.ebsynth-propagation`: "consumes our renderer output; provider-neutral") —
but `license_red_flag: ebsynth-terms` (proprietary-free binary, terms flagged,
verification deferred) makes the external binary unfit for this lane's
license-clean rule; implemented instead on the exact-deterministic,
BSD-3, cpu-local-runnable enabler `flow.farneback.cv2` ("dense flow adequate
… at 640x360"). The task packet's own candidate list names this class:
"flow-propagated stylization".

**Implemented** (`spe/trials/flow_prop_toon.py`): a stylized **canvas** is
keyframed every 10th frame and at every detected cut with a strong
cartoon-cel-class stylizer (median 5 + bilateral ×3 + fixed-per-clip LAB palette
K=12 + region-smooth + boundary lines + sat 1.22); between keyframes the canvas
is **backward-warped by the Farneback flow of the ORIGINAL frames** (full-res
flow, frozen engine parameters; remap, BORDER_REPLICATE) and re-anchored:
`canvas = 0.88·warp(prev) + 0.12·styl_full(current)` — the re-anchor fraction
kills accumulated warp drift/ghosting while the propagated component keeps the
appearance temporally stable (this is the wave-1 flicker fix by construction);
display blend per pixel: `out = (1−0.85·trust)·canvas + 0.85·trust·light`,
`trust = clip(|flow|/3.5, 0, 1)` — fast player motion is carried by a gentle
identity pass (median 3 + bilateral ×1 + sat 1.14), static regions show the
stable propagated stylization. Cuts hard-reset the canvas (contract §3.4).

---

## 3. Gates — real outputs (per render)

Commands (b12 example): `python3 scripts/source-preserving/qa_check.py --input
scripts/evidence/spr-corpus-bytes/b8-b12.mp4 --output …/renders/<t>-b12.mp4
--json qa/qa-<t>-b12.json` · b8: input = `substrate/b8-first300.mp4` ·
determinism: double render into two fresh dirs, sha256 compare (both runs'
shas equal the shipped artifact's sha → effectively triple-render proof).
Full raw JSONs in `qa/`; digest table:

| Render | T1 timeline | T2 cuts (spike) | T3 motion r | T4 flicker | T2b deep cuts | Determinism |
|---|---|---|---|---|---|---|
| kuwahara-paint b12 | PASS 301==301, Δ0 ms, audio ✓ (gate-ref; raw-substrate run shows the 338-metadata artifact) | **FLAG** cov 1.0, extra 2.49/30 s (1 frame: 72) | PASS r=0.9341 | PASS 0.462 % (base 0.478 %) | **PASS** cov 1.0, 0 invented | **byte-identical** |
| kuwahara-paint b8 (300f window) | PASS 300==300, Δ0 ms, audio ✓ | PASS cov 1.0, extra 0.0 | PASS r=0.9818 | PASS 0.669 % (base 0.610 %) | PASS cov 1.0, 0 invented | **byte-identical** |
| subject-toon b12 | PASS 301==301, Δ0 ms, audio ✓ (gate-ref; raw run = metadata artifact only) | PASS cov 1.0, extra 0.0 | PASS r=0.9976 | PASS 0.571 % (base 0.478 %) | PASS cov 1.0, 0 invented | **byte-identical** |
| subject-toon b8 (300f window) | PASS 300==300, Δ0 ms, audio ✓ | PASS cov 1.0, extra 0.0 | PASS r=0.9950 | PASS 0.622 % (base 0.610 %) | PASS cov 1.0, 0 invented | **byte-identical** |
| flow-prop-toon b12 | PASS 301==301, Δ0 ms, audio ✓ (gate-ref; raw run = metadata artifact only) | PASS cov 1.0, extra 0.0 | PASS r=0.9053 | PASS 0.514 % (base 0.478 %) | PASS cov 1.0, 0 invented | **byte-identical** |
| flow-prop-toon b8 (300f window) | PASS 300==300, Δ0 ms, audio ✓ | PASS cov 1.0, extra 0.0 | PASS r=0.9202 | PASS 0.560 % (base 0.610 %) | PASS cov 1.0, 0 invented | **byte-identical** |

Determinism proofs (sha256, all three runs identical per render):

```
kuwahara-paint b12 : 8b0b3d5d1a0c6ce6e4b597dd3184fea3fa9e8da7de136c6664f1679035320fac  (x2 det + shipped)
kuwahara-paint b8  : c5cb484664a47425341b0fac962f4ed2a40a5ad44820c886fe9be4d8172be6fc  (x2 det + shipped)
subject-toon   b12 : 8dceb34bc35ef9b67b53e4de0e1409402064e6406bce49cb8be972eef6325386  (x2 det + shipped)
subject-toon   b8  : f4cb7d1086709718d9b4a052b594e5ba62ef614ff9dd9a258211ada143b93971  (x2 det + shipped)
flow-prop-toon b12 : c5dfa4a43ebbc5ad89ae6811ab59220e49d46f0acd9787dbb565b4b9bfbb015f  (x2 det + shipped)
flow-prop-toon b8  : d8f5a897959855b5ee47cb3af06da605198eb6b88b35214b247ea82287f6b82f  (x2 det + shipped)
```

**The kuwahara b12 T2 flag, adjudicated honestly**: the single "extra cut" is
output frame 72. Measured: the INPUT itself spikes there (input diff 51.5 →
kuwahara carries 46.8 = 91 % amplitude; input local median 22.1, output local
median 16.7). The input's own spike does not fire the input detector (51.5 <
2.6×22.1) but does fire the output detector (46.8 > 2.6×16.7) because the
stylizer smooths the surrounding sustained motion. This is exactly the
wave-1-documented detector-boundary class (status w6-spr-2: cartoon frame 934
"input spikes 51.5 there, cartoon carries 49.2 … is source content, not an
invention"), and the deep correspondence gate built for that class
(`cuts_deep.py`) adjudicates: coverage 1.0, **0 invented cuts** — both true b12
source cuts (117, 120) preserved at 134 %/94 % amplitude. Recorded as a raw-gate
non-pass with root-cause attribution; NOT hidden, NOT re-run until green.

Provenance: every render ships a contract-shaped `.provenance.json`
(rendererId `sprtrial-*-t1`, never a frozen id; pipeline list; config hash
covers the effective params incl. the audioSource deviation; degradations list
the swm-null entry per contract §8).

---

## 4. Quality evidence — contact sheets + VLM self-assessment

**Sampling deviation recorded honestly**: the packet asks for frames at
t=2/8/15 s; both trial windows are 12 s (b12 = 12.04 s, b8-300 = 12.0 s), so
t=15 s does not exist. Nearest in-range sample **t=11 s** used for both
substrates; t=2/8 unchanged.

Contact sheets (one per candidate, `sheets/contact-<trial>.png`, 1920×2322):
rows = {b12, b8} × {t=2, 8, 11}; columns = ORIGINAL | wave-1 baseline
(`spr-cartoon-cel-dc1` re-rendered on the same windows via the frozen
`render.py` — b12: sha `18d0d3eea6405533…`, b8f300: sha `76c3120ac070adfd…`) |
trial render.

- `sheets/contact-kuwahara-paint.png`
- `sheets/contact-subject-toon.png`
- `sheets/contact-flow-prop-toon.png`

**VLM self-assessment** (mini-protocol per the packet: 3 frames × 3 axes,
acceptance §2 axes identityConsistency / motionFidelity / stylizationStrength,
1–5, original@t + stylized@t + stylized@t+0.2 s per call; backend-only
`z-ai-web-dev-sdk` script in a scratch dir; 24 calls, ALL landed after 429
retry/backoff — the wave-1 quota pattern; raw per-call JSONs in `vlm/`,
aggregate in `vlm/vlm-selfassessment-aggregate.json`; scores below are the
model's, never edited):

| Render (3 calls each) | identityConsistency | motionFidelity | stylizationStrength |
|---|---|---|---|
| **cartoon-cel baseline b12** | 2.33 | 3.33 | 4.33 |
| **cartoon-cel baseline b8** | 2.00 | 3.00 | 4.00 |
| kuwahara-paint b12 | 2.33 | 3.33 | 4.00 |
| kuwahara-paint b8 | 2.33 | 3.33 | 4.33 |
| subject-toon b12 | 2.67 | 3.00 | 3.33 |
| **subject-toon b8** | **3.00** | **4.00** | 4.00 |
| flow-prop-toon b12 | 2.67 | 3.00 | **4.67** |
| flow-prop-toon b8 | 2.33 | 3.00 | 4.00 |

Honest reading (with limitations): absolute identity scores are low across the
board INCLUDING the wave-1 baseline — consistent with the frozen Tier-2 gate's
harsh identity scoring at 640×360 on frame pairs (the frozen 7-axis scorecards
gave cartoon-cel identity-collapse ~1.5); single-frame-pair protocols
under-score by construction (recorded limitation of this mini-protocol, same
class as the frozen harness's own note). The decision-relevant signal is the
DELTA vs the same-protocol baseline: **subject-toon improves identity by
+1.0 (b8) / +0.34 (b12) and motion by +1.0 (b8)** — the exact axes the Tier-2
diagnosis flagged — while keeping stylization ≥ baseline on b8; flow-prop-toon
improves identity modestly (+0.34 b12 / +0.33 b8) with the strongest
stylization presence on b12 (4.67); kuwahara-paint matches baseline identity
(+0.33 b8 / +0.0 b12) with comparable stylization — its differentiation is the
painterly family look (SPR103), where the baseline has no offering at all.

The TL runs the formal frozen-protocol scorecards at the integration station;
nothing here pre-claims a tier.

---

## 5. Keep / kill verdicts for wave-3 (the actual point)

| Candidate | Verdict | Deciding evidence |
|---|---|---|
| **subject-toon** | **KEEP** (strongest) | ALL preservation gates green on both substrates (T1–T4 + T2b + determinism); only candidate that improves BOTH Tier-2-flagged axes vs baseline (identity +1.0, motion +1.0 on b8); motion correlation 0.995–0.998 is the best of the lane; ~0.24 s/frame, 140 MB RSS. The segmentation-guided architecture directly answers "aggressive styles destroy player identity". |
| **flow-prop-toon** | **KEEP** (conditional) | ALL preservation gates green on both substrates; best stylization presence (4.67 b12) with identity above baseline; motion r 0.905–0.920 (lowest of the lane but comfortably ≥0.80) — the warp+blend costs some motion fidelity, and at 640×360 the propagation is visibly softer than subject-toon. Recommend wave-3: keep as the temporal-stability architecture for subtle-toon realities; A/B against real EbSynth if the TL accepts its terms (this trial is the in-engine baseline for that comparison). |
| **kuwahara-paint** | **CONDITIONAL KEEP / kill-lean for identity-critical realities** | Painterly family (SPR103) where wave-1 had no candidate at all; gates: T1/T3/T4 + T2b + determinism all green, but the raw T2 spike detector flags one input-correspondent amplitude spike on b12 (adjudicated non-invented by the deep gate — same class as wave-1 cartoon's); VLM identity ≈ baseline (2.33) with known texture costs (goal-net residue, micro-text/UI loss — recorded family character of watercolor at 640×360). Cheap (0.15 s/frame). Keep for the painterly family IF wave-3 accepts identity ≈ cartoon-cel baseline there; kill for any identity-critical registration. The yaml's "biggest painterly-quality jump" is real visually (strength 4.0–4.33) but the identity axis did not move. |

A killed-with-clean-evidence candidate would have been a good delivery too —
none of the three broke a preservation gate (the kuwahara raw-T2 flag is
adjudicated input-correspondent by the deep gate; the b12 T1 338 artifacts are
substrate metadata + the frozen encoder's audio-boundary behavior, both
documented above with the frozen baseline exhibiting the same defect).

---

## 6. Resources, licenses, reproducibility

CPU-time (whole process incl. analysis + encode, single-threaded ffmpeg
`-threads 1`) and peak RSS per trial render:

| Trial render | wall | peak RSS | frames-only (provenance renderWallMs) |
|---|---|---|---|
| kuwahara-paint b12 / b8 | 45.5 s / 47.1 s | 111.5 / 116.2 MB | 45 471 / 46 597 ms |
| subject-toon b12 / b8 | 72.9 s / 75.1 s | 140.1 / 139.0 MB | 71 423 / 74 493 ms (first pass) |
| flow-prop-toon b12 / b8 | 90.8 s / 90.0 s | 126.1 / 123.4 MB | 89 931 / 89 514 ms |

Runtime additions: **none** (opencv-python-headless + numpy, already the frozen
engine's toolset; both BSD-3; ffmpeg LGPL build — unchanged). No model weights,
no ONNX, no downloads. The VLM self-assessment used the sandbox's
z-ai-web-dev-sdk in a throwaway scratch dir (not a runtime dependency of any
trial).

Reproducibility: every artifact regenerates bit-exactly via the commands in each
`.provenance.json` (`reproducibility.command`); determinism was proven by double
render with both runs equal to the shipped sha256 (table above).

## 7. Deviations & questions for the lead

1. t=15 s → t=11 s frame sampling (12 s windows; recorded in §4).
2. b12 gate reference + b8 300-frame window reference are derived substrates
   (deterministic, sha-recorded) — the RENDERS always read the frozen substrate
   bytes; the derived files exist to give the gates a metadata-correct,
   window-matched input. See §1 findings for the two pre-existing substrate/
   encoder defects these work around; both are TL-side fix candidates for wave-3.
3. b12 trial renders use the apad-derived audio source (encoder-mux fix, §1.2) —
   one AAC generation on a 12 s clip; recorded in provenance. If the TL prefers,
   wave-3 could apad-normalize the b12 substrate itself (then the driver's
   derivation no-op's).
4. The VLM mini-protocol is harsher than the frozen 7-axis scorecard (no
   cut-adjacent samples, no artifact checklist, single pair per time) — deltas
   vs the same-protocol baseline are the meaningful signal; the formal tiering
   remains the TL's integration-station job.
