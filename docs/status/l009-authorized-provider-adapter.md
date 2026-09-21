# L009 — Authorized Live Provider Adapter (Worker B, Wave 2)

Status: **BLOCKED ON FEED ACCESS — adapter shape DELIVERED** (the
acceptance's own honest branch: "otherwise the item remains BLOCKED with
exact external dependency recorded, while L001-L007 remain testable
without it")
Related: L007/L008 (`packages/live-open-data` — the open-data replay
adapter + the profile registrations), `docs/contracts/live-reality.md` §6
(source adapters), `docs/status/mvp-and-live-reality-status.md`

## The exact external dependency (the recorded blocker)

This deployment cannot feed the live contract from a real authorized
provider because it holds neither of the two required things:

1. **Credentials** — no `SKILLCORNER_USERNAME` / `SKILLCORNER_PASSWORD`
   (HTTP Basic, the provider SDK's own env naming convention) exists in
   any environment this battery ran against (verified: a full env survey
   of the sandbox found zero sports-data provider bindings).
2. **Contractual feed access** — SkillCorner's authorized tracking feed is
   commercial data under contract (skillcorner.com/legal/
   standard-terms-and-conditions, fetched 2026-09-21). No data-use
   agreement is on record, so the profile's DATASET license component
   stays honestly `unresolved` and `blockingLicenseIssues` is non-empty
   (the R004 fail-closed rule — the same posture as the recorded Metrica
   candidate, applied to access rather than license text).

To activate: set the three bindings (`SKILLCORNER_USERNAME`,
`SKILLCORNER_PASSWORD`, `SKILLCORNER_MATCH_ID`; optionally
`SKILLCORNER_API_BASE` to override the recorded default
`https://skillcorner.com`), then follow the checklist below. Zero code
changes are needed for the gate, the adapter, the health surface or the
fixtures.

## What shipped (the blocked-state deliverable, complete)

The new package **`@sporta/live-authorized`** (`packages/live-authorized`):

- **The env-driven gate** (`src/env.ts`): the provider's own binding names;
  incomplete sets answer the honest `blocked` with the EXACT missing
  binding names; secret values never appear in any capability output
  (presence only). Blank/whitespace bindings count as missing — never an
  empty-string credential.
- **The adapter** (`src/skillcorner/authorized-feed.ts`):
  `SkillCornerAuthorizedFeed` — the pull-based, buffered observation source
  over the recorded endpoint. ONE DRF page per `pullPage()` (the caller
  owns pacing/retry — the §6 reconnect behavior is policy, never a silent
  retry); `next()` / `plannedIngestTimeMs()` / `stats()` follow the L007
  adapter's port surface (the bridge seam). The constructor does NO I/O
  and reads NO clock — the HTTP seam (`fetcher`) and the clock (`nowMs`)
  are injected (pinned by test).
- **The recorded response schema** (`src/skillcorner/response.ts`): the
  DRF envelope `{count, next, previous, results}` + the provider's
  published frame core (`frame`/`timestamp`/`period`/`ball_data`/
  `player_data`), strict on what is consumed. The authorized-shape
  doctrine: recorded-but-unmapped fields (`possession`,
  `image_corners_projection`) are COUNTED; fields BEYOND the recorded
  format are collected BY NAME (`unknownFieldKinds`) and dropped — the
  activation-time verification hook.
- **The §6 registration** (`src/profile.ts`): the TechnologyProfile with
  the three-way license record (code: Sporta's own; dataset: honestly
  unresolved — the blocker above; no model component), the documented
  failure classes (credentials-missing / auth-rejected /
  page-schema-mismatch / frame-schema-mismatch /
  unknown-provider-fields), and `executionRequirements.status:
  "blocked-pending-feed-access"`.
- **The health/capability surface** (`src/health.ts`):
  `authorizedLiveProviderHealth(env)` — the operator panel row.

**The app-side surface**: `GET /api/operations/providers` (operator-gated)
now carries a `liveAuthorized` panel — binding presence only, honestly
`blocked` with the exact missing names in this deployment
(`apps/web/test/l009-authorized-provider.test.ts` pins the route). The
app's env module (`server/platform/env.ts`) is the single process-env read
point (`authorizedLiveProviderPanel()`), matching the `r2Configured()`
convention; the `SKILLCORNER_*` names joined `PLATFORM_ENV_VARS`.

## The recorded provider facts (fetched 2026-09-21, sources on record)

Every fact the adapter's transport layer rests on was FETCHED from the
provider's own artifacts during this work (this sandbox reaches github.com,
pypi.org and skillcorner.com; the API host itself requires credentials —
which is the blocker):

| Fact | Value | Source (fetched 2026-09-21) |
| --- | --- | --- |
| API base | `https://skillcorner.com` | the provider's Python SDK `class_config.py` (`base_url`), PyPI `skillcorner==3.2.0` wheel |
| Auth mode | HTTP Basic (username/password) | the SDK's `class_config.py` `auth` block (fitrequest credentials) |
| Binding names | `SKILLCORNER_USERNAME` / `SKILLCORNER_PASSWORD` | the SDK's `auth` env names — adopted verbatim |
| Tracking endpoint | `GET /api/match/{match_id}/tracking` | the SDK's `method_config_list.py` (`match_tracking_data`); documented at `skillcorner.com/api/docs/#/match/match_tracking_list` |
| Pagination | DRF list envelope `{count, next, previous, results}`, `next`-link walking | the SDK's `pagination.py` |
| Frame core | `frame`/`timestamp`/`period`/`ball_data`/`player_data` (meters, center-origin, 10 fps, 105×68) | the provider's published opendata schema of record (`@sporta/live-open-data` `skillcorner/format`, recorded from github.com/SkillCorner/opendata) |

**What is honestly UNVERIFIED**: the live endpoint's exact frame payload
(may carry fields beyond the recorded core). The adapter's doctrine makes
that gap SAFE and VISIBLE: unknown fields are counted by name and dropped
(strict parse of the known core; a mismatch refuses loudly). No sample or
live data was fetched, committed, or fabricated — the test fixtures are
format-fixtures over the recorded schema with synthetic values (the L007
convention).

## The test evidence

- `packages/live-authorized/test/env.test.ts` — the gate (blocked/ready,
  exact missing names, blanks count as missing, secrets never surface).
- `packages/live-authorized/test/response.test.ts` — the recorded envelope
  + frame core (strict consumed fields; unmapped/unknown counting; the
  timestamp clock; typed refusals).
- `packages/live-authorized/test/feed.test.ts` — the adapter over injected
  fixtures: the EXACT wire requests (the recorded URL + the Basic header),
  page walking, strict LiveObservation revalidation of every batch,
  provider-field isolation (possession/image-corners/player_id never
  survive), coordinate normalization, the detectedness priors, the
  all-null pre-match skip, deterministic replay of the same fixture, the
  typed failure postures (401/403 counted, no silent retry; http-error;
  network-error; unparseable body), the honest stats, exhaustion/close.
- `packages/live-authorized/test/profile.test.ts` — the §6 registration
  (contract-valid; dataset unresolved; blockingLicenseIssues non-empty;
  the blocked posture stated; the failure-class vocabulary).
- `apps/web/test/l009-authorized-provider.test.ts` — the operator route
  carries the panel; the honest blocked row; the gating.

Result: **36/36 package tests + 3/3 app-side tests, green**; the package
typechecks clean and joins the workspace typecheck filter.

## The activation checklist (when feed access exists)

1. Set `SKILLCORNER_USERNAME` / `SKILLCORNER_PASSWORD` /
   `SKILLCORNER_MATCH_ID` (the capability panel flips to `ready`).
2. **Verify the live frame schema on the first real pull**: review
   `stats().unknownFieldKinds` — every field the live feed carries beyond
   the recorded core is named there. Extend the recorded core deliberately
   (a recorded schema update with provenance) if the feed's real fields
   warrant consumption; refuse loudly if a CONSUMED field's shape differs.
3. Record the data-use agreement in the profile's DATASET license
   component (the `blockingLicenseIssues` gate then clears — R004).
4. Wire the feed at the live transport seam (the L005 bridge's
   registration shape: a source whose producer calls `pullPage()` on the
   caller's pacing policy) — the composition remains the only env reader
   (the `authorizedLiveProviderPanel()` helper is the read point).
