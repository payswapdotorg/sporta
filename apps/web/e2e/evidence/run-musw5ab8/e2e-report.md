# W909 browser E2E — run musw5ab8

Target: http://127.0.0.1:3909 (production build, port 3909)

**1 passed / 0 failed** — 16 assertions passed, 0 failed.

| Flow | Outcome | Assertions | Evidence |
| --- | --- | --- | --- |
| Live-to-replay recovery (L017) — identity/versions/timebase survive the transition | ✅ passed | 16/16 | live-to-replay-window-end.png, live-to-replay-after-reload.png |

## Live-to-replay recovery (L017) — identity/versions/timebase survive the transition

- ✅ **the finite live-window session is selected through the product's own picker** — picker answer="selected"; label="Synthetic live tracking — finite window + replay"; note="L002 deterministic synthetic tracking source — scenario 'normal', 24 ticks @ 100ms (a finite 24-tick live window that ends honestly, then replays through the same views); finite window — ends after 24 ticks, then replays (L014)"
- ✅ **the finite session streams LIVE before its window ends** — data-live-phase=live; label="Live tactical pitch (connecting)"
- ✅ **the live window ran to its honest end (frames captured, then the window completed)** — captured live frames=24; last live worldVersion=v24 @ eventTime 2300ms; phase at end=replay
- ✅ **the completed window continues into the REPLAY presentation through the SAME surface** — data-live-phase=replay; replay controls present
- ✅ **the replay carries the SAME session identity (the finite-window session stays selected — one session, not a second one)** — selected source label="Synthetic live tracking — finite window + replayfinite live window — it ENDS honestly, then the recorded session replays through the same views (L014)finite window + replay"; session=sess-10
- ✅ **the world version lineage SURVIVES the transition (no reset: the replay's last version is the live window's own last)** — replay world versions 1 → 24; the live window's own first/last = 1/24
- ✅ **the timebase SURVIVES the transition (the replay's event-time span matches the live window's own timecodes)** — replay event-time span 0ms → 2300ms; the live window's own first/last = 0/2300ms
- ✅ **the replayed frame count is the live window's own delivered count (no lost frames, no extra fabricated ones)** — replay frames=24; live frames captured=24
- ✅ **the continuity verdict is the product's own ALIGNED verdict (versions/timecodes advance monotonically)** — verdict chip="aligned — versions/timecodes advance monotonically"
- ✅ **the page reloads and the live surface re-renders** — picker options=8
- ✅ **the same session's replay is re-opened through the product's picker after the reload** — picker answer="selected"; data-live-phase=replay
- ✅ **the reload does NOT create a second canonical state (the SAME single record: identical continuity facts)** — after reload: frames=24, versions 1→24, eventTime 0→2300ms, watermark seq=24 (before reload: frames=24, versions 1→24, eventTime 0→2300ms)
- ✅ **the reload did NOT re-open a second live window (the presentation is the replay of the recorded state, never a re-run)** — data-live-phase=replay (a re-opened live window would show 'live')
- ✅ **no second live stream opened for the completed window (0 new world frames after the reload)** — new world frames for the finite session after reload=0 (the replay mode keeps the stream dormant — the window is over)
- ✅ **the persisted replayable state is intact after the reload (the record still serves its frames through the same views)** — frames=24; verdict="aligned — versions/timecodes advance monotonically"
- ✅ **the re-opened replay is live-drivable (one step advances within the recorded span)** — scrub label "frame 1 / 24 — world v1 @ 0.0s" → "frame 2 / 24 — world v2 @ 0.1s" (recorded frames=24)
- 📝 signed in a fresh viewer account through the real register form (e2e-live-l017-musw5ab8)
- 📝 transition facts: frames=24, versions 1→24, eventTime 0→2300ms, final watermark seq=24; surface watermark fact="0.0s / 0.0s (recorded)"
- 📝 the durable replay store's file exists after the completed window: /home/z/sporta/apps/web/db/live-replay.db (20480 bytes, mtime 2026-10-03T10:16:13.545Z) — the platform-side L014 seam wrote the window

