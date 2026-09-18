/**
 * The canonical possession-path test: the full default pipeline on the
 * documented synthetic-diagnostic fallback fixture (the technology
 * registry's committed media, sha256-pinned in its manifest). This is where
 * the pitch-calibration → pitch-space projection → possession-change
 * canonical-event path is exercised end-to-end (the two REAL gate clips
 * honestly refuse calibration — beach sand and archival film carry no
 * pitch-green — so the canonical path's executable evidence lives here, per
 * the documented fallback contract).
 *
 * REAL vs FIXTURE BOUNDARY (honesty contract): this test runs SYNTHETIC
 * diagnostic media, never presented as real footage; the R208 gate itself
 * (gate.test.ts) runs the two REAL Wikimedia clips.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { WorldEventStreamEntry } from "@sporta/contracts";
import { RealToSwmPipeline, buildReconstructionArtifact, replayReconstruction } from "../src/index";
import { buildAuthorizationPolicy } from "@sporta/testing";
import { ffmpegAvailable, syntheticDiagnosticFixturePath } from "./helpers";

const available = await ffmpegAvailable();
if (!available) {
  console.warn("ffmpeg unavailable — skipping the synthetic canonical-path test");
}

/** The registry manifest's pinned sha256 for the synthetic fixture. */
const SYNTHETIC_FIXTURE_SHA256 = "e75abe1441fe2e6680b2aad5e7d2e66a5bcd21ab4b91928e25181f90a37f7f76";

describe.skipIf(!available)(
  "canonical possession path (synthetic-diagnostic fixture — NOT real footage)",
  () => {
    test("line-based calibration succeeds → pitch tracks → possession-change events applied", async () => {
      const mediaPath = syntheticDiagnosticFixturePath();
      const bytes = new Uint8Array(readFileSync(mediaPath));
      // Fail-closed: the fixture must match the registry manifest pin.
      const hasher = new Bun.CryptoHasher("sha256");
      hasher.update(bytes);
      expect(hasher.digest("hex")).toBe(SYNTHETIC_FIXTURE_SHA256);

      const pipeline = new RealToSwmPipeline();
      const result = await pipeline.run({
        source: {
          provenance: {
            clipId: "synthetic-diagnostic-01",
            normalizationNote:
              "procedurally generated in-repo fixture (NOT real footage); see the " +
              "technology-registry fixture manifest",
          },
          bytes,
          authorizationPolicy: buildAuthorizationPolicy(),
          filename: "synthetic-diagnostic-01-players-and-ball.mp4",
        },
        config: {
          sessionId: "sess-synthetic-diagnostic-01",
          decode: { maxTotalBytes: 1024 * 1024 * 1024 },
        },
      });

      // The calibration stage SUCCEEDED via the line-based candidate.
      const calibrate = result.ledger.stages.find((s) => s.stage === "calibrate")!;
      expect(calibrate.attempted[0]!.technologyId).toBe("line-based-field-calibrator");
      expect(calibrate.attempted[0]!.outcome).toBe("used");
      expect(calibrate.framesOut).toBe(1);

      // Track observations carry PITCH-space positions (projected through
      // the calibration, confidence discounted by the calibration's own).
      const bridge = result.ledger.stages.find((s) => s.stage === "bridge")!;
      expect(bridge.notes.join(" ")).not.toContain("image");
      const anyTrack = result.store
        .all()
        .find(
          (obs) =>
            obs.payload.kind === "track" &&
            obs.subjectEntityRefs.some((r) => r.kind === "participant"),
        );
      expect(anyTrack).toBeDefined();
      if (anyTrack?.payload.kind === "track") {
        // Pitch meters: a projected position on the 105x68 frame.
        const { x, y } = anyTrack.payload.position;
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(105);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(68);
      }

      // Canonical possession-change events were applied to the engine with
      // resolvable evidence chains (validated by the W005 derivation).
      expect(result.events.length).toBeGreaterThan(0);
      for (const entry of result.events) {
        expect(WorldEventStreamEntry.safeParse(entry).success).toBe(true);
        expect(entry.event.eventTypeRef).toBe("football/v1/possession-change");
        expect(entry.event.provenance).toBe("DERIVED");
        expect(entry.event.confidence).toBeGreaterThan(0);
        expect(entry.event.confidence).toBeLessThanOrEqual(1);
        for (const observationId of entry.event.evidence.observationIds) {
          expect(result.store.byId(observationId)).toBeDefined();
        }
      }

      // The artifact + replay carry the events.
      const artifact = buildReconstructionArtifact(result, {
        clipId: "synthetic-diagnostic-01",
      });
      expect(artifact.swm.events.length).toBe(result.events.length);
      const view = replayReconstruction(artifact);
      expect(view.events.length).toBe(result.events.length);

      // Determinism on the synthetic fixture too (same clip + config).
      const rerun = await new RealToSwmPipeline().run({
        source: {
          provenance: { clipId: "synthetic-diagnostic-01" },
          bytes,
          authorizationPolicy: buildAuthorizationPolicy(),
          filename: "synthetic-diagnostic-01-players-and-ball.mp4",
        },
        config: {
          sessionId: "sess-synthetic-diagnostic-01",
          decode: { maxTotalBytes: 1024 * 1024 * 1024 },
        },
      });
      expect(
        buildReconstructionArtifact(rerun, { clipId: "synthetic-diagnostic-01" }).contentHash,
      ).toBe(artifact.contentHash);
    }, 120_000);
  },
);
