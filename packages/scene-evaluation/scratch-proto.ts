/** Scratch prototype: validate the W605 fixture engine story end to end. */
import { SCHEMA_VERSION } from "@sporta/contracts";
import { WorldModelEngine } from "@sporta/world-model";
import { eventWindow, stateAt } from "@sporta/temporal";
import { projectScene } from "@sporta/scene-projection";
import {
  AVATAR_FIELD_ANIMATED_OUTPUT_PROFILE,
  AVATAR_FIELD_RENDERER_ID,
  AVATAR_FIELD_RENDERER_VERSION,
  render3dMatch,
} from "@sporta/renderer-3d";
import type { AvatarField3dMatchStep } from "@sporta/renderer-3d";
import { buildRenderRequest } from "@sporta/testing";

const SESSION_ID = "sess-w605-scene-eval";

const STORY_EVENTS = [
  { eventId: "evt-kickoff", atMs: 1_000, typeRef: "football/v1/kickoff" },
  { eventId: "evt-pass", atMs: 2_500, typeRef: "football/v1/pass" },
  { eventId: "evt-goal", atMs: 4_400, typeRef: "football/v1/goal", confidence: 0.95 },
  { eventId: "evt-save", atMs: 3_500, typeRef: "football/v1/save" },
  { eventId: "evt-card", atMs: 6_200, typeRef: "football/v1/card" },
  { eventId: "evt-flare", atMs: 7_500, typeRef: "custom/v9/flare" },
] as const;

function buildEngine(): WorldModelEngine {
  const football = {
    pitch: {
      lengthAxisMeters: 105,
      widthAxisMeters: 68,
      origin: "corner",
      axes: "x=touchline, y=goal-line",
    },
    clock: { period: "first-half", clockMs: 2_700_000, stoppage: false },
    score: { home: 0, away: 0, status: { status: "known", value: "confirmed" } },
    possession: { status: "uncertain", value: { entityId: "striker-9" }, confidence: 0.72 },
    eventTaxonomyVersion: "v1",
  };
  return WorldModelEngine.create(SESSION_ID, { now: () => 1_736_164_800_000, football });
}

function upsertStory(engine: WorldModelEngine, atMs: number, index: number): void {
  const strikerX = 50 + 5 * index;
  engine.upsertEntity({
    entityId: "striker-9",
    kind: "participant",
    version: 1,
    lastEventTimeMs: atMs,
    state: { pitchPosition: { status: "known", value: { x: strikerX, y: 30 } } },
  });
  engine.upsertEntity({
    entityId: "winger-7",
    kind: "participant",
    version: 1,
    lastEventTimeMs: atMs,
    state: {
      pitchPosition: {
        status: "uncertain",
        value: { x: 20 + index, y: 12 },
        confidence: 0.55,
      },
    },
  });
  // keeper-1: in-bounds through step 5 (index 0..4), OUT of bounds from
  // step 6 (index 5) — a disposition change at a snapshot boundary.
  const keeperX = index <= 4 ? 2.5 : -2;
  engine.upsertEntity({
    entityId: "keeper-1",
    kind: "participant",
    version: 1,
    lastEventTimeMs: atMs,
    state: { pitchPosition: { status: "known", value: { x: keeperX, y: 34 } } },
  });
  engine.upsertEntity({
    entityId: "bench-12",
    kind: "participant",
    version: 1,
    lastEventTimeMs: atMs,
    state: { teamRole: { status: "known", value: "midfielder" } },
  });
  engine.upsertEntity({
    entityId: "official-1",
    kind: "official",
    version: 1,
    lastEventTimeMs: atMs,
    state: { pitchPosition: { status: "known", value: { x: 52.5, y: 42 } } },
  });
  // ball-1: height slot carried through step 6 (index 5), ABSENT from
  // step 7 — the honest mid-timeline height gap (the SWM's height slot is
  // the ball z's only source — W601 S6).
  const ballState: Record<string, unknown> = {
    pitchPosition: {
      status: "uncertain",
      value: { x: strikerX + 1, y: 30.5 },
      confidence: 0.9,
    },
    ...(index <= 5 ? { height: { status: "known", value: 1.2 + 0.16 * index } } : {}),
  };
  engine.upsertEntity({
    entityId: "ball-1",
    kind: "ball",
    version: 1,
    lastEventTimeMs: atMs,
    state: ballState,
  });
  // sub-15: first appears at t=4000 (index 3) — never interpolated into
  // existence before its own step.
  if (index >= 3) {
    engine.upsertEntity({
      entityId: "sub-15",
      kind: "participant",
      version: 1,
      lastEventTimeMs: 4_000,
      state: { pitchPosition: { status: "known", value: { x: 40 + index, y: 20 } } },
    });
  }
  // teleport-3: x 10 until step 3 (index 2), then jumps to 80 — above the
  // 12.51 m/s bound → the segment interpolates nothing (velocity-bound).
  const teleportX = index <= 2 ? 10 : 80;
  engine.upsertEntity({
    entityId: "teleport-3",
    kind: "participant",
    version: 1,
    lastEventTimeMs: atMs,
    state: { pitchPosition: { status: "known", value: { x: teleportX, y: 55 } } },
  });
}

function applyEventsUpTo(engine: WorldModelEngine, atMs: number, applied: Set<string>): void {
  for (const authored of STORY_EVENTS) {
    if (!applied.has(authored.eventId) && authored.atMs <= atMs) {
      applied.add(authored.eventId);
      engine.applyEvent({
        eventId: authored.eventId,
        sessionId: SESSION_ID,
        schemaVersion: SCHEMA_VERSION,
        eventTypeRef: authored.typeRef,
        interval: { startTimeMs: authored.atMs, endTimeMs: authored.atMs },
        eventTimeMs: authored.atMs,
        provenance: "DERIVED",
        ...(authored.confidence === undefined ? {} : { confidence: authored.confidence }),
        evidence: { observationIds: [`obs-${authored.eventId}`] },
      });
    }
  }
}

function buildSteps(): { engine: WorldModelEngine; steps: AvatarField3dMatchStep[] } {
  const engine = buildEngine();
  const applied = new Set<string>();
  const steps: AvatarField3dMatchStep[] = [];
  for (let index = 0; index < 8; index += 1) {
    const atMs = (index + 1) * 1_000;
    upsertStory(engine, atMs, index);
    applyEventsUpTo(engine, atMs, applied);
    engine.applyFootballState({
      atMs,
      clock: {
        period: "second-half",
        clockMs: 2_700_000 + atMs,
        stoppage: index >= 6,
      },
    });
    if (index === 4) {
      // Queried step 4000 already; the goal lands at 4400 → visible from
      // step 5000 as a provisional 1-0.
      engine.applyFootballState({
        atMs: 4_500,
        score: { home: 1, away: 0, status: { status: "uncertain", value: "provisional", confidence: 0.9 } },
      });
    }
    if (index === 5) {
      // The score is confirmed from step 6000.
      engine.applyFootballState({
        atMs: 5_500,
        score: { home: 1, away: 0, status: { status: "known", value: "confirmed" } },
      });
    }
    if (index === 6) {
      // Possession changes to the winger from step 7000.
      engine.applyFootballState({
        atMs: 6_500,
        possession: { status: "uncertain", value: { entityId: "winger-7" }, confidence: 0.6 },
      });
    }
    const snapshot = stateAt(engine, atMs).snapshot;
    const windowed = eventWindow(engine.eventsSince(0), {
      fromMs: index === 0 ? 0 : index * 1_000,
      toMs: atMs,
    });
    steps.push({
      atMs,
      scene: projectScene(snapshot, { events: windowed }),
      ...(index === 7 ? { sceneCutBefore: true } : {}),
    });
  }
  return { engine, steps };
}

const { engine, steps } = buildSteps();
console.log("steps:", steps.length);
console.log("step scoreClock score:", steps.map((s) => JSON.stringify(s.scene.scoreClock.score)));
console.log("step clocks:", steps.map((s) => s.scene.scoreClock.clock?.clockMs));
console.log(
  "step entities:",
  steps.map((s) => s.scene.entities.map((e) => `${e.entityId}:${e.disposition}`).join(",")),
);
console.log(
  "markers per step:",
  steps.map((s) => s.scene.eventMarkers.map((m) => m.sequence).join(",")),
);

const request = buildRenderRequest({
  sessionId: SESSION_ID,
  rendererId: AVATAR_FIELD_RENDERER_ID,
  rendererVersion: AVATAR_FIELD_RENDERER_VERSION,
  snapshotVersion: 1,
  eventsSinceSequence: 0,
  outputProfile: AVATAR_FIELD_ANIMATED_OUTPUT_PROFILE,
  styleConfig: { styleId: "style-3d-scene-eval", configSchemaVersion: "1.0", config: {} },
  rightsCapabilities: {
    canReferenceSourceFrames: true,
    canDeliverLive: true,
    canStoreDerivatives: true,
    canShare: true,
  },
  sourceFrameRefs: [],
});

const out = render3dMatch(request, steps);
console.log("frames:", out.manifest.frames.length);
const f0 = out.manifest.frames[0]!;
const fMid = out.manifest.frames[10]!;
const fLast = out.manifest.frames[out.manifest.frames.length - 1]!;
console.log("frame0 statusLine:", f0.hud.statusLine, "| interp:", JSON.stringify(f0.interpolation));
console.log("frame10 statusLine:", fMid.hud.statusLine, "| interp:", JSON.stringify(fMid.interpolation));
console.log("last statusLine:", fLast.hud.statusLine, "| interp:", JSON.stringify(fLast.interpolation));
console.log(
  "held reasons frame (cut segment):",
  out.manifest.frames
    .filter((f) => f.interpolation?.kind === "held")
    .map((f) => f.entities.map((e) => `${e.entityId}:${e.heldReason ?? e.positionProvenance}`).join(","))
    .slice(0, 1),
);
console.log("skipped:", out.manifest.skippedMarkers.length, "degraded:", out.manifest.degradation);
console.log("ball z on frames 25-35:", out.manifest.frames.slice(25).map((f) => {
  const ball = f.entities.find((e) => e.entityId === "ball-1");
  return `${f.frameIndex}:${ball?.positionMeters?.z ?? "-"}:${ball?.positionProvenance ?? "obs"}`;
}));
// Sanity: stateAt + projectScene reproduces each step's scoreClock.
const reprojected = projectScene(stateAt(engine, 5_000).snapshot);
console.log(
  "layer1 scoreClock deep-equal @5000:",
  JSON.stringify(reprojected.scoreClock) === JSON.stringify(steps[4]!.scene.scoreClock),
);

// --- Directed chain (W604): commentary → W209 candidates → plan → composed render.
import { extractEventCandidates } from "@sporta/commentary-understanding";
import { DEFAULT_DIRECTOR_POLICY, direct, render3dDirectedMatch } from "@sporta/camera-director";

const COMMENTARY_UNITS = [
  {
    unitId: "cu-1",
    startMs: 1_400,
    endMs: 1_800,
    text: "He shoots from the edge of the box.",
    sourceWindowIds: ["tu-1"],
  },
  {
    unitId: "cu-2",
    startMs: 4_300,
    endMs: 4_900,
    text: "GOAL!!! What a strike from Dalvio!",
    speakerLabel: "main",
    sourceWindowIds: ["tu-2"],
  },
  {
    unitId: "cu-3",
    startMs: 6_100,
    endMs: 6_600,
    text: "A rash tackle and the referee reaches for a card.",
    sourceWindowIds: ["tu-3"],
  },
];

const candidates = extractEventCandidates({
  units: COMMENTARY_UNITS,
  lexicon: { players: ["Dalvio"], teams: [] },
});
console.log("\ncandidates:", candidates.map((c) => [c.candidateId, c.eventType, c.eventTimeMs, c.confidence]));
const plan = direct(DEFAULT_DIRECTOR_POLICY, steps, candidates);
console.log("plan windows:", plan.windows.map((w) => `${w.index}:${w.kind}[${w.source.startMs},${w.source.endMs}]@${w.cameraSlotId}(${w.decision.ruleId})`));
console.log("plan accounting:", plan.summary.eventAccounting.map((e) => [e.candidateId, e.outcome]));
const directed = render3dDirectedMatch(request, steps, plan);
console.log("directed frames:", directed.manifest.frames.length, "windows:", directed.manifest.windows.length);
console.log("directed windows:", directed.manifest.windows.map((w) => `${w.index}:${w.kind}[${w.source.startMs},${w.source.endMs}]→[${w.output.startMs},${w.output.endMs}]@${w.cameraSlotId} n=${w.frameCount}`));
console.log("directed frame0:", directed.manifest.frames[0]!.frameIndex, directed.manifest.frames[0]!.outputTimestampMs, directed.manifest.frames[0]!.sourceTimestampMs, directed.manifest.frames[0]!.entry.hud.statusLine);
console.log("review frame sample:", directed.manifest.frames.find((f) => f.presentation === "review")?.sourceTimestampMs);
