# SPR-W5-A — Commands (every class, verbatim)

Session: 2026-09-27/28, branch `spr/w5a/tier2-push`, base `5650cfd3f500ac664e2816a598285b4cda4159b0`
(origin/main post w5e merge — task packet §1).

## 1. Bootstrap

```
git clone https://github.com/payswapdotorg/sporta.git sporta
cd sporta
git checkout 5650cfd3f500ac664e2816a598285b4cda4159b0
git rev-parse HEAD        # 5650cfd3f500ac664e2816a598285b4cda4159b0
git checkout -b spr/w5a/tier2-push
python3 -m venv .venv
.venv/bin/pip install opencv-python-headless==5.0.0.93 numpy==2.5.3
ffmpeg -version | head -1  # ffmpeg version 7.1.5-0+deb13u1
.venv/bin/python3 -c "import cv2, numpy; print(cv2.__version__, numpy.__version__)"
                           # 5.0.0 2.5.3  (== w3b/w4b session records)
sha256sum scripts/evidence/spr-corpus-bytes/b8p3.mp4 scripts/evidence/spr-corpus-bytes/b8-b12.mp4 scripts/evidence/spr-corpus-bytes/clip-b2-closeup.mp4
# 969af7c6fdb172091ff00705b25fa37b7073f4332d722416b9754a4a7579917a  b8p3.mp4
# b3cc5f0e2fae840f2aef93d859ce814babca226ee0b5d27e6da4e969b4312462  b8-b12.mp4
# e65ae48740472f57ada031fdfb076cbb40a845239693acad83e8142c0caec062  clip-b2-closeup.mp4
```

VLM access test (one call, before anything else):

```
ffmpeg -y -loglevel error -ss 2 -i scripts/evidence/spr-corpus-bytes/b8p3.mp4 -frames:v 1 /tmp/vlmtest/frame.png
z-ai vision -p "Describe this football broadcast frame in one sentence." -i /tmp/vlmtest/frame.png -o /tmp/vlmtest/test-vlm.json
# ok: glm-5v-turbo content returned (same model as the w3b scorecard records)
```

## 2. Control + anchor verification (pristine tree, BEFORE any edit)

```
.venv/bin/python3 scripts/source-preserving/render.py \
    --clip scripts/evidence/spr-corpus-bytes/clip-b7-night.mp4 \
    --reality motion-trails --out-dir /tmp/w5a/control/b7 --suffix b7
    # sha256 998c9b4948e092d89210847786b0a82dbdceec71ffe20c3f83ded1805430bdb9  == w4b control (BYTE-MATCH)
.venv/bin/python3 scripts/source-preserving/render.py \
    --clip scripts/evidence/spr-corpus-bytes/b8p3.mp4 \
    --reality cartoon-cel --out-dir /tmp/w5a/control/b8cc --suffix b8
    # sha256 a9e8cd5612f1486fde86b970dd5aab50b9c6d495e18a59d416fef1718e84f26c  == w4b/wave-1 anchor (BYTE-MATCH)
.venv/bin/python3 scripts/source-preserving/render.py \
    --clip scripts/evidence/spr-corpus-bytes/b8p3.mp4 \
    --reality subject-toon --out-dir /tmp/w5a/baseline/b8 --suffix b8
    # sha256 503ea271561d770c8482a8e472582aba5b54fd4a889b7eeef2c889d59e960f74  == w3b/w4b v0.1.0 anchor (BYTE-MATCH)
```

## 3. b12 derived gate reference (w4b commands.md §2 recipe, reproduced)

```
git show 805a5fc:scripts/evidence/spr-corpus-bytes/b8-b12.mp4 > /tmp/w5a/gates/b12-old-substrate.mp4
    # sha256 7cb3d728cc349720043c74e32258de55f0ea87b9314515d8e5d4020853143421 (== w3b README)
ffmpeg -y -loglevel error -i /tmp/w5a/gates/b12-old-substrate.mp4 \
    -frames:v 300 -t 12 -c:v libx264 -crf 20 -preset medium -threads 1 \
    -pix_fmt yuv420p -g 50 -fflags +bitexact -flags:v +bitexact \
    -map_metadata -1 -c:a copy /tmp/w5a/gates/b12-first300-gateref-from-old.mp4
    # sha256 d19079ca133cbfe02dde534bd74c579818cb9b92e6272a4f7af9f77e1737115b  == w3b pin (BYTE-MATCH)
```

## 4. Fast loop (variants on the b12 300-frame window + b8 first-600)

Scratch driver `/home/z/w5a-scratch/variant_driver.py` (recorded in §8; NOT
committed — repo-external scratch per the house convention). It imports the
frozen `render.py` module and mutates only `REGISTRY["subject-toon"].config`
before calling `render.render(...)` — the identical probe/analyze/palette/
FrameProcessor/encode_bitexact pipeline, so each variant render is
byte-equivalent to what the committed config produces.

```
# v0.1.0-equivalence proof through the MODIFIED class (config overlay = w3b v0.1.0 config):
.venv/bin/python3 /home/z/w5a-scratch/variant_driver.py v010 /tmp/w5a/out/v010-b12 scripts/evidence/spr-corpus-bytes/b8-b12.mp4 300 b12
    # sha256 3c0fdf81daeecee4aa6fa31b38dfbc94a7ed94b22653057d1c2b50931964a886 == w4b matrix record (BYTE-MATCH)
# variants A / B / C (same command class, arg 2..4 vary):
.venv/bin/python3 /home/z/w5a-scratch/variant_driver.py A /tmp/w5a/out/varA-b12 scripts/evidence/spr-corpus-bytes/b8-b12.mp4 300 b12
.venv/bin/python3 /home/z/w5a-scratch/variant_driver.py B /tmp/w5a/out/varB-b12 scripts/evidence/spr-corpus-bytes/b8-b12.mp4 300 b12
.venv/bin/python3 /home/z/w5a-scratch/variant_driver.py C /tmp/w5a/out/varC-b12 scripts/evidence/spr-corpus-bytes/b8-b12.mp4 300 b12
.venv/bin/python3 /home/z/w5a-scratch/variant_driver.py C /tmp/w5a/out/varC-b8first600 scripts/evidence/spr-corpus-bytes/b8p3.mp4 600 b8
```

Fast-loop gates (per variant, b12 window):

```
.venv/bin/python3 scripts/source-preserving/qa_check.py \
    --input /tmp/w5a/gates/b12-first300-gateref-from-old.mp4 \
    --output /tmp/w5a/out/var<A|B|C>-b12/subject-toon-b12.mp4 \
    --json /tmp/w5a/qa/qa-<V>-b12.json
.venv/bin/python3 scripts/source-preserving/cuts_deep.py \
    --input /tmp/w5a/gates/b12-first300-gateref-from-old.mp4 \
    --output /tmp/w5a/out/var<A|B|C>-b12/subject-toon-b12.mp4 \
    --json /tmp/w5a/qa/cuts-deep-<V>-b12.json
```

Fast-loop mini-protocol VLM (variant selection only — W2-C mini-protocol
class, NOT a tier claim): `/home/z/w5a-scratch/fastloop_vlm.py` and
`fastloop_vlm600.py` (recorded in §8) ran the FROZEN
`vlm_scorecard.PROMPT` verbatim (imported from the harness module) on the
worst-critical samples, original + stylized@t + stylized@t+0.2. NOTE (honest
defect of the scratch fast loop, does not affect the frozen scorecard): the
scratch driver paired cut-adjacent `pre` samples FORWARD (+0.2 s), crossing
the source cut, whereas the frozen harness pairs `pre` BACKWARD — so the
fast-loop numbers for c*pre samples are pessimistically wrong for ALL
variants equally; the frozen scorecard in §6 pairs correctly.

## 5. Full battery (the shipped v0.2.0 config, through the frozen CLI)

```
.venv/bin/python3 scripts/source-preserving/render.py \
    --clip scripts/evidence/spr-corpus-bytes/b8p3.mp4 \
    --reality subject-toon --out-dir /tmp/w5a/out2/b8p1 --suffix b8        # pass 1
.venv/bin/python3 scripts/source-preserving/render.py \
    --clip scripts/evidence/spr-corpus-bytes/b8p3.mp4 \
    --reality subject-toon --out-dir /tmp/w5a/out2/b8p2 --suffix b8        # pass 2
    # both: sha256 aaac76b75a24f43e6a479ddd663a322a078afb441d40855d118fc79dc075a6a3 (byte-identical)
.venv/bin/python3 scripts/source-preserving/render.py \
    --clip scripts/evidence/spr-corpus-bytes/b8-b12.mp4 \
    --reality subject-toon --out-dir /tmp/w5a/out2/b12p1 --suffix b12 --max-frames 300   # pass 1
.venv/bin/python3 scripts/source-preserving/render.py \
    --clip scripts/evidence/spr-corpus-bytes/b8-b12.mp4 \
    --reality subject-toon --out-dir /tmp/w5a/out2/b12p2 --suffix b12 --max-frames 300   # pass 2
    # both: sha256 50edb582f6874d0d1ca1b79ed5ade6a7984cf1ba6a37f5f928c32a602372d964 (byte-identical)
.venv/bin/python3 scripts/source-preserving/render.py \
    --clip scripts/evidence/spr-corpus-bytes/clip-b2-closeup.mp4 \
    --reality subject-toon --out-dir /tmp/w5a/out2/b2p1 --suffix b2        # pass 1
.venv/bin/python3 scripts/source-preserving/render.py \
    --clip scripts/evidence/spr-corpus-bytes/clip-b2-closeup.mp4 \
    --reality subject-toon --out-dir /tmp/w5a/out2/b2p2 --suffix b2        # pass 2
    # both: sha256 883172b6cadbb75d3d9f7a4e289c77214e0a0149b4ddcc5f31821b403ba2fe80 (byte-identical)
```

Gates per cell (pass 1; `<gate-input>` = raw substrate for b8/b2, the derived
300-frame gateref for b12 — the pre-adjudicated w4b convention):

```
.venv/bin/python3 scripts/source-preserving/qa_check.py \
    --input <gate-input> --output /tmp/w5a/out2/<cell>p1/subject-toon-<cell>.mp4 \
    --json scripts/evidence/spr-tier2-push/qa/qa-subject-toon-<cell>.json
.venv/bin/python3 scripts/source-preserving/cuts_deep.py \
    --input <gate-input> --output /tmp/w5a/out2/<cell>p1/subject-toon-<cell>.mp4 \
    --json scripts/evidence/spr-tier2-push/qa/cuts-deep-subject-toon-<cell>.json
```

Other-lane regression (on the MODIFIED tree, after the renderers.py v0.2.0
edit — byte-identity proves the edit is lane-isolated):

```
.venv/bin/python3 scripts/source-preserving/render.py \
    --clip scripts/evidence/spr-corpus-bytes/clip-b7-night.mp4 \
    --reality motion-trails --out-dir /tmp/w5a/regress/b7mt --suffix b7
    # sha256 998c9b4948e092d89210847786b0a82dbdceec71ffe20c3f83ded1805430bdb9  == anchor (BYTE-MATCH)
.venv/bin/python3 scripts/source-preserving/render.py \
    --clip scripts/evidence/spr-corpus-bytes/b8p3.mp4 \
    --reality cartoon-cel --out-dir /tmp/w5a/regress/b8cc --suffix b8
    # sha256 a9e8cd5612f1486fde86b970dd5aab50b9c6d495e18a59d416fef1718e84f26c  == anchor (BYTE-MATCH)
```

## 6. Frozen-protocol VLM scorecard (harness, expected evidence-root layout)

The frozen harness hard-codes `/home/z/spr-evidence/`; the layout was
recreated in this sandbox (substrate copied from spr-corpus-bytes, sha
re-verified; render outputs placed where the script expects; gates JSONs
copied to the harness stems; renders.json in the w6-spr-3
renders-with-b8-determinism shape):

```
cp scripts/evidence/spr-corpus-bytes/b8p3.mp4 /home/z/spr-evidence/bytes/b8p3.mp4
cp /tmp/w5a/out2/b8p1/subject-toon-b8.mp4 /home/z/spr-evidence/render/subject-toon-b8.mp4
cp /tmp/w5a/qa-full/qa-subject-toon-b8.json /home/z/spr-evidence/qa/metrics-subject-toon.json
cp /tmp/w5a/qa-full/cuts-deep-subject-toon-b8.json /home/z/spr-evidence/qa/cuts-deep-subject-toon.json
# renders.json written with realities=[subject-toon v0.2.0, files.b8/b12.determinismDoubleRender]
.venv/bin/python3 scripts/source-preserving/vlm_scorecard.py --realities subject-toon
# 15/15 calls ok=True (glm-5v-turbo); outputs:
#   /home/z/spr-evidence/qa/scorecard-subject-toon.json
#   /home/z/spr-evidence/qa/vlm/subject-toon-<sample>.json  (15 raw per-call JSONs)
#   /home/z/spr-evidence/qa/vlm-scorecard.json (aggregate)
```

## 7. Frame evidence

The harness extracted the frozen sample frames (t=2/8/15/30/45 s +
cut-adjacent pre/post, original + stylized + stylized@t±0.2 s) into
`/home/z/spr-evidence/render/frames/vlm2/`; all 45 PNGs copied to
`scripts/evidence/spr-tier2-push/frames/`. Every previously-critical sample
(t8s/t15s/t45s/c189post/c550pre/c862post/c982post at v0.1.0) is inside the
frozen sample set.

## 8. Scratch tooling (NOT committed, recorded verbatim here)

- `/home/z/w5a-scratch/variant_driver.py` — fast-loop variant driver (config
  overlays over the frozen render pipeline; V010/MASK_A/BG_B/SJ_C dicts are
  the w3b-recorded v0.1.0 config and the three variant overlays).
- `/home/z/w5a-scratch/fastloop_vlm.py`, `fastloop_vlm600.py` — mini-protocol
  VLM loops (frozen PROMPT imported verbatim; the c*pre forward-pair defect
  is recorded in §4).

## 9. Record assembly

`renders.json` assembled by a scratch python block reading the qa/cuts-deep
JSONs and sha256-hashing the render outputs from disk (no gate value
transcribed by hand); README tables generated from that record.
