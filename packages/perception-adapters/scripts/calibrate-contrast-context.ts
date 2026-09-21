/**
 * J012b calibration script (DEVELOPMENT-TIME EVIDENCE, not a test): decodes
 * sampled frames from the two committed REAL gate clips plus the synthetic
 * diagnostic fixture and runs the ContrastContextDetector over a parameter
 * sweep, printing per-frame detection statistics. The chosen defaults are
 * pinned from this evidence (the run logs go into the work report).
 *
 * Run: cd packages/perception-adapters && bun run scripts/calibrate-contrast-context.ts
 */
import { spawn } from "node:child_process";
import { ContrastContextDetector } from "../src/detection/contrast-context";
import type { ContrastContextDetectorOptions } from "../src/detection/contrast-context";
import type { DetectedBox, DetectorFrameInput } from "@sporta/perception-detection";

interface ClipSpec {
  readonly label: string;
  readonly path: string;
  readonly frames: readonly number[];
}

const CLIPS: readonly ClipSpec[] = [
  {
    label: "fx-001 (beach, CC0)",
    path: "../real-to-swm/fixtures/media/fx-001-normalized.mp4",
    frames: [25, 100, 175, 225],
  },
  {
    label: "fx-004 (newsreel, CC BY-SA 3.0 nl)",
    path: "../real-to-swm/fixtures/media/fx-004-normalized.mp4",
    frames: [50, 200, 350, 475],
  },
  {
    label: "synthetic-diagnostic (fixture, NOT real)",
    path: "../technology-registry/fixtures/media/synthetic-diagnostic-01-players-and-ball.mp4",
    frames: [75, 150, 225],
  },
];

/** Decodes one raw rgb24 frame at the given index via ffmpeg. */
function decodeFrame(
  path: string,
  frameIndex: number,
): Promise<{ frame: DetectorFrameInput; wallMs: number }> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const proc = spawn("ffmpeg", [
      "-v",
      "error",
      "-i",
      path,
      "-vf",
      `select=eq(n\\,${frameIndex})`,
      "-vframes",
      "1",
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgb24",
      "-",
    ]);
    const chunks: Buffer[] = [];
    proc.stdout.on("data", (chunk) => chunks.push(chunk as Buffer));
    proc.stderr.on("data", (chunk) => process.stderr.write(chunk));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg exited ${code}`));
        return;
      }
      const bytes = new Uint8Array(Buffer.concat(chunks));
      // Both fixtures are 640x360.
      const width = 640;
      const height = bytes.length / (640 * 3) >= 360 ? 360 : Math.round(bytes.length / (640 * 3));
      if (bytes.length !== width * height * 3) {
        reject(new Error(`unexpected byte length ${bytes.length}`));
        return;
      }
      resolve({
        frame: {
          frameId: `f-0-${frameIndex}`,
          presentationMs: frameIndex * 40,
          width,
          height,
          bytes,
          decodeOrder: frameIndex,
          streamIndex: 0,
        },
        wallMs: Date.now() - started,
      });
    });
  });
}

function summarize(detections: readonly DetectedBox[]): string {
  if (detections.length === 0) return "0 detections";
  const areas = detections.map((d) => d.box.w * d.box.h * 640 * 360);
  const confs = detections.map((d) => d.confidence);
  const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
  return (
    `${detections.length} det | boxArea mean=${Math.round(mean(areas))} ` +
    `min=${Math.round(Math.min(...areas))} max=${Math.round(Math.max(...areas))} | ` +
    `conf mean=${mean(confs).toFixed(2)} min=${Math.min(...confs).toFixed(2)}`
  );
}

const SWEEPS: readonly (readonly [string, ContrastContextDetectorOptions])[] = [
  ["defaults(T=32)", {}],
  ["T=24", { contrastThreshold: 24 }],
  ["T=28", { contrastThreshold: 28 }],
  ["T=36", { contrastThreshold: 36 }],
  ["T=40", { contrastThreshold: 40 }],
  ["T=32 minArea=200", { contrastThreshold: 32, minBlobArea: 200 }],
  ["T=32 ring>=0.65", { contrastThreshold: 32, ringMinSurfaceFraction: 0.65 }],
];

const detectorCache = new Map<string, ContrastContextDetector>();
for (const clip of CLIPS) {
  console.log(`\n=== ${clip.label} ===`);
  for (const frameIndex of clip.frames) {
    const { frame } = await decodeFrame(clip.path, frameIndex);
    const lines: string[] = [];
    for (const [name, options] of SWEEPS) {
      let detector = detectorCache.get(name);
      if (detector === undefined) {
        detector = new ContrastContextDetector(options);
        detectorCache.set(name, detector);
      }
      const t0 = performance.now();
      const detections = detector.detect(frame);
      const dt = performance.now() - t0;
      lines.push(`  [${name}] ${summarize(detections)} (${dt.toFixed(0)}ms)`);
    }
    console.log(`frame ${frameIndex}:`);
    for (const line of lines) console.log(line);
  }
}
