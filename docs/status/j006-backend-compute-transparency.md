# J006 Backend — Compute Transparency API Shapes (Worker C handoff)

Status: IMPLEMENTED (Worker B, Wave 2) — branch `work/j006b-j014-l006-l009`
Related: J006 (compute transparency), R506, R507, R408, `docs/status/mvp-and-live-reality-status.md`

This document is the EXACT wire-shape contract for the J006 UI (Worker C's
lane). Every shape below is served by routes that exist on this branch; the
route-level test battery `apps/web/test/j006-compute-transparency.test.ts`
pins each field. Nothing here is speculative.

## The six acceptance fields (the vocabulary)

1. `computeSource` — whose compute (the R408 execution-ownership vocabulary)
2. `provider` — the provider id (DATA — never a vendor name in contracts)
3. `selectionReason` — why this provider (the director's closed vocabulary)
4. `measuredAllowanceCost` — allowance states, estimates and METERED usage
   (each labeled; estimates never masquerade as measurements)
5. `privacyPosture` — the applied preference + the provider's declared zone
6. `fallbackState` — the substitution posture (refusals, invariants)

## 1. Plane-level — `GET /api/create/compute-status`

Authenticated (cookie/bearer); anonymous → the typed 401. The answer gains
`transparency` (the legacy `plane`/`quotas`/`usage` members are unchanged
for compatibility — the same data, one document):

```jsonc
{
  "plane": { /* unchanged R506 shape */ },
  "quotas": [ /* unchanged W901 QuotaState rows */ ],
  "usage": [ /* unchanged metered totals (null = unmeasured) */ ],
  "transparency": {
    "computeSource": {
      "executionOwnership": "sporta-managed",   // or "user-owned-provider"
      "provider": "in-process",                 // the composition's provider kind
      "adapterId": "compute.in-process.v1"      // the W914 descriptor id
    },
    "provider": { "providerId": "compute.in-process.v1" },
    "selectionReason": {
      "kind": "deployment-configured",
      "detail": "this deployment's compute plane is env-configured at composition (not a per-request selection); per-render selection reasons ride each job's selection explanation"
    },
    "measuredAllowanceCost": {
      "allowance": [ /* the W901 QuotaState rows (fail-closed entries on unreadable counters) */ ],
      "measuredUsage": [ /* { unitId, quantity } — null when unmeasured */ ],
      "note": "allowance = the W919 per-user daily quota states …"
    },
    "privacyPosture": {
      "zone": "sporta-managed",                 // the operator's declared zone
      "capabilityClasses": ["cpu-worker"]
    },
    "fallbackState": {
      "registeredProviders": 1,                 // a real count from the seam
      "posture": "single-provider-plane",       // "no-plane" | "single-provider-plane" | "multi-provider-plane"
      "dispatchInvariant": "…fail-loud invariant string…",
      "explicitSelectionPolicy": "…refusal-not-substitution string…"
    }
  }
}
```

NO-PLANE FAIL-CLOSED: with no compute plane configured, `plane` is `null`
and `transparency.computeSource` / `provider` / `selectionReason` are
`null`, `privacyPosture.zone` is `null`, and
`fallbackState.{registeredProviders: 0, posture: "no-plane"}` — never an
invented fact.

## 2. Selection-level — every selection-carrying surface

The SAME `selection` record (type `StudioComputeSelectionRecord`) rides:

- `POST /api/create/compute-preview` → `answer.selection` (plus a TOP-LEVEL
  `transparency` member carrying the same document)
- `POST /api/create/sessions/[sessionId]/renders` → `answer.selection`
  (present only when the dispatch carried a compute directive)
- `GET  /api/create/sessions/[sessionId]/jobs/[jobId]` → `job.selection`
- `GET  /api/create/sessions/[sessionId]` → `state.jobs[].selection`
- `GET  /api/watch/[sessionId]` → `renders[].compute` (the SAME record —
  the Watch surface's provenance; present only for directive dispatches
  seen by THIS instance; honestly absent otherwise)

```jsonc
"selection": {
  "providerId": "compute.in-process.v1",
  "mode": "user-explicit",                     // or "sporta-auto"
  "explanation": { /* the R407 SelectionExplanation, VERBATIM */ },
  "transparency": {
    "computeSource": { "executionOwnership": "sporta-managed", "provider": "in-process", "adapterId": "compute.in-process.v1" },
    "provider": { "providerId": "compute.in-process.v1" },
    "selectionReason": {
      "reason": "explicit",                    // the director's closed-vocabulary key
      "mode": "user-explicit"
    },
    "measuredAllowanceCost": {
      "estimate": {                            // the WINNER's broker quote (honest nullables)
        "estimatedCostUsd": null,              // null = provider cannot estimate — never a guess
        "estimatedQueueSeconds": null,
        "source": "broker-quote"
      },                                       // null when no quote was produced
      "measured": {                            // ONLY at job terminal state (jobs route);
        "units": [{ "unitId": "cpu-ms", "quantity": 4310 }],
        "source": "compute-adapter-metering"
      }                                        // null before — estimates and measurements stay separate
    },
    "privacyPosture": {
      "appliedPreference": "privacy-any",      // the preference both modes applied
      "providerZone": "sporta-managed"         // the selected provider's declared zone
    },
    "fallbackState": {
      "mode": "user-explicit",
      "requestedProviderId": "compute.in-process.v1",  // null in auto mode
      "selectedProviderId": "compute.in-process.v1",
      "substitutedFromRequested": false,       // ALWAYS false on success (see refusal below)
      "refusedBeforeSelection": [              // every considered provider that lost,
        {                                      // with its typed reason (auto mode can list;
          "providerId": "…",                   // explicit mode lists the requested one on refusal paths)
          "brokerRefusalReason": "provider-unavailable",   // when the broker refused it
          "preferenceExclusionAxis": "privacy",           // when a preference axis excluded it
          "message": "…honest evidence line…"
        }
      ],
      "policy": "explicit-selection-refuses-instead-of-substituting"
    }
  }
}
```

## 3. The refusal posture (never a silent substitution)

`POST /api/create/compute-preview` (and the dispatch route) with an
explicit directive the director cannot honor answers the typed **422**:

```jsonc
{
  "error": {
    "failureClass": "resource-limit",           // or "media-invalid" (the closed aggregate vocabulary)
    "message": "the explicitly selected provider '…' was refused by the broker (…) — an explicit selection never silently falls back",
    "details": {
      "requestedProviderId": "provider.does-not-exist",
      "refusals": [ /* every recorded reason, VERBATIM */ ]
    }
  }
}
```

The UI shows these verbatim — the user learns WHY, never a smoothed
substitution.

## 4. Consistency guarantees (safe to build against)

- The `transparency` document is computed ONCE at the decision moment and
  carried everywhere the selection rides — all surfaces show the SAME
  document (no per-surface drift).
- `selection.transparency.provider.providerId` === `explanation.selectedProviderId`.
- `substitutedFromRequested` is `false` on every successful answer (the
  invariant is enforced fail-loud at dispatch; a substitution would have
  been a 422 instead).
- On the jobs route, `selection.transparency.measuredAllowanceCost.measured`
  appears ONLY after the job reaches a terminal state (the adapter's own
  metered cost units).
- Watch-side `renders[].compute` is ABSENT for directive-less renders and
  for renders whose dispatch this instance never saw (the documented W921
  per-instance boundary) — render the honest absence, never a placeholder
  provenance.

## 5. Live runtime note

The live tactical transport carries its OWN §9 telemetry (L006) — see
`GET /api/operations/live-telemetry` (operator-gated). It is a separate
surface from compute transparency; do not conflate the two in the UI.
