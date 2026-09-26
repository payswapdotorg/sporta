# R607 — Hosted acceptance evidence (deploy → golden path → redeploy → recovery)

Worker B · 2026-09-26 (the 2026-09-26 closure lanes, lane B —
`docs/status/lane-coordination.md`) · branch
`r607/hosted-acceptance-evidence` · base `0cc47ae` (origin/main).

## What this is

The hosted-acceptance proof shape executed for real on the hosted plane
(the lane note's "hosted run re-executes when credentials return" — the
VERCEL_TOKEN was supplied to this worker):

1. **deploy current main** to the hosted plane (Vercel Hobby, project
   `sporta`, public alias https://sporta-flame.vercel.app),
2. **fresh-browser golden path** through the PUBLIC URL (real Chromium,
   zero prior state): sign-up → Create/upload a REAL clip → rights →
   compute choice → processing → four outputs → Watch → Reality
   Switcher → Library/Jobs,
3. **redeploy** (a second, distinct deployment of the same revision),
4. **recovery proof** (fresh browser: same identity, same
   session/library/watch/artifacts).

Everything below is measured, nothing simulated; failures are recorded
with their exact classification (the anti-fabrication rule).

## Where the evidence lives

| Path | Content |
|---|---|
| `deployment.json` | the three deployment ids/urls/revisions/markers/timestamps + provider binding state + the identities |
| `golden-path/` | 16 stage screenshots + `journey-log.md` (routes, API responses, console errors, the honest failure record) |
| `recovery/` | 6 screenshots + `recovery-proof.md` (the recovery table + the byte-level before/after comparison) |
| `commands.md` | the verbatim command classes executed |
| `../…/apps/web/src/instrumentation-node.ts` + `../…/apps/web/test/instrumentation-node-shim.test.ts` | the ONE flagged product-code change (see below) — committed on this branch |

## RESULTS — the acceptance table (step → evidence pointer)

| Acceptance step | Result | Evidence |
|---|---|---|
| 1a. Deploy current main (0cc47ae) | **DEPLOYED — and DEFECTIVE**: build Ready in 54s (`dpl_6s7jN8Y8…`, marker `r607-deploy-1`) but EVERY API route answered HTTP 500 (`TypeError: Bun.which is not a function` at composition boot; shell pages 200) | `deployment.json` deploy[0]; Vercel runtime log quoted in `golden-path/journey-log.md` |
| 1b. Minimal fix (flagged) + deploy | **DEPLOYED, HEALTHY**: `dpl_4h5AQfUq…` (`r607-fix-1`) — health 200, identity neon/ok, artifacts r2/ok, controlPlane neon/ok | `deployment.json` deploy[1]; health JSON in `commands.md` §4 |
| 2a. Fresh-browser sign-up | **PASS** (200; `userId u-da57c68…`, Neon-backed; auto sign-in → Library) | `golden-path/02-signup-success-library.png` |
| 2b. Create → upload a REAL clip | **REFUSED AT ADMISSION (typed, honest)** — `POST /api/create/upload-sessions` → 500; server cause: `UnsupportedMediaError: ffprobe executable not found on PATH` (`media-invalid`, nothing stored) — **the hosted Node runtime ships no ffmpeg/ffprobe** | `golden-path/08-upload-refused-honest-error.png`; the log excerpt in `journey-log.md` |
| 2c. Rights declaration + derived preview | **PASS** (operations declared; derived preview ALLOWED render/store) | `golden-path/04-rights-step.png` |
| 2d. Compute choice | **PASS** (in-process plane `sporta.compute.hosted`, sporta-auto, auditable) | `golden-path/06-compute-step.png` |
| 2e. Processing + four outputs (Original/Tactical/3D-Game/Anime) | **BLOCKED UPSTREAM** — the honest states measured: derived realities "not offered: no producer … (the derived-reality encode plane is absent) — never invented"; the upload's Original normalization needs the same absent toolchain | `golden-path/05-realities-honest-unavailable.png`; `journey-log.md` |
| 2f. Watch (real MP4 playback of the four outputs) | **BLOCKED UPSTREAM** (no session exists — the admission stored nothing by design) | `journey-log.md` |
| 2g. Reality Switcher (same session, URL-addressable) | **PASS (on the supplementary durability-probe session)** — `…&reality=anime-npr` / `?reality=tactical`, session constant | `golden-path/12–14`-series screenshots; `recovery/04` |
| 2h. Library/Jobs | **PASS (honest states)** — Library lists the probe session; Jobs shows the documented per-instance ledger boundary ("0 sessions with dispatched jobs" — never invented) | `golden-path/15-library-lists-session.png`, `16-jobs-listing.png` |
| 3. Redeploy (distinct new deployment, same revision) | **PASS** — `dpl_9xhz2W7H…` (`r607-fix-2`), Ready in 25s, alias serving, marker verified | `deployment.json` deploy[2] |
| 4. Recovery: identity | **PASS** — fresh browser + fresh sign-in → SAME `userId u-da57c68…`; the pre-redeploy cookie ALSO resolves on the new deployment | `recovery/01`, `recovery-proof.md` |
| 4. Recovery: session/library | **PASS (probe session)** — library rows 1 before / 1 after, same id+label; watch 200, same renderId | `recovery/05`, `recovery-proof.md` |
| 4. Recovery: watch playable | **PASS (probe session's review-format artifact — frame player)**; the four-MP4 watch remains blocked upstream | `recovery/02–03` |
| 4. Recovery: artifacts | **UNCHANGED** — same segment id + contentHash, sha256(served bytes) == declared hash BEFORE and AFTER, `x-sporta-artifact-source: r2` both times | `recovery/recovery-proof.md` (byte-level table) |
| 4. Recovery: upload-session artifacts | **BLOCKED UPSTREAM** (none could be created — see 2b/2e) | `recovery/recovery-proof.md` |
| Console errors (both browsers, all stages) | **0** | both logs |

## The verdict line (honest)

**The hosted control plane (Vercel Hobby + Neon identity + Neon durable
control plane + R2 artifacts) is deployed, healthy and RECOVERY-PROVEN
across a redeploy (identity, session, library, watch, artifacts —
byte-identical, zero developer intervention); the four-reality
upload→MP4 golden path CANNOT execute on this hosted plane because the
Vercel Hobby Node serverless runtime ships no ffmpeg/ffprobe — the real
media pipeline (R101 admission + R207 decode + R306/R508 encodes) fails
closed with typed, honest refusals, so the R607 hosted acceptance is
MEASURED-BLOCKED at the media-toolchain boundary (classification:
runtime-toolchain-absent), not at identity/durability.**

## Known classes / findings

1. **[defect-fixed, flagged] `Bun.which` on the hosted Node runtime.**
   Raw main's composition crashed at boot (all API routes 500) because
   the R306/R508-era probes call `Bun.which`, which the W911 Node-runtime
   compat shim (`apps/web/src/instrumentation-node.ts`) did not cover.
   The ONE product-code change on this branch extends that existing shim
   seam with a Node-backed `which` (+ the regression test
   `apps/web/test/instrumentation-node-shim.test.ts`, 7/7; api-routes
   15/15, golden-path 14/14, typecheck clean). The TL audits this
   change separately per the work-item rules; it is minimal (one seam,
   the repo's own documented pattern), and no other product code was
   touched.
2. **[measured blocker] No ffmpeg/ffprobe on the hosted runtime.** The
   upload golden path and the derived-reality MP4 plane are honestly
   unavailable hosted (the app degrades exactly as designed — typed
   admission refusals, producer-unavailable reasons, loud boot banners;
   nothing faked, nothing stored on refusal). Closing this requires a
   compute tier the hosted control plane can dispatch to (the W914
   `http` compute adapter against a real worker with the toolchain) or
   a host whose runtime ships ffmpeg — a work item beyond R607's
   evidence scope (and beyond the Hobby tier's documented
   beta-personal boundary).
3. **[documented boundary, observed as designed]** Node-runtime
   in-memory fallbacks: media records, url-source registrations, compute
   connections, analyst annotations (bun:sqlite absent on Node — the
   W911 doctrine's loud banners; the hosted Neon control-plane +
   identity carry the durability that R607 proves).
4. **[documented boundary, observed as designed]** The compute-JOB
   ledger is per-instance: a fresh instance lists "0 sessions with
   dispatched jobs" for a recovered session (W921 §honest boundaries —
   never invented).
5. **[observation]** The pre-redeploy browser cookie resolves on the
   post-redeploy deployment (W911's cross-deployment session-survival
   pattern still holds on the fixed revision).
6. **[observation]** This worker sandbox's egress differs from the TL
   sandbox: api.vercel.com AND console.neon.tech are both reachable
   (HTTP 302 on the console) — the TL sandbox's documented HTTP-000
   Neon/upstash blocks do not apply here; provider state was verified
   through the app's own health endpoint either way (per the task
   packet's guidance).

## Commands

See `commands.md` (verbatim classes; the deploy command differs from
the runbook only by explicit `--project/--scope` because a fresh clone
has no `.vercel/` link — the project itself was REUSED, not
reprovisioned, with all env bindings intact).

## Credentials discipline

VERCEL_TOKEN and GH_TOKEN were env-only (`~/.secrets/env.sh`, outside
the repository); never echoed into logs, never committed (the committed
tree was scanned for token prefixes before the push — zero matches).
Values that must never appear in this directory: the Vercel token, the
GitHub token, the Neon DSN, the R2 keys, session cookie values (the
recovery tokens used above are single-session beta credentials bound to
the disposable acceptance identities; they are recorded only as opaque
references in the worker's scratch space, not committed).
