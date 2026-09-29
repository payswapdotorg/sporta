# R607 lane B — the verbatim command classes (re-runnable at the branch tip)

All commands ran from the worker sandbox at branch
`r607/w914-toolchain-worker` (base `ad71969`, origin/main). Nothing here
needs credentials (the hosted re-run is the one operator-gated leg — see
the README's honest boundary statement).

## 0) Base + branch (the task packet's setup, verbatim)

```bash
cd /home/z/sporta                     # the repo clone (already present)
git status                            # clean at main ad71969
git checkout -b r607/w914-toolchain-worker main
```

## 1) The toolchain sanity (the sandbox must actually ship the binaries)

```bash
which ffmpeg ffprobe                  # /usr/bin/ffmpeg, /usr/bin/ffprobe
ffmpeg -version | head -1             # ffmpeg version 7.1.5-0+deb13u1 …
```

## 2) The test batteries (non-degradation + the new profile)

```bash
cd /home/z/sporta/packages/compute-adapter-hosted && bun test
# → 104 pass / 0 fail (main baseline: 84 across 8 files, UNMODIFIED and green)

cd /home/z/sporta/packages/media-platform && bun test
# → 28 pass / 0 fail (main baseline: 16 across 1 file, UNMODIFIED and green)

cd /home/z/sporta/packages/media-platform && bun run typecheck          # tsc --noEmit: clean
cd /home/z/sporta/packages/compute-adapter-hosted && bun run typecheck  # tsc --noEmit: clean
cd /home/z/sporta/apps/web && bun run typecheck                         # next typegen + tsc: clean
```

## 3) The golden path, external-worker topology (the primary evidence shape)

Terminal A — the standalone media-toolchain compute worker (a REAL
Bun.serve process, fixed port 3971, the REAL ffmpeg/ffprobe toolchain):

```bash
cd /home/z/sporta/packages/compute-adapter-hosted
bun run scripts/r607-media-toolchain-worker.ts            # stays up; SIGTERM to stop
# boot log: toolchain RESOLVED — ffmpeg '/usr/bin/ffmpeg' / ffprobe '/usr/bin/ffprobe'
#           measured identity: ffmpeg version 7.1.5-0+deb13u1 …
#           budgets: maxExecutionMs=120000 … maxConcurrentJobs=1 (ONE ffmpeg at a time)
```

Terminal B — the golden-path driver against it (a real upload through the
http seam: admission → normalize → artifact → accounting → boundary):

```bash
cd /home/z/sporta/packages/compute-adapter-hosted
bun run scripts/r607-w914-golden-path.ts --worker-url http://127.0.0.1:3971
# writes scripts/evidence/r607-w914-toolchain/golden-path.json + the stdout summary
```

The single-process equivalent (the driver embeds its own worker on the
same fixed port — the same code path, real socket):

```bash
cd /home/z/sporta/packages/compute-adapter-hosted
bun run scripts/r607-w914-golden-path.ts
```

Exactly how the evidence runs were captured (worker stdout → runs/, driver
stdout → runs/, run 2's record preserved for the determinism comparison):

```bash
OUT=../../scripts/evidence/r607-w914-toolchain
bun run scripts/r607-media-toolchain-worker.ts > $OUT/runs/worker-log-N.txt 2>&1 &
WPID=$!; for i in $(seq 1 20); do curl -s -o /dev/null http://127.0.0.1:3971/health && break; sleep 0.5; done
bun run scripts/r607-w914-golden-path.ts --worker-url http://127.0.0.1:3971 | tee $OUT/runs/external-N.txt
kill -TERM $WPID; sleep 1        # the worker's SIGTERM ledger line lands in worker-log-N.txt
```

## 4) The sha-256 cross-verifications (never-guess-shas: full shas from the bytes)

The source generator is deterministic; the golden path's two shas are
re-derived from bytes on disk with an INDEPENDENT tool:

```bash
cd /home/z/sporta/packages/compute-adapter-hosted
SRCDIR=$(mktemp -d)
bun -e "import { generateTestMp4, InProcessMediaToolchain } from '@sporta/media-platform'; \
  import { readFile, writeFile } from 'node:fs/promises'; \
  const src = await generateTestMp4('$SRCDIR/source.mp4', { durationSeconds: 2, withAudio: true }); \
  const seam = new InProcessMediaToolchain(); \
  const { outputBytes } = await seam.normalizeMedia(new Uint8Array(await readFile(src))); \
  await writeFile('$SRCDIR/normalized.mp4', outputBytes);"
sha256sum $SRCDIR/source.mp4 $SRCDIR/normalized.mp4
# 4a347893921b2e21fa991d72c217c01b19953db5d72bab0efc36e4574de5bd4b  source.mp4
# 964cec11407a9c688877c4df9119fd8e96bb034039a8da61a965db6691a7afce  normalized.mp4
#   == the http worker's artifact sha (golden-path.json artifact.contentHash):
#   the in-process DEFAULT and the http worker produce BYTE-IDENTICAL output.
rm -rf $SRCDIR
```

## 5) The worker's HTTP surface, directly (spot checks)

```bash
curl -s http://127.0.0.1:3971/health
curl -s http://127.0.0.1:3971/v1/media/adapter          # the honest descriptor
curl -s http://127.0.0.1:3971/v1/media/stats            # the accounting snapshot
curl -s http://127.0.0.1:3971/v1/media/usage            # the metering drain
curl -s http://127.0.0.1:3971/v1/media/jobs/<jobId>     # a job record
curl -s -X POST http://127.0.0.1:3971/v1/media/jobs/execute \
  -H 'content-type: application/json' -d '<a MediaToolchainDispatchRequest>'
```

## 6) The hosted re-run (OPERATOR-GATED — recorded, not executed, never faked)

The hosted leg needs what this sandbox does not have: a `VERCEL_TOKEN`
and an EXTERNAL toolchain worker URL reachable from the Vercel runtime
(the W910 runbook §3 deploy, with the project env adding
`MEDIA_TOOLCHAIN=http` and `MEDIA_TOOLCHAIN_URL=<external worker url>` —
the same `r607-media-toolchain-worker.ts` entry on any ffmpeg-shipping
host). The shape of that run, when the operator supplies the gate:

```bash
# (terminal A, on the ffmpeg-shipping host) bun run scripts/r607-media-toolchain-worker.ts
# (terminal B) . ~/.secrets/env.sh   # VERCEL_TOKEN
#   bunx vercel env add MEDIA_TOOLCHAIN http --production --token "$VERCEL_TOKEN" --project sporta
#   bunx vercel env add MEDIA_TOOLCHAIN_URL https://<external-worker-host> --production --token "$VERCEL_TOKEN" --project sporta
#   bunx vercel deploy --prod --yes --token "$VERCEL_TOKEN" --project sporta
#   → then the R607 hosted golden path re-run (upload must PASS admission this time,
#     the four-reality pipeline's Original leg unblocked through the seam)
```
