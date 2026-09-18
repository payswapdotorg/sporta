/**
 * Deterministic generator for the `synthetic-diagnostic` fixture media
 * (R002). Run from the package root:
 *
 *   bun run scripts/generate-synthetic-diagnostic.ts
 *
 * Produces:
 *
 * - `fixtures/media/synthetic-diagnostic-01-players-and-ball.mp4`: a 12s,
 *   640x360, 25fps top-down geometric "pitch" with 10 team-colored player
 *   discs on deterministic sinusoidal paths plus a white ball disc;
 * - `fixtures/annotations/synthetic-diagnostic-01.json`: the per-frame
 *   EXPECTED ANNOTATIONS (exact disc positions/counts, derived from the
 *   same math), so evaluation smoke tests have ground truth.
 *
 * This is a SYNTHETIC DIAGNOSTIC pattern, never real footage:
 * - it exists so the evaluation runner and perception smoke tests have a
 *   fully deterministic, trivially segmentable input (flat green field,
 *   solid-color discs);
 * - every position is a pure function of the frame index (no randomness,
 *   no clock), so the clip is byte-reproducible from this script;
 * - it MUST be presented only as `synthetic-diagnostic` media
 *   (`mediaKind: "synthetic-diagnostic"` in the fixture manifest).
 *
 * Pipeline: pure-TS PPM (P6) frame renderer -> ffmpeg (h264, yuv420p,
 * faststart). ffmpeg must be on PATH.
 */
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const WIDTH = 640;
const HEIGHT = 360;
const FPS = 25;
const DURATION_SECONDS = 12;
const FRAMES = FPS * DURATION_SECONDS;

const OUT_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "fixtures",
  "media",
  "synthetic-diagnostic-01-players-and-ball.mp4",
);
const ANNOTATIONS_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "fixtures",
  "annotations",
  "synthetic-diagnostic-01.json",
);

// ---- deterministic scene (pure functions of the frame index) ---------------

interface Disc {
  x: number;
  y: number;
  radius: number;
  color: [number, number, number];
}

const RED: [number, number, number] = [198, 40, 40];
const BLUE: [number, number, number] = [40, 60, 198];
const WHITE: [number, number, number] = [245, 245, 245];
const FIELD: [number, number, number] = [27, 94, 32];

/** Player discs: two teams of five on mirrored formation anchors. */
function playerDiscs(t: number): Disc[] {
  const discs: Disc[] = [];
  for (let i = 0; i < 5; i++) {
    // Red team occupies the left half, blue the right half.
    const redAnchor = { x: 90 + i * 62, y: 110 + 42 * Math.sin(i * 1.7) };
    const blueAnchor = { x: WIDTH - 90 - i * 62, y: HEIGHT - 110 - 42 * Math.sin(i * 1.7) };
    discs.push({
      x: redAnchor.x + 42 * Math.sin(t * 0.7 + i),
      y: redAnchor.y + 26 * Math.cos(t * 0.53 + i * 2.1),
      radius: 9,
      color: RED,
    });
    discs.push({
      x: blueAnchor.x + 42 * Math.sin(t * 0.61 + i * 1.3 + 2),
      y: blueAnchor.y + 26 * Math.cos(t * 0.47 + i),
      radius: 9,
      color: BLUE,
    });
  }
  return discs;
}

/** The ball: a small white disc weaving across the pitch. */
function ballDisc(t: number): Disc {
  return {
    x: WIDTH / 2 + 210 * Math.sin(t * 0.9),
    y: HEIGHT / 2 + 96 * Math.sin(t * 1.31 + 1.0),
    radius: 4,
    color: WHITE,
  };
}

/** Static pitch markings: boundary, halfway line, center circle + spot, boxes. */
function drawPitchMarkings(frame: Uint8Array): void {
  const inset = 20;
  const put = (x: number, y: number): void => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    if (xi < 0 || xi >= WIDTH || yi < 0 || yi >= HEIGHT) return;
    const offset = (yi * WIDTH + xi) * 3;
    frame[offset] = WHITE[0];
    frame[offset + 1] = WHITE[1];
    frame[offset + 2] = WHITE[2];
  };
  const line = (x0: number, y0: number, x1: number, y1: number, thickness = 2): void => {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1) * 2;
    for (let s = 0; s <= steps; s++) {
      const x = x0 + ((x1 - x0) * s) / steps;
      const y = y0 + ((y1 - y0) * s) / steps;
      for (let ty = 0; ty < thickness; ty++) {
        for (let tx = 0; tx < thickness; tx++) {
          put(x + tx, y + ty);
        }
      }
    }
  };
  const circle = (cx: number, cy: number, r: number, thickness = 2): void => {
    for (let a = 0; a < 360; a += 1) {
      const rad = (a * Math.PI) / 180;
      line(
        cx + r * Math.cos(rad),
        cy + r * Math.sin(rad),
        cx + r * Math.cos(rad),
        cy + r * Math.sin(rad),
        thickness,
      );
    }
  };
  // Boundary.
  line(inset, inset, WIDTH - inset, inset);
  line(inset, HEIGHT - inset, WIDTH - inset, HEIGHT - inset);
  line(inset, inset, inset, HEIGHT - inset);
  line(WIDTH - inset, inset, WIDTH - inset, HEIGHT - inset);
  // Halfway line + center circle + spot.
  line(WIDTH / 2, inset, WIDTH / 2, HEIGHT - inset);
  circle(WIDTH / 2, HEIGHT / 2, 60);
  line(WIDTH / 2 - 1, HEIGHT / 2 - 1, WIDTH / 2 + 1, HEIGHT / 2 + 1);
  // Penalty boxes (both ends).
  line(inset, HEIGHT / 2 - 80, inset + 88, HEIGHT / 2 - 80);
  line(inset, HEIGHT / 2 + 80, inset + 88, HEIGHT / 2 + 80);
  line(inset + 88, HEIGHT / 2 - 80, inset + 88, HEIGHT / 2 + 80);
  line(WIDTH - inset - 88, HEIGHT / 2 - 80, WIDTH - inset, HEIGHT / 2 - 80);
  line(WIDTH - inset - 88, HEIGHT / 2 + 80, WIDTH - inset, HEIGHT / 2 + 80);
  line(WIDTH - inset - 88, HEIGHT / 2 - 80, WIDTH - inset - 88, HEIGHT / 2 + 80);
}

/** Render one PPM (P6) frame. */
function renderFrame(frameIndex: number): Buffer {
  const t = frameIndex / FPS;
  const frame = new Uint8Array(WIDTH * HEIGHT * 3);
  for (let i = 0; i < WIDTH * HEIGHT; i++) {
    frame[i * 3] = FIELD[0];
    frame[i * 3 + 1] = FIELD[1];
    frame[i * 3 + 2] = FIELD[2];
  }
  drawPitchMarkings(frame);
  const discs = [...playerDiscs(t), ballDisc(t)];
  for (const disc of discs) {
    const r2 = disc.radius * disc.radius;
    const x0 = Math.max(0, Math.floor(disc.x - disc.radius));
    const x1 = Math.min(WIDTH - 1, Math.ceil(disc.x + disc.radius));
    const y0 = Math.max(0, Math.floor(disc.y - disc.radius));
    const y1 = Math.min(HEIGHT - 1, Math.ceil(disc.y + disc.radius));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x - disc.x;
        const dy = y - disc.y;
        if (dx * dx + dy * dy <= r2) {
          const offset = (y * WIDTH + x) * 3;
          frame[offset] = disc.color[0];
          frame[offset + 1] = disc.color[1];
          frame[offset + 2] = disc.color[2];
        }
      }
    }
  }
  const header = Buffer.from(`P6\n${WIDTH} ${HEIGHT}\n255\n`, "ascii");
  return Buffer.concat([header, Buffer.from(frame.buffer, frame.byteOffset, frame.byteLength)]);
}

// ---- expected annotations (same math, one source of truth) ----------------

interface ExpectedAnnotations {
  fixtureId: string;
  mediaKind: "synthetic-diagnostic";
  width: number;
  height: number;
  fps: number;
  frameCount: number;
  durationSeconds: number;
  /** Per-frame ground truth: every disc's center + radius + team. */
  frames: Array<{
    frameIndex: number;
    players: Array<{ x: number; y: number; radius: number; team: "red" | "blue" }>;
    ball: { x: number; y: number; radius: number };
  }>;
}

function buildExpectedAnnotations(): ExpectedAnnotations {
  const frames: ExpectedAnnotations["frames"] = [];
  for (let i = 0; i < FRAMES; i++) {
    const t = i / FPS;
    const discs = playerDiscs(t);
    frames.push({
      frameIndex: i,
      players: discs.map((disc) => ({
        x: Number(disc.x.toFixed(3)),
        y: Number(disc.y.toFixed(3)),
        radius: disc.radius,
        team: disc.color === RED ? ("red" as const) : ("blue" as const),
      })),
      ball: (() => {
        const ball = ballDisc(t);
        return { x: Number(ball.x.toFixed(3)), y: Number(ball.y.toFixed(3)), radius: ball.radius };
      })(),
    });
  }
  return {
    fixtureId: "synthetic-diagnostic-01",
    mediaKind: "synthetic-diagnostic",
    width: WIDTH,
    height: HEIGHT,
    fps: FPS,
    frameCount: FRAMES,
    durationSeconds: DURATION_SECONDS,
    frames,
  };
}

// ---- encode ----------------------------------------------------------------

mkdirSync(dirname(OUT_PATH), { recursive: true });
mkdirSync(dirname(ANNOTATIONS_PATH), { recursive: true });

const ffmpeg = spawn(
  "ffmpeg",
  [
    "-y",
    "-f",
    "image2pipe",
    "-framerate",
    String(FPS),
    "-i",
    "-",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "23",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    OUT_PATH,
  ],
  { stdio: ["pipe", "inherit", "inherit"] },
);

let closed = false;
let exitCode: number | null = null;
ffmpeg.on("close", (code) => {
  closed = true;
  exitCode = code;
  if (code === 0) {
    console.log(`wrote ${OUT_PATH} (${FRAMES} frames, ${DURATION_SECONDS}s @ ${FPS}fps)`);
  } else {
    console.error(`ffmpeg exited with code ${code}`);
  }
});

for (let i = 0; i < FRAMES; i++) {
  const ok = ffmpeg.stdin.write(renderFrame(i));
  if (!ok) {
    await new Promise<void>((resolve) => ffmpeg.stdin.once("drain", () => resolve()));
  }
}
ffmpeg.stdin.end();
await new Promise<void>((resolve) => {
  if (closed) resolve();
  else ffmpeg.on("close", () => resolve());
});
if (exitCode !== 0) {
  process.exit(exitCode ?? 1);
}

await Bun.write(ANNOTATIONS_PATH, JSON.stringify(buildExpectedAnnotations(), null, 2));
console.log(`wrote ${ANNOTATIONS_PATH} (${FRAMES} annotated frames)`);
