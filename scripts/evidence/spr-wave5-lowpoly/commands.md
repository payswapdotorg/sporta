# SPR-W5-E — exact commands (run from the repo root at `a150cb2` + this branch's renderers.py edit)

All renders/gates ran foreground, sequential (the sandbox kills background
processes). Python = system `python3` (3.12.14, opencv 4.13.0, numpy
2.1.3 — identical to the frozen engine toolset record); ffmpeg
7.1.5-0+deb13u1 system binary. Out-dirs live OUTSIDE the repo tree
(`/tmp/w5e/…`); pass 2 always uses an independent out-dir (G-T5
double-render discipline). The machine-local scorecard root
(`/home/z/spr-evidence/`) is the frozen harness's expected path layout
(NOT committed; the committed copies in this dir are byte-identical).
Iteration drivers were persisted outside the repo at
`/home/z/my-project/scripts/w5e_*.py` (fastloop / fullrender / phase3).

## 0. Setup + substrate verification

```bash
git clone https://github.com/payswapdotorg/sporta.git sporta
cd sporta
git checkout a150cb283a6184e88622ec5d06c9b6545b90f936   # origin/main (post w5b merge)
git rev-parse HEAD   # a150cb2...
git checkout -b spr/w5e/lowpoly-trial
python3 --version && python3 -c "import cv2, numpy; print(cv2.__version__, numpy.__version__)"
python3 -c "import cv2; cv2.Subdiv2D((0,0,10,10)).insert((5,5)); print('Subdiv2D OK')"
ffmpeg -version | head -1
sha256sum scripts/evidence/spr-corpus-bytes/b8p3.mp4 \
          scripts/evidence/spr-corpus-bytes/b8-b12.mp4 \
          scripts/evidence/spr-corpus-bytes/clip-b2-closeup.mp4
# 969af7c6... / b3cc5f0e... / e65ae487...  (== corpus README, byte-exact)
# engine cut-detect sanity (cut-reset targets):
python3 -c "import sys; sys.path.insert(0,'scripts/source-preserving'); from spe import stages as S; print(S.analyze('scripts/evidence/spr-corpus-bytes/b8p3.mp4')['cuts'])"
# [188, 474, 549, 861, ..., 977] -> scene starts 189/475/550/862/978 — the frozen
# cut positions (b8's 982 micro-cut is suppressed by the 6-frame rule; the
# 882-943 extra hits are the high-motion goal segment, harmless resets)
```

## 1. Additive-diff gate (after the row edit)

```bash
git diff a150cb2 --numstat -- scripts/source-preserving/spe/renderers.py
# 451  0    (additions only)
git status --porcelain  # only spe/renderers.py + scripts/evidence/spr-wave5-lowpoly/
git diff a150cb2 --stat -- scripts/source-preserving/render.py \
    scripts/source-preserving/spe/{stages,encode,provenance,registry,__init__}.py \
    scripts/source-preserving/{qa_check,cuts_deep,vlm_scorecard}.py \
    scripts/source-preserving/spe/trials/     # EMPTY — frozen files byte-identical
python3 scripts/source-preserving/render.py --help \
  > scripts/evidence/spr-wave5-lowpoly/registry-listing.txt
# --reality {...,lowpoly-game,...}
```

## 2. Fast-loop gate references (the recorded command classes)

```bash
mkdir -p /tmp/w5e/gates
# b8-first300 derived reference (the w4b/W2C class; byte-reproduces 9efa9b99...)
ffmpeg -y -loglevel error -i scripts/evidence/spr-corpus-bytes/b8p3.mp4 \
    -frames:v 300 -t 12 -c:v libx264 -crf 20 -preset medium -threads 1 \
    -pix_fmt yuv420p -g 50 -fflags +bitexact -flags:v +bitexact \
    -map_metadata -1 -c:a copy /tmp/w5e/gates/b8-first300-gateref.mp4
sha256sum /tmp/w5e/gates/b8-first300-gateref.mp4
# 9efa9b99aa74c0e365a4e22417ec3e4eece60633c6e3aac5cdd2cad6e3ec889b  (== w4b record)

# b12-first300 gateref from the PRE-w3a-fix substrate (the pre-adjudicated
# 338-vs-300 metadata class; byte-reproduces the w3b pin d19079ca...)
git show 805a5fc:scripts/evidence/spr-corpus-bytes/b8-b12.mp4 > /tmp/w5e/gates/b12-old-substrate.mp4
sha256sum /tmp/w5e/gates/b12-old-substrate.mp4
# 7cb3d728cc349720043c74e32258de55f0ea87b9314515d8e5d4020853143421  (== w4b record)
ffmpeg -y -loglevel error -i /tmp/w5e/gates/b12-old-substrate.mp4 \
    -frames:v 300 -t 12 -c:v libx264 -crf 20 -preset medium -threads 1 \
    -pix_fmt yuv420p -g 50 -fflags +bitexact -flags:v +bitexact \
    -map_metadata -1 -c:a copy /tmp/w5e/gates/b12-first300-gateref-from-old.mp4
sha256sum /tmp/w5e/gates/b12-first300-gateref-from-old.mp4
# d19079ca133cbfe02dde534bd74c579818cb9b92e6272a4f7af9f77e1737115b  (== w3b pin)
```

## 3. Fast loop (phases 1/2 + the phase-3 re-open)

Phase 1/2 driver (per-variant: patch LOWPOLY_GAME.config in place, call the
frozen adapter's `render()` — the same code path as the CLI — then the
frozen gate CLIs):

```bash
python3 /home/z/my-project/scripts/w5e_fastloop.py          # v1..v4, b8 first-300
#   v1 temporal-off T4 1.3958% (phase-2 numbers; phase-1 pre-fix 1.4546%)
#   v2 recipe-baseline (24px/1200) T4 1.2131%
#   v3 +palette-snap T3 0.9316 T4 1.4127%  (rejected: hard class-boundary class)
#   v4 dense mesh (20px/1500) T3 0.9706 T4 1.2186%  -> VLM duel WINNER
# CLI re-verify of the frozen winner:
python3 scripts/source-preserving/render.py --clip scripts/evidence/spr-corpus-bytes/b8p3.mp4 \
    --reality lowpoly-game --out-dir /tmp/w5e/fastloop-cli --suffix v4 \
    --max-frames 300 --skip-provenance
#   sha 7c28491a6567382bc8195abb1a18ea299970b0e760fd6d0356ea22fb9e2ad243 == driver v4

# VLM duel (full-res strip, original + v1..v4 at t=2/t=8):
ffmpeg -y -loglevel error -ss 2 -i scripts/evidence/spr-corpus-bytes/b8p3.mp4 -frames:v 1 /tmp/w5e/orig-t2.png
for v in v1 v2 v3 v4; do ffmpeg -y -loglevel error -ss 2 -i /tmp/w5e/fastloop/$v/lowpoly-game-$v.mp4 -frames:v 1 /tmp/w5e/$v-t2.png; done
#   (same at t=8; hstack x5, vstack the two rows -> duel-strip.png)
z-ai vision -p "<duel prompt>" -i duel-strip.png -o vlm-duel.json
#   WINNER=v4
```

Phase 3 (the honest re-open after the b12/b2 T4 fails at emaAlpha 0.65):

```bash
python3 /home/z/my-project/scripts/w5e_phase3.py             # v5/v6/v7 on b2+b12
#   v5 a=0.75:      b2 T4 1.3782% b12 1.3864%  (+ b8 spot: ALL GREEN) -> SHIPPED
#   v6 a=0.75 s1.2: b2 1.3574%   b12 1.3563%   (b8 cut-550 at the 16.0 threshold edge)
#   v7 a=0.80 s1.2: b2 1.3109%   b12 1.247%    (b8 cut-550 missed raw, T2b resolves)
# b8 spot-check class (per candidate):
python3 scripts/source-preserving/qa_check.py --input scripts/evidence/spr-corpus-bytes/b8p3.mp4 \
    --output /tmp/w5e/phase3/v5-b8/lowpoly-game-v5-b8.mp4 --json /tmp/w5e/phase3/qa-v5-b8.json
python3 scripts/source-preserving/cuts_deep.py --input scripts/evidence/spr-corpus-bytes/b8p3.mp4 \
    --output /tmp/w5e/phase3/v5-b8/lowpoly-game-v5-b8.mp4 --json /tmp/w5e/phase3/cuts-deep-v5-b8.json
```

## 4. Full renders (final frozen config; each cell double-rendered)

```bash
python3 /home/z/my-project/scripts/w5e_fullrender.py b8 b12 b2    # expand to:
python3 scripts/source-preserving/render.py --clip scripts/evidence/spr-corpus-bytes/b8p3.mp4 \
    --reality lowpoly-game --out-dir /tmp/w5e/out/b8/pass1 --suffix b8 --frames 2,8,15,30,45
#   -> 1190 frames, sha256 492395d4b6892ecc14f9f5d47bd250dd72d4e28e922758637fc1756847b921d6, 64.3 s
python3 scripts/source-preserving/render.py --clip scripts/evidence/spr-corpus-bytes/b8p3.mp4 \
    --reality lowpoly-game --out-dir /tmp/w5e/out/b8/pass2 --suffix b8
#   -> sha256 492395d4...  BYTE-IDENTICAL, 63.7 s

python3 scripts/source-preserving/render.py --clip scripts/evidence/spr-corpus-bytes/b8-b12.mp4 \
    --reality lowpoly-game --out-dir /tmp/w5e/out/b12/pass1 --suffix b12 --max-frames 300 --frames 2,8
python3 scripts/source-preserving/render.py --clip scripts/evidence/spr-corpus-bytes/b8-b12.mp4 \
    --reality lowpoly-game --out-dir /tmp/w5e/out/b12/pass2 --suffix b12 --max-frames 300
#   -> 300 frames, 372d538a7f4c4bce1dcafebb88b848a99d76de03763bbbae01675cb1d9b78d32  x2  BYTE-IDENTICAL

python3 scripts/source-preserving/render.py --clip scripts/evidence/spr-corpus-bytes/clip-b2-closeup.mp4 \
    --reality lowpoly-game --out-dir /tmp/w5e/out/b2/pass1 --suffix b2 --frames 2,8
python3 scripts/source-preserving/render.py --clip scripts/evidence/spr-corpus-bytes/clip-b2-closeup.mp4 \
    --reality lowpoly-game --out-dir /tmp/w5e/out/b2/pass2 --suffix b2
#   -> 225 frames, a32ee92ecfdb4110a55164d83a21c8c4f8a41d78aa4d5b535cc80bf50dc5ec5f  x2  BYTE-IDENTICAL

# game-cel profile smoke (registered profile, not gate-run):
python3 scripts/source-preserving/render.py --clip scripts/evidence/spr-corpus-bytes/b8p3.mp4 \
    --reality lowpoly-game --profile game-cel --out-dir /tmp/w5e/smoke-gamecel \
    --suffix smoke --max-frames 30 --skip-provenance
#   -> 2680c5cbafc01b7e323bcf96e720ee9d0691be80f25bea9a6b94b1f8836e929a + VLM confirm
```

## 5. Gates (per cell, on pass 1)

```bash
# b8 + b2 vs the RAW substrates
python3 scripts/source-preserving/qa_check.py \
    --input scripts/evidence/spr-corpus-bytes/b8p3.mp4 \
    --output /tmp/w5e/out/b8/pass1/lowpoly-game-b8.mp4 \
    --json scripts/evidence/spr-wave5-lowpoly/qa/qa-lowpoly-game-b8.json
python3 scripts/source-preserving/cuts_deep.py \
    --input scripts/evidence/spr-corpus-bytes/b8p3.mp4 \
    --output /tmp/w5e/out/b8/pass1/lowpoly-game-b8.mp4 \
    --json scripts/evidence/spr-wave5-lowpoly/qa/cuts-deep-lowpoly-game-b8.json
#   (same pair for b2 with clip-b2-closeup.mp4 / lowpoly-game-b2.mp4)

# b12 vs the pre-adjudicated first-300 gateref
python3 scripts/source-preserving/qa_check.py \
    --input /tmp/w5e/gates/b12-first300-gateref-from-old.mp4 \
    --output /tmp/w5e/out/b12/pass1/lowpoly-game-b12.mp4 \
    --json scripts/evidence/spr-wave5-lowpoly/qa/qa-lowpoly-game-b12.json
python3 scripts/source-preserving/cuts_deep.py \
    --input /tmp/w5e/gates/b12-first300-gateref-from-old.mp4 \
    --output /tmp/w5e/out/b12/pass1/lowpoly-game-b12.mp4 \
    --json scripts/evidence/spr-wave5-lowpoly/qa/cuts-deep-lowpoly-game-b12.json
```

Gate outcomes (the full table is README §4 / record.json): b8 ALL GREEN
(all 6 cuts at EXACT indices); b12/b2 G-T1/T2b/T3/T4 PASS with T2-raw
residual classes (117/120 micro-shot softened; 96/99 split-spike) resolved
by G-T2b deep correspondence (coverage 1.0, 0 invented) — the frozen
harness's own resolution rule (vlm_scorecard.load_gates).

## 6. Frame evidence (the frozen adapter's --frames; PNGs committed)

```bash
# extracted by the --frames flags in section 4 into each out-dir frames/;
# committed copies: frames/lowpoly-game-{b8,b12,b2}-t*s.png
```

## 7. Scorecard (frozen vlm_scorecard.py, machine-local evidence root)

```bash
# populate the harness's expected paths (NOT committed; copies committed
# under scorecards/ are byte-identical)
mkdir -p /home/z/spr-evidence/{bytes,render,qa/vlm}
cp scripts/evidence/spr-corpus-bytes/b8p3.mp4 /home/z/spr-evidence/bytes/b8p3.mp4
cp /tmp/w5e/out/b8/pass1/lowpoly-game-b8.mp4 /home/z/spr-evidence/render/lowpoly-game-b8.mp4
cp scripts/evidence/spr-wave5-lowpoly/qa/qa-lowpoly-game-b8.json \
   /home/z/spr-evidence/qa/metrics-lowpoly-game.json
cp scripts/evidence/spr-wave5-lowpoly/qa/cuts-deep-lowpoly-game-b8.json \
   /home/z/spr-evidence/qa/cuts-deep-lowpoly-game.json
#   + /home/z/spr-evidence/render/renders.json (the lane record: lowpoly-game
#     entry with files.{b8,b12,b2}.determinismDoubleRender.byteIdentical=true;
#     shape mirrors spr-tier2-scorecards/renders-with-b8-determinism.json)

python3 scripts/source-preserving/vlm_scorecard.py --realities lowpoly-game
#   -> 15/15 calls ok=True (glm-5v-turbo), tierClaim=0, critical=67
#   outputs: /home/z/spr-evidence/qa/scorecard-lowpoly-game.json
#            /home/z/spr-evidence/qa/vlm/lowpoly-game-*.json (15 raw calls)
#            /home/z/spr-evidence/qa/vlm-scorecard.json (aggregate)
```

## 8. Regression (frozen render.py, AFTER the promotion edit)

```bash
python3 scripts/source-preserving/render.py \
    --clip scripts/evidence/spr-corpus-bytes/b8p3.mp4 --reality cartoon-cel \
    --out-dir /tmp/w5e/regress/cartoon-cel --suffix b8 --skip-provenance
#   -> a9e8cd5612f1486fde86b970dd5aab50b9c6d495e18a59d416fef1718e84f26c  == w4b anchor
python3 scripts/source-preserving/render.py \
    --clip scripts/evidence/spr-corpus-bytes/b8p3.mp4 --reality noir-retro \
    --profile noir --out-dir /tmp/w5e/regress/noir-retro --suffix b8 --skip-provenance
#   -> 3eedb4238f56900f6b1559ce0f19e0ea1aa2044a453bdd2bce453d4a1b0711a4  == w4b anchor
python3 scripts/source-preserving/render.py \
    --clip scripts/evidence/spr-corpus-bytes/b8p3.mp4 --reality subject-toon \
    --out-dir /tmp/w5e/regress/subject-toon --suffix b8 --skip-provenance
#   -> 503ea271561d770c8482a8e472582aba5b54fd4a889b7eeef2c889d59e960f74  == w4b anchor
```

## 9. Delivery

```bash
git add -A && git commit -m "spr: w5e lowpoly trial — SPR106 deterministic renderer (Subdiv2D flat-fill + flow-stabilized anchors) + frozen-protocol scorecard"
GH_TOKEN=ghp_...
git push https://${GH_TOKEN}@github.com/payswapdotorg/sporta.git spr/w5e/lowpoly-trial:spr/w5e/lowpoly-trial
```

Mid-work milestone pushes (binding PUSH EARLY/PUSH OFTEN lesson): renderer
row (c2efe10), frozen winner config (dddad71), determinism fix (f55c7d5),
phase-3 T4 hardening (b38db8a), final evidence pack.
