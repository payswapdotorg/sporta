# Sporta Public Beta — Definition of Yes

Sporta may only be described as public-beta ready when all three user questions can be answered **yes** from a clean browser, using evidence recorded in the repo.

## Yes 1 — Install and use

A fresh user can open the public URL, sign up/sign in, navigate the app, watch a real permitted artifact, switch renderers, create an authorized render, and install the web app where the browser supports installation.

Evidence: G9 + G10 + G12 + browser E2E.

## Yes 2 — Actually deployed on the target low-cost stack

A public deployment exists with reproducible configuration and real hosted services. Minimum target:

- Cloudflare Pages/Workers for web/edge/API;
- Neon PostgreSQL for durable control-plane state;
- Cloudflare R2 for media/artifacts;
- Upstash Redis for transient queue/cache/rate state;
- isolated compute adapter for video/render jobs;
- optional Apify use only where its bounded actor model is useful.

Evidence: G11 + G12 + operator console + deployment runbook.

The phrase "using free tiers" means the public-beta control plane remains within documented free allowances at the measured beta load. It does not mean arbitrary video/GPU workload is permanently free.

## Yes 3 — YouTube-like interface

The application must provide a familiar video-platform interaction model: Home, Live, Explore, Library, Search, Watch pages, content cards, related content, playback/timeline, creator flows, and a persistent role switcher. Sporta must remain visually distinct rather than copying another service's protected design.

Evidence: G9 + G10 + G14 and real browser E2E.

## Final gate

W920 is PASS only when all three statements can be supported by executable evidence and a fresh-browser walkthrough.
