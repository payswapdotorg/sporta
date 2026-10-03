# W909 browser E2E — run musvy2vq

Target: http://127.0.0.1:3909 (production build, port 3909)

**0 passed / 1 failed** — 5 assertions passed, 1 failed.

| Flow | Outcome | Assertions | Evidence |
| --- | --- | --- | --- |
| Live-to-replay recovery (L017) — identity/versions/timebase survive the transition | ❌ failed | 5/6 | live-to-replay-window-end.png, live-to-replay-failure.png |

## Live-to-replay recovery (L017) — identity/versions/timebase survive the transition

- ✅ **the finite live-window session is selected through the product's own picker** — picker answer="selected"; label="Synthetic live tracking — finite window + replay"; note="L002 deterministic synthetic tracking source — scenario 'normal', 24 ticks @ 100ms (a finite 24-tick live window that ends honestly, then replays through the same views); finite window — ends after 24 ticks, then replays (L014)"
- ✅ **the finite session streams LIVE before its window ends** — data-live-phase=live; label="Live tactical pitch (connecting)"
- ✅ **the live window ran to its honest end (frames captured, then the window completed)** — captured live frames=24; last live worldVersion=v24 @ eventTime 2300ms; phase at end=replay
- ✅ **the completed window continues into the REPLAY presentation through the SAME surface** — data-live-phase=replay; replay controls present
- ✅ **the replay carries the SAME session identity (the finite-window session stays selected — one session, not a second one)** — selected source label="Synthetic live tracking — finite window + replayfinite live window — it ENDS honestly, then the recorded session replays through the same views (L014)finite window + replay"; session=sess-10
- ❌ **the world version lineage SURVIVES the transition (no reset: the replay's last version is the live window's own last)** — replay world versions 0 → 0; the live window's own first/last = 1/24
- 📝 signed in a fresh viewer account through the real register form (e2e-live-l017-musvy2vq)
- 📝 FLOW ABORTED: the world version lineage SURVIVES the transition (no reset: the replay's last version is the live window's own last) — replay world versions 0 → 0; the live window's own first/last = 1/24

