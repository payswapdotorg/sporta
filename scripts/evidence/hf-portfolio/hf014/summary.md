# HF014 — the Camera Director integration (the provider-neutral camera intent/path emission)

**Verdict: the integration DELIVERED as code, executed, and machine-checked. NO model ran (the wave's HF010-013 refusals stand) — this evidence is the INTEGRATION, honestly labeled: the Camera Director now emits a provider-neutral camera intent/path document consumed by neural or procedural renderers; model selection remains Technology Plane configuration.**

## The acceptance (verbatim, `docs/work-items/hf-model-portfolio-work-items.md`)

> "Camera Director emits a provider-neutral camera intent/path consumed by neural or procedural renderers; model selection remains Technology Plane configuration."

## What was built (the code, ADDITIVE to `packages/camera-director`)

| Module | Role |
| --- | --- |
| `src/intent.ts` | `emitCameraIntent(plan, steps, options?)` → `CameraIntentDocument` — the provider-neutral emission: per directed window, the window's canonical slot + the W601 slot geometry (`CANONICAL_CAMERA_SLOTS`, `camera-slots@1`) resolve to a deterministic **slot-hold** parametric path in the hf010 pose vocabulary (`frameIndex/tMs/eye/look/focalMultiplier/sourceFrame` exactly), with per-window provenance (which rule fired, the slot-geometry version, the plan's decision record **verbatim**). Fail-closed admission (`intent-invalid` / `plan-invalid` / `budget-exceeded`); pure and deterministic. |
| `src/intent-validate.ts` | `validateIntentDocument(value)` — the fail-closed structural validator (the `validate.ts` convention: unknown keys ignored, every value rule test-pinned). |
| `src/intent-selfcheck.ts` | `checkCameraIntent(intent, steps)` — the invariant harness (the `selfcheck.ts` convention: stable violation ids — `intent-shape` / `pose-vocabulary` / `slot-geometry` / `pose-resolution` / `provenance-carried` / `timeline-consistency` / `summary-consistency`). |
| `test/intent.test.ts` | The ADDITIVE battery (31 tests): slot-to-pose resolution per canonical slot (all five), the frame grid + monotone in-run `sourceFrame`, the fixture-class shape, provenance-carried, determinism (byte-identical), fail-closed admission, the validator's negative cases, the selfcheck's per-id negative fixtures, and the BOTH-CONSUMER-CLASSES integration. |

The CameraPlan is NEVER replaced or re-directed — the emission is a derivation from it. The procedural path (`compose.ts` / `render3dDirectedMatch` / the `styleConfig.config.cameraSlotId` seam) is UNCHANGED (the only existing-file touches in the package are +1 closed-vocabulary error kind in `errors.ts` and the barrel exports in `index.ts` — additive lines, zero behavior change; the pre-existing 141-test battery passes unmodified).

## The honest derivation boundary (recorded, not hidden)

The director's decision vocabulary is **slot CUTS only** (POLICY.md §7: fixed W601 geometry — no camera motion, no zoom), so the emission's ONE intent kind today is `slot-hold`: every pose of a window carries the SAME `eye`/`look` (the slot's constants, verbatim) and `focalMultiplier` 1.0 (the renderer-3d fixed-focal posture). The motion-intent kinds of the hf010 fixtures (dolly-in/orbit/pan/crane/zoom-optical/bullet-time-orbit) remain the hand-AUTHORED fixture classes — the director honestly emits the decision it made, never a motion it did not. The intent-kind vocabulary is extensible when the director gains a motion grammar, without changing the pose vocabulary.

## Both consumer classes (the acceptance's core — EXECUTED)

- **Procedural** (code UNCHANGED): `render3dDirectedMatch` composes the plan through renderer-3d's own `cameraSlotId` seam. Executed on the representative plan: every realized camera block's position/target deep-equals **every** pose's eye/look, and the plan's decision records ride verbatim — `results/integration-checks.json` (3/3 windows ✓).
- **Neural** (the adapter seam, deliberately in the evidence/benchmark plane — `neural-consumer-adapter.ts`): produces the **hf010-fixture-CLASS** JSON FROM the emission (`results/neural-consumer-paths.json`, `hf014.neural-consumer-paths@1`, classOf `hf010.camera-paths@1`), with the poses **carried verbatim** (byte-checked) — the SAME emission feeds both consumer classes.

## Determinism (proven twice)

`results/determinism.json`: two independent emissions of the same plan/steps/options are JSON-byte-identical; `results/camera-intent.json` is sha256-pinned (`83e9e5a6a882d28da6f5d63281bbec833cbc6f22eaaaab567170724324867f7f`) — re-running `emit-intent.ts` regenerates it byte-identically. The same proof is pinned in the package battery (`test/intent.test.ts`).

## The representative plan (the emitted document's input)

The camera-director package's canonical 7-step fixture (a possessed striker walking midfield → the x105 final third, one goal candidate at 5 500 ms) directed by the default `broadcast-classic` policy: 3 windows — possession-follow live `[1000,5000]@main-touchline`, event-focus live `[5000,7000]@behind-goal-x105` (the goal), replay-emphasis review `[3000,7000]@behind-goal-x105` — all three director rules and both presentation kinds, emitted at 16 fps (the hf010 fixture cadence): 160 poses.

## The Technology-Plane boundary (no model names)

The emission carries NO model name, NO provider name, NO conditioning format — the acceptance's own constraint. HF010's `results/contract-compatibility.json` records the per-candidate conditioning gap table (lens-parameter maps-with-adapter / keyframe-path maps / preset-indexed partial); those conversions belong to candidate-specific Technology-Plane adapters, never to this seam. HF012's two recorded decisions (the SWM-state-to-performance-video adapter + the authorized-avatar-reference provisioning) are ANIMATION-lane concerns — adjacent, referenced here, not built (the scope boundary).

## The gates this evidence stands on (all EXECUTED)

- `bun test packages/camera-director` — **172 pass / 0 fail** (the pre-existing 141 UNMODIFIED + 31 additive; expect() calls: 889 on the clean tree → 925 for the same 141 with the three new `src` modules present, because the boundary scan dynamically scans every `src` module — proving the new modules respect the isolation boundary and the no-RNG/no-clock constitution — → 3764 with the additive battery)
- `tsc --noEmit` (the package) — clean; `eslint` on every touched file — 0 errors; `prettier --check .` (whole repo) — clean
- `bun scripts/evidence/hf-portfolio/hf014/emit-intent.ts` — exit 0 (determinism ✓ validation ✓ selfcheck ✓ compose integration ✓)
- `bun scripts/evidence/hf-portfolio/hf014/neural-consumer-adapter.ts` — exit 0 (poses carried verbatim ✓)
- git-diff-verify: the FROZEN contracts + the hf010-013 evidence trees UNTOUCHED (new files only under `packages/camera-director` and `scripts/evidence/hf-portfolio/hf014/`)

## Limitations (the honest edges)

- The emission is `slot-hold` only (the director's actual decision class — see the boundary above); the hf010 motion-intent kinds stay authored fixtures until a director motion grammar exists.
- The neural-consumer adapter produces the neutral fixture-class document; NO neural renderer consumed it in a run (zero executed model evidence — the wave's refusals stand; HF015 owns every promotion adjudication).
- The frame grid is the emission-parameter cadence (default 16 fps), half-open `[start, start + N·interval)` per window (the renderer's fixed-rate clip convention and the hf010 fixture convention); the match's final snapshot tail is the composition's own convention, not re-invented here.

**No model ran. No promotion. Model selection stays Technology Plane configuration.**
