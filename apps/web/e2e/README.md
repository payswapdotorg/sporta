# W909 — Browser E2E (the on-demand acceptance harness)

Real-browser end-to-end tests for the Sporta web app: a REAL headless
Chrome (via the sandbox's `agent-browser` CLI) drives the production build
through the W909 acceptance flows and asserts real outcomes. Nothing here
is mocked, stubbed or skipped silently — a flow that cannot run is
reported as failed, never greened over.

## How to run

```bash
cd apps/web
bun install            # once, at the repo root
env -u DATABASE_URL bun run e2e          # build + start + run + teardown
env -u DATABASE_URL bun run e2e -- --skip-build   # reuse an existing .next
env -u DATABASE_URL bun run e2e -- --only watch   # a single flow
E2E_PORT=3909 env -u DATABASE_URL bun run e2e     # choose the port (never 3000)
```

What the runner does, in order:

1. **Builds** the production app (`next build`) — skipped with
   `--skip-build` when `.next` is already current.
2. **Starts** the production server on a NON-3000 port (default 3909) via
   `bun --bun run start -- -p <port>`, in a CLEAN environment (a stray
   `DATABASE_URL` DSN is refused up front — the known sandbox hazard, not
   worked around). `SPORTA_DEMO_ACCOUNT_PASSWORD` is consciously set for the
   role-switch flow: the demo account is the operator-provisioned,
   all-five-grants identity (grants can never be self-registered).
3. **Discovers** the seeded content over the real APIs (`/api/catalog/sessions`
   + `/api/watch/:id`) — the flows watch the REAL dev-seed sessions, never
   fixture-crafted IDs.
4. **Drives a real headless browser** through the flows below, recording
   every assertion with the evidence string that decided it.
5. **Tears down**: kills the server, closes the browser, writes
   `evidence/run-<id>/e2e-report.{md,json}` + screenshots, and copies the
   report to `evidence/e2e-report.{md,json}` (the committed acceptance
   evidence). Exit code 0 only when every flow passed.

**This harness is intentionally NOT part of the root `bun test` default**
(the sandbox cannot always run a browser). Its pure parts — the flow
inventory / route-availability model, the assertion recorder, and the WCAG
contrast math — ARE unit-tested in the root suite
(`apps/web/test/e2e-harness.test.ts`).

## What's covered (the W909 acceptance lines)

| Flow | Proves |
| --- | --- |
| `a11y-smoke` | skip link present + focusable + lands on `#main-content`; header/nav/main/footer landmarks with labels; every `<img>` has alt and every `role="img"` (the SVG frame stages) an aria-label; contrast spot-check of the visible text pairs (WCAG AA, computed by the pure math in `lib/contrast.ts`); keyboard navigation reaches the main interactive elements and into the main landmark. |
| `sign-in` | register a fresh account through the real form → the nav shows the account → sign out clears it → sign in AGAIN (the login path, not just register's auto-sign-in) → a wrong password shows the API's real classified error. |
| `watch` | anonymous `/watch?session=<seeded>` → the REAL stored output renders (inline SVG frames on the page, the manifest-clock frame count, the timeline windows, event markers + marker buttons), honestly labeled a review artifact. |
| `reality-switch` | the switcher lists the REAL renderer availabilities (stored outputs → `ready`; everything else → honest state + reason, disabled); switching swaps the player surface WITHOUT a page reload (a window marker set before the switch must survive it) and the session stays constant. |
| `output-playback` | the playback-gate output document loads over the wire from the browser page (200 JSON segment document + `x-sporta-artifact-source`), an event-marker jump snaps the playhead to a real frame, and the transport actually plays (Play → Pause). |
| `render` | the full Create Studio guided flow: register a creator → authorized source → rights declaration with the server-derived preview → renderer → recipe → review → dispatch → REAL progress (the compute ledger's events) → succeeded → the stored output EXISTS (a real rendered frame preview, the never-silent completion accounting, the "Open in Watch" hand-off). |
| `rights-denial` | a signed-in viewer on `/operations` sees the operator-grant denial (the real 403 path surfaced); the same viewer on `/rights` sees the rights-holder denial; anonymous visitors see the sign-in requirement (the 401 path) — and in every denied state, operator/rights-holder DATA (provider ids, queue depths, policy records) never reaches the rendered bytes. |
| `role-switch` | GRANTS-ONLY: the switcher offers exactly the account's grants (two for the creator-registered account, all five for the demo identity); switching narrows the workspace NAV (the same one-model projection scoped to the role's surface map) with a safe return URL — context only, authority never moves. |

## Honest boundary

- This harness runs against a **local production build** (`next build` +
  `next start`) with the dev-seed content — the honest local boundary.
  The **hosted-URL, clean-browser walkthrough is W920's** final gate, not
  this one.
- The in-memory stores (no Neon/Upstash/R2 env) make every state
  instance-local: reruns re-register fresh accounts (unique per-run
  usernames), and a restart resets studio publication state (documented
  product behavior).
- The accessibility flow is a **smoke**, not an audit: the contrast check
  spot-checks the visible text pairs the home + watch pages render; a full
  audit (every state of every surface) is not claimed.
- `agent-browser` must be on `PATH` (it is, in this sandbox). The harness
  never fabricates a browser step — if the browser cannot run, the run
  fails loudly.
