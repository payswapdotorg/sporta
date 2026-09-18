# @sporta/encoding — the R306 real video encoding plane

**Work item R306:** "Deliver actual MP4 outputs and manifests" for the
tactical (R301), 3D (R303) and anime (R304) renderers, behind a
vendor-neutral `FrameEncoderPort`.

## What this package is

- **`FrameEncoderPort`** — the mechanical seam (the `@sporta/decoding`
  two-tier precedent): a typed frame sequence in (a staged rgb24 file or
  in-memory decoded frames), real encoded bytes out. Policy never lives
  in the adapters.
- **`FfmpegFrameEncoder`** — the REAL adapter: libx264 encode via a
  bounded ffmpeg subprocess following
  `packages/renderer-tactical/src/codec.ts` EXACTLY on every determinism
  knob (`-threads 1`, `-fflags +bitexact -flags:v +bitexact`,
  `-map_metadata -1`, pinned `preset/tune/profile/level/crf/pix_fmt/g`,
  Constrained Baseline L3.0 → `avc1.42E01E`), plus the R306 bounds:
  `maxBuffer` 256 MiB, a timeout with `SIGKILL` (no hangs, no zombies —
  `spawnSync`'s synchronous contract reaps), honest exit codes (status +
  a 500-char stderr excerpt in the typed error).
- **`FixtureFrameEncoder`** — the deterministic zero-I/O test tier. Its
  bytes are a clearly-labeled fixture document (magic header + canonical
  JSON with the stream's sha-256) — **never video, never claimed as
  video** (artifact `kind: "fixture"`; the R307 gate treats fixture-tier
  artifacts as NOT-RUNNABLE for decode-based checks).
- **Three renderer bridges** (thin, additive — the renderers stay
  untouched, consumed STRUCTURALLY, which is why the renderer packages
  are devDependencies, not runtime deps):
  - **tactical** — R301 emits its own REAL MP4s; the bridge ADOPTS +
    VERIFIES them (bytes re-read, re-hashed against the staged record's
    hash AND the frozen `RenderArtifactManifest`'s hash, the manifest
    parsed through the frozen contract schema and carried VERBATIM).
  - **game-3d / anime-npr** — R303/R304's `Software3DEngine` frame
    streams (the frozen `GameEngineFrameOutput` seam: a staged,
    content-addressed rgb24 file) encoded into REAL MP4s through the
    `FrameEncoderPort`.
  - **raw-frames** — in-memory rgb24 frames through the same port.
- **`EncodedArtifact` + container manifest** (the W504 pattern) — every
  artifact carries: the source renderer id + version, frame count,
  duration, the pinned codec params, the sha-256 content hash of the
  bytes, per-frame timing, the SWM provenance, and the renderer's own
  manifest VERBATIM. `integrity.verified` is earned only by a re-hash.
- **W504 store registration** (REUSED, never forked) —
  `registerEncodedArtifact` / `loadEncodedArtifact` over the
  `@sporta/output-pipeline` content-addressed `ArtifactStore` (in-memory
  + on-disk): idempotent puts, counted duplicates, integrity-verified
  reads, explicit limits — the store's own semantics, unchanged.
- **`probeEncodedArtifact` + `decodeEncodedFrames`** — ffprobe
  cross-checks (h264, Constrained Baseline, exact geometry) and the
  full-frame rawvideo decode (every frame, exact byte counts) — the
  honest foundation for R307's measured temporal stability.

## Honest notes

- **MP4 honesty**: the ffmpeg tier and the adopted tactical artifacts
  are REAL raster video outputs — no SVG-only stand-ins at this plane.
- **The base64 representation**: the W504 store's seam is string
  content, so an MP4 registers as its base64 representation
  (`contentType: "video/mp4+base64"`). TWO hashes are recorded, both
  honestly: the manifest's `contentHash` (sha-256 of the RAW MP4 bytes —
  the frozen convention) and the store's `artifactId` (sha-256 of the
  stored base64 document). Loads verify BOTH (the store re-hashes its
  document; `loadEncodedArtifact` re-hashes the decoded raw bytes).
- **Determinism (per build, honestly bounded)**: three runs of the same
  frames produce byte-identical MP4s — one sha-256 (test-pinned per
  run). ffmpeg 7.x removed `-movflags +bitexact` from the mp4 muxer
  (it errors — the option list deliberately does not carry it), and the
  x264 bitstream embeds a core-version SEI that is constant per build
  but varies ACROSS builds: **cross-build byte-stability is NOT
  claimed** (the renderer-3d game codec's documented precedent).
- **The generatedAtMs clock** is injected; the default is the
  deterministic `TEST_EPOCH_MS` CONSTANT (fresh builds are
  byte-identical); production hosts MUST inject a real clock.
- **Package boundary**: runtime deps only
  `@sporta/contracts`, `@sporta/renderer-contract`,
  `@sporta/output-pipeline`, `@sporta/observability`, `@sporta/testing`
  (+ `node:` builtins for the subprocess/fs substrate); the renderer
  packages are dev-only (the bridges are structural). Pinned by
  `test/boundary.test.ts` (which also pins zero wall-clock/randomness
  in `src`).
