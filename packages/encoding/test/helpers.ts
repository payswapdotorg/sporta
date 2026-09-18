/**
 * Deterministic R306 test fixtures (docs/testing/HARNESS.md — no Date.now,
 * no Math.random; all times are explicit milliseconds).
 *
 * - a deterministic synthetic frame stream (a walking RGB pattern — pure
 *   integer math, bit-exact);
 * - the W501-harness-default SWM documents (buildWorldSnapshot + three
 *   composed events — the conformance fixture convention, never new
 *   fixtures);
 * - fake ffmpeg binaries for the bounded-subprocess tests (a hanging
 *   encoder and a failing encoder — shell scripts, `exec sleep` so the
 *   DIRECT child is the process that gets SIGKILLed).
 */
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildEventEnvelope, buildRenderRequest, buildWorldSnapshot } from "@sporta/testing";
import type { WorldEventStreamEntry, WorldSnapshot, RenderRequest } from "@sporta/contracts";
import { TACTICAL_OUTPUT_PROFILES, TACTICAL_RENDERER_ID, TACTICAL_RENDERER_VERSION } from "@sporta/renderer-tactical";

/** The canonical test session. */
export const SESSION_ID = "sess-encoding-test";

/** The deterministic frame geometry (small, fast, even, >= 16). */
export const FRAME_WIDTH = 160;
export const FRAME_HEIGHT = 90;
export const FRAME_FPS = 25;

/** One deterministic synthetic frame (pure integer math — bit-exact). */
export function syntheticFrame(index: number, count: number): Uint8Array {
  const frame = new Uint8Array(FRAME_WIDTH * FRAME_HEIGHT * 3);
  for (let p = 0; p < FRAME_WIDTH * FRAME_HEIGHT; p += 1) {
    frame[p * 3] = (p * 3 + index * 17) % 256;
    frame[p * 3 + 1] = (p + index * 29 + count) % 256;
    frame[p * 3 + 2] = (p * 7 + index * 11) % 256;
  }
  return frame;
}

/** A deterministic frame sequence. */
export function syntheticFrames(count: number): Uint8Array[] {
  return Array.from({ length: count }, (_, i) => syntheticFrame(i, count));
}

/** The canonical SWM fixture (the W501 harness default documents). */
export function fixtureSnapshot(): WorldSnapshot {
  return buildWorldSnapshot({ sessionId: SESSION_ID });
}

/** The canonical event tail (three composed events, ascending sequences). */
export function fixtureEvents(): WorldEventStreamEntry[] {
  return [1, 2, 3].map((i) => {
    const event = buildEventEnvelope(
      { eventId: `fe-enc-${i}`, sessionId: SESSION_ID, eventTimeMs: 1_000 * i },
      4000 + i,
    );
    return { sequence: 20 + i, snapshotVersionAfter: 40 + i, event };
  });
}

/** The canonical tactical render request (the R301 conformance profile). */
export function tacticalRenderRequest(durationMs = 800): RenderRequest {
  return buildRenderRequest({
    sessionId: SESSION_ID,
    rendererId: TACTICAL_RENDERER_ID,
    rendererVersion: TACTICAL_RENDERER_VERSION,
    outputProfile: TACTICAL_OUTPUT_PROFILES[0]!,
    styleConfig: { styleId: "encoding-test", configSchemaVersion: "1.0", config: { durationMs } },
  });
}

/** A temp directory (caller cleans). */
export function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

/** Cleans a temp directory (idempotent). */
export function cleanDir(path: string): void {
  rmSync(path, { recursive: true, force: true });
}

/**
 * Writes an executable fake ffmpeg that fails on encode with a stderr line
 * (the probe responds; the encode exits non-zero — the honest-exit test).
 *
 * NOTE (Bun 1.3.14, measured): spawnSync's timeout+SIGKILL kills DIRECT
 * binaries (the real ffmpeg) but NOT shebang-script targets, so the
 * hanging-encoder bound is tested against the REAL ffmpeg with a 1 ms
 * timeout instead (see test/ffmpeg.test.ts) — no hanging fake is used.
 */
export function failingFfmpeg(): { path: string; dir: string } {
  const dir = tempDir("sporta-failing-ffmpeg-");
  const path = join(dir, "ffmpeg");
  writeFileSync(
    path,
    [
      "#!/bin/sh",
      'for arg in "$@"; do',
      '  case "$arg" in',
      '    -version) echo "ffmpeg version 99.0-fake"; exit 0;;',
      '    -encoders) echo " ... libx264 ..."; exit 0;;',
      "  esac",
      "done",
      'echo "fake encoder exploded" >&2',
      "exit 3",
      "",
    ].join("\n"),
  );
  chmodSync(path, 0o755);
  return { path, dir };
}
