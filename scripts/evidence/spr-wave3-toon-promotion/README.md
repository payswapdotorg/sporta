# SPR-W3-B — subject-toon Promotion + Formal Tier-2 Scorecards + noir-vhs T3 Diagnosis

Task: promote the W2-C `subject-toon` trial to a first-class registry reality,
run the formal frozen-protocol Tier-2 scorecards on the promoted renderer + the
two kept trials + a same-protocol cartoon-cel baseline, and root-cause the
noir-vhs G-T3 (F4) misses. Branch `spr/w3b/toon-promotion`, base `e55ae86`
(the `spr/w2c/stylizer-trials` tip — the only allowed base). Engine contract
FROZEN; the registry is additive (one new row, zero modified/deleted lines in
the diff vs origin).

## 1. Substrate verification (run first)

```
sha256sum scripts/evidence/spr-corpus-bytes/b8p3.mp4 scripts/evidence/spr-corpus-bytes/b8-b12.mp4
969af7c6fdb172091ff00705b25fa37b7073f4332d722416b9754a4a7579917a  b8p3.mp4   (== wave-2 corpus.json)
7cb3d728cc349720043c74e32258de55f0ea87b9314515d8e5d4020853143421  b8-b12.mp4 (== wave-2 corpus.json)
```

Tools: ffmpeg 7.1.5-0+deb13u1, opencv-python-headless 5.0.0, numpy 2.5.3
(venv; identical to the W2-B/W2-C session records — cross-session
determinism held, see §2/§5).

## 2. Promotion (gate 1, 5)

`scripts/source-preserving/spe/renderers.py`: one new `SUBJECT_TOON`
RendererSpec (`spr-subject-toon-dc1`, reality `subject-toon`, family
"Segmentation-Guided Toon (SPR101 guided variant)", sprId SPR101 per the
trial's yaml lineage, version 0.1.0 mirroring contract §4, `default` profile,
paletteK 10, usesFlow), a `_SubjectToonState` streaming pipeline ported from
`spe/trials/subject_toon.py`, one `elif` dispatch branch in `FrameProcessor`,
and a pure-addition registry append line.

- Diff vs `origin/spr/w2c/stylizer-trials`: **+166 / −0** — additions only,
  zero modified/deleted lines anywhere (the four existing declarations and the
  four-row REGISTRY construction are untouched).
- Adapter registration proof: frozen `render.py --reality` choices now list
  `subject-toon` (`{anime-npr,cartoon-cel,motion-trails,noir-retro,subject-toon}`).
- Port fidelity: helpers restated (not imported from `trials/common.py` —
  importing `spe.trials` from the frozen engine would couple `renderers.py` to
  the Lane-C write surface and pull every trial module in via the package
  `__init__`; `FrameProcessor` already carries identical helpers). **Port
  equivalence proven**: 240 frames (including the cut-189 MOG2 re-init path)
  byte-identical between the promoted branch and the frozen trial processor
  fed the same palette/cuts/frames.
- Known repo fact (pre-existing, NOT touched): `spe/registry.py` imports a
  non-existent `RENDERER_DECLARATIONS` and has been un-importable dead code at
  the base commit; the live registration path is `renderers.REGISTRY` ←
  `render.py`. Left exactly as found (forbidden scope).

## 3. Promotion renders + gates (gates 2, 3)

All renders via the FROZEN `render.py` (not the trial driver). Double-rendered
into independent out-dirs; both sha256 recorded.

| artifact | window | frames | sha256 (both passes) | G-T5 |
|---|---|---|---|---|
| subject-toon-b8.mp4 | b8 full | 1190 | `503ea271561d770c8482a8e472582aba5b54fd4a889b7eeef2c889d59e960f74` ×2 | **byte-identical** |
| subject-toon-b12.mp4 | b12, `--max-frames 300` | 300 | `edafe79fbe33850ebb5ae96f2648f8314660395569e308c161f0b470bde38246` ×2 | **byte-identical** |

Gate tables (full JSONs in `qa/`):

| render | G-T1 | G-T2 (spike) | G-T2b (deep) | G-T3 | G-T4 |
|---|---|---|---|---|---|
| subject-toon b8 (vs raw b8p3) | PASS 1190==1190, Δ20 ms, audio ✓ | PASS cov 1.0, extra 0.0 (all 6 cuts at exact indices 189/475/550/862/979/982) | PASS cov 1.0, 0 invented (amplitude carried 1.02–1.68×) | PASS r=0.9959 | PASS 0.5117 % (base 0.458 %) |
| subject-toon b12 (vs derived 300-frame gateref `d19079ca…`) | PASS 300==300, Δ0 ms, audio ✓ | PASS cov 1.0, extra 0.0 (b12 cuts 117/120 preserved) | PASS cov 1.0, 0 invented | PASS r=0.9976 | PASS 0.5751 % (base 0.4806 %) |

b12 honest notes (pre-existing, documented W2C §1, not introduced here):
the RAW-substrate `qa_check` run crashes (stale `nb_frames` metadata 338 +
301-decode-true vs the 300-frame max-frames window → `np.corrcoef` dies before
writing JSON — crash log kept at `qa/qa-subject-toon-b12-raw-crash.log`); vs
the 301-frame metadata-correct gateref the T1 facts are 301 vs 300 (the
packet's max-frames window convention), Δ40 ms. The derived 300-frame window
reference (`b12-first300-gateref.mp4`, sha
`d19079ca133cbfe02dde534bd74c579818cb9b92e6272a4f7af9f77e1737115b`) is the
W2C-precedent derived-reference class: metadata-correct, window-matched.

Frames evidence: `frames/promotion/` (t=2/8/11 s per render, PNG).

## 4. Existing-reality regression (gate 6)

cartoon-cel b8 re-rendered via the frozen `render.py` after the promotion edit:
sha256 `a9e8cd5612f1486fde86b970dd5aab50b9c6d495e18a59d416fef1718e84f26c`
**== the frozen wave-1 record** (renders-with-b8-determinism.json).
Byte-identical → the engine is untouched by the promotion edit. This render
also serves as the same-protocol scorecard baseline.

## 5. Formal Tier-2 scorecards (gate 4)

Frozen `vlm_scorecard.py` harness + frozen acceptance §2 7-axis protocol:
1–5 per axis with justification + 7-type artifact checklist (critical = limb
malformation / player disappearance); samples t=2/8/15/30/45 s + cut-adjacent
pre/post pairs that stay within the source shot (0.2 s temporal pairs); model
`glm-5v-turbo`. All four candidates scored on FULL-window b8 renders (the
promoted render; the regression-verified cartoon-cel render; fresh
full-window trial-driver renders for the two kept trials — the W2C 300-frame
trial renders are 12 s windows that cannot carry the t=15/30/45 sample set, so
same-protocol scoring required full-window renders; double-rendered, all
byte-identical: kuwahara `4da766b0…d370` ×2, flow-prop `3bfb647c…c519` ×2).

**VLM call accounting: 60/60 landed, 0 final errors.** One call
(flow-prop-toon c862pre) exhausted 3 retries with 90 s backoff during a 429
window, was honestly recorded `ok=False` at that point, and landed on a
post-cooldown retry. No stale/poisoned calls were reused (the wave-2 lesson).

| candidate | hard gates (T1,T2/T2b,T3,T4,T5) | sf | tc | ic | mf | scf | ss | critical artifacts | total artifacts | tierClaim |
|---|---|---|---|---|---|---|---|---|---|---|
| **subject-toon (promoted)** | ALL GREEN | **4.73** | 2.87 | **3.20** | **3.13** | 2.73 | 4.60 | **15** | 75 | **0** |
| cartoon-cel (baseline re-run) | ALL GREEN | 2.47 | 3.27 | 1.73 | 2.33 | 2.00 | 5.00 | 111 | 205 | 0 |
| kuwahara-paint (trial) | ALL GREEN | 4.13 | 2.53 | 2.00 | 2.07 | 2.67 | 4.87 | 50 | 101 | 0 |
| flow-prop-toon (trial) | ALL GREEN | 4.33 | 2.73 | 2.67 | 2.80 | 2.53 | 5.00 | 46 | 120 | 0 |

Hard-gate detail per candidate (b8 full window, `qa/metrics-*.json` +
`qa/cuts-deep-*.json`): T1 1190==1190 Δ20 ms audio ✓ ×4; T3: subject-toon
0.9959, cartoon-cel 0.9767, kuwahara 0.9555, flow-prop 0.9154 (all ≥0.80); T4:
0.5117 / 0.4033 / 0.4473 / 0.5097 % (all ≤1.5 %); T2 raw spike detector:
subject-toon PASS (cov 1.0), kuwahara PASS (cov 1.0, extra 0.63/30 s within
limit), cartoon-cel cov 0.833 (cut 550 softened below detector; frame 934 =
the wave-1-documented input-correspondent amplitude class) and flow-prop
cov 0.833 (979/982 micro-shot pair resolved to one spike at 981) — **both
resolved by the deep correspondence gate T2b: coverage 1.0, 0 invented cuts,
all six cuts amplitude-matched** (wave-1 precedent, gate JSONs kept side by
side).

**Honest tier reading (nothing pre-claimed):** every candidate is **Tier 0**
on the formal frozen protocol — critical artifacts > 0 and temporal/scene axes
below the 3.5 Tier-1 bar for all four, exactly as in wave-1 (cartoon-cel
critical 99 → 111 on the re-run; the frozen 640×360 0.2 s-pair protocol scores
identity/temporal axes harshly by construction — a recorded harness
limitation, not a render regression). The decision-relevant signal is the
same-protocol delta vs the baseline: subject-toon cuts critical artifacts
**7.4×** (111→15), raises identityConsistency **+1.47** (1.73→3.20),
motionFidelity **+0.80** (2.33→3.13), sourceFidelity **+2.26** (2.47→4.73) —
the exact axes the Tier-2 diagnosis flagged — while keeping stylization
presence 4.60. Mini-protocol deltas from W2-C are NOT tier claims; the formal
tiering above supersedes them. TL visual approval remains pending for any
tier assignment.

## 6. noir-vhs G-T3 diagnosis (F4) — record, no patch

Full write-up: `noir-vhs-t3-diagnosis.md`. Headlines: the F4 artifacts were
re-rendered byte-identical to the W2B records (b5 `05e4e277…`, b6 `61cff549…`)
and the misses reproduced exactly (0.7303 / 0.7978). Counterfactual isolation
**refutes the grain/scanline hypothesis**: grain alone r=0.9986, scanlines
±0.002 — the decorrelation is entirely the per-frame horizontal jitter
(jitter-only r=0.7304; no-jitter r=0.9987). The mechanism is flat-input-series
+ i.i.d. jitter noise (corr(CV_input, r_vhs)=0.9715 across the five wave-2
clips; b5/b6 are the flattest). Noise-robust metric test: **0.2 s
moving-average Pearson passes both unchanged renders (0.9661 / 0.9594)** —
the protocol's own temporal-pair granularity; Spearman (0.68/0.64) and
detrending (0.14/0.23) were measured and REJECTED. Verdict: gate-metric design
gap for analog-simulation realities, not a stylizer defect. `qa_check.py`
untouched; recommendation recorded for the lead.

## 7. Files

- `promotion.json` — declaration diff summary, render records (both shas per
  render), gate tables, regression record, scorecard accounting.
- `scorecards/` — `aggregate.json`, `scorecard-{subject-toon,cartoon-cel,
  kuwahara-paint,flow-prop-toon}.json`, `raw/` 60 per-call VLM JSONs.
- `qa/` — gate JSONs (metrics/qa_check + cuts_deep per render), the b12
  raw-substrate crash log, harness-named copies for the scorecard stems.
- `frames/promotion/` — t=2/8/11 s PNGs per promotion render.
- `noir-vhs-t3-diagnosis.md` — measurements, verdict, recommendation.

Not committed (re-derivable, commands recorded): the render mp4s/m4a outputs
(the shas above are the verification anchors, W2-B convention), scratch
diagnosis harnesses (`t3_metrics.py`, `vhs_counterfactual.py`,
`port_equivalence.py`, counterfactual renders), and the derived b12
300-frame gate reference (sha recorded in §3).

## 8. Deviations

1. b12 gate input is a derived 300-frame window reference (W2C precedent) —
   the raw-substrate run crashes on the pre-existing stale-metadata +
   window-length interaction (log kept). All findings pre-documented in the
   W2-C report §1; TL-side fix candidates stand.
2. Trial candidates were re-rendered full-window (driver, no max-frames) for
   the scorecards — the W2C-shipped 300-frame trial renders are 12 s windows
   that cannot carry the frozen t=15/30/45 sample set; same-protocol scoring
   required the full window. Shipped W2C artifacts untouched.
3. The frozen `vlm_scorecard.py` was NOT edited (allowed: a --source flag if
   strictly needed): trial provenance was read out-of-band into the harness's
   `renders.json` input instead — zero harness changes, protocol untouched.
4. `spe/registry.py` remains un-importable dead code exactly as found at the
   base commit (pre-existing `RENDERER_DECLARATIONS` import error, nothing
   imports it; forbidden scope to fix).
5. Task-packet wording "version dc1" interpreted as: rendererId carries the
   `-dc1` deterministic-classical generation suffix; `rendererVersion` is
   `0.1.0` mirroring contract §4's four existing rows (all 0.1.0).
