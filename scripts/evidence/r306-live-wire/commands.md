# R306 live public-wire leg — the re-runnable chain (commands as EXECUTED)

Every number below was produced by the runs recorded in this evidence dir
(2026-10-04, the pinned encode-seam merge `dc2ed8f`, this machine's ffmpeg
7.1.5-0+deb13u1, bun 1.3.14). Re-run the whole chain from the REPO ROOT:

## 1) The fresh sandbox at the encode-seam merge (ONE media worker) — EXECUTED

```bash
source /home/z/.sporta-env
E2B_API_KEY=$E2B_API_KEY bun run scripts/evidence/r306-live-wire/orchestrate-e2b.ts
# → EXECUTED: sandbox i5lvv9q3jrumm914o1rca (fresh, provisioned in 103 364 ms),
#    pinned HEAD dc2ed8fc9c7b9c91253a80378e31006965cc1e9a (fail-closed clone
#    check passed), ffmpeg 5.1.9-0+deb12u1 + libx264, bun 1.4.2, 167 packages,
#    the media worker healthy on 0.0.0.0:3971, the PUBLIC descriptor
#    verified from THIS machine advertising
#    [decode-frames, decode-probe, encode-frames, normalize, probe], 2h
#    keep-alive (sandbox-record.json).
#    The worker-start command's RPC response was LOST to the E2B SDK's
#    deadline_exceeded (the r607 lesson, re-measured) — the worker booted
#    anyway and the bounded health wait arbitrated (idempotent
#    health-check-first start).
# re-verify/re-extend an already-running sandbox:
#   E2B_API_KEY=$E2B_API_KEY bun run scripts/evidence/r306-live-wire/orchestrate-e2b.ts \
#     --sandbox-id i5lvv9q3jrumm914o1rca
#    → EXECUTED twice: once to rewrite the record through the base64 boot-log
#    read (see the display-artifact note below), once after a TRANSIENT E2B
#    RPC timeout (formatSandboxTimeoutError on commands.run — the SDK's
#    deadline class, measured; the immediate retry succeeded and re-measured
#    every identity + re-extended the keep-alive).
```

## 2) The live encode-seam driver over the PUBLIC URL — EXECUTED, ALL GREEN

```bash
bun run scripts/evidence/r306-live-wire/encode-seam-live.ts \
  --worker-url https://3971-i5lvv9q3jrumm914o1rca.e2b.app
# → EXECUTED (encode-seam-live.json + worker-stats.json), exit 0:
#    - the descriptor over the public wire: the FIVE operations, 662 ms;
#    - the pair's ONE cached probe: first 279 ms, the three subsequent probe
#      answers [0, 1, 0] ms (no child spawned — the one-GET law's cache
#      signature);
#    - the R306 FrameEncoderPort encode: 1 468 B MP4, sha
#      62d7c691aa98ea04…, 160 ms clip, 16x16 @ 12.5 fps, wall 1 026 ms
#      (REAL ffmpeg/libx264 INSIDE the E2B sandbox);
#    - the R301 TacticalVideoCodec over the SAME wire operation: 1 495 B,
#      wall 347 ms;
#    - THE BYTE-DRIFT LAW: receiving-boundary hashVerified=true (the
#      delivered bytes re-hashed client-side === the envelope's claim);
#      local-vs-wire byteIdentical=FALSE, measured honestly — the local
#      adapter (ffmpeg 7.1.5-0+deb13u1) hashes b6e7672f85e7f0f7… while the
#      worker's build (ffmpeg 5.1.9-0+deb12u1) hashes 62d7c691aa98ea04… of
#      the same frames — the encoding module's own documented bound
#      (byte-determinism is PER BUILD; the x264 bitstream embeds the build's
#      core-version SEI; cross-build byte-stability is NOT claimed). The
#      local hash re-measured IDENTICAL to the seam flight's loopback
#      measurement (b6e7672f… — this machine's build is deterministic
#      across flights);
#    - the one-operation accounting: Δ dispatched +3 / succeeded +2 /
#      failed +1 (TWO happy-path encode POSTs — one per surface — plus the
#      refusal leg's counted dispatch), usage drain 3 === dispatched 3,
#      transcodeRuns 3, inputBytes 5 376, outputBytes 4 431;
#    - the typed refusals over the public wire: the worker-side 1 ms policy
#      → media-invalid/frames-invalid (duration-over-limit, wall 314 ms);
#      the DNS-dead unreachable URL → resource-limit/encoder-unavailable
#      (37 ms); the dead-sandbox ephemerality class → the E2B proxy's 502
#      "The sandbox was not found" through the STATUS line → the pair's
#      typed internal/encode-failed (http-502, 280 ms); the live worker's
#      honest non-2xx: 404 unknown-route (276 ms) + 400 invalid-body
#      (780 ms) + the same class through the pair (unknown-route, 252 ms).
```

## 3) The fail-closed gate — EXECUTED, PASS + 4/4 negatives refused

```bash
bun run scripts/evidence/r306-live-wire/validate-evidence.ts  # → exit 0
# The negative variants (tampered copies in /tmp, re-built per run):
#   a laundered byte-drift verdict (byteIdentical flipped true, hashes left
#   divergent)          → exit 1 "the byte-identical verdict is CONSISTENT…"
#   a laundered pinned sha (one hex digit flipped, both records)
#                        → exit 1 "the pinned sha is the R306 encode-seam merge…"
#   a fabricated re-hash (measuredHash replaced, hashVerified left true)
#                        → exit 1 "the receiving-boundary record is SELF-CONSISTENT…"
#   a laundered refusal (refused flipped false)
#                        → exit 1 "the worker-side 1ms-policy refusal is TYPED…"

bunx prettier --check scripts/evidence/r306-live-wire/   # clean
bunx eslint  scripts/evidence/r306-live-wire/            # 0 errors
```

## The measured display artifact (the 66-b2 lesson, re-measured)

A bare `[m` sequence is eaten by THIS sandbox's terminal DISPLAY channel:
`cat` of the worker's boot log, a `sed 's/^/BOOT>/'`-prefixed `cat`, and the
orchestrator's own `console.log` all DISPLAY `[media-toolchain-worker]` as
`edia-toolchain-worker]` — while the in-sandbox `od -c`, the `base64 -w 0`
round trip, and a byte-exact read of the written JSON all carry the TRUE
bytes. The orchestration reads the boot log base64-wrapped so the record is
verifiable regardless of what any terminal shows (see
`sandbox-record.json` → `worker.bootLogRead`).

## The ephemerality doctrine (the honest lifetime record)

The sandbox `i5lvv9q3jrumm914o1rca` is EPHEMERAL BY DESIGN: started
2026-10-04T18:24:56Z, keep-alive re-extended to 120 minutes at every
orchestrator invocation (the last re-verification re-extended it); it dies
at the timeout and its public URL then answers the E2B proxy's 502 "The
sandbox was not found" — the exact class this flight records as the
dead-sandbox refusal leg (measured against a syntactically-valid
nonexistent sandbox id, honest about being a synthetic id rather than
waiting for the real one to die). If the live sandbox dies before review:
re-run §1 (fresh sandbox at the pinned sha) → §2 (the new public URL) → §3
(the gate). The r607 flight measured this death-and-rerun cycle live
(~30 min end-to-end).
