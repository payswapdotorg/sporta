# Multi-Reality Create Contract

Status: FROZEN FOR IMPLEMENTATION (Wave 0, 2026-09-20)
Related: docs/testing/mvp-user-journey-simulation.md (Journey 2), docs/work-items J004, ADR-009

These are logical contracts. Concrete TypeScript schemas may differ in syntax
but must preserve the semantics. This freezes the "one submission = one render
plan for all selected realities" boundary so Worker C can implement J004
without ambiguity, per the Tech-Lead handoff's shared-contract freeze list.

## 1. Submission shape

`POST /api/create/upload-sessions` (the existing real upload route) gains one
additional multipart field:

```
realities — the DERIVED reality kinds requested in this ONE submission.
            A JSON array of strings or repeated form fields.
            Values: "tactical" | "three-d-game" | "anime-npr"
            (the DERIVED_REALITY_PRODUCERS kinds; "original" is NOT a
            selection — the admitted media job's normalization ALWAYS
            produces the original-reality artifact.)
```

The Create Studio UI sends this field with the user's multi-select. Absence
of the field preserves today's behavior (upload + original only) — the field
is additive and backward-compatible.

## 2. Render plan semantics

After the upload's media job reaches its stored-original state, the studio
service dispatches ONE async render per selected derived reality, through the
SAME control-plane async surface and compute-selection directive the single
render path uses today (`createRenderAsync` → the W914 seam):

- each kind resolves to its producer renderer through the composition's
  frozen producer map (tactical.prototype / game-3d.prototype /
  anime-npr.prototype);
- one compute selection directive covers the whole plan (the user's
  sporta-auto or user-explicit choice — no per-reality re-selection);
- per-reality failures are honest and independent: one reality refusing
  (rights, producer-unavailable, compute refusal) never silently cancels the
  others; each refusal is surfaced in the plan's state with its typed
  failure class;
- the 201 answer carries the plan: per-reality renderId/jobId/state plus the
  honest perception summary (unchanged).

## 3. Durable result state

The plan's per-reality states ride the EXISTING job/render surfaces
(`GET /api/create/sessions/[sessionId]`, Jobs, Watch availability) — no new
state machine, no second source of truth. Watch's availability states
(`requires-render` / `processing` / `ready` / failed) remain the single
renderer-availability truth per reality.

## 4. Explicit non-goals

- No change to the single-render `POST /api/create/sessions/[sessionId]/renders`
  route (it remains the additional/future-render surface).
- No renderer registration changes; only registered producers are offered.
- No rights semantics change: the upload's rights declaration gates every
  derived render fail-closed exactly as today.

## 5. Compatibility

Additive to the existing upload route and the frozen render/job contracts.
No SWM, renderer-contract, or streaming-contract shape changes. Workers
implementing J004 raise a contract-change request if this shape proves
infeasible — they do not patch around it.
