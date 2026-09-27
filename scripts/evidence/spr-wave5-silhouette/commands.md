# SPR-W5-G — exact commands (run from the repo root at `b612adf` + this branch's renderers.py edit)

All renders/gates ran foreground, sequential (the sandbox kills background
processes). Python = system `python3` (3.12.14, opencv 4.13.0, numpy
2.1.3 — identical to the frozen engine toolset record); ffmpeg
7.1.5-0+deb13u1 system binary. Out-dirs live OUTSIDE the repo tree
(`/tmp/w5g/…`); pass 2 always uses an independent out-dir (G-T5
double-render discipline). The machine-local scorecard root is a symlink
`/home/z/spr-evidence -> /tmp/w5g/spr-evidence` (the frozen harness's
hardcoded expected path; the task packet's under-/tmp layout — both
satisfied; NOT committed; the committed copies in this dir are
byte-identical). Iteration drivers were persisted outside the repo at
`/home/z/my-project/scripts/w5g_*.py` (fastloop / fullrender).

## 0. Setup + substrate verification

```bash
git clone https://github.com/payswapdotorg/sporta.git sporta
cd sporta
git checkout b612adf98823001fdbdb524929c79991c9ffa3fc   # origin/main
git rev-parse HEAD   # b612adf...
git checkout -b spr/w5g/silhouette-trial
python3 --version && python3 -c "import cv2, numpy; print(cv2.__version__, numpy.__version__)"
python3 -c "import cv2; m = cv2.createBackgroundSubtractorMOG2(history=200, varThreshold=34, detectShadows=False); print('MOG2 OK')"
ffmpeg -version | head -1
sha256sum scripts/evidence/spr-corpus-bytes/b8p3.mp4 \
          scripts/evidence/spr-corpus-bytes/b8-b12.mp4 \
          scripts/evidence/spr-corpus-bytes/clip-b2-closeup.mp4
# 969af7c6... / b3cc5f0e... / e65ae487...  (== corpus README, byte-exact)
# engine cut-detect sanity (cut-reset targets):
python3 -c "import sys; sys.path.insert(0,'scripts/source-preserving'); from spe import stages as S; print(S.analyze('scripts/evidence/spr-corpus-bytes/b8p3.mp4')['cuts'])"
# [188, 474, 549, 861, 881, ..., 977] -> scene starts 189/475/550/862 + the recorded
# 882-943 goal-segment false-positive class + 978 (the w5e-recorded engine behavior;
# root-caused as the invented-cut manufacturer in this lane's phase-3)
```

## 1. Additive-diff gate (after the row edit)

```bash
git diff b612adf --numstat -- scripts/source-preserving/spe/renderers.py
# 559  0    (additions only)
git status --porcelain  # only spe/renderers.py + scripts/evidence/spr-wave5-silhouette/
git diff b612adf --stat -- scripts/source-preserving/render.py \
    scripts/source-preserving/spe/{stages,encode,provenance,registry,__init__}.py \
    scripts/source-preserving/{qa_check,cuts_deep,vlm_scorecard}.py \
    scripts/source-preserving/spe/trials/     # EMPTY — frozen files byte-identical
python3 scripts/source-preserving/render.py --help \
  > scripts/evidence/spr-wave5-silhouette/registry-listing.txt
# --reality {...,silhouette-xray,...}
```

## 2. Fast-loop gate references (the recorded command classes)

```bash
mkdir -p /tmp/w5g/gates
# b8-first300 derived reference (the w4b/W2C class; byte-reproduces 9efa9b99...)
ffmpeg -y -loglevel error -i scripts/evidence/spr-corpus-bytes/b8p3.mp4 \
    -frames:v 300 -t 12 -c:v libx264 -crf 20 -preset medium -threads 1 \
    -pix_fmt yuv420p -g 50 -fflags +bitexact -flags:v +bitexact \
    -map_metadata -1 -c:a copy /tmp/w5g/gates/b8-first300-gateref.mp4
sha256sum /tmp/w5g/gates/b8-first300-gateref.mp4
# 9efa9b99aa74c0e365a4e22417ec3e4eece60633c6e3aac5cdd2cad6e3ec889b  (== w4b record)

# b12-first300 gateref from the PRE-w3a-fix substrate (the pre-adjudicated
# 338-vs-300 metadata class; byte-reproduces the w3b pin d19079ca...)
git show 805a5fc:scripts/evidence/spr-corpus-bytes/b8-b12.mp4 > /tmp/w5g/gates/b12-old-substrate.mp4
sha256sum /tmp/w5g/gates/b12-old-substrate.mp4
# 7cb3d728cc349720043c74e32258de55f0ea87b9314515d8e5d4020853143421  (== w4b record)
ffmpeg -y -loglevel error -i /tmp/w5g/gates/b12-old-substrate.mp4 \
    -frames:v 300 -t 12 -c:v libx264 -crf 20 -preset medium -threads 1 \
    -pix_fmt yuv420p -g 50 -fflags +bitexact -flags:v +bitexact \
    -map_metadata -1 -c:a copy /tmp/w5g/gates/b12-first300-gateref-from-old.mp4
sha256sum /tmp/w5g/gates/b12-first300-gateref-from-old.mp4
# d19079ca133cbfe02dde534bd74c579818cb9b92e6272a4f7af9f77e1737115b  (== w3b pin)
```

## 3. Fast loop (phases 1/2 + the phase-3 re-opens)

Phase 1/2 driver (per-variant: patch SILHOUETTE_XRAY.config in place — the
w5e convention, same code path as the CLI — call the frozen adapter's
`render()`, then the frozen gate CLIs against the b8-first300 gateref):

```bash
python3 /home/z/my-project/scripts/w5g_fastloop.py            # v1..v5
#   v1 comp-off      T3 0.8565 PASS (pan-correlated jitter — the A/B leg)
#   v2 baseline      T3 0.6986 FAIL (the structure-selecting tension)
#   v3 varthreshold  T3 0.6497 FAIL (VLM duel-1 winner on cleanliness)
#   v4 morphology    T3 0.6682 FAIL
#   v5 framediff     T2b FAIL invented [33,121,126,173], T3 0.7885 — the
#                    fallback leg measured ONCE, worse than MOG2, NOT shipped
# phase-2 grid (same driver, VARIANTS patched):
#   s1 decay75            T3 0.8573 (the T3 knob found)
#   s2 soften15           T3 0.7006
#   s3 decay75+soften15   T3 0.8583
#   s4 dilate3            T3 0.7515
#   s5 thr40+decay75      T3 0.8394 all green
#   s6 thr34+decay75      T3 0.8473 all green  -> VLM duel-2 WINNER, frozen
# CLI re-verify of the frozen winner + double render (both byte-identical):
python3 scripts/source-preserving/render.py --clip scripts/evidence/spr-corpus-bytes/b8p3.mp4 \
    --reality silhouette-xray --out-dir /tmp/w5g/fastloop-cli --suffix s6 \
    --max-frames 300 --skip-provenance
#   sha 2ae16ab0ff58b992... == driver s6; pass2 (independent out-dir) == same

# VLM duels (full-res strips, original + variants at t=2/t=8):
ffmpeg -y -loglevel error -ss 2 -i /tmp/w5g/gates/b8-first300-gateref.mp4 -frames:v 1 /tmp/w5g/duel/orig-t2.png
#   (same at t=8 and per-variant from each fastloop mp4; hstack xN, vstack rows)
z-ai vision -p "<duel prompt — see fastloop-visual/vlm-duel*.json>" -i duel-strip.png -o vlm-duel.json
#   duel1 WINNER=v3-varthreshold; duel2 (gate-passing candidates) WINNER=s6-thr34-decay75
```

Phase 3 (the honest re-opens — full-render b8 passes that FAILED T2b,
diagnosed, redesigned, re-measured; the intermediate artifacts were
discarded, not archived):

```bash
python3 /home/z/my-project/scripts/w5g_fullrender.py b8 b12 b2 b8-xray
#   the driver: per cell, two independent out-dirs + the frozen gate CLIs
#   on pass 1 (b8/b2 vs the raw substrates; b12 vs the pre-adjudicated
#   b12-first300-gateref-from-old.mp4)
# diagnostics that drove the redesign (representative commands):
python3 -c "... spike-rule + local-median analysis of the engine cut list on the
             320x180 diff series (the 882-943 false-positive class) ..."
python3 -c "... cross-cut global-fit increment measurement (<=8px, noise-averaged) ..."
python3 -c "... output diff-series + mask-coverage traces around 935/976-985
             (the close-up amplification + micro-shot classes) ..."
python3 -c "... residual-flow cut-detector separability measurement (NOT
             separable: cuts 3.0-10.5 vs goal segment up to 5.4 — abandoned) ..."
# final-code fast-loop re-verify through the frozen CLI:
python3 scripts/source-preserving/render.py --clip scripts/evidence/spr-corpus-bytes/b8p3.mp4 \
    --reality silhouette-xray --out-dir /tmp/w5g/final-verify --suffix final \
    --max-frames 300 --skip-provenance
#   sha 0ee35c7bbebb1ab8..., T2b PASS cov 1.0 inv [], T3 0.7875, T4 0.9743%
```

## 4. Full renders (final frozen config; each cell double-rendered)

```bash
# expanded by w5g_fullrender.py to (the frozen adapter CLI, verbatim class):
python3 scripts/source-preserving/render.py --clip scripts/evidence/spr-corpus-bytes/b8p3.mp4 \
    --reality silhouette-xray --out-dir /tmp/w5g/out/b8/pass1 --suffix b8 --frames 2,8,15,30,45
python3 scripts/source-preserving/render.py --clip scripts/evidence/spr-corpus-bytes/b8p3.mp4 \
    --reality silhouette-xray --out-dir /tmp/w5g/out/b8/pass2 --suffix b8
#   -> 1190 frames, sha256 81f5a8ee1ad26cbe739c347438a241bd8ac68b9b604010100fef160b0da0ba1d x2 BYTE-IDENTICAL
python3 scripts/source-preserving/render.py --clip scripts/evidence/spr-corpus-bytes/b8-b12.mp4 \
    --reality silhouette-xray --out-dir /tmp/w5g/out/b12/pass1 --suffix b12 --max-frames 300 --frames 2,8
python3 scripts/source-preserving/render.py --clip scripts/evidence/spr-corpus-bytes/b8-b12.mp4 \
    --reality silhouette-xray --out-dir /tmp/w5g/out/b12/pass2 --suffix b12 --max-frames 300
#   -> 300 frames, b7164f47... x2 BYTE-IDENTICAL
python3 scripts/source-preserving/render.py --clip scripts/evidence/spr-corpus-bytes/clip-b2-closeup.mp4 \
    --reality silhouette-xray --out-dir /tmp/w5g/out/b2/pass1 --suffix b2 --frames 2,8
python3 scripts/source-preserving/render.py --clip scripts/evidence/spr-corpus-bytes/clip-b2-closeup.mp4 \
    --reality silhouette-xray --out-dir /tmp/w5g/out/b2/pass2 --suffix b2
#   -> 225 frames, d7c791ca... x2 BYTE-IDENTICAL
# xray profile cell (shipped profile, full double-render + gates):
python3 scripts/source-preserving/render.py --clip scripts/evidence/spr-corpus-bytes/b8p3.mp4 \
    --reality silhouette-xray --profile xray --out-dir /tmp/w5g/out/b8-xray/pass1 --suffix b8-xray --frames 2,8,15,30,45
python3 scripts/source-preserving/render.py --clip scripts/evidence/spr-corpus-bytes/b8p3.mp4 \
    --reality silhouette-xray --profile xray --out-dir /tmp/w5g/out/b8-xray/pass2 --suffix b8-xray
#   -> 1190 frames, 3a5c467f... x2 BYTE-IDENTICAL
```

## 5. Gates (per cell, on pass 1)

```bash
# b8 + b2 + b8-xray vs the RAW substrate; b12 vs the pre-adjudicated gateref
python3 scripts/source-preserving/qa_check.py \
    --input scripts/evidence/spr-corpus-bytes/b8p3.mp4 \
    --output /tmp/w5g/out/b8/pass1/silhouette-xray-b8.mp4 \
    --json scripts/evidence/spr-wave5-silhouette/qa/qa-silhouette-xray-b8.json
python3 scripts/source-preserving/cuts_deep.py \
    --input scripts/evidence/spr-corpus-bytes/b8p3.mp4 \
    --output /tmp/w5g/out/b8/pass1/silhouette-xray-b8.mp4 \
    --json scripts/evidence/spr-wave5-silhouette/qa/cuts-deep-silhouette-xray-b8.json
#   (same pairs for b2 with clip-b2-closeup.mp4, for b8-xray with --profile xray output;
#    b12 with --input /tmp/w5g/gates/b12-first300-gateref-from-old.mp4)
```

Gate outcomes (the full table is README §4 / record.json): b8 ALL HARD
GATES GREEN (T2b cov 1.0, 0 invented, T3 0.8488, T4 0.7121%; the T2-raw
coverage residual is the micro-shot merged-fire class resolved by T2b —
the frozen harness's own resolution rule, the w5e b12/b2 precedent);
b12/b2/b8-xray carry honest FAILS with the four measured classes
(micro-shot second-boundary local-median; close-up amplification
2.4×-vs-2×; closeup zoom/parallax churn; xray distance-field interior
churn).

## 6. Frame evidence (the frozen adapter's --frames; PNGs committed)

```bash
# extracted by the --frames flags in section 4 into each out-dir frames/;
# committed copies: frames/silhouette-xray-{b8,b12,b2}-t*s.png +
# frames/silhouette-xray-xray-xray-b8-t*s.png (the xray profile grid)
```

## 7. Scorecard (frozen vlm_scorecard.py, machine-local evidence root)

```bash
# populate the harness's expected paths (under /tmp per the packet;
# symlinked to the harness's hardcoded /home/z/spr-evidence):
mkdir -p /tmp/w5g/spr-evidence/{bytes,render,qa/vlm}
ln -sfn /tmp/w5g/spr-evidence /home/z/spr-evidence
cp scripts/evidence/spr-corpus-bytes/b8p3.mp4 /tmp/w5g/spr-evidence/bytes/b8p3.mp4
cp /tmp/w5g/out/b8/pass1/silhouette-xray-b8.mp4 /tmp/w5g/spr-evidence/render/silhouette-xray-b8.mp4
cp /tmp/w5g/out/b8/qa.json /tmp/w5g/spr-evidence/qa/metrics-silhouette-xray.json
cp /tmp/w5g/out/b8/cuts-deep.json /tmp/w5g/spr-evidence/qa/cuts-deep-silhouette-xray.json
#   + /tmp/w5g/spr-evidence/render/renders.json (the lane record:
#     silhouette-xray entry with files.b8.determinismDoubleRender.
#     byteIdentical=true; shape mirrors spr-tier2-scorecards/
#     renders-with-b8-determinism.json — see the driver output)

python3 scripts/source-preserving/vlm_scorecard.py --realities silhouette-xray
#   -> 15/15 calls ok=True (glm-5v-turbo), tierClaim=0, critical=111
#   outputs: /home/z/spr-evidence/qa/scorecard-silhouette-xray.json
#            /home/z/spr-evidence/qa/vlm/silhouette-xray-*.json (15 raw calls)
#            /home/z/spr-evidence/qa/vlm-scorecard.json (aggregate)
# committed copies in scorecards/ verified byte-identical (sha compared)
```

## 8. Regression (frozen render.py, AFTER the full registration edit)

```bash
python3 scripts/source-preserving/render.py \
    --clip scripts/evidence/spr-corpus-bytes/b8p3.mp4 --reality cartoon-cel \
    --out-dir /tmp/w5g/regress/cartoon-cel --suffix b8 --skip-provenance
#   -> a9e8cd5612f1486fde86b970dd5aab50b9c6d495e18a59d416fef1718e84f26c  == w4b anchor
python3 scripts/source-preserving/render.py \
    --clip scripts/evidence/spr-corpus-bytes/b8p3.mp4 --reality noir-retro \
    --profile noir --out-dir /tmp/w5g/regress/noir-retro --suffix b8 --skip-provenance
#   -> 3eedb4238f56900f6b1559ce0f19e0ea1aa2044a453bdd2bce453d4a1b0711a4  == w4b anchor
python3 scripts/source-preserving/render.py \
    --clip scripts/evidence/spr-corpus-bytes/b8p3.mp4 --reality subject-toon \
    --out-dir /tmp/w5g/regress/subject-toon --suffix b8 --skip-provenance
#   -> 503ea271561d770c8482a8e472582aba5b54fd4a889b7eeef2c889d59e960f74  == w4b anchor
```

## 9. Delivery

```bash
git add -A && git commit -m "spr: w5g silhouette trial — SPR202 deterministic renderer (motion-compensated MOG2 + ink/xray profiles) + frozen-protocol scorecard"
GH_TOKEN=ghp_...
git push https://x-access-token:${GH_TOKEN}@github.com/payswapdotorg/sporta.git spr/w5g/silhouette-trial:spr/w5g/silhouette-trial
```

Mid-work milestone pushes (binding PUSH EARLY/PUSH OFTEN lesson): renderer
row, fast-loop winner freeze, full-render gate matrix + regression, final
evidence pack.

## 10. Sandbox incidents (recorded honestly)

- One transient SIGKILL of a pipelined command (the w4b-recorded
  evening-peak sandbox starvation class) — re-run isolated, artifacts
  unaffected.
- The z-ai platform redacts token strings in tool OUTPUT display
  ([REDACTED:github_token]) but the shell variable holds the real value
  (verified: the token authenticates as payswapdotorg with push:True);
  the first push failed on shell expansion ordering (assignment-prefix
  vs ${VAR} in the URL — fixed by assigning in a separate statement).
