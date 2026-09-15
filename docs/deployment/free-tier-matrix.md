# Sporta Free-Tier Deployment Matrix

Checked: 2026-09-15.

| Service | Intended use | Current free allowance | Sporta role | Caveat |
|---|---|---|---|---|
| Cloudflare Pages | web static delivery | 500 builds/month; 20k files/site; 25 MiB asset | primary public frontend | large media belongs in R2 |
| Cloudflare Workers | edge/API gateway | 100k requests/day; 10 ms CPU/invocation on Free | auth gate, API routing, lightweight jobs | heavy media/GPU work must not run here |
| Cloudflare R2 | media/artifacts | 10 GB-month; 1M Class A; 10M Class B; free egress | source/output/intermediate storage | limits require quota UX |
| Neon | PostgreSQL | 10 projects; 50 CU-hours/project/month; 0.5 GB/project; 5 GB egress/project | durable control-plane DB | low-volume beta target |
| Upstash Redis | queue/cache/rate state | 256 MB; 10 GB bandwidth; 500K commands/month | transient state and bounded queues | enforce command budgets |
| Apify | bounded actor execution | $5/month usage credit on Free | optional ingestion/helpers/experiments | not enough for sustained GPU rendering |
| Vercel | previews/personal deployments | Hobby is $0 | optional preview environment | Vercel documents Hobby as personal/non-commercial; do not use it as the public commercial production target |

Current source references: Cloudflare Workers/Pages/R2, Neon, Upstash and Apify pricing/limits. citeturn478647search0turn478647search1turn645750search1turn478647search3turn645750search0turn645750search3 Vercel's current pricing and terms specify the Hobby plan is for personal/non-commercial use. citeturn701638search0turn701638search1

## Required guardrails

The product must expose provider quota status, reject uploads/jobs before hard limits, and never silently move a rights-protected artifact to an unapproved provider.

## Important economic boundary

A public product can be hosted primarily on free tiers at low volume, but sustained video transformation, real-time GPU inference and high-volume media delivery are not assumed to be free. The deployment contract therefore separates the free control plane from metered compute capacity and requires explicit cost controls.
