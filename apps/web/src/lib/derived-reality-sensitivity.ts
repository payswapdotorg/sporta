/**
 * THE DERIVED-REALITY SENSITIVITY GATE (J013) — the pure derivations that
 * turn the J012/J013 premise ("the perception chain produces materially
 * different SWMs on different clips") into the gate verdict the acceptance
 * names:
 *
 * > Meaningful SWM differences change Tactical/3D/Anime outputs;
 *   byte-identical outputs require an explicit equivalence explanation.
 *
 * TWO PURE DERIVATIONS:
 *
 * - {@link swmMaterialDifference} — the PREMISE measurement: two canonical
 *   `WorldSnapshot`s (plus their event tails) differ MATERIALLY when their
 *   entity identity sets differ, or any shared entity's `pitchPosition`
 *   slot moves beyond the documented epsilon (1 cm — the same numerical
 *   floor the renderer's serialization uses; three orders below any real
 *   motion), or their event streams carry different content. The evidence
 *   string records WHAT differed (never a bare boolean).
 * - {@link sensitivityVerdictOf} — the GATE VERDICT for one derived
 *   reality over one pair of artifacts: different artifact content hashes
 *   on materially-different SWMs = `sensitive` (the gate passes);
 *   byte-identical artifacts on materially-different SWMs =
 *   `unexplained-identity` (the gate FAILS — the renderer fidelity bug
 *   J012 documented, never faked away); byte-identical artifacts on
 *   EQUIVALENT SWMs = `equivalent` with the EXPLICIT explanation (the
 *   honest equivalence path: same source content hash, same SWM
 *   provenance, deterministic renderer).
 *
 * PURITY: no clock, no env, no I/O — verdicts are pure functions of the
 * measured premise + the frozen manifests' own records.
 */

/** The position epsilon (meters) — below any real motion, above rounding. */
export const SWM_POSITION_EPSILON_METERS = 0.01;

/** The closed derived-reality vocabulary (the frozen contract's kinds). */
export type DerivedRealityKind = "tactical" | "three-d-game" | "anime-npr";

/** A position slot as the canonical SWM carries it (pitch meters). */
export interface SwmPositionSlot {
  x: number;
  y: number;
  z?: number;
}

/** One entity's comparison-relevant state (the canonical snapshot's own). */
export interface SwmEntityLike {
  entityId: string;
  kind: string;
  version: number;
  state: Record<string, unknown>;
}

/** One canonical world snapshot (the comparison-relevant subset). */
export interface SwmSnapshotLike {
  sessionId: string;
  entities: readonly SwmEntityLike[];
  watermark: { sequence: number; watermarkMs: number };
}

/** One world event (the comparison-relevant subset of the envelope). */
export interface SwmEventLike {
  sequence: number;
  eventTimeMs: number;
  eventTypeRef: string;
}

/** The measured material difference between two canonical SWMs. */
export interface SwmMaterialDifference {
  differs: boolean;
  /** WHAT differed (the honest evidence — never a bare boolean). */
  evidence: string[];
}

/**
 * Reads one entity's pitch-frame position slot, meters — the SCENE
 * PROJECTION'S OWN documented rule: the `pitchPosition` key when it exists
 * (the key names the pitch frame), else the `position` key (the fusion
 * projection's slot; the `spatialFrame` slot declares its frame). `null`
 * when the entity carries no usable position (the honest absence — never
 * a fabricated zero).
 */
export function pitchPositionOf(entity: SwmEntityLike): SwmPositionSlot | null {
  for (const key of ["pitchPosition", "position"] as const) {
    const raw = entity.state[key];
    if (typeof raw !== "object" || raw === null) continue;
    const record = raw as Record<string, unknown>;
    const value = record["value"];
    if (typeof value !== "object" || value === null) continue;
    const position = value as Record<string, unknown>;
    if (typeof position["x"] !== "number" || typeof position["y"] !== "number") continue;
    return {
      x: position["x"],
      y: position["y"],
      ...(typeof position["z"] === "number" ? { z: position["z"] } : {}),
    };
  }
  return null;
}

/**
 * Measures the MATERIAL difference between two canonical SWMs (the J013
 * premise): entity identity sets, per-entity pitch positions (epsilon
 * 1 cm), and event-stream content. Pure — the evidence records exactly
 * what differed.
 */
export function swmMaterialDifference(input: {
  left: { snapshot: SwmSnapshotLike; events: readonly SwmEventLike[] };
  right: { snapshot: SwmSnapshotLike; events: readonly SwmEventLike[] };
}): SwmMaterialDifference {
  const evidence: string[] = [];
  const leftById = new Map(input.left.snapshot.entities.map((e) => [e.entityId, e]));
  const rightById = new Map(input.right.snapshot.entities.map((e) => [e.entityId, e]));
  const leftIds = new Set(leftById.keys());
  const rightIds = new Set(rightById.keys());
  const onlyLeft = [...leftIds].filter((id) => !rightIds.has(id));
  const onlyRight = [...rightIds].filter((id) => !leftIds.has(id));
  if (onlyLeft.length > 0) evidence.push(`entities only in the left SWM: ${onlyLeft.join(", ")}`);
  if (onlyRight.length > 0) {
    evidence.push(`entities only in the right SWM: ${onlyRight.join(", ")}`);
  }
  let moved = 0;
  for (const [id, leftEntity] of leftById) {
    const rightEntity = rightById.get(id);
    if (rightEntity === undefined) continue;
    if (leftEntity.kind !== rightEntity.kind) {
      evidence.push(`entity ${id} changed kind (${leftEntity.kind} → ${rightEntity.kind})`);
      continue;
    }
    const leftPosition = pitchPositionOf(leftEntity);
    const rightPosition = pitchPositionOf(rightEntity);
    if (leftPosition === null && rightPosition === null) continue;
    if (leftPosition === null || rightPosition === null) {
      evidence.push(
        `entity ${id} position presence differs (${leftPosition === null ? "absent" : "present"} vs ${rightPosition === null ? "absent" : "present"})`,
      );
      continue;
    }
    const distance = Math.hypot(leftPosition.x - rightPosition.x, leftPosition.y - rightPosition.y);
    if (distance > SWM_POSITION_EPSILON_METERS) moved += 1;
  }
  if (moved > 0)
    evidence.push(`${moved} shared entities moved beyond ${SWM_POSITION_EPSILON_METERS} m`);
  // The event streams: content equality (type + event time) at each
  // sequence — a re-timing with identical content is NOT material.
  const leftSignature = input.left.events.map((e) => `${e.eventTypeRef}@${e.eventTimeMs}`);
  const rightSignature = input.right.events.map((e) => `${e.eventTypeRef}@${e.eventTimeMs}`);
  if (leftSignature.join("|") !== rightSignature.join("|")) {
    evidence.push(
      `event streams differ (${input.left.events.length} vs ${input.right.events.length} events, content-unequal)`,
    );
  }
  return { differs: evidence.length > 0, evidence };
}

// ---------------------------------------------------------------------------
// The gate verdict
// ---------------------------------------------------------------------------

/** One artifact's gate-relevant records (the frozen manifest's own). */
export interface SensitivityArtifactRecord {
  /** The artifact's content hash (the store-verified sha-256). */
  contentHash: string;
  /** The SWM provenance the manifest froze (null = the original reality). */
  swm: { snapshotVersion: number; lastEventSequence: number } | null;
  /** The SOURCE content hash, when the manifest carries one (equivalence). */
  sourceContentHash?: string;
}

/** The J013 gate verdict for one derived reality over one artifact pair. */
export type SensitivityVerdict =
  | {
      kind: "sensitive";
      reality: DerivedRealityKind;
      /** The measured SWM premise evidence (recorded verbatim). */
      premise: string[];
    }
  | {
      kind: "equivalent";
      reality: DerivedRealityKind;
      /** The EXPLICIT equivalence explanation (the acceptance's demand). */
      explanation: string;
    }
  | {
      kind: "unexplained-identity";
      reality: DerivedRealityKind;
      /** The gate FAILURE's honest problem statement. */
      problem: string;
      premise: string[];
    }
  | {
      kind: "regenerated";
      reality: DerivedRealityKind;
      /** The honest note: equivalent SWMs, non-identical bytes (a determinism gap outside the gate's failure classes — reported, never hidden). */
      note: string;
    };

/**
 * Derives the J013 gate verdict for one derived reality: materially
 * different SWMs MUST change the artifact (different content hashes), and
 * byte-identical artifacts REQUIRE an explicit equivalence explanation —
 * which only equivalent SWMs can provide. Pure.
 */
export function sensitivityVerdictOf(input: {
  reality: DerivedRealityKind;
  left: SensitivityArtifactRecord;
  right: SensitivityArtifactRecord;
  premise: SwmMaterialDifference;
}): SensitivityVerdict {
  const byteIdentical = input.left.contentHash === input.right.contentHash;
  if (byteIdentical && input.premise.differs) {
    return {
      kind: "unexplained-identity",
      reality: input.reality,
      problem:
        `byte-identical ${input.reality} artifacts over materially different SWMs — the renderer collapsed the difference ` +
        `(the J012 fidelity bug's signature; this is a gate FAILURE, never faked away)`,
      premise: input.premise.evidence,
    };
  }
  if (!byteIdentical && input.premise.differs) {
    return {
      kind: "sensitive",
      reality: input.reality,
      premise: input.premise.evidence,
    };
  }
  if (!byteIdentical) {
    // Equivalent SWMs with NON-identical bytes: outside the gate's failure
    // classes (the inputs were equivalent; the outputs were not) — the
    // honest regeneration note, reported.
    return {
      kind: "regenerated",
      reality: input.reality,
      note:
        `equivalent SWMs produced non-identical ${input.reality} artifacts (content hashes differ) — the renderer/encode ` +
        `path is not byte-deterministic across regenerations; a determinism gap, honestly reported`,
    };
  }
  // Byte-identical artifacts over EQUIVALENT SWMs — the explicit
  // equivalence explanation (the recorded reason, never an excuse).
  const sameSource =
    input.left.sourceContentHash !== undefined &&
    input.right.sourceContentHash !== undefined &&
    input.left.sourceContentHash === input.right.sourceContentHash;
  const sameProvenance =
    input.left.swm !== null &&
    input.right.swm !== null &&
    input.left.swm.snapshotVersion === input.right.swm.snapshotVersion &&
    input.left.swm.lastEventSequence === input.right.swm.lastEventSequence;
  const reason = sameSource
    ? "the same source content (identical sha-256) produced the same SWM"
    : sameProvenance
      ? `the same SWM provenance (snapshot v${input.left.swm!.snapshotVersion}, events through ${input.left.swm!.lastEventSequence})`
      : "equivalent SWMs (the measured material difference is empty)";
  return {
    kind: "equivalent",
    reality: input.reality,
    explanation:
      `byte-identical ${input.reality} artifacts: ${reason}; the renderer is deterministic over its SWM input, ` +
      `so identical worlds render identical realities — an explained equivalence, not a sensitivity failure`,
  };
}
