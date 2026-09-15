# Sporta Hosted Deployment Runbook (W910)

Checked: 2026-09-16 (W910 flight 2). Status: **OPERATIONAL** — the app described
below is deployed and serving from this repository configuration alone (plus a
`VERCEL_TOKEN`).

## What is deployed

`apps/web` — the Sporta Next.js 16 product shell (W903) plus the hosted-platform
composition root scaffolding (W910–W913 seams, dormant until their flights land).
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

W911–W913 provider bindings are **documented placeholders only** until those
flights run (add them the same way, production target):

| Env var | Flight | Meaning |
|---|---|---|
| `DATABASE_URL` | W911 | Neon PostgreSQL connection string (secret) |
| `R2_S3_ENDPOINT` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET_NAME` / `R2_BUCKET_REGION` | W912 | Cloudflare R2 S3-compatible bindings (keys secret; bucket name/region are not) |
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
- Deploy 3 (final, exactly commit `614ebcd`):
  `https://sporta-jh45r45py-ekonplacidegmailcoms-projects.vercel.app`
  (marker `w910-614ebcd`) — the deployment the production alias currently serves.

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
#   → JSON: env "beta-personal", deployMarker <current marker>, providers honestly
#     "unconfigured" until W911–W913 wire real bindings
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

Current production state (verified 2026-09-16):

```
https://sporta-flame.vercel.app/                   → 200 (39847 B; Sporta + skip-link in HTML)
https://sporta-flame.vercel.app/manifest.webmanifest → 200 application/manifest+json; charset=utf-8
https://sporta-flame.vercel.app/sw.js              → 200 application/javascript; charset=utf-8
/api/platform/health → env "beta-personal", deployMarker "w910-614ebcd",
                       providers identity/artifacts/transientState = in-memory, unconfigured
```

## Honest limitations (W910 state)

- The deployed app is the **data-free W903 shell** plus dormant platform seams:
  identity/R2/Upstash are wired as fail-closed, in-memory fallbacks and health
  reports every provider `unconfigured`. Real provider bindings + migrations +
  the A-lane product surfaces land with W911–W913 and Worker A's wave — after
  which a redeploy of this same runbook picks them up.
- The production alias on the Hobby plan is personal/non-commercial (see host
  policy boundary above).
- Deploys are CLI-driven (no Git integration connected yet — `vercel git
  connect` is a later hardening step; CI/CD via GitHub is not required for W910).
