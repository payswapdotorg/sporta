# Sporta Deployment Architecture

Status: TARGET ARCHITECTURE FOR PUBLIC-BETA PRODUCTIZATION.

## Deployment goal

Provide an installable browser application and a public hosted deployment while keeping compute and storage replaceable. The public control plane and web application should favor free/low-cost services; heavy media/GPU work must be isolated so it can scale independently.

## Reference topology

```text
Browser / PWA
    |
    v
Cloudflare Pages/Workers  <--- public web + edge/API gateway
    |
    +----> Neon PostgreSQL <--- control-plane state
    |
    +----> Upstash Redis   <--- queues/cache/rate state
    |
    +----> Cloudflare R2  <--- source/artifact/output storage
    |
    +----> Render Control API
                |
                +----> CPU workers
                +----> GPU/on-demand workers
                +----> WebRTC delivery adapter

Apify is an optional managed execution adapter for bounded actor jobs, ingestion helpers, or external data tasks; it is not a required domain dependency.
```

## Hosting policy

- Public web/app: Cloudflare Pages or Workers-first deployment.
- Public API gateway/edge functions: Cloudflare Workers.
- Database: Neon PostgreSQL.
- Redis-compatible cache/queue: Upstash Redis.
- Media/artifacts: Cloudflare R2.
- Heavy compute: isolated worker adapter; Apify can be used for bounded jobs and experimentation, while GPU-heavy production rendering remains an explicitly metered compute dependency.
- Vercel: allowed for previews/personal deployments, but the free Hobby plan must not be treated as the commercial production target because Vercel states Hobby is for personal/non-commercial use. citeturn701638search0turn701638search1

## Free-tier baseline

The target public-beta control plane should be able to run within provider free allowances for low-volume usage, with hard usage guards and clear degradation once limits are reached.

Current provider references: Cloudflare Workers Free includes 100,000 requests/day; Cloudflare Pages Free allows 500 builds/month; R2 Free includes 10 GB-month, 1M Class A and 10M Class B operations with free egress; Neon Free currently provides 10 projects, 50 CU-hours/project/month, 0.5 GB/project and 5 GB egress/project; Upstash Redis Free provides 256 MB, 10 GB monthly bandwidth and 500K commands/month; Apify Free currently includes $5/month of usage credit. citeturn478647search0turn478647search1turn645750search1turn478647search3turn645750search0turn645750search3

These limits are planning inputs, not permanent guarantees; the deployment manifests/docs must carry a checked date and source URLs.

## Environments

`local` -> deterministic fixtures and local services.
`preview` -> public browser app against isolated preview control-plane resources.
`beta` -> hosted user environment with auth, quotas, rights enforcement and production-like storage.
`production` -> same contracts, replaceable service bindings and paid capacity as needed.

## Cost safety

Every deployed environment must have:

- hard request/render limits;
- upload size/duration limits;
- per-user/job quotas;
- provider budget/usage alerts where available;
- visible degraded states when a quota/provider limit is reached;
- no silent provider failover that changes rights or data semantics.

## Authentication

Authentication must be implemented at the control-plane boundary before public beta. Frontend role selection is presentation only; authorization is server-side. Session ownership, media access, playback access and publication rights are all rechecked server-side.

## Deployment readiness definition

A deployment is considered real only after:

1. a public URL exists;
2. a fresh browser can register/sign in;
3. an authorized fixture can be uploaded;
4. a render can complete through the hosted control plane;
5. output is persisted in R2 and can be played from a fresh browser;
6. denied-rights media is blocked;
7. an operator can observe the job/health path;
8. rollback and environment configuration are documented.
