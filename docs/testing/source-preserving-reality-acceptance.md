# Source-Preserving Reality — Acceptance Protocol & Tiers

Status: SPEC FROZEN v1 (2026-09-24) · Owner: Worker C (harness), TL (gate)
Every reality gets a scorecard. "Pipeline works" ≠ pass. Visual evidence is mandatory.

## 1. Hard gates (machine-measured, pass/fail — any failure blocks tiering)

| Gate | Metric | Threshold |
|---|---|---|
| G-T1 timeline | output vs input frameCount, fps, duration | equal frames; Δduration ≤ 40 ms |
| G-T2 cuts | shot-cut indices (frame-diff detection) on input vs output | ≥ 95% of input cuts preserved; ≤ 1 extra cut per 30 s |
| G-T3 motion | Pearson r of per-frame motion-energy (64×36 Farneback magnitude means) input vs output | r ≥ 0.80 |
| G-T4 flicker | mean |ΔL| in static regions (input flow < 0.15 px/frame), sampled grid | ≤ 1.5% of range |
| G-T5 repro | double render byte equality (deterministic impls) | sha256 identical |
| G-T6 provenance | provenance JSON complete + hashes re-verify | all fields, hash match |

## 2. VLM scorecard (z-ai vision on extracted frames: t=2/8/15/30/45 s + cut-adjacent)

Each item scored 1-5 with one-line justification:
1. sourceFidelity — "same match, same moment, same camera context?"
2. temporalConsistency — "objects flicker/morph/disappear?"
3. identityConsistency — "same players visually stable?"
4. motionFidelity — "player/ball motion matches the original?"
5. sceneFidelity — "stadium/background spatially consistent?"
6. stylizationStrength — "is the intended transformation obvious?"
7. artifactChecklist — malformed limbs / disappearing players / warped lines /
   duplicated players / ball hallucination / background drift / temporal jumps —
   each counted (critical = any limb malformation or player disappearance > momentary).

## 3. Tiers

- **Tier 0 — Prototype**: recognizably transformed; gates T2-T4 may fail. Not product.
- **Tier 1 — Usable**: all hard gates green; VLM means ≥ 3.5; no critical artifacts;
  demo-grade.
- **Tier 2 — Product**: all hard gates green; VLM means ≥ 4.0; artifact checklist
  critical = 0; TL visual approval on real playback; reproducibility proven.
- **Tier 3 — Premium**: Tier 2 + strong identity stability + artifact rate ~0 +
  independent review. Reserved for later waves.

Only Tier 2+ is presented as a completed product reality. Lower tiers display as
experimental with their honest tier badge.

## 4. Scorecard artifact (`/home/z/spr-evidence/qa/scorecard-<family>.json`)

```json
{
  "family": "cartoon-cel", "rendererId": "spr-cartoon-cel-dc1", "rendererVersion": "0.1.0",
  "clipIds": ["sprclip-b8-inplay-original"],
  "gates": { "G-T1": { "value": "1190==1190", "pass": true }, "…": {} },
  "metrics": { "motionCorrelation": 0.91, "staticRegionInstability": 0.007, "renderFps": 14.2, "cutCoverage": 1.0 },
  "vlm": { "meanScores": { "sourceFidelity": 4.3 }, "criticalArtifacts": 0, "evidence": ["vlm/cartoon-cel-t2s.json"] },
  "tierClaim": 2, "tlApproval": { "status": "PENDING", "reviewer": "tech-lead" }
}
```

## 5. Runtime / operational recording

render FPS, wall time, GPU-seconds (0 for CPU-classical), cost/min (0 for local
deterministic), retry count, tool versions. Reproducibility re-run at least once per
accepted artifact.

## 6. Review loop (mandate §22)

```
worker implements → TL integrates → C renders real clip → visual review (VLM + TL)
  → pass? → tier assignment … else: diagnose → fix → re-render → re-review
```
A rejected candidate gets a diagnosis in the scorecard + a research follow-up (A)
while B keeps the stable interface. Never lower the bar to close the item.

## Amendment A1 (2026-09-25, TL-approved): analog G-T3

Analog-simulation profiles (noir-retro profile vhs) gate G-T3 on the 0.2 s
moving-average-smoothed motion-energy series (5 frames at 25 fps, centered
window — the protocol's own temporal-pair granularity); digital realities
keep the frozen per-frame G-T3 of `qa_check.py`. The 0.80 threshold is
UNCHANGED for both; both values are reported side-by-side in every
scorecard. Additive tool: `scripts/source-preserving/qa_analog_t3.py`
(extraction math reimplemented 1:1 from the frozen harness; per-frame r
reported alongside the smoothed r). Basis: the noir-vhs T3 diagnosis
(`scripts/evidence/spr-wave3-toon-promotion/noir-vhs-t3-diagnosis.md`, TL
decision ACCEPTED — jitter is intended analog character, not corrupted
motion; b5/b6 pass the smoothed metric at 0.9661/0.9594 with renders
unchanged). Adjudicated with this amendment (TL: accept + document): the
b12 container metadata honest-negative — decode-true frame counts stand
(the 338 stsz sample count is structural: pre-roll GOP packets cannot be
dropped or re-encoded without corrupting/altering frozen content);
effective from wave-4.

## Amendment A2 (2026-09-29, w5h4): cut-adjacent boundary-class adjudication (VLM scorecard §2)

A scorecard sample is classified `cut-boundary-class` BEFORE scorecard
assignment iff the temporal-pair window it evaluates (primary frame + its
frozen 0.2 s partner, per the §2 sample design) intersects the pre-cut
window of a SOURCE-side cut event. Cut events = the frozen per-clip cut
records (the corpus/cuts_deep `inputCuts`), clustered with the scorecard's
frozen CLUSTER_GAP (5). The pre-cut window of event [start, end] is
`[start − (CUT_OFFSET 3 + TEMPORAL_DELTA 5), start − 1]` = [start−8,
start−1] — exactly the backward reach of the frozen pre-sample design (a
pre sample at start−3 pairs backward to start−8); the source's transition
completes AT the cut, so the frames strictly before it are the
transition-in-progress region. No post-cut window: a post sample at end+3
pairs forward into the new shot (new-shot content, not transition content).
The rule introduces NO new constants (both numbers are the frozen sample
design's own) and is a pure function of the cut records + sample set
(`scripts/source-preserving/cut_boundary.py`, tested in
`test_cut_boundary.py` — deterministic, re-runnable, computed before any
VLM call).

EFFECT (scoped to §2's critical-artifact attribution): boundary samples
are still VLM-scored — their axis scores still count in the means (no
score laundering; the ≥3.5/≥4.0 axis bars keep pricing boundary-sample
instability) — but their CRITICAL-artifact counts (limbs+players) are
re-attributed to the named `source-pre-cut-transition` boundary class in
the AMENDED aggregate. Basis: the w5h2 979-pre root cause (the source
pair's own frames differ by 60.07 mean absdiff — larger than the 979 cut
itself; the source content transitions across the pair, so the VLM's
"disappearing player"/instability judgment there measures the SOURCE's
transition, which the renderer must preserve — G-T2, sourceFidelity) and
the w5h3 189-pre diagnosis (the recorded 2 criticals at c189pre, pair
frames 181–186 in the source's pre-cut high-chaos region; every critical
ever observed in this family across runs sits in this class). Precedent:
the w4b named, scoped, pre-adjudicated boundary classes; amendment A1
(w4a) for the additive-tool + both-numbers-recorded shape.

NO-LAUNDERING CONDITIONS (all binding): (i) the raw VLM verdicts stay
recorded verbatim and the raw aggregate/tierClaim stay in the record; (ii)
axis means are never re-attributed; (iii) an amended tierClaim must cite
this amendment and carry the raw numbers side by side; (iv) the hard
gates (§1) are unchanged; (v) the TL visual gate stays binding for
Tier 2+ and untouched; (vi) the classification derives ONLY from the
frozen cut records + the frozen sample design — never from the renderer
output or any VLM verdict (a sample is boundary because the SOURCE cut
there, not because the score was bad); (vii) one run stands as measured —
no re-roll laundering. Additive layer: `vlm_scorecard.py --amendment-a2`
(default surface behavior-identical without the flag); effective from
wave-5h4. First amended measurement: the w5h4 player-focus re-run
(`scripts/evidence/spr-w5h4-tier1-protocol/` — the honest near-miss
recorded there: the claim was WITHHELD on the re-run's own numbers).
