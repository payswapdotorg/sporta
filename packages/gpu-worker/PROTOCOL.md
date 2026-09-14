# PROTOCOL.md — the GPU worker protocol contract (W303)

**Package:** `@sporta/gpu-worker` · **Status:** implemented, test-proven with
in-process fixtures · **Authority:** this document is the package-local
protocol contract. The frozen cross-package authorities (architecture lock,
streaming contract) are cited, never re-stated as code-facing rules.

## 1. Scope and posture

W303 defines the protocol between a **dispatcher** (the platform side: job
queue, leases, accounting) and **workers** (the execution side: heartbeats,
claims, execution, reports). The acceptance criterion — "jobs, heartbeats,
results, retries, timeouts, and resource metadata are defined" — is met by
this document plus the typed surfaces in `src/`:

- `GpuJobEnvelope` / `GpuJobResult` (§2),
- `GpuWorkerCapabilities` / `GpuHeartbeat` (§3, §6),
- `GpuDispatcherPort` / `GpuJobClaim` (§4),
- `GpuWorkerRetryPolicy` / deadline classification (§5),
- the accounting identities (§7).

This is a **PROTOCOL** package, deterministic and vendor-neutral
(architecture-lock §9): there is NO real GPU, NO worker binary, NO process,
NO network, and NO real timer anywhere in it. `GpuJobDispatcher` and
`GpuWorker` are the two in-process reference halves of the protocol; a real
deployment puts a wire (RPC / queue / socket) behind `GpuDispatcherPort` and
real GPU work behind the `GpuJobExecutor` seam. Every timing decision reads
the injected `GpuClock` (§8); nothing reads wall time.

The protocol types are **package-local TypeScript interfaces with
hand-written fail-loud validation** (the W302 `validatePipelineSegment`
posture — no schema dependency). This is a deliberate decision: W303 is a
single-package protocol; no cross-package wire stability is claimed.
Promotion into `@sporta/contracts` (zod schemas + golden fixtures) is a
tech-lead-owned change for when W304+ needs another package to consume these
shapes — that is the documented compatibility policy (§9).

## 2. Job and result envelopes

### 2.1 `GpuJobEnvelope` (submitter → dispatcher)

| Field            | Type                 | Semantics                                                                                                                                                      |
| ---------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `jobId`          | non-empty string     | Per-job identity, caller-authored; unique per dispatcher — a NEW key re-using an admitted job's `jobId` is a typed refusal (`MalformedJobError`, reason `job-id-collision`). Re-submitting a KNOWN key is checked FIRST and resolves as a counted duplicate even when the `jobId` repeats (an idempotent submit retry is never a collision).            |
| `idempotencyKey` | non-empty string     | Dedupe/claim-once identity — the streaming-contract Recovery rule (§4).                                                                                        |
| `kind`           | non-empty string     | Work class (abstract routing key — NOT GPU-specific; e.g. `encode`, `detect`).                                                                                 |
| `payloadRef`     | non-empty string     | Opaque payload descriptor. The PROTOCOL never interprets it; the executor seam resolves it (a fixture reads a table, a real deployment resolves model inputs). |
| `priority`       | integer              | Scheduling order: higher value claimed earlier; ties break by submission sequence (ascending). Deterministic total order.                                      |
| `requirements`   | optional object      | Declared resource needs: `memoryMb` (finite ≥ 0), `modelClass` (non-empty). Advisory metadata (§6).                                                            |
| `deadlineMs`     | finite number > 0    | Whole-job time budget FROM SUBMISSION, enforced on the injected clock (§5).                                                                                    |
| `maxAttempts`    | optional integer ≥ 1 | Claim budget — maximum lease epochs (claims) the job may consume; the dispatcher default (3) applies when absent.                                              |

Structural violations refuse at `submit()` with a typed
`MalformedJobError` (`terminalFailureClass: "media-invalid"`, structured
`details` naming the field) — counted, logged, metered — and the dispatcher
CONTINUES (one corrupt job never kills a live dispatch session).

### 2.2 `GpuJobResult` (dispatcher → submitter)

One result envelope resolves the submitter's promise EXACTLY ONCE, when the
job reaches its EXACTLY-ONE terminal disposition. **The result promise never
rejects — failures are values** (status `"failed"` with a classified
`failure`):

| Field                       | Semantics                                                                                                                                                |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `status`                    | `"succeeded"` \| `"failed"` \| `"cancelled"` (dead-lettered jobs resolve `"failed"` — see §7 for the bucket split).                                      |
| `output`                    | The executor's output, verbatim (iff succeeded).                                                                                                         |
| `failure`                   | iff failed: `errorClass` (machine), `message`, `terminal` classification (`non-retryable` \| `retry-exhausted` \| `timeout` \| `internal`).              |
| `attempts`                  | TOTAL executor invocations reported across all claims (honest sum; see §4).                                                                              |
| `claims`                    | Total lease epochs consumed.                                                                                                                             |
| `retriesUsed`               | `attempts − claims` — CAN BE NEGATIVE when claims went unreported (a crashed worker's invocations are unknowable; the protocol never invents them — §4). |
| `timing`                    | Measured on the injected clocks (§5).                                                                                                                    |
| `correlationId` / `traceId` | W007 correlation context, per-submit overridable.                                                                                                        |

## 3. Heartbeats and staleness

- A worker's heartbeat period is its own declaration
  (`heartbeatIntervalMs`, validated at registration: `leaseMs ≥
heartbeatIntervalMs` and `staleAfterMs ≥ heartbeatIntervalMs` — a shorter
  lease would expire between renewals and a shorter threshold would declare
  every live worker stale; both are refused fail-closed as
  misconfigurations).
- Heartbeats carry a **monotone sequence** (strictly increasing integers per
  worker) plus advisory load telemetry: `inFlight` job count and
  `advisoryMemoryInUseMb` (§6). Non-monotone or unknown-worker heartbeats
  are REFUSED, counted (`rejectedHeartbeats`, labeled reason), and logged —
  never silently ignored.
- **Staleness detection** is dispatcher-side on the DISPATCHER's clock
  (receipt time; worker time claims like `dueMs` are telemetry only): no
  accepted heartbeat for `staleAfterMs` (default 10 000 ms) ⇒ the worker is
  stale. Its in-flight jobs are accounted **FAILED-LOUD** with the
  `worker-stale` error class and `terminal: "timeout"` classification —
  never silently reassigned. A later heartbeat from a stale worker is a
  **rejoin**: fresh liveness, old jobs stay failed
  (`workerRejoins` counter). A revived worker's heartbeat must carry a
  sequence HIGHER than the last accepted one — a restarted process that
  lost its sequence (and restarts at 1) is refused until it re-registers
  (`registerWorker` is the documented fresh-registration rejoin, which
  resets the sequence) — no sequence-reset ambiguity, fail-closed.
- Lease renewal is the heartbeat's second duty: every accepted heartbeat
  extends each of the worker's live leases to `now + leaseMs` (forward only).

## 4. Dispatch, lease, and idempotency semantics

Claiming: `claimJob(workerId)` grants the highest-priority ready job
(priority desc, submission sequence asc) the worker can run (capacity +
declared requirements), parking FIFO when nothing is eligible. Matching is
job-major — a job is offered to the first parked claimer that can run it, so
an ineligible claimer never head-of-line-blocks an eligible one.

Lease semantics (all on the injected clock):

- A grant mints a lease: `leaseId` (unique, reports must carry it),
  `claimOrdinal` (1-based lease epoch), `leaseExpiresAtMs = now + leaseMs`
  (default 30 000 ms, renewed by every accepted heartbeat).
- **Lease expiry** ⇒ the job is requeued (counted `requeues`, ledgered) while
  the claim budget lasts; claim-budget exhaustion (`claims >= maxAttempts`)
  ⇒ dead-letter with the `lease-expired` error class and
  `terminal: "retry-exhausted"` — the W302 bounded-recovery posture.
- A report racing its own lease expiry LOSES to the sweep if the expiry
  already passed: the report is counted `superseded` (`lateResults`),
  never silently dropped.

Idempotency (the streaming-contract Recovery rule): a KNOWN
`idempotencyKey` — in flight OR terminally disposed, and even when the
`jobId` is the known job's own id (an idempotent submit retry) — resolves
`{ disposition: "duplicate" }`, is counted (`duplicates`), and is skipped.
The key check runs BEFORE the jobId-collision check, so "same key = counted
duplicate" is unconditional; the collision refusal applies only to a NEW key
re-using an admitted job's id (a genuine identity conflict). The honest
semantics this buys:

- **Claims are exactly-once per key**: a key maps to at most one job record;
  a re-submission can never produce a second claimable job.
- **Execution is at-least-once**: a lease-expiry requeue (or a shutdown
  cancel) may re-acquire the key's job for another claim. Downstream
  consumers must dedupe on the key — the contract's own rule.
- **Unreported attempts are unknowable and never invented**: a worker that
  dies mid-execution leaves `attempts < claims` on the record; that is why
  `retriesUsed` can be negative — the protocol reports the honest arithmetic
  instead of fabricating retries.

Cancellation is idempotent and never loses a job: queued ⇒ removed and
CANCELLED; in-flight ⇒ CANCELLED immediately, with the executing worker's
eventual report counted `superseded` (a promise cannot be killed; its outcome
is never silently dropped). Cancelling a terminal job is a counted no-op
returning the existing disposition; cancelling an unknown job throws typed
`UnknownJobError` (a cancel that "succeeds" against an unknown job would be
a silent lie).

## 5. Retries, timeouts, and result timing

Retries (worker-side, per claim): the `GpuWorkerRetryPolicy` is W104
arithmetic VERBATIM — delay = `baseDelayMs * backoffMultiplier^(attempt − 1)`,
slept through the injected clock — with the W104 rule intact:
a failure the executor classified **non-retryable is NEVER blind-retried**
(the streaming contract's "retries where deterministic/idempotent" rule).
Default is NO retries (the W302 explicit-opt-in posture). A worker-side
budget exhaustion reports the final failure with `retryable: true`; the
dispatcher dead-letters it (`terminal: "retry-exhausted"`). A THROWN executor
fault maps to the reserved `errorClass: "internal"` (never retried,
dead-lettered as `internal` — the W302 mapping of thrown bugs).

Why the worker re-implements the W104 loop instead of importing
`@sporta/transport`'s `withRetries`: the worker's retry loop carries three
**deadline checkpoints** (`before each attempt`, `before each backoff`,
`after each backoff`) that `withRetries` has no notion of; the arithmetic is
identical and test-pinned.

Timeouts (three sources, one classification): the per-job deadline
(`submittedAtMs + deadlineMs` on the injected clock) is enforced
**absolutely and fail-closed**:

- queued past deadline ⇒ FAILED (`deadline-timeout`, `terminal: "timeout"`);
- in-flight past deadline ⇒ FAILED by the dispatcher sweep, and the live
  executor's eventual report is counted `superseded`;
- worker-side deadline checkpoints ⇒ a `timeout` report (the backstop for
  clock-skewed deployments where the worker's clock reaches the deadline
  before the dispatcher's does; the dispatcher records it when the sweep has
  not already fired).

Result timing (`GpuJobResult.timing`) is measured on the injected clocks:
`submittedAtMs` (dispatcher clock at submit), `startedAtMs` (worker clock at
the first executor invocation — absent if the job never executed),
`finishedAtMs` (dispatcher clock at the terminal disposition), `queueWaitMs`
(= `startedAtMs − submittedAtMs`, present iff executed), `executionMs` (total
worker-reported execution time). The worker's own clock and the dispatcher's
clock may legitimately be different instances (real workers are separate
processes); in-process fixtures share one clock.

## 6. Resource metadata (advisory — honestly not enforced)

`GpuWorkerCapabilities` declares `maxConcurrentJobs`, `memoryMb`,
`modelClasses`, `heartbeatIntervalMs`; jobs declare `requirements`
(`memoryMb`, `modelClass`). All classes are ABSTRACT (vendor neutrality —
no GPU vendor, no model provider, no `cuda:0`). The dispatcher uses them in
three places:

1. **Claim matching** (soft): `canRun` requires worker capacity ≥ concurrent
   leases, `memoryMb` ≥ required, `modelClasses` ∋ required class.
2. **Submit-time never-fit refusal** (loud): with at least one ACTIVE
   worker, a job whose requirements exceed EVERY active worker's declared
   capacity is refused with typed `GpuResourceLimitError`
   (`resource-limit` — the W104 posture: no silent queue-forever). With ZERO
   active workers admission is deferred (the deadline machinery fails the
   job loudly if capacity never arrives).
3. **Heartbeat telemetry** (advisory): `advisoryMemoryInUseMb` is DERIVED
   from in-flight job requirements — never measured.

**Honest limitation, stated once and binding:** declarations are TRUSTED,
never measured. A worker that lies about `memoryMb` or `modelClasses` is not
detected; actual GPU/memory usage is not enforced at runtime (no cgroups, no
device queries — deliberately, that is a deployment concern behind the seam).
`maxConcurrentJobs` IS enforced (the dispatcher refuses grants beyond it) —
it is protocol state, not a hardware claim.

## 7. Accounting: the never-silent ledger

The W303 identity, runtime-asserted at every settle (an imbalance REJECTS
`shutdown()` instead of returning a lying result):

```
jobsSubmitted === succeeded + failed + cancelled + deadLettered + duplicates
                  (+ inFlight during a run; 0 at settle)
```

The whole story — admissions, idempotent duplicates (in-flight, terminal,
and submit-retry), typed refusals, lease-expiry recovery, claim-budget
exhaustion, worker-retry exhaustion, queued + in-flight deadlines,
superseded late reports, worker staleness with a heartbeat revive,
cancellations, and one real `GpuWorker` agent (heartbeat + W104 retry
loops) — is test-pinned deep-equal across two fresh runs over the FULL
artifacts (settled result, every result envelope, every log line, the whole
metrics snapshot; `test/determinism.test.ts`), and the package suite is
double-run in two separate bun subprocesses by the verification battery.

split into exact checks (§ `assertGpuAccounting`):

1. `jobsSubmitted === admitted + duplicates`;
2. `admitted === succeeded + failed + cancelled + deadLettered + inFlight`;
3. `inFlight === queuedJobs + executingJobs`;
4. `deadLettered === dlqRetained + dlqOverflow`.

`jobsSubmitted` counts LEDGER-POPULATING submits only. A refused submission
(malformed envelope, capacity refusal) NEVER became a job: it throws a typed
error synchronously and carries its own counters (`malformedSubmissions`,
`refusedSubmissions`) OUTSIDE the terminal identity — the deliberate,
documented divergence from W302 (whose input refusals were resolved values
inside `segmentsIn`). The caller learned the refusal loudly and immediately.

`failed` vs `dead-lettered` (both resolve `"failed"`; the buckets stay
disjoint so identity 2 closes exactly):

- `failed` — a DETERMINATE terminal failure: non-retryable executor
  failure, `deadline-timeout`, or `worker-stale` (fail-loud, timeout class);
- `dead-lettered` — a RECOVERY-BUDGET exhaustion: worker-retry exhaustion,
  lease-expiry claim exhaustion (both `retry-exhausted`), or `internal`
  (thrown executor faults). Bounded DLQ; overflow is counted + logged +
  metered, never silent.

Every job carries a frozen decision-event trail (`submitted`, `claimed`,
`lease-expired`, `requeued`, `worker-stale`, `deadline-timeout`,
`cancelled`, `superseded-report`, `succeeded`, `failed`, `dead-lettered`),
timestamped on the dispatcher clock; every attempt, timeout, retry, requeue,
supersession, refusal, and rejection is counted + logged + metered +
ledgered (`reportedAttempts` counts the attempts of every
structurally-valid report — recorded, superseded, and unknown-job alike;
never silently ignored). `assertGpuLedgerConsistency` re-walks the ledger
against the stats at settle (terminal states, bucket sums, claim sums).

## 8. Clock semantics (the constitution)

`GpuClock` exposes TWO waiting primitives because the protocol has two
honest kinds of waiting:

- `sleep(durationMs)` — CONSUMES clock time (executor work duration, retry
  backoff). `VirtualGpuClock.sleep` advances virtual time immediately,
  firing every `waitUntil` deadline it crosses (in deadline order) BEFORE
  the sleeper resumes — so periodic emitters (heartbeats) keep firing while
  work consumes time.
- `waitUntil(untilMs)` — WAITS passively (heartbeat loop). An idle protocol
  consumes no time; a parked loop never spins the microtask queue.

**THE RUNAWAY RULE:** there is NO background monitor loop and NO real timer
anywhere (zero `setTimeout`/`setInterval`/`Date.now`/`performance.now` —
grep-proven). Every time-dependent decision — staleness, lease expiry,
deadlines — is evaluated by `GpuJobDispatcher.sweep()`, which runs at EVERY
port entry (register, heartbeat, claim, report) and every public entry
(submit, cancel, shutdown) BEFORE the entering operation applies. The
heartbeat stream IS the monitor in a live system (a dead peer is detected by
the first heartbeat after the threshold); `sweep()` is also PUBLIC —
deployments that want timer-driven detection call it from their own monitor.
Virtual-clock heartbeats fire at advance-crossings (one beat per crossed
deadline; timestamps exact under the stepwise-advance test convention).

## 9. Compatibility policy

- The protocol types are package-local; `@sporta/gpu-worker`'s public export
  surface (`src/index.ts`) is the ONLY compatibility boundary this package
  promises. Semver-style evolution has not started (0.1.0).
- **Promotion into `@sporta/contracts`** (zod schemas, golden fixtures,
  cross-package wire stability) is a TECH-LEAD-OWNED change, to be made when
  W304 (streaming render orchestration) or any later consumer needs these
  shapes across a package boundary. Until then nothing outside this package
  should import these types.
- The `GpuDispatcherPort` interface is deliberately narrow (four methods) so
  a wire adapter can implement it exactly; the executor seam is one method.
  No protocol message carries a function, symbol, or class instance — every
  field is JSON-safe by convention.

## 10. Honest limitations

1. **Resource metadata is advisory** (§6): declarations trusted, usage never
   measured or enforced.
2. **Execution is at-least-once across lease recovery** (§4): claims are
   exactly-once per key, executions are not. Downstream dedupes on the key.
3. **Unreported attempts of crashed workers are unknowable** — never
   invented; `retriesUsed` can honestly go negative.
4. **No wire protocol or serialization format**: the port is an in-process
   TypeScript interface; W304+ owns transport. No security (auth, TLS,
   message authentication) exists at this boundary — in-process trust only.
5. **The ledger is in-memory** and unbounded by anything but the
   admitted-job budget (the W302 `processedKeys` posture) — a real
   deployment persists/compacts it behind a storage seam.
6. **An executor that never settles cannot be killed** (the W302 posture):
   `stop({ mode: "await" })` waits for it; `stop({ mode: "abandon" })` leaves
   it running (its eventual report is counted superseded or recorded — never
   lost). A claim granted to a stopped worker is recovered by lease expiry —
   counted, never lost.
7. **Detection latency is entry-driven**: with no port entries and no
   monitor, a stale worker or expired lease is noticed only at the next
   entry (the timers-first design, §8).
8. **A `GpuDispatcherPort` implementation that THROWS** rejects the worker's
   loop promises (unhandled at the process level — loud, not silent); the
   reference dispatcher never throws after `start()`.
9. **No wall-clock-backed `GpuClock` implementation yet** — real deployments
   inject their own (both primitives map onto real waiting).
10. **Virtual-clock discretization** (§8): heartbeats fire one-per-crossed
    deadline; exact timestamps hold under stepwise advances.
