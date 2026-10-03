# R607/62-c — the recovery proof (redeploy → fresh browser → byte-identical)

Worker 62-c · 2026-10-03 00:09–00:11 UTC · deploy 1 `r607-e2b-1`
(`dpl_DExXPovpx24BwkLFfS6gsJucpT76`, revision `89ae99e`) → redeploy
`r607-e2b-2` (`dpl_Cr9SwXQF3prrUACFzRQddhsgCzdo`, the SAME revision, a
distinct new deployment id) · the recovery browser: a FRESH agent-browser
context (`--session r607e2brecovery` — no shared cookies/state).

## The recovery table (all numbers measured)

| Recovery step | Result | Evidence |
|---|---|---|
| Identity | **PASS** — fresh browser + fresh sign-in (`POST /api/auth/login` 200) → SAME `userId u-5e3fdf7d42054c489d523cc3902f5945`; the pre-redeploy cookie ALSO resolves on the NEW deployment (`GET /api/auth/me` 200 with the deploy-1 cookie) | `recovery/01-recovery-signin-same-identity.png`; `api-captures/me-after-redeploy.json` |
| Session/library | **PASS** — library rows 1 before / 1 after, the SAME row (`sess-u-a16e733f1c0440c5121adf1a9da79c18` "Derby night at Kings Park", status authorized) | `recovery/02-recovery-library.png`; `api-captures/library-after-redeploy.json` |
| Watch | **PASS** — `GET /api/watch/<sessionId>` 200 on the new deployment; the SAME renderId `r-u-3109f1827b75379d9fe0d229cc42f464`; the Reality Switcher's four honest per-reality states unchanged (Anime READY · 1 ARTIFACT); the URL-addressable switch (`?reality=anime-npr`) held the session constant | `recovery/03-recovery-watch-recovered.png`; `api-captures/watch-model-after-redeploy.json` |
| Watch playable | **PASS** — the review-format artifact plays (the frame-by-frame diagnostics player) | `recovery/03` |
| Artifacts | **PASS — BYTE-IDENTICAL** — served content sha-256 == the declared contentHash `1d5d07dfb4d8d3cdd5b16d388339433770d2ca546c91b473ca4520aacd78a881` BEFORE and AFTER the redeploy; byteLength 19 733 both times; `x-sporta-artifact-source: r2` both times; the before/after JSON documents compare equal (`content` field identical) | `api-captures/artifact-before-redeploy.json` vs `artifact-after-redeploy.json` (+ both headers files) |
| Jobs ledger | **PASS (honest boundary)** — "0 sessions with dispatched jobs" on the fresh instance (the W921 per-instance ledger — the render executed on the E2B worker and the artifact is durably in R2, but the in-memory ledger never invents rows) | `recovery/04-recovery-jobs-honest-per-instance.png` |
| Console errors | **0** across the whole recovery walk | the journey log |

## The byte-level comparison (verbatim)

```
$ sha256sum of the served content (before, deploy 1):
  1d5d07dfb4d8d3cdd5b16d388339433770d2ca546c91b473ca4520aacd78a881   (declared == measured)
$ sha256sum of the served content (after, deploy 2):
  1d5d07dfb4d8d3cdd5b16d388339433770d2ca546c91b473ca4520aacd78a881   (declared == measured)
  byteLength 19733 / 19733 · x-sporta-artifact-source: r2 / r2 · renderId identical
```

## What this proves with the E2B failover in place

The hosted control plane's durability is INDEPENDENT of the compute
provider: the recovery survives a distinct new deployment of the same
revision with identity (Neon), session/library (the W921 durable control
plane), and artifacts (R2, byte-identical, hash-verified at the serving
boundary) — while the compute plane that PRODUCED the artifact was the E2B
worker (the render executed there on deploy 1; the artifact landed through
the app's render-output writer into R2). The provider record's operational
note: the E2B sandbox is ephemeral (~70-minute plan cap) — the deployed
app's http compute seam would fail loudly (the boot-time live descriptor
fetch) against a dead sandbox, which is the honest provider-availability
posture of `COMPUTE_PROVIDER=http` (never a silent fallback).
