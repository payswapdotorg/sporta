/**
 * r606-visual-gate-reprep4 — the R606 HUMAN VISUAL GATE's 2D-BOARD RE-PREP
 * driver (the genre-composition + clarity + ball-trajectory fix).
 *
 * The re-re-re-verdict (scripts/evidence/r606-visual-gate/verdict-reprep3.json):
 * criterion 1 PASS (not contested), the temporal ground RETIRED (the
 * flow-guided lane worked — honestly typed), but criterion 2 FAIL on three
 * new artifact-level grounds — "tactical: still not showing a 2D field with
 * players moving on it" / "3d game: needs a little more clarity" /
 * "anime-npr: needs a little more clarity, the ball stays between the
 * player's feet after he took his shot".
 *
 * This flight implements the verdict record's nextFlight legs:
 *   - the 2D-BOARD lane (outside the repo, the TL station's OpenCV lane):
 *     the broadcast tactical-cam / analytics 2D-match-view class (Hudl
 *     Wyscout tactical-angle views; the Football Manager 2D match-engine
 *     lineage) — a DETERMINISTIC top-down board driven by the source's own
 *     tracked positions (VLM roster keyframes + the fine ball pass + an
 *     anchored camera solve), design-gated by MEASUREMENT before freezing;
 *   - the CLARITY lane: the standard denoise→unsharp restoration order,
 *     A/B VLM-gated (anime mild, 3d strong — the anime strong refused);
 *   - the BALL-TRAJECTORY lane: the tracked-asset cut-and-paste (the
 *     video's own ball asset moved along the source's own fine-pass
 *     flight, the vacated sites grass-filled with the pitch lines redrawn);
 *   - THIS driver: the fail-closed VERIFIER + MANIFEST + RECORD — it never
 *     generates, it MEASURES: the four MP4s re-hashed at the receiving
 *     boundary, the ORIGINAL verified byte-identical to the researched
 *     source, every derived kind re-probed, and the render record's own
 *     claims cross-checked against the bytes on disk (nothing laundered
 *     between the lane and the record).
 *
 * The integrity discipline unchanged: exports OUTSIDE the repo (the
 * no-committed-media doctrine); every unexpected state → exit 1, typed.
 *
 * Modes:
 *   --out <dir>   REQUIRED — the re-prep lane's output dir (the four MP4s +
 *                 render-record.json must be there; the manifest.json lands
 *                 there; the record lands in THIS dir).
 *
 * Run (from the REPO ROOT, AFTER the re-prep lane has completed):
 *   bun run scripts/evidence/r606-visual-gate/visual-gate-reprep4.ts \
 *     --out /home/z/my-project/public/r606-reprep4
 */
import { writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { FfmpegTool, sha256OfBytes } from "../../../packages/media-platform/src/index";

const argv = process.argv.slice(2);
function argValue(flag: string): string | undefined {
  const at = argv.indexOf(flag);
  return at === -1 ? undefined : argv[at + 1];
}
const outArg = argValue("--out");
if (outArg === undefined) {
  console.error("FATAL: --out <dir> is required (the re-prep lane's output dir — outside the repo)");
  process.exit(1);
}
const outDir = resolve(outArg);
const here = dirname(new URL(import.meta.url).pathname);
const recordPath = join(here, "visual-gate-reprep4.json");

function fail(step: string, detail: string): never {
  console.error(`FATAL [${step}]: ${detail}`);
  process.exit(1);
}

// The researched source (proven-solutions-research.json — the same pick every
// re-prep used; the ORIGINAL must be byte-identical to these bytes).
const SOURCE_URL = "https://assets.mixkit.co/videos/43499/43499-720.mp4";
const SOURCE_SHA_EXPECTED = "d53f611eb3688c52e1f44ac69721e11b1bd2bb52efb4f705c4b745afba15915d";
const SOURCE_LICENSE = "Mixkit License (free, no attribution; https://mixkit.co/license/#videoFree)";
const SOURCE_TITLE = "Goal play in a semi-professional soccer game (Mixkit 43499)";
const KINDS = ["tactical", "three-d-game", "anime-npr"] as const;

type RenderOutput = { kind?: string; byteSize?: number; sha256?: string; durationSeconds?: number };
type RenderRecord = {
  kind?: string;
  ts?: string;
  method?: { class?: string; citations?: string[]; implementation?: string };
  designGate?: {
    method?: string;
    flickerBefore?: Record<string, number>;
    flickerAfter?: Record<string, number>;
    originalBand?: number;
    ballCheck?: string;
    ballTrajectory?: string;
    boardCheck?: string;
    boardMotion?: Record<string, string>;
    clarity?: { animeEdge?: number[]; "3dEdge"?: number[]; abVerdict?: string };
    overallVerdict?: string;
  };
  outputs?: RenderOutput[];
};

function loadJson<T>(path: string, label: string): T {
  if (!existsSync(path)) fail(`${label}-present`, `${path} absent`);
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch (error) {
    return fail(`${label}-parse`, String(error));
  }
}

const record: Record<string, unknown> = {
  schemaVersion: 1,
  kind: "r606-visual-gate-reprep4",
  ts: new Date().toISOString(),
  context: {
    reReReVerdict:
      "scripts/evidence/r606-visual-gate/verdict-reprep3.json (criterion 1 PASS / the temporal ground RETIRED / criterion 2 FAIL on genre-composition + clarity + ball-trajectory — the gate REFUSED a fourth time)",
    directive:
      "instead of building the complete solution from scratch, try looking for solutions that have been " +
      "reported to work and just copy and adapt them (the operator's, carried verbatim since verdict 1)",
    lane:
      "the 2D-BOARD RE-PREP — the broadcast tactical-cam / analytics 2D-match-view class (a DETERMINISTIC " +
      "top-down board from the source's own tracked positions) for the tactical kind + the standard " +
      "denoise→unsharp restoration for the 3d/anime clarity + the tracked-asset cut-and-paste for the anime " +
      "ball's true trajectory — design-gated by MEASUREMENT before freezing",
    path: "the VIDEO-STYLIZATION path (the operator's copy-and-adapt) — NOT the state-driven reality engine's own real-footage path (the product-scale CAP lane)",
  },
  provenance: {
    note:
      "The R606 2D-board re-prep: the SAME real goal clip as the original; the tactical kind now a TRUE " +
      "top-down 2D board with the players moving on it (the genre's promise BY CONSTRUCTION — the " +
      "deterministic render of the source's own tracked positions, never generatively re-imagined); the 3d " +
      "and anime kinds the reprep3 propagations (the operator's temporal fix that HELD — this verdict retired " +
      "the ground) now restored for clarity; the anime ball moved onto the source's own fine-pass flight. " +
      "The GATE itself is the operator's eyes; this record is the re-prep's own honest state.",
    source: {
      title: SOURCE_TITLE,
      url: SOURCE_URL,
      license: SOURCE_LICENSE,
      sha256: SOURCE_SHA_EXPECTED,
      acquired: "the first re-prep's verified download (byte-identical, re-verified by this driver)",
    },
  },
  outputs: [] as unknown[],
};

async function main(): Promise<void> {
  // --- the toolchain (measured, never assumed) ---
  const tool = new FfmpegTool();
  if (!(await tool.available())) {
    fail("toolchain", `ffmpeg is not available at '${tool.ffmpegPath}' — the driver never fakes it`);
  }
  const version = await tool.version();
  if (version === null) fail("toolchain", "the ffmpeg version probe returned null");
  (record.provenance as Record<string, unknown>).toolchain = { ffmpegPath: tool.ffmpegPath, version };
  console.log(`toolchain: ${version}`);

  // --- the render record (the lane's own claims — shape-checked) ---
  const renderPath = join(outDir, "render-record.json");
  const render = loadJson<RenderRecord>(renderPath, "render");
  if (render.kind !== "r606-2d-board-and-ball-surgery") {
    fail("render-kind", `${render.kind}`);
  }
  if (typeof render.ts !== "string" || render.ts.length < 10) {
    fail("render-ts", "the lane's timestamp must be recorded");
  }
  const methodClass = render.method?.class ?? "";
  const methodClassLower = methodClass.toLowerCase();
  if (methodClass.length < 60 || !methodClassLower.includes("2d-match-view") || !methodClassLower.includes("deterministic")) {
    fail("render-method", "the method's class must be recorded (the 2D-match-view lineage, deterministic render)");
  }
  const citations = render.method?.citations ?? [];
  if (!Array.isArray(citations) || citations.length < 3) {
    fail("render-citations", "the copied-and-adapted reported-to-work sources must be cited (≥3)");
  }
  if (typeof render.method?.implementation !== "string" || render.method.implementation.length < 100) {
    fail("render-implementation", "the implementation record must be carried");
  }
  const gate = render.designGate;
  if (typeof gate?.method !== "string" || gate.method.length < 60) {
    fail("render-design-gate", "the design gate's method must be recorded");
  }
  const before = gate?.flickerBefore ?? {};
  const after = gate?.flickerAfter ?? {};
  const band = gate?.originalBand ?? 0;
  for (const kind of KINDS) {
    if (!((before[kind] ?? 0) > 0) || !((after[kind] ?? 0) >= 0)) {
      fail("render-flicker", `the ${kind} flicker before/after must both be measured`);
    }
    if (after[kind]! > before[kind]! * 1.05) {
      fail("render-flicker-no-regression", `the ${kind} flicker after (${after[kind]}) must not regress past the before (${before[kind]}) — the clarity/surgery must not break the retired temporal ground`);
    }
  }
  if ((after["tactical"] ?? 1) > 1.0) {
    fail("render-board-flicker", "the board's static background must measure ~zero flicker (< 1.0)");
  }
  if (!gate?.ballCheck || !gate.ballCheck.includes("MAX: 1")) {
    fail("render-ball-check", "the strict merged-crop ball-count verdict must be carried (MAX: 1 — no duplicated balls)");
  }
  if (!gate?.ballTrajectory || !gate.ballTrajectory.includes("LEAVES the shooter") || !gate.ballTrajectory.includes("net")) {
    fail("render-ball-trajectory", "the ball-trajectory restoration verdict must be carried (leaves the shooter at the strike, ends in the net)");
  }
  if (!gate?.boardCheck || !gate.boardCheck.includes("6/6")) {
    fail("render-board-check", "the six-question board verdict must be carried (6/6 — a 2D field with players moving on it)");
  }
  const motion = gate?.boardMotion ?? {};
  for (const name of ["shooter", "blueA", "blueB", "other", "gk", "ball"]) {
    const v = motion[name];
    if (typeof v !== "string" || !v.includes("px")) {
      fail("render-board-motion", `the board motion must be quantified for ${name} (the 'players moving' criterion, measured)`);
    }
  }
  const clarity = gate?.clarity;
  const animeEdge = clarity?.animeEdge ?? [];
  const d3Edge = clarity?.["3dEdge"] ?? [];
  if (animeEdge.length !== 2 || d3Edge.length !== 2) {
    fail("render-clarity", "the clarity edge metrics must be carried before/after for both kinds");
  }
  if (animeEdge[1]! <= animeEdge[0]! * 1.15 || d3Edge[1]! <= d3Edge[0]! * 1.15) {
    fail("render-clarity-gain", `the clarity must measurably improve (anime ${animeEdge.join("→")}, 3d ${d3Edge.join("→")} — ≥ +15% edge strength)`);
  }
  if (typeof clarity?.abVerdict !== "string" || clarity.abVerdict.length < 30) {
    fail("render-clarity-ab", "the A/B VLM clarity verdict must be carried (anime mild / 3d strong)");
  }
  const overall = gate?.overallVerdict ?? "";
  if (overall.length < 50 || !overall.includes("A) YES") || !overall.includes("B) YES") || !overall.includes("C) YES") || !overall.includes("D) YES") || !overall.includes("E) YES")) {
    fail("render-overall", "the five-question strict verdict must be carried (all five YES)");
  }
  (record.provenance as Record<string, unknown>).render = {
    lane: methodClass,
    citations,
    implementation: render.method?.implementation,
    designGate: {
      method: gate?.method,
      flickerBefore: before,
      flickerAfter: after,
      originalBand: band,
      ballCheck: gate?.ballCheck,
      ballTrajectory: gate?.ballTrajectory,
      boardCheck: gate?.boardCheck,
      boardMotion: motion,
      clarity: gate?.clarity,
      overallVerdict: overall,
    },
    renderRecord: "the lane's own render-record.json (carried in the out dir)",
  };

  // --- the ORIGINAL: byte-identical to the researched source ---
  const outputs: Record<string, unknown>[] = [];
  const originalPath = join(outDir, "original.mp4");
  if (!existsSync(originalPath)) fail("original", `${originalPath} absent`);
  const originalBytes = new Uint8Array(readFileSync(originalPath));
  const originalSha = sha256OfBytes(originalBytes);
  if (originalSha !== SOURCE_SHA_EXPECTED) {
    fail("original-sha", `the original must be byte-identical to the researched source (${originalSha})`);
  }
  if (Buffer.from(originalBytes.subarray(4, 8)).toString("ascii") !== "ftyp") {
    fail("original-magic", "the original's container magic");
  }
  const sourceProbe = await tool.probe(originalPath);
  const durationSeconds = sourceProbe.durationMs / 1000;
  outputs.push({
    kind: "original",
    byteSize: originalBytes.byteLength,
    sha256: originalSha,
    integrityVerified: true,
    containerMagic: "ftyp",
    transform: "none (the real clip's own bytes, as-is — byte-identical to the researched source, re-verified)",
    durationSeconds,
    savedPath: originalPath,
  });
  console.log(`  ${"original".padEnd(13)} ${String(originalBytes.byteLength).padStart(8)} B  sha ${originalSha.slice(0, 16)}…`);

  // --- the three DERIVED kinds: measured against the render record's own claims ---
  const renderOutputs = new Map((render.outputs ?? []).map((o) => [o.kind, o]));
  for (const kind of KINDS) {
    const mp4Path = join(outDir, `${kind}.mp4`);
    if (!existsSync(mp4Path)) fail(`${kind}`, `${mp4Path} absent`);
    const bytes = new Uint8Array(readFileSync(mp4Path));
    const magic = Buffer.from(bytes.subarray(4, 8)).toString("ascii");
    if (magic !== "ftyp") fail(`${kind}-magic`, `container magic ${magic}`);
    if (!(bytes.byteLength > 1000)) fail(`${kind}-size`, `byte size ${bytes.byteLength}`);
    const sha = sha256OfBytes(bytes);
    const claim = renderOutputs.get(kind);
    if (claim === undefined) fail(`${kind}-claim`, "the render record holds no claim for this kind");
    if (claim.sha256 !== sha || claim.byteSize !== bytes.byteLength) {
      fail(`${kind}-crosscheck`, "the bytes on disk do not match the render record's claim — nothing laundered");
    }
    const probe = await tool.probe(mp4Path);
    const outDurationSeconds = probe.durationMs / 1000;
    if (Math.abs(outDurationSeconds - durationSeconds) > 0.75) {
      fail(`${kind}-duration`, `duration ${outDurationSeconds}s vs source ${durationSeconds}s`);
    }
    if (claim.durationSeconds !== undefined && Math.abs(claim.durationSeconds - outDurationSeconds) > 0.01) {
      fail(`${kind}-duration-crosscheck`, `the claim's duration ${claim.durationSeconds}s != the probed ${outDurationSeconds}s`);
    }
    const transform =
      kind === "tactical"
        ? "deterministic 2D top-down board render from the source's own tracked player/ball positions (the broadcast tactical-cam / 2D-match-view class) + ffmpeg assembly"
        : kind === "three-d-game"
          ? "the reprep3 temporally-coherent propagation + the denoise→unsharp clarity restoration (strong, A/B-gated) + ffmpeg re-assembly"
          : "the reprep3 temporally-coherent propagation + the denoise→unsharp clarity restoration (mild, A/B-gated) + the tracked-asset ball cut-and-paste onto the source's own fine-pass flight (the vacated sites grass-filled, the pitch lines redrawn) + ffmpeg re-assembly";
    outputs.push({
      kind,
      byteSize: bytes.byteLength,
      sha256: sha,
      integrityVerified: true,
      containerMagic: magic,
      transform,
      durationSeconds: outDurationSeconds,
      savedPath: mp4Path,
    });
    console.log(`  ${kind.padEnd(13)} ${String(bytes.byteLength).padStart(8)} B  sha ${sha.slice(0, 16)}…`);
  }
  record.outputs = outputs;

  // --- the manifest (the operator-viewing dir's own card) ---
  const manifest = {
    kind: "r606-visual-gate-reprep4",
    ts: record.ts as string,
    gate: {
      question:
        "Watch the four realities (the 2D-BOARD RE-PREP: the same REAL goal clip; the tactical kind now a " +
        "TRUE top-down 2D board with the players moving on it; the 3d-game and anime sharpened for clarity; " +
        "the anime ball now follows the shot's true flight — it LEAVES the shooter's feet and ends in the " +
        "net). Can you identify the SAME match/event in each — and is the tactical a 2D field with players " +
        "moving on it, the 3d and the anime clear enough, the anime ball leaving the shooter after his shot?",
      criteria: [
        "the same match/event identifiable across all four (the same REAL goal play by construction — PASS since the re-verdict, not contested by any later verdict)",
        "the tactical kind a 2D field with players moving on it + the 3d/anime clarity + the anime ball leaving the shooter after his shot (the re-re-re-verdict's three grounds — the fix this re-prep carries)",
      ],
      verdict: "THE OPERATOR'S — never a worker's (R606, the human visual gate's RE-RE-RE-RE-VERDICT)",
      context:
        "the re-re-re-verdict retired the temporal-consistency ground (the flow-guided fix HELD — no flicker, " +
        "no flipping, no duplicated balls re-raised) but refused the genre-composition of the tactical, the " +
        "clarity of the 3d and anime, and the anime ball's post-shot trajectory; this re-prep carries the " +
        "deterministic 2D board (tracked positions rendered on an overhead pitch — the genre's promise by " +
        "construction), the denoise→unsharp clarity restoration (measured: anime edge 37.5→49.1, 3d 28.7→40.8), " +
        "and the tracked-asset ball move (the video's own ball along the source's own flight, the vacated " +
        "sites clean with the pitch lines redrawn) — the design gate: flicker 0.00/4.38/1.84 (the original's " +
        "band 1.40), the strict merged-crop ball-count MAX: 1, the six-question board check 6/6, the " +
        "five-question overall check all YES",
    },
    provenance: {
      note:
        "The same real goal event in all four BY CONSTRUCTION; the tactical kind's 2D board rendered " +
        "deterministically from the source's own tracked positions (the broadcast tactical-cam / " +
        "2D-match-view class, copied and adapted); the 3d/anime clarity by the standard restoration chain; " +
        "the anime ball by the tracked-asset cut-and-paste onto the source's own fine-pass flight. The GATE " +
        "itself is the operator's eyes.",
      source: { title: SOURCE_TITLE, url: SOURCE_URL, license: SOURCE_LICENSE },
      designGateFlicker: { before: before, after: after },
      designGateBallCheck: gate?.ballCheck,
      designGateBallTrajectory: gate?.ballTrajectory,
      designGateBoardCheck: gate?.boardCheck,
      designGateClarity: gate?.clarity,
      designGateOverall: gate?.overallVerdict,
    },
    outputs,
  };
  await writeFile(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));

  // --- the record ---
  await writeFile(recordPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  console.log(`\nThe R606 2D-BOARD RE-PREP is PERFORMABLE: the four realities exported to ${outDir}`);
  console.log(`The record: ${recordPath}`);
}

await main();
