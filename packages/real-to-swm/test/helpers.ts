/**
 * Shared test helpers (R207/R208): the gate-manifest loader with fail-closed
 * fixture verification, the ffmpeg availability probe, and the standard gate
 * pipeline config. Test-only module — never exported from the package.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { FfmpegDecoderAdapter } from "@sporta/decoding";
import { buildAuthorizationPolicy } from "@sporta/testing";
import type { AuthorizationPolicy } from "@sporta/contracts";
import type { ClipProvenance, ClipSource, RealToSwmPipelineConfig } from "../src/index";

/** One gate clip entry of the committed TL manifest (loaded verbatim). */
export interface GateClipEntry {
  readonly clipId: string;
  readonly gateClip: number;
  readonly title: string;
  readonly sourceUrl: string;
  readonly licenseId: string;
  readonly licenseNote: string;
  readonly licenseAttribution?: string;
  readonly sourceSha256: string;
  readonly normalizedFile: string;
  readonly normalizedShape: {
    readonly durationSeconds: number;
    readonly width: number;
    readonly height: number;
    readonly fps: number;
    readonly frameCount: number;
  };
  readonly normalizedSha256: string;
}

interface GateManifest {
  readonly manifestVersion: string;
  readonly clips: readonly GateClipEntry[];
}

/** The package fixtures root. */
export const FIXTURES_ROOT = join(import.meta.dir, "..", "fixtures");

/** Loads the committed gate manifest (the TL media drop, verbatim). */
export function loadGateManifest(): GateManifest {
  const manifest = JSON.parse(
    readFileSync(join(FIXTURES_ROOT, "gate-clips.json"), "utf8"),
  ) as GateManifest;
  if (manifest.clips === undefined || manifest.clips.length === 0) {
    throw new Error("gate manifest carries no clips");
  }
  return manifest;
}

/** The ffmpeg availability probe (the W102 integration-test convention). */
export async function ffmpegAvailable(): Promise<boolean> {
  const availability = await FfmpegDecoderAdapter.detect();
  return availability.available;
}

/** sha-256 of a file's bytes, lowercase hex. */
export function fileSha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export interface LoadedGateClip {
  readonly entry: GateClipEntry;
  readonly bytes: Uint8Array;
  readonly provenance: ClipProvenance;
  readonly source: Omit<ClipSource, "authorizationPolicy">;
}

/**
 * Loads one gate clip FAIL-CLOSED: the committed media file must exist and
 * its sha256 must match the manifest's pinned normalized sha256 — a drifted
 * fixture REFUSES the gate (throws), never runs as if nothing happened.
 */
export function loadGateClip(clipId: string): LoadedGateClip {
  const manifest = loadGateManifest();
  const entry = manifest.clips.find((clip) => clip.clipId === clipId);
  if (entry === undefined) {
    throw new Error(`gate clip "${clipId}" not in the committed manifest`);
  }
  const mediaPath = join(FIXTURES_ROOT, "media", entry.normalizedFile);
  if (!existsSync(mediaPath)) {
    throw new Error(`gate clip media missing: fixtures/media/${entry.normalizedFile}`);
  }
  const actualSha = fileSha256(mediaPath);
  if (actualSha !== entry.normalizedSha256) {
    throw new Error(
      `gate clip "${clipId}" drifted: sha256 ${actualSha} != manifest pin ` +
        `${entry.normalizedSha256} — refusing to run the gate on corrupt media`,
    );
  }
  const bytes = new Uint8Array(readFileSync(mediaPath));
  const provenance: ClipProvenance = {
    clipId: entry.clipId,
    sourceUrl: entry.sourceUrl,
    sourceSha256: entry.sourceSha256,
    licenseId: entry.licenseId,
    ...(entry.licenseAttribution !== undefined
      ? { licenseAttribution: entry.licenseAttribution }
      : {}),
    normalizationNote:
      "normalized per the TL manifest transform: -ss 0 -t 20, scale/pad 640x360, fps 25, " +
      "libx264 crf 20, yuv420p, -an, +faststart",
  };
  return {
    entry,
    bytes,
    provenance,
    source: {
      provenance,
      bytes,
      filename: entry.normalizedFile,
    },
  };
}

/** A rights policy that allows analysis (deterministic test epoch). */
export function gatePolicy(): AuthorizationPolicy {
  return buildAuthorizationPolicy();
}

/** The standard gate decode budget (640x360 rgb24 frames + headroom). */
export const GATE_DECODE_BUDGET_BYTES = 1024 * 1024 * 1024;

/** The standard gate pipeline config (identical in-process and in-script). */
export function gateConfig(clipId: string): RealToSwmPipelineConfig {
  return {
    sessionId: `sess-${clipId}`,
    decode: { maxTotalBytes: GATE_DECODE_BUDGET_BYTES },
  };
}

/** The synthetic-diagnostic fallback fixture path (documented fallback). */
export function syntheticDiagnosticFixturePath(): string {
  const path = join(
    import.meta.dir,
    "..",
    "..",
    "technology-registry",
    "fixtures",
    "media",
    "synthetic-diagnostic-01-players-and-ball.mp4",
  );
  if (!existsSync(path)) {
    throw new Error(`synthetic-diagnostic fixture missing at ${path}`);
  }
  return path;
}
