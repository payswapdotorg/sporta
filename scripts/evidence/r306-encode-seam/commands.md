# R306 encode-seam — the re-runnable evidence commands (this machine's measured record)

Every number in `encode-seam-measurements.json` was produced by ONE driver run on THIS
orchestrating machine (2026-10-04, ffmpeg 7.1.5-0+deb13u1, bun 1.3.14, node v24.21.0).
Re-run the whole chain from the REPO ROOT:

```bash
# 1. The full measurement driver (the battery + the real worker round trip +
#    the transport contract + the runtime kill discipline) — rewrites
#    encode-seam-measurements.json with the FRESH measurements:
bun run scripts/evidence/r306-encode-seam/measure-encode-seam.ts

# 2. The seam's own battery, alone (the driver also runs this, but the
#    standalone form is the development loop):
bun test packages/media-platform/test/encode-seam.test.ts

# 3. The combined touched battery (the seam + the decode seam + the hosted
#    adapter's own gates — the enum-extension pins live here):
bun test packages/media-platform packages/compute-adapter-hosted
```

Honest scope: the driver's worker is a HELPER in a separate bun process on loopback
executing the REAL `FfmpegFrameEncoder` — the LIVE public-wire leg (an E2B worker)
and the hosted golden path are the separate next flights (see REPORT.md §6).
