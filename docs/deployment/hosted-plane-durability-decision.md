# Hosted-Plane Durability — the Operator Decision Packet

Status: **PROPOSED — the decision is the operator's.** This packet prepares two coupled
decisions with measured evidence and typed options; it decides nothing, commits to no
infrastructure, and makes no live call (research + writing only). The standing doctrine
holds: a worker never improvises the persistent-worker-host decision
(`scripts/evidence/r306-hosted-reflight/README.md`, "The ephemerality doctrine (standing)").

Date: 2026-10-05 (the decision-packet worker, task 69-b; branch
`work/hosted-plane-durability-decision` from main @ `5424a84e`). Placement:
`docs/deployment/` — the convention that already hosts the free-tier economics
(`docs/deployment/free-tier-matrix.md`) and the deployment-shapes analysis
(`docs/deployment/J007-local-durability-and-deployment-shapes.md`); no `decisions/`
subdir exists under `docs/`. Citation rule: every measured claim cites its evidence path;
every unmeasured number is marked **(est.)**.

## 0. The measured situation (why these two decisions, and why one packet)

**Decision 1's problem — the hosted plane's workers live on EPHEMERAL sandboxes.** The
production deployment dispatches its real media operations and render jobs to two external
workers (media-toolchain :3971, compute :3973), both Bun processes inside an E2B sandbox
whose public URLs are baked into the Vercel project env (`MEDIA_TOOLCHAIN_URL`,
`COMPUTE_WORKER_URL` — `scripts/evidence/r306-hosted-reflight/deploy-record.json`,
`envWiring`). The sandbox is ephemeral by design: `keepAliveMs: 7200000` (2 h),
`lifecycleOnTimeout: "kill"` (`scripts/evidence/r306-hosted-reflight/sandbox-record.json`).
When it dies its URLs answer the E2B proxy's 502 "The sandbox was not found" (`REPORT.md`
§6), the deployment's boot-time compute-worker descriptor fetch fails, and
`/api/platform/health` returns **500 empty — the 62-c incident class**, measured live on
the production alias on 2026-10-05 as this packet's pre-deploy baseline
(`deploy-record.json`, `baselineMeasured`; measured twice by the r607 flights and again
by the r306 arc — the ephemerality doctrine,
`scripts/evidence/r306-hosted-reflight/README.md`; `docs/status/mvp-and-live-reality-status.md`,
R607 row).

**Decision 2's problem — the deployment quota.** On 2026-10-05 the hosted re-flight's
deploy leg was refused before creation: HTTP 402 `api-deployments-free-per-day`,
`{"limit":{"total":100,"remaining":0,"reset":1791253483018}}` — the rolling-day quota
exhausted, reset epoch 1791253483018 ≈ 2026-10-06T01:31Z (~23 h from the refusal)
(`scripts/evidence/r306-hosted-reflight/deploy-record.json`, `deploy.refusal`, verbatim).
This is the **second** measured exhaustion: the r607 e2b-hosted-rerun flight recorded the
same typed refusal (`scripts/evidence/r607-e2b-hosted-rerun/deploy-record.json`), and the
flight after that window's reset measured "No quota refusal (the 65-j class did not
reproduce)" (`REPORT.md` §7).

**Why one packet:** both refusals hit the same flight at the same leg — a durable
worker host without a deployable cadence still cannot land the hosted re-flight, and a
lifted quota without a durable host still bakes a dying URL into every deployment. The
r306 hosted re-flight (the 4/4 closure measure for the 68 artifact-ingest seam) is
typed-blocked at the deploy leg until the quota window and remains ephemeral in its
worker posture after it (sandbox `iuspg21vqeg256a94osir` honestly left to die —
`scripts/evidence/r306-hosted-reflight/README.md` §"THE TL LEGS").

## 1. Decision 1 — the persistent worker host

### The runtime the host must carry (measured)

The workers are Bun processes — `packages/compute-adapter-hosted/scripts/
r607-media-toolchain-worker.ts` (:3971, `Bun.serve`, real ffmpeg/ffprobe via `Bun.which`)
and `packages/compute-adapter-hosted/scripts/r607-e2b-compute-worker.ts` (:3973) — both
binding `HOSTNAME=0.0.0.0` with `PORT` from the environment (start commands measured in
`scripts/evidence/r306-hosted-reflight/compute-worker-record.json` + `sandbox-record.json`).
The measured sandbox footprint hosting them: **2 vCPU / 512 MB**, Debian 12, ffmpeg
5.1.9-0+deb12u1 + libx264, bun 1.4.2 (`sandbox-record.json`). The media worker enforces
its own memory discipline — `maxConcurrentJobs=1 (ONE ffmpeg at a time — the memory
discipline)`, `maxExecutionMs=120000`, `maxSourceBytes=maxArtifactBytes=200 MiB`; the
compute worker runs `maxConcurrentJobs 4`, `providerKind cpu-worker`. The measured
workloads are small-frame CPU renders: the 48-frame 320×240 rgb24 decode
(11 059 200 B), encode legs 1 026 ms / 347 ms, artifacts 46 193 B and 55 669 B
(`REPORT.md` §6, §8, §10). The media worker's docstring already names the posture —
"the exact shape an external toolchain worker deployment serves" — the entrypoints are
deployment-shaped; what they lack is a public URL that outlives a 2-hour sandbox.

### (a) Status quo + re-flight cadence (keep ephemeral E2B)

Every hosted flight re-provisions a fresh E2B sandbox (provision measured 103 364 ms;
167 packages; ffmpeg via apt — `REPORT.md` §6), boots both workers, PATCHes the two
worker URLs + the deploy marker into the Vercel env, deploys, walks, then honestly lets
the sandbox die. The chain is re-runnable in **~30 minutes** (measured,
`deploy-record.json`, `ephemeralityDoctrine.theHonestPosture`). Cost so far: **$0
measured** (no E2B billing event in any record; the free-tier allowance is the worker's
knowledge, **est. ~100 sandbox-hours/month, NOT measured — no E2B quota refusal has ever
been recorded**). Durability: none by design — the 62-c 500 class returns to every
deployment baking a dying URL; production between flights serves the 500 health class
(measured above). Risks: production is honest only ~2 h per flight; every hosted
demonstration costs a full re-flight; the unmeasured E2B tier ceiling could refuse
provisioning mid-arc exactly like the Vercel quota did.

### (b) An always-on small host for the two workers

One small always-on host (Fly.io / Render / Railway small instance, or a cheap VPS)
running the two Bun worker processes with ffmpeg + libx264 — the measured footprint
(2 vCPU / 512 MB, one ffmpeg at a time) fits the smallest always-on tiers. Monthly cost
**(all est. from the worker's knowledge, not measured — verify current list prices)**:
Fly.io shared-cpu-1x @ 512 MB ≈ $4/mo + a few GB volume (~$0.15/GB/mo) → ~$4–6/mo;
Render Starter $7/mo (0.5 CPU / 512 MB, always-on); Railway Hobby $5/mo (usage-billed
inside it); a cheap VPS (Hetzner 2 vCPU / 4 GB class) ≈ $4–6/mo; Oracle Cloud's
always-free ARM (4 OCPU / 24 GB) $0 with signup-availability caveats. Durability: the
baked URLs stay valid → the 62-c class closes at its root, not per-flight; restarts are
process-restarts (the workers already boot idempotently, health-check-first). Migration
effort: **est. ~1 flight (~1 day)** — dockerize or bare-run the two entrypoints (a
Debian + bun + ffmpeg image mirrors the measured in-sandbox shape), put the platform's
TLS in front of the two ports, then PATCH `MEDIA_TOOLCHAIN_URL` / `COMPUTE_WORKER_URL`
once through the SAME measured lane (the env-PATCH driver is lane-aware and exists).
Risks: the workers' job ledger is per-process (the documented W921 §8 boundary,
`docs/deployment/DEPLOYMENT.md` — a host restart empties it; artifacts and registrations
persist); the pinned-revision discipline must be re-tooled (provision clones at
`PINNED_SHA` fail-closed — a persistent host needs an explicit update/restart procedure,
a later work order, never improvised); Render's FREE tier would re-create the class in
slow motion (spin-down → the boot-time descriptor fetch could time out), so this option
means an ALWAYS-ON tier, not a free one.

### (c) Vercel Fluid Compute / the workers as Vercel functions

Honest assessment: the repo's own history measures against it. The hosted Vercel runtime
ships NO ffmpeg/ffprobe — `ffprobe executable not found on PATH`, the typed
upload-admission refusal measured on the Hobby plane
(`scripts/evidence/r607-hosted-acceptance/README.md`), and the G12 walk's derived kinds
refused with the typed `producer-unavailable` class for exactly that reason (`REPORT.md`
§1) — **that is why the external workers exist.** The compute worker's budgets were
derived from the documented Vercel Hobby limits (execution 10 s default / 60 s max;
4.5 MB request/response body — `packages/compute-adapter-hosted/src/budgets.ts`), so a
function shape was in the design's sight, but the measured wire contract already exceeds
one of those limits: the decode leg's inline 48-frame rgb24 batch is **11 059 200 B**
over the wire (`REPORT.md` §6) — beyond the 4.5 MB body limit the package itself
documents. Shipping ffmpeg inside the function bundle, re-shaping the inline deliveries
into chunked or store-mediated handoffs, and re-architecting the two workers as functions
is a real re-platform (est. multi-flight), with the workers' measured 120 000 ms render
budget against the invocation caps even under Fluid Compute **(est. — Fluid's caps
unverified; no live call was made)**. Cost: within the existing plan's function pricing
(est. $0 additional on Hobby at this volume). Durability: stateless scale-to-zero is
durable-by-platform, but the per-process job ledger and the in-memory accounting restart
per invocation.

### (d) Repo-native options found in the evidence

The repo already carries the prior art: closing the runtime-toolchain-absent boundary
"requires the W914 http compute adapter against a real toolchain worker **or an
ffmpeg-shipping host**" (`docs/status/mvp-and-live-reality-status.md`, R607 row); the
live-transport doc names "any real HTTP host (local, bare-metal, an edge worker with a
later work order)" (`docs/deployment/DEPLOYMENT.md`, the W915 boundary); and
`packages/compute-provider-adapters` ships REST clients for external compute planes
(`provider.modal` R402, `provider.lightning` R403, `provider.runpod` R404 — the
package's `src/index.ts`). Those adapters dispatch render jobs to external providers;
they are NOT a toolchain-worker host (the media operations and the hosted compute worker
are Bun compositions, not Modal/RunPod functions). Honest scope: (d) collapses into (b)
— an always-on ffmpeg-shipping host, the repo's own named closure — with the provider
adapters a possible future GPU-plane split, beyond this packet's two decisions.

### Comparison table

| Option | Monthly cost | Durability of the baked URLs | Migration effort | Principal risks |
| --- | --- | --- | --- | --- |
| (a) ephemeral E2B + re-flight | $0 (measured; E2B free tier est. ~100 h/mo, unmeasured) | none — the 62-c 500 class returns at every sandbox death (measured 3×) | zero (current posture) | production honest only ~2 h per flight; unmeasured E2B tier ceiling; every demo costs a flight |
| (b) always-on small host | est. $4–7/mo (Fly/Render/Railway/VPS; Oracle free $0) | high — URL stable across restarts; 62-c closes at root | est. ~1 flight (docker/bare bun + ffmpeg; one env PATCH via the measured lane) | per-process job ledger on restart (documented); pinned-revision update procedure needed; the tier must be always-on (Render free disqualified) |
| (c) Vercel functions / Fluid | est. $0 additional (Hobby function pricing) | platform-durable (stateless) | est. multi-flight re-platform | measured: no ffmpeg on the hosted runtime (the reason the workers exist); 4.5 MB body limit vs the measured 11 MB inline decode batch; 120 s render budget vs invocation caps |
| (d) repo-native (provider adapters / the named closure) | same as (b) if realized as the ffmpeg-shipping host | same as (b) | est. ≥ (b) (adapter work on top) | the adapters dispatch, they do not host the toolchain — not a near-term closure |

### The worker's typed recommendation (the decision stays the operator's)

**(b) — an always-on small host for the two workers, with (a) retained as the
evidence-flight posture in the interim.** It is the repo's own named closure ("an
ffmpeg-shipping host"), the measured footprint fits the cheapest always-on tiers, the
entrypoints are already deployment-shaped (`Bun.serve`, `0.0.0.0`, `PORT` env), the
env-PATCH lane is measured and reusable, and it closes the 62-c class at its root rather
than per-flight. Option (c) is honestly typed against by the repo's own measurements (no
ffmpeg on the hosted runtime; the 11 MB inline decode batch vs the 4.5 MB body limit) and
is a re-platform, not a posture change — a credible later work order if the inline
deliveries are re-shaped. The interim: keep flying (a) for evidence flights — the
re-flight chain is measured ~30 min and the ephemerality doctrine already holds — while
the persistent host is stood up.

## 2. Decision 2 — the Vercel plan / deployment quota

### The measured discovery

2026-10-05: the deployment creation refused before creation — HTTP 402,
`api-deployments-free-per-day`, limit 100 / rolling day, remaining 0, reset epoch
1791253483018 ≈ **2026-10-06T01:31Z** (~23 h block)
(`scripts/evidence/r306-hosted-reflight/deploy-record.json`, `deploy.refusal`,
verbatim: `POST /v13/deployments → HTTP 402 ... "Resource is limited - try again in 24
hours (more than 100, code: \"api-deployments-free-per-day\")"`). The quota is
**account-wide** — the account hosts 45 projects incl. this lane's many prior deploys
(`scripts/evidence/r607-e2b-hosted-rerun/deploy-record.json`); both measured exhaustion
events landed mid-flight after the r607/r306 arcs' deploy chains, with exactly ONE
deployment created since 2026-10-05T00:00Z at the second refusal (the failed
`dpl_8kLxt…` — `scripts/evidence/r306-hosted-reflight/README.md` §"THE TL LEGS").

### How many deploys a hosted flight burns (measured, from the records)

- The provisioning re-verify legs burn **0** deploys (sandbox + worker verification only —
  `scripts/evidence/r306-hosted-reflight/README.md`, "The procedure chain").
- The deploy leg burns **1+ creation POST per attempt**, refused retries included: the
  re-flight's single accepted deployment cost **2 POSTs** (one HTTP 400 `missing_files` +
  the retry that created `dpl_8kLxt…` — `deploy-record.attempt1.json`,
  `verbatimOutputTail`); the next fix-iteration attempt was the 402.
- The arcs' cadence multiplies that: the r607/r306 records name **≥9 distinct deployment
  ids** (enumerated over `scripts/evidence/`), plus ≥2 typed-refused creation attempts
  (the two 402s); the hosted-acceptance flight alone created 3 (broken → healthy →
  redeploy — `docs/status/mvp-and-live-reality-status.md`, R607 row).
- Honest bound: one hosted flight burns **~1–3 deployments + fix-iteration attempts
  (each 1+)**; the 100/day exhaustion is the ACCOUNT's cadence (45 projects, the arcs'
  chains + the incarnations' retries), not this repo's alone — but both measured
  refusals correlated exactly with the flight cadence.

### Option: stay on the free (Hobby) plan

$0 measured. The honest price: hosted flights are **gated to the rolling-day quota** —
when the account's cadence exhausts it, the flight is typed-blocked ~23 h (measured, to
the reset epoch) and the chain re-opens at fresh provisioning (the sandbox died waiting
— the 2 h keep-alive cannot span a 24 h quota window;
`scripts/evidence/r607-e2b-hosted-rerun/deploy-record.json`, `whenTheQuotaResets`). The
prior measured pattern: the first exhaustion blocked the r607 re-run; the window reset;
the next flight's deploy succeeded (`REPORT.md` §7). Standing: the Hobby plan's
personal/non-commercial terms boundary, already documented in
`docs/deployment/free-tier-matrix.md` ("upgrade or migrate before commercial operation").

### Option: Vercel Pro

**~$20/mo (est. — the standard Pro list price from the worker's knowledge; NOT
measured, no live call made; the operator verifies the current price).** What it buys
(est., unverified here): the per-day deployment quota lifted to a higher documented
limit, longer build times, higher function-duration ceilings, and the commercial-use
posture the free-tier matrix flags as a pre-commercial requirement. What it does NOT
buy: worker durability — Pro changes the deploy cadence, not the ephemerality of the
baked URLs (Decision 1 remains independent). The 402 class disappears at the measured
flight cadence (~1–3 deploys + retries per flight — orders of magnitude under any
documented Pro limit, est.).

### The deploy lane's own durability (part of this decision)

The direct `VERCEL_TOKEN` is **typed-dead**: HTTP 403 `invalidToken` verbatim
(`deploy-record.json`, `vercelLane.directTokenProbe` — the CLI answers the same class).
The working deploy lane is the **Composio vercel connection** (`ca_31iruA2qEdfl`,
proxy_execute — the lane class the 68-TL flight proved for the GitHub push): every
Vercel call in the re-flight (env decrypt-reads, the PATCHes, the deployment creation,
the failed build's events) executed through it, measured. Its durability: an
operator-provisioned one-click connection bound to the account; if it lapses or is
revoked, the deploy lane dies with **no measured fallback** — unlike the GitHub push
lane, which has a recovered PAT primary + Composio as fallback (worklog 69-R1). A
typed-live `VERCEL_TOKEN` (operator-issued, fresh) would restore a second independent
lane; that ask rides with whichever plan is chosen — Pro's team/project ownership should
be bound deliberately to the same account the Composio connection serves.

### Comparison table

| Option | Monthly cost | Flight cadence | The deploy lane | Boundary |
| --- | --- | --- | --- | --- |
| stay free (Hobby) | $0 (measured) | hosted flights gated to the account's rolling-day quota; measured ~23 h typed-block on exhaustion (2× measured) | Composio connection (measured, the sole lane; the direct token typed-dead 403) | personal/non-commercial terms (docs/deployment/free-tier-matrix.md) |
| Vercel Pro | est. ~$20/mo (unmeasured) | the 402 class gone at the measured cadence; longer builds | the same lane question stands (Composio + a fresh typed-live token recommended) | lifts the commercial boundary (verify current terms) |

### The worker's typed recommendation (the decision stays the operator's)

**Stay free through the current evidence arc; move to Pro when the hosted plane is meant
to be demonstrated or handed beyond the operator.** The measured cadence (one hosted
flight's ~1–3 deploys) does not justify ~$20/mo while the flights are evidence-only and
the quota resets overnight — the honest cost is the ~23 h typed block, which the loop has
already absorbed once (the 65-j class) and can absorb again. Pro becomes the right call
when (i) the flight cadence tightens (daily hosted flights), (ii) Decision 1(b) lands and
the hosted plane becomes a standing demonstration rather than a per-flight artifact, or
(iii) any commercial posture begins — the free-tier matrix already names that boundary.
The token ask is decision-independent: **a typed-live VERCEL_TOKEN should be issued
whichever plan is chosen**, restoring a second deploy lane beside the Composio connection.

## 3. The coupled postures (the combined view)

| Posture | Total est. monthly | The hosted plane's honest state |
| --- | --- | --- |
| (a) + free (today) | $0 | per-flight: ~30 min chain, ~2 h honest window, then the 62-c 500 class returns; ~23 h typed-blocks on quota exhaustion (measured 2×) |
| (b) + free | est. ~$4–7 | durable workers + stable URLs; deploys still quota-gated per flight (1–3 deploys/day) |
| (b) + Pro | est. ~$24–27 | the durable hosted plane: stable worker URLs + unblocked cadence + the commercial boundary lifted |
| (c) + Pro | est. ~$20 + re-platform | stateless-by-platform workers, but a multi-flight re-shaping of the measured wire contract (the 11 MB inline batch vs the 4.5 MB body limit) |

## 4. Evidence gaps (what this packet could NOT resolve)

- **E2B free-tier limits are unmeasured** — no E2B quota refusal exists in any record;
  the ~100 sandbox-hours/month figure is the worker's knowledge, marked est.
- **Vercel Pro's current price, quota shape, and Fluid Compute caps are unverified**
  (no live calls by order); all marked est. from the worker's knowledge.
- **Host-platform prices (Fly/Render/Railway/VPS) are estimates**, not quotes; the
  measured footprint (2 vCPU / 512 MB, one ffmpeg at a time, 200 MiB budgets, 120 s
  render budget) is the verified part.
- **The persistent host's pinned-revision update procedure does not exist yet** — the
  measured drivers clone at `PINNED_SHA` fail-closed for ephemeral sandboxes; a
  persistent host needs its own update/restart driver (a later work order, never
  improvised by this packet).
- **The Composio vercel connection's expiry/renewal behavior is unmeasured** — the lane
  is proven working end-to-end, but nothing in the records measures how long the
  connection stays authorized.

## 5. What the next flight measures regardless of either decision

The quota window (≈2026-10-06T01:31Z, measured) re-opens the hosted re-flight chain as
checkpointed: fresh provisioning → the diagnostic deploy (the wired installCommand
captures the build container's layout) → THE WALK → the validators — the 4/4 closure
measure for the 68 artifact-ingest seam (`scripts/evidence/r306-hosted-reflight/
README.md` §"THE TL LEGS"; commit `2cf1465` on `work/r306-hosted-reflight`). Neither
decision above blocks that flight; both determine whether the flight's honest state
survives it.
