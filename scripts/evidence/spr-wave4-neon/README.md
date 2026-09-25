# SPR-W4-C — SPR107 Neon/Cyberpunk Reality: Implement, Register, Gate (Lane N)

Task: implement the SPR107 neon/cyberpunk reality ("LUT + bloom + edge
glow") as a registered renderer, promoted additively like W3-B's
subject-toon, gated on the coverage classes, determinism-proven. Branch
`spr/w4c/neon-reality`, base `eb3b404` (the wave-4 dispatch base — the only
allowed base). Engine contract FROZEN; the registration is additive (one new
row, zero modified/deleted lines in the diff vs base).

## 1. Substrate verification (run first)

`sha256sum scripts/evidence/spr-corpus-bytes/*` — all 8 files match the
README table (16-hex prefixes) and corpus.json full shas. The three used by
this lane, full shas:

- `b8p3.mp4` `969af7c6fdb172091ff00705b25fa37b7073f4332d722416b9754a4a7579917a`
- `clip-b2-closeup.mp4` `e65ae48740472f57ada031fdfb076cbb40a845239693acad83e8142c0caec062`
- `clip-b5-camera-move.mp4` `349a37eeb7fc1374ed8179804fe7ad4888f66a3d9748246e80fdfba30318593a`

Tools: ffmpeg 7.1.5-0deb13u1, opencv-python-headless 5.0.0, numpy 2.5.3
(project venv `.venv/bin/python`). No new repo dependencies.

## 2. Promotion (additive-only gate)

`scripts/source-preserving/spe/renderers.py`: one new `NEON_CYBERPUNK`
RendererSpec (`spr-neon-cyberpunk-dc1`, reality `neon-cyberpunk`, family
"Neon/Cyberpunk (SPR107)", sprId SPR107, version 0.1.0, `default` profile,
paletteK None, usesFlow False), the `_NeonCyberpunkState` pipeline class,
one `elif` dispatch branch in `FrameProcessor`, and a pure-addition
registry append line.

- Diff vs `eb3b404`: **+211 / −0** — additions only, zero modified/deleted
  lines (the W3-B +166/−0 precedent).
- Adapter registration proof: frozen `render.py --reality` choices now list
  `neon-cyberpunk` — `registry-listing.txt`
  (`{anime-npr,cartoon-cel,motion-trails,neon-cyberpunk,noir-retro,subject-toon}`).
- Known repo fact (pre-existing, NOT touched): `spe/registry.py` imports a
  non-existent `RENDERER_DECLARATIONS` and has been un-importable dead code
  since before the wave-4 base; the live registration path is
  `renderers.REGISTRY` ← `render.py`. Left exactly as found (forbidden
  scope; W3-B deviation 4 precedent).

### The pipeline (all constants frozen in the declaration/config)

Stage 1 — `neon_lut_grade`: fixed 3×3 BGR channel-mix matrix (rows
[0.86,0.10,0.04 | 0.07,0.84,0.09 | 0.12,0.16,0.72], row-normalized, cools
toward teal) → baked 256-entry pivot-contrast S-curve (pivot 0.44,
contrast 1.28, identical table for B/G/R) → soft split-tone (teal shadows
(+34,+22,−26) / magenta highlights (+18,−22,+34), BT.601-luma knee
0.38..0.72, hermite smoothstep).

Stage 2 — `bloom_pyramid`: max-channel soft threshold 196..244 → 3-octave
pyrDown Gaussian pyramid (fixed 5×5 kernels, dstsize-exact pyrUp chains
back to full res) → weighted sum (0.42/0.33/0.25) → ADDITIVE composite
(strength 0.75).

Stage 3 — `edge_glow`: Sobel k=3 magnitude on the graded (pre-bloom)
BT.601 luma → soft knee 120..480 → Gaussian soften σ1.2 → neon-cyan tint
(200,250,90) soft alpha composite (α 0.62) over the bloomed frame.

**Zero temporal state by construction**: no accumulators, no RNG, no
frame-index dependence — the T3-diagnosis law (SPR-W3-B: i.i.d. per-frame
jitter decorrelates the motion series; grain alone r=0.9986, jitter alone
r=0.7304). This pipeline contains neither, so G-T3 measures only the
deterministic LUT's pass-through of the source motion. The state object
holds only precomputed constants (baked curve LUT, matrices, tints).

## 3. Coverage renders + gates (raw substrates as gate inputs)

All renders via the FROZEN `render.py`. Double-rendered into independent
out-dirs; both sha256 recorded (G-T5 discipline). Gates vs the RAW frozen
substrates (no derived references needed — all three clips are
metadata-clean: nb_frames == decode-true, audio ≥ video).

det = double-render byte-identical; cov = G-T2 spike coverage; r = G-T3
Pearson; flick = G-T4 static-region |ΔL| % of range; cd = cuts_deep.

| # | artifact | frames | sha256 (both passes) | det | G-T1 | G-T2 (raw) | G-T2b (deep) | G-T3 | G-T4 |
|---|---|---|---|---|---|---|---|---|---|
| 1 | neon-cyberpunk-b8.mp4 (wide, full window) | 1190 | `25508766d39840c227cb8cd8381f2c435e81a784bf5d0f4055fa25ff59c6c8bf` ×2 | **yes** | PASS 1190==1190, Δ20 ms, audio ✓ | **PASS** cov 1.0, extra 0.0 — all 6 cuts at exact indices 189/475/550/862/979/982 | PASS cov 1.0, 0 invented (amp ratios 1.089–1.548) | **PASS r=0.9914** | PASS 0.607 % (base 0.458 %) |
| 2 | neon-cyberpunk-b2.mp4 (closeup) | 225 | `57ef6455133d108d4ecd6d9205c1027384869bc5cf54be71261d289125d0a765` ×2 | **yes** | PASS 225==225, Δ20 ms, audio ✓ | **PASS** cov 1.0, extra 0.0 (cut 97 → 98, within ±1) | PASS cov 1.0, 0 invented (amp ratio 1.406) | **PASS r=0.9985** | PASS 1.259 % (base 0.945 %) |
| 3 | neon-cyberpunk-b5.mp4 (camera-move pan) | 300 | `a3d5942ebc0c747a8e34f310322d2eae9778d134120750bc1ad2111a2936c6fc` ×2 | **yes** | PASS 300==300, Δ20 ms, audio ✓ | FAIL cov 0.0, extra 0.0 — **F2 zero-cut class** (inputCuts [], outputCuts []) | **PASS** (0 cuts to preserve, 0 invented — vacuous) | **PASS r=0.998** | PASS 0.4957 % (base 0.3625 %) |

Wall-clock (provenance telemetry): b8 61.04 s / 60.91 s (pass 1/2);
b2 12.02 s / 12.13 s; b5 16.25 s / 15.96 s. styleConfigHash stable across
passes on all three clips (b8 `9743e21b5256b99f…`, b2 `3ddb0c395d27c180…`,
b5 `8c33c5cceee00b62…`; the frozen adapter hashes config + profile +
frameCount, hence per-clip).

### Honest gate classes (the expected ones, all recorded)

- **b5 raw G-T2 FAIL = the wave-2 F2 zero-cut class, not a preservation
  violation**: b5 is one sustained pan; the spike detector finds ZERO input
  cuts, so coverage = 0/max(0,1) = 0.0 fails vacuously with extraPer30s 0.0
  and zero output cuts. The dispatched deep gate `cuts_deep.py` adjudicates:
  0 cuts to preserve, 0 invented → T2b PASS. Raw JSON kept unedited
  side-by-side with the deep JSON (no gate-shopping).
- **Flattening-style raw-G-T2 boundary cases did NOT occur** for this
  reality: the neon grade AMPLIFIES cut discontinuities (b8 amp ratios
  1.089–1.548 ≥ 1.0) rather than flattening them below the spike detector
  (cartoon-cel softened cut 550 to ~0.78 ratio, cov 0.833). The dispatched
  resolution path for that class (cuts_deep correspondence, the W3-A
  adjudication `scripts/evidence/spr-wave3-substrate-fix/README.md` §"the
  two raw-G-T2 misses") was therefore not needed — but was run anyway on
  all three clips and passes everywhere.
- **G-T3 held everywhere (0.9914–0.9985), including b5** — the flat-pan
  worst case of the T3 diagnosis, where the vhs jitter profile measured
  r=0.7303 on this same clip. The deterministic LUT preserves the motion
  series, as predicted for a zero-noise pipeline.

## 4. Regression (engine untouched, proven byte-level)

cartoon-cel b8 re-rendered via the frozen `render.py` AFTER the promotion
edit: sha256 `a9e8cd5612f1486fde86b970dd5aab50b9c6d495e18a59d416fef1718e84f26c`
**== the frozen wave-1 record** (`spr-wave1-recovery/renders.json`, the
W3-B regression anchor). Byte-identical → the edit is provably additive to
the engine's behavior for every pre-existing reality.

## 5. Scorecards — honestly DEFERRED (VLM-free lane)

**VLM scorecards were NOT run.** The wave-4 dispatch runs VLM-free (quota
strained); scorecards are deferred BY DESIGN to a later quota-friendly
wave. No tier is claimed or implied; per contract §3/§7 the renderer ships
with `selfTierClaim: 0` (absent QA → tier 0, never fabricated). As a
non-visual sanity proxy only (no quality claims), the 60-frame b8 smoke
render measured: output mean BGR [103.9, 111.5, 78.5] vs input
[71.4, 91.4, 100.9] (teal cast present); frame-diff energy series
r=0.9959; static-region |ΔL| 0.341 % vs 0.204 % input baseline; highlight
clip >250 at 11.9 % (bloom feed 10.6 %) — the pipeline is non-degenerate
and the constants were frozen from the declaration without post-hoc
tuning.

## 6. Files

- `promotion.json` — declaration diff summary, render records (both shas
  per render), gate tables, regression record, scorecard deferral record.
- `qa/` — 6 raw gate JSONs: `qa-neon-{b8,b2,b5}.json` (qa_check G-T1..T4)
  + `cuts-deep-neon-{b8,b2,b5}.json` (G-T2b), all vs raw substrates.
- `frames/` — t=2 s / t=8 s PNG per render (extracted from the pass-1
  artifacts by the frozen adapter's `--frames`).
- `registry-listing.txt` — frozen `render.py --help` output proving
  `neon-cyberpunk` in `--reality` choices.
- `commands.md` — every command, in order, with exact paths.

Not committed (re-derivable, commands recorded): the render mp4/provenance
outputs (the shas above are the verification anchors, W2-B/W3-B
convention), the scratch smoke harness (`/home/z/my-project/scripts/`
outside the repo), and the 60-frame smoke artifact.

## 7. Deviations

1. **Scorecards deferred** (VLM-free lane, by design — see §5). Recorded
   as an honest omission, not a pass.
2. **b5 raw G-T2 FAIL recorded as-is** (F2 vacuous class) with the
   cuts_deep resolution side-by-side — the metric edge is documented
   wave-2 class; no threshold lowered, nothing hidden.
3. Task-packet wording "version dc1" interpreted per the W3-B precedent:
   the rendererId carries the `-dc1` deterministic-classical generation
   suffix; `rendererVersion` is `0.1.0` mirroring contract §4's rows.
4. Renders ran with `.venv/bin/python` (the project venv — the recorded
   toolset); the recorded commands note this explicitly.
5. `spe/registry.py` left as found (pre-existing dead code — see §2).
