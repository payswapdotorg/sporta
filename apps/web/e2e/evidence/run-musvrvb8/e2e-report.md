# W909 browser E2E — run musvrvb8

Target: http://127.0.0.1:3909 (production build, port 3909)

**1 passed / 0 failed** — 17 assertions passed, 0 failed.

| Flow | Outcome | Assertions | Evidence |
| --- | --- | --- | --- |
| Live journey (L016) — enter live → inspect → interruption → replay | ✅ passed | 17/17 | live-journey-live-state.png, live-journey-inspect-ball.png, live-journey-interruption.png, live-journey-replay.png |

## Live journey (L016) — enter live → inspect → interruption → replay

- ✅ **the journey starts from a fresh (anonymous) browser on the home page** — title="Home"; account chip absent (anonymous)
- ✅ **the Live entry is reachable through the product's own primary navigation** — nav click="clicked"; url=http://127.0.0.1:3909/live
- ✅ **the live page lists the real sources (the transport's own listing)** — picker options=8
- ✅ **an anonymous browser is honestly REFUSED the live stream (fail-closed, never a silent anonymous live picture)** — data-live-phase=failed; the real 401 path (auth-required) surfaced as the view's own failure state
- ✅ **entering the live match shows LIVE tactical state (frames really arriving)** — data-live-phase=live; captured frames=8; canvas label="Live tactical pitch: world version 9, 24 entities at event time 1s"
- ✅ **the entity inspector offers the live entities (players and the ball)** — picker options=25 (player example=p-home-01, ball=ball-1)
- ✅ **inspecting a PLAYER shows its identity + live state, updating while pinned** — pinned="p-home-01 · PLAYER · team-home"; position x 2.70 · y 24.56 → x 2.55 · y 24.16; confidence=0.94
- ✅ **inspecting the BALL shows its identity + live state, updating while pinned** — pinned="ball-1 · BALL"; position x 91.76 · y 9.25 → x 84.12 · y 8.89; detection=detected
- ✅ **the interruption source (the L002 reconnect scenario) is selected through the product's picker** — picker answer="selected"
- ✅ **the interruption is EXPLICIT (the stream's own gap accounting, counted — never silent)** — recovery event: missedUpdates=8, gapDurationMs=800; captured frames=41
- ✅ **the interrupted state is VISIBLE to the user (the honest event ticker carries the accounted gap)** — ticker row="source reconnect — 8 updates missed (0.8s gap, accounted)"
- ✅ **the journey CONTINUES after the recovery (updates keep arriving past the interruption)** — world version at recovery=v41; latest=v45 (45 frames captured)
- ✅ **the finite live-window session is selected through the product's picker** — picker answer="selected"; label="Synthetic live tracking — finite window + replay"
- ✅ **the finite live window streams live state first (the window is live before it ends)** — data-live-phase=live
- ✅ **the live window ENDS honestly and the SAME surface opens the replay of the recorded session** — data-live-phase=replay; replay controls present; legend="Replay the recorded live window — 24 world frames (world v1 → v24)"
- ✅ **the replay carries the recorded session state through the SAME views (world versions + frame accounting visible)** — world version fact="1 (recorded — of 24)"; frames fact="24 recorded"
- ✅ **the opened replay is user-drivable (a step advances the recorded frame)** — scrub label="frame 2 / 24 — world v2 @ 0.1s"
- 📝 signed in a fresh viewer account through the real register form (e2e-live-l016-musvrvb8)
- 📝 determinism fingerprint (the journey's normal-session window, first 8 captured frames): v1@0#seq1 v2@100#seq2 v3@200#seq3 v4@300#seq4 v5@400#seq5 v6@500#seq6 v7@600#seq7 v8@700#seq8

