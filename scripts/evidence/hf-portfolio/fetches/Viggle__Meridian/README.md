---
license: other
license_name: minimax-h3-community-license
license_link: LICENSE
base_model: MiniMaxAI/MiniMax-H3
base_model_relation: adapter
pipeline_tag: video-to-video
tags:
  - video-to-video
  - novel-view-synthesis
  - camera-control
  - re-camera
---

# Meridian: A new perspective on space and time

By **Viggle AI** · built on **[MiniMax-H3](https://huggingface.co/MiniMaxAI/MiniMax-H3)** ·
geometry by **[VGGT-Omega](https://github.com/facebookresearch/vggt-omega)**

**One event. Anywhere. Anytime.**

**Meridian is a geometry-guided video model for authoring new observations of existing events.**
Revisit a recorded event from a new viewpoint. Let the action unfold, slow it down, or hold a
moment still—all while moving the camera along a path you choose.
You can also create a camera move from a single image.

[Quickstart](#quickstart) · [Method](#method)

<div class="film hero-film">
  <video id="teaser-film" controls playsinline preload="none" width="100%" poster="https://huggingface.co/Viggle/Meridian/resolve/main/videos-all/longtake_showcase/teaser_v12/intro_059.jpg" src="https://huggingface.co/Viggle/Meridian/resolve/main/videos-all/teaser_meridian_showcase_v12.mp4" aria-label="Meridian teaser: a new perspective on space and time">
    <a href="https://huggingface.co/Viggle/Meridian/resolve/main/videos-all/teaser_meridian_showcase_v12.mp4">Watch the Meridian teaser</a>.
  </video>
  <p class="film-caption">51-second teaser</p>
</div>

## See it in motion

The motocross example includes the original video and a diagram of the planned camera path.
The ballet example uses a single photograph. The NBA edit labels the parts taken from the original footage.

<table class="video-grid">
  <tr>
    <td width="50%" valign="top">
      <video id="nba-film" controls playsinline preload="none" width="100%" poster="https://huggingface.co/Viggle/Meridian/resolve/main/videos-all/research_examples_v1/nba.jpg" src="https://huggingface.co/Viggle/Meridian/resolve/main/videos-all/research_examples_v1/nba.mp4" aria-label="NBA edit combining labeled source footage and generated views of held moments">
        <a href="https://huggingface.co/Viggle/Meridian/resolve/main/videos-all/research_examples_v1/nba.mp4">Watch the example</a>.
      </video>
      <p><strong>A dunk.</strong> A new look at the same play. This edit combines generated views with original footage, including the dunk's finish.</p>
    </td>
    <td width="50%" valign="top">
      <video id="berry-film" controls playsinline preload="none" width="100%" poster="https://huggingface.co/Viggle/Meridian/resolve/main/videos-all/research_examples_v1/berry.jpg" src="https://huggingface.co/Viggle/Meridian/resolve/main/videos-all/research_examples_v1/berry.mp4" aria-label="Strawberries: source time advances, holds while the camera moves, then resumes">
        <a href="https://huggingface.co/Viggle/Meridian/resolve/main/videos-all/research_examples_v1/berry.mp4">Watch the example</a>.
      </video>
      <p><strong>Play. Hold. Resume.</strong> Pause the splash, move the camera, then let the action continue.</p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <video id="moto-film" controls playsinline preload="none" width="100%" poster="https://huggingface.co/Viggle/Meridian/resolve/main/videos-all/research_examples_v2/motor_compound.jpg" src="https://huggingface.co/Viggle/Meridian/resolve/main/videos-all/teaser_meridian_compound_motor_dust_explained_v1.mp4" aria-label="Motocross: one uncut take with a compound camera path, selected source video, and requested camera diagrams">
        <a href="https://huggingface.co/Viggle/Meridian/resolve/main/videos-all/teaser_meridian_compound_motor_dust_explained_v1.mp4">Watch the example</a>.
      </video>
      <p><strong>Compose a camera path.</strong> Orbit, move sideways, and change distance—all in one continuous shot.</p>
    </td>
    <td width="50%" valign="top">
      <video id="ballet-film" controls playsinline preload="none" width="100%" poster="https://huggingface.co/Viggle/Meridian/resolve/main/videos-all/research_examples_v2/ballet_reverse45.jpg" src="https://huggingface.co/Viggle/Meridian/resolve/main/videos-all/meridian_ballet_l150_female_reverse45.mp4" aria-label="Female ballet dancer: generated camera movement from one still image">
        <a href="https://huggingface.co/Viggle/Meridian/resolve/main/videos-all/meridian_ballet_l150_female_reverse45.mp4">Watch the example</a>.
      </video>
      <p><strong>One image. Another viewpoint.</strong> A camera move from a single ballet photograph.</p>
    </td>
  </tr>
</table>

## Space and time, independently

| Choose… | What you can do |
|---|---|
| **Where to watch from** | Orbit, move in or out, slide sideways, or move up and down. Set the viewing direction and field of view. |
| **When to watch** | Choose a sequence, hold one frame, or slow down / speed up the input video before generation. |
| **How the two meet** | Move around a frozen moment, follow slow-motion action, or choose a new angle for a sped-up sequence. |

Bullet time is one combination—not the boundary of the model. To slow down or speed up the
action, retime the input video first. Then design the camera path over that timeline.

## Beyond the frame

A camera's position shapes how an event is seen: what draws our attention, what feels close,
and what remains outside the frame. Meridian explores keeping some of those choices open
after capture.

For filmmakers, this opens room to compose a new shot around an existing moment—not just edit
what the camera recorded, but generate another way of observing it. In the longer term, that
freedom could extend to viewers: choosing a perspective, following a subject, or lingering on
a detail rather than watching only a predetermined sequence.

**The event has passed. The choice of how to see it remains open.**

## Method

![VGGT-Omega estimates depth and camera poses from the input video. Colored 3D points are rendered along the chosen camera path to produce a warped video. Meridian uses this reference and the matching input frames to generate a new view. Video frames are real examples; points and cameras are schematic.](https://huggingface.co/Viggle/Meridian/resolve/main/assets/meridian_method.png)

*The same moment in the input, warped reference, and output. The 3D points and cameras are schematic.*

**Choose the moment. Place the camera. Render the reference. Complete the view.**

1. **Build the geometry.** VGGT-Omega estimates depth and camera poses from the input video.
   We use these estimates to turn the selected frames into colored 3D points.
2. **Render the new view.** For each output frame, choose a moment from the input and a camera
   viewpoint. Render the corresponding points from that view, leaving uncovered regions grey.
3. **Generate the shot.** Meridian takes the input video and the matching rendered video as
   references, then fills in missing regions and refines the image.

**Preview before generation.** Once the 3D points are available, rendering the reference is fast.
You can check the framing and camera motion, spot gaps in the view, and adjust the path before
running the video model.

## Model

Meridian uses **MiniMax-H3's transformer and VAE, without loading a text encoder at inference**.
The task's text embeddings are precomputed; the transformer architecture is unchanged.

**Meridian ships as two LoRA adapters on the unmodified MiniMax-H3 transformer**, not as a
checkpoint of its own. 2.5 GiB each, downloaded from here; the 61.7 GiB base comes from
[MiniMaxAI/MiniMax-H3](https://huggingface.co/MiniMaxAI/MiniMax-H3).

| Component | Role |
|---|---|
| `teacher_lora/` | The re-camera adapter: what makes the model read a geometric render. 2.5 GiB. Its own grid is `--steps 50 --flow-shift 12`. |
| `turbo_lora/` | A distillation of that teacher into **3 forwards**. 2.5 GiB. Default: `--steps 4 --flow-shift 3`. |
| `assets/` | Precomputed text embeddings, audio-layout assets, and the readable task prompt. |
| `legacy/` | The first release: one 61.7 GiB fused transformer and its adapter. Superseded by the pair above; kept so earlier results stay reproducible. |

**Load both adapters together and do not merge either into the base weights.** The default run sums
them at weight 1.0, which is the combination the turbo was distilled against; merging is lossy in
bf16, and for the turbo it is fatal — its update is ~2 orders of magnitude below bf16's rounding
step, so baking it in erases essentially all of it.

- **Output:** 24 fps, aspect-matched 768-class canvas; 1344 × 768 for a 16:9 input.
- **Lengths:** 73, 90, 107, 124, 141, 158, 175, or 243 frames—approximately 3–10 seconds per take.
- **Included tools:** inference CLI, runtime assets, sample clips, and a prototype Studio.

## Install

Follow the **[installation guide](docs/installation.md)** for code, checkpoint setup, dependencies,
and the separately obtained VGGT-Omega geometry model. Inference requires the MiniMax-H3 transformer
and VAE, Meridian's two adapters, and VGGT-Omega. Checkpoint availability and paths are listed in the guide.

The reference implementation runs on one high-memory CUDA GPU; memory and timings are reported below.
It does not currently expose quantization, CPU offloading, or multi-GPU sharding.

**Community: bring Meridian to smaller GPUs.** Keeping MiniMax-H3's architecture and omitting the
text encoder provides a starting point for adapting community memory-saving techniques. We welcome
work on quantization and CPU offloading toward consumer GPUs such as the **RTX 4090**. These are
integration targets, not supported or validated configurations in the current scripts.

Review the licenses before use: the code license does not cover the weights or remove
VGGT-Omega's noncommercial restrictions.

## Quickstart

After completing installation, including the separately supplied weights, run from the Meridian
directory. The included CC0 sample clips are already 24 fps and contain 73 frames each.

```bash
# A gentle 15° orbit over the live event.
python inference/sample.py --video examples/media/sp_bouldering_hang.mp4 \
  --yaw 15 --sweep --ease --out out/orbit

# Play 24 frames, then hold frame 24 for 49 output frames while orbiting.
python inference/sample.py --video examples/media/sp_bouldering_reach.mp4 \
  --yaw 35 --freeze 24:49 --out out/bullet
```

Open `out/orbit/grid.mp4` to compare **source → geometry reference → generated take**. The take is
`out.mp4`; `render.mp4` shows the geometric input with grey holes.

For your own footage, use a continuous shot exported at **constant 24 fps**. The CLI reads frames
by index: an ordinary take needs at least `start + frames` input frames. It does not normalize the
frame rate or detect cuts for you.

## Self-hosting the demo

<div class="film">
  <video id="studio-film" controls playsinline preload="none" width="100%" poster="https://huggingface.co/Viggle/Meridian/resolve/main/videos-all/studio_walkthrough/nba3_preview_live_02/studio_walkthrough_concise_poster.jpg" src="https://huggingface.co/Viggle/Meridian/resolve/main/videos-all/studio_walkthrough/nba3_preview_live_02/studio_walkthrough_concise.mp4" aria-label="Early Studio demo: actual authoring and geometric preview, not final generation">
    <a href="https://huggingface.co/Viggle/Meridian/resolve/main/videos-all/studio_walkthrough/nba3_preview_live_02/studio_walkthrough_concise.mp4">Watch the Studio walkthrough</a>.
  </video>
  <p class="film-caption">Designing a camera path and previewing the geometry.</p>
</div>

**Early prototype.** The Studio is a very basic, vibe-coded demo, not a production editor.
The walkthrough shows one simple way to use it.

```bash
CARD=0 bash service/run.sh --host 127.0.0.1 --port 8412
```

Open `http://127.0.0.1:8412` once the terminal prints `ready`.

Upload a clip, design a path with multiple camera keyframes, preview the geometry, then generate.
The browser provides **real-time 3D feedback** once geometry is loaded; full-path rendering and
final video generation are separate GPU operations, not real-time generative video.

The service has no authentication. The command above binds to loopback; do not expose this
prototype directly to the internet.

## ComfyUI

Both adapters are also published in ComfyUI's generic LoRA format, under `comfyui/`, with two custom
nodes and two ready-made graphs. The graphs are API-format JSON — drop either on the canvas and the
frontend builds it.

Load **`minimax_h3_fl2va_bf16.safetensors`** from
[Comfy-Org/MiniMax-H3](https://huggingface.co/Comfy-Org/MiniMax-H3) — Meridian is trained on
MiniMax-H3's `fl2va` partition, so the `ref2va` file is the wrong base — then apply
`comfyui/meridian_teacher_lora.safetensors` and `comfyui/meridian_turbo_lora.safetensors`, in that
order, both at strength 1.0.

Sample with `euler` on the `simple` scheduler at `cfg` 1.0, there being no negative branch — wire the
same conditioning into both inputs. **ComfyUI's `steps` is one less than `--steps` here**, because its
schedulers append the trailing zero themselves: the turbo pair is `MiniMaxH3SigmaShift` 3.0 with
`steps` **3**, and the teacher alone is shift 12.0 with `steps` **49**. Both grids then agree with this
repo's to four decimals.

Conditioning goes through `MiniMaxH3ReferenceToVideo` with **two reference videos**: the source clip
first, the geometric render second, and the text of `assets/prompt.txt` as the prompt. That is the
`<Video 1>` / `<Video 2>` presentation the adapters were trained on. Give both at **the condition
canvas** — the 480-class entry of `recam/h3.py`'s ladder, `736x544` for a 4:3 source — and set
`width`/`height` to the target canvas. The node picks a 768-class canvas for a reference but never
upscales, so one already at the smaller size passes through untouched; a source left at the target
canvas is encoded 2.5x too large.

Two nodes ship here, both dropped into `ComfyUI/custom_nodes/`.

**`comfyui/meridian_embed.py`** adds *Meridian Frozen Prompt*. Wire it between
`MiniMaxH3ReferenceToVideo` and the sampler and point `assets_dir` at this repo's `assets/`. Inference
here conditions on a frozen text embedding — `assets/fixed_embed_{n}.pt`, the presentation above with
timestamp markers and no pixels — and that is what the adapters were trained against: the reference
videos reach the model only as condition rows, never through the text encoder. ComfyUI instead samples
both reference videos at 2 fps and feeds those frames to Qwen3-VL, so without this node its text
conditioning carries vision tokens this training never saw. The node reads the clip length off the
latent, so it cannot load the wrong embedding.

**`comfyui/meridian_geometry.py`** adds *Meridian Geometry*, which produces the two reference videos
in-graph. No stock node reconstructs a point cloud or splats it along an authored camera path, and the
adapters do nothing without one. It shells out to `inference/sample.py --preview-only`, so the flags in
its `args` box are that script's own and cannot drift, and returns the source and the render already at
the condition canvas together with the target width, height and length. A subprocess rather than an
import because the geometry side needs VGGT-Omega, which is gated and FAIR-NC-licensed: you install it
yourself, and none of it enters ComfyUI's process — `python` is therefore whichever interpreter can
import it, not necessarily ComfyUI's.

`comfyui/meridian_workflow_geometry.json` is that graph end to end, from a clip and a camera move.
`comfyui/meridian_workflow.json` is the same thing without VGGT-Omega: it reads `cond_source.mp4` and
`cond_render.mp4` from ComfyUI's input directory, which every `--preview-only` run writes next to its
output.

The weight conversion is exact (`recam/to_comfyui.py`, checked key by key against the published ComfyUI
weights), and the rest of the graph was checked against ComfyUI's H3 source rather than guessed: the
sigma grids, the packed reference layout, and the 0.999 noise augmentation and pinned timestep on the
condition rows all match. Both graphs were then run, and against the same clip, seed and adapters the
ComfyUI result tracks the geometric render **2.7 dB better** than `inference/sample.py` does, with
vertical framing within 11 px on an 864 px frame — ours a little below the render, ComfyUI a little
above. ComfyUI's picture is also a little softer, by 7% of mean gradient magnitude. What remains is not
the graph — the two graphs agree with each other to within the run-to-run noise — and the likely
candidates are ComfyUI's fp16 VAE and a different noise realisation, which we have not isolated.

## Performance

Reported results on **one B200 with the service resident**, using the default adapter:

| Output length | Take generation | Peak GPU memory |
|---|---|---|
| 73 frames | ~36 s | 88 GiB |
| 124 frames | ~80 s | 89 GiB |
| 243 frames | ~150 s | 113 GiB |

Generation timings start with geometry prepared; upload processing and reconstruction are separate.
A 73-frame reference warp was reported at **0.24 s**, versus approximately 36 s for generation.
These are indicative measurements, not guarantees across GPUs, resolutions, or cache states.

## Limitations

Unseen surfaces are generated, not recovered.

- **Geometry robustness.** Meridian generally handles imperfect geometry well, but cannot reliably
  recover from severe errors or a badly warped reference.
- **Large moves are less stable.** Full 360° orbits can work, but large viewpoint changes can cause
  distortion, drift, or inconsistent details in newly visible areas.
- **Timing and continuity.** Retiming changes which input frames are used; it does not recover
  missing motion. Separately generated clips may not join smoothly.

## Documentation and code

[Inference guide](docs/inference.md) — camera recipes, source timing, CLI options, and troubleshooting.

Implementation lives in `recam/`, the CLI in `inference/sample.py`, and the Studio in `service/`.

## License

- **Weights** (`teacher_lora/`, `turbo_lora/`, `legacy/`, `assets/*.pt`): the
  [MiniMax H3 Community License Agreement](LICENSE). Meridian is a Model
  Derivative of MiniMax-H3; `MODIFICATIONS.md` is the Section III.2 notice. Powered by MiniMax H3.
  The Agreement licenses use
  and distribution of the weights and their outputs in its Applicable Territory only, which excludes
  the European Union, the United Kingdom, the Republic of Korea and the United States (Section I.3,
  I.5, V.4); read it before you download.
- **Code** (`recam/`, `inference/`, `service/`): [Apache 2.0](LICENSE-CODE).
- **VGGT-Omega**: not included. FAIR Noncommercial Research License v1, obtained from Meta separately;
  see [Install](#install).
- **Sample clips**: Wikimedia Commons, CC0; see [`examples/CREDITS.md`](examples/CREDITS.md).

## Intended use

Exploring new viewpoints and timing in footage you have the rights to, for previsualisation, editing,
and creative work. Do not use it to fabricate footage of real people or events presented as genuine,
and label what you generate as AI-generated. If you pass the weights on or host them, the Agreement
makes you bind your users to its
use restrictions and tell them so (Section V.2), keep safeguards on any generation service (V.5),
display "MiniMax H3" in a commercial product's interface (IV.2), and ask MiniMax for authorization above
US$20M yearly revenue (IV.1).

## Citation

```bibtex
@misc{viggle-meridian-2026,
  title  = {Meridian: A New Perspective on Space and Time},
  author = {Viggle AI},
  year   = {2026},
  url    = {https://huggingface.co/Viggle/Meridian}
}
```
