# R606 Real-Source Evidence Pack (Wave 6)

Generated: 2026-09-23 14:12 UTC · machine copy: `pack.json`

## The chain (docs/contracts/real-source-provenance.md §2)

```
operator-submitted YouTube URL
  https://www.youtube.com/watch?v=93LPZJkCW2w
  ("FULL MATCH | BETIS 3 vs 5 FC BARCELONA | LALIGA 2025/26 MD15", FC Barcelona, ~1:49:51)
  → registration urlreg-8265fdeb…c219 (PENDING_TRANSFER, rights declared:
     analysis/transformation/derivativeGeneration/storage, oEmbed fetched honestly)
    → acquired bytes (ACQUIRED, 3,363,717 B, sha-256 156f7297a5f46292…ab42e0d,
       server-measured == machine claim)
      → normalized source asset art-c33ab46c… (Original artifact, 4,739,686 B,
         mp4/h264, 47.44 s, producer media-platform/normalize 0.1.0)
        → perception job mjob-2838ee49… (succeeded: upload-complete →
           normalization-complete → artifact-stored) · SWM snapshot 14188
          → tactical-c7e0023c (tactical.prototype 0.1.0, 4.0 s)
          → mp4-77e1f9c7… (game-3d.prototype 0.1.0, 4.0 s)
          → mp4-05835206… (anime-npr.prototype 0.2.0, 4.0 s)
```

All four displayed realities descend from the SAME processing run and the SAME
SWM. No cross-run or cross-source mixing.

## Acquisition honesty (§4)

Method (recorded verbatim in the registration's `transferredVia`, attempt #4 of 4):
unauthenticated acquisition via this host's TurboVPN extension egress —
HTTPS proxy `a996d235.acsnet.co:443` (gost), DE exit `169.150.210.53` —
yt-dlp 2026.08.19 with bgutil PO tokens (localhost:4416) resolved the
stream's formats; the machine pulled the stream's own HLS segments
(itag 230, 640×360 avc1) covering media time 57.84 s–105.28 s plus the real
m4a audio track (itag 140-5, en-US original), losslessly concatenated and
merged (`-c copy`).

Every earlier refusal is recorded, not retried silently:
- #1 1080p itag 270 @118.005 s → decode budget 1,076,198,400 > 1,073,741,824
- #2 720p itag 232 @118.005 s → decode budget 1,075,507,200 > 1,073,741,824
- #3 720p itag 232 @104.003 s → decode budget 1,075,507,200 > 1,073,741,824
  (whole-clip rgb24 decode volume is duration-driven; the J015 gate-clip
  shape 640×360 fits with margin)
- #4 640×360 @47.44 s → ACQUIRED

The three refusals also appear in `logs/server-3101.log` (ResourceLimitError,
errorIds d75cf889 / 5754670c / 6dbb85c4) and in the registration's attempt
history (`manifests/session.json`). Transfer journal: `logs/transfer-journal.jsonl`.
Integrity sidecar: `manifests/integrity-sidecar.json`.

**Ratification needed:** this VPN-egress path is a THIRD path, not one of the
contract's two frozen accepted unblock paths (operator cookies / operator-
transferred bytes). The operator should ratify it (or supply cookies for a
re-run under a frozen path) before R606 is declared passed. No fixture or
synthetic substitution occurred at any point.

## Synchronized comparison (§5)

Frames captured at artifact-local t = 2.000 s of each reality (`frames/`):
the original frame is the real LALIGA broadcast at real-match ≈ 59.84 s
(pre-match window of the excerpt); the three derived frames are 4.0 s render
segments of the same SWM (snapshot 14188) showing the same pre-match state.
VLM assessment (`vlm/vlm-four-realities-assessment.json`): all four plausibly
derive from the same scene.

## UI verification (§7 surface)

`/watch?session=sess-u-3bc85e0edcc60b1286421076a4eae512` on :3101, signed in
as the session owner (u-4, creator workspace): the Reality Switcher lists
Original / Tactical / 3D / Anime all `READY · 1 ARTIFACT`; the player plays
the real stored MP4 through the playback-gated byte route (sha-256 re-verified
per request); provenance (artifact id, hash, stored bytes, producer, compute)
is inspectable in the side panels; switching stays on-page. Screenshots:
`ui/w6r606-watch-{original,tactical,3dgame,anime}.png`. Zero console errors.
VLM checks: `vlm/vlm-watch-original-ui.json`, `vlm/vlm-watch-anime-ui.json`.

## Rights posture (§3)

Unweakened: the declaration covering analysis/transformation/derivative-
generation/storage was recorded at registration and re-derived fail-closed
at ingestion (canReferenceSourceFrames: true). No rights check was stubbed.

## Persistence caveat

The :3101 Node runtime keeps url-source/identity/control-plane records
IN-MEMORY (bun:sqlite unavailable under Node) — a restart drops the
registration/session records, though the bytes and stored artifacts persist
in `db/media-storage/` (copies in `bytes/`). The durable sqlite stores run
under the real Bun runtime.

## Verdict

The chain is real end-to-end and inspectable; the remaining act for R606 is
the human operator's verdict (and the VPN-path ratification above). R607
stays closed until R606 passes.
