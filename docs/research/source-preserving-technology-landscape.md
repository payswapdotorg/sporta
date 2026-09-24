# Source-Preserving Reality — Technology Landscape

Status: COMPLETE (wave-1) · Author: Worker A (Technology Intelligence, Task `spr-w1-a`)
Date: 2026-09-24 · Machine-readable registry: `docs/technology/source-preserving-candidates.yaml`
Inputs: ADR-012, `docs/architecture/source-preserving-reality-engine.md`,
`docs/contracts/source-preserving-renderer.md` (via worker packet), Worker Packet A.

Scope: every technology candidate for transforming a REAL football broadcast into an
alternate visual reality while preserving the same match — same timeline, same action,
same camera, same player motion. Families SPR101–SPR109 and SPR201–SPR205.

---

## 1. Method

- 63 web-search invocations via the `web-search` skill (z-ai `web_search` function),
  2026-09-24; 61 returned results, 2 hit HTTP 429 (one retried successfully). Full
  query log in §23. Snippets + result titles are the evidence; URLs recorded inline.
- Local sandbox verification (read-only probes, no services touched): ffmpeg filter
  inventory, OpenCV API surface, Python package inventory — results in §3. These are
  the strongest class of evidence in this doc: **VERIFIED-LOCAL**.
- Every claim from a search carries its source URL. Claims from Worker A's own
  knowledge that could not be verified are marked **verification deferred**.
- License statements are recorded as observed in search snippets on 2026-09-24 and
  are NOT legal review; uncertainties are recorded as uncertainties (§20).

## 2. Constraints that shape the entire landscape

1. **Source-preserving invariants** (ADR-012 + renderer contract): timeline equality,
   cut preservation, bit-exact reproducibility, no fabricated tactical facts, honest
   degradation. A candidate that regenerates content per frame without temporal
   conditioning produces the **forbidden slideshow anti-pattern** — explicitly named
   in Packet B's FORBIDDEN list ("per-frame generative restyle").
2. **Temporal consistency is THE hard problem** of video restyle. Every search family
   (s01, s08, s17) converges on the same finding: style transfer and temporal
   consistency are in direct conflict, and the standard fix is optical-flow-guided
   propagation — which itself needs dense flow (Farneback: CPU-OK; RAFT/FlowNet2:
   GPU) plus occlusion handling.
3. **The sandbox is CPU-only, 4 GB RAM, no provider keys** (verified §3; RAM envelope
   measured by the tech lead: a 55 s/1375-frame ingest OOMs the box at 1.75 GB RSS;
   47.6 s/1190 frames is the practical max). Hosted free tiers must NOT be assumed
   usable (ADR-012 compliance rule).
4. **Provider neutrality** (ADR-012 §7): every external technology enters as a
   versioned TechnologyProfile behind a Sporta-owned capability. Deterministic
   baselines are mandatory first (ADR-012 decision 4).

## 3. Sandbox feasibility model + VERIFIED-LOCAL environment facts

Feasibility verdicts used throughout (and in the YAML):

| Verdict | Meaning |
|---|---|
| `cpu-local-runnable` | Runs in THIS sandbox today with ffmpeg/cv2/numpy/scipy/PIL only, within CPU + 4 GB RAM. |
| `cpu-local-after-pip` | Deterministic/CPU-capable but needs a pip install (e.g. torch-CPU, opencv-contrib). Legal per packet, cost recorded. |
| `needs-gpu` | Requires CUDA-class GPU or is impractically slow at ≥25 fps on this CPU. Benchmark-lane only. |
| `needs-provider-key` | Hosted API; no key exists in the sandbox. BYOK option; free tier never assumed. |

**VERIFIED-LOCAL (probed on this machine, 2026-09-24):**

- `/usr/bin/ffmpeg` 7.1.5 — filters present: `tmix`, `tblend`, `feedback` (VV→VV),
  `minterpolate`, `bilateral` (+`bilateral_cuda`), `guided`, `median`, `chromashift`,
  `rgbashift`, `chromaber_vulkan` (GPU-only), `curves`, `eq`, `hue`, `colorbalance`,
  `unsharp`, `gblur`, `noise`, `deband`, `interlace`, `il`, `monochrome`, `vignette`,
  `oscilloscope`, `showwaves`, `showspectrum`, `xbr`, `hqx`, `dilation`/`erosion`
  (morphology), `deshake`, `thumbnail`.
- `python3` 3.12.14 with: `cv2` 4.13.0, `numpy` 2.1.3, `scipy` 1.14.1, `PIL` 11.3.0.
- cv2 API surface verified: `bilateralFilter`, `CamShift`/`MeanShift`,
  `calcOpticalFlowFarneback`, `createBackgroundSubtractorMOG2`, `Subdiv2D` (Delaunay),
  `createCLAHE`, `inpaint`, `TrackerMIL`, `TrackerDaSiamRPN`, `TrackerNano`,
  `TrackerVit`, `TrackerGOTURN` (model download required), `EMD` (color transfer).
- cv2 limits verified: **no `ximgproc`** (opencv-python, not contrib → no built-in
  Kuwahara/niBlack; implement in numpy), **no `TrackerCSRT`/`TrackerKCF`** (contrib).
- **No `torch`, no `mediapipe`, no ONNX runtime, no provider API keys.**
- No GPU. 4 GB RAM; measured envelope above.

## 4. Cross-cutting enabling technologies

These are shared stages (the "capabilities compound" claim in ADR-012): one flow
engine, one mask engine, one edge engine, one palette engine serve many families.

### 4.1 Optical flow & frame interpolation
- **Farneback dense flow (`cv2.calcOpticalFlowFarneback`)** — OpenCV 4.13.0 ·
  BSD-3-Clause (OpenCV license) · commercial OK · CPU, ~real-time at 640×360 with
  downsampling · VERIFIED-LOCAL · temporal consistency: exact (deterministic) ·
  failure: large displacements, camera pans need global-motion compensation (the R606
  lane already has a green-profile cross-correlation stabilizer to reuse) ·
  classification: preferred-implementation-candidate (SPR engine stage) ·
  `cpu-local-runnable`. https://docs.opencv.org
- **RIFE (Practical-RIFE, hzwer)** — code+weights MIT per the PyPI `vsrife` card
  ("License MIT", https://pypi.org/project/vsrife/) and the MLX port card ("MIT
  (upstream Practical-RIFE © hzwer). Weights are the official RIFE 4.25 release",
  https://huggingface.co/mlx-community/RIFE-4.25) · paper: ACM/arXiv
  (https://arxiv.org/abs/2011.06294) · GPU-class (designed for real-time VFI on
  GPU; CPU infeasible for 25 fps) · known issue: smoothness artifacts on vertical
  motion (github issue, https://github.com/hzwer/Practical-RIFE) · classification:
  benchmark-only for SPR (interpolation, not stylization — but useful for
  SPR109 "on twos" re-timing) · `needs-gpu`.
- **FILM (Google, ECCV 2022)** — official repo license **verification deferred**;
  unofficial PyTorch ports Apache-2.0 (jkawamoto, https://huggingface.co/jkawamoto/frame-interpolation-pytorch
  "licensed under the Apache 2.0 License") · GPU-class · benchmark-only · `needs-gpu`.
- **ffmpeg `minterpolate`** — VERIFIED-LOCAL · LGPL/GPL ffmpeg licensing (LGPL build
  usable commercially) · CPU but slow (motion-compensated interpolation) ·
  fallback for re-timing · `cpu-local-runnable`. https://ffmpeg.org/ffmpeg-filters.html
- **Flow-guided stylization research** (the promotion path for neural): FlowVid
  (https://arxiv.org/abs/2312.08126), OFA flow-attention (https://openreview.net),
  "Fast Coherent Video Style Transfer via Flow Errors Reduction" (MDPI 2024,
  https://www.mdpi.com), MotionPrompt (CVF 2025, https://openaccess.thecvf.com),
  Disney color propagation (https://la.disneyresearch.com) — all GPU research;
  classification: experimental · `needs-gpu`.

### 4.2 Subject masking / matting / segmentation
- **MOG2 background subtraction (`cv2.createBackgroundSubtractorMOG2`)** —
  BSD-3-Clause · VERIFIED-LOCAL · CPU real-time · deterministic per params ·
  failure: moving camera (broadcast pans!) → needs global-motion compensation or
  fall back to frame-difference masks · preferred baseline for SPR202/SPR203/SPR205 ·
  `cpu-local-runnable`. http://opencv24-python-tutorials.readthedocs.io ,
  https://www.geeksforgeeks.org
- **SAM 2 (facebookresearch/sam2)** — code, checkpoints, demo AND training code all
  Apache 2.0 (README, https://github.com/facebookresearch/sam2; Meta blog "We're
  releasing SAM 2 under an Apache 2.0 license", https://ai.meta.com) · streaming
  memory for video, real-time class (42 fps claim in paper, https://arxiv.org/abs/2408.00714) ·
  known issue: VRAM grows with video length (HF forum,
  https://discuss.huggingface.co) · classification: experimental (masking enabler for
  segmentation-guided stylization) · `needs-gpu` (tiny/small variants CPU-possible
  but unverified here — treat as `needs-gpu`).
- **MODNet** — code Apache-2.0; **model weights Apache 2.0** per the HF port card
  ("Model weights are licensed under Apache 2.0 by the original authors",
  https://huggingface.co/ , card `modnet-portrait-matting-apache-license-2.0`) ·
  portrait/selfie-focused → weak for distant full-body football players (recorded
  honestly) · classification: benchmark-only · `needs-gpu` (CPU marginal).
- **Robust Video Matting (RVM)** — code MIT; **model weights CC-BY-NC 4.0 — RED
  FLAG, no commercial use** (github issue #198 "the model weights are licensed under
  CC-By-NC license that prevents any commercial usage", https://github.com/PeterL1n/RobustVideoMatting;
  paper page https://peterl1n.github.io/RobustVideoMatting) · classification:
  benchmark-only, license-gated · `needs-gpu`.
- **MediaPipe Selfie Segmentation / Image Segmenter** — code Apache-2.0
  (https://github.com/ , `selfie_segmentation.py` "Licensed under the Apache
  License"; https://developers.google.com/edge/mediapipe) · CPU real-time class ·
  person-focused (not pitch) · classification: fallback / experimental player-mask ·
  `cpu-local-after-pip` (mediapipe install; no key).

### 4.3 Depth (for clay/low-poly/voxel 3D feel, focus)
- **Video Depth Anything / Depth Anything V2** — CVPR 2025
  (https://github.com/DepthAnything/Video-Depth-Anything) · temporally consistent
  long-video depth · speed: 42 fps on A100 (oVDA paper,
  https://arxiv.org) — GPU-class · code license **verification deferred** (repo
  LICENSE not captured by search) · classification: experimental · `needs-gpu`.

### 4.4 Upscaling / detail restoration (post-stylize cleanup)
- **Anime4K (bloc97)** — MIT (shader header "MIT License // Copyright (c) 2019",
  https://github.com/bloc97/Anime4K; AUR card "Licenses: MIT",
  https://aur.archlinux.org/packages/anime4k-git) · real-time anime
  upscale/restore designed for GPU shaders (GLSL/mpv) · note: "Anime4K is not an
  upscaling algorithm" in the strict sense (analysis, https://redvice.org) ·
  classification: fallback/enhancer for SPR102 outputs · `needs-gpu` (GLSL path);
  CPU port = reimplementation work (`cpu-local-after-pip` equivalent effort).
- **Real-ESRGAN** — BSD 3-Clause (LICENSE at master,
  https://github.com/xinntao/Real-ESRGAN) · code+weights BSD-3 (permissive; one
  2026 vendor write-up flags "license restricts commercial use" for VSR variants —
  treat the VSR/BasicVSR++ lane as verify-before-commercial, https://www.forasoft.com) ·
  GPU-class for video · classification: benchmark-only · `needs-gpu`.
- **ffmpeg `xbr` + `hqx`** — VERIFIED-LOCAL pixel-art upscalers · deterministic ·
  `cpu-local-runnable`. https://ffmpeg.org/ffmpeg-filters.html
- **Pyxelate / Super Pyxelate (sedthh)** — pixel-art downsample+palette (github,
  https://github.com/bycloudai/pyxelate-video mirror noted; original
  https://github.com/sedthh/pyxelate) · license **verification deferred** (not
  captured; several mirrors are MIT — do not assume) · deterministic, CPU-heavy but
  640×360 feasible · classification: experimental · `cpu-local-after-pip` (needs
  sklearn/deps — verify).

### 4.5 Neural video generation / restyle (the GPU/hosted class)
- **vid2vid / few-shot-vid2vid (NVIDIA)** — **CC BY-NC-SA 4.0, RED FLAG
  non-commercial** (LICENSE.txt at master: "Licensed under the CC BY-NC-SA 4.0
  license", https://github.com/NVIDIA/vid2vid) · also pose/segmentation-conditioned
  (needs per-frame semantic maps) · classification: benchmark-only · `needs-gpu`.
- **Pix2Video** — text-guided video editing via image diffusion (CVPR 2023,
  https://openaccess.thecvf.com, https://duyguceylan.github.io/Pix2Video/) ·
  research code, license **verification deferred** · `needs-gpu`.
- **FlowVid** — flow-conditioned V2V (https://arxiv.org/abs/2312.08126) · research ·
  `needs-gpu`.
- **LTX-Video / LTX-2 (Lightricks)** — **restricted open-weights license**: commercial
  entities above a revenue threshold must buy a commercial license
  (LTX-Video-Open-Weights-License-0.X.txt, https://huggingface.co/Lightricks/LTX-Video;
  "Organizations above this threshold are required to obtain a commercial license",
  https://www.globenewswire.com; contact ltxv-licensing@lightricks.com) · RED FLAG:
  not OSI-open for commercial Sporta use · classification: byok-option (paid lane
  only) · `needs-gpu`.
- **Index-AniSora (bilibili)** — anime video generation; **V3 weights Apache 2.0**
  ("Anisora V3 weights are now licensed under Apache 2.0",
  https://github.com/bilibili/Index-anisora; https://huggingface.co/IndexTeam/Index-anisora) ·
  BUT generative (image/text→video): regenerates motion → violates
  source-preserving invariants for restyle use · classification: benchmark-only (NOT
  a restyle engine) · `needs-gpu`.
- **DynamiCrafter** — open-domain image animation (https://github.com/Doubiiu/DynamiCrafter,
  https://arxiv.org/abs/2310.12190) · website content CC BY-NC-SA (license of code
  **verification deferred**) · generative — same invariant problem · benchmark-only ·
  `needs-gpu`.
- **ToonCrafter** — generative cartoon interpolation (https://doubiiu.github.io/ToonCrafter/;
  https://arxiv.org/abs/2405.17333) · **website content CC BY-NC-SA 4.0** → treat
  non-commercial until code license verified · benchmark-only · `needs-gpu`.
- **Diffutoon (ECNU-CILab)** — diffusion toon shading explicitly for transforming
  photoreal video to anime, high-res, long clips (https://ecnu-cilab.github.io/Diffutoon/; 
  https://arxiv.org/abs/2402.16092) · repo license **verification deferred** ·
  classification: benchmark-only (the single most on-mission diffusion candidate,
  but GPU + diffusion = cost/temporal risk) · `needs-gpu`.

### 4.6 Neural style transfer (image-per-frame + flow propagation)
- **AnimeGANv2** — TF repo TachibanaYoshino (https://github.com/TachibanaYoshino/AnimeGANv2),
  PyTorch port bryandlee (https://github.com/bryandlee/animegan2-pytorch) · port
  speed: "2-3 s on CPU per image" (https://ai-engine.net) · code MIT (port) ·
  **weights provenance: trained on artistic film frames; license/usage terms of
  upstream weights verification deferred — flag before commercial use** ·
  per-frame NST without flow guidance → temporal flicker risk high ·
  classification: experimental · `cpu-local-after-pip` (torch-CPU; ~2.5 s × 1190
  frames ≈ 50 min/clip — technically CPU-possible, practically GPU territory).
- **ReReVST / CompoundVST (daooshee)** — zero-shot temporally-consistent VST
  frameworks (https://daooshee.github.io/ReReVST/ , https://daooshee.github.io/Compound-VST/ ;
  AAAI paper https://ojs.aaai.org) · flow-guided, designed exactly for the temporal
  problem · research code, licenses **verification deferred** · classification:
  experimental · `needs-gpu`.
- **video-nst (iSach)** — consistent NST playground (https://github.com/iSach/video-nst) ·
  classification: benchmark-only · `needs-gpu`.
- **ReCoNet** — real-time consistent VST (paper trail via
  https://www.semanticscholar.org) · research · `needs-gpu`.
- **Kornia** — differentiable cv2 (Apache-2.0, https://pypi.org/project/kornia/ ;
  https://github.com/kornia/kornia) · has Kuwahara + bilateral + box-blur =
  drop-in GPU versions of our stages · classification: fallback (GPU port of
  deterministic stages) · `needs-gpu` (CPU via torch-CPU possible but pointless vs
  cv2) — `cpu-local-after-pip` technically.

### 4.7 Example-based propagation (the "rotoscope" bridge)
- **EbSynth (Secret Weapons)** — example-based stylization: paint ONE keyframe,
  propagate (https://github.com/jamriska/ebsynth ; https://dcgi.fel.cvut.cz —
  "Stylizing Video by Example") · free including commercial use per beta-era
  coverage ("you can download it for free, even for commercial purposes",
  https://www.skwigly.co.uk); CG Channel 2025: videos with manually made style
  frames "are covered by EbSynth's own terms of use" (https://www.cgchannel.com) ·
  terms at https://ebsynth.com · deterministic-ish propagation (patchmatch), strong
  temporal consistency by construction (propagates from keyframes) · failure:
  large motion/occlusion → artifacts; needs keyframe authoring (manual or staged) ·
  classification: experimental + byok-option (CLI exists; automation work needed) ·
  `cpu-local-after-pip`/binary (no GPU required) — feasibility GOOD if keyframe
  authoring is solved (a deterministic stylized frame from OUR engine can be the
  example frame!). This is the highest-leverage wave-2 idea: **own deterministic
  frame as the EbSynth example → EbSynth propagates a hand-painted look**.

### 4.8 Hosted inference providers (BYOK lane)
- **Replicate** — Seedance 2.0 $0.10/s (480p), $0.08/s tier
  (https://replicate.com/seedance); aggregator comparisons "$0.04–$0.30 per video
  second" (https://www.teamday.ai), "roughly $0.10–$0.20 per second"
  (https://rangy.ai); one 2025 regional write-up quotes "$0.50 per second" for
  premium models (https://wise.com) — pricing VERIFIED-AGAINST-CURRENT-DOCS as
  *search snippets, not a contract*; **free tier: no documented free tier for video
  models — ASSUMED-ABSENT** · classification: byok-option · `needs-provider-key`.
- **Runway** — Gen-4.5 API ~$0.12/generated second (https://www.therundown.ai);
  $15/mo Standard = 625 credits ≈ 52 s Gen-4.5 (https://runway.com,
  https://kie.ai) · free tier: historical free credits — **ASSUMED, unverified** ·
  restyle = their web "video-to-video" (product feature, API lane is
  image-to-video) · classification: byok-option · `needs-provider-key`.
- **fal.ai** — free tier documented ("Get started with a free tier",
  https://fal.ai) — VERIFIED-AGAINST-CURRENT-DOCS (existence only; quotas
  unverified) · images $0.02–$0.05 (https://www.wireflow.ai) · classification:
  byok-option · `needs-provider-key`.
- **No provider keys exist in this sandbox** (VERIFIED-LOCAL, .env has none — per
  worklog w6 entries). All hosted lanes are PENDING until an operator supplies keys.

---

## 5. SPR101 — Cartoon / Cel

Goal: flat color regions, readable silhouettes, clean dark outlines, minimal flicker.

1. **Sporta deterministic stack — `spr-cartoon-cel-dc1` (Worker B, in flight)**
   - technology: bilateral flatten (cv2 `bilateralFilter`, 2–3 iterations) →
     fixed-per-clip LAB palette quantization (palette sampled from N frames →
     deterministic) → XDoG edge overlay (dark lines).
   - source: Sporta-owned implementation per contract; classical references below.
   - version: renderer 0.1.0 (contract registry).
   - license: Sporta-owned code; OpenCV BSD-3 + ffmpeg (LGPL build) — commercial OK.
   - runtime: CPU, ~0.5–2 fps/frame-pass budget at 640×360 — VERIFIED-LOCAL tooling.
   - latency/cost: zero marginal cost; full b8 (47.6 s/1190 frames) within the
     ~15 min packet-B budget if bilateral iterations ≤ 3.
   - quality expectation: flat graphic look, low flicker (fixed palette = strong
     temporal stability; XDoG threshold hysteresis needed on grass texture).
   - temporal consistency: excellent by construction (deterministic, no per-frame
     re-styling state beyond a fixed palette).
   - failure modes: XDoG line crawl on noisy 640×360 grass (mitigate: pre-blur +
     temporal line smoothing via flow-warp averaging); palette banding on sky/stands.
   - integration: SPE-v1 stage library (Packet B owns).
   - replacement strategy: renderer registry row; swap neural adapter later.
   - classification: **preferred-implementation-candidate** · `cpu-local-runnable`.
2. **OpenCV cartoonify reference pattern** (bilateral + adaptive-threshold edges +
   bitwise_and mask) — the standard tutorial stack
   (https://www.geeksforgeeks.org , https://datahacker.rs , https://dev.to ,
   https://www.analyticsvidhya.com) — same verdicts as (1); use as recipe evidence,
   not as the implementation (adaptive-threshold edges are noisier than XDoG).
   classification: fallback reference · `cpu-local-runnable`.
3. **XDoG (Winnemöller)** — the edge engine: "XDoG: An eXtended
   difference-of-Gaussians compendium" (Princeton/Adobe,
   https://www.cs.princeton.edu , https://research.adobe.com) — algorithm is public
   (paper), implement in numpy; reference implementations exist (github
   "Extended Difference of Gaussians (xDoG) implementation",
   https://github.com/ ; GIMP ships DoG, https://discourse.gnome.org) · XDoG has a
   soft threshold giving sketch/tonal looks — dual use for SPR104. classification:
   preferred stage · `cpu-local-runnable`.
4. **AnimeGANv2** (see §4.6) — cartoon-ish portrait bias, 2–3 s/frame CPU ·
   classification: experimental · `cpu-local-after-pip` (impractical speed).
5. **Diffutoon** (see §4.5) — the diffusion-class ceiling for this family ·
   benchmark-only · `needs-gpu`.

Family verdict: deterministic stack is fully sufficient for Tier-1; AnimeGANv2 is
the cheapest neural A/B; Diffutoon is the quality reference to chase in wave-3+.

## 6. SPR102 — Anime / NPR

Goal: stronger flatten, K≈7 palette, line art, saturation lift, subtle bloom.

1. **Sporta deterministic stack — `spr-anime-npr-dc1` (Worker B, in flight)**
   stronger bilateral (median-pool assist), K≈7 palette, clean line art, saturation
   lift, optional bloom. All fields as SPR101(1). classification:
   **preferred-implementation-candidate** · `cpu-local-runnable`.
2. **Anime4K enhancement pass** (bloc97, MIT — §4.4) applied to OUR anime output to
   crispen lines/edges (restore-class, not restyle) · `needs-gpu` via GLSL path;
   honest note: running it in-sandbox requires a CPU port of the shader chain.
   classification: fallback (post-process enhancer) · `needs-gpu`.
3. **AnimeGANv2** — actual anime appearance transfer; CPU 2–3 s/frame
   (https://ai-engine.net); weights provenance flag (§4.6). classification:
   experimental · `cpu-local-after-pip`.
4. **Index-AniSora V3** (Apache-2.0 weights, §4.5) — generative anime video;
   produces NEW motion — **forbidden for source-preserving restyle** (slideshow/
   reality-drift anti-pattern); kept only as an external quality reference.
   classification: benchmark-only · `needs-gpu`.
5. **ToonCrafter** — NC-licensed research; not a restyle engine. classification:
   benchmark-only · `needs-gpu`.

Family verdict: deterministic + optional Anime4K-style crispening = Tier-1; the
neural anime lane (AnimeGANv2) is the wave-2 trial with the best cost/benefit.

## 7. SPR103 — Watercolor / Painterly

Goal: soft edge-preserved blots, wet edges, paper grain.

1. **Anisotropic Kuwahara filter (Kyprianidis et al. 2009)** — the canonical
   painterly-abstraction filter, explicitly published for IMAGES AND VIDEO ("Image
   and Video Abstraction by Anisotropic Kuwahara Filtering",
   https://onlinelibrary.wiley.com , https://www.kyprianidis.com ,
   https://www.researchgate.net) · algorithm public; implementations: GPU-focused
   (TD port GPL-3.0 https://github.com/yeataro/TD-Anisotropic-Kuwahara ; HLSL gist
   https://gist.github.com ; an MIT-licensed GPU-tools repo
   https://raymondmcguire.github.io ; yoch/pykuwahara
   https://github.com/yoch/pykuwahara — license **verification deferred**; kornia
   has a Kuwahara (Apache-2.0, https://kornia.readthedocs.io)). None of these is a
   turnkey CPU-video pipeline → **implement the anisotropic variant in numpy over
   flow-aligned local windows** (Sporta-owned, ~O(n·k²) at 640×360 with k=8–12 —
   feasible but the heaviest deterministic stage; budget test needed).
   - quality: painterly abstraction with edge preservation; the anisotropic version
     avoids the "clustering artifacts" the paper documents for the classic variant.
   - temporal consistency: good (deterministic filter), but per-frame independent →
     edge-flow crawl on texture; mitigate with temporal pre-smoothing.
   - failure modes: over-abstraction of the ball (small fast object); heavy CPU.
   - classification: **preferred-implementation-candidate (wave-2 trial — heavy)** ·
     `cpu-local-runnable` (with perf work) — verify frame budget on b12 first.
2. **Deterministic watercolor stack (fallback baseline)**: stacked median blur
   (3-5-7 "oil" stack) + LAB palette (K≈12) + paper-grain overlay (fixed noise
   texture) + edge darkening from XDoG at low epsilon + saturation lift — all
   VERIFIED-LOCAL primitives. classification: fallback (wave-1 safe baseline) ·
   `cpu-local-runnable`.
3. **Neural VST (ReReVST / CompoundVST)** — flow-guided painterly styles are their
   demo cases; research, GPU. classification: experimental · `needs-gpu`.
4. **EbSynth example-based** (§4.7): render one deterministic watercolor keyframe,
   hand-tune it, propagate. classification: experimental / byok-option ·
   `cpu-local-after-pip`.

## 8. SPR104 — Ink / Manga / Comic

Goal: monochrome line art, screentone halftones, ink hatching.

1. **Deterministic ink stack**: grayscale → XDoG with soft threshold (Winnemöller's
   sketch mode — the XDoG paper itself demonstrates sketch/toon looks,
   https://www.cs.princeton.edu) → posterize to 2–3 ink levels → **Bayer ordered
   dithering / halftone screentone** in numpy (ordered dithering is pure math;
   reference implementations: python-halftone
   https://github.com/philgyford/python-halftone (license **verification
   deferred**), Processing halftone tutorial
   https://tabreturn.github.io ; screentone usage context
   https://tips.clip-studio.com) + paper grain. classification:
   **preferred-implementation-candidate** · `cpu-local-runnable`. Temporal: strong
   (deterministic); halftone dot crawl is the known failure → fix dot grid to
   screen space (fixed lattice, not per-frame adaptive).
2. **Line-art-only variant**: Canny/Sobel (cv2) + morphological cleanup + white
   background + ink-weight LUT. classification: fallback · `cpu-local-runnable`.
3. **Neural keyframe + EbSynth**: ControlNet lineart/ink style on sparse keyframes
   (e.g. every 24th frame) → EbSynth propagation between keys — the only neural
   path that respects temporal consistency at sane cost; still GPU + authoring.
   classification: experimental · `needs-gpu` + key.

## 9. SPR105 — Clay / Toy

Goal: plasticine/stop-motion feel. **Honest finding: this family has NO turnkey
open-source video filter** — searches (s31) return 3D-app tutorials (Cinema 4D,
Blender clay shaders, Maya), style-transfer image tools (oakgen.ai), and shader
references — nothing pipeline-ready (§22 gaps).

1. **Deterministic clay approximation (Sporta-owned)**: strong bilateral flatten +
   wide-step palette (K≈10, warm clay hues) + subtle spherical-domain noise
   displacement (fixed PRNG per region = fingerprint texture) + **frame-rate
   quantization to ~10–12 fps "on twos"** (stop-motion cadence — re-timed back to
   25 fps via frame duplication, NOT interpolation, to keep the stutter) + soft
   specular bump fake from luma. Deterministic, cheap, honest "toy" caricature.
   classification: **preferred-implementation-candidate (only real baseline)** ·
   `cpu-local-runnable`.
2. **Depth-guided matte shading**: Video Depth Anything (§4.3) → normal map →
   diffuse-only shading multiply → quantize — gives actual 3D clay light response.
   classification: experimental · `needs-gpu`.
3. **Hosted clay style tools (oakgen.ai, https://oakgen.ai and similar)** —
   per-frame image generation products → **NOT RECOMMENDED: per-frame generative
   restyle is the forbidden slideshow anti-pattern** (ADR-012 compliance), plus
   per-frame cost with no temporal guarantee. Recorded for completeness only.

## 10. SPR106 — Low-poly / Voxel

Goal: faceted flat-shaded geometry / blocky voxel look, same motion.

1. **Deterministic low-poly**: gradient-magnitude-weighted point sampling (fixed
   density, per-clip seeded) → **`cv2.Subdiv2D` Delaunay triangulation
   (VERIFIED-LOCAL)** or `scipy.spatial.Delaunay` (scipy 1.14.1 VERIFIED-LOCAL) →
   per-triangle flat color (mean color, palette-snapped). Deterministic; point set
   from a temporally-smoothed saliency (box-average of gradients over a 5-frame
   window) to suppress triangle flicker. classification:
   **preferred-implementation-candidate** · `cpu-local-runnable` (budget: ~2–5 k
   triangles/frame OK).
   - references: "Parallel Low Poly Style Image/Video Converter" (CUDA class
     solution, https://darkforte.github.io) proves the approach and the GPU ceiling;
     a TouchDesigner/ffmpeg ecosystem exists but no maintained CPU video tool found.
2. **Deterministic voxel**: block-downsample (nearest) to e.g. 96×54 blocks +
   palette quantization + optional per-block luma bump (fake 3D) + slight block
   grid. classification: **preferred-implementation-candidate** ·
   `cpu-local-runnable`.
   - honest note: true mesh voxelizers (Forceflow/cuda_voxelizer,
     https://github.com/Forceflow/cuda_voxelizer — CUDA + mesh input) are the WRONG
     modality for video (need a 3D mesh); recorded so nobody burns a week on it.
3. **Depth-weighted variants**: Video Depth Anything (§4.3) to modulate triangle
   density / block height for parallax-lite. classification: experimental ·
   `needs-gpu`.

## 11. SPR107 — Neon / Cyberpunk

Goal: magenta/cyan grade, glowing highlights, scanlines, night-city vibe.

1. **Deterministic neon stack**: hue-rotate toward magenta/cyan split-toning
   (shadows→cyan, highlights→magenta via LUTs) + highlight threshold → Gaussian
   blur → screen-add **bloom** (the standard bloom recipe —
   https://learnopengl.com/ ; an image-bloom tool reference
   https://github.com/ , https://www.brushcue.com) + scanline overlay (fixed
   lattice) + chromatic aberration via per-channel shift in numpy + noise + slight
   vignette. All VERIFIED-LOCAL primitives. classification:
   **preferred-implementation-candidate** · `cpu-local-runnable`.
2. **ffmpeg filtergraph variant**: `eq`/`hue`/`curves`/`colorbalance` + `gblur` +
   `noise` + `vignette` (all VERIFIED-LOCAL) — encoder-side fallback, zero custom
   code. classification: fallback · `cpu-local-runnable`.
   (ffmpeg's `chromaber_vulkan` exists but is GPU-only — VERIFIED-LOCAL.)
3. **Neural/hosted**: ControlNet "neon" restyle per frame → forbidden anti-pattern;
   full V2V (Pix2Video/FlowVid class) → cost + temporal risk. classification:
   not-recommended for wave-2 · `needs-gpu`.

## 12. SPR108 — Noir / Retro / VHS (Worker B: `spr-noir-retro-dc1`)

1. **Deterministic noir**: luma-only + S-curve contrast LUT + fixed-PRNG grain +
   vignette + optional halation (blur-add) + letterbox. classification:
   **preferred-implementation-candidate** · `cpu-local-runnable`.
2. **Deterministic VHS**: `chromashift`/`rgbashift` (VERIFIED-LOCAL, ffmpeg 7.1.5)
   + `noise` + luma/chroma degrade + occasional tracking-bar wipe + interlace-ish
   jitter + tape hiss pass. References: "Creating Vintage Video Filters with
   FFmpeg" (rgbashift recipe, https://zayne.io), superuser thread
   (https://superuser.com), ffmpeg filters docs (https://ffmpeg.org/ffmpeg-filters.html).
   classification: **preferred-implementation-candidate** · `cpu-local-runnable`.
3. **1970s film profile**: `curves` + heavy grain + halation + 2.39:1 + warm LUT.
   classification: fallback (profile of the same renderer) · `cpu-local-runnable`.
4. Neural: none needed; consumer web VHS filters (https://www.vinxle.com ,
   https://www.vsco.co) are not API candidates — recorded only to close the loop.

## 13. SPR109 — Rotoscope (interpolated, à la Waking Life)

1. **Deterministic interpolated-rotoscope stack**: the SPR101/102 flatten+palette
   engine + frame-rate quantization to 12 fps ("on twos") + **re-timing to 25 fps
   via frame duplication** (keep the snappy cadence) — optional `minterpolate`
   (VERIFIED-LOCAL) variant for smooth-but-stylized. This is the classical
   "vectorized/interpolated rotoscope" caricature and it is fully honest: same
   pixels, same motion, stylized appearance. classification:
   **preferred-implementation-candidate** · `cpu-local-runnable`.
2. **EbSynth** (§4.7) — the real artist-in-the-loop rotoscope: paint keyframes,
   propagate between them; terms allow commercial work (per skwigly/CG Channel,
   §4.7). Integration: CLI automation + keyframe authoring step (a deterministic
   Sporta frame can seed it). classification: experimental / byok-option ·
   `cpu-local-after-pip`.
3. **Interactive rotoscope tools** — Cutie-Roto (AI-assisted, fork of Cutie,
   https://github.com/Zarxrax/Cutie-Roto), Blender Grease Pencil + rotoscope
   (Blender is GPL tooling, https://borisfx.com lists Blender/Synfig as open-source
   rotoscope tools) — artist tools, not pipeline; BYOK lane. classification:
   byok-option · `cpu-local-after-pip` (GUI, not headless — integration high).
4. **Mask-driven auto-rotoscope**: SAM2/RVM person masks (§4.2) → flat-fill
   characters over stylized background — RVM weights are CC-BY-NC (RED FLAG);
   SAM2 Apache-2.0. classification: experimental (SAM2 variant) / benchmark-only
   (RVM variant) · `needs-gpu`.

## 14. SPR201 — Motion trails (Worker B: `spr-motion-trails-dc1`)

1. **Farneback flow-weighted trail accumulation** (VERIFIED-LOCAL
   `calcOpticalFlowFarneback`): per-pixel flow magnitude → threshold (motion mask)
   → exponential accumulate with cut-reset (scene-change detection by frame-diff +
   histogram distance) → colorized trail composite. Deterministic; temporal
   consistency trivial (it IS a temporal signal). failure: Farneback fails on big
   pans → reuse the R606 global-motion compensation trick or gate trails on
   static-camera segments (honest degradation note). classification:
   **preferred-implementation-candidate** · `cpu-local-runnable`.
2. **ffmpeg encoder-side trails**: `tmix` (verified) for frame blending;
   `tblend` (verified) for pairwise; the `feedback` filter (VV→VV, verified) for
   recursive trails; `minterpolate`+`tblend` for directional smear. Zero custom
   code. classification: fallback · `cpu-local-runnable`.
   (references: https://video.stackexchange.com motion-blur thread,
   https://blog.programster.org frame interpolation,
   https://ffmpeg.org/ffmpeg-filters.html)
3. **Neural flow trails**: RIFE/RAFT flows as higher-quality warp fields (§4.1) ·
   classification: experimental · `needs-gpu`.

## 15. SPR202 — Silhouette / X-ray

1. **MOG2 silhouette mask** (VERIFIED-LOCAL) → threshold + binarized ink fill or
   false-color "x-ray" LUT (thermal) + rim glow. Failure: camera pans corrupt the
   background model → global-motion-compensate (reuse R606 stabilizer) or degrade
   to (2). classification: **preferred-implementation-candidate** ·
   `cpu-local-runnable`.
   (references: OpenCV background-subtraction tutorials
   http://opencv24-python-tutorials.readthedocs.io ,
   https://www.geeksforgeeks.org , https://learnopencv.com — note
   https://blog.savant-ai.io builds a CUDA MOG2 service; the CPU cv2 path is what
   we use.)
2. **Frame-difference motion mask** (numpy absdiff, threshold, morphology) —
   pan-robust, deterministic, weaker semantics (shows motion, not bodies).
   classification: fallback · `cpu-local-runnable`.
3. **Neural masks**: SAM2 (Apache-2.0, streaming memory — §4.2) for person
   silhouettes; RVM matting (weights CC-BY-NC — RED FLAG, benchmark-only); MODNet
   (Apache-2.0, portrait-biased — weak at wide shots). classification:
   experimental (SAM2) · `needs-gpu`.

## 16. SPR203 — Tactical overlay (source-enhancing, honest degradation)

1. **Deterministic motion-energy overlay**: MOG2/flow blob tracks (image-space) →
   player markers + possession-heat accumulation + pitch-grid overlay drawn in
   IMAGE SPACE with an explicit "SWM fact unavailable — overlay degraded" note per
   ADR-012 §8 honest-degradation rule. No calibration dependency (the R606
   lesson). classification: **preferred-implementation-candidate** ·
   `cpu-local-runnable`.
2. **SWM-guided variant (in-repo)**: when the W303-class calibrator lands
   (BroadcastLineCalibrator v0.1.0, sporta-wc — from the worklog), project markers
   to pitch space; this is the upgrade path, config-swapped not code-swapped.
   classification: fallback-until-calibrated · `cpu-local-runnable`.
3. **Sports-field registration research** (the calibration enablers — recorded for
   the W303 lane, NOT required for SPR): TVCalib
   (https://mm4spa.github.io/TVCalib/), "No Bells, Just Whistles" (github,
   SoccerNet-pretrained — https://github.com), keypoint+homography pipelines
   (https://arxiv.org/abs/2410.06052 , https://blog.roboflow.com), open-source
   points-and-lines optimization (https://www.sciencedirect.com) — all GPU/torch
   class; licenses **verification deferred**. classification: experimental ·
   `needs-gpu`.
4. **Player detection models** (mask feed): YOLOv8x football keypoint model
   (https://huggingface.co/martinjolif/yolo-football-pitch-detection), soccer
   players tracking pipelines (https://github.com/francescopiocirillo/soccer-players-tracking ,
   YOLOv5-based https://github.com/), Roboflow pitch-segmentation models
   (https://universe.roboflow.com). classification: experimental · `needs-gpu` /
   `needs-provider-key` (Roboflow hosted).

## 17. SPR204 — Commentary-reactive

1. **Deterministic audio-reactive overlay**: RMS/spectral-band energy from the
   broadcast audio (numpy FFT — VERIFIED-LOCAL; the audio is already sliced in the
   R606 chain) → overlay pulse/glow/bar-ring keyed to excitement (energy envelope
   with hysteresis) + waveform strip. Deterministic, frame-locked to the timeline.
   classification: **preferred-implementation-candidate** · `cpu-local-runnable`.
   (ffmpeg references: showwaves/showspectrum recipes
   https://trac.ffmpeg.org/wiki/Waveform , https://www.glitch.cool , gist
   https://gist.github.com)
2. **ffmpeg `showwaves`/`oscilloscope` overlays** (VERIFIED-LOCAL filters) —
   encoder-side fallback visualizations. classification: fallback ·
   `cpu-local-runnable`.
3. **ASR/commentary semantics** — the repo already holds the lane (ADR-002
   commentary input; HF candidates: Qwen3-ASR-1.7B, VibeVoice-ASR-Streaming,
   SoccerChat — see `docs/technology/hugging-face-candidates.yaml`): reactive
   captions/keyword badges driven by real commentary. classification: byok-option
   (self-host models, GPU) / provider lane · `needs-gpu` or `needs-provider-key`.
4. **LLM mood mapping** (commentary→style intensity): byok-option; any provider;
   never a free-tier assumption. classification: byok-option.

## 18. SPR205 — Player-focus

1. **CAMSHIFT color tracking + stabilized zoom-crop** (VERIFIED-LOCAL `CamShift`):
   init ROI from MOG2 largest blob (jersey color histogram) → CAMSHIFT per frame →
   eased/smoothed crop window (critically-damped spring, deterministic) → zoom
   render + background dim via mask. Same timeline (crop is a spatial transform of
   the same frame — camera fidelity gate must interpret "camera" as source camera
   motion preserved, documented in the renderer config). classification:
   **preferred-implementation-candidate** · `cpu-local-runnable`.
   (references: https://docs.opencv.org , https://www.geeksforgeeks.org ,
   https://datahacker.rs)
2. **TrackerNano / TrackerVit / TrackerDaSiamRPN** (VERIFIED-LOCAL cv2 tracker
   classes; ONNX weights downloadable — Apache-2.0 model licenses **verification
   deferred**): stronger SOT tracking when CAMSHIFT drifts. Note TrackerCSRT/KCF
   are NOT in this opencv-python build (verified) — would need
   opencv-contrib-python. classification: experimental ·
   `cpu-local-after-pip` (+model download).
3. **Largest-blob fallback camera**: MOG2 blob → center-weighted crop. No color
   model needed; robust; less identity-aware. classification: fallback ·
   `cpu-local-runnable`.
4. **Neural player detection/tracking**: YOLO/SoccerNet-lane models (§16.4) +
   ByteTrack-style association. classification: experimental · `needs-gpu`.

---

## 19. Deterministic baselines are mandatory (per family)

The classical first implementation per family — this is ADR-012 decision 4, and
the research *proves* why:

| Family | Deterministic baseline (first implementation) |
|---|---|
| SPR101 cartoon/cel | bilateral flatten + fixed LAB palette quantization + XDoG dark lines |
| SPR102 anime/NPR | stronger flatten + K≈7 palette + line art + saturation lift (+ bloom) |
| SPR103 watercolor | median-stack abstraction + K≈12 palette + paper grain + soft XDoG edges; anisotropic Kuwahara as wave-2 upgrade |
| SPR104 ink/manga | grayscale + XDoG soft-threshold + screen-space Bayer/halftone screentone |
| SPR105 clay/toy | wide palette + bilateral + fixed-PRNG clay noise + 12 fps "on twos" quantization |
| SPR106 low-poly/voxel | gradient-sampled Delaunay flat-fill (cv2.Subdiv2D / scipy) · block-downsample + palette for voxel |
| SPR107 neon/cyberpunk | split-tone LUT + threshold-Gaussian bloom + scanlines + channel-shift CA |
| SPR108 noir/VHS | luma + S-curve + grain + vignette · chromashift/rgbashift + noise + tracking artifacts |
| SPR109 rotoscope | flatten+palette engine at 12 fps "on twos" re-timed by duplication |
| SPR201 trails | Farneback flow-magnitude accumulation with cut-reset |
| SPR202 silhouette | MOG2 mask (global-motion-compensated) or frame-difference mask + x-ray LUT |
| SPR203 tactical | motion-energy blobs + heat overlay + image-space grid (degraded-mode note) |
| SPR204 reactive | audio RMS/band envelope → keyed overlay pulse + waveform strip |
| SPR205 focus | CAMSHIFT + eased zoom-crop + background dim |

Why deterministic-first is CORRECT (not a compromise):

1. **Temporal consistency is solved by construction.** The research's central,
   repeated finding is that style-vs-temporal-consistency is THE conflict in video
   restyle (s01/s08/s17 families: CompoundVST, ReReVST, FlowVid, MotionPrompt all
   exist to fight flicker). A fixed palette + deterministic filters cannot flicker
   by construction — the exact property the Sporta acceptance gates police
   (static-region instability metric).
2. **Bit-exact reproducibility** (contract hard requirement) is only achievable
   with deterministic pipelines (fixed PRNG seeds, fixed palettes, ffmpeg bitexact
   encoding). Neural inference is not bit-reproducible across GPU/driver versions.
3. **Rights cleanliness**: OpenCV BSD-3 + ffmpeg (LGPL build) + own code = clean
   commercial path. The neural field is littered with CC-BY-NC weights (RVM,
   vid2vid, ToonCrafter-site) and threshold licenses (LTX) — §20.
4. **Zero marginal cost, no keys** — the sandbox reality; no free-tier assumption
   (ADR-012 compliance).
5. **They compound** (ADR-012 consequences): one flow/mask/palette/edge engine
   feeds all 14 families — the neural lane later swaps ONE adapter, not the
   architecture.

## 20. License discipline & red flags

LOUD flags (do NOT promote without legal review):

- **Robust Video Matting weights = CC BY-NC 4.0 — commercial use prohibited**
  (github issue #198, https://github.com/PeterL1n/RobustVideoMatting). Code MIT
  does not cure the weights. benchmark-only.
- **NVIDIA vid2vid / few-shot-vid2vid = CC BY-NC-SA 4.0** (LICENSE.txt,
  https://github.com/NVIDIA/vid2vid). Non-commercial only.
- **ToonCrafter website content = CC BY-NC-SA 4.0** (https://doubiiu.github.io/ToonCrafter/)
  — code license not verified; treat as non-commercial until proven otherwise.
- **LTX-Video/LTX-2 open-weights license = revenue-threshold-gated commercial
  terms** (must contact ltxv-licensing@lightricks.com above threshold;
  https://huggingface.co/Lightricks/LTX-Video ,
  https://www.globenewswire.com). Not a free-for-commercial license.
- **Real-ESRGAN VSR/BasicVSR++ lane**: one vendor analysis says "its license
  restricts commercial use" for those variants (https://www.forasoft.com) — the
  base Real-ESRGAN is BSD-3 (LICENSE, https://github.com/xinntao/Real-ESRGAN) but
  verify each checkpoint's terms.
- **AnimeGANv2 weights provenance** (trained on copyrighted film frames; upstream
  usage terms **verification deferred**) — flag before any commercial render.
- **EbSynth terms**: free incl. commercial per beta coverage
  (https://www.skwigly.co.uk) and 2025 coverage says style-frame-authored videos
  fall under EbSynth's own terms (https://www.cgchannel.com) — read
  https://ebsynth.com terms before production use.
- Clean-permissive confirmed: Anime4K MIT · RIFE MIT (code+weights, per cards) ·
  SAM 2 Apache-2.0 (code+checkpoints+training) · MODNet weights Apache-2.0 (HF
  port card) · MediaPipe Apache-2.0 · Kornia Apache-2.0 · FILM PyTorch ports
  Apache-2.0 · Index-AniSora V3 weights Apache-2.0 · OpenCV BSD-3.
- **Uncertainty recorded as uncertainty**: TVCalib / No-Bells / Diffutoon /
  Pix2Video / ReReVST / CompoundVST / video-nst / python-halftone / pykuwahara /
  Pyxelate / TrackerNano-Vit model weights — repo licenses not captured by search
  → "verification deferred" in the YAML.

## 21. Wave-2 recommendations

### Worth a trial (ordered by leverage):

1. **EbSynth propagation seeded by OUR deterministic keyframes** (SPR103/104/109).
   Evidence: https://github.com/jamriska/ebsynth , https://dcgi.fel.cvut.cz ,
   https://www.skwigly.co.uk , https://www.cgchannel.com . Rationale: the only
   technology that yields "hand-painted" quality with temporal consistency by
   construction, runs CPU, commercial-OK terms, and it consumes OUR renderer's
   output as input — provider-neutral, no GPU, no key. Trial: stylize keyframes
   (every ~24th) with the deterministic engine + optional artist pass → EbSynth
   propagate → measure vs baseline on the VLM scorecard.
2. **Anisotropic Kuwahara in numpy** (SPR103 upgrade). Evidence:
   https://onlinelibrary.wiley.com , https://www.kyprianidis.com (published for
   video), kornia ships it (https://kornia.readthedocs.io) proving mainstream
   viability. Rationale: single biggest painterly-quality jump available with zero
   new dependencies; budget-test on b12 first (heaviest deterministic stage).
3. **AnimeGANv2 A/B on b12** (SPR101/102 neural comparison). Evidence:
   https://github.com/bryandlee/animegan2-pytorch , CPU 2–3 s/frame
   (https://ai-engine.net). Rationale: cheapest honest neural comparison to satisfy
   the ADR-011 "beat the baseline with measured evidence" promotion gate — even if
   it loses, the evidence closes the question. Caveats: weights provenance flag
   (§20); per-frame NST will likely FAIL the static-region-instability metric —
   run it to document exactly that, with flow-warp averaging as the mitigation to
   test. If the pip install (torch-CPU) is unwanted in the venv, mark deferred.
4. **TrackerNano/TrackerVit for SPR205** (VERIFIED-LOCAL classes + ONNX
   download; license verify) — small, contained trial to harden player-focus
   tracking beyond CAMSHIFT.
5. **Screen-space fixed-lattice halftone for SPR104** — contained, deterministic,
   closes manga with zero risk (part of baseline work anyway).

### NOT worth it (and why):

- **Per-frame generative restyle of any kind** (img2img per frame, hosted
  clay/anime image tools, AniSora/ToonCrafter/DynamiCrafter "restyle" usage):
  the FORBIDDEN slideshow anti-pattern (Packet B FORBIDDEN list; ADR-012
  compliance "No slideshow-of-generated-frames as video"). Temporal identity of
  the match would be destroyed; per-frame cost ~$0.003–0.12/image or $0.04–0.30
  per video second on hosted video models (https://www.teamday.ai ,
  https://replicate.com/seedance) with no source-preservation guarantee.
- **Full V2V diffusion (FlowVid, Pix2Video, Diffutoon, vid2vid)** in wave-2:
  needs-gpu + needs-key/class, no GPU in sandbox; vid2vid + ToonCrafter are
  NC-licensed (red flags §20); Diffutoon is the only on-mission one and stays a
  recorded wave-3 benchmark-only candidate.
- **RIFE/RAFT flow upgrades for SPR201 trails**: Farneback at 640×360 is
  adequate for trail masks; the neural flow gain does not pay for GPU dep +
  MIT-but-heavy stack in wave-2. Wave-3 candidate only if trail quality gates fail.
- **RVM matting anywhere** (SPR202/109): weights CC-BY-NC — excluded from
  commercial path outright.
- **LTX-Video restyle lane**: license-threshold-gated + GPU + generative —
  byok-option at best, never architecture.
- **SoccerNet field-registration models for SPR**: wrong lane — SPR must not
  gate on calibration (the R606 lesson); they belong to the W303 reconstruction
  lane, not here.
- **Assuming hosted free tiers**: fal.ai documents a free tier (existence
  verified, quotas unverified); Replicate shows no free video tier; Runway free
  credits ASSUMED — none usable in this sandbox (no keys), per ADR-012.

## 22. Coverage gaps & verification deferred

- **No turnkey open-source claymation video filter exists** (s31: only 3D-app
  tutorials + hosted image tools) → SPR105 deterministic approximation is the only
  non-neural path; the family is the weakest match between ambition and tech.
- **No maintained CPU low-poly video tool** (s11: a CUDA class project) → own
  Delaunay implementation (primitives VERIFIED-LOCAL).
- **No headless rotoscope pipeline** (s14: tools are interactive/GUI) →
  deterministic interpolated-rotoscope + EbSynth are the honest paths.
- Repo-license verifications deferred (search snippets did not capture LICENSE
  files): TVCalib, No-Bells-Just-Whistles, Diffutoon, Pix2Video, FlowVid, ReReVST,
  CompoundVST, video-nst, python-halftone, pykuwahara, Pyxelate, EbSynth full
  terms, TrackerNano/Vit ONNX weights, DaSiamRPN weights, FILM official repo,
  Video-Depth-Anything. All recorded as `verification deferred` in the YAML —
  none of these is load-bearing for wave-2 trials #1/#2/#5.
- AnimeGANv2 upstream (TachibanaYoshino) weight terms: deferred (s60 query
  returned unrelated results).
- Two searches hit 429 rate-limit (first attempt of the AnimeGANv2 license query
  and one other); the AnimeGANv2 retry returned off-target results — recorded.

## 23. Search log (63 invocations, 2026-09-24, z-ai `web_search` CLI)

s01 video style transfer temporal consistency github · s02 video-to-video
diffusion open source github · s03 Anime4K anime filter real-time upscaling
license · s04 XDoG extended difference of gaussians edge filter implementation ·
s05 Kuwahara filter painterly video stylization opencv · s06 cartoon filter opencv
bilateral edge mask video python · s07 RIFE real-time intermediate flow
estimation github license · s08 flow-based video stylization optical flow
propagation paper · s09 football player segmentation pitch detection github ·
s10 ControlNet video stylization diffusion open source · s11 low poly video
conversion algorithm github · s12 voxelization video real-time github · s13 cel
shading toon shading real-time video filter · s14 rotoscoping open source
interpolated rotoscoping software · s15 Replicate video stylization API pricing
per second · s16 Hugging Face video-to-video transformation models 2025 · s17
temporal consistency video style transfer paper 2024 2025 · s18 MODNet
RobustVideoMatting video matting license github · s19 SAM 2 segment anything
video streaming memory · s20 EbSynth example-based stylization video github ·
s21 ffmpeg vhs retro effect filters chroma shift grain · s22 ffmpeg tmix frame
blending motion trails effect · s23 opencv background subtraction MOG2 silhouette
video python · s24 Real-ESRGAN video upscale license commercial use · s25 waifu2x
anime upscale BSD-3-Clause license · s26 Stylized Neural Video animated textures
Fischer · s27 MediaPipe selfie segmentation license commercial · s28 soccer pitch
line detection homography calibration github · s29 ink manga halftone dot effect
image processing python · s30 depth anything v2 monocular depth video temporal ·
s31 claymation clay render style filter stop motion shader · s32 cyberpunk neon
glow filter opencv bloom · s33 ffmpeg showwaves audio reactive visualization
filter video · s34 CAMSHIFT object tracking zoom crop video opencv python · s35
DynamiCrafter VideoCrafter2 open-domain video generation license · s36 LTX-Video
Lightricks open weights license commercial · s37 Go2Py soda football player
detection tracking github · s38 Kornia computer vision differentiable library
license · s39 FAL AI video stylization pricing API · s40 pixel art posterize
downsample video effect python · s41 RobustVideoMatting model weights license
CC-BY-NC commercial · s42 MODNet portrait matting license model weights
commercial use · s43 AnimeGANv2 animegan2-pytorch license commercial · s44
Diffutoon anime video stylization github license · s45 ToonCrafter generative
cartoon github license · s46 libku anisotropic kuwahara github license · s47
Stylized Neural Video github NVIDIA license · s48 SAM 2 checkpoints license
commercial use Apache · s49 Real-ESRGAN model weights license BSD-3-Clause
commercial · s50 EbSynth license terms commercial use · s51 Runway Gen-4
video-to-video restyle API pricing · s52 Index-AniSora anime video generation
model license · s53 FILM large motion frame interpolation github license · s54
vid2vid NVIDIA video to video synthesis github license · s55 RIFE Practical-RIFE
github MIT license weights · s56 bloc97 Anime4K github MIT license · s57 Pyxelate
pixel art github license MIT · s58 kornia kuwahara filter python · s59 video
depth anything CPU inference speed · s60 AnimeGANv2 github license weights
non-commercial (retry; off-target results) · s61 NVIDIA vid2vid license
non-commercial CC BY-NC-SA · s62 Pix2Video video editing diffusion code github ·
s63 daooshee ReReVST compound video style transfer github.

Raw JSON results retained at `/tmp/spr-search/s01..s63.json` (session-local, not
repo artifacts).

## 24. Source index (primary URLs cited)

GitHub / code: https://github.com/bloc97/Anime4K · https://github.com/hzwer/Practical-RIFE ·
https://github.com/facebookresearch/sam2 · https://github.com/PeterL1n/RobustVideoMatting ·
https://github.com/xinntao/Real-ESRGAN · https://github.com/NVIDIA/vid2vid ·
https://github.com/NVlabs/few-shot-vid2vid · https://github.com/jamriska/ebsynth ·
https://github.com/bilibili/Index-anisora · https://github.com/Doubiiu/DynamiCrafter ·
https://github.com/kornia/kornia · https://github.com/iSach/video-nst ·
https://github.com/yeataro/TD-Anisotropic-Kuwahara · https://github.com/yoch/pykuwahara ·
https://github.com/philgyford/python-halftone · https://github.com/sedthh/pyxelate ·
https://github.com/Zarxrax/Cutie-Roto · https://github.com/Forceflow/cuda_voxelizer ·
https://github.com/francescopiocirillo/soccer-players-tracking ·
https://github.com/DepthAnything/Video-Depth-Anything ·
https://github.com/bryandlee/animegan2-pytorch ·
https://github.com/TachibanaYoshino/AnimeGANv2 ·
https://github.com/AaronFeng753/Waifu2x-Extension-GUI
Papers / articles: https://www.cs.princeton.edu (XDoG) · https://research.adobe.com (XDoG) ·
https://onlinelibrary.wiley.com + https://www.kyprianidis.com (anisotropic Kuwahara) ·
https://arxiv.org/abs/2011.06294 (RIFE) · https://arxiv.org/abs/2408.00714 (SAM 2) ·
https://peterl1n.github.io/RobustVideoMatting · https://arxiv.org/abs/2312.08126 (FlowVid) ·
https://openaccess.thecvf.com (Pix2Video) · https://duyguceylan.github.io/Pix2Video/ ·
https://arxiv.org/abs/2402.16092 + https://ecnu-cilab.github.io/Diffutoon/ (Diffutoon) ·
https://doubiiu.github.io/ToonCrafter/ · https://arxiv.org/abs/2405.17333 (ToonCrafter) ·
https://daooshee.github.io/ReReVST/ · https://daooshee.github.io/Compound-VST/ (also
https://ojs.aaai.org) · https://dcgi.fel.cvut.cz (Stylizing Video by Example) ·
https://mm4spa.github.io/TVCalib/ · https://arxiv.org/abs/2410.06052 (keypoint
calibration) · https://blog.roboflow.com (calibration + depth) ·
https://www.mdpi.com (Fast Coherent VST) · https://openreview.net (OFA) ·
https://openaccess.thecvf.com (MotionPrompt) · https://la.disneyresearch.com (color
propagation) · https://learnopengl.com (bloom)
Docs / tutorials / pricing: https://ffmpeg.org/ffmpeg-filters.html ·
https://trac.ffmpeg.org/wiki/Waveform · https://zayne.io (ffmpeg vintage) ·
https://superuser.com (VHS) · https://docs.opencv.org (CamShift, flow) ·
http://opencv24-python-tutorials.readthedocs.io + https://www.geeksforgeeks.org +
https://learnopencv.com (MOG2) · https://www.geeksforgeeks.org + https://datahacker.rs +
https://dev.to (cartoonify) · https://www.glitch.cool (audio-to-video) ·
https://replicate.com/seedance · https://www.teamday.ai · https://rangy.ai ·
https://wise.com · https://runway.com · https://www.therundown.ai · https://kie.ai ·
https://fal.ai · https://www.wireflow.ai · https://ai-engine.net (AnimeGANv2 CPU
speed) · https://redvice.org (Anime4K analysis) · https://www.skwigly.co.uk +
https://www.cgchannel.com + https://ebsynth.com (EbSynth terms) ·
https://huggingface.co/mlx-community/RIFE-4.25 · https://pypi.org/project/vsrife/ ·
https://huggingface.co/Lightricks/LTX-Video · https://www.globenewswire.com (LTX-2) ·
https://huggingface.co/jkawamoto/frame-interpolation-pytorch ·
https://huggingface.co/martinjolif/yolo-football-pitch-detection ·
https://universe.roboflow.com · https://developers.google.com/edge/mediapipe ·
https://pypi.org/project/kornia/ · https://kornia.readthedocs.io ·
https://darkforte.github.io (low poly) · https://tabreturn.github.io (halftone) ·
https://borisfx.com (rotoscoping tools) · https://www.forasoft.com (VSR licensing) ·
https://oakgen.ai (hosted clay — rejected) · https://blog.savant-ai.io (CUDA MOG2) ·
https://discuss.huggingface.co (SAM2 VRAM) · https://ai.meta.com (SAM 2 release)

— Worker A, 2026-09-24. Registry (machine-readable): `docs/technology/source-preserving-candidates.yaml`.
