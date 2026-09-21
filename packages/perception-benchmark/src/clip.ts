/**
 * THE BENCHMARK CLIP SOURCES (L010) — the committed, sha256-pinned clips the
 * harness runs over, each carrying its HONEST boundary label:
 *
 * - `synthetic-diagnostic-01` — a SYNTHETIC-DIAGNOSTIC fixture (NOT real
 *   footage) with exact per-frame ground-truth annotations (the
 *   technology-registry fixture set): the harness's proven-on-fixture input.
 * - `fx-001` / `fx-004` — the two REAL committed gate clips (Wikimedia
 *   Commons; CC0 and CC BY-SA 3.0 nl — explicitly licensed, attribution
 *   carried verbatim): the authorized-media benchmark input. Their
 *   observations are recorded WITHOUT ground-truth scoring (no annotations
 *   exist); latency/dropout/identity still measure.
 *
 * REAL vs FIXTURE is a first-class field on every run this module loads —
 * a run over fixtures never presents as real-media evidence.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The honest media boundary of a benchmark clip. */
export type BenchmarkClipMediaKind = "real-footage" | "synthetic-diagnostic";

/** One committed benchmark clip's identity (the run records it verbatim). */
export interface BenchmarkClipIdentity {
  readonly clipId: string;
  readonly mediaKind: BenchmarkClipMediaKind;
  /** Where the committed bytes live (repo-relative). */
  readonly path: string;
  /** sha256 pin of the committed bytes (fail-closed on drift). */
  readonly sha256: string;
  /** The source license id (verbatim). */
  readonly licenseId: string;
  /** Attribution the license requires (carried verbatim). */
  readonly licenseAttribution?: string;
  /** The canonical source URL. */
  readonly sourceUrl?: string;
  /** Honest note carried into the run record. */
  readonly note: string;
}

/** The synthetic-diagnostic fixture's manifest pin (technology-registry). */
export const SYNTHETIC_DIAGNOSTIC_SHA256 =
  "e75abe1441fe2e6680b2aad5e7d2e66a5bcd21ab4b91928e25181f90a37f7f76";

/** fx-001's manifest pin (the R208 gate manifest). */
export const FX_001_SHA256 = "4e2f3e3d9df1eb4b0403a442c2371821c684ab8880b4544099b2d5d962543ff7";

/** fx-004's manifest pin (the R208 gate manifest). */
export const FX_004_SHA256 = "77b631deaed4d3e3eb16a342d1aaae39389f8731b1598eddf9fba4e9b4d3ad07";

function packageRoot(): string {
  return dirname(dirname(fileURLToPath(import.meta.url)));
}

/** The committed benchmark clips (identity order, deterministic). */
export function committedBenchmarkClips(): readonly BenchmarkClipIdentity[] {
  return [
    {
      clipId: "synthetic-diagnostic-01",
      mediaKind: "synthetic-diagnostic",
      path: join(
        packageRoot(),
        "..",
        "technology-registry",
        "fixtures",
        "media",
        "synthetic-diagnostic-01-players-and-ball.mp4",
      ),
      sha256: SYNTHETIC_DIAGNOSTIC_SHA256,
      licenseId: "in-repo-synthetic-diagnostic",
      note:
        "SYNTHETIC-DIAGNOSTIC fixture (NOT real footage): 640x360, 12s, 25fps, 10 " +
        "team-colored discs + ball on deterministic sinusoidal paths; exact ground " +
        "truth by construction (technology-registry fixture set).",
    },
    {
      clipId: "fx-001",
      mediaKind: "real-footage",
      path: join(packageRoot(), "..", "real-to-swm", "fixtures", "media", "fx-001-normalized.mp4"),
      sha256: FX_001_SHA256,
      licenseId: "CC0-1.0",
      sourceUrl:
        "https://upload.wikimedia.org/wikipedia/commons/d/da/2021-08-29_-_FIFA_Beach_Soccer_World_Cup_-_Match_31_-_Switzerland_v_Senegal_-_No%C3%ABl_Ott_scores_a_penalty_kick.webm",
      note:
        "REAL footage (FIFA Beach Soccer World Cup 2021 penalty, Wikimedia Commons, " +
        "CC0): 640x360, 10s, 250 frames. No ground-truth annotations exist — " +
        "observations are recorded unscored (latency/dropout/identity still measure).",
    },
    {
      clipId: "fx-004",
      mediaKind: "real-footage",
      path: join(packageRoot(), "..", "real-to-swm", "fixtures", "media", "fx-004-normalized.mp4"),
      sha256: FX_004_SHA256,
      licenseId: "CC-BY-SA-3.0-nl",
      licenseAttribution:
        "Wedstrijd om de Nederlandse voetbalbeker, Weeknummer 44-24 - Open Beelden " +
        "- 10245. Source: Open Beelden / Nederlandse Instituut voor Beeld en Geluid, " +
        "via Wikimedia Commons. Licensed under CC BY-SA 3.0 nl.",
      sourceUrl:
        "https://upload.wikimedia.org/wikipedia/commons/f/fe/Wedstrijd_om_de_Nederlandse_voetbalbeker_Weeknummer_44-24_-_Open_Beelden_-_10245.ogv",
      note:
        "REAL footage (1944 Dutch cup newsreel, Open Beelden, CC BY-SA 3.0 nl — " +
        "attribution + share-alike carried verbatim): 640x360, 20s, 500 frames. No " +
        "ground-truth annotations exist — observations are recorded unscored.",
    },
  ];
}

/** A loaded benchmark clip: identity + verified bytes. */
export interface LoadedBenchmarkClip {
  readonly identity: BenchmarkClipIdentity;
  readonly bytes: Uint8Array;
  readonly filename: string;
}

/**
 * Loads one committed clip FAIL-CLOSED: the file must exist and its sha256
 * must match the manifest pin — drifted media refuses the benchmark, never
 * runs as if nothing happened.
 */
export function loadBenchmarkClip(clipId: string): LoadedBenchmarkClip {
  const identity = committedBenchmarkClips().find((clip) => clip.clipId === clipId);
  if (identity === undefined) {
    throw new Error(
      `benchmark clip "${clipId}" is not committed (known: synthetic-diagnostic-01, fx-001, fx-004)`,
    );
  }
  if (!existsSync(identity.path)) {
    throw new Error(`benchmark clip media missing: ${identity.path}`);
  }
  const bytes = new Uint8Array(readFileSync(identity.path));
  const sha = createHash("sha256").update(bytes).digest("hex");
  if (sha !== identity.sha256) {
    throw new Error(
      `benchmark clip "${clipId}" drifted: sha256 ${sha} != manifest pin ${identity.sha256}`,
    );
  }
  return { identity, bytes, filename: identity.path.split("/").pop()! };
}
