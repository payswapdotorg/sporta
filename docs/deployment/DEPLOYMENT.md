# Sporta Hosted Deployment Runbook (W910)

Checked: 2026-09-16 (W911 flight 5). Status: **OPERATIONAL** — the app
and the Neon-backed identity persistence described below are deployed and
serving from this repository configuration alone (plus a `VERCEL_TOKEN`; the
Neon binding is one `DATABASE_URL` project env var).

## What is deployed

`apps/web` — the Sporta Next.js 16 product shell (W903) plus the hosted-platform
composition root (W910–W913 seams; **W911 Neon identity persistence and W912 R2
artifact storage are LIVE** — accounts/sessions/ownership in Neon PostgreSQL when
`DATABASE_URL` is bound; seeded render outputs mirrored to the private R2 bucket
`sporta-beta-artifacts` when the `R2_*` bindings are present, with playback
reading them back via short-lived presigned delivery; transientState stays
in-memory until W913).
The deployment is a **standard Next.js build**: repository-root `bun install`
(monorepo workspaces), `next build` in `apps/web`, no exotic output modes.

- **Host**: Vercel **Hobby** plan, scope `ekonplacidegmailcoms-projects`
  (personal account `ekonplacide-5312`).
- **Host policy boundary** (docs/architecture/deployment-architecture.md): the
  Vercel Hobby tier is **personal / non-commercial only** under Vercel's current
  terms. This deployment is the `beta-personal` environment — development,
  demos, and non-commercial beta validation. It must not be represented as the
  commercial production target; commercial operation requires a plan whose terms
  permit it, or migrating `apps/web` to another host without changing domain
  contracts.
- **Public URL (production alias)**: <https://sporta-flame.vercel.app>
  (Vercel assigned this alias because `sporta.vercel.app` is taken; per-run
  deployment URLs look like
  `https://sporta-<hash>-ekonplacidegmailcoms-projects.vercel.app`).

## Repository configuration (already committed — nothing else needed)

| File | Role |
|---|---|
| `.vercelignore` (repo root) | Upload boundary for the repo-root deploy. Keeps the workspace dependency closure (`packages/contracts`, `packages/capability`, `packages/identity`, runtime `packages/output-pipeline`); drops `docs/`, `tests/`, `**/node_modules`, `**/.next`, tests, scripts, logs. |
| `apps/web/vercel.json` | `framework: nextjs`, `installCommand: bun install` (bun walks up to the workspace root), `buildCommand: next build`, `regions: ["iad1"]`. |
| `apps/web/.gitignore` | Keeps CLI link artifacts (`.vercel/`, `.env*`) out of the repo. |

Project settings that live on the Vercel side (re-created by the provisioning
step below): project name `sporta`, **Root Directory `apps/web`**,
framework `nextjs`, node 24.x.

## Credentials discipline

The only secret is `VERCEL_TOKEN` (kept in `~/.secrets/env.sh`; never echoed,
printed, or committed). W911–W913 provider credentials (Neon/R2/Upstash) will be
added as **Vercel project env vars** — never committed. The app itself reads
provider configuration exclusively through
`apps/web/src/server/platform/env.ts`, which surfaces only availability
booleans and non-secret descriptors.

## 1) Provision (once per project)

```bash
. ~/.secrets/env.sh                       # exports VERCEL_TOKEN
TEAM=team_4KOoA5CgtYaOF85yFXPeMXLt        # the scope's team id

# create the project (in the CLI's current scope)
bunx vercel project add sporta --token "$VERCEL_TOKEN"

# set Root Directory + framework (dashboard equivalent: Project Settings → General)
curl -s -X PATCH -H "Authorization: Bearer $VERCEL_TOKEN" \
  "https://api.vercel.com/v9/projects/sporta?teamId=$TEAM" \
  -H "Content-Type: application/json" \
  -d '{"rootDirectory":"apps/web","framework":"nextjs"}'
```

## 2) Configure environment variables

Non-secret deployment tier + marker (values visible in the dashboard, `type:
encrypted` via API — `vercel env add` works too, but it prompts interactively
for branch scoping; the REST calls are deterministic):

```bash
for kv in \
  '{"key":"SPORTA_DEPLOY_ENV","value":"beta-personal","type":"encrypted","target":["production"]}' \
  '{"key":"SPORTA_DEPLOY_ENV","value":"preview","type":"encrypted","target":["preview"]}' \
  '{"key":"SPORTA_DEPLOY_ENV","value":"local","type":"encrypted","target":["development"]}' \
  '{"key":"SPORTA_DEPLOY_MARKER","value":"<marker-for-this-deployment>","type":"encrypted","target":["production"]}' ; do
  curl -s -X POST -H "Authorization: Bearer $VERCEL_TOKEN" \
    "https://api.vercel.com/v10/projects/sporta/env?teamId=$TEAM" \
    -H "Content-Type: application/json" -d "$kv"
done
```

W911's `DATABASE_URL` and W912's `R2_*` bindings are **LIVE** (production
target — see §6/§7); W913's Upstash bindings remain a **documented placeholder
only** until that flight runs (add them the same way, production target):

| Env var | Flight | Meaning |
|---|---|---|
| `DATABASE_URL` | W911 ✅ live | Neon PostgreSQL connection string (secret) |
| `R2_S3_ENDPOINT` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET_NAME` / `R2_BUCKET_REGION` | W912 ✅ live (endpoint+keys+bucket name set; region unset = `auto`) | Cloudflare R2 S3-compatible bindings (keys secret; bucket name/region are not) |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | W913 | Upstash Redis REST bindings (token secret) |
| `SPORTA_SESSION_COOKIE_DOMAIN` | W911+ | Cookie domain override for named hosts (unset for `*.vercel.app`) |

Every provider is **optional at runtime** (`env.ts`): an unset binding degrades
honestly to the in-memory fallback and `/api/platform/health` reports it
`unconfigured` — deploying the shell never requires live provider credentials.

### Environment separation (docs/architecture/deployment-architecture.md)

| Tier | `SPORTA_DEPLOY_ENV` | Where | Providers |
|---|---|---|---|
| `local` | `local` (default when unset) | `bun dev` / `bun run start` on the workstation | in-memory only |
| `preview` | `preview` | Vercel preview deployments | per-preview, currently unconfigured |
| `beta-personal` | `beta-personal` | **the production deployment** (this runbook) | Neon + R2 + Upstash once W911–W913 land |

`production` (commercial) is a later, explicitly-permitted host/plan change —
same contracts, replaceable bindings.

## 3) Deploy

```bash
. ~/.secrets/env.sh
cd <repo root>                            # the worktree/repo root, NOT apps/web
bunx vercel deploy --prod --yes --token "$VERCEL_TOKEN"
```

Deploy from the **repository root**: the Root Directory is `apps/web`, so the
CLI uploads the repo root (minus `.vercelignore`), installs with bun at the
workspace root, and builds `next build` inside `apps/web`. (Deploying from
inside `apps/web` uploads only the subdirectory and then fails with
`The specified Root Directory "apps/web" does not exist` — the one gotcha
recorded from the first attempt.)

`SPORTA_DEPLOY_MARKER` applies to **new** deployments only — set it before
deploying (update the existing variable):

```bash
curl -s -X PATCH -H "Authorization: Bearer $VERCEL_TOKEN" \
  "https://api.vercel.com/v10/projects/sporta/env/<marker-env-id>?teamId=$TEAM" \
  -H "Content-Type: application/json" \
  -d '{"value":"<new-marker>","type":"encrypted","target":["production"]}'
```

Recorded deploy evidence (2026-09-16, code state 63e4e60 + 614ebcd):

- Deploy 1: `https://sporta-j4swv6nom-ekonplacidegmailcoms-projects.vercel.app`
  (`dpl_5uarPfq8aStZt1gKWDaZRnn1wGKs`, marker `w910-prod-1`) — 31s, Ready.
- Deploy 2: `https://sporta-malycyv3s-ekonplacidegmailcoms-projects.vercel.app`
  (`dpl_5uGQBDinxmoFPhtKKhvLcDR6Vc8R`, marker `w910-prod-2`).
- Deploy 3: `https://sporta-jh45r45py-ekonplacidegmailcoms-projects.vercel.app`
  (marker `w910-614ebcd`) — the W910 final.
- W911 deploy 4 (marker `w911-a`, `DATABASE_URL` bound):
  `https://sporta-qom12upz6-ekonplacidegmailcoms-projects.vercel.app`.
- W911 deploy 5 (marker `w911-b`, **the deployment the production alias
  currently serves**):
  `https://sporta-2m0a61jbj-ekonplacidegmailcoms-projects.vercel.app`.

## 4) Verify

From a clean network position (curl; a clean browser is equivalent):

```bash
curl -sS -o /dev/null -w "%{http_code}\n" https://sporta-flame.vercel.app/
#   → 200
curl -sS https://sporta-flame.vercel.app/ | grep -c -E "Sporta|skip-link|manifest\.webmanifest"
#   → ≥1 (shell HTML markers present)
curl -sS -o /dev/null -w "%{http_code} %{content_type}\n" https://sporta-flame.vercel.app/manifest.webmanifest
#   → 200 application/manifest+json; charset=utf-8
curl -sS -o /dev/null -w "%{http_code} %{content_type}\n" https://sporta-flame.vercel.app/sw.js
#   → 200 application/javascript; charset=utf-8
curl -sS https://sporta-flame.vercel.app/api/platform/health
#   → JSON: env "beta-personal", deployMarker <current marker>, identity
#     neon/configured (W911), artifacts r2/configured with bucket detail
#     "sporta-beta-artifacts" (W912), transientState honestly "unconfigured"
#     until W913 wires the Upstash bindings
```

Actual W910 verification lines:

```
/                  → 200 (39847 B)
/manifest.webmanifest → 200 application/manifest+json; charset=utf-8
/sw.js             → 200 application/javascript; charset=utf-8
shell HTML contains: Sporta, skip-link, manifest.webmanifest link
/api/platform/health → {"env":"beta-personal","deployMarker":"w910-614ebcd",...,
                        providers: identity/artifacts/transientState = in-memory, unconfigured}
```

## 5) Rollback (Vercel instant rollback / promote)

```bash
. ~/.secrets/env.sh
# roll the production alias back to a previous deployment
bunx vercel rollback <deployment-url> --yes --token "$VERCEL_TOKEN"
# or promote a specific deployment forward again
bunx vercel promote <deployment-url> --yes --token "$VERCEL_TOKEN"
# list candidate deployments
bunx vercel ls sporta --token "$VERCEL_TOKEN"
```

(The three prod deployments above make good rollback candidates: deploy 1 =
marker `w910-prod-1`, deploy 2 = `w910-prod-2`, deploy 3 = `w910-614ebcd`.)

Rollback switches the production alias to the chosen deployment **instantly**
(no rebuild — the old immutable deployment is still warm). Recorded W910
evidence (markers are curl-visible via `/api/platform/health`):

```
alias → deploy 2:            health deployMarker = "w910-prod-2"
vercel rollback deploy-1:   Success! sporta was rolled back to
                            sporta-j4swv6nom-…vercel.app (dpl_5uarPfq8aStZt1gKWDaZRnn1wGKs) [2s]
alias → deploy 1:           health deployMarker = "w910-prod-1"; / , /manifest.webmanifest, /sw.js all 200
vercel promote deploy-2:    Success! sporta was promoted to
                            sporta-malycyv3s-…vercel.app (dpl_5uGQBDinxmoFPhtKKhvLcDR6Vc8R) [2s]
alias → deploy 2 (then 3): health deployMarker = "w910-prod-2" (then "w910-614ebcd")
```

Current production state (verified 2026-09-16, after W912):

```
https://sporta-flame.vercel.app/                   → 200 (Sporta + skip-link in HTML)
https://sporta-flame.vercel.app/manifest.webmanifest → 200 application/manifest+json; charset=utf-8
https://sporta-flame.vercel.app/sw.js              → 200 application/javascript; charset=utf-8
/api/platform/health → env "beta-personal", deployMarker "w912-b",
                       identity = neon / configured / check ok ("postgres"),
                       artifacts = r2 / configured / check ok ("sporta-beta-artifacts"),
                       transientState = in-memory / unconfigured
```

## 6) W911 — Neon PostgreSQL identity persistence (LIVE)

Identity state (accounts, sessions, media-session ownership) persists in
**Neon PostgreSQL** (free tier) — it survives deploys, cold starts, and browser
restarts. Everything below is the reproducible procedure.

### 6.1) Provision (once per project)

The Neon REST v2 API is org-scoped: plain `GET /api/v2/projects` answers
`org_id is required`. Discover the account's organizations first:

```bash
. ~/.secrets/env.sh   # exports NEON_API_KEY (never echoed/committed)
curl -sS "https://console.neon.tech/api/v2/users/me/organizations" \
  -H "Authorization: Bearer $NEON_API_KEY" \
  -H "Origin: https://console.neon.tech"
# → {"organizations":[{"id":"org-proud-truth-25823860","name":"webflix",...}, ...]}
```

Then create the project inside an org (or list existing ones with
`GET /api/v2/projects?org_id=<org id>` — the free tier allows 10 per org):

```bash
curl -sS -X POST "https://console.neon.tech/api/v2/projects?org_id=<org id>" \
  -H "Authorization: Bearer $NEON_API_KEY" \
  -H "Origin: https://console.neon.tech" -H "Content-Type: application/json" \
  -d '{"project":{"name":"sporta-beta","region_id":"aws-us-east-1","pg_version":"17"}}'
```

Recorded state: project **`sporta-beta`** (id `restless-dream-12397247`),
org `webflix` (`org-proud-truth-25823860`), region `aws-us-east-1`, PostgreSQL 17,
created 2026-09-16T00:21:41Z by the W911 flight 4 (it died before deploying).

Fetch the connection string (the DSN is a **secret** — store it only in shell
env / the Vercel project env; never print or commit it):

```bash
curl -sS "https://console.neon.tech/api/v2/projects/restless-dream-12397247/connection_uri?database_name=neondb&role_name=neondb_owner&pg_version=17" \
  -H "Authorization: Bearer $NEON_API_KEY" \
  -H "Origin: https://console.neon.tech"
# → {"uri":"postgresql://<role>:<password>@ep-…-pooler.c-12.us-east-1.aws.neon.tech/neondb?…"}
```

(The host is the Neon **pooler** endpoint — correct for serverless connection
counts. The `postgres` client caps its pool at `max: 3`.)

### 6.2) Environment wiring (Vercel)

```bash
curl -sS -X POST -H "Authorization: Bearer $VERCEL_TOKEN" \
  "https://api.vercel.com/v10/projects/sporta/env?teamId=$TEAM" \
  -H "Content-Type: application/json" \
  -d '{"key":"DATABASE_URL","value":"<the DSN>","type":"encrypted","target":["production"]}'
```

Recorded: env id `sDD0xKHWe4sBlInJ`, production target, set 2026-09-16.
`apps/web/src/server/platform/env.ts` is the ONLY reader; unbinding it degrades
honestly to the in-memory stores and `/api/platform/health` reports
`in-memory` / `unconfigured`.

### 6.3) Migrations (the deployed procedure)

```bash
cd apps/web
DATABASE_URL="<the DSN>" bun run platform:migrate
```

Output recorded on 2026-09-16: `no pending migrations (schema is current)`
— migration `1: identity-accounts-sessions-ownership` had already been applied
by flight 4 at 00:22:11Z (verified in the table: `sporta_accounts`,
`sporta_sessions`, `sporta_media_ownership`, `sporta_schema_migrations`).
The runner is idempotent, one transaction per migration, guarded by
`pg_advisory_xact_lock` so concurrent serverless instances cannot race, and the
runtime composition (`identityReady()`) re-ensures the schema once per instance —
so a fresh project needs **no manual step at all**; the first request migrates it.

### 6.4) Schema change / rollback policy (honest)

- Migrations are **forward-only and additive by design** (`CREATE TABLE IF NOT
  EXISTS`, `CREATE INDEX IF NOT EXISTS`, new columns/tables via new numbered
  migrations). No `down` migrations exist: rolling back an APPLICATION deployment
  never rolls back the database, and old code must keep running against the new
  schema (that is what additive-only guarantees).
- Un-applying a migration requires deleting data (e.g. `DROP TABLE` by hand
  against the Neon console/SQL). For the `beta-personal` tier the honest answer
  is: **do not do this** — the database is disposable dev/beta state; recreate
  the project (§6.1) and re-run §6.2–6.3 if the schema must be reset.
- Every migration's version is recorded in `sporta_schema_migrations`; the
  registry (`PLATFORM_MIGRATIONS`) is version-sorted and pinned by test.

### 6.5) Verification evidence (2026-09-16, public URL)

```
bun test apps/web/test/platform/neon-persistence.test.ts   # with DATABASE_URL
  → 5 pass / 0 fail / 18 expect() calls / Ran 5 tests across 1 file [28.8s]
   (register→fresh-login, session survives store recreation, tokens stored
    HASHED (sha256; token never in the table), expired sessions fail closed,
    revocation persists across store recreation; without DATABASE_URL the suite
    SKIPs loudly — root battery stays green: 4520 pass / 0 fail / 7 skip)

/api/platform/health (deployment w911-a, then w911-b):
  identity.provider = "neon", configured = true,
  identity.check = { state: "ok", detail: "postgres" }      ← live reachability

register on w911-a:  POST /api/auth/register {"username":"w911-persist-probe",…}
  → 200 {"userId":"u-ecef93eb1ada43b48474aae8c42a705f","username":"w911-persist-probe",…}
login on w911-a:     POST /api/auth/login   → 200 + HttpOnly cookie
me on w911-a:        GET  /api/auth/me      → 200 (same userId)
REDEPLOY (w911-b — separate prod deployment, new marker):
login SAME credentials on w911-b → 200, SAME userId u-ecef93eb1ada43b48474aae8c42a705f
me with the w911-a SESSION COOKIE against w911-b → 200 (session survived the redeploy)
duplicate register → 409 {"failureClass":"conflict",…}
wrong password      → 401 {"failureClass":"auth-invalid","invalid username or password"}
```

That is the W911 acceptance: hosted auth/session state persists across
**deploys** (two separate production deployments) and browser sessions
(cookie-issued on one resolves on the other), backed by real PostgreSQL rows.

## Honest limitations (W911 state)

- Identity is Neon-backed, but ONLY identity: render outputs / control-plane
  render records / catalog state are still **in-process dev-seed state**
  (restart-wiped) until W912 (R2 artifacts) / W914 (hosted compute) / the
  A-lane product-surface merges land and are redeployed. Health reports the
  artifacts/transientState seams `in-memory` / `unconfigured` — honest.
- The Neon project lives on the **free tier** (autosuspend + a shared compute
  unit): the first query after a suspend pays a cold-start (~0.5–2 s). The
  integration tests' WAN timeouts (30 s per test) exist for cross-region runs
  (e.g. an Asia-Pacific sandbox against the us-east-1 database).
- The production alias on the Hobby plan is personal/non-commercial (see host
  policy boundary above).
- Deploys are CLI-driven (no Git integration connected yet — `vercel git
  connect` is a later hardening step; CI/CD via GitHub is not required).
- The registered probe account (`w911-persist-probe`) intentionally remains in
  the database as living persistence evidence; delete it (SQL or a future admin
  surface) if the beta database must be cleaned.

## 7) W912 — Cloudflare R2 artifact storage (LIVE)

Render-output artifacts persist in a **private** Cloudflare R2 bucket; the
browser never receives an unsigned object URL — delivery is short-lived
presigned GETs issued only behind the authorized playback path.

### 7.1) Provision (once per account)

The bucket was provisioned 2026-09-16T02:12:16Z via the Cloudflare REST API
(`CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` from `~/.secrets/env.sh`;
values never echoed):

```bash
. ~/.secrets/env.sh
curl -s -X POST "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/r2/buckets" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"sporta-beta-artifacts"}'
# → {"success":true,...,"result":{"name":"sporta-beta-artifacts",
#     "creation_date":"2026-09-16T02:12:16.632Z","location":"APAC",
#     "storage_class":"Standard","jurisdiction":"default"}}

curl -s "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/r2/buckets" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN"   # verify listing
```

The S3 API keys (`R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`) and the endpoint
(`R2_S3_ENDPOINT` = `https://<account>.r2.cloudflarestorage.com`) pre-existed in
`~/.secrets/env.sh` from the W910 flight and are bucket-scoped credentials
created in the Cloudflare dashboard (R2 → Manage API tokens). They are stored
ONLY in the shell env + the Vercel project env — never echoed, never committed.

The bucket stays **PRIVATE by construction**: no custom domain, no public
bucket access, no managed public hostname is attached. Every read goes through
SigV4 (header-signed or query-presigned).

### 7.2) What talks to R2 (the implementation)

- `apps/web/src/server/platform/r2/sigv4.ts` — hand-rolled AWS SigV4 over
  `node:crypto` (~120 lines, no AWS SDK: the hosted app keeps the repo's
  no-dep posture; the engine-side exception for infra clients was not
  needed). Two forms: `signAwsRequest` (header-signed PUT/GET/DELETE) and
  `presignGetUrl` (query-signed, `X-Amz-Expires`-bounded GET).
- `apps/web/src/server/platform/r2/r2-store.ts` — `R2RenderOutputStore`, the
  W504 render-output store semantics over S3 objects: idempotent stores with
  COUNTED duplicates, fail-loud `SegmentConflictError` on same-key/different-
  content, W504 bounds (1000 segments / 16 MiB per segment / 256 MiB total),
  rights-gated retrieval (`canStoreDerivatives` re-derived fail-closed BEFORE
  existence), read-side integrity re-verification (byte length + sha-256).
  Object layout: `render-outputs/<sessionId>/<renderId>/<segmentId>.json` +
  per-scope `index.json` + global `_stats.json`.
- `apps/web/src/server/platform/r2/hosted.ts` — env-gated singleton (the W911
  pattern): absent bindings → `null` → honest `in-memory` in health.
- `apps/web/src/server/platform/r2/playback.ts` — the server-side presigned
  fetch + verification against the playback-gated record.
- `apps/web/src/server/dev-seed.ts` — when R2 is configured, every seeded
  output is MIRRORED to the bucket (fail-closed: a configured R2 that rejects
  the mirror fails the seed loudly; deterministic encode ⇒ same segment id
  and hash as the pipeline's own record, asserted not trusted).

### 7.3) Environment wiring (Vercel)

Set 2026-09-16 via REST v10 (production target; ids `bTCtaGoATqdk26ee`
endpoint, `2Nt9lOHxQQC45Kbn` access key, `cNrKIS3sGRZSuQer` secret key,
`2sMoAOWd7FjtCrlk` bucket name):

```bash
for kv in \
  "{\"key\":\"R2_S3_ENDPOINT\",\"value\":\"$R2_S3_ENDPOINT\",\"type\":\"encrypted\",\"target\":[\"production\"]}" \
  "{\"key\":\"R2_ACCESS_KEY_ID\",\"value\":\"$R2_ACCESS_KEY_ID\",\"type\":\"encrypted\",\"target\":[\"production\"]}" \
  "{\"key\":\"R2_SECRET_ACCESS_KEY\",\"value\":\"$R2_SECRET_ACCESS_KEY\",\"type\":\"encrypted\",\"target\":[\"production\"]}" \
  "{\"key\":\"R2_BUCKET_NAME\",\"value\":\"sporta-beta-artifacts\",\"type\":\"encrypted\",\"target\":[\"production\"]}" ; do
  curl -s -X POST -H "Authorization: Bearer $VERCEL_TOKEN" \
    "https://api.vercel.com/v10/projects/sporta/env?teamId=ekonplacidegmailcoms-projects" \
    -H "Content-Type: application/json" -d "$kv"
done
# (R2_BUCKET_REGION is intentionally unset — the store signs region "auto",
#  which is what R2 reports.)
```

Removing the bindings degrades honestly: the composition falls back to the
in-process pipeline store and health reports `artifacts: in-memory,
unconfigured` (the W911 pattern — verified pre-W912).

### 7.4) Access-control flow (the core requirement)

```
 browser                watch route (/api/watch/…/outputs/[segmentId])
    │ GET                          │
    │─────────────────────────────▶│ 1. CONTROL-PLANE PLAYBACK GATE (W902/W701):
    │                              │    control.getRenderOutput() re-derives the
    │                              │    session's rights fail-closed; 403 BEFORE
    │                              │    existence, unknown render → 404.
    │                              │ 2. (R2 configured) presign a 60 s GET
    │                              │    server-side; fetch; verify sha-256 +
    │                              │    byte length against the GATED record.
    │                              │    Unreachable → honest 503; tampered → 500.
    │◀── 200 JSON + x-sporta-artifact-source: r2 ──┘   (never an object URL)
    │
    │ GET /api/platform/render-outputs/[sessionId]/[renderId]/[segmentId]
    │─────────────────────────────▶ identity session (401) → valid rights
    │                              │ policy header (403 before existence) →
    │                              │ owner/operator when owned (uniform 403) →
    │                              │ store rights gate (defense in depth) →
    │                              │ 404 when absent → ONLY THEN a 5-minute
    │                              │ presigned URL is issued (browser fetches
    │                              │ the private object through it).
    │
    │ unsigned direct object URL ($R2_S3_ENDPOINT/sporta-beta-artifacts/…)
    │─────────────────────────────▶ R2 refuses: 400 InvalidArgument
    │                              │ (Authorization) — no bytes, ever.
    │ expired/tampered presign ───▶ R2 refuses: 403 ExpiredRequest /
    │                              │ SignatureDoesNotMatch — no bytes, ever.
```

### 7.5) Verification evidence (2026-09-16, real bucket + public URL)

Real-bucket integration tests (WITH the R2 env; without it the suite SKIPs
loudly and the root battery stays green):

```
. ~/.secrets/env.sh
bun test apps/web/test/platform/r2-artifacts.test.ts
  → 7 pass / 0 fail / 22 expect() calls / Ran 7 tests across 1 file [5.09s]
     1. store → presigned GET round-trip returns byte-identical content
     2. unsigned direct object URL is refused (400; body never contains the artifact)
     3a. expired presign is refused (403 ExpiredRequest)
     3b. tampered presign signature is refused (403)
     4. listing + manifest reads (verbatim manifest, counted duplicates,
        conflict fail-loud SegmentConflictError)
     5. retrieval without derivative rights denies before existence
     6. deletion removes the object (idempotent)
```

Composition tests (env-independent, in-process S3-compatible fake):

```
bun test apps/web/test/r2-playback.test.ts
  → 5 pass / 0 fail / 18 expect() calls / Ran 5 tests across 1 file [0.35s]
     (seed mirror, watch route serves R2-sourced byte-identical bytes,
      outage → honest 503, tampering → honest 500, unconfigured → in-memory
      honestly labeled)
```

Public URL (deployments w912-a = sporta-kdia19nor-… and w912-b =
sporta-o5wou4xml-…; the alias serves w912-b):

```
/api/platform/health
  → deployMarker "w912-a" → "w912-b";
    artifacts.provider = "r2", configured = true,
    artifacts.check = { state: "ok", detail: "sporta-beta-artifacts" }  ← live probe
    (identity neon/ok unchanged; transientState in-memory/unconfigured — W913)

GET /api/watch/sess-1/renders/r-2/outputs/anime-clip-c0f83b01
  → HTTP/2 200, x-sporta-artifact-source: r2
    byteLength 20317 (measured 20317), contentHash 63796d1f59720626…
    sha256(served content) == contentHash → True   (bytes round-tripped R2)
  → SAME after the w912-b REDEPLOY (fresh serverless instance, same hash —
    the artifact persisted in the bucket across deployments)

Access-control matrix on the presigned delivery route:
  no identity session          → 401 unauthenticated ("a session is required…")
  authenticated + valid policy
   + NOT the session owner      → 403 permission-denied (uniform, existence-free)
  policy without `storage`      → 403 permission-denied (rights before existence)
  unparseable policy header     → 403 permission-denied
  nonexistent session           → 404 not-found (no enumeration difference)
```

### 7.6) Usage guardrails (W919 seam, documented now)

Cloudflare R2 free tier: **10 GB-month storage, 1M Class A operations
(writes/lists), 10M Class B operations (reads)** per month. Today's enforced
bounds are the W504 store magnitudes (`HOSTED_STORE_DEFAULT_LIMITS`: 1000
segments, 16 MiB/segment, 256 MiB total) — well inside the storage allowance;
the ops counters + alarms + quota entries in the capability feed are W919
scope (the health route surfaces the store limits today). The presigned
delivery expiry is 5 minutes (browser) / 60 seconds (server-side fetch).

### Known boundaries (W912 state, honest)

- The R2 store's index/stats objects are read-modify-write under a
  SINGLE-WRITER assumption: hosted writes are serialized per scope by the
  compute adapter (W914) today; the bounded job queue (W913) will serialize
  them platform-wide. Concurrent independent writers to the SAME scope could
  lose index updates (documents themselves are keyed immutably — no data
  loss, only listing drift).
- The W914 async-compute path's artifacts do NOT mirror to R2 yet (that
  adapter composes its own in-memory W504 store; the seam is the
  `RenderOutputWriter` port — documented as the follow-up).
- The playback-gated watch route serves the document JSON (inline content)
  with the R2 round-trip proven by the `x-sporta-artifact-source` header and
  the hash verification; the browser-facing presigned-URL delivery route
  exists and is access-controlled, but no product surface hands those URLs
  to the page model yet (W905 watch page consumes the JSON route).
- Integration-test residue: per-run `index.json`/`_stats.json` envelopes for
  deleted scopes remain in the bucket (byte-scale; no public API removes them).
- Bucket location is APAC (R2 default jurisdiction); the Vercel functions run
  in iad1 — each server-side fetch pays the intercontinental hop (~100–300 ms
  per round-trip; visible in the integration-test timings).

## W915 — Real network live transport (SSE)

The live transport is a REAL network path: HTTP Server-Sent-Events streaming
really-generated SVG frames (`hello` → `frame`×N → `close`, with a `: keepalive`
comment every 15 s of silence). One real renderer execution per tick
(`renderAnimeClip` over the dev-seed story timeline; rights re-derived every
tick from the identity-attested policy), bounded per-subscriber drop-oldest
buffers with counted loss, and a MEASURED end-to-end latency (the frame's
server generation timestamp → the consumer's receipt clock; unsynchronized
clocks — documented at every surface that shows the number).

### Environment variables

| Variable | Purpose | Default |
| --- | --- | --- |
| `SPORTA_LIVE_TRANSPORT` | `sse` → the live transport is ACTIVE (`/api/live/*` serves real streams; `modes.live` reports `live-network`). Anything else/absent → honestly unavailable everywhere (Simulation F holds). | unset (unavailable) |
| `SPORTA_LIVE_CADENCE_MS` | The real emission cadence, clamped to 100–5000 ms. One real render per tick. | 500 |

### DEPLOYMENT BOUNDARY (honest — read before setting the flag)

The hosted **Vercel Hobby deployment does NOT enable this transport**:
serverless request-duration caps (Hobby: 60 s) would cut every live stream
mid-flight. The env flag is deliberately NOT set on the Vercel project and is
never set just to light the UI up. The transport serves long-lived streams on
any real HTTP host (local, bare-metal, an edge worker with a later work order).
Deployed-live validation therefore waits for a suitable host — the acceptance
for W915 is met by the LOCAL real-HTTP evidence below plus the browser player
(`EventSource`) shipped on the Live page.

### Local real-HTTP evidence (2026-09-16, worktree w914-hosted-compute)

Production build (`next start -p 3115`, env `SPORTA_LIVE_TRANSPORT=sse`,
`SPORTA_LIVE_CADENCE_MS=500`, `DATABASE_URL` unset — the in-memory dev
composition; server started and killed within one session, `ps` verified):

```
GET /api/live                → {"available":true,"transportKind":"live-network",
                                "detail":"SSE live transport — real HTTP streaming at 500ms cadence
                                (bounded 8-frame subscriber buffers, drop-oldest counted)",
                                "sources":[{"sessionId":"sess-1","label":"Derby night at Kings Park — fixture story A","storyKey":"derby"}]}
GET /api/live/sess-1         (anonymous)     → 401 {"failureClass":"auth-required",…} content-type application/json
GET /api/live/no-such-session (auth'd)       → 404 {"failureClass":"unknown-session",…} content-type application/json
GET /api/capability (auth'd)                 → "live":{"availability":"available","reasonCode":"ok","transportKind":"live-network"}
curl -N (auth'd) /api/live/sess-1 | bun scripts/live-sse-evidence.ts:
[hello] session=sess-1 story=derby cadenceMs=500 bufferDepth=8 openedAtMs=1789527550186
[frame] ordinal=1 storyStep=0 svgBytes=3384 renderMs=1 latencyMs=1
[frame] ordinal=2 storyStep=1 svgBytes=3225 renderMs=1 latencyMs=1 gapMs=499
[frame] ordinal=3 storyStep=2 svgBytes=3364 renderMs=1 latencyMs=1 gapMs=501
…  21 frames over ~10.5 s (story timeline 0..5 cycling; distinct SVG per step)
[frame] ordinal=21 storyStep=2 svgBytes=3364 renderMs=1 latencyMs=1 gapMs=501
SUMMARY frames=21 bytes=82911
CADENCE client-observed gaps n=20 p50=501ms p95=502ms max=537ms (server cadence 500ms)
LATENCY measured end-to-end n=21 last=1ms p50=1ms p95=2ms max=2ms (server generation clock → client receipt clock, unsynchronized; real measurement, never a promise)
```

Loopback honesty: the measured p50=1 ms is same-host loopback transport
latency (real, not simulated — but not a network-distance claim). The evidence
script (`apps/web/scripts/live-sse-evidence.ts`) parses the stream with the
same shared grammar the browser's `EventSource` consumes.

### Deployed state at the time of this section (honest boundary)

- `https://sporta-flame.vercel.app` currently serves the **W903-era shell**
  (its own footer states the pre-data-plane state); `/api/live` answers the
  shell's HTML 404 — the W915 routes are not deployed there.
- The W911/W912-evidence direct deployment URLs (`sporta-o5wou4xml`,
  `sporta-2m0a61jbj`, …) no longer serve (404) — those CLI deployments were
  superseded.
- Next redeploy after the W915 merge: `/api/live` will answer the sources list
  (JSON 200), and `GET /api/live/[sessionId]` will answer the typed **503
  `live-transport-not-configured`** while the env flag stays unset — the
  honest unavailable state, never a faked live badge.
