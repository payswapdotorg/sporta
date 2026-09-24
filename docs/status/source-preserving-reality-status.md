# Source-Preserving Reality — Status

Program start: 2026-09-24 (session w6-spr-1). This file is the durable status
record. Evidence pointers are absolute machine paths or repo-relative.

## Current state: WAVE-1 RENDERED — QA + TL GATE IN PROGRESS

| Area | State | Evidence |
|---|---|---|
| SPR001 contract freeze | DONE | ADR-012, architecture, contract, work-items, benchmark, acceptance docs |
| SPR002 research | DONE (worker spr-w1-a) | docs/research/source-preserving-technology-landscape.md (877 lines), docs/technology/source-preserving-candidates.yaml (963 lines, 63 searches) |
| SPR003 corpus | PARTIAL | /home/z/spr-evidence/benchmarks/corpus.json — b1/b5/b8 on disk; b2-b7 PENDING (dispatch OOM) |
| SPR004 engine SPE-v1 | DONE (TL emergency implementation) | scripts/source-preserving/ (render.py + spe/ + wave1_render.py + rebuild_renders.py) |
| SPR101/102/108/201 renders | DONE — real artifacts | /home/z/spr-evidence/render/renders.json (5 realities, b8 full + b12 + triple-render determinism proofs) |
| SPR005 QA harness | DONE + RUN | scripts/spr-qa-metrics.py (adopted worker-B qa_check), spr-qa-cuts-deep.py, spr-qa-vlm.mjs, spr-qa-scorecard.mjs; metrics JSONs in qa/ |
| Product surface | DONE + browser-verified | /home/z/my-project (page.tsx Realities Lab, /api/spr/manifest, /media/spr/**) |
| VLM scorecards | PARTIAL — quota exhausted | 1/15+ calls landed (cartoon t2); harness has retry/backoff; re-run pending quota reset |
| Tier gates | Tier 1 badges shown; Tier 2 PENDING VLM scorecards + TL approval | manifest tierLabel "Usable (QA pending)" |

## Hard-gate results (b8, real measurements)

| Reality | G-T1 timeline | G-T2 cuts | G-T3 motion r | G-T4 flicker | G-T2b deep cuts | Determinism |
|---|---|---|---|---|---|---|
| cartoon-cel | PASS (1190=1190, Δ3ms) | FAIL-det (0.833 coverage — boundary artifact) | 0.9832 | 0.40% (baseline 0.46%) | **PASS 1.0 coverage, 0 invented** | b12 triple-render byte-identical |
| anime-npr | PASS | PASS | 0.9869 | 0.41% | PASS | byte-identical |
| noir-retro (noir) | PASS | PASS | — | — | pending | byte-identical |
| motion-trails | PASS | PASS | — | — | pending | byte-identical |

G-T2 cartoon finding (recorded, not hidden): the detector's flat threshold (16.0)
missed the stylized cut spike at frame 550 (15.9 vs original 20.1 — the cut IS
preserved at 79% amplitude) and flagged frame 934 whose identical spike exists in
the input (51.4). The deep correspondence gate (scripts/spr-qa-cuts-deep.py)
proves all 6 input cuts preserved, 0 invented — with per-cut numbers in
qa/cuts-deep-cartoon-cel.json. The raw G-T2 JSON is preserved untouched.

## Substrate (real, provenance-chained)

- b8 in-play Original: `/home/z/w6-real-r606-inplay-evidence/bytes/original-artifact-a13396ec.mp4`
  (47.6 s, 640×360, 25 fps, sha256 a13396ec…, window 1803.84–1851.44 s, VLM-verified
  in-play; source pack `w6-real-r606-inplay-evidence/pack.json`).
- 86 s window pull (1979–2213 s) — b5 source.

## Wave-1 incidents (recorded honestly)

1. **Agent dispatch OOM**: subagent runtimes (bun, ~2 GB RSS) are OOM-killed by
   the 4 GB sandbox while Chrome + dev servers + replay stack run — all Worker
   B/C dispatches failed with "context deadline exceeded". Worker A completed
   BEFORE the ceiling bit; one Worker B retry ran partially (06:40–08:15, its
   artifacts quarantined at render/_worker-b-quarantine/, its gates-checker
   qa_check.py ADOPTED as spr-qa-metrics.py, its render_all.sh determinism
   design acknowledged). TL emergency-implemented Worker B's packet and the
   harness portions of Worker C's.
2. **Background-process reaper**: this sandbox kills processes spawned by the
   tool shell at command boundaries (even setsid+nohup) — all renders were run
   foreground in staged jobs (wave1_render.py cartoon|anime|noir|trails).
3. **:3000 swap**: the R606 replay console held :3000 (with a watchdog ring
   guarding it). The SPR mandate + this session's surface rules required
   my-project on :3000; the watchdog ring was repointed (launch_dev.py →
   my-project; supervisor identity marker → "Source-Preserving Realities Lab";
   squatter-keep condition → my-project). The replay infrastructure
   (replayd :3100, Chrome CDP :9222, supervisor/watcher) remains intact.
4. **VLM quota exhaustion** (TL debugging + runaway worker's calls): scorecard
   VLM calls 429-rate-limited at wave end; re-run pending.

## Relationship to other lanes

- R606 (reconstruction): OPEN, unchanged — calibration stage (W303 lane).
- R607: not advanced (unchanged rule).

## Next executable work

1. VLM quota reset → run spr-qa-vlm.mjs per reality → scorecards → manifest
   rebuild → tier assignments.
2. TL final visual gate (browser playback verified; frame VLM verdicts largely
   recorded during tuning; formalize on quota reset).
3. Wave 2: benchmark corpus completion (b2-b7), corpus-wide renders, A's
   upgrade trials (EbSynth keyframe propagation, Kuwahara, AnimeGANv2 A/B),
   SPR103/104/107/109/202/205.
