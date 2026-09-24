# Source-Preserving Reality — Tech Lead Operating Doc

Session: w6-spr-2 (2026-09-24, environment-reset recovery) · Repository state:
sporta main = w6-spr-1 merge 40dcf60 + local w6-spr-2 commits (push BLOCKED —
no PAT in this sandbox; re-inject to sync). Worktree `/home/z/sporta` (the
detached `/home/z/sporta-wc` worktree died with the reset).

## w6-spr-2 state digest (replaces the w6-spr-1 lines below)

- Sandbox was reset; everything machine-local was lost (substrate, renders,
  QA JSONs, surface, replay stack). GitHub main @40dcf60 survived.
- b8 re-acquired via the recorded proxy recipe (substrate b8r3 sha 969af7c6…,
  content-equivalent: same window/cuts/envelope; normalization re-derived —
  audio apad to 47.62s so the frozen -shortest encoder passes 1190 frames).
- All five wave-1 renders re-run; determinism triple byte-identical; hard
  gates re-measured (all PASS except the known cartoon T2-det finding, which
  the durable repo gate cuts_deep.py resolves — deep coverage 1.0, 0 invented).
- Realities Lab surface rebuilt in /home/z/my-project and agent-browser
  verified (playback, position-preserving switching, hold-to-compare, gates
  chips, frame strip, no errors). One real API bug caught+fixed in E2E.
- VLM still 429-exhausted; scorecard harness is now the repo script
  vlm_scorecard.py. Tier 2 blocked on VLM + TL visual approval.
- Acquisition tooling that must survive resets: the gost proxy needs Basic
  auth (session-log), ffmpeg needs the local TLS relay for the HTTPS-only
  proxy (scripts/tls_proxy_relay.py in the evidence root), yt-dlp needs
  `--js-runtimes node` + `bun` as SEPARATE flags and the bgutil provider at
  ~/bgutil-ytdlp-pot-provider + ~/.yt-dlp/plugins/bgutil.
- Next: PAT re-injection (push), VLM quota (scorecards → Tier 2), wave 2
  (corpus b2-b7 + b5 re-pull, SPR103/104/107/109/202/205, A's upgrade trials).

## Mandate digest

Extend Sporta with a Source-Preserving Reality Engine: real broadcast → many
visual realities with the same match/timeline/action/camera/motion. Research +
delegate (3 workers) + integrate + visually inspect + reject weak work + iterate +
record everything in the repo. Provider/model-neutral. First milestone: SPE-v1
engine + two excellent realities (SPR101 Cartoon/Cel, SPR102 Anime/NPR) on the
real in-play R606 substrate.

## Frozen decisions (this session)

1. ADR-012 accepted; engine = SPE-v1; deterministic-classical implementations
   first; neural = adapter candidates gated on benchmark evidence.
2. Contract frozen (`docs/contracts/source-preserving-renderer.md`): registry ids,
   provenance schema, hard output invariants (timeline equality, bit-exact
   reproducibility, cut preservation, fail-closed rights, honest degradation).
3. Benchmark = frozen-source windows (b1-b8) incl. the R606 in-play Original as
   Clip 8; acquisition recipe recorded; corpus manifest schema frozen.
4. Acceptance = hard gates G-T1..T6 + VLM scorecard + tiers; Tier 2 required for
   "product reality" presentation; TL approval is part of Tier 2.
5. Relationship to R606: independent lanes. R606 stays OPEN (calibration stage);
   SPR does not gate on it. The in-play substrate reuse is provenance-chained.
6. Product surface: `/home/z/my-project` (Next.js :3000, route `/` only) —
   TL-owned integration; playback from `/media/spr/**`; data via `/api/spr/*`.
7. Evidence root: `/home/z/spr-evidence/` (render/ B, benchmarks/ + qa/ C,
   manifest.json TL). Repo docs are the durable record; chat is not.

## Worker waves

- WAVE 1 (dispatched, parallel): spr-w1-a research landscape+candidates ·
  spr-w1-b SPE-v1 + SPR101/102/108/201 real renders on b8/b12 ·
  spr-w1-c benchmark corpus + QA harness (+ run if B landed).
- WAVE 2 (post-review): fixes from TL visual review + corpus-wide renders +
  neural-feasible upgrades from A's shortlist + full QA scorecards.
- Product surface integration by TL after wave-1 B lands; agent-browser E2E +
  TL visual gate before any Tier 2 claim.

## TL review protocol

For every artifact: play it (browser), extract frames myself, VLM cross-check
(z-ai vision CLI), read C's scorecards, verify hashes. Reject with diagnosis;
accept only with evidence. Update status + work items + this doc per wave.

## Known environment facts

- :3000 = my-project dev server (user-visible surface, hot reload, do not restart).
- :3101 (sporta prod preview, in-memory state — DO NOT RESTART), :3100 replayd,
  :81 gateway, :9222 Chrome CDP, :4416 bgutil.
- Proxy for acquisition: a996d235.acsnet.co:443 (see benchmark doc).
- ffmpeg 7.1.5, python3 venv (cv2 4.13, numpy 2.1), bun, z-ai-web-dev-sdk
  (backend only), yt-dlp.
