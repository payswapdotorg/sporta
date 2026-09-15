# @sporta/identity — real user auth + multi-role authorization (W902)

**Work item W902 (P0):** "real user auth, account model, role grants,
server-side policy enforcement, session ownership." · Owner: Platform ·
Dependencies: W701 (the control plane), W901 (the capability contract).

## What this package is

Six pieces, nothing more:

1. **Accounts** (`src/accounts.ts`): a stable `userId`, a case-normalized
   unique username, a password hashed with **argon2id**
   (`Bun.password.hash`/`verify`), and **role GRANTS** — the
   `@sporta/capability` vocabulary (viewer / creator / analyst /
   rights-holder / operator). Grants are data on the account; they are not
   the active role and not authority. Persistence is behind an async
   `AccountStore` PORT (in-memory this wave; shaped for the W911 Neon
   adapter).
2. **Sessions** (`src/sessions.ts`): opaque **256-bit bearer tokens** drawn
   from an injectable `EntropySource` (default: real platform entropy via
   `crypto.getRandomValues`; tests inject deterministic entropy). The store
   keeps **only the SHA-256 hash** of the token — never the plaintext —
   plus userId, issued-at, expires-at, and the presentation role. Expiry is
   evaluated against the **injected clock** (constitution: no `Date.now` /
   `performance.now` in library code). Revocation is idempotent; revoked,
   expired, and unknown tokens are indistinguishable to callers.
3. **The policy** (`src/policy.ts`): a PURE `authorize(account, action,
   resource)` decision (allow-with-provenance or deny-with-reason,
   closed vocabularies on both sides). It reads the account's GRANTS and
   the resource's OWNER — never the session's active role (that field does
   not even exist on the policy's input). Fail-closed: no account, an
   unknown action, or an unreadable resource denies.
4. **The W701 bridge** (`src/control-gate.ts`): `createIdentityControlGate`
   fronts the control plane (`@sporta/control-api`, structural — no runtime
   dependency) with a verified identity. Every mediated call resolves the
   token FIRST (generic 401), authorizes SECOND (generic 403 — the control
   plane is never consulted on the deny path, so a non-owner's denial is
   identical whether or not the media session exists: **no existence
   oracle**, Simulation D), and delegates LAST. Media-session creation
   re-attests the caller's rights declaration with
   `assertedBy: <verified userId>` — the identity layer is now the real
   source of the W701 caller-supplied authorization policy. Output reads
   gate on session ownership BEFORE any segment bytes are fetched.
5. **The HTTP auth surface** (`src/http.ts`): `createIdentityServer` — a
   `Bun.serve` transport following control-api's http.ts conventions
   (route table, JSON bodies, typed errors → statuses, `x-request-id`
   correlation, generic auth failures):

   | Route | Method | What it does |
   |---|---|---|
   | `/v1/auth/register` | POST | create an account (validation + username uniqueness) |
   | `/v1/auth/login` | POST | verify credentials → issue an opaque session (+ `sporta_session` HttpOnly cookie) |
   | `/v1/auth/logout` | POST | revoke the presented session (idempotent) |
   | `/v1/auth/me` | GET | account summary + role grants + active role |
   | `/v1/auth/switch-role` | POST | switch the session's PRESENTATION role (refused unless held) |

   Self-registration may mint only viewer / creator / analyst grants;
   rights-holder and operator are operator-assigned (no admin surface yet).
   Login failures are generic and timing-equalized (an unknown username
   still burns one password verification) — no user enumeration.

6. **Typed errors** (`src/errors.ts`): the control-api pattern
   (`failureClass` + derived `httpStatus` + JSON-safe `details`):
   validation → 400; auth-invalid / unauthenticated → 401;
   permission-denied → 403; conflict → 409; internal → 500.

## The role-switching invariant (the architecture-lock no-drift rule)

Switching the active role changes the **workspace presentation only**:

- `switchRole` refuses a role the account does not hold;
- the account's grants are never touched by a switch;
- the authorization policy has no active-role input at all — it cannot be
  influenced by presentation state;
- the W701 gate re-derives every decision from grants + ownership.

All four are pinned by tests (`test/http.test.ts`,
`test/policy.test.ts`, `test/control-gate.test.ts`).

## Usage

```sh
cd packages/identity
bun test                # 89 tests / 394 expects
bun run typecheck       # tsc --noEmit, zero errors
```

```ts
import { createIdentityServer } from "@sporta/identity";

// Production wiring (real clock + real argon2 + real entropy are the defaults
// EXCEPT the clock — inject a wall clock; the deterministic epoch clock is
// the unseeded default so test runs stay reproducible):
const server = createIdentityServer({
  nowMs: () => Date.now(),          // production MUST inject real time
  sessionTtlMs: 7 * 24 * 60 * 60 * 1000,
});
console.log(`identity-api listening on http://127.0.0.1:${server.port}`);
```

```ts
import { createIdentityControlGate } from "@sporta/identity";
import { createControlApp } from "@sporta/control-api"; // the dev/composition layer

const gate = createIdentityControlGate({
  accounts,
  sessions,
  control: createControlApp({ renderOutputStore, nowMs }),
});
// token comes from POST /v1/auth/login:
const result = await gate.createMediaSession(token, {
  authorizationPolicy: rightsDeclaration, // re-attested with the verified userId
});
await gate.getRenderOutput(token, sessionId, renderId, segmentId); // owner/operator only
```

## Honest limitations (what this is NOT)

- **No email verification, no password reset** — accounts are
  username+password only; recovery flows are a deployment-stage concern.
- **No rate limiting / brute-force throttling** on register or login —
  that is W913 (Upstash). The timing-equalized login failure prevents
  user enumeration, not password guessing.
- **In-memory persistence only** — accounts, sessions, and ownership
  records live in the process (the ports are the W911 Neon adapter's
  shape; restart wipes everything).
- **No hosted/browser sign-in evidence yet** — the HTTP surface is real
  (`Bun.serve` + real `fetch` round-trips in tests), but public-URL
  deployment and fresh-browser sign-in evidence belong to W910/W920.
- **Session revocation is per-process** — no distributed session
  invalidation until the Upstash/Neon-backed store lands (W911/W913).
- **The gate mediates a subset of control-api routes** (session
  create/get/terminate, output list/get). Renderer selection
  (`createRender`) stays unmediated this wave; W906 wires it behind
  quota + rights policy.
- **`operator`/`rights-holder` grants have no assignment surface yet** —
  they exist in the model and tests (via the store), but no admin flow can
  mint them; self-registration is deliberately limited to
  viewer/creator/analyst to prevent privilege escalation.
- **One deliberate design note for TL review**: the identity default clock
  is the deterministic epoch counter (`IDENTITY_DEFAULT_EPOCH_MS`), exactly
  like `viewer-shell`/`control-api` — production must inject real time.

## Package boundary

`clock` → `accounts` + `passwords` + `sessions` → `policy` →
`control-gate` + `http` + `errors`, re-exported from `index.ts`.
Runtime dependencies: `zod`, `@sporta/capability` (the role vocabulary),
`@sporta/contracts` (the rights-policy shape) — nothing else.
`@sporta/control-api` is a **devDependency**: the W701 bridge is a
STRUCTURAL port (the W504 playback-port precedent), so identity can never
grow a hidden control-plane runtime dependency. The isolation and
constitution scans in `test/boundary.test.ts` keep it that way: no
undeclared imports, no `Math.random`/`Date.now`/`performance.now`
wall-clock or RNG reads anywhere in shipped source.
