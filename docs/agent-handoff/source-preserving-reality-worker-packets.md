# Source-Preserving Reality — Worker Packets

Status: WAVE-1 DISPATCHED (2026-09-24) · Author: Tech Lead
Read order for every worker: this file → ADR-012 → architecture →
`docs/contracts/source-preserving-renderer.md` → your packet →
`docs/testing/source-preserving-reality-{benchmark,acceptance}.md` (B and C).

## Shared discipline (all workers)

- Worklog: read `/home/z/my-project/worklog.md` (recent entries) before working;
  APPEND your record at the end (template in the file). Task IDs below.
- Honesty: no fake demos, no synthetic source video, no "works" claims without
  real output on disk; failures recorded, never hidden.
- File ownership (no collisions): A → `docs/research/`, `docs/technology/` ·
  B → `scripts/source-preserving/`, `/home/z/spr-evidence/render/`,
  `/home/z/my-project/public/media/spr/render/` ·
  C → `/home/z/spr-evidence/benchmarks/`, `/home/z/spr-evidence/qa/`,
  `/home/z/my-project/public/media/spr/benchmarks/`,
  `/home/z/my-project/scripts/spr-*` (QA scripts) ·
  TL → docs/contracts, docs/status, manifest, product surface `src/`.
  NOBODY touches: `src/app/**` (TL), `:3101`/`:3100`/replay2 processes,
  `/home/z/my-project/dev.log` ownership.
- Environment: python3 = venv with cv2 4.13 + numpy; `/usr/bin/ffmpeg` 7.1.5;
  `yt-dlp` in venv; bun + z-ai-web-dev-sdk under `/home/z/my-project`
  (VLM SDK is BACKEND only — run via bun scripts inside that project, or use the
  `z-ai vision` CLI). The Next.js dev server on :3000 hot-reloads; do not restart it.

## Packet A — Technology Intelligence (Task ID: spr-w1-a)

Deliver `docs/research/source-preserving-technology-landscape.md` +
`docs/technology/source-preserving-candidates.yaml`.

1. For each family SPR101-109 / SPR201-205: research ≥ 2-3 implementation
   candidates (GitHub, Hugging Face, papers w/ code, hosted APIs, classical CV).
   Use the web-search skill (Skill tool) and record URLs.
2. Every candidate record carries ALL fields from the mandate §5: technology,
   repo/provider, version/commit/model, license (code + checkpoint + dataset
   implications), commercial-use status, runtime/GPU requirements, latency, cost,
   free-tier status (VERIFIED vs ASSUMED — verify against current docs where
   reachable), output quality expectations, temporal consistency reputation,
   failure modes, integration complexity, replacement strategy.
3. Classify each candidate: benchmark-only / experimental / preferred-implementation
   candidate / fallback / BYOK option / production candidate.
4. Mandatory coverage: deterministic baselines (bilateral+quantize cartoon, XDoG,
   Kuwahara painterly, tone-curve noir/VHS, flow trails), video-to-video diffusion
   candidates, temporal consistency modules, optical-flow propagation (e.g. RIFE,
   flow-warp stylization), segmentation-guided stylization (players vs pitch),
   toon/cel shading, edge extraction, low-poly/voxel conversion, upscaling.
5. Sandbox feasibility verdict per candidate: runnable CPU-only here vs needs
   GPU/provider keys (explicit).
6. Recommendation for wave-2: which upgrades are worth trials, which are NOT and why.

## Packet B — Renderer Engineering (Task ID: spr-w1-b)

Build SPE-v1 in `/home/z/sporta-wc/scripts/source-preserving/` per the contract doc.

1. `render.py` CLI: `--clip <mp4> --reality <id> --out-dir <dir> [--profile default]`.
2. Stage library (spe/): cut-detect, Farneback flow, bilateral-flatten,
   median-pool, palette-quantize (fixed per-clip LAB palette from sampled frames),
   xdog-edges, edge-overlay, tone-lut, saturation-lift, bloom, grain, vignette,
   trail-accumulate (cut-reset), encode-bitexact (ffmpeg `-fflags +bitexact
   -flags:v +bitexact -map_metadata -1`, fixed GOP, audio passthrough `-c:a copy`).
3. Renderers (registry rows + default style configs, versioned 0.1.0):
   - `spr-cartoon-cel-dc1` (SPR101) — flatten + fixed-palette quantize + XDoG dark
     lines; stable, clean, graphic. Aim: flat color regions, readable silhouettes,
     low flicker.
   - `spr-anime-npr-dc1` (SPR102) — stronger flatten, limited palette (K≈7), clean
     line art, saturation lift, optional subtle bloom. Aim: anime broadcast look.
   - `spr-noir-retro-dc1` (SPR108, profile `noir` + `vhs`/`1970s`) — cheap
     deterministic baseline family.
   - `spr-motion-trails-dc1` (SPR201) — flow-weighted player/ball trails with
     cut-reset (honest: trails are motion-emphasis, no identity claims).
4. Render targets: full b8 (`/home/z/w6-real-r606-inplay-evidence/bytes/original-artifact-a13396ec.mp4`)
   for ALL four + the 12s review cut `b8[0:12s]` for iteration. Extract compare
   frames t=2/15/30/45 s (original + each reality) as PNGs.
5. Outputs into `/home/z/spr-evidence/render/`: `<reality>-b8.mp4`,
   `<reality>-b12.mp4` (12s), `<reality>-b8.provenance.json`,
   `frames/<reality>-t{2,15,30,45}s.png`, `frames/original-t{…}s.png`,
   `renders.json` (index of all artifacts). Copy the MP4s + frames to
   `/home/z/my-project/public/media/spr/render/` (same names).
6. Provenance JSON exactly per contract §3. Determinism: render b12 twice, record
   both sha256s in provenance.reproducibility.
7. Self-QA before reporting: run a quick sanity (frame counts equal; spot-check 4
   frames with the `z-ai vision` CLI: "is this a stylized version of frame X?
   are players present?"). Record verdicts in `renders.json`.
8. Budget: keep per-frame compute reasonable (640×360; bilateral iterations 2-3).
   If a full-b8 pass exceeds ~15 min, optimize (downscale processing, LUT reuse).

FORBIDDEN: per-frame generative restyle (slideshow anti-pattern), SWM dependency,
fabricated quality fields, hardcoded provider anything.

## Packet C — Benchmark + QA (Task ID: spr-w1-c)

1. Build the corpus per `docs/testing/source-preserving-reality-benchmark.md`:
   - b1 = 30s cut from b8; b5 from the 86s on-disk pull; b2/b3/b4/b6 discovered
     (yt-dlp window pulls with the recorded recipe, or cuts from the 86s pull) and
     VLM-verified per category; b7 honestly marked ABSENT if the match is day-lit.
   - Acquisition recipe (verified working): yt-dlp via proxy
     `https://testuser1:e4b72b531a2d10900519@a996d235.acsnet.co:443`, bgutil
     plugin active (`~/.yt-dlp/plugins/bgutil`, server :4416), visionos client,
     `-f 230` (640×360 HLS) + audio `-f 140`, `--download-sections "*START-END"`,
     `-o` into a temp dir, merge `-c copy`. Record the exact command per clip.
     If the proxy path fails now: fall back to cuts from the two on-disk windows
     and record the fallback honestly.
   - Write `/home/z/spr-evidence/benchmarks/corpus.json` + clips + thumbnails +
     `vlm/*.json` + copy clips to `/home/z/my-project/public/media/spr/benchmarks/`.
2. Build the QA harness (Node, run with bun, z-ai-web-dev-sdk backend-only):
   - `/home/z/my-project/scripts/spr-qa-metrics.mjs` — hard gates G-T1/T2/T3/T4
     from the acceptance doc (ffmpeg/ffprobe + a tiny python helper for flow via
     cv2 is allowed; or compute in python and have the mjs read its JSON).
   - `/home/z/my-project/scripts/spr-qa-vlm.mjs` — extract frames (t=2/8/15/30/45
     + cut-adjacent) from original + reality, run the VLM scorecard prompt per the
     acceptance doc §2, write `qa/vlm/<family>-<t>s.json`.
   - `/home/z/my-project/scripts/spr-qa-scorecard.mjs` — merge gates + metrics +
     VLM into `qa/scorecard-<family>.json` per §4 (tierClaim = min(evidence); TL
     approval field PENDING).
3. If `/home/z/spr-evidence/render/renders.json` exists when you finish (Worker B
   may still be running), run the harness on the b8 artifacts; else record
   "harness ready, execution deferred to wave-2".
4. Record everything with real numbers; no placeholder metrics.
