# R306 LIVE PUBLIC-WIRE LEG (the encode pair over an E2B worker's public URL)

The flight that flies the R306 encode seam's arc one leg further: the seam
flight (`scripts/evidence/r306-encode-seam/`, merged as `dc2ed8f`) measured
the encode pair over a loopback helper worker on THIS machine; this flight
drives the SAME pair (`createHttpEncodePair` with its DEFAULT bounded
`spawnSync` transport) over the PUBLIC wire of a real E2B sandbox running
the pinned merge's media-toolchain worker — the exact network position the
hosted Vercel runtime's derived-reality plane holds when
`MEDIA_TOOLCHAIN=http` composes the injected encode pair. The same arc the
R607 decode seam flew (seam → live wire → deploy → hosted walk): this is
flight B.

The pinned revision is the **encode-seam merge
`dc2ed8fc9c7b9c91253a80378e31006965cc1e9a`** — `Merge work/r306-encode-seam`
— whose worker (`packages/compute-adapter-hosted/scripts/r607-media-toolchain-worker.ts`)
resolves the REAL `FfmpegFrameEncoder` at its composition (the
`createMediaToolchainWorker` R306 default) and therefore advertises the FIVE
operations `[probe, normalize, decode-probe, decode-frames, encode-frames]`.

## The honest scope

- **The live public-wire leg** (`encode-seam-live.ts` +
  `encode-seam-live.json`): the pinned-revision E2B worker, driven from THIS
  machine over its public `https://3971-<sandboxId>.e2b.app` URL —
  - the descriptor probe (the pair's ONE cached GET serving BOTH surfaces,
    measured by the wall-clock cache signature);
  - the R306 `FrameEncoderPort` encode (real ffmpeg/libx264 INSIDE the
    sandbox, deterministic tiny rgb24 frames — the seam precedent's
    geometry);
  - the R301 `TacticalVideoCodec` encode over the SAME `encode-frames` wire
    operation;
  - THE BYTE-DRIFT LAW: the delivered bytes re-hashed client-side against
    the envelope's own claims (the receiving-boundary law — MUST hold), and
    the wire encode vs the LOCAL adapter's encode of the same frames
    (measured honestly: the encoding module's own documented bound is that
    byte-determinism is PER BUILD — the sandbox's ffmpeg and this machine's
    ffmpeg are recorded with the verdict, whatever it measures);
  - the ONE-OPERATION accounting at the worker (TWO `encode-frames` POSTs
    for the happy path — one per surface — plus the refusal legs' own
    counted dispatches; the ledger identities re-measured over the wire via
    stats + the usage drain, two independent reads);
  - the transport's TYPED REFUSALS over the public wire: an unreachable
    worker URL → the typed `encoder-unavailable` class; the E2B
    ephemerality class (a DEAD sandbox's URL → the proxy's 502 "The sandbox
    was not found", passed through the STATUS line and mapped onto the typed
    `encode-failed` class); the LIVE worker's honest non-2xx (it serves no
    teapot route — its 404 `unknown-route` and 400 `invalid-body` envelopes
    are recorded verbatim, plus the same class through the pair); and a
    WORKER-SIDE classified refusal through the REAL pair (a 1 ms media
    policy → the real encode executes, then refuses `duration-over-limit`
    → the typed `media-invalid`/`frames-invalid` class — the mirror of the
    r607 driver's tiny-budget `ResourceLimitError`).
- The client is this driver, NOT the hosted runtime — the deploy leg and
  the hosted golden path (the J004 derived kinds with real hosted encodes)
  are the SEPARATE next flights of the same arc.

## Files

- `orchestrate-e2b.ts` — the sandbox provisioner (pinned at the encode-seam
  merge; fails closed on any other HEAD; ONE media worker on :3971,
  idempotent health-check-first start; writes `sandbox-record.json`).
- `encode-seam-live.ts` — the live-wire driver (writes
  `encode-seam-live.json` + `worker-stats.json`; every number measured).
- `validate-evidence.ts` — the fail-closed gate (a laundered record is
  refused: the byte-drift verdict must be consistent with its own recorded
  hashes; the accounting identities are re-derived from the record's own
  numbers; the typed refusal classes are checked verbatim).
- `sandbox-record.json` / `encode-seam-live.json` / `worker-stats.json` —
  the measured records.
- `commands.md` — the re-runnable chain, as executed.

## The ephemerality doctrine

The sandbox is EPHEMERAL BY DESIGN: it dies at its keep-alive timeout and
its public URL then answers the E2B proxy's 502 "The sandbox was not found"
— the exact class this flight measures as the dead-sandbox refusal leg. If
the sandbox dies mid-flight, the honest procedure is: re-run
`orchestrate-e2b.ts` (fresh sandbox at the pinned sha) → re-run
`encode-seam-live.ts` against the new public URL → re-run the validator.
The r607 flight measured this death live twice; this flight records the
class without needing it to happen.
