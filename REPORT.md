# Sporta — Worker 65-e Delivery Report (HF014, flight 11 — completed TL-locally after two Task-infra failures)

Branch: `work/hf014-camera-intent` (from main @ 352e02e)
Work item: HF014 — Camera Director integration (the provider-neutral camera intent/path; Worker C + Tech Lead)
Evidence tree: `scripts/evidence/hf-portfolio/hf014/` (committed in-repo)
Execution record: `results/camera-intent.json` (the emitted document, sha256 `83e9e5a6…`), `results/determinism.json` (byte-identical re-emission proof), `results/integration-checks.json` (validator + selfcheck + compose integration), `results/neural-consumer-paths.json` (the hf010-fixture-class adapter output, sha256 `d0fe183a…`, poses carried VERBATIM), `results/neural-consumer-adapter.json`.
Infra record (honest): the flight was dispatched twice via the Task-tool runner; attempt 1 died at the context deadline mid-implementation, attempt 2 was stopped at the finish line (all code + tests + evidence written; REPORT.md + commit + records missing). Per the 63-L infra-failover precedent, the TL reviewed the inherited WIP line-by-line (the 62-a adoption doctrine), re-ran every gate on own runs, and completed the last mile — this report, the commit, the records.

=== HF014 INTEGRATION REPORT ===

## The verdict

The integration DELIVERED as code, EXECUTED, and machine-checked. NO model ran (the wave's HF010-013 refusals stand) — this evidence is the INTEGRATION, honestly labeled: **the Camera Director now emits a provider-neutral camera intent/path document consumed by neural or procedural renderers; model selection remains Technology Plane configuration** (the acceptance, verbatim).

## What was built (ADDITIVE to packages/camera-director)

- **`src/intent.ts`** — `emitCameraIntent(plan, steps, options?)` → `CameraIntentDocument` (`camera-director.intent@1`): per directed window, the window's canonical slot + the W601 slot geometry (`CANONICAL_CAMERA_SLOTS`, `camera-slots@1`) resolve to a deterministic **slot-hold** parametric path in the hf010 pose vocabulary (every pose carries exactly `frameIndex/tMs/eye/look/focalMultiplier/sourceFrame`), with per-window provenance (which rule fired, the slot-geometry version, the plan's decision record VERBATIM — a structural deep clone, the no-invented-data rule). Fail-closed admission: `intent-invalid` (non-finite/non-positive frameRate), `plan-invalid` (the plan invariant harness re-run against the steps — the compose posture), `budget-exceeded` (the pose count bounded by the renderer-3d MAX_RENDER_FRAMES, the same budget the composed procedural render enforces). Pure function: no clock, no RNG, no I/O; JSON-byte-identical determinism (fixed key order + 3-decimal time quantization — the hf010 fixture byte-stability convention), test-pinned.
- **`src/intent-validate.ts`** — `validateIntentDocument(value)`: the fail-closed structural validator (the validate.ts convention: unknown keys ignored, every value rule test-pinned).
- **`src/intent-selfcheck.ts`** — `checkCameraIntent(intent, steps)`: the invariant harness (the selfcheck.ts convention: stable violation ids — intent-shape / pose-vocabulary / slot-geometry / pose-resolution / provenance-carried / timeline-consistency / summary-consistency; fail-soft for evaluation, every defect class with a negative fixture).
- **`test/intent.test.ts`** — the ADDITIVE battery: 31 tests across 6 suites (slot-to-pose resolution for EVERY canonical W601 slot, the frame grid, monotone in-run sourceFrame, the fixture-class shape, provenance verbatim, determinism byte-identical incl. the JSON-round-trip plan, the fail-closed admissions, the validator's negative cases, the selfcheck's per-id negative fixtures, and the BOTH-CONSUMER-CLASSES integration).

The CameraPlan is NEVER replaced or re-directed — the emission is a derivation FROM it. The procedural path (`compose.ts` / `render3dDirectedMatch` / the `styleConfig.config.cameraSlotId` seam) is UNCHANGED: the only existing-file touches are +1 closed-vocabulary error kind in `errors.ts` and the barrel exports in `index.ts` (additive lines, zero behavior change; the pre-existing 141-test battery passes unmodified — non-degradation PROVEN, battery now 172/172).

## The honest derivation boundary (recorded, not hidden)

The director's decision vocabulary is slot CUTS only (POLICY.md §7: fixed W601 geometry — no camera motion, no zoom), so the emission's ONE intent kind today is `slot-hold`: every pose of a window carries the SAME eye/look (the slot's constants, verbatim) and `focalMultiplier` 1.0 (the renderer-3d fixed-focal posture). The motion-intent kinds of the hf010 fixtures (dolly-in/orbit/pan/crane/zoom-optical/bullet-time-orbit) remain the hand-AUTHORED fixture classes — the director honestly emits the decision it made, never a motion it did not. The intent-kind vocabulary is extensible when the director gains a motion grammar, without changing the pose vocabulary.

## Both consumer classes (the acceptance's core — EXECUTED)

- **Procedural**: the emission's slot geometry EQUALS the composed procedural render's realized camera blocks (verified per window — the `compose` path UNCHANGED and the same plan feeding both).
- **Neural**: `scripts/evidence/hf-portfolio/hf014/neural-consumer-adapter.ts` consumes the emission and produces the hf010-fixture-class JSON (`hf014.neural-consumer-paths@1`, poses carried VERBATIM) — the SAME emission feeds the class the wave's benchmark fixtures speak. The adapter lives in the EVIDENCE plane, not the domain: the adapter to any specific model's conditioning format is Technology Plane configuration (NO model name, NO provider name, NO conditioning format in the domain contract — architecture-lock §9, the technology-plane doctrine, HF001).

## The Technology-Plane boundary (the acceptance's own constraint)

`emitCameraIntent` and `CameraIntentDocument` carry zero model/provider/conditioning names. The `frameRate` emission parameter is an explicitly-labeled Technology-Plane cadence decision (never a plan field — the plan stays presentation-format-independent data).

## Gates (TL, re-run on own runs)

- `bun test packages/camera-director`: **172 pass / 0 fail / 3,764 expects** (the pre-existing 141 UNMODIFIED + 31 additive).
- `bun scripts/evidence/hf-portfolio/hf014/emit-intent.ts`: 3 windows / 160 poses @ 16 fps; determinism byte-identical; validator ok; selfcheck ok; compose integration 3/3.
- `bun scripts/evidence/hf-portfolio/hf014/neural-consumer-adapter.ts`: poses carried VERBATIM, sha-pinned.
- `typecheck-series`: 73/73. `prettier --check .`: clean (whole repo). `eslint`: 0 errors.
- FROZEN contracts + the hf010/hf011/hf012/hf013 trees: git-diff-verified untouched.

## Limitations + the promotion-gate referral

No model consumed the emission (the wave's refusals stand — the adequate-host question is HF015's). The intent-kind vocabulary is slot-hold only (the honest boundary above). HF012's two recorded ANIMATION-lane decisions (the SWM-state-to-performance-video adapter + the authorized-avatar-reference provisioning) are referenced, not built. No promotion claim anywhere.

=== END REPORT ===
