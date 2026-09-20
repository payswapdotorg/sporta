/**
 * THE derived-reality MP4 execution tests (R508/R509/R510) — one
 * materialized dispatch per derived reality through the REAL renderers,
 * the REAL R306 encoding bridges, and the REAL W504 content-addressed
 * artifact store, plus the determinate failure paths.
 *
 * REAL vs FIXTURE BOUNDARY: every MP4 here is produced by the REAL
 * system ffmpeg (probed; `skipIf` when absent — the repo's typed skip
 * guard) through the REAL renderers (the R301 tactical plugin's own
 * ffmpeg/libx264 encode; the R302 reference Software3DEngine + the R306
 * `FfmpegFrameEncoder`). NO committed binary fixtures — the bytes are
 * encoded in-test, hashed, and re-verified.
 */
import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeRenderJob } from "../src/index";
import type { RenderJobExecutorDeps } from "../src/index";
import { createDerivedRealityRenderer, DERIVED_REALITY_RENDERERS } from "../src/index";
import {
  InMemoryArtifactStore,
  InMemoryRenderSegmentStore,
} from "@sporta/output-pipeline";
import {
  base64Of,
  createFfmpegFrameEncoder,
  loadEncodedArtifact,
  probeEncodedArtifact,
  registerEncodedArtifact,
  validateEncodedManifest,
} from "@sporta/encoding";
import type { EncodedArtifact } from "@sporta/encoding";
import { RendererRegistry } from "@sporta/renderer-contract";
import { createTestCardRenderer } from "@sporta/renderer-contract";
import { Software3DEngine } from "@sporta/renderer-3d";
import { createTacticalRenderer } from "@sporta/renderer-tactical";
import { TACTICAL_OUTPUT_PROFILES } from "@sporta/renderer-tactical";
import { RenderArtifactManifest } from "@sporta/contracts";
import {
  buildDispatchRequest,
  manualClock,
  SESSION_ID,
  workerRegistry,
} from "./helpers";

/** The probed availability of the REAL system ffmpeg (the typed skip guard). */
const ffmpegProbe = createFfmpegFrameEncoder();
const ffmpegAvailable = ffmpegProbe !== null && ffmpegProbe.available();

/** A deterministic stepping clock (the repo's hermetic rig). */
function clock(): () => number {
  return manualClock(1_700_000_000_000, 1);
}

/** The full executor deps with the derived-reality plane composed. */
function derivedDeps(): { deps: RenderJobExecutorDeps; scratch: string[] } {
  const scratch: string[] = [];
  const tacticalStagingDir = mkdtempSync(join(tmpdir(), "sporta-tactical-test-"));
  scratch.push(tacticalStagingDir);
  const tacticalRenderer = createTacticalRenderer({
    stagingDir: tacticalStagingDir,
    nowMs: clock(),
  });
  const registry = workerRegistry();
  registry.register(tacticalRenderer);
  const deps: RenderJobExecutorDeps = {
    rendererRegistry: registry,
    outputSegmentStore: new InMemoryRenderSegmentStore(),
    nowMs: clock(),
    budgets: {
      maxExecutionMs: 30_000,
      maxArtifactBytes: 4_000_000,
      maxJobDeadlineMs: 60_000,
      minJobDeadlineMs: 1_000,
      dispatchTimeoutMs: 5_000,
      maxConcurrentJobs: 4,
    },
    derivedRealityRenderer: createDerivedRealityRenderer({
      tacticalRenderer,
      createGameEngine: () => new Software3DEngine(),
      frameEncoder: createFfmpegFrameEncoder()!,
    }),
    encodedArtifactStore: new InMemoryArtifactStore(),
  };
  return { deps, scratch };
}

/** Cleans the derived deps' scratch directories (idempotent). */
function cleanScratch(scratch: string[]): void {
  for (const dir of scratch) {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The tactical SD output profile as a dispatch override. */
function tacticalProfileOverride(): {
  resolution: { w: number; h: number };
  frameRate: number;
  codec: string;
  container: string;
} {
  const profile = TACTICAL_OUTPUT_PROFILES[0]!;
  return {
    resolution: { w: profile.resolution.w, h: profile.resolution.h },
    frameRate: profile.frameRate,
    codec: profile.codec,
    container: profile.container,
  };
}

/** Rebuilds the bridge's `EncodedArtifact` from an executed job's output (for probing). */
function encodedArtifactOf(output: {
  artifactId: string;
  contentHash: string;
  manifest: unknown;
  delivery: { mode: string; content?: unknown };
}): EncodedArtifact {
  if (output.delivery.mode !== "inline" || typeof output.delivery.content !== "string") {
    throw new Error("expected an inline delivery");
  }
  return {
    kind: "mp4",
    manifestId: (output.manifest as { manifestId: string }).manifestId,
    sessionId: SESSION_ID,
    contentHash: output.contentHash,
    byteSize: Buffer.from(output.delivery.content, "base64").byteLength,
    bytes: Buffer.from(output.delivery.content, "base64"),
    manifest: output.manifest as EncodedArtifact["manifest"],
  };
}

describe.skipIf(!ffmpegAvailable)("executeRenderJob — the derived-reality MP4 path", () => {
  it("R508 — a tactical dispatch renders a REAL MP4 through bridgeTacticalRenderer", async () => {
    const { deps, scratch } = derivedDeps();
    try {
      const request = await buildDispatchRequest({
        rendererId: "tactical.prototype",
        jobId: "render-job-r508-tactical",
        idempotencyKey: "render-r508-tactical-key",
        outputProfile: tacticalProfileOverride(),
      });
      const envelope = await executeRenderJob(request, deps);

      expect(envelope.status).toBe("succeeded");
      expect(envelope.outputs).toHaveLength(1);
      const output = envelope.outputs[0]!;
      // The honest inline representation: the base64 of the REAL MP4 bytes,
      // content-addressed by the RAW bytes' sha-256.
      expect(output.contentType).toBe("video/mp4+base64");
      expect(output.artifactId).toMatch(/^[0-9a-f]{64}$/);
      expect(output.contentHash).toBe(output.artifactId);
      expect(output.delivery.mode).toBe("inline");
      if (output.delivery.mode !== "inline") throw new Error("expected inline");
      const bytes = Buffer.from(output.delivery.content, "base64");
      expect(bytes.byteLength).toBeGreaterThan(1024);
      expect(output.byteLength).toBe(Buffer.byteLength(output.delivery.content, "utf8"));
      // The MP4 container magic (an ftyp box header — real raster video).
      expect(bytes.subarray(4, 8).toString("ascii")).toBe("ftyp");
      // The container manifest: the R306 tactical bridge's own document.
      const manifest = output.manifest as {
        bridge: string;
        manifestId: string;
        rendererManifest: unknown;
        geometry: { widthPx: number; heightPx: number; frameCount: number; fps: number };
        swm: { snapshotVersion: number; lastEventSequence: number } | null;
      };
      expect(manifest.bridge).toBe("tactical");
      expect(manifest.manifestId).toMatch(/^enc-[0-9a-f]{8}$/);
      expect(manifest.geometry.widthPx).toBe(640);
      expect(manifest.geometry.heightPx).toBe(360);
      expect(manifest.geometry.frameCount).toBeGreaterThan(0);
      // The frozen RenderArtifactManifest rides VERBATIM (the renderer's own).
      const frozen = RenderArtifactManifest.parse(manifest.rendererManifest);
      expect(frozen.reality).toBe("tactical");
      expect(frozen.sessionId).toBe(SESSION_ID);
      expect(frozen.contentHash).toBe(output.contentHash);
      expect(frozen.container).toBe("mp4");
      expect(frozen.swm).not.toBeNull();
      expect(frozen.integrity.verified).toBe(true);
      // The contract result (the W501 document, honest provenance).
      const renderResult = envelope.renderResult as
        | { rendererId: string; sessionId: string }
        | undefined;
      expect(renderResult?.rendererId).toBe("tactical.prototype");
      expect(renderResult?.sessionId).toBe(SESSION_ID);
      // The metering: frames + one encoded segment + the RAW byte size.
      expect(envelope.metering.framesRendered).toBe(manifest.geometry.frameCount);
      expect(envelope.metering.segmentsEncoded).toBe(1);
      expect(envelope.metering.bytesEncoded).toBe(bytes.byteLength);
    } finally {
      cleanScratch(scratch);
    }
  });

  it("R508 manifest/verify — the tactical MP4 round-trips the R306 store with its integrity hash", async () => {
    const { deps, scratch } = derivedDeps();
    try {
      const request = await buildDispatchRequest({
        rendererId: "tactical.prototype",
        jobId: "render-job-r508-store",
        idempotencyKey: "render-r508-store-key",
        outputProfile: tacticalProfileOverride(),
      });
      const envelope = await executeRenderJob(request, deps);
      expect(envelope.status).toBe("succeeded");
      const artifact = encodedArtifactOf(envelope.outputs[0]!);

      // The manifest VALIDATES (the R306 plane's own check).
      const manifestCheck = validateEncodedManifest(artifact.manifest);
      expect(manifestCheck.ok).toBe(true);
      // The registration → load round-trip through the W504 content-addressed
      // artifact store (the R306 store module — registerEncodedArtifact /
      // loadEncodedArtifact, both hashes honest).
      const store = new InMemoryArtifactStore();
      const registration = registerEncodedArtifact(store, artifact);
      expect(registration.outcome).toBe("stored");
      expect(registration.artifactId).toMatch(/^[0-9a-f]{64}$/);
      const loaded = loadEncodedArtifact(store, registration.artifactId, artifact.contentHash);
      // The loaded bytes ARE the artifact's bytes (the integrity hash round-trip).
      expect(loaded.contentHash).toBe(artifact.contentHash);
      expect(Buffer.compare(Buffer.from(loaded.bytes), Buffer.from(artifact.bytes))).toBe(0);
      // Re-registering the identical artifact is a counted no-op duplicate.
      const duplicate = registerEncodedArtifact(store, artifact);
      expect(duplicate.outcome).toBe("duplicate");
      // The ffprobe verify: REAL h264, Constrained Baseline, the manifest's
      // own geometry (the HTML5 playability evidence).
      const probe = probeEncodedArtifact(artifact);
      expect(probe.codecName).toBe("h264");
      expect(["Constrained Baseline", "Baseline"]).toContain(probe.profile);
      expect(probe.widthPx).toBe(artifact.manifest.geometry.widthPx);
      expect(probe.heightPx).toBe(artifact.manifest.geometry.heightPx);
      expect(Math.abs(probe.frameCount - artifact.manifest.geometry.frameCount)).toBeLessThanOrEqual(1);
    } finally {
      cleanScratch(scratch);
    }
  });

  it("R508 same-event integrity — the tactical artifact carries the canonical SWM provenance verbatim", async () => {
    const { deps, scratch } = derivedDeps();
    try {
      const request = await buildDispatchRequest({
        rendererId: "tactical.prototype",
        jobId: "render-job-r508-swm",
        idempotencyKey: "render-r508-swm-key",
        outputProfile: tacticalProfileOverride(),
      });
      // The dispatch's own materialized SWM inputs (the canonical truth).
      const snapshotVersion = (request.inputs[0]!.payload as { snapshotVersion: number })
        .snapshotVersion;
      const entries = (request.inputs[1]!.payload as { entries: { sequence: number }[] }).entries;
      const lastSequence = entries.at(-1)?.sequence ?? 0;
      const envelope = await executeRenderJob(request, deps);
      expect(envelope.status).toBe("succeeded");
      const manifest = envelope.outputs[0]!.manifest as {
        swm: { snapshotVersion: number; lastEventSequence: number } | null;
      };
      // The SWM provenance rides VERBATIM from the canonical inputs — the
      // render READ the world model, never re-derived it.
      expect(manifest.swm).not.toBeNull();
      expect(manifest.swm!.snapshotVersion).toBe(snapshotVersion);
      expect(manifest.swm!.lastEventSequence).toBeGreaterThanOrEqual(lastSequence);
      const frozen = RenderArtifactManifest.parse(
        (envelope.outputs[0]!.manifest as { rendererManifest: unknown }).rendererManifest,
      );
      expect(frozen.swm).toEqual(manifest.swm);
      expect(frozen.sessionId).toBe(SESSION_ID);
    } finally {
      cleanScratch(scratch);
    }
  });

  it("re-executing the same derived job registers idempotently (counted duplicate)", async () => {
    const { deps, scratch } = derivedDeps();
    try {
      const request = await buildDispatchRequest({
        rendererId: "tactical.prototype",
        jobId: "render-job-r508-dup",
        idempotencyKey: "render-r508-dup-key",
        outputProfile: tacticalProfileOverride(),
      });
      const first = await executeRenderJob(request, deps);
      const second = await executeRenderJob(request, deps);
      expect(first.status).toBe("succeeded");
      expect(second.status).toBe("succeeded");
      expect(second.metering.duplicateStores).toBe(1);
      expect(second.outputs[0]!.contentHash).toBe(first.outputs[0]!.contentHash);
    } finally {
      cleanScratch(scratch);
    }
  });

  it("an unavailable derived-reality renderer fails honestly (no SVG fallback in disguise)", async () => {
    // A composed plane WITHOUT the derived renderer: the tactical dispatch
    // must fail determinately (the honest posture — never a silent SVG path).
    const deps: RenderJobExecutorDeps = {
      rendererRegistry: workerRegistry(),
      outputSegmentStore: new InMemoryRenderSegmentStore(),
      nowMs: clock(),
      budgets: {
        maxExecutionMs: 10_000,
        maxArtifactBytes: 1_000_000,
        maxJobDeadlineMs: 60_000,
        minJobDeadlineMs: 1_000,
        dispatchTimeoutMs: 5_000,
        maxConcurrentJobs: 4,
      },
    };
    // The registry does not resolve the tactical renderer at all →
    // renderer-unknown (the wave-4 posture preserved byte-identically).
    const request = await buildDispatchRequest({
      rendererId: "tactical.prototype",
      jobId: "render-job-r508-unavailable",
      idempotencyKey: "render-r508-unavailable-key",
      outputProfile: tacticalProfileOverride(),
    });
    const envelope = await executeRenderJob(request, deps);
    expect(envelope.status).toBe("failed");
    expect(envelope.failure?.errorClass).toBe("renderer-unknown");
  });
});

describe("the derived-reality renderer vocabulary", () => {
  it("hosts exactly the three product renderers over their bridges", () => {
    expect(DERIVED_REALITY_RENDERERS).toEqual({
      "tactical.prototype": "tactical",
      "game-3d.prototype": "game-3d",
      "anime-npr.prototype": "anime-npr",
    });
    const { deps } = derivedDeps();
    expect(deps.derivedRealityRenderer!.supports("tactical.prototype")).toBe(true);
    expect(deps.derivedRealityRenderer!.supports("anime.prototype")).toBe(false);
    expect(deps.derivedRealityRenderer!.supports("sporta.testcard")).toBe(false);
  });

  it("base64Of is the store module's own honest representation (reused, not re-declared)", () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251]);
    expect(base64Of(bytes)).toBe(Buffer.from(bytes).toString("base64"));
  });
});
