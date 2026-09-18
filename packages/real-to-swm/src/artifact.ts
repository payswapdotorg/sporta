/**
 * The `ReconstructionArtifact` (R208): the replayable record of one
 * real-clip reconstruction — the emitted SWM timeline, the FULL degradation
 * ledger, per-entity provenance, the clip's verbatim provenance (source URL,
 * sha256, license), and a content hash (sha-256 over the canonical
 * serialization).
 *
 * REPLAY = reconstruct the SWM view from the artifact ALONE (no
 * re-perception): `parseArtifact` verifies the content hash and validates
 * every embedded snapshot/event against the frozen contracts, and
 * `replayReconstruction` returns the reconstructed view (snapshots, event
 * stream, entity provenance, event candidates, ledger).
 *
 * DETERMINISM: the content hash covers the canonical JSON of the artifact
 * with `contentHash` excluded — same clip + same config + same candidates →
 * byte-identical hash, in-process and cross-subprocess.
 */
import { WorldEventStreamEntry, WorldSnapshot } from "@sporta/contracts";
import type { FootballState } from "@sporta/world-model";
import { SCHEMA_VERSION } from "@sporta/contracts";
import type { FusionReport } from "@sporta/fusion";
import { ArtifactIntegrityError, ArtifactValidationError } from "./errors";
import type { DegradationLedger } from "./ledger";
import { canonicalJson, sha256HexOfString } from "./canonical";
import type { EventCandidateRecord } from "./events";
import type { EntityProvenance, PipelineResult, ResolvedCandidate } from "./pipeline";
import type { ClipProvenance } from "./clip";

/** The artifact's SWM timeline section. */
export interface ArtifactSwmTimeline {
  /** Snapshots at the configured cadence plus the final state. */
  readonly snapshots: readonly WorldSnapshot[];
  /** The engine's ordered event stream (canonical events only). */
  readonly events: readonly WorldEventStreamEntry[];
  /** The final football extension state (null when the engine carried none). */
  readonly football: FootballState | null;
}

/** The replayable reconstruction artifact. */
export interface ReconstructionArtifact {
  readonly schemaVersion: string;
  /** Deterministic artifact id: `rswm-<clip sha256[:12]>-<config hash[:8]>`. */
  readonly artifactId: string;
  /** The clip identity + decode shape + verbatim provenance. */
  readonly clip: {
    readonly clipId: string;
    readonly filename: string;
    readonly byteLength: number;
    /** sha-256 of the decoded (normalized) clip bytes. */
    readonly contentSha256: string;
    readonly container: string;
    readonly durationMs: number;
    readonly frameCount: number;
    readonly width: number;
    readonly height: number;
    readonly fps: number;
    readonly firstFrameMs: number;
    readonly lastFrameMs: number;
    /** Verbatim provenance (source URL / source sha256 / license). */
    readonly provenance: ClipProvenance;
  };
  /** The run's resolved configuration echo (defaults filled). */
  readonly pipeline: {
    readonly sessionId: string;
    readonly nowMs: number;
    readonly config: unknown;
    readonly candidates: readonly ResolvedCandidate[];
  };
  readonly swm: ArtifactSwmTimeline;
  /** Pipeline-level event candidates (typed, evidence-linked, NOT canonical). */
  readonly eventCandidates: readonly EventCandidateRecord[];
  readonly provenance: {
    readonly entities: readonly EntityProvenance[];
    readonly observations: {
      readonly playerTracks: number;
      readonly ballTracks: number;
      readonly teamAssignments: number;
      readonly fieldMappings: number;
      readonly detections: number;
    };
  };
  /** The W401 fusion report, verbatim. */
  readonly fusion: FusionReport;
  /** The full degradation ledger. */
  readonly ledger: DegradationLedger;
  /** sha-256 over the canonical JSON of this artifact (contentHash excluded). */
  readonly contentHash: string;
}

/** Serializes the artifact body (everything except the hash) canonically. */
function artifactBodyJson(artifact: Omit<ReconstructionArtifact, "contentHash">): string {
  return canonicalJson(artifact);
}

/** Computes the artifact content hash over its canonical serialization. */
export function artifactContentHash(artifact: Omit<ReconstructionArtifact, "contentHash">): string {
  return sha256HexOfString(artifactBodyJson(artifact));
}

/** Builds the artifact from a pipeline result plus the clip provenance. */
export function buildReconstructionArtifact(
  result: PipelineResult,
  provenance: ClipProvenance,
): ReconstructionArtifact {
  const finalSnapshot = result.snapshots[result.snapshots.length - 1];
  const body: Omit<ReconstructionArtifact, "contentHash"> = {
    schemaVersion: SCHEMA_VERSION,
    artifactId: "rswm-pending",
    clip: {
      clipId: result.clip.clipId,
      filename: result.clip.filename,
      byteLength: result.clip.byteLength,
      contentSha256: result.clip.contentSha256,
      container: result.clip.container,
      durationMs: result.clip.durationMs,
      frameCount: result.clip.frameCount,
      width: result.clip.width,
      height: result.clip.height,
      fps: result.clip.fps,
      firstFrameMs: result.clip.firstFrameMs,
      lastFrameMs: result.clip.lastFrameMs,
      provenance,
    },
    pipeline: {
      sessionId: result.sessionId,
      nowMs: result.config.nowMs,
      config: result.config,
      candidates: result.candidates,
    },
    swm: {
      snapshots: [...result.snapshots],
      events: [...result.events],
      football: finalSnapshot?.football ?? null,
    },
    eventCandidates: [...result.eventCandidates],
    provenance: {
      entities: [...result.provenance],
      observations: result.observationCounts,
    },
    fusion: result.fusion,
    ledger: result.ledger,
  };
  const configHash = sha256HexOfString(canonicalJson(result.config));
  const artifactId = `rswm-${result.clip.contentSha256.slice(0, 12)}-${configHash.slice(0, 8)}`;
  const withId = { ...body, artifactId };
  const contentHash = artifactContentHash(withId);
  return { ...withId, contentHash };
}

/** Serializes a complete artifact (hash included) to canonical JSON text. */
export function serializeArtifact(artifact: ReconstructionArtifact): string {
  return canonicalJson(artifact);
}

/**
 * Parses artifact JSON: validates the content hash FIRST (integrity), then
 * the structural fields (stages, snapshots, events against the frozen
 * contracts). Throws `ArtifactIntegrityError` / `ArtifactValidationError`.
 */
export function parseArtifact(json: string): ReconstructionArtifact {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    throw new ArtifactIntegrityError(`artifact JSON is not parseable: ${(error as Error).message}`);
  }
  if (parsed === null || typeof parsed !== "object") {
    throw new ArtifactValidationError("artifact must be a JSON object");
  }
  const record = parsed as Record<string, unknown>;
  const { contentHash, ...rest } = record;
  if (typeof contentHash !== "string" || !/^[0-9a-f]{64}$/.test(contentHash)) {
    throw new ArtifactIntegrityError(
      "artifact contentHash is missing or malformed (64 lowercase hex digits required)",
    );
  }
  const recomputed = sha256HexOfString(canonicalJson(rest));
  if (recomputed !== contentHash) {
    throw new ArtifactIntegrityError(
      `artifact content hash mismatch: expected ${contentHash}, recomputed ${recomputed} — ` +
        "the artifact is corrupted or was tampered with",
      { expected: contentHash, recomputed },
    );
  }
  const artifact = { ...rest, contentHash } as ReconstructionArtifact;
  validateArtifact(artifact);
  return artifact;
}

/** Structural validation against the frozen contracts (snapshots/events). */
function validateArtifact(artifact: ReconstructionArtifact): void {
  const issues: string[] = [];
  if (artifact.schemaVersion !== SCHEMA_VERSION) {
    issues.push(`schemaVersion ${artifact.schemaVersion} (expected ${SCHEMA_VERSION})`);
  }
  if (!Array.isArray(artifact.swm?.snapshots) || artifact.swm.snapshots.length === 0) {
    issues.push("swm.snapshots must be a non-empty array");
  } else {
    for (const [index, snapshot] of artifact.swm.snapshots.entries()) {
      const parsed = WorldSnapshot.safeParse(snapshot);
      if (!parsed.success) {
        issues.push(`swm.snapshots[${index}] fails the frozen WorldSnapshot contract`);
        break;
      }
    }
  }
  if (!Array.isArray(artifact.swm?.events)) {
    issues.push("swm.events must be an array");
  } else {
    for (const [index, entry] of artifact.swm.events.entries()) {
      const parsed = WorldEventStreamEntry.safeParse(entry);
      if (!parsed.success) {
        issues.push(`swm.events[${index}] fails the frozen WorldEventStreamEntry contract`);
        break;
      }
    }
  }
  if (!Array.isArray(artifact.ledger?.stages) || artifact.ledger.stages.length === 0) {
    issues.push("ledger.stages must be a non-empty array");
  }
  if (typeof artifact.clip?.contentSha256 !== "string") {
    issues.push("clip.contentSha256 missing");
  }
  if (issues.length > 0) {
    throw new ArtifactValidationError(
      `artifact failed structural validation: ${issues.join("; ")}`,
      { issues },
    );
  }
}

/** The reconstructed SWM view (replay output). */
export interface ReconstructedView {
  /** The clip identity the view reconstructs. */
  readonly clipId: string;
  readonly contentHash: string;
  /** The snapshots in timeline order (validated against the contracts). */
  readonly snapshots: readonly WorldSnapshot[];
  /** The ordered canonical event stream. */
  readonly events: readonly WorldEventStreamEntry[];
  /** Entities present in the final snapshot, with their provenance. */
  readonly entities: readonly {
    readonly entityId: string;
    readonly kind: string;
    readonly provenance: EntityProvenance | undefined;
  }[];
  /** Pipeline-level event candidates (typed, evidence-linked). */
  readonly eventCandidates: readonly EventCandidateRecord[];
  /** The full degradation ledger. */
  readonly ledger: DegradationLedger;
}

/**
 * Replays the reconstruction: reconstructs the SWM view from the artifact
 * ALONE — no re-perception, no pipeline execution. The content hash is
 * re-verified and every snapshot/event re-validated against the frozen
 * contracts; the final snapshot's entities are joined with their per-entity
 * provenance records.
 */
export function replayReconstruction(artifact: ReconstructionArtifact): ReconstructedView {
  const finalSnapshot = artifact.swm.snapshots[artifact.swm.snapshots.length - 1];
  if (finalSnapshot === undefined) {
    throw new ArtifactValidationError("artifact carries no snapshots");
  }
  const provenanceByEntity = new Map(
    artifact.provenance.entities.map((entry) => [entry.entityId, entry]),
  );
  const entities = finalSnapshot.entities
    .map((entity) => ({
      entityId: entity.entityId,
      kind: entity.kind,
      provenance: provenanceByEntity.get(entity.entityId),
    }))
    .sort((a, b) => (a.entityId < b.entityId ? -1 : a.entityId > b.entityId ? 1 : 0));
  return {
    clipId: artifact.clip.clipId,
    contentHash: artifact.contentHash,
    snapshots: artifact.swm.snapshots,
    events: artifact.swm.events,
    entities,
    eventCandidates: artifact.eventCandidates,
    ledger: artifact.ledger,
  };
}
