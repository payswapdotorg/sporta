# R306 artifact-ingest — the re-runnable evidence commands

Every number in `artifact-ingest-seam.json` was produced by ONE driver run on THIS
machine (2026-10-05, bun 1.3.14, ffmpeg 7.1.5-0+deb13u1, the real
`FfmpegFrameEncoder`). Re-run the whole chain from the REPO ROOT:

```bash
# 1. The full measurement driver (the battery spawned + the pre-fix refusal
#    reproduced verbatim + the post-fix landing + the in-process non-degradation
#    + the re-delivery accounting + the six refusals) — REWRITES
#    artifact-ingest-seam.json with the FRESH measurements (every field
#    re-measured, never copied):
bun run scripts/evidence/r306-artifact-ingest/artifact-ingest-seam.ts

# 2. The fail-closed validator (22 checks; the record must agree with ITSELF —
#    the refusal's sha, the landing's internal consistency, the put-counter
#    arithmetic, the nothing-put refusals, the verdict's own counts):
bun run scripts/evidence/r306-artifact-ingest/validate-evidence.ts

# 3. The negative battery (7 tampered variants, each MUST be refused):
bun run scripts/evidence/r306-artifact-ingest/validate-evidence.ts --negative

# 4. The seam's own battery, alone (the driver also spawns this, but the
#    standalone form is the development loop):
bun test apps/web/test/artifact-ingest-seam.test.ts

# 5. The non-degradation pin end-to-end (the in-process golden path — the
#    four-reality journey through the composition's own wiring):
bun test apps/web/test/golden-path.test.ts
```

Honest scope: the driver composes the hosted plane's two-runtime split LOCALLY
(the worker's own `InMemoryArtifactStore` ≠ the app-side composed
`InMemoryArtifactStore`, the artifact a REAL ffmpeg/libx264 encode, the ingest
through the REAL routing render-output writer over the REAL media platform).
The LIVE hosted re-flight (a fresh E2B sandbox + redeploy + the golden-path
walk re-run — the 4/4 closure measure) is the named NEXT flight, not this one.
