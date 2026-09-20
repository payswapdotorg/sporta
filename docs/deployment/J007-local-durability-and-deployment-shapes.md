# J007 — Local Durability Proofs and Deployment Shapes

Status: IMPLEMENTED (local substitutes); the hosted gate BLOCKED on credentials
Date: 2026-09-20 (Worker B, wave 1)
Related: `docs/deployment/DEPLOYMENT.md` §8 (W921), `docs/status/mvp-and-live-reality-status.md` (the external-dependency record), Journey 5 (`docs/testing/mvp-user-journey-simulation.md`)

## The situation this document records

The J007 acceptance is "durable public control plane": **Neon/R2 persistence;
create on instance A and read on instance B; redeploy does not erase
sessions/results; Library/Jobs/Watch recover without developer intervention.**

The Wave 0 record established that **no hosted Neon/R2 credentials exist in
the TL sandbox** — the hosted durability gate cannot run there. The frozen
deployment architecture places control-plane state in Neon PostgreSQL and
render-output artifacts in R2; this wave proves the SAME durability
boundary with LOCAL durable substitutes and records exactly which
deployment shapes can and cannot use them.

## What is now durable, and where

J007 closes the last per-process gaps in the composition so that a
configured backing actually persists the W921 write-through/reconstruct
path locally. Under the **real Bun runtime** (`bun:sqlite` genuinely
available) with `DATABASE_URL` unconfigured, the production singleton now
constructs:

| Plane | Backing (local durable) | File / env | Status |
|---|---|---|---|
| Control-plane records (sessions / renders / publication — W921) | `SqliteControlPlaneRecordStore` (NEW, mirrors `PgControlPlaneRecordStore` semantics exactly) | `SPORTA_CONTROL_DB` (default `db/control-plane.db`) | Durable |
| Media records (source assets / manifests / artifacts / jobs) | `SqliteMediaPlatformStore` (existing) | `SPORTA_MEDIA_DB` (default `db/media-platform.db`) | Durable (pre-existing) |
| Artifact bytes | `LocalFilesystemStorage` (existing) | `SPORTA_MEDIA_STORAGE` (default `db/media-storage`) | Durable (pre-existing) |
| Media ownership (the Library / owner-access axis) | `SqliteMediaOwnershipStore` (NEW, the `PgMediaOwnershipStore` port over `bun:sqlite`) | `SPORTA_OWNERSHIP_DB` (default `db/media-ownership.db`) | Durable |

The two new adapters live beside their hosted counterparts in the app
(`apps/web/src/server/platform/control/sqlite-records.ts`,
`apps/web/src/server/platform/identity/sqlite-ownership.ts`) — the
composition root is the only wiring point; no route or service changed.

`/api/platform/health` and the Operations health board now report the
RUNNING composition's actual control-plane backing (provider `sqlite`,
`configured: true`, with a LIVE read through the real store as the check)
instead of the env-derived "unconfigured" when the local durable path is
active. A `provider: "in-memory"` answer remains the honest unconfigured
state.

## The restart/redeploy evidence

`apps/web/test/j007-restart-recovery.test.ts` — three compositions over
the SAME four durable files, no in-memory stand-ins for the durable
planes:

1. **Instance A** runs the REAL upload flow (a real ffmpeg-generated MP4 →
   the R101 boundary → a real render through the async compute plane) and
   the write-through lands in the sqlite control/ownership files;
2. **The files are inspected directly** — the session row, the render row
   and the ownership row are REAL bytes on disk;
3. **Instance B (the RESTART)** — a composition that never saw A's
   in-process state — reconstructs the session through the W921 seams:
   the owner's **Library** lists it, **Watch** serves the SAME
   content-addressed output (determinism asserted per reconstruction),
   and the output BYTES serve from the durable storage;
4. **Instance B flips the publication** — the visibility write-through
   persists to the sqlite record;
5. **Instance C (the REDEPLOY)** — built after the flip — sees the
   session, its render, AND the public visibility: the anonymous catalog
   lists it and anonymous Watch serves the same output document. Nothing
   was erased;
6. The **Jobs** surface is asserted at its documented honest boundary
   (DEPLOYMENT.md §8): the compute-ledger job projections are
   per-instance; a cold instance's job list for a reconstructed session is
   empty — never invented. The durable render records (ids + result
   documents) ARE served cross-instance through `listRenders`/`getRender`.

No developer intervention, no manual database edits, no fixture sessions.

## Which deployment shapes can use the local durable path

### 1. A Bun-served runtime (the shape that gets FULL local durability)

Any deployment that serves the app **under the real Bun runtime** — e.g.
`bun --bun run start` / `bun --bun next dev` / a Bun container running the
Next.js server — resolves the REAL `bun:sqlite`, and the composition
constructs all four durable planes above. Restarts and redeploys on the
same volume keep every session/render/artifact/publication/ownership
record. This is a genuine single-machine durability boundary (one
process's files; no cross-machine sharing) — sufficient for a
self-hosted/preview deployment, NOT a multi-instance serverless claim.

### 2. The Node `next start` deployment (the W911 honest in-memory fallback)

The hosted Vercel-style deployment runs Next.js on **Node**. The bundler
aliases `bun:sqlite` to the loud W911 shim
(`apps/web/src/server/bun-sqlite-shim.ts`), so:

- constructing `SqliteMediaPlatformStore` / `SqliteControlPlaneRecordStore` /
  `SqliteMediaOwnershipStore` fails with the shim's message;
- the composition catches exactly that refusal and falls back to the
  in-memory stores **with a loud banner** (`[sporta] control-plane records
  are IN-MEMORY this run …`);
- every OTHER construction failure (a configured-but-broken path) fails
  LOUD — a durable path is never silently undurable.

So on the Node deployment, control-plane state, media records, ownership
and artifact bytes remain **per-instance in-memory** — exactly the W911
doctrine already documented for the media store. This is the honest
answer to "can the Node deployment use the local substitutes?": **no —
the runtime cannot load `bun:sqlite` at all.** The shapes that WOULD make
the Node deployment durable are:

- **the hosted path (the production shape):** `DATABASE_URL` (Neon) for
  identity + control records (migrations 0001 + 0002), `R2_*` for
  artifacts, Upstash for transient state — all already implemented behind
  their env gates (W910-W914, W921); **blocked on operator-supplied
  credentials**;
- **a Bun-served deployment** (shape 1 above).

### 3. The hosted Neon/R2 path (the production shape — BLOCKED here)

With `DATABASE_URL` set, the singleton uses the Neon-backed identity
stores + `PgControlPlaneRecordStore` (the W921 write-through/reconstruct
over PostgreSQL, migrations ensured) — the exact path DEPLOYMENT.md §8
documents as LIVE on the Vercel deployment. `R2_*` binds the hosted
artifact store. **This sandbox has no credentials for either**, which is
why the J007 final gate (cross-instance hosted durability on the real
deployment) remains open — the local-substitute evidence above proves the
boundary end-to-end on the same seams.

## Honest boundaries of the local proof

- **The identity plane (accounts + login sessions) is not locally
  durable.** Accounts and auth tokens ride the W911 Neon gate; locally
  they stay in-memory per process. The restart test shares the identity
  plane in-process (the same convention as the W921 decisive test — "what
  a durable deployment shares" through Neon). A REAL process restart on
  the Bun shape therefore recovers Library/Watch/catalog for the
  reconstructed sessions but users must sign in again. Making identity
  locally durable would require sqlite account/session stores (a possible
  follow-up; not required by the W921 path and not in this wave's scope).
- **Single-machine durability only.** The sqlite files are one machine's
  files; the cross-instance property is proven between compositions, not
  between networked servers. The hosted gate remains the production
  answer for multi-instance durability.
- **The compute-ledger job projections stay per-instance** (documented
  above, asserted in the test).

## The J007 final-gate blocker (exact evidence)

To close J007's hosted gate, the operator must supply:

1. a `DATABASE_URL` for a Neon PostgreSQL database (the W911 env id
   recorded in DEPLOYMENT.md §8), with migrations 0001 + 0002 applied
   (`bun run platform:migrate` in `apps/web`);
2. `R2_*` bindings (account id, access key id, secret, private bucket) for
   the W912 hosted artifact store.

With those configured, the existing W921/W912 seams activate with zero
code changes (the composition is the only wiring point); the acceptance
then re-runs on the real deployment: create on instance A, read on
instance B, redeploy does not erase.
