# Sporta Free-Tier Deployment Matrix

Checked: 2026-09-15.

| Service | Intended use | Current free allowance | Sporta role | Caveat |
|---|---|---|---|---|
| Vercel Hobby | web app / Next.js hosting | $0 Hobby plan | **initial web deployment target** | personal/non-commercial only under current Vercel terms; upgrade or migrate before commercial operation |
| Cloudflare Workers | edge/API gateway | provider free allowance | auth gate, API routing, lightweight jobs | heavy media/GPU work must not run here |
| Cloudflare R2 | media/artifacts | 10 GB-month; 1M Class A; 10M Class B; free egress | source/output/intermediate storage | limits require quota UX |
| Neon | PostgreSQL | 10 projects; 50 CU-hours/project/month; 0.5 GB/project; 5 GB egress/project | durable control-plane DB | low-volume beta target |
| Upstash Redis | queue/cache/rate state | 256 MB; 10 GB bandwidth; 500K commands/month | transient state and bounded queues | enforce command budgets |
| Apify | bounded actor execution | $5/month usage credit on Free | optional ingestion/helpers/experiments | not enough for sustained GPU rendering |

Current source references checked 2026-09-15: Cloudflare R2, Neon, Upstash and Apify pricing/limits. citeturn844288search2turn844288search5turn844288search0turn844288search6 Vercel's current pricing and terms specify the Hobby plan is free but limited to personal/non-commercial use. citeturn918436search0turn918436search1

## Required guardrails

The product must expose provider quota status, reject uploads/jobs before hard limits, and never silently move a rights-protected artifact to an unapproved provider.

## Important economic boundary

A public product can run the web/control plane primarily on free tiers at low volume, but sustained video transformation, real-time GPU inference and high-volume media delivery are not assumed to be free. The deployment contract therefore separates the free control plane from metered compute capacity and requires explicit cost controls.
