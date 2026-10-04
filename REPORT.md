# REPORT — the TL delivers the R306 encode seam (the G12 walk's named next gap, closed at the seam)

- Branch: `work/r306-encode-seam` (from main @ `250a6052a2424404e04c28dad35cccb289c4824e` — the hosted-G12-walk merge the Composio lane replicated; CI green run #332)
- Evidence tree: `scripts/evidence/r306-encode-seam/` (ADD-only; no FROZEN-contract or prior-evidence edits)
- Credentials: none required on this flight (the seam is machine-local; the LIVE public-wire leg is the next flight's concern)

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

## 6. The honest next flights (the same arc the decode seam flew)

1. **The live public-wire leg**: the pair against an E2B-hosted worker over the public URL (the R607 arc's flight B) — the seam's client measured from the same network position the Vercel runtime holds.
2. **The hosted golden path**: the derived kinds' four-reality journey WITH the seam injected — the J004 walk's `producer-unavailable` refusals replaced by real hosted encodes, the closure the G12 walk named.
3. **The persistent-worker-host decision** (the standing operator ask — the ephemeral-URL incident class's closure) and the R606 human visual gate remain the operator's outstanding items.
