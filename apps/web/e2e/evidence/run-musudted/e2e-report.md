# W909 browser E2E — run musudted

Target: http://127.0.0.1:3909 (production build, port 3909)

**0 passed / 1 failed** — 20 assertions passed, 2 failed.

| Flow | Outcome | Assertions | Evidence |
| --- | --- | --- | --- |
| Live tactical gate (L015) — continuous updates, latency, identity, dropout | ❌ failed | 20/22 | live-tactical-gate-normal.png, live-tactical-gate-reconnect.png |

## Live tactical gate (L015) — continuous updates, latency, identity, dropout

- ✅ **the live transport really serves the L002 scenario sessions (no fixture: the transport's own listing)** — listing: 8 sources (kind=story/tactical/tactical/tactical/tactical/tactical/tactical/tactical); normal="Synthetic live tracking — normal delivery"; reconnect="Synthetic live tracking — reconnect"; drop="Synthetic live tracking — scattered drops"
- ✅ **the source is honestly labeled the L002 deterministic synthetic tracking source** — sourceNote="L002 deterministic synthetic tracking source — scenario 'normal', 600 ticks @ 100ms (every tick delivered in order at the base latency)"
- ✅ **the live tactical surface is LIVE in the real browser with a rendered canvas** — data-live-phase=live; canvas count=1; label="Live tactical pitch: world version 17, 24 entities at event time 2s"
- ✅ **the probe observed the real stream (the page's own EventSource traffic, no dev API)** — probe opens=1; captured world frames=16 (16 on the normal session)
- ✅ **the session under test IS the transport's listed normal session (no hidden session)** — captured sessionIds={sess-4}; under test=sess-4
- ✅ **state updates arrive continuously (measured receipt cadence matches the declared cadence)** — n=15 intervals; median=500ms (min 491, max 506) vs declared 500ms; tolerance ±45%; frames=16
- ✅ **the rendered tactical state visibly follows state changes (DOM world versions advance with the frames)** — polled DOM world versions=[17, 19, 20, 22, 23, 25]; captured at window start=v16, at polls=v25; distinct=6
- ✅ **meaningful state changes arrive (ball and player move beyond the threshold between frames)** — ball: max=3.79m mean=3.012m (n=15); player p-home-01: max=0.40m mean=0.219m
- ✅ **the latency measurement produced a real percentile window (never an absent metric claimed as met)** — nearest-rank p50=1ms, p95=7ms over 16 measured samples
- ❌ **the measured percentiles are asserted against the declared budget** — declared budget: ABSENT — the repo declares no numeric live-path latency percentile budget (packages/slo SLOs.md scope = the W306 batch/frame pipeline; docs/deployment/DEPLOYMENT.md records measured live evidence "never a promise"). Measured: p50=1ms p95=7ms (n=16). Budget numbers are proposed to the TL as a docs amendment (see the gate REPORT); this line FAILS honestly until one is declared.
- ✅ **identity continuity is bounded (no unexplained re-identification across the window)** — 24 entities over 16 frames; 0 identity switches; late appearances=0 (all with explicit entity-appeared events)
- ✅ **the reconnect-scenario session is selectable through the product's own live picker** — picker answer="selected"
- ✅ **the dropout/reconnect scenario ran its gap (the stream's own recovery accounting arrived)** — reconnect frames captured=41; recovery event: missedUpdates=8, gapDurationMs=800 (frame #40 of the captured window)
- ✅ **the interruption is EXPLICIT in the stream's own data (degraded quality carried, then recovered to nominal)** — captured quality states={nominal,degraded}; quality-degraded/quality-nominal transition events=3 frames; nominal resumption after the recovery=observed
- ✅ **the dropout is VISIBLE in the product surface (the honest event ticker shows the accounted gap)** — ticker row="source reconnect — 8 updates missed (0.8s gap, accounted)"
- ❌ **the degraded quality state was visible in the surface's own quality fact during the recovery window** — quality fact now="nominal" (the degraded window is 3 frames; the authoritative captured-state assert above carries this line if the poll window missed the transient chip)
- ✅ **the stream RECovers and continues (world versions advance past the recovery frame)** — world version at recovery=v41; latest captured=v44; frames after recovery=3
- ✅ **the view does NOT change during a no-update window (honest connecting state, never a fabricated one)** — pre-first-frame trajectory: 3 samples; phases=live; connecting observed at sample #0 with 0 frames received; fabricated-version samples=0
- ✅ **the drop-scenario session is selectable through the product's own live picker** — picker answer="selected"
- ✅ **the drop scenario's losses are counted sequence gaps (never smoothed over)** — drop frames captured=14; source-sequence gaps=3 (first: 1 tick(s) after frame #3); dropRate default 0.15
- ✅ **the entity inspector pins the ball through the product's own picker** — pick answer="pinned"
- ✅ **the pinned entity keeps its identity while its state updates (the inspector follows the ref, not a position)** — pinned="ball-1 · BALL"; position x 84.12 · y 8.89 → x 73.64 · y 16.54; detection=detected
- 📝 signed in a fresh viewer account through the real register form (e2e-live-l015-musudted)
- 📝 hello: sessionId=sess-4 sourceKind=tactical cadenceMs=500 (the transport's own declaration)
- 📝 the surface's own update-rate fact: "2.1 Hz"; frames fact: "17"
- 📝 measured e2e latency (generation→receipt): n=16 p50=1ms p95=7ms max=7ms min=1ms; the surface's own displayed window: "1 / 7 / 7 ms"
- 📝 the drop scenario's browser-visible accounting: the picker's own description labels it ("Synthetic live tracking — scattered dropslive tactical view — the live view-model's world frames (L002 deterministic tracking source)tactical view-model"); the sequence-gap counts ride the captured frames (the surface's ordinal-drop counter is the transport-loss lane, a different seam)
- 📝 determinism fingerprint (normal session, first 16 captured frames): v1@0#seq1 v2@100#seq2 v3@200#seq3 v4@300#seq4 v5@400#seq5 v6@500#seq6 v7@600#seq7 v8@700#seq8 v9@800#seq9 v10@900#seq10 v11@1000#seq11 v12@1100#seq12 v13@1200#seq13 v14@1300#seq14 v15@1400#seq15 v16@1500#seq16

