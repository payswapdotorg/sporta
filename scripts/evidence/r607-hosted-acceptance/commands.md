# R607 command classes (verbatim shapes actually executed)

All commands ran from the worker sandbox. Credentials were loaded from
`~/.secrets/env.sh` (OUTSIDE the repository; values never echoed into
logs or committed files — `$VERCEL_TOKEN` / `$GH_TOKEN` below are the
shell variables, never the values).

## 1) Base + branch (the task packet's setup, verbatim)

```bash
git clone https://github.com/payswapdotorg/sporta.git
cd sporta
git checkout 0cc47aecb39858e9eff9d6ee3c0f45bb21612562   # origin/main
git rev-parse HEAD   # → 0cc47aecb39858e9eff9d6ee3c0f45bb21612562
git checkout -b r607/hosted-acceptance-evidence
```

Collision guard (lane-coordination.md): `git ls-remote --heads origin`
— no `r607/*` branch existed remotely at start (verified 2026-09-26
~22:10Z).

## 2) Deploy (W910 runbook §3, adapted only where the fresh clone requires it)

```bash
. ~/.secrets/env.sh                       # exports VERCEL_TOKEN (+ scope ids)

# marker update before each deploy (runbook §3's PATCH, marker env id from §2)
curl -s -X PATCH -H "Authorization: Bearer $VERCEL_TOKEN" \
  "https://api.vercel.com/v10/projects/sporta/env/GHJXtTrqEuB1I8pg?teamId=$VERCEL_TEAM" \
  -H "Content-Type: application/json" \
  -d '{"value":"<r607-deploy-1|r607-fix-1|r607-fix-2>","type":"encrypted","target":["production"]}'

# the deploy itself (runbook: from the REPO ROOT)
cd <repo root>
bunx vercel deploy --prod --yes --token "$VERCEL_TOKEN" \
  --project sporta --scope ekonplacidegmailcoms-projects
```

Adaptation note (the only delta from the runbook's literal command): the
fresh clone carries no `.vercel/` link, so `--project sporta --scope
ekonplacidegmailcoms-projects` is passed explicitly instead of relying
on the linked checkout the runbook assumed. Root Directory
`apps/web`, framework, and env bindings were NOT re-provisioned — the
existing project was reused (runbook §1 skipped: `bunx vercel project ls`
showed `sporta` with the persisted env vars; `bunx vercel env ls
--project sporta` listed DATABASE_URL / R2_* / SPORTA_DEPLOY_ENV /
SPORTA_DEPLOY_MARKER without printing values).

## 3) Deployment + project state reads (API, no values)

```bash
curl -s -H "Authorization: Bearer $VERCEL_TOKEN" \
  "https://api.vercel.com/v9/projects/sporta?teamId=$VERCEL_TEAM"           # settings + latest deployments
curl -s -H "Authorization: Bearer $VERCEL_TOKEN" \
  "https://api.vercel.com/v6/deployments?teamId=$VERCEL_TEAM&app=sporta&limit=3&target=production"  # ids + states
curl -s -H "Authorization: Bearer $VERCEL_TOKEN" \
  "https://api.vercel.com/v9/projects/sporta/env?teamId=$VERCEL_TEAM&target=production"             # env ids (names only)
bunx vercel logs https://sporta-flame.vercel.app --token "$VERCEL_TOKEN" --project sporta            # runtime logs (the typed refusal)
```

## 4) Verify (runbook §4, verbatim)

```bash
curl -sS -o /dev/null -w "%{http_code}\n" https://sporta-flame.vercel.app/                 # → 200
curl -sS -o /dev/null -w "%{http_code} %{content_type}\n" https://sporta-flame.vercel.app/manifest.webmanifest
curl -sS -o /dev/null -w "%{http_code} %{content_type}\n" https://sporta-flame.vercel.app/sw.js
curl -sS https://sporta-flame.vercel.app/ | grep -c -E "Sporta|skip-link|manifest\.webmanifest"
curl -sS https://sporta-flame.vercel.app/api/platform/health                                # the JSON provider table
```

## 5) The golden path (real browser; the journey log records the stages)

```bash
agent-browser --session r607golden open https://sporta-flame.vercel.app/
agent-browser --session r607golden snapshot -i          # ref-driven interaction
agent-browser --session r607golden upload @<fileInput> /…/scripts/evidence/spr-corpus-bytes/clip-b1-wide-broadcast.mp4
agent-browser --session r607golden screenshot <stage>.png
agent-browser --session r607golden network requests --filter upload-sessions   # the 500 + typed envelope
agent-browser --session r607golden console / errors      # zero observed
```

The same walk re-executed after the redeploy in a FRESH context
(`--session r607recovery` — no shared cookies/state).

## 6) Recovery measurement (API-level, hash-verified)

```bash
curl -sS -H "cookie: sporta_session=<browser-token>" "https://sporta-flame.vercel.app/api/auth/me"
curl -sS -H "cookie: sporta_session=<browser-token>" "https://sporta-flame.vercel.app/api/catalog/library"
curl -sS -H "cookie: sporta_session=<browser-token>" "https://sporta-flame.vercel.app/api/watch/<sessionId>"
curl -sS -H "cookie: sporta_session=<browser-token>" \
  "https://sporta-flame.vercel.app/api/watch/<sessionId>/renders/<renderId>/outputs/<segmentId>"
# sha256(served content) == the descriptor's contentHash, before AND after the redeploy
```

## 7) The regression test for the minimal fix

```bash
cd apps/web
bun test test/instrumentation-node-shim.test.ts    # 7/7
bun test test/api-routes.test.ts                   # 15/15 (sanity)
bun test test/golden-path.test.ts                  # 14/14 in isolation (sanity)
bun run typecheck                                  # clean
```

## 8) Delivery

```bash
git add -A && git commit -m "r607: hosted acceptance evidence — deploy 0cc47ae + fresh-browser golden path + redeploy + recovery proof"
git push https://x-access-token:${GH_TOKEN}@github.com/payswapdotorg/sporta.git \
  r607/hosted-acceptance-evidence:r607/hosted-acceptance-evidence
```
