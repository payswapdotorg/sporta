# Sporta Deployment Architecture

Status: TARGET ARCHITECTURE FOR PUBLIC-BETA PRODUCTIZATION.

## Deployment goal

Provide an installable browser application and a public hosted deployment while keeping compute and storage replaceable. The initial web deployment target is **Vercel Hobby** for personal/non-commercial development and beta validation. The supporting control/data plane favors free/low-cost services; heavy media/GPU work remains isolated so it can scale independently.

## Reference topology

```text
Browser / PWA
    |
    v
Vercel Hobby  <--- public web application / Next.js deployment
    |
    +----> Cloudflare Workers  <--- edge/API adapter when needed
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

- Public web/app initially: **Vercel Hobby**.
- Vercel Hobby is explicitly a personal/non-commercial deployment target under Vercel's current terms. It may be used for development, demos, internal validation, and a non-commercial beta. It must not be represented as the commercial production deployment target. citeturn918436search0turn918436search1
- Commercial operation requires a Vercel plan whose terms permit that use, or a migration of `apps/web` to another commercially permitted host without changing Sporta's domain contracts.
- Public API gateway/edge functions: Cloudflare Workers.
- Database: Neon PostgreSQL.
- Redis-compatible cache/queue: Upstash Redis.
- Media/artifacts: Cloudflare R2.
- Heavy compute: isolated worker adapter; Apify can be used for bounded jobs and experimentation, while GPU-heavy production rendering remains an explicitly metered compute dependency.

## Free-tier baseline

The target initial control plane should run within provider free allowances for low-volume usage, with hard usage guards and clear degradation once limits are reached.

Current planning references checked 2026-09-15:

- Cloudflare R2 Free: 10 GB-month standard storage, 1M Class A operations, 10M Class B operations, and free egress. citeturn844288search2
- Neon Free: 10 projects, 50 CU-hours/project/month, 0.5 GB/project, and 5 GB egress/project according to Neon’s published plan description. citeturn844288search5
- Upstash Redis Free: 256 MB data, 10 GB monthly bandwidth, and 500K commands/month. citeturn844288search0
- Apify Free: $5/month of usage credit and no credit card required. citeturn844288search6
- Vercel Hobby: $0 with automated CI/CD, CDN and related platform features, but limited to personal/non-commercial use under current Vercel terms. citeturn918436search0turn918436search1

These limits are planning inputs, not permanent guarantees; deployment docs/manifests must carry a checked date and source URLs.

## Environments

`local` -> deterministic fixtures and local services.
`preview` -> Vercel preview deployment against isolated preview control-plane resources.
`beta-personal` -> hosted user environment for personal/non-commercial validation with auth, quotas, rights enforcement and production-like storage.
`production` -> same contracts, replaceable service bindings and a commercially permitted web host/plan plus paid capacity as needed.

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
