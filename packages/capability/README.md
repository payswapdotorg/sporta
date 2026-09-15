# @sporta/capability — the product capability contract (W901)

**Work item W901 (P0):** "capability discovery for auth state, roles,
renderers, live/batch, quotas, provider health, and content availability." ·
Owner: Tech Lead + Platform · Dependency: W701 (the control plane).

**This package is the FROZEN SEAM Worker A's W904 consumes.** The frontend
renders entirely from `CapabilityResponse` documents; every deny/degraded
path has a committed fixture under `fixtures/v1/` (regenerate deterministically
with `bun run regen-fixtures`).

## What this package is

Three things, nothing more:

1. **The versioned contract** (`src/schema.ts`): `CapabilityResponse` —
   zod v4, exact-key (`z.strictObject`) everywhere, closed vocabularies for
   every enumerated field, pinned literals for the schema version and the
   two normative notes, and cross-field invariants enforced AT PARSE TIME
   (an invalid response cannot even be ingested).
2. **A transport-free composition** (`src/service.ts`):
   `buildCapabilityResponse(input)` — a pure function from well-defined
   operational inputs to a validated response. No transport ships here; any
   HTTP/edge layer (W910) wraps this.
3. **Canonical serialization** (`src/serialize.ts`):
   `serializeCapabilityResponse` / `parseCapabilityResponse` — deterministic
   bytes, strict re-validation on parse.

## The response surface (top-level fields)

| Field | What the frontend renders from it |
|---|---|
| `schemaVersion` | Pinned literal `"1.0"` — any other version fails to parse. |
| `requestContext` | Caller's `requestId` echo (nothing is generated here). |
| `auth` | `authenticated \| anonymous \| invalid-session`, `sessionValid`, `activeRole` (nullable), the pinned active-role CONTEXT note. |
| `account` | `authenticated`, `userId` (iff authenticated), `roles` (GRANTS, not authority — pinned note). |
| `renderers[]` | Per renderer: `availability` (`available \| degraded \| unavailable`), `reasonCode`, `requiresSourceFrames`, `rightsAwareness` (`rights-evaluated \| rights-not-relevant`), id/version/class. |
| `modes.live` | Live availability + `transportKind` (`live-network \| in-process \| none`). **Simulation F is schema-enforced**: `available` requires `live-network`; `in-process` must be reported as `in-process-transport-not-live`. |
| `modes.batch` | Offline/batch availability (compute-provider-gated). |
| `quotas[]` | Per quota: `scope`, `used`/`limit`/`remaining` (null when unreadable), `exhausted`, `reasonCode`. |
| `providers[]` | Exactly the four canonical kinds (`control-plane`, `storage`, `queue-cache`, `compute`), each `ok \| degraded \| down \| unknown` + reason + verbatim `detail`/`degradedMeaning` from the feed. |
| `content.catalogSurfaces[]` | The 16 role-experience-matrix surfaces with `visibility` + reason (`surface-visible` \| `authentication-required` \| `role-not-granted` \| `surface-request-invalid`). |
| `overall` | Coarse `ready \| degraded \| unavailable` + sorted, deduplicated `reasonCodes` (empty iff `ready`). Deliberately excludes live (see below). |

## Fail-closed semantics (the important part)

- **Structural input failures throw** (`CapabilityInputError`): a missing
  `session`, unknown input keys, an anonymous session claiming a user id or
  active role, an active role the account does not hold, duplicate grants.
  Broken identity data never yields a response — an authenticated session
  without resolvable account data degrades to `auth.state:
  "invalid-session"` (never a half-trusted authenticated state).
- **Operational feed failures degrade per-entry with explicit reason codes**:
  an invalid renderer entry becomes `unavailable`/`renderer-input-invalid`;
  an unreadable quota counter becomes `exhausted`/`quota-counter-invalid`
  with null numbers (admission stops — Simulation E); a missing provider
  feed surfaces as `unknown`/`health-feed-missing`, and anything depending
  on an `unknown` provider is `provider-health-unknown` (never
  optimistically available). Unattributable invalid feeds are counted in
  `overall.reasonCodes` (`provider-feed-invalid`,
  `catalog-surface-request-invalid`, `renderer-registry-feed-missing`) —
  nothing is silently dropped.
- **A missing rights input is a DENY-ALL decision** (the frozen
  `@sporta/contracts` rule): rights-gated renderers and live delivery answer
  `rights-denied`.
- **The builder re-validates its own output** against the full schema
  (invariants included) and throws `CapabilityInternalError` rather than
  ever returning an invalid document.
- **Worst-first renderer lattice** (documented order): `renderer-input-invalid`
  > `renderer-not-registered` > `rights-denied` > provider dependency
  (down/unknown → unavailable; degraded → degraded) > `renderer-registry-degraded`
  > `ok`.

## Documented design decisions (TL review notes)

1. **Provider health has an `unknown` state** beyond the brief's
   `ok|degraded|down`: missing health data must be representable fail-closed
   (the W805 health-rollup precedent: no-data → unknown). `unknown` is never
   treated as ok downstream.
2. **`overall` excludes the live mode.** Live is absent until W915's real
   network transport; degrading the whole app for that would be wrong — it
   is the Live surface's own `unavailable` state. Overall summarizes the
   render-capable surfaces (renderers, batch, providers, quotas).
3. **Roles live here, not in identity.** W902 depends on W901 per the work
   orders, so the role vocabulary + the two normative notes are defined in
   this frozen contract and consumed by `@sporta/identity`.
4. **Content visibility is presentation, not authorization.** Hidden surfaces
   tell the UI what NOT to offer; `@sporta/identity` decides every protected
   action server-side regardless.
5. **No timestamps in the response.** Telemetry-neutrality (no clock) means
   freshness is the caller's concern; the response is a pure projection of
   the inputs it was given.

## Usage

```sh
cd packages/capability
bun test                # 103 tests / 435 expects
bun run typecheck       # tsc --noEmit, zero errors
bun run regen-fixtures  # deterministic fixture regeneration
```

```ts
import { buildCapabilityResponse } from "@sporta/capability";

const response = buildCapabilityResponse({
  requestContext: { requestId: "req-1" },
  session: { authenticated: true, valid: true, userId: "u-1", activeRole: "viewer" },
  account: { userId: "u-1", roles: ["viewer", "creator"] },
  rights: { canReferenceSourceFrames: true, canDeliverLive: false, canStoreDerivatives: true, canShare: false },
  renderers: [{ rendererId: "anime.prototype", requiresSourceFrames: false, registryStatus: "registered" }],
  liveTransport: { kind: "in-process" },   // honestly NOT live-network (Simulation F)
  quotas: [{ quotaId: "user.daily-renders", scope: "user", used: 3, limit: 10 }],
  providers: [{ kind: "compute", health: "ok" }],
});
```

## Honest boundary (what this is NOT)

- **No transport, no persistence, no collection.** Nothing here serves HTTP,
  stores state, or observes the system: real renderer-registry state, quota
  counters, provider health feeds, and identity state arrive as INPUTS from
  the deploying layer (W910 edge, W902 identity, W919 guardrails).
- **No live capability exists to report yet.** Until W915, every honest
  response has `modes.live = unavailable` — the fixtures pin exactly that.
- **The dependency model is explicit, not inferred.** A renderer's entry
  declares `dependsOnProviders`; the composition never guesses which
  providers matter to which renderer.

## Package boundary

`versioning` → `roles` → `schema` (+ `defaults`, `errors`) → `service` →
`serialize`, re-exported from `index.ts`. Runtime dependencies: `zod` and
`@sporta/contracts` only (the repo's frozen domain contract this package
CONSUMES — rights capabilities and the renderer-class vocabulary). The
isolation and constitution scans in `test/boundary.test.ts` keep it that way:
no undeclared imports, no `Math.random`/`Date.now`/`performance.now`/
`new Date` calls anywhere in shipped source.
