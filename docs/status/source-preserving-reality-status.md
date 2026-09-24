# Source-Preserving Reality — Status

Program start: 2026-09-24 (session w6-spr-1). This file is the durable status
record. Evidence pointers are absolute machine paths or repo-relative.

## Current state: WAVE-1 RECOVERED + RE-VERIFIED (session w6-spr-2) — VLM scorecards still pending quota

### Session w6-spr-2 (2026-09-24, environment-reset recovery)

The sandbox was reset between sessions: the sporta repo (GitHub main @40dcf60)
survived intact — all SPR docs, the SPE-v1 engine, the QA scripts — but every
machine-local artifact was lost (b8 substrate bytes, renders, QA JSONs, the
Realities Lab surface, the whole replay stack, the 86s pull). Recovery executed
end-to-end:

1. **Substrate re-acquired** through the recorded recipe (gost proxy
   credentials from session-log; proxy alive, 407 without auth). The HLS
   acquisition path needed rebuilding: bgutil PO-token provider reinstalled
   (server :4416 + yt-dlp plugin), `--js-runtimes node bun` (the comma form is
   silently wrong — each runtime is a separate flag), and a **local
   TLS-terminating relay** (`/home/z/spr-evidence/scripts/tls_proxy_relay.py`)
   because ffmpeg cannot speak to an HTTPS-only proxy but honors plain
   `http_proxy` for HLS inputs. New substrate b8r3 sha-256
   `969af7c6…` (HLS pulls are not byte-reproducible — content equivalence
   verified instead: same window, same 6 broadcast cuts [189, 475, 550, 862,
   979, 982], same envelope; the recorded a13396ec was itself the
   media-platform-normalized artifact).
2. **Substrate normalization re-derived** (three honest render cycles,
   quarantined under render/_recovery-*): raw HLS merge = 1191 frames > audio
   → renderer `-shortest` trimmed (G-T1 fail); the fix mirrors the original
   normalize: video copy `-frames:v 1190` + audio `apad` to 47.62s so the
   frozen bit-exact encoder passes all 1190 frames with Δdur 20ms. The engine
   was NOT modified (contract frozen) — the substrate adapts to the engine.
3. **All five wave-1 renders re-run** on the recovery substrate (staged
   foreground jobs; background processes DO survive in this sandbox — the
   wave-1 reaper lesson no longer applies): b8 triple-render determinism
   byte-identical for all four full realities.
4. **Hard gates re-measured** (real numbers, recovery substrate):

   | Reality | G-T1 | G-T2-det | G-T2b deep | G-T3 | G-T4 | Determinism |
   |---|---|---|---|---|---|---|
   | cartoon-cel | PASS 1190=1190 Δ20ms | FAIL-det 0.833 (known) | **PASS 1.0, 0 invented** | 0.9767 | 0.40% (base 0.46%) | byte-identical ×3 |
   | anime-npr | PASS | PASS | PASS | 0.9815 | 0.39% | byte-identical ×3 |
   | noir-retro (noir) | PASS | PASS | PASS | 0.9934 | 0.48% | byte-identical ×3 |
   | motion-trails | PASS | PASS | PASS | 0.8969 | 0.53% | byte-identical ×3 |

   The cartoon T2-det finding reproduces EXACTLY (cut at frame 550: input
   20.09 → output 15.85 = 79% amplitude; frame 934's "invented" flag resolved
   by input-amplitude correspondence — input spikes 51.5 there, cartoon
   carries 49.2). The prior session's diagnosis is now codified as the durable
   repo gate `scripts/source-preserving/cuts_deep.py` (the old one lived only
   in my-project/scripts and died with the sandbox).
5. **Product surface rebuilt and browser-verified** (`/home/z/my-project`,
   route `/`): Realities Lab — player with position-preserving reality
   switching (t carried exactly across switches; play state preserved under
   real gestures), hold-to-compare (mousedown=original / mouseup=back),
   per-reality gate chips, frame-comparison strip, provenance panel; manifest
   via `/api/spr/manifest` (enriches renders.json + QA gates); media from
   `/media/spr/**`. Agent-browser E2E green: manifest 200, all 6 cards, all
   artifacts 200/206, zero console errors, zero failed resources, no mobile
   overflow, footer sticky/push correct. One real bug found and fixed in
   verification (the API route never mapped `playbackUrl` — the page silently
   fell back to the original for every reality; exactly the class of defect
   browser verification exists to catch).
6. **VLM still 429-quota-exhausted** (persistent across the session). The
   scorecard harness is now a durable repo script
   (`scripts/source-preserving/vlm_scorecard.py`, retry/backoff, honest
   quota-exhausted verdicts) — run it when quota returns; Tier-2 assignment
   remains blocked on it + TL visual approval.
7. **Corpus rebuilt** (`/home/z/spr-evidence/benchmarks/corpus.json`): b8
   (recovery), b1 (re-cut prefix), b12 determinism cut (cut-rich window
   1838.32–1850.32s containing source cuts 862/979/982). b5 + b2-b7 remain
   wave-2 acquisitions.
8. **Push NOT possible from this sandbox** (no PAT in env; `git push` →
   could-not-read-username). Commits are local; the operator must re-inject
   the PAT (or push manually) for the next GitHub sync. Recorded honestly.

### Wave-1 ledger (session w6-spr-1, superseded machine paths)

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

- b8 in-play Original (w6-spr-1, LOST to the reset): a13396ec… — superseded
  by the recovery substrate below; the wave-1 render artifacts of that
  substrate are likewise superseded (their shas in the wave-1 ledger no
  longer resolve on disk).
- b8r3 in-play Original (w6-spr-2, CURRENT):
  `/home/z/spr-evidence/bytes/b8p3.mp4` (47.62 s, 640×360, 25 fps, 1190
  frames, sha256 969af7c6…, window 1803.84–1851.44 s, same 6 cuts — corpus
  entry `sprclip-b8-inplay-original`).
- b5's 86 s window pull (1979–2213 s): LOST — re-acquire in wave 2.

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

0. **PAT re-injection** (operator): the w6-spr-2 commits sit local — push
   `main` to GitHub when credentials return.
1. VLM quota reset → run `scripts/source-preserving/vlm_scorecard.py` →
   scorecards → Tier-2 assignment (needs ≥4.0 mean + TL visual approval).
2. Wave 2: benchmark corpus completion (b5 86s pull re-acquisition + b2-b7
   discovery/VLM), corpus-wide renders, A's upgrade trials (EbSynth keyframe
   propagation, Kuwahara, AnimeGANv2 A/B), SPR103/104/107/109/202/205.
