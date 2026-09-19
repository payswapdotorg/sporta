# @sporta/connection-center

The product-plane compute experience (R406-R409) over the frozen compute
seams: what a user SEES and CONTROLS of compute — connections, selection,
usage, and allowances — with zero new provider knowledge and zero new
execution semantics.

Composed over:

- **`@sporta/compute-adapter`** — the W914 `ComputeAdapterPort` + the R401
  `ComputeBrokerPort` (quote/select/dispatch delegates, the closed
  refusal vocabulary) — consumed verbatim, never forked;
- **`@sporta/compute-provider-adapters`** — the R402-R405 real provider
  adapters (`provider.modal`, `provider.lightning`, `provider.runpod`,
  `provider.local`) with their honest credential state machines.

## What the package delivers

### R406 — the compute connection center (`src/connections.ts`)

`ConnectionCenter`: connect / verify / disconnect / status, per account,
over a provider plane of DATA entries (id + supported credential kinds +
an adapter factory).

- **No provider master passwords** — a password-class presentation
  (`account-password | console-password | master-password`) is refused
  fail-closed with the typed `MasterPasswordRefusalError` (closed message
  vocabulary, `rights-denied` class) BEFORE anything is stored — and the
  refusal is RECORDED in the audit trail (refused ≠ dropped). Only the
  scoped kinds the adapters document are accepted (`scoped-api-key |
scoped-token-pair | oauth-access-token`);
- **Credential references, never values** — the store holds the kind +
  a 16-hex sha-256 fingerprint prefix + presented-at. The value is
  consumed transiently by the adapter factory and the verification call;
  it never persists, never logs, never reports (test-pinned);
- **Honest verify** — `verify` drives the adapter's REAL
  `verifyCredentials()` call and records the five-state answer verbatim
  (`verified | invalid | present-unverified | missing | not-applicable`);
- **Real disconnect** — the record is removed, the runtime binding
  dropped, the removal audited; unknown disconnects are typed errors;
- **Account isolation** — every record, audit entry, and binding is
  scoped by the account id (the W902 `userId` shape; the center performs
  NO authentication — callers derive the account from a verified
  identity);
- **The R406→R407 bridge** — `connectedAdapters(account)` hands the
  account's live adapters to an `InMemoryComputeBroker` as
  `ComputeBrokerProvider[]` (per-account selection composes above).

### R407 — the selection director (`src/selection.ts`)

`SelectionDirector` wraps one R401 broker; `explain(request, directive)`
answers the broker's `ComputeBrokerSelection` VERBATIM plus the auditable
`SelectionExplanation`.

- **User-explicit or sporta-auto** — explicit mode selects the named
  provider or throws the typed `SelectionRefusedError` carrying every
  recorded reason (the broker's silent preferred-provider fallback is
  DETECTED and refused: explicit means explicit); auto mode walks the
  preference-axis survivors in the broker's registration order;
- **The axes** — cost/queue/availability flow through the broker's
  policy bounds (verbatim); privacy (`privacy-local-only` over the
  provider FACTS' execution zones), VRAM (declared floors; undeclared is
  an honest exclusion, never a guess), and capability classes are
  DIRECTOR axes over the operator's DATA declarations — provider names
  never appear in contracts;
- **Auditability** — the explanation is a versioned zod document: for
  EVERY registered provider, the quote (verbatim, honest nulls intact),
  the broker refusal (verbatim), and the preference exclusion (axis +
  message). `canonicalSelectionExplanation` serializes it
  byte-deterministically (golden-pinning substrate);
- **Fail-loud** — a broker aggregate throw propagates VERBATIM; missing
  facts, malformed directives, and out-of-sanity-bounds preferences are
  typed validation errors (the director never guesses).

### R408 — the BYOC usage ledger (`src/ledger.ts`)

`UsageLedger`: transparent per-(account, provider, job) usage records.

- The W914 `ComputeUsageRecord` rides VERBATIM inside the account
  envelope (imported schema, never forked) with the RESPONSIBILITY
  boundary added (`user-owned-provider | sporta-managed`);
- Idempotent by the W914 DOCUMENT: re-recording / re-draining counts
  duplicates; a DIFFERENT document for the same job conflicts fail-loudly;
- `drain(account, provider, adapter)` composes the W914 metering drain
  with the account dimension;
- `summary` aggregates exit states, timing, and cost units — and
  `spendUsd` is HONESTLY `null` (a BYOC provider's price is unknowable
  here; never a fabricated number);
- W004 store semantics (in-memory + `bun:sqlite`): validation on write
  AND read (`ByocLedgerIntegrityError`), deep-clone-on-read/write,
  NUL-free scopes, bounded with explicit errors, durable across instances.

### R409 — the managed compute seam (`src/managed.ts`)

`ManagedComputeSeam`: provider-INDEPENDENT allowance/concurrency controls
for future Sporta subscriptions.

- **Provider-independent by construction** — abstract allowance units
  (the W914 cost-unit vocabulary), the R401 refusal vocabulary reused
  VERBATIM (`quota-exhausted`), dispatch delegated through the R401
  broker verbatim; no provider id in any contract member;
- **Fail-closed admission (the W919 posture)** — no entitlement, spent
  period, full concurrency, or exhausted count-unit refuses BEFORE any
  dispatch (typed `ManagedAdmissionRefusalError`); metered units
  (`compute-ms`) are enforced one step late at settlement and fail-close
  the NEXT admission (documented, never hidden);
- **Spend alarms** — settlement emits threshold-alarm events whenever a
  unit's consumption crosses a policy threshold (default 0.5 / 0.8 / 1.0);
- **Sequencing** — `admit` precedes `dispatch` (typed sequence error
  otherwise); a broker-side dispatch refusal releases the admission;
- **Settlement** — the W914 usage record lands in the R408 ledger with
  the `sporta-managed` label, the in-flight slot frees, and consumption
  is ledger-derived (a fresh seam over the same durable ledger re-derives
  it — restart-safe, cache-free truth).

## Supporting modules

- `src/credentials.ts` — the presentation vocabulary, the
  master-password refusal, sha-256 fingerprints, display labels;
- `src/store.ts` — the W004-pattern connection record store (port +
  in-memory + sqlite; idempotent puts, counted duplicates, fail-loud
  conflicts, integrity-checked reads, NUL-free scopes, bounded);
- `src/schema.ts` — the shared versioned documents (records, status
  reports);
- `src/policy.ts` — the versioned DATA policy (selection defaults +
  managed thresholds), pinned by `fixtures/golden/default-policy.json`;
  unknown keys are IGNORED (config, not code — the camera-director
  posture).

## Honest boundaries (documented, not hidden)

- The center cannot SEMANTICALLY prove a presented string is scoped (a
  provider's server-side scope is unknowable from the product plane) —
  it enforces the closed KIND vocabulary and the provider's own
  verification call is the authority (the R402-R405 posture, unchanged);
- Runtime adapter bindings are in-memory: after a restart the durable
  records survive and `verify` fails loudly
  (`ConnectionBindingAbsentError` — re-present the credential to
  rebind); the center never fabricates a binding;
- `summary().spendUsd` is `null` for BYOC records — no provider price is
  known to Sporta, so no price is invented;
- In-flight alarm events are session-scoped (the LEDGER is the durable
  usage truth; alarms are operational signals);
- The package reads NO environment and NO wall clock: everything is
  injected (providers, facts, stores, clocks) — composition belongs to
  the app's composition root, which composes
  `@sporta/compute-provider-adapters`' env seam when it needs it
  (test-pinned fail-closed).

## Test tiers

- **Live** (`test/live.test.ts`): the full product plane over the REAL
  `provider.local` adapter (REAL `Bun.spawn` subprocesses, the REAL
  nvidia-smi probe, the REAL wall clock for measured execution);
- **Recorded-fixture** (`test/connections-remote.test.ts`): consumes the
  pins committed under `packages/compute-provider-adapters/fixtures/`
  (never re-recording them) through the REAL `ModalComputeAdapter` REST
  mapping;
- **Conditional integration** (`test/integration.env.test.ts`): REAL REST
  calls against the real provider endpoints, gated on the documented env
  names (`MODAL_TOKEN_ID`, `LIGHTNING_API_KEY`, `RUNPOD_API_KEY`);
- **Contract + boundary + vocabulary** (`test/*.test.ts`): the W004
  store semantics, the closed vocabularies, the policy golden, the
  no-env / no-wall-clock / no-credential-value / no-vendor-name
  constitutions.

## Dependencies

Runtime: `@sporta/compute-adapter`, `@sporta/compute-provider-adapters`,
`zod`. Dev: `@types/bun`. Nothing else — no SDKs, no env readers, no wall
clocks (the seam-allowed set was wider; only the imported minimum is
declared).
