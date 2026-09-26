# R607 recovery proof (after the redeploy)

Fresh browser context (agent-browser session `r607recovery` — new
Chromium profile, zero cookies) opened AFTER deployment `r607-fix-2`
(`dpl_9xhz2W7HwRZWjGJJ8XGPja3Ejdkx`, same revision `8893926`, marker
verified via `/api/platform/health`). No developer intervention of any
kind between the golden-path run and this recovery run.

## The recovery table

| Recovery claim | Result | Evidence |
|---|---|---|
| identity: the SAME account can sign in again | **RECOVERED** | `POST /api/auth/login` with `r607-accept-1790461857` → 200; `/api/auth/me` → the SAME `userId u-da57c6893aa146439a74cd6ffb4a3014` (Neon identity; screenshot `01-recovery-signin-same-identity.png`) |
| login session (pre-redeploy cookie) resolves on the new deployment | **RECOVERED** | the cookie issued on deployment `r607-fix-1` (pre-redeploy) resolves `/api/auth/me` on `r607-fix-2` → the same userId (the W911 cross-deployment session-survival pattern) |
| session: the SAME media session exists | **RECOVERED** | `sess-u-abb7d38fc2868a3021aa281a3baab9c0` ("Derby night at Kings Park") — reconstructed on the fresh serverless instance through the W921 Neon control-plane record + deterministic replay |
| library rows: N before/after | **SAME (1/1)** | `GET /api/catalog/library` → 1 row before the redeploy and 1 row after, same session id + label (screenshots `05-recovery-library.png`) |
| watch: playable after the redeploy | **RECOVERED** | `GET /api/watch/<sess>` → 200 with the SAME render `r-u-2ce33e9fbd2afe81fea6c968c66d876e`; the browser Watch page renders the Reality Switcher + the frame player (screenshots `02`–`03`) |
| Reality Switcher (same session, URL-addressable) | **RECOVERED** | the fresh browser's switch lands on `…&reality=anime-npr` (screenshot `04-recovery-reality-switcher-url.png`) |
| artifacts: same ids + shas | **UNCHANGED** | segment `anime-clip-684d4240`, contentHash `ad849619db660ad75d2a16e9ba7c638d393971ba9ae1b2c3d78ad96123e8b717`, byteLength 19 733 — identical before/after; sha-256(served content) == the declared hash on BOTH deployments; still `x-sporta-artifact-source: r2` (the artifact persisted in the private R2 bucket across the redeploy) |
| upload-source session + its four outputs | **BLOCKED UPSTREAM** | the golden path's upload was refused at admission on deployment `r607-fix-1` (ffprobe absent on the hosted Node runtime — the typed `media-invalid` refusal, nothing stored), so there is no upload session to recover. This row is the honest blocked cell, not a recovery failure: the failure was classified and recorded BEFORE the redeploy (see `../golden-path/journey-log.md`) |
| Jobs listing after redeploy | **HONEST PER-INSTANCE BOUNDARY** | "0 sessions with dispatched jobs" on the fresh instance — the documented W921 boundary (the compute-job ledger never invents rows; screenshot `06-recovery-jobs-honest-per-instance.png`) |
| console errors in the recovery browser | **0** | `agent-browser errors` and console log empty at every stage |

## Byte-level artifact comparison (before → after the redeploy)

```
watch model (GET /api/watch/sess-u-abb7…):
  before: renders [r-u-2ce33e9fbd2afe81fea6c968c66d876e]
  after:  renders [r-u-2ce33e9fbd2afe81fea6c968c66d876e]           → SAME
  before: outputs [(anime-clip-684d4240, ad849619…8b717, 19733)]
  after:  outputs [(anime-clip-684d4240, ad849619…8b717, 19733)]    → SAME

output bytes (GET …/outputs/anime-clip-684d4240):
  before: HTTP 200, 32271 B document, sha256(content) = ad849619db660ad75d2a16e9ba7c638d393971ba9ae1b2c3d78ad96123e8b717
  after:  HTTP 200, 32271 B document, sha256(content) = ad849619db660ad75d2a16e9ba7c638d393971ba9ae1b2c3d78ad96123e8b717
  header x-sporta-artifact-source: r2 (both)                        → BYTE-IDENTICAL, R2-sourced
```

## What this proves (and what it honestly does not)

PROVEN (hosted, public URL, real browser, zero developer intervention):

- Neon identity: accounts + login sessions survive a redeploy (fresh
  sign-in AND the old cookie both resolve the same userId).
- The W921 durable control plane: a user-created session (here: the
  fixture-source durability probe) write-throughs to Neon and is
  reconstructed on a brand-new serverless instance after the redeploy —
  Library lists it, Watch serves it.
- The W912 R2 artifact store: the stored output survives the redeploy
  byte-identically and serves through the presigned, hash-verified
  delivery path.
- The Reality Switcher's URL-addressable selection survives the
  redeploy.

NOT PROVEN (blocked upstream, honestly): the recovery of an
upload-source session with four MP4 outputs — because the upload itself
is refused on this hosted runtime (no ffmpeg/ffprobe). That cell of the
acceptance remains open until the media toolchain runs somewhere the
hosted control plane can reach (the W914 http compute adapter with a
real worker, or a host whose runtime ships ffmpeg) — or the deployment
is moved to such a host. The recovery MACHINERY (identity + control
records + R2 artifacts) is proven by the probe above.
