# SPR-W4-C — exact commands (run from the repo root at `eb3b404` + this branch's renderers.py edit)

All renders/gates ran foreground, sequential (sandbox kills background
processes). Python = the project venv `.venv/bin/python` (opencv 5.0.0,
numpy 2.5.3); ffmpeg 7.1.5-0deb13u1 system binary. Out-dirs live OUTSIDE
the repo tree (`/home/z/my-project/renders-w4c/…`); pass 2 always uses an
independent out-dir (G-T5 double-render discipline).

## 0. Setup + substrate verification

```bash
git clone https://github.com/payswapdotorg/sporta.git sporta-w4c
cd sporta-w4c
git checkout eb3b404
git checkout -b spr/w4c/neon-reality
python3 -m venv .venv && . .venv/bin/activate
.venv/bin/pip install opencv-python-headless numpy
ffmpeg -version | head -1
sha256sum scripts/evidence/spr-corpus-bytes/*   # all 8 == README table / corpus.json
```

## 1. Registry listing proof (post-edit, frozen adapter untouched)

```bash
.venv/bin/python scripts/source-preserving/render.py --help \
  > scripts/evidence/spr-wave4-neon/registry-listing.txt
# --reality {anime-npr,cartoon-cel,motion-trails,neon-cyberpunk,noir-retro,subject-toon}
```

## 2. Additive-diff gate

```bash
git diff eb3b404 --stat  -- scripts/source-preserving/spe/renderers.py   # +211 / -0
git diff eb3b404 --numstat -- scripts/source-preserving/spe/renderers.py # 211  0
git status --porcelain   # only spe/renderers.py modified inside the repo
```

## 3. Coverage renders (each double-rendered, independent out-dirs)

```bash
# b8 — wide, full 1190-frame window
.venv/bin/python scripts/source-preserving/render.py \
  --clip scripts/evidence/spr-corpus-bytes/b8p3.mp4 --reality neon-cyberpunk \
  --profile default --out-dir /home/z/my-project/renders-w4c/neon-b8/pass1 \
  --suffix b8 --frames 2,8
#   -> 1190 frames, sha256 25508766d39840c227cb8cd8381f2c435e81a784bf5d0f4055fa25ff59c6c8bf, 61035.8 ms
.venv/bin/python scripts/source-preserving/render.py \
  --clip scripts/evidence/spr-corpus-bytes/b8p3.mp4 --reality neon-cyberpunk \
  --profile default --out-dir /home/z/my-project/renders-w4c/neon-b8/pass2 \
  --suffix b8
#   -> 1190 frames, sha256 25508766d39840c227cb8cd8381f2c435e81a784bf5d0f4055fa25ff59c6c8bf, 60906.1 ms  (byte-identical)

# b2 — closeup, 225 frames
.venv/bin/python scripts/source-preserving/render.py \
  --clip scripts/evidence/spr-corpus-bytes/clip-b2-closeup.mp4 --reality neon-cyberpunk \
  --profile default --out-dir /home/z/my-project/renders-w4c/neon-b2/pass1 \
  --suffix b2 --frames 2,8
#   -> 225 frames, sha256 57ef6455133d108d4ecd6d9205c1027384869bc5cf54be71261d289125d0a765, 12022.7 ms
.venv/bin/python scripts/source-preserving/render.py \
  --clip scripts/evidence/spr-corpus-bytes/clip-b2-closeup.mp4 --reality neon-cyberpunk \
  --profile default --out-dir /home/z/my-project/renders-w4c/neon-b2/pass2 \
  --suffix b2
#   -> 225 frames, sha256 57ef6455133d108d4ecd6d9205c1027384869bc5cf54be71261d289125d0a765, 12130.9 ms  (byte-identical)

# b5 — camera-move pan, 300 frames
.venv/bin/python scripts/source-preserving/render.py \
  --clip scripts/evidence/spr-corpus-bytes/clip-b5-camera-move.mp4 --reality neon-cyberpunk \
  --profile default --out-dir /home/z/my-project/renders-w4c/neon-b5/pass1 \
  --suffix b5 --frames 2,8
#   -> 300 frames, sha256 a3d5942ebc0c747a8e34f310322d2eae9778d134120750bc1ad2111a2936c6fc, 16247.0 ms
.venv/bin/python scripts/source-preserving/render.py \
  --clip scripts/evidence/spr-corpus-bytes/clip-b5-camera-move.mp4 --reality neon-cyberpunk \
  --profile default --out-dir /home/z/my-project/renders-w4c/neon-b5/pass2 \
  --suffix b5
#   -> 300 frames, sha256 a3d5942ebc0c747a8e34f310322d2eae9778d134120750bc1ad2111a2936c6fc, 15958.0 ms  (byte-identical)
```

## 4. Gates vs RAW substrates (qa_check + cuts_deep per clip)

```bash
EV=scripts/evidence/spr-wave4-neon

.venv/bin/python scripts/source-preserving/qa_check.py \
  --input scripts/evidence/spr-corpus-bytes/b8p3.mp4 \
  --output /home/z/my-project/renders-w4c/neon-b8/pass1/neon-cyberpunk-b8.mp4 \
  --json $EV/qa/qa-neon-b8.json      # allPass TRUE (T1 1190==1190 d20 | T2 cov 1.0 | T3 r 0.9914 | T4 0.607%)
.venv/bin/python scripts/source-preserving/cuts_deep.py \
  --input scripts/evidence/spr-corpus-bytes/b8p3.mp4 \
  --output /home/z/my-project/renders-w4c/neon-b8/pass1/neon-cyberpunk-b8.mp4 \
  --json $EV/qa/cuts-deep-neon-b8.json   # PASS cov 1.0, invented []

.venv/bin/python scripts/source-preserving/qa_check.py \
  --input scripts/evidence/spr-corpus-bytes/clip-b2-closeup.mp4 \
  --output /home/z/my-project/renders-w4c/neon-b2/pass1/neon-cyberpunk-b2.mp4 \
  --json $EV/qa/qa-neon-b2.json      # allPass TRUE (T1 225==225 d20 | T2 cov 1.0 | T3 r 0.9985 | T4 1.259%)
.venv/bin/python scripts/source-preserving/cuts_deep.py \
  --input scripts/evidence/spr-corpus-bytes/clip-b2-closeup.mp4 \
  --output /home/z/my-project/renders-w4c/neon-b2/pass1/neon-cyberpunk-b2.mp4 \
  --json $EV/qa/cuts-deep-neon-b2.json   # PASS cov 1.0, invented []

.venv/bin/python scripts/source-preserving/qa_check.py \
  --input scripts/evidence/spr-corpus-bytes/clip-b5-camera-move.mp4 \
  --output /home/z/my-project/renders-w4c/neon-b5/pass1/neon-cyberpunk-b5.mp4 \
  --json $EV/qa/qa-neon-b5.json      # allPass FALSE — ONLY the F2 zero-cut vacuous T2 (cov 0.0, extra 0.0, in/out cuts []); T1/T3/T4 PASS
.venv/bin/python scripts/source-preserving/cuts_deep.py \
  --input scripts/evidence/spr-corpus-bytes/clip-b5-camera-move.mp4 \
  --output /home/z/my-project/renders-w4c/neon-b5/pass1/neon-cyberpunk-b5.mp4 \
  --json $EV/qa/cuts-deep-neon-b5.json   # PASS (0 cuts to preserve, 0 invented — vacuous adjudication)
```

## 5. Regression proof (engine untouched)

```bash
.venv/bin/python scripts/source-preserving/render.py \
  --clip scripts/evidence/spr-corpus-bytes/b8p3.mp4 --reality cartoon-cel \
  --profile default --out-dir /home/z/my-project/renders-w4c/regression/cartoon-cel-b8 \
  --suffix b8
#   -> 1190 frames, 278847.3 ms
sha256sum /home/z/my-project/renders-w4c/regression/cartoon-cel-b8/cartoon-cel-b8.mp4
#   a9e8cd5612f1486fde86b970dd5aab50b9c6d495e18a59d416fef1718e84f26c
#   == wave-1 record (spr-wave1-recovery/renders.json)  -> BYTE-IDENTICAL, PASS
```

## 6. Frames evidence (already produced by --frames 2,8 in §3)

```bash
cp /home/z/my-project/renders-w4c/neon-b8/pass1/frames/neon-cyberpunk-b8-t{2,8}s.png  $EV/frames/
cp /home/z/my-project/renders-w4c/neon-b2/pass1/frames/neon-cyberpunk-b2-t{2,8}s.png  $EV/frames/
cp /home/z/my-project/renders-w4c/neon-b5/pass1/frames/neon-cyberpunk-b5-t{2,8}s.png  $EV/frames/
```

## 7. Smoke sanity (numeric, VLM-free — NOT a quality claim)

```bash
# 60-frame smoke render (same frozen constants, --skip-provenance, scratch dir)
.venv/bin/python scripts/source-preserving/render.py \
  --clip scripts/evidence/spr-corpus-bytes/b8p3.mp4 --reality neon-cyberpunk \
  --profile default --out-dir /home/z/my-project/renders-w4c/smoke-b8f60 \
  --suffix b8smoke --max-frames 60 --skip-provenance
# numeric stats harness (outside the repo):
.venv/bin/python /home/z/my-project/scripts/w4c_smoke_stats.py
```

## 8. Commit + push

```bash
git add scripts/source-preserving/spe/renderers.py scripts/evidence/spr-wave4-neon
git commit -m "SPR-W4-C: SPR107 neon-cyberpunk reality — additive registry promotion + coverage gates + regression proof"
git push https://<token>@github.com/payswapdotorg/sporta.git spr/w4c/neon-reality
```
