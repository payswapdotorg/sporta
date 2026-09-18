import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFfmpegH264Codec } from "../src/codec";
import { createTacticalRenderer } from "../src/plugin";
import {
  SYNTHETIC_FIXTURE_LABEL,
  buildSyntheticTacticalEvents,
  buildSyntheticTacticalSnapshot,
  buildTacticalRenderRequest,
} from "./helpers";

/**
 * THE R301 DETERMINISM PROOF — over a FIXED SYNTHETIC-DIAGNOSTIC SWM
 * (built with the `@sporta/testing` deterministic builders, seed-pinned).
 *
 * This is NOT real-video acceptance: the SWM input is synthetic by
 * construction (labeled "synthetic-diagnostic"); the proof establishes
 * renderer determinism and the artifact hash chain, which is the foundation
 * the R305-R307 real-video acceptance will stand on.
 *
 * The claim under test: rendering the same request over the same input
 * twice — in FRESH staging roots, with FRESH plugin instances — produces
 * byte-identical MP4 artifacts and deep-equal manifests, and every manifest
 * content hash matches the file on disk (re-hashed independently).
 */
const ffmpegOk = createFfmpegH264Codec() !== null;

let rootA: string;
let rootB: string;
let sharedRoot: string;

beforeAll(() => {
  rootA = mkdtempSync(join(tmpdir(), "tactical-det-a-"));
  rootB = mkdtempSync(join(tmpdir(), "tactical-det-b-"));
  sharedRoot = mkdtempSync(join(tmpdir(), "tactical-det-shared-"));
});

afterAll(() => {
  for (const dir of [rootA, rootB, sharedRoot]) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe(`determinism over the fixed ${SYNTHETIC_FIXTURE_LABEL} SWM`, () => {
  test.skipIf(!ffmpegOk)(
    "rendering twice (fresh staging roots, fresh plugins) produces byte-identical artifacts + deep-equal manifests",
    () => {
      const snapshot = buildSyntheticTacticalSnapshot();
      const events = buildSyntheticTacticalEvents();

      const renderA = createTacticalRenderer({ stagingDir: rootA }).renderDetailed(
        buildTacticalRenderRequest(),
        { snapshot, events },
      );
      const renderB = createTacticalRenderer({ stagingDir: rootB }).renderDetailed(
        buildTacticalRenderRequest(),
        { snapshot, events },
      );

      // Byte-identical MP4 artifacts (independent read + hash).
      const bytesA = readFileSync(renderA.details.artifact.artifactPath);
      const bytesB = readFileSync(renderB.details.artifact.artifactPath);
      expect(Buffer.compare(bytesA, bytesB)).toBe(0);

      // The manifest hash chain: manifest.contentHash == sha256(file bytes),
      // verified with an INDEPENDENT hasher (node:crypto, not the store's).
      const hashA = createHash("sha256").update(bytesA).digest("hex");
      const hashB = createHash("sha256").update(bytesB).digest("hex");
      expect(hashA).toBe(renderA.details.artifact.manifest.contentHash);
      expect(hashB).toBe(renderB.details.artifact.manifest.contentHash);
      expect(hashA).toBe(hashB);

      // Deep-equal manifests (identity, provenance, integrity, timestamps —
      // the deterministic clock makes even generatedAtMs reproducible).
      expect(renderA.details.artifact.manifest).toEqual(renderB.details.artifact.manifest);
      expect(renderA.details.artifact.artifactId).toBe(renderB.details.artifact.artifactId);

      // Deep-equal contract results (the artifactRef embeds the content hash).
      expect(renderA.result).toEqual(renderB.result);

      // Deep-equal view-models (the canonical scene projects identically).
      expect(renderA.details.view).toEqual(renderB.details.view);
      expect(renderA.details.frameCount).toBe(renderB.details.frameCount);
    },
  );

  test.skipIf(!ffmpegOk)(
    "the artifact is a REAL playable h264 MP4 (ffprobe: codec, dims, rate, frames; decode clean)",
    () => {
      const snapshot = buildSyntheticTacticalSnapshot();
      const events = buildSyntheticTacticalEvents();
      const render = createTacticalRenderer({ stagingDir: rootA }).renderDetailed(
        buildTacticalRenderRequest(),
        { snapshot, events },
      );
      const path = render.details.artifact.artifactPath;

      const probe = spawnSync(
        "ffprobe",
        [
          "-v",
          "error",
          "-select_streams",
          "v:0",
          "-show_entries",
          "stream=codec_name,profile,width,height,avg_frame_rate,nb_frames",
          "-of",
          "json",
          path,
        ],
        { encoding: "utf8" },
      );
      expect(probe.status).toBe(0);
      const stream = (JSON.parse(probe.stdout) as { streams: Array<Record<string, unknown>> })
        .streams[0]!;
      expect(stream.codec_name).toBe("h264");
      expect(stream.profile).toBe("Constrained Baseline");
      expect(Number(stream.width)).toBe(640);
      expect(Number(stream.height)).toBe(360);
      expect(stream.avg_frame_rate).toBe("25/2");
      expect(Number(stream.nb_frames)).toBe(render.details.frameCount);

      const decode = spawnSync("ffmpeg", ["-v", "error", "-i", path, "-f", "null", "-"], {
        encoding: "utf8",
      });
      expect(decode.status).toBe(0);
      expect(decode.stderr).toBe("");
    },
  );

  test.skipIf(!ffmpegOk)(
    "a DIFFERENT styleConfig (duration) produces a DIFFERENT artifact (no cross-contamination)",
    () => {
      const snapshot = buildSyntheticTacticalSnapshot();
      const events = buildSyntheticTacticalEvents();
      const long = createTacticalRenderer({ stagingDir: rootA }).renderDetailed(
        buildTacticalRenderRequest({
          styleConfig: {
            styleId: "tactical-test",
            configSchemaVersion: "1.0",
            config: { durationMs: 1_000 },
          },
        }),
        { snapshot, events },
      );
      const short = createTacticalRenderer({ stagingDir: rootB }).renderDetailed(
        buildTacticalRenderRequest({
          styleConfig: {
            styleId: "tactical-test",
            configSchemaVersion: "1.0",
            config: { durationMs: 2_000 },
          },
        }),
        { snapshot, events },
      );
      expect(long.details.frameCount).not.toBe(short.details.frameCount);
      expect(long.details.artifact.contentHash).not.toBe(short.details.artifact.contentHash);
      expect(long.details.artifact.manifest.durationMs).toBe(1_040);
      expect(short.details.artifact.manifest.durationMs).toBe(2_000);
    },
  );

  test.skipIf(!ffmpegOk)(
    "a DIFFERENT event tail produces a DIFFERENT artifact (event overlays are in the bytes)",
    () => {
      const snapshot = buildSyntheticTacticalSnapshot();
      const withEvents = createTacticalRenderer({ stagingDir: rootA }).renderDetailed(
        buildTacticalRenderRequest(),
        { snapshot, events: buildSyntheticTacticalEvents() },
      );
      const withoutEvents = createTacticalRenderer({ stagingDir: rootB }).renderDetailed(
        buildTacticalRenderRequest(),
        { snapshot, events: [] },
      );
      expect(withEvents.details.artifact.contentHash).not.toBe(
        withoutEvents.details.artifact.contentHash,
      );
      expect(withEvents.details.artifact.manifest.swm).toEqual({
        snapshotVersion: 21,
        lastEventSequence: 25,
      });
      expect(withoutEvents.details.artifact.manifest.swm).toEqual({
        snapshotVersion: 21,
        lastEventSequence: 0,
      });
    },
  );

  test.skipIf(!ffmpegOk)(
    "re-rendering into a SHARED root is idempotent: same content address, duplicate counted, no re-write",
    () => {
      const snapshot = buildSyntheticTacticalSnapshot();
      const events = buildSyntheticTacticalEvents();
      const request = buildTacticalRenderRequest();

      const first = createTacticalRenderer({ stagingDir: sharedRoot }).renderDetailed(request, {
        snapshot,
        events,
      });
      const second = createTacticalRenderer({ stagingDir: sharedRoot }).renderDetailed(request, {
        snapshot,
        events,
      });

      expect(second.details.artifact.duplicate).toBe(true);
      expect(second.details.artifact.contentHash).toBe(first.details.artifact.contentHash);
      expect(second.details.artifact.manifestPath).toBe(first.details.artifact.manifestPath);
      // The manifest sidecar is stable (same bytes after a duplicate put).
      expect(readFileSync(second.details.artifact.manifestPath, "utf8")).toBe(
        readFileSync(first.details.artifact.manifestPath, "utf8"),
      );
    },
  );
});
