# W909 browser E2E — run musv4nrb

Target: http://127.0.0.1:3909 (production build, port 3909)

**0 passed / 1 failed** — 17 assertions passed, 2 failed.

| Flow | Outcome | Assertions | Evidence |
| --- | --- | --- | --- |
| Live tactical gate (L015) — continuous updates, latency, identity, dropout | ❌ failed | 17/19 | live-tactical-gate-failure.png |

## Live tactical gate (L015) — continuous updates, latency, identity, dropout

- ✅ **the live transport really serves the L002 scenario sessions (no fixture: the transport's own listing)** — listing: 8 sources (kind=story/tactical/tactical/tactical/tactical/tactical/tactical/tactical); normal="Synthetic live tracking — normal delivery"; reconnect="Synthetic live tracking — reconnect"; drop="Synthetic live tracking — scattered drops"
- ✅ **the source is honestly labeled the L002 deterministic synthetic tracking source** — sourceNote="L002 deterministic synthetic tracking source — scenario 'normal', 600 ticks @ 100ms (every tick delivered in order at the base latency)"
- ✅ **the live tactical surface is LIVE in the real browser with a rendered canvas** — data-live-phase=live; canvas count=1; label="Live tactical pitch: world version 16, 24 entities at event time 2s"
- ✅ **the probe observed the real stream (the page's own EventSource traffic, no dev API)** — probe opens=1; captured world frames=16 (16 on the normal session)
- ✅ **the session under test IS the transport's listed normal session (no hidden session)** — captured sessionIds={sess-4}; under test=sess-4
- ✅ **state updates arrive continuously (measured receipt cadence matches the declared cadence)** — n=15 intervals; median=500ms (min 490, max 501) vs declared 500ms; tolerance ±45%; frames=16
- ✅ **the rendered tactical state visibly follows state changes (DOM world versions advance with the frames)** — polled DOM world versions=[16, 18, 19, 21, 22, 24]; captured at window start=v16, at polls=v24; distinct=6
- ✅ **meaningful state changes arrive (ball and player move beyond the threshold between frames)** — ball: max=3.79m mean=3.012m (n=15); player p-home-01: max=0.40m mean=0.219m
- ✅ **the latency measurement produced a real percentile window (never an absent metric claimed as met)** — nearest-rank p50=1ms, p95=6ms over 16 measured samples
- ❌ **the measured percentiles are asserted against the declared budget** — declared budget: ABSENT — the repo declares no numeric live-path latency percentile budget (packages/slo SLOs.md scope = the W306 batch/frame pipeline; docs/deployment/DEPLOYMENT.md records measured live evidence "never a promise"). Measured: p50=1ms p95=6ms (n=16). Budget numbers are proposed to the TL as a docs amendment (see the gate REPORT); this line FAILS honestly until one is declared.
- ✅ **identity continuity is bounded (no unexplained re-identification across the window)** — 24 entities over 16 frames; 0 identity switches; late appearances=0 (all with explicit entity-appeared events)
- ✅ **the reconnect-scenario session is selectable through the product's own live picker** — picker answer="selected"
- ✅ **the dropout/reconnect scenario ran its gap (the stream's own recovery accounting arrived)** — reconnect frames captured=41; recovery event: missedUpdates=8, gapDurationMs=800 (frame #40 of the captured window)
- ✅ **the interruption is EXPLICIT in the stream's own data (degraded quality carried, then recovered to nominal)** — captured quality states={nominal,degraded}; quality-degraded/quality-nominal transition events=3 frames; nominal resumption after the recovery=observed
- ✅ **the dropout is VISIBLE in the product surface (the honest event ticker shows the accounted gap)** — ticker row="source reconnect — 8 updates missed (0.8s gap, accounted)"
- ✅ **the degraded quality state was visible in the surface's own quality fact during the recovery window** — quality-fact trajectory during the recovery window=[degraded → degraded → nominal] (the degraded window is 3 frames; the authoritative captured-state assert above carries this line if the poll cadence missed the transient chip)
- ✅ **the stream RECovers and continues (world versions advance past the recovery frame)** — world version at recovery=v41; latest captured=v44; frames after recovery=3
- ✅ **the delay-scenario session is selectable through the product's own live picker** — picker answer="selected"
- ❌ **the view does NOT change during a no-update window (the visible STALLED state, the version frozen, never a fabricated one)** — stall trajectory: 26 samples over the delay window; stalled samples=0; frozen world versions during the stall=[]; stalled note observed=false; STALLED canvas marker=false; recovery version observed=none
- 📝 signed in a fresh viewer account through the real register form (e2e-live-l015-musv4nrb)
- 📝 hello: sessionId=sess-4 sourceKind=tactical cadenceMs=500 (the transport's own declaration)
- 📝 the surface's own update-rate fact: "2.1 Hz"; frames fact: "16"
- 📝 measured e2e latency (generation→receipt): n=16 p50=1ms p95=6ms max=6ms min=0ms; the surface's own displayed window: "1 / 6 / 6 ms"
- 📝 FLOW ABORTED: the view does NOT change during a no-update window (the visible STALLED state, the version frozen, never a fabricated one) — stall trajectory: 26 samples over the delay window; stalled samples=0; frozen world versions during the stall=[]; stalled note observed=false; STALLED canvas marker=false; recovery version observed=none

