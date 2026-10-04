# REPORT — the R306 encode-seam arc: the seam flight + THE LIVE PUBLIC-WIRE LEG (the G12 walk's named gap, closed at the seam then measured over the public wire)

- Seam flight: branch `work/r306-encode-seam` (from main @ `250a6052a2424404e04c28dad35cccb289c4824e`; merged `dc2ed8f`, CI green run #333, 18:11→18:27Z)
- Live-wire flight: branch `work/r306-live-wire` (from main @ `dc2ed8fc9c7b9c91253a80378e31006965cc1e9a` — the seam merge itself)
- Evidence trees: `scripts/evidence/r306-encode-seam/` (the seam) + `scripts/evidence/r306-live-wire/` (the public wire; ADD-only)
- Credentials: E2B_API_KEY runtime-env only (`/home/z/.sporta-env`); never committed (validator-scanned, negative-tested)

=== R306 ENCODE-SEAM REPORT ===

## 1. The seam (the derived-reality plane's local-ffmpeg dependency, injected)

The G12 walk's measured next gap — `createDerivedRealityPlane`'s derived kinds refused with the TYPED `producer-unavailable` class because the hosted runtime ships no ffmpeg — is closed at the SAME seam-class the R207/R607 decode seam closed: the encode surfaces are now INJECTABLE over the http toolchain wire.

- **The ONE wire operation**: `encode-frames` — appended ADDITIVELY to the closed `MediaToolchainOperation` enum after the decode pair (`[probe, normalize, decode-probe, decode-frames, encode-frames]`); pre-extension envelopes still parse (the additive law, pinned in the decode-seam battery's own test).
- **The client pair** (`packages/media-platform/src/encode-http.ts`): BOTH frozen-SYNC encode surfaces over the one operation — the R306 `FrameEncoderPort` (`@sporta/encoding`) and the R301 `TacticalVideoCodec` (`@sporta/renderer-tactical`) — bridged through a BOUNDED SYNCHRONOUS subprocess transport (`spawnSync` child of the current runtime, `maxBuffer` 256 MiB, the STATUS-line protocol). Tests inject the `transport` seam (the `fetchFn` precedent).
- **The mechanical identity**: the encode executes at the worker through the SAME `FfmpegFrameEncoder` the local path runs — the client NEVER re-implements the encode (the cannot-drift law, measured below).
- **The honesty rules** (the W914 client conventions): the dispatch carries the packed rgb24 frames INLINE with client-measured claims (sha-256 + byte length) the worker re-measures; every response envelope validates fail-loud; the delivered bytes are RE-HASHED and RE-MEASURED at the receiving boundary (sha-256, byte length, ftyp magic); classified failures map onto the surfaces' own TYPED error families (`EncodingError` / `TacticalCodecError`); transport faults are the typed `encoder-unavailable`/`encode-failed` classes — nothing faked, nothing stored.
- **The executor leg + the worker route + the injection wiring**: `toolchain-executor.ts`'s encode leg (an injected `null` = the honest unavailable refusal), the media-worker's `encode-frames` dispatch handling, the composition's `encodePair` injection when `MEDIA_TOOLCHAIN=http`, and the derived-reality plane consuming it — the `in-process` default unchanged and byte-identical (the non-degradation law). Dependencies: `@sporta/encoding` + `@sporta/renderer-tactical`, both `workspace:*` (no external additions).

## 2. The seam's own battery + the measurement record (measured, never asserted from theory)

- **The battery** (`packages/media-platform/test/encode-seam.test.ts`, the decode-seam battery's mirror): **27 pass / 0 fail / 207 expect() calls** (verified by three independent runs, exit 0). The combined touched battery — media-platform + compute-adapter-hosted, the new file included: **182 pass / 0 fail**.
- **The REAL worker round trip** (the DEFAULT `spawnSync` transport, no injected fake, against a helper toolchain worker in a SEPARATE bun process executing the REAL `FfmpegFrameEncoder` over loopback HTTP): the R306 surface encoded 1 468 B (`sha256 b6e7672f85e7f0f732af61f899e82e12d07c22f6c9bc53c8de3c4204a615e75b`, `ftyp` verified, hash + byte length re-measured client-side); the R301 surface rode the SAME wire operation (1 495 B); the worker-side accounting measured **ONE cached descriptor GET for BOTH surfaces + TWO encode-frames POSTs** (the one-operation law).
- **THE BYTE-DRIFT LAW, MEASURED ACROSS THE WIRE**: the worker's encode of the same packed frames is **byte-identical** to the LOCAL adapter's (the same content hash, the same byte size) — the cannot-drift law held in measurement, not by construction-assertion.
- **The transport's typed refusals**: the unreachable worker → `encoder-unavailable` (failureClass `resource-limit`); the child that outlives its bound → `encode-failed` (`internal`); a non-2xx answer passes through un-interpreted (418 measured); a lying provider (a non-`MediaToolchainResult` answer) → the typed refusal, never trusted.

## 3. THE MEASURED LIMITATION (reported, never laundered)

**bun 1.3.14's `spawnSync` timeout does NOT kill the child.** A child that outlives the bound is reaped only at its own exit (the typed `encode-failed` refusal still surfaces; the wall clock is the child's lifetime), and a NEVER-exiting child hangs the synchronous call indefinitely (bounded in the measurement only by the driver's own `Bun.spawn` kill, which does hold). Under **node v24.21.0 the bound holds EXACTLY** (SIGKILL at the bound, measured: 403 ms against a 400 ms bound). The seam's fail-closed contract — typed refusals, no interpreted answer, no fabricated artifact — holds under BOTH runtimes; only the wall-clock sub-contract is runtime-dependent. The module docs, the transport docs, and the timeout refusal message all state the measured truth (the doc amendment landed with this merge); the full record is `scripts/evidence/r306-encode-seam/encode-seam-measurements.json` (`runtimeKillDiscipline`).

## 4. The lane's own history, honestly recorded

The 66-b worker died mid-flight (the session boundary killed it after the code was written, before ANY test/evidence/report existed). The TL completed the lane: the seam battery written (the dead worker's dispatch), the three enum-extension pins updated (decode-seam ×1, media-toolchain ×2 — the additive law's own test updates), two lint errors fixed (an unused type import; a `prefer-const`), the drift-law test's honest null guard (the factory answers `null` when ffmpeg is unavailable — never assumed away), the measurement script's lint fix (the `neverExit` fact now both logged and checked), and four orphaned measurement child processes reaped (the never-exiting children bun could not kill — the limitation made visible in the process table itself).

## 5. The gates

- `bun run lint`: **0 errors** (1 pre-existing `no-console` warning on `service.ts`, present on main, CI-tolerated).
- `bun run format:check`: **clean**.
- `bun run typecheck:series`: **73/73 packages** (re-verified for media-platform after the lane's fixes).
- `bun test packages/media-platform packages/compute-adapter-hosted`: **182 pass / 0 fail**.
- `bun test apps/web`: **green in isolation** (the golden-path battery 14/14 alone; the full-suite parallel timeouts on THIS sandbox are resource contention, not code — CI's sequential runner is the authoritative battery, same as the prior lane).

## 6. THE LIVE PUBLIC-WIRE LEG (flown — the same arc's flight B, the R607 precedent mirrored)

- **The sandbox** (`i5lvv9q3jrumm914o1rca`, E2B template base, Debian 12; fresh provision measured 103 364 ms; 2 h keep-alive re-extended per invocation — EPHEMERAL by design, its death class itself a measured leg below): the pinned `git clone` re-measured HEAD at `dc2ed8fc9c…` (fail-closed on any other), `bun install --frozen-lockfile` 167 packages, the in-sandbox toolchain ffmpeg 5.1.9-0+deb12u1 + libx264; the media-toolchain worker booted on 0.0.0.0:3971 (idempotent health-check-first start — the r607 lesson held; the start RPC's `deadline_exceeded` re-measured, the health wait arbitrated).
- **The descriptor over the public wire**: FIVE operations `[probe, normalize, decode-probe, decode-frames, encode-frames]` verified from THIS machine (the Vercel runtime's network position), 662 ms.
- **THE BYTE-DRIFT LAW, MEASURED HONESTLY ACROSS BUILDS**: the receiving-boundary re-hash HOLDS (the delivered bytes re-hashed client-side === the envelope's own claim: 1 468 B, `ftyp`, the `ffmpeg-libx264` producer identity); the local-vs-wire byte-identity does NOT — the local build (ffmpeg 7.1.5-0+deb13u1) hashes `b6e7672f…`, the worker's build (5.1.9-0+deb12u1) hashes `62d7c691…` of the same frames: the encoding module's documented **per-build determinism bound**, recorded as measured (this machine's build deterministic across flights — the local hash identical to the seam flight's loopback record).
- **The one-operation law at the worker**: ONE cached descriptor GET for both surfaces (the cache signature measured: first probe 279 ms, three subsequent answers [0, 1, 0] ms — no child spawned) + TWO happy-path `encode-frames` POSTs (the R306 FrameEncoderPort 1 026 ms / the R301 TacticalVideoCodec 347 ms, the SAME wire operation) + the refusal leg's counted dispatch — Δ dispatched +3 / succeeded +2 / failed +1; the usage drain === the dispatched count; transcodeRuns 3, inputBytes 5 376, outputBytes 4 431.
- **The typed refusals over the public wire** (all measured, all typed): a 1 ms worker-side policy → the real encode executed then refused `duration-over-limit` → **media-invalid/frames-invalid**; the DNS-dead unreachable URL + connection-refused control → **resource-limit/encoder-unavailable** (37/29 ms); the dead-sandbox ephemerality → the E2B proxy's **502 "The sandbox was not found"** through the STATUS line → the pair's **internal/encode-failed (http-502)**; the live worker's honest non-2xx answers → **404 unknown-route** / **400 invalid-body**, and through the pair **internal/encode-failed (unknown-route)**.
- **The evidence tree**: `scripts/evidence/r306-live-wire/` — the orchestrator + the live driver + the records (sandbox, live, worker-stats) + the fail-closed validator (4/4 tampered variants refused exit 1: laundered byte-identical, laundered sha, fabricated re-hash, laundered refusal) + the re-runnable commands.md.

## 7. The honest next flights (the arc continues)

1. **The deploy leg**: the env re-point + the production deployment baking the live worker URL (the r607 deploy precedent) — then the hosted golden path.
2. **The hosted golden path**: the derived kinds' four-reality journey WITH the seam injected — the J004 walk's `producer-unavailable` refusals replaced by real hosted encodes, the closure the G12 walk named.
3. **The persistent-worker-host decision** (the standing operator ask — the ephemeral-URL incident class's closure) and the R606 human visual gate remain the operator's outstanding items.
