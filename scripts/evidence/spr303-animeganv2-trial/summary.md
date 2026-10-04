# SPR303 — the executed AnimeGANv2 trial (worker 65-i, flight 15)

The SPR lane's first EXECUTED neural run. The SPR302 matrix's wave-2 pick
(AnimeGANv2 primary, Hayao style, the recorded ungated mirror) run per-frame
over the b8 substrate's frozen scorecard sample set, A/B against the committed
deterministic-stylizer baseline scorecards. Fail-closed record:
`trial-record.json` (validated by `validate-trial.ts`, negative-tested by
`negative-tests.sh` — 6 fabricated/laundered variants each refused, the
committed record passes).

## The work item's honest resolution

SPR303 says "Provider/hosted-inference trial (BYOK/free-tier verification)".
The SPR302 matrix recorded that no legitimate v2v hosted provider exists in
the shortlist's classes — so the local ONNX trial IS the legitimately-available
path; the BYOK/free-tier hosted angle is a TYPED GAP (`hosted-provider-absent`),
recorded, never faked. No hosted provider was invoked; no token was used.

## The weights (ONE style, bounded, legitimate)

- `vumichien/AnimeGANv2_Hayao` @ `f84714b47ad2c7e930c5f3d5dff58fe91659be95`,
  file `AnimeGANv2_Hayao.onnx` — 8,649,739 B,
  sha256 `5a84ca468f3c4fd891fe8c883a3a507ed3e463f4f059985735f6449dae7590b5`
  (the exact size the matrix recorded for this mirror; pinned in
  `weights-fetch-meta.json`).
- NC terms verbatim (the committed SPR302 fetch
  `fetches/hf-vumichien-AnimeGANv2_Hayao-README@pinned-rev`): "This repo is
  made freely available to academic and non-academic entities for
  non-commercial purposes such as academic research, teaching, scientific
  publications. … Regarding the request for commercial use, please contact us
  via email to help you obtain the authorization letter." The card-metadata
  `license: apache-2.0` tag CONTRADICTS the body's NC terms — recorded
  contradiction, never adjudicated. Research-class benchmark trial only;
  commercial clearance NOT proven; never a promotion.
- Stored OUTSIDE the repo (`/home/z/hf-bench-13/weights/`) — weights are
  never committed; the sha above is the verification pin.

## The substrate (the SPR lane's standard, sha-pinned)

`scripts/evidence/spr-corpus-bytes/b8p3.mp4` — the b8 clip
(`sprclip-b8-inplay-original`, 1190 frames @ 25 fps, 640×360), sha256
`969af7c6fdb172091ff00705b25fa37b7073f4332d722416b9754a4a7579917a` —
byte-identical with the scorecard-convention pin
(`spr-tier2-scorecards/renders-with-b8-determinism.json` inputSubstrate) and
re-verified before every run phase by `trial_animegan.py check_pins()`.

## The executed run

- **60 stylizations executed** (onnxruntime 1.30.0, CPUExecutionProvider, 2
  vCPU, no GPU): the 30 trial frames (the frozen 15 scorecard samples —
  t = 2/8/15/30/45 s + cut-adjacent pre/post for the frozen b8 cuts
  [189, 475, 550, 862, 979, 982] — each with its within-shot ±0.2 s partner)
  + a 30-frame consecutive mid-shot latency-probe block (300..329; labeled
  latency-probe-only, not VLM evidence).
- **Latency (CPU, executed)**: p50 total **1366.4 ms/frame**, p95
  **1547.6 ms** (inference-only p50 1267.7 ms / p95 1440.9 ms); full-clip
  arithmetic from the executed p50: 1190 frames ≈ **27.1 min/clip** (labeled
  arithmetic, NOT a measured full render). GPU N/A honestly — no GPU provider
  exists on this host.
- **Determinism (executed)**: double-run byte-identity — all 30 stylized
  frames re-stylized in a fresh interpreter (fresh session) and sha256-compared
  with the committed renders: **byte-identical, 30/30**; frame extraction
  re-run twice: byte-identical 15/15.
- **Renders committed**: `renders/animeganv2-hayao-<sample>{,p2}.png` (30
  PNGs) + `frames/original-<sample>.png` (15 PNGs, the VLM Image 1s) — the
  evidence chain; `results/latency.json` carries the 30 per-frame sha pins
  (the validator recomputes them).

## The 7-axis VLM scorecard (the frozen protocol, 15/15 calls)

`scorecard-animeganv2-hayao.json` + per-call evidence `vlm/animeganv2-hayao-*.json`
(z-ai vision CLI, the `vlm_scorecard.py` convention; the ONE deviation
recorded: the prompt's family string names the trial's stylizer honestly —
"anime (AnimeGANv2 Hayao style)" — never the spr-anime-npr renderer).

| axis | AnimeGANv2 trial | anime-npr baseline | cartoon-cel baseline |
|---|---|---|---|
| sourceFidelity | **4.93** | 2.2 | 2.13 |
| temporalConsistency | 2.73 | 2.73 | 3.13 |
| identityConsistency | **2.67** | 1.80 | 1.53 |
| motionFidelity | **3.0** | 1.87 | 1.67 |
| sceneFidelity | **3.33** | 2.0 | 1.93 |
| stylizationStrength | 4.93 | 5.0 | 5.0 |
| **minAxisMean** | **2.67** | **1.80** | **1.53** |
| criticalArtifacts | **38** | 136 | 99 |
| totalArtifacts | **83** | 235 | 190 |

**THE COLLAPSE AXES ARE BEATEN**: trial minAxisMean 2.67 > anime-npr 1.80 and
> cartoon-cel 1.53 (identityConsistency 2.67 — the identity collapse axis —
vs 1.80/1.53). Honest caveats: the trial is sampled-frame, NOT a full render
(the G-T1..G-T5 hard gates are a typed gap — nothing near a tier claim);
identityConsistency 2.67 still sits below the Tier-1 3.5 bar; the baseline
scores are an earlier VLM run (cross-run drift recorded, same protocol/sample
set/prompt criteria).

**Tier claim: 0** (honestly — no tier from a sampled-frame trial without the
full-render hard gates). **TL approval: PENDING** — the TL owns the visual
gate.

## The EbSynth leg

DEFERRED (honest): the AnimeGANv2 leg completed within the flight budget; the
EbSynth leg needs the EbSynth CLI binary (not a hub model) + our deterministic
keyframes as seeds. The recorded design (keyframes from the committed
spr-anime-npr family, propagated across within-shot spans, same frozen
protocol on the same sample set) + the matrix's standing blockers are in
`trial-record.json` `ebsynthLeg`. A wave-2 continuation flight if the TL
admits the second leg.

## The validator (fail-closed, negative-tested)

`bun scripts/evidence/spr303-animeganv2-trial/validate-trial.ts` — exit 0 on
the committed tree; checks structure, the weights pin (+ NC citation verbatim
in the committed SPR302 fetch), the substrate sha (recomputed against the
committed bytes), the latency block vs `results/latency.json` VERBATIM + all
30 render sha pins recomputed, determinism (run1 == committed bytes, run2 ==
run1), the scorecard (15/15, axes 1..5, minAxisMean == min, critical ==
limbs+players, every per-call evidence file re-parsed against its entry), the
A/B baselines vs the committed scorecards VERBATIM, tier 0 + TL PENDING, no
promotion, the honest EbSynth deferral. `bash negative-tests.sh`: 6
fabricated/laundered variants (fabricated GPU latency, laundered TL approval,
tampered weights sha, laundered baseline number, drifted p50, gutted EbSynth
deferral) each refused exit 1; the committed record passes exit 0.

## Re-run (the TL's own gates)

```bash
bun scripts/evidence/spr303-animeganv2-trial/validate-trial.ts   # exit 0
bash scripts/evidence/spr303-animeganv2-trial/negative-tests.sh  # 6 refusals + pass
# full re-execution (needs /home/z/hf-bench-13 + the weights at the pinned sha):
/home/z/hf-bench-13/bin/python scripts/evidence/spr303-animeganv2-trial/trial_animegan.py extract
/home/z/hf-bench-13/bin/python scripts/evidence/spr303-animeganv2-trial/trial_animegan.py stylize
/home/z/hf-bench-13/bin/python scripts/evidence/spr303-animeganv2-trial/trial_animegan.py determinism
/home/z/hf-bench-13/bin/python scripts/evidence/spr303-animeganv2-trial/vlm_scorecard_trial.py
```

No promotion: no rendererId registered, no registry/status change, no tier
claim — the TL owns the visual gate; the HF015-class adjudication owns any
future promotion.
