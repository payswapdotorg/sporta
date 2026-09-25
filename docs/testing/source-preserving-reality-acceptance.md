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
