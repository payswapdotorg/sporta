# J011 — the operator contextual navigation

Date: 2026-09-21 (Wave 3, Worker B — platform/media/live transport)
Branch: `work/l014-platform-j011-connection` (base `03d79f42`)

## What this delivers

The J011 acceptance: "Operations jobs/failures link directly to affected
session, Watch, Create/job details and relevant provider state" — the
operations console's jobs/failures rows gain DIRECT contextual navigation,
additive and role-gated (the console's server-side operator gate is
unchanged — the real 401/403 re-pinned by test).

### 1. The affected session, identified (the server join)

`apps/web/src/server/operations-service.ts` — the jobs listing joins each
job's session LABEL from the control plane's own `sourceLabel` (ONE
`listSessions` read, joined per row). The operator sees WHICH session, never
a bare id to guess about; a session with no recorded label keeps the honest
`null` (never the id dressed up as a label). Additive field
(`sessionLabel`), no route change.

### 2. The contextual links (the console)

`apps/web/src/components/operations-console.tsx` — every job row gains the
Context column, derived from the job's REAL data by the pure
`operationsJobContextLinks`:

- **Watch** → `/watch?session=<id>` — the existing session-addressable
  watch route (the session cards' own target; the id is encoded, never
  interpolated raw). The row's session line itself becomes this link,
  showing the session's LABEL.
- **Job details** → the row's expandable detail panel — the FULL honest
  record (dispatched at/by, admission, renderer, render id, the
  never-silent completion envelope, the metered usage), served by the
  console itself.
- **Create** → the Create studio (`/create`) — where a re-submission is
  launched.
- **Provider state** → the console's own Providers & quotas panel
  (`#ops-providers-title`, in-page) + the compute connection center
  (`/account/compute`).

The audit panel joins the same treatment: every remediation record
carrying a session id gets the Watch link.

### 3. Evidence

`apps/web/test/j011-operations-context.test.ts` — 6 tests over the REAL
composition:

- the console gate unchanged (the anonymous 401, the non-operator 403
  permission-denied);
- the label join over a REAL studio dispatch (one real async job through
  `server.studio.dispatchRender` on a seeded session; every row carries
  the control plane's own sourceLabel);
- the pure link derivations (the session-addressable targets, the
  reserved-character encoding, the purity/stability).

The existing operations-console battery re-run green (15/15) — the
additive field and the console changes drift nothing.

## Honest boundaries

- The "job details" target is the console's own expansion (not the Jobs
  workspace): the `/jobs` surface is a general product surface (not this
  lane's file set), and a deep session anchor there would be a cross-lane
  additive request. The console serves the full job record itself, so the
  operator's need is met in-lane; a later UI lane may deep-link the Jobs
  workspace per session.
- The provider-state link targets the console's own providers panel + the
  compute center (the deployment's provider state is global — per-job
  provider attribution does not exist in the job ledger's shape).
