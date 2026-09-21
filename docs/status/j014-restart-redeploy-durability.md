# J014 — Clean-Browser Restart/Redeploy Acceptance (Worker B, Wave 2)

Status: IMPLEMENTED — branch `work/j006b-j014-l006-l009`
Related: J007 (the durable control plane), W911 (the identity ports),
`docs/deployment/J007-local-durability-and-deployment-shapes.md` (the
documented gap this item closes), `docs/status/mvp-and-live-reality-status.md`

## What this item delivered

J007's deployment-shape analysis ended with the honest boundary: *"the
identity plane (accounts + login sessions) is not locally durable […] a REAL
process restart on the Bun shape […] recovers Library/Watch/catalog for the
reconstructed sessions but users must sign in again. Making identity locally
durable would require sqlite account/session stores (a possible follow-up)."*

J014 is that follow-up, plus the acceptance battery J007 could not run:

1. **`SqliteAccountStore` + `SqliteSessionStore`**
   (`apps/web/src/server/platform/identity/sqlite-{accounts,sessions}.ts`) —
   the `@sporta/identity` `AccountStore`/`SessionStore` ports over the real
   `bun:sqlite` engine (the W911 `Pg*Store` shapes, mirrored exactly):
   - accounts: durable monotonic `u-<n>` ids (a counter table), unique
     usernames, `AccountConflictError` on the documented paths, deep-clone
     in/out, full-row `update`;
   - sessions: ONLY SHA-256 token hashes stored (the service hashes before
     the store sees anything — a database dump can never be replayed),
     create/find/update semantics identical to the port;
   - WAL journal mode + 5s busy timeout (multi-connection safe — the
     composition opens accounts and sessions as two connections to one
     `SPORTA_IDENTITY_DB` file, default `db/identity.db`).

2. **The composition wiring** (`composition.ts` `buildSingleton`): under the
   real Bun runtime without `DATABASE_URL`, the identity plane now rides the
   same local-durable gate as the J007 control plane / ownership / media /
   compute-connection stores. The bundled Node runtime cannot construct it
   (the W911 shim refusal is caught → the honest in-memory fallback + the
   loud banner: users re-sign-in after a Node-runtime restart). Any OTHER
   construction failure fails LOUD. The hosted Neon gate (`DATABASE_URL`)
   remains the production shape, unchanged.

3. **The honest health surface** (`platform-health.ts`
   `identityPlaneOverrideOf`): `GET /api/platform/health` and the Operator
   Operations board now report the identity row from the RUNNING
   composition — `provider: "sqlite"`, `configured: true`, with a LIVE read
   through both real stores (accounts + token hashes; a corrupt file
   reports `error`, never "healthy"). The env-derived row (neon /
   in-memory) stands when the override does not apply.

4. **The REAL process-restart battery**
   (`apps/web/test/j014-restart-redeploy.test.ts` +
   `test/helpers/j014-journey.ts`): three REAL CHILD PROCESSES over one
   scratch directory — server and tests in ONE invocation (no detached
   background process for the sandbox reaper). See the evidence below.

## The battery (what it proves, and how)

- **Process A — the fresh deployment** (1.9s): boots the composition from
  the real env-gated path (all five durable planes pointed at the scratch
  files), registers an account through `POST /api/auth/register`, signs in
  through `POST /api/auth/login`, runs the REAL upload flow (a real
  ffmpeg-generated MP4 → the R101 boundary), dispatches a real
  `anime.prototype` render through the async compute plane, polls the job
  route to its terminal state, and records the render's content-addressed
  output hash. Then the process DIES.
- **Process B — the RESTART** (1.5s): a genuinely cold boot (no shared
  memory with A) over the same files:
  - `GET /api/auth/me` with A's STILL-OLD token → 200, the same userId
    (**the login session survived the process death**);
  - the owner's Library lists the session; Watch serves the SAME render
    with the SAME content hash; the output BYTES serve from durable
    storage;
  - `GET /api/platform/health` → `providers.identity = { provider:
    "sqlite", configured: true, check: { state: "ok", detail: "sqlite" } }`;
  - a FRESH sign-in with the SAME credentials → 200, a NEW token (the
    account row + password hash survived);
  - the honest per-instance boundary (W921/DEPLOYMENT.md §8): the cold
    instance's job-ledger list for the session is EMPTY (0) — never
    invented;
  - flips the publication to public (the W921 write-through).
- **Process C — the REDEPLOY** (1.3s): the ANONYMOUS catalog sees the
  now-public session; anonymous Watch serves the same content-addressed
  output; the owner's old token STILL resolves (identity durable across
  TWO boots); the owner's Library still lists the session.
- **Bytes-on-disk proof**: the battery opens `identity.db` directly and
  asserts the account row (username → userId), the OLD token's SHA-256 row,
  ≥2 session rows for the user (the pre-restart session + the fresh
  sign-in), and the control-plane session row.

Result: **4/4 tests, 38 assertions, green** (three real boots + the disk
proof, ~4.7s total).

The dev seed re-runs on every boot and is idempotent over the durable
identity (the `AccountConflictError` → reuse path the W911 Neon shape
already exercised): a reboot needs ZERO developer intervention — no manual
DB edits, no fixture sessions, no re-seeding.

## The in-memory-state audit of the public routes

Every public route family, its state backing, and its restart classification
(the acceptance's "no hidden in-memory dependency" audit — there is no
in-memory state on the public path whose loss is UNDISCLOSED):

| Route family | Backing (local Bun shape) | Restart classification |
| --- | --- | --- |
| `/api/auth/*`, `/api/platform/identity/*` | `db/identity.db` (J014) | **DURABLE** — accounts + login sessions survive; the browser's cookie still resolves |
| `/api/catalog/*` (sessions/library/search/realities) | `db/control-plane.db` + `db/media-platform.db` + `db/media-ownership.db` | **DURABLE** |
| `/api/watch/*` (+ outputs, realities) | control records + media bytes (local FS; R2 mirror when configured) | **DURABLE** — same render, same content hash, same bytes |
| `/api/create/*` (uploads, renders, publication, options, compute-status/preview) | media + control + ownership (sqlite) | **DURABLE**, one documented boundary: the compute-JOB ledger is per-instance (W921/DEPLOYMENT.md §8) — a cold instance's job list is empty, asserted in the battery |
| `/api/media/*` (assets/jobs/artifacts) | `db/media-platform.db` + `db/media-storage/` | **DURABLE** |
| `/api/account/compute/*` (the connection center) | `db/compute-connections.db` (J005) | **DURABLE** |
| `/api/rights/*` (policies, visibility, revocation, audit) | W921 write-through to the control records; the in-memory `PublicationStore`/`PolicyAttestationIndex`/`EffectivePolicyStore` are RECONSTRUCTED caches (a session miss re-seeds its recorded visibility + attestation) | **DURABLE** (write-through) — flips/revocations survive; caches rebuild |
| `/api/live/*` (SSE transport, replay) | in-memory transport state | **EPHEMERAL BY DESIGN** — live means live; seeded sources re-register at boot, the L014 replay record is per-instance (the documented boundary) |
| `/api/operations/*` (queues/health/jobs/audit/providers/live-telemetry) | reads through the real seams | **PER-INSTANCE BY DESIGN** — the L006 §9 counters start at zero on a fresh boot (honest: telemetry describes THIS instance's live window); queue depth is a live observation |
| `/api/capability`, `/` home | stateless reads | **STATELESS** |
| Transient state (rate-limit windows, the render queue) | in-memory locally / Upstash REST hosted | **PER-INSTANCE locally** (documented W913 shape; the hosted gate is Upstash) |

The Node-runtime (bundled) shape keeps the honest in-memory fallbacks with
the loud boot banners — the durability property is carried by the Bun
batteries (the W911 doctrine), and `/api/platform/health` reports the truth
per plane either way.

## Honest boundaries

- **Single-machine durability.** The sqlite files are one machine's files;
  the cross-instance/multi-server property is the hosted Neon/R2/Upstash
  gate (`DATABASE_URL` + `R2_*`), unchanged — this sandbox still has no
  credentials for those (the Wave 0 record).
- **One session row per boot for the seed account.** The dev seed issues
  its gate session on every boot; with durable sessions those rows
  accumulate (they expire by TTL and are never referenced again). Harmless,
  recorded here for completeness.
- **Pre-existing load-induced timeouts (not this item's regression).**
  Under a 7-file parallel `bun test` load, three known 5s-default-timeout
  tests (`golden-path`'s "Watch serves every one-shot reality's real
  bytes", `operations-console`'s two platform-snapshot tests, and J007's
  health-surface test) time out. Verified IDENTICAL on the pre-J014 tree
  (93 pass / 3 fail both before and after, same tests, same 5000ms
  timeouts); each passes in isolation post-change. This is the documented
  app-boot-under-load family from the environment notes.
