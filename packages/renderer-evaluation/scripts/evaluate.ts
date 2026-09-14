/**
 * The W503 evaluation CLI: renders the clean fixture clip through the real
 * W502 renderer, measures it, prints every check with its measured value,
 * and exits 0 (PASS) / 1 (FAIL). Also runs the detection proof (every
 * injected defect must flip the verdict to FAIL) — exit 2 if any injection
 * goes undetected.
 */
import type { AnimeRenderOutput } from "@sporta/renderer-anime";
import {
  evaluateRenderOutput,
  injectAppliedSequenceGap,
  injectDispositionFlap,
  injectDuplicateEventAttribution,
  injectGeometryTeleport,
  injectStyleByteInstability,
  injectStyleInstability,
  injectUnexplainedAbsence,
  injectWatermarkRegression,
  injectWindowOverlap,
  renderW503CleanFixture,
} from "../src/index";

const output = renderW503CleanFixture();
const report = evaluateRenderOutput(output);

console.log(
  `W503 temporal consistency evaluation — ${report.input.rendererId}@${report.input.rendererVersion}`,
);
console.log(
  `session ${report.input.sessionId} · ${report.input.frameCount} frames · interval ${report.input.frameIntervalMs} ms`,
);
console.log("\n== identity ==");
console.log(`  flickerCount                 ${report.identity.flickerCount}`);
console.log(`  unexplainedAbsenceCount      ${report.identity.unexplainedAbsenceCount}`);
console.log(`  reappearanceCount            ${report.identity.reappearanceCount}`);
console.log(
  `  styleStabilityRatio          ${report.identity.styleStabilityRatio} (${report.identity.styleStableFrames}/${report.identity.styleTokenFrames} token frames)`,
);
if (report.styleBytes !== undefined) {
  console.log(
    `  styleBytes.stabilityRatio    ${report.styleBytes.stabilityRatio} (${report.styleBytes.stableFrames}/${report.styleBytes.groupFrames} marker groups)`,
  );
}
console.log("\n== geometry ==");
console.log(`  measuredPairCount            ${report.geometry.measuredPairCount}`);
console.log(`  jumpCount                    ${report.geometry.jumpCount}`);
console.log(`  maxJumpRatio                 ${report.geometry.maxJumpRatio}`);
console.log(`  maxDisplacementMeters        ${report.geometry.maxDisplacementMeters}`);
console.log(`  maxJumpMeters                ${report.geometry.maxJumpMeters}`);
console.log(`  gapFrameCount                ${report.geometry.gapFrameCount}`);
console.log("\n== artifacts ==");
for (const [key, value] of Object.entries(report.artifacts)) {
  if (key === "frameCount" || key === "anomalies") continue;
  console.log(`  ${key.padEnd(30)}${String(value)}`);
}

console.log("\n== verdict checks ==");
for (const check of report.verdict.checks) {
  const mark = check.pass ? "PASS" : "FAIL";
  const relation = check.operator === "max" ? `<= ${check.threshold}` : `>= ${check.threshold}`;
  console.log(`  [${mark}] ${check.metric} = ${check.measured} (threshold ${relation})`);
}
console.log(`\nVERDICT: ${report.verdict.pass ? "PASS" : "FAIL"}`);

// --- The detection proof (the accept criterion's teeth) -------------------
const manifest = output.manifest;
const injections: Array<{ name: string; output: AnimeRenderOutput }> = [
  {
    name: "identity flicker (unexplained entity absence)",
    output: {
      ...output,
      manifest: injectUnexplainedAbsence(manifest, { frameIndex: 2, entityId: "player-7" }),
    },
  },
  {
    name: "style instability (restyled entity on one frame)",
    output: {
      ...output,
      manifest: injectStyleInstability(manifest, { frameIndex: 2, entityId: "player-7" }),
    },
  },
  {
    name: "SVG byte-level style instability (manifest token untouched)",
    output: injectStyleByteInstability(output, { frameIndex: 2, entityId: "player-7" }),
  },
  {
    name: "geometry drift (teleported player)",
    output: {
      ...output,
      manifest: injectGeometryTeleport(manifest, {
        frameIndex: 2,
        entityId: "player-7",
        toMeters: { x: 90, y: 34 },
      }),
    },
  },
  {
    name: "watermark regression",
    output: { ...output, manifest: injectWatermarkRegression(manifest, { frameIndex: 2 }) },
  },
  {
    name: "disposition flapping (drawn→omitted→drawn)",
    output: {
      ...output,
      manifest: injectDispositionFlap(manifest, { frameIndex: 2, entityId: "player-9" }),
    },
  },
  {
    name: "applied-sequence gap (silently dropped event)",
    output: {
      ...output,
      manifest: injectAppliedSequenceGap(manifest, { frameIndex: 3, sequence: 13 }),
    },
  },
  {
    name: "duplicate event attribution (event shown twice)",
    output: {
      ...output,
      manifest: injectDuplicateEventAttribution(manifest, {
        sequence: 11,
        fromFrameIndex: 0,
        toFrameIndex: 2,
      }),
    },
  },
  {
    name: "caption window overlap",
    output: { ...output, manifest: injectWindowOverlap(manifest, { frameIndex: 2 }) },
  },
];

console.log("\n== detection proof (each injected defect must FAIL) ==");
let undetected = 0;
for (const injection of injections) {
  const perturbedReport = evaluateRenderOutput(injection.output);
  const failing = perturbedReport.verdict.failures.map((failure) => failure.metric);
  const detected = !perturbedReport.verdict.pass;
  if (!detected) undetected += 1;
  console.log(
    `  [${detected ? "DETECTED" : "MISSED"}] ${injection.name} — failing checks: ${failing.join(", ") || "none"}`,
  );
}

if (!report.verdict.pass) process.exit(1);
if (undetected > 0) process.exit(2);
