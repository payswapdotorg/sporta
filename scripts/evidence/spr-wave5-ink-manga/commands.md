# SPR-W5-C — exact commands (run from the repo root at `0f905e2` + this branch's renderers.py edit)

All renders/gates ran foreground, sequential (the sandbox kills background
processes). Python = system `python3` (3.12.14, opencv 4.13.0, numpy
2.1.3 — identical to the frozen engine toolset record); ffmpeg
7.1.5-0+deb13u1 system binary. Out-dirs live OUTSIDE the repo tree
(`/tmp/w5c/…`); pass 2 always uses an independent out-dir (G-T5
double-render discipline). The machine-local scorecard root
(`/home/z/spr-evidence/`) is the frozen harness's expected path layout
(NOT committed; the committed copies in this dir are byte-identical).

## 0. Setup + substrate verification

```bash
git clone https://github.com/payswapdotorg/sporta.git sporta
cd sporta
git checkout 0f905e2ecd95013d523e3e890f1bc7a12cce5a8e   # origin/main post lane-A merge
git rev-parse HEAD   # 0f905e2ecd95013d523e3e890f1bc7a12cce5a8e
git checkout -b spr/w5c/ink-manga
python3 --version && python3 -c "import cv2, numpy; print(cv2.__version__, numpy.__version__)"
ffmpeg -version | head -1
sha256sum scripts/evidence/spr-corpus-bytes/b8p3.mp4 \
          scripts/evidence/spr-corpus-bytes/b8-b12.mp4 \
          scripts/evidence/spr-corpus-bytes/clip-b2-closeup.mp4
# 969af7c6... / b3cc5f0e... / e65ae487...  (== corpus README, byte-exact)
```

## 1. Additive-diff gate (after the row edit)

```bash
git diff 0f905e2 --numstat -- scripts/source-preserving/spe/renderers.py
# 293  0     (additions only)
git status --porcelain   # only spe/renderers.py + scripts/evidence/spr-wave5-ink-manga/
python3 scripts/source-preserving/render.py --help \
  > scripts/evidence/spr-wave5-ink-manga/registry-listing.txt
# --reality {...,ink-manga,...}
```

## 2. Fast-loop gate references (the recorded command classes)

```bash
mkdir -p /tmp/w5c/gates
# b8-first300 derived reference (the w4b/W2C class; byte-reproduces 9efa9b99...)
ffmpeg -y -loglevel error -i scripts/evidence/spr-corpus-bytes/b8p3.mp4 \
    -frames:v 300 -t 12 -c:v libx264 -crf 20 -preset medium -threads 1 \
    -pix_fmt yuv420p -g 50 -fflags +bitexact -flags:v +bitexact \
    -map_metadata -1 -c:a copy /tmp/w5c/gates/b8-first300-gateref.mp4
sha256sum /tmp/w5c/gates/b8-first300-gateref.mp4
# 9efa9b99aa74c0e365a4e22417ec3e4eece60633c6e3aac5cdd2cad6e3ec889b  (== w4b record)

# b12-first300 gateref from the PRE-w3a-fix substrate (the pre-adjudicated
# 338-vs-300 metadata class; byte-reproduces the w3b pin d19079ca...)
git show 805a5fc:scripts/evidence/spr-corpus-bytes/b8-b12.mp4 > /tmp/w5c/gates/b12-old-substrate.mp4
sha256sum /tmp/w5c/gates/b12-old-substrate.mp4
# 7cb3d728cc349720043c74e32258de55f0ea87b9314515d8e5d4020853143421  (== w4b record)
ffmpeg -y -loglevel error -i /tmp/w5c/gates/b12-old-substrate.mp4 \
    -frames:v 300 -t 12 -c:v libx264 -crf 20 -preset medium -threads 1 \
    -pix_fmt yuv420p -g 50 -fflags +bitexact -flags:v +bitexact \
    -map_metadata -1 -c:a copy /tmp/w5c/gates/b12-first300-gateref-from-old.mp4
sha256sum /tmp/w5c/gates/b12-first300-gateref-from-old.mp4
# d19079ca133cbfe02dde534bd74c579818cb9b92e6272a4f7af9f77e1737115b  (== w3b pin)
```

## 3. Fast loop (variants v1..v4 + the b2 iteration)

Per-variant command class (ONLY the INK_MANGA config values in
spe/renderers.py were edited between runs; the full effective config of
every variant is in variant-table.json):

```bash
python3 scripts/source-preserving/render.py \
    --clip scripts/evidence/spr-corpus-bytes/b8p3.mp4 --reality ink-manga \
    --out-dir /tmp/w5c/fastloop/vN --suffix vN --max-frames 300 --skip-provenance
python3 scripts/source-preserving/qa_check.py \
    --input /tmp/w5c/gates/b8-first300-gateref.mp4 \
    --output /tmp/w5c/fastloop/vN/ink-manga-vN.mp4 \
    --json /tmp/w5c/fastloop/vN/qa-vN.json
python3 scripts/source-preserving/cuts_deep.py \
    --input /tmp/w5c/gates/b8-first300-gateref.mp4 \
    --output /tmp/w5c/fastloop/vN/ink-manga-vN.mp4 \
    --json /tmp/w5c/fastloop/vN/cuts-deep-vN.json
```

The b2 iteration (phases 2/3) used the same render+gate command class on
the full 225-frame close-up (raw substrate as gate input), driven by a
scratch A/B harness that patches the config dict and calls the frozen
adapter's `render()` (same code path as the CLI); the decisive configs
were then re-verified through the CLI. Visual arbitration calls (VLM):
`fastloop-visual/vlm-*.json` (full-resolution strips; see README §3).

## 4. Full renders (final frozen config; each cell double-rendered)

```bash
# b8 — full 1190 frames, the scorecard substrate
python3 scripts/source-preserving/render.py \
    --clip scripts/evidence/spr-corpus-bytes/b8p3.mp4 --reality ink-manga \
    --out-dir /tmp/w5c/out/b8/pass1 --suffix b8 --frames 2,8,15,30,45
#   -> 1190 frames, sha256 8ffff3c1cb584307a6d61fe37232403057b0f14bbec72a80b97fc616f36e47df, 68525.2 ms
python3 scripts/source-preserving/render.py \
    --clip scripts/evidence/spr-corpus-bytes/b8p3.mp4 --reality ink-manga \
    --out-dir /tmp/w5c/out/b8/pass2 --suffix b8
#   -> sha256 8ffff3c1...  BYTE-IDENTICAL, 69008.4 ms

# b12 — the determinism cut, --max-frames 300 convention
python3 scripts/source-preserving/render.py \
    --clip scripts/evidence/spr-corpus-bytes/b8-b12.mp4 --reality ink-manga \
    --out-dir /tmp/w5c/out/b12/pass1 --suffix b12 --max-frames 300 --frames 2,8
python3 scripts/source-preserving/render.py \
    --clip scripts/evidence/spr-corpus-bytes/b8-b12.mp4 --reality ink-manga \
    --out-dir /tmp/w5c/out/b12/pass2 --suffix b12 --max-frames 300
#   -> 300 frames, 95fca63a5bea364b6f056766725f1e25cce7789a2948aff1c6294085c70ce841  x2  BYTE-IDENTICAL

# b2 — close-up, 225 frames
python3 scripts/source-preserving/render.py \
    --clip scripts/evidence/spr-corpus-bytes/clip-b2-closeup.mp4 --reality ink-manga \
    --out-dir /tmp/w5c/out/b2/pass1 --suffix b2 --frames 2,8
python3 scripts/source-preserving/render.py \
    --clip scripts/evidence/spr-corpus-bytes/clip-b2-closeup.mp4 --reality ink-manga \
    --out-dir /tmp/w5c/out/b2/pass2 --suffix b2
#   -> 225 frames, ecea14b0379141de0ba4b2561a2f975a2390407a2518e8287259aa25bbbbfa16  x2  BYTE-IDENTICAL
```

## 5. Gates (per cell, on pass 1)

```bash
# b8 + b2 vs the RAW substrates
python3 scripts/source-preserving/qa_check.py \
    --input scripts/evidence/spr-corpus-bytes/b8p3.mp4 \
    --output /tmp/w5c/out/b8/pass1/ink-manga-b8.mp4 \
    --json scripts/evidence/spr-wave5-ink-manga/qa/qa-ink-manga-b8.json
python3 scripts/source-preserving/cuts_deep.py \
    --input scripts/evidence/spr-corpus-bytes/b8p3.mp4 \
    --output /tmp/w5c/out/b8/pass1/ink-manga-b8.mp4 \
    --json scripts/evidence/spr-wave5-ink-manga/qa/cuts-deep-ink-manga-b8.json
#   (same pair for b2 with clip-b2-closeup.mp4 / ink-manga-b2.mp4)

# b12 vs the pre-adjudicated first-300 gateref
python3 scripts/source-preserving/qa_check.py \
    --input /tmp/w5c/gates/b12-first300-gateref-from-old.mp4 \
    --output /tmp/w5c/out/b12/pass1/ink-manga-b12.mp4 \
    --json scripts/evidence/spr-wave5-ink-manga/qa/qa-ink-manga-b12.json
python3 scripts/source-preserving/cuts_deep.py \
    --input /tmp/w5c/gates/b12-first300-gateref-from-old.mp4 \
    --output /tmp/w5c/out/b12/pass1/ink-manga-b12.mp4 \
    --json scripts/evidence/spr-wave5-ink-manga/qa/cuts-deep-ink-manga-b12.json
```

All six JSONs exit 0: G-T1/T2/T3/T4 + G-T2b PASS on every cell
(the full table is README §4 / record.json).

## 6. Frame evidence (the frozen adapter's --frames; PNGs committed)

```bash
# extracted by the --frames flags in section 4 into each out-dir frames/;
# committed copies: frames/ink-manga-{b8,b12,b2}-t*s.png
```

## 7. Scorecard (frozen vlm_scorecard.py, machine-local evidence root)

```bash
# populate the harness's expected paths (NOT committed; copies committed
# under scorecards/ are byte-identical)
mkdir -p /home/z/spr-evidence/{bytes,render,qa/vlm}
cp scripts/evidence/spr-corpus-bytes/b8p3.mp4 /home/z/spr-evidence/bytes/b8p3.mp4
cp /tmp/w5c/out/b8/pass1/ink-manga-b8.mp4 /home/z/spr-evidence/render/ink-manga-b8.mp4
cp scripts/evidence/spr-wave5-ink-manga/qa/qa-ink-manga-b8.json \
   /home/z/spr-evidence/qa/metrics-ink-manga.json
cp scripts/evidence/spr-wave5-ink-manga/qa/cuts-deep-ink-manga-b8.json \
   /home/z/spr-evidence/qa/cuts-deep-ink-manga.json
#   + /home/z/spr-evidence/render/renders.json (the lane record: ink-manga
#     entry with files.b8.determinismDoubleRender.byteIdentical=true;
#     shape mirrors spr-tier2-scorecards/renders-with-b8-determinism.json)

python3 scripts/source-preserving/vlm_scorecard.py --realities ink-manga
#   -> 15/15 calls ok=True (glm-5v-turbo), tierClaim=0, critical=88
#   outputs: /home/z/spr-evidence/qa/scorecard-ink-manga.json
#            /home/z/spr-evidence/qa/vlm/ink-manga-*.json (15 raw calls)
#            /home/z/spr-evidence/qa/vlm-scorecard.json (aggregate)
```

## 8. Regression (frozen render.py, AFTER the promotion edit)

```bash
python3 scripts/source-preserving/render.py \
    --clip scripts/evidence/spr-corpus-bytes/b8p3.mp4 --reality cartoon-cel \
    --out-dir /tmp/w5c/regress/cartoon-cel --suffix b8 --skip-provenance
#   -> a9e8cd5612f1486fde86b970dd5aab50b9c6d495e18a59d416fef1718e84f26c  == w4b anchor
python3 scripts/source-preserving/render.py \
    --clip scripts/evidence/spr-corpus-bytes/b8p3.mp4 --reality noir-retro \
    --profile noir --out-dir /tmp/w5c/regress/noir-retro --suffix b8 --skip-provenance
#   -> 3eedb4238f56900f6b1559ce0f19e0ea1aa2044a453bdd2bce453d4a1b0711a4  == w4b anchor
python3 scripts/source-preserving/render.py \
    --clip scripts/evidence/spr-corpus-bytes/b8p3.mp4 --reality subject-toon \
    --out-dir /tmp/w5c/regress/subject-toon --suffix b8 --skip-provenance
#   -> 503ea271561d770c8482a8e472582aba5b54fd4a889b7eeef2c889d59e960f74  == w4b anchor
```

## 9. Delivery

```bash
git add -A && git commit -m "spr: w5c ink-manga renderer — SPR104 deterministic trial (XDoG + fixed-lattice screentone) + frozen-protocol scorecard"
git push https://${GH_TOKEN}@github.com/payswapdotorg/sporta.git spr/w5c/ink-manga:spr/w5c/ink-manga
```
