/**
 * The content-addressed artifact layer of the R303/R304 renderers — the
 * W504 convention carried to real MP4 artifacts:
 *
 * - an encoded artifact lives at `<artifactRoot>/objects/<sha-256>.mp4`
 *   (the same content is the same path everywhere — puts are idempotent
 *   by construction);
 * - the {@link RenderArtifactManifest} (the frozen `@sporta/contracts`
 *   media-artifact contract) records the artifact's content hash, byte
 *   size, codec identity, REAL duration (measured by ffprobe, never
 *   asserted), renderer identity, and the SWM provenance
 *   (`snapshotVersion` + `lastEventSequence` the render consumed);
 * - `integrity.verified` becomes `true` ONLY after the stored bytes are
 *   RE-READ from disk and re-hashed to the recorded content hash (the
 *   "an artifact is not complete until its content hash is verified"
 *   honesty rule, executed literally).
 */
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RenderArtifactManifest, type RealityKind } from "@sporta/contracts";
import { CodecError, probeArtifact, type ProbedArtifact } from "./codec";

/** The artifact-store construction options. */
export interface ArtifactStoreOptions {
  /**
   * The durable root for encoded artifacts (default: a fresh `mkdtemp`
   * under the OS tmpdir — hosts that need durability inject their own
   * declared root).
   */
  artifactRoot?: string;
}

/** One stored, integrity-verified MP4 artifact + its manifest. */
export interface StoredRenderArtifact {
  /** The absolute path of the stored artifact (`<root>/objects/<hash>.mp4`). */
  path: string;
  /** The sha-256 content address (64 lowercase hex). */
  contentHash: string;
  /** The manifest (integrity VERIFIED — the bytes were re-read + re-hashed). */
  manifest: RenderArtifactManifest;
  /** The ffprobe-validated view of the artifact (honest geometry/duration). */
  probe: ProbedArtifact;
}

/**
 * The content-addressed MP4 artifact store of the game renderers. One
 * instance owns one root; every put verifies by byte re-read.
 */
export class RenderArtifactStore {
  private readonly root: string;

  constructor(options: ArtifactStoreOptions = {}) {
    this.root = options.artifactRoot ?? mkdtempSync(join(tmpdir(), "sporta-render-artifacts-"));
    mkdirSync(join(this.root, "objects"), { recursive: true });
  }

  /** The artifact root (for hosts that publish/clean it). */
  artifactRootPath(): string {
    return this.root;
  }

  /**
   * Encodes-adjacent put: takes ALREADY-ENCODED mp4 bytes (produced by the
   * typed codec wrapper), stores them content-addressed, re-reads + hashes
   * the stored bytes, ffprobe-validates the artifact, and composes the
   * {@link RenderArtifactManifest} with the SWM provenance the render
   * consumed. `integrity.verified` is `true` only when the re-read hash
   * matches.
   */
  putEncodedArtifact(options: {
    bytes: Uint8Array;
    sessionId: string;
    reality: RealityKind;
    rendererId: string;
    rendererVersion: string;
    snapshotVersion: number;
    lastEventSequence: number;
    expectedWidthPx: number;
    expectedHeightPx: number;
    expectedFrameCount: number;
    expectedFps: number;
    /** Clock for `generatedAtMs` (injectable; default: a deterministic
     *  TEST_EPOCH-based counter — hosts inject a real wall clock). */
    nowMs?: () => number;
  }): StoredRenderArtifact {
    const {
      bytes,
      sessionId,
      reality,
      rendererId,
      rendererVersion,
      snapshotVersion,
      lastEventSequence,
      expectedWidthPx,
      expectedHeightPx,
      expectedFrameCount,
      expectedFps,
    } = options;

    const contentHash = createHash("sha256").update(bytes).digest("hex");
    const path = join(this.root, "objects", `${contentHash}.mp4`);
    writeFileSync(path, bytes);

    // Integrity: RE-READ the stored bytes and re-hash them.
    const reread = readFileSync(path);
    const rereadHash = createHash("sha256").update(reread).digest("hex");
    const verified = rereadHash === contentHash;
    if (!verified) {
      throw new CodecError(
        "putEncodedArtifact: the stored bytes do not re-hash to their content address",
        { path, contentHash, rereadHash },
      );
    }

    // Playability: ffprobe-validate the stored artifact against the
    // expected geometry (an artifact that does not probe is never claimed
    // playable — acceptance contract §D).
    const probe = probeArtifact({
      path,
      widthPx: expectedWidthPx,
      heightPx: expectedHeightPx,
      frameCount: expectedFrameCount,
      fps: expectedFps,
    });

    const nowMs = options.nowMs ?? deterministicArtifactClock();
    const manifest: RenderArtifactManifest = RenderArtifactManifest.parse({
      schemaVersion: "1.1",
      artifactId: `mp4-${contentHash.slice(0, 16)}`,
      sessionId,
      reality,
      contentHash,
      byteSize: bytes.byteLength,
      container: "mp4",
      videoCodec: videoCodecTagOf(probe),
      audioCodec: null,
      durationMs: Math.max(1, Math.round(probe.durationMs)),
      rendererId,
      rendererVersion,
      generatedAtMs: nowMs(),
      swm: { snapshotVersion, lastEventSequence },
      integrity: { algorithm: "sha256" as const, verified },
    });
    return { path, contentHash, manifest, probe };
  }
}

/**
 * The documented h264 profile → AVC codec tag mapping (the contract's
 * example vocabulary: `"avc1.42E01E"` for Constrained Baseline @ L3.0 —
 * exactly what the pinned encode flags produce). Unknown profiles fall
 * back to the honest ffprobe codec name.
 */
export function videoCodecTagOf(probe: ProbedArtifact): string {
  if (probe.codecName === "h264") {
    if (probe.profile === "Constrained Baseline" || probe.profile === "Baseline") {
      return "avc1.42E01E";
    }
    if (probe.profile === "Main") return "avc1.4D401E";
    if (probe.profile === "High") return "avc1.64001E";
  }
  return probe.codecName;
}

let artifactClockTicks = 0;

/** Deterministic default clock: the repo's TEST_EPOCH_MS + ticks pattern. */
function deterministicArtifactClock(): () => number {
  const base = 1_736_164_800_000; // @sporta/testing TEST_EPOCH_MS (2025-01-06T12:00:00.000Z)
  return () => base + (artifactClockTicks += 1);
}
