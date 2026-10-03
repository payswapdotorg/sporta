# W909 browser E2E — run musu4p92

Target: http://127.0.0.1:3909 (production build, port 3909)

**0 passed / 1 failed** — 7 assertions passed, 1 failed.

| Flow | Outcome | Assertions | Evidence |
| --- | --- | --- | --- |
| Live tactical gate (L015) — continuous updates, latency, identity, dropout | ❌ failed | 7/8 | live-tactical-gate-failure.png |

## Live tactical gate (L015) — continuous updates, latency, identity, dropout

- ✅ **the live transport really serves the L002 scenario sessions (no fixture: the transport's own listing)** — listing: 8 sources (kind=story/tactical/tactical/tactical/tactical/tactical/tactical/tactical); normal="Synthetic live tracking — normal delivery"; reconnect="Synthetic live tracking — reconnect"; drop="Synthetic live tracking — scattered drops"
- ✅ **the source is honestly labeled the L002 deterministic synthetic tracking source** — sourceNote="L002 deterministic synthetic tracking source — scenario 'normal', 600 ticks @ 100ms (every tick delivered in order at the base latency)"
- ✅ **the live tactical surface is LIVE in the real browser with a rendered canvas** — data-live-phase=live; canvas count=1; label="Live tactical pitch: world version 16, 24 entities at event time 2s"
- ✅ **the probe observed the real stream (the page's own EventSource traffic, no dev API)** — probe opens=1; captured world frames=16 (16 on the normal session)
- ✅ **the session under test IS the transport's listed normal session (no hidden session)** — captured sessionIds={sess-4}; under test=sess-4
- ✅ **state updates arrive continuously (measured receipt cadence matches the declared cadence)** — n=15 intervals; median=500ms (min 482, max 503) vs declared 500ms; tolerance ±45%; frames=16
- ✅ **the rendered tactical state visibly follows state changes (DOM world versions advance with the frames)** — polled DOM world versions=[16, 18, 19, 21, 22, 24]; captured at window start=v16, at polls=v24; distinct=6
- ❌ **meaningful state changes arrive (ball and player move beyond the threshold between frames)** — ball: max=3.79m mean=3.012m (n=15); player p-home-1: max=undefinedm mean=undefinedm
- 📝 signed in a fresh viewer account through the real register form (e2e-live-l015-musu4p92)
- 📝 hello: sessionId=sess-4 sourceKind=tactical cadenceMs=500 (the transport's own declaration)
- 📝 the surface's own update-rate fact: "2.1 Hz"; frames fact: "16"
- 📝 FLOW ABORTED: meaningful state changes arrive (ball and player move beyond the threshold between frames) — ball: max=3.79m mean=3.012m (n=15); player p-home-1: max=undefinedm mean=undefinedm

