/**
 * HF014 — THE NEURAL-CONSUMER ADAPTER (the adapter seam, deliberately in
 * the evidence/benchmark plane, NOT the domain): produces the
 * hf010-fixture-CLASS JSON FROM the emitted intent document — proving the
 * SAME emission feeds both consumer classes:
 *
 *   - the PROCEDURAL consumer (renderer-3d's match path through
 *     `render3dDirectedMatch` / `styleConfig.config.cameraSlotId`)
 *     consumes the CameraPlan directly — code UNCHANGED this flight;
 *   - the NEURAL consumer class consumes per-frame poses in the
 *     hf010-authored vocabulary — THIS adapter converts the emission into
 *     that document class (per-frame `tMs/eye/look/focalMultiplier/
 *     sourceFrame` + window/slot/kind), carrying the poses VERBATIM
 *     (never re-derived: the carried bytes are checked).
 *
 * Which renderer/model actually consumes this document is Technology
 * Plane configuration (architecture-lock §9, technology-plane.md, HF001):
 * the adapter carries NO model name, NO provider name, NO conditioning
 * format — it emits the neutral document class only. HF010's
 * contract-compatibility table records the per-candidate conditioning
 * gaps (the lens-parameter / keyframe-path / preset-indexed classes) —
 * those conversions belong to candidate-specific Technology-Plane
 * adapters, never to this seam.
 *
 * Run: bun scripts/evidence/hf-portfolio/hf014/neural-consumer-adapter.ts
 * (reads results/camera-intent.json produced by emit-intent.ts; writes
 *  results/neural-consumer-paths.json + results/neural-consumer-adapter.json;
 *  exits non-zero on any failed check)
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

import { validateIntentDocument, checkCameraIntent } from "../../../../packages/camera-director/src/index.ts";
import { buildDirectorMatch } from "../../../../packages/camera-director/test/helpers.ts";
import type { CameraIntentDocument } from "../../../../packages/camera-director/src/index.ts";

const resultsDir = new URL("./results/", import.meta.url).pathname;

/** The adapter's own output-family version (the hf010 CLASS, distinct id). */
const ADAPTER_FAMILY_VERSION = "hf014.neural-consumer-paths@1";

/** sha256 of a string's utf-8 bytes. */
function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

// 1. READ THE EMISSION (the same document the procedural side consumed).
const intentBytes = readFileSync(`${resultsDir}camera-intent.json`, "utf8");
const intent = JSON.parse(intentBytes) as CameraIntentDocument;
const intentSha = sha256(intentBytes);

// 2. ADMIT IT (fail-closed: the validator + the selfcheck against the steps).
const validation = validateIntentDocument(intent);
const selfcheck = checkCameraIntent(intent, buildDirectorMatch());
if (!validation.ok || !selfcheck.ok) {
  console.error(
    `HF014 neural-consumer adapter refused the emission:\n` +
      `  validation: ${validation.ok ? "ok" : validation.issues.join("; ")}\n` +
      `  selfcheck: ${selfcheck.ok ? "ok" : selfcheck.violations.join("; ")}`,
  );
  process.exit(1);
}

// 3. ADAPT: the hf010-fixture-CLASS document FROM the emission.
//    The poses are carried VERBATIM (the same objects — never re-derived);
//    every other field is a fixed-template function of the intent window.
const adapted = {
  fixtureSetVersion: ADAPTER_FAMILY_VERSION,
  classOf: "hf010.camera-paths@1",
  authoredBy:
    "Worker 65-e (HF014, flight 11 — the Camera Director integration): ADAPTED from the camera-director emission (deterministic derivation, not hand-authored poses) — the hf010 fixtures were hand-authored by Worker 65-a; this document is the same CLASS emitted by the director's own CameraPlan",
  adaptedFrom: {
    document: "results/camera-intent.json",
    intentVersion: intent.intentVersion,
    sha256: intentSha,
    directorVersion: intent.directorVersion,
    policy: intent.policy,
    emissionFrameRate: intent.emission.frameRate,
  },
  vocabularyProvenance: {
    cameraPlanLanguage:
      "packages/camera-director/src/types.ts (DirectedWindow: index/kind/source/cameraSlotId/decision; CameraPlan: directorVersion/policy/timeline/windows/summary)",
    cameraIntentEmission:
      "packages/camera-director/src/intent.ts emitCameraIntent (HF014 — the provider-neutral emission this document is adapted FROM)",
    canonicalSlots:
      "packages/scene-projection/src/constants.ts CANONICAL_CAMERA_SLOTS (the five W601 slots; the geometry echoed below VERBATIM from the emission's slotGeometry block)",
    presentationKinds: ["live", "review"],
    poseVocabulary: intent.poseVocabulary,
    rendererSeam:
      "the procedural consumer consumes the CameraPlan through renderer-3d's styleConfig.config.cameraSlotId seam (compose.ts, UNCHANGED); the neural consumer class consumes THIS document; model selection is Technology Plane configuration",
  },
  pitchGeometry: intent.pitchGeometry,
  canonicalSlots: Object.fromEntries(
    intent.slotGeometry.slots.map((slot) => [
      slot.slotId,
      { eye: { x: slot.eye.x, y: slot.eye.y, z: slot.eye.z }, look: { x: slot.look.x, y: slot.look.y, z: slot.look.z } },
    ]),
  ),
  timeline: intent.timeline,
  determinism:
    "the adapter is a pure function of the emission document: fixed-template descriptions, poses carried VERBATIM (byte-checked), no RNG, no solver, no fitting; re-running the adapter reproduces this file byte-identically",
  sourceTimeConvention: intent.emission.sourceTimeConvention,
  windows: intent.windows.map((window) => ({
    fixtureId: `hf014-intent-w${window.index}-${window.path.anchorSlotId}`,
    intentKind: window.path.intentKind,
    anchorSlotId: window.path.anchorSlotId,
    presentationKind: window.kind,
    intentDescription:
      `slot-hold: the director held the ${window.path.anchorSlotId} W601 slot geometry for the ` +
      `${window.kind} window [${window.source.startMs}, ${window.source.endMs}] (rule: ${window.provenance.ruleId}); ` +
      `every pose carries the slot's eye/look verbatim, focalMultiplier 1.0 (the fixed-focal posture), ` +
      `${window.path.frameCount} poses at ${window.path.fps} fps; source frames advance monotonically through the window's snapshot run`,
    source: { kind: "camera-director-intent", slotRendered: window.path.anchorSlotId },
    window: { startMs: window.source.startMs, endMs: window.source.endMs },
    frameCount: window.path.frameCount,
    frameIntervalMs: window.path.frameIntervalMs,
    fps: window.path.fps,
    spec: {
      anchorEye: [window.path.poses[0]!.eye.x, window.path.poses[0]!.eye.y, window.path.poses[0]!.eye.z],
      anchorLook: [window.path.poses[0]!.look.x, window.path.poses[0]!.look.y, window.path.poses[0]!.look.z],
      focalMultiplier: window.path.poses[0]!.focalMultiplier,
    },
    // THE CARRY: the emission's own pose objects, verbatim (never re-derived).
    poses: window.path.poses,
  })),
};

const adaptedBytes = `${JSON.stringify(adapted, null, 2)}\n`;
writeFileSync(`${resultsDir}neural-consumer-paths.json`, adaptedBytes);

// 4. THE CARRY CHECK: every adapted window's poses are BYTE-IDENTICAL to the
//    emission's poses (the same emission feeds the neural consumer class).
const posesCarriedVerbatim = intent.windows.every((window) => {
  const adaptedWindow = adapted.windows.find((entry) => entry.fixtureId === `hf014-intent-w${window.index}-${window.path.anchorSlotId}`)!;
  return JSON.stringify(adaptedWindow.poses) === JSON.stringify(window.path.poses);
});

writeFileSync(
  `${resultsDir}neural-consumer-adapter.json`,
  `${JSON.stringify(
    {
      label:
        "HF014 neural-consumer adapter (the evidence-plane seam): the hf010-fixture-CLASS document produced FROM the emission",
      input: {
        document: "results/camera-intent.json",
        sha256: intentSha,
        validationOk: validation.ok,
        selfcheckOk: selfcheck.ok,
      },
      output: {
        document: "results/neural-consumer-paths.json",
        sha256: sha256(adaptedBytes),
        fixtureSetVersion: ADAPTER_FAMILY_VERSION,
        classOf: "hf010.camera-paths@1",
        windowCount: adapted.windows.length,
        poseCount: adapted.windows.reduce((total, window) => total + window.poses.length, 0),
      },
      posesCarriedVerbatim,
      technologyPlaneBoundary:
        "NO model/provider/conditioning names anywhere in the domain emission or this adapter output; which renderer consumes this document is Technology Plane configuration (the hf010 conditioning-gap table records the per-candidate conversion classes)",
      noModelRan: true,
    },
    null,
    2,
  )}\n`,
);

if (!posesCarriedVerbatim) {
  console.error("HF014 neural-consumer adapter FAILED: the poses were not carried verbatim");
  process.exit(1);
}
console.log(
  `HF014 neural-consumer adapter: ${adapted.windows.length} windows / ` +
    `${adapted.windows.reduce((total, window) => total + window.poses.length, 0)} poses ` +
    `(class ${ADAPTER_FAMILY_VERSION}, poses carried VERBATIM ✓)\n` +
    `  results/neural-consumer-paths.json sha256 ${sha256(adaptedBytes)}`,
);
