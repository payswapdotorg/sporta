/**
 * r606-visual-gate-reprep3 — the R606 HUMAN VISUAL GATE's TEMPORALLY-COHERENT
 * RE-PREP driver (the temporal-consistency fix).
 *
 * The re-re-verdict (scripts/evidence/r606-visual-gate/verdict-reprep2.json):
 * criterion 1 PASS (not contested) but criterion 2 FAIL on TEMPORAL
 * CONSISTENCY — "the anime-npr is good but it's showing the ball multiple
 * times from the 7th second, also the pitch keeps flashing/blinking / the
 * tactical is not really tactical (it keeps flipping between tactical and
 * something else) / the pitch keeps flashing in most videos except for the
 * original" — the per-frame independence of the generative lane had no
 * temporal-coherence mechanism (the MEASURED diagnosis: the tactical
 * flicker 34.03 vs the original's 1.41 luminance-jump units).
 *
 * This flight implements the verdict record's nextFlight legs:
 *   - the TEMPORAL-COHERENT propagation lane (outside the repo, the TL
 *     station's OpenCV lane): the reported-to-work flow-guided class
 *     (Fast Coherent Video Style Transfer via Flow Errors Reduction /
 *     Coherent Online Video Style Transfer / the Lai et al.
 *     blind-temporal-consistency class) + keyframe-anchored propagation (the
 *     EbSynth class) + per-kind Lab color harmonization — the SOURCE clip's
 *     own optical flow transports the anchor styled frames, the blend weight
 *     driven by the SOURCE-space warp error (occlusion admits the fresh
 *     styled frame; faithful warps suppress fresh-frame hallucinations),
 *     the design gate MEASURED before freezing (the flicker before/after +
 *     the strict VLM ball-count + the tactical-consistency + the
 *     five-question overall check);
 *   - THIS driver: the fail-closed VERIFIER + MANIFEST + RECORD — it never
 *     generates, it MEASURES: the four MP4s re-hashed at the receiving
 *     boundary (sha-256 + the ftyp container magic + the byte-length claim),
 *     the ORIGINAL verified byte-identical to the researched source, every
 *     derived kind re-probed (duration within 0.75 s of the source), and
 *     the propagation record's own claims cross-checked against the bytes
 *     on disk (nothing laundered between the lane and the record).
 *
 * The integrity discipline unchanged: exports OUTSIDE the repo (the
 * no-committed-media doctrine); every unexpected state → exit 1, typed.
 *
 * Modes:
 *   --out <dir>   REQUIRED — the propagation lane's output dir (the four
 *                 MP4s + propagation.json must be there; the manifest.json
 *                 lands there; the record lands in THIS dir).
 *
 * Run (from the REPO ROOT, AFTER the propagation lane has completed):
 *   bun run scripts/evidence/r606-visual-gate/visual-gate-reprep3.ts \
 *     --out /home/z/my-project/public/r606-reprep3
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
  console.error("FATAL: --out <dir> is required (the propagation lane's output dir — outside the repo)");
  process.exit(1);
}
const outDir = resolve(outArg);
const here = dirname(new URL(import.meta.url).pathname);
const recordPath = join(here, "visual-gate-reprep3.json");

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

type PropagationOutput = { kind?: string; byteSize?: number; sha256?: string; durationSeconds?: number };
type PropagationRecord = {
  kind?: string;
  ts?: string;
  method?: { class?: string; citations?: string[]; implementation?: string };
  designGate?: {
    method?: string;
    flickerBefore?: Record<string, number>;
    flickerAfter?: Record<string, number>;
    ballCheck?: string;
    tacticalConsistency?: string;
    overallVerdict?: string;
  };
  outputs?: PropagationOutput[];
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
  kind: "r606-visual-gate-reprep3",
  ts: new Date().toISOString(),
  context: {
    reReVerdict:
      "scripts/evidence/r606-visual-gate/verdict-reprep2.json (criterion 1 PASS / criterion 2 FAIL on temporal consistency — the gate REFUSED a third time)",
    directive:
      "instead of building the complete solution from scratch, try looking for solutions that have been " +
      "reported to work and just copy and adapt them (the operator's, carried verbatim since verdict 1)",
    lane:
      "the TEMPORAL-COHERENT propagation lane — the reported-to-work flow-guided class + keyframe-anchored " +
      "propagation (EbSynth) + per-kind Lab color harmonization, adapted locally with OpenCV DIS flow, " +
      "design-gated by MEASUREMENT before freezing (flicker metric + VLM checks)",
    path: "the VIDEO-STYLIZATION path (the operator's copy-and-adapt) — NOT the state-driven reality engine's own real-footage path (the product-scale CAP lane)",
  },
  provenance: {
    note:
      "The R606 temporally-coherent re-prep: the SAME real goal clip as the original + the three derived " +
      "kinds as flow-guided propagations of the re-re-verdict's own generative outputs (the per-frame style " +
      "the operator APPROVED — 'the anime-npr is good' — now transported coherently along the source's own " +
      "motion). The same-event identity holds BY CONSTRUCTION (the real clip), the style fidelity by the " +
      "inherited approved frames, the temporal coherence by the measured design gate. The GATE itself is " +
      "the operator's eyes; this record is the re-prep's own honest state.",
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

  // --- the propagation record (the lane's own claims — shape-checked) ---
  const propagationPath = join(outDir, "propagation.json");
  const propagation = loadJson<PropagationRecord>(propagationPath, "propagation");
  if (propagation.kind !== "r606-temporal-coherence-propagation") {
    fail("propagation-kind", `${propagation.kind}`);
  }
  if (typeof propagation.ts !== "string" || propagation.ts.length < 10) {
    fail("propagation-ts", "the lane's timestamp must be recorded");
  }
  const methodClass = propagation.method?.class ?? "";
  if (methodClass.length < 60 || !methodClass.includes("flow-guided")) {
    fail("propagation-method", "the method's class must be recorded (the flow-guided lineage)");
  }
  const citations = propagation.method?.citations ?? [];
  if (!Array.isArray(citations) || citations.length < 3) {
    fail("propagation-citations", "the copied-and-adapted reported-to-work sources must be cited (≥3)");
  }
  if (typeof propagation.method?.implementation !== "string" || propagation.method.implementation.length < 100) {
    fail("propagation-implementation", "the implementation record must be carried");
  }
  const gate = propagation.designGate;
  if (typeof gate?.method !== "string" || gate.method.length < 60) {
    fail("propagation-design-gate", "the design gate's method must be recorded");
  }
  const before = gate?.flickerBefore ?? {};
  const after = gate?.flickerAfter ?? {};
  for (const kind of ["tactical", "three-d-game", "anime-npr"]) {
    if (!((before[kind] ?? 0) > 0) || !((after[kind] ?? 0) >= 0)) {
      fail("propagation-flicker", `the ${kind} flicker before/after must both be measured`);
    }
    if (after[kind]! > before[kind]! / 2) {
      fail("propagation-flicker-improved", `the ${kind} flicker after (${after[kind]}) must be less than HALF the before (${before[kind]}) — the fix's own measured bar`);
    }
  }
  if (!gate?.ballCheck || !gate.ballCheck.includes("MAX: 1")) {
    fail("propagation-ball-check", "the strict VLM ball-count verdict must be carried (MAX: 1 — no duplicated balls)");
  }
  if (!gate?.tacticalConsistency || !gate.tacticalConsistency.includes("CONSISTENT: yes")) {
    fail("propagation-tactical-consistency", "the tactical style-consistency verdict must be carried (CONSISTENT: yes)");
  }
  const overall = gate?.overallVerdict ?? "";
  if (overall.length < 50 || !overall.includes("A) YES") || !overall.includes("B) YES") || !overall.includes("C) YES") || !overall.includes("D) YES") || !overall.includes("E) YES")) {
    fail("propagation-overall", "the five-question strict verdict must be carried (all five YES)");
  }
  (record.provenance as Record<string, unknown>).propagation = {
    lane: methodClass,
    citations,
    implementation: propagation.method?.implementation,
    designGate: { method: gate?.method, flickerBefore: before, flickerAfter: after, ballCheck: gate?.ballCheck, tacticalConsistency: gate?.tacticalConsistency, overallVerdict: overall },
    propagationRecord: "the lane's own propagation.json (carried in the out dir)",
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

  // --- the three DERIVED kinds: measured against the propagation record's own claims ---
  const propagationOutputs = new Map((propagation.outputs ?? []).map((o) => [o.kind, o]));
  for (const kind of KINDS) {
    const mp4Path = join(outDir, `${kind}.mp4`);
    if (!existsSync(mp4Path)) fail(`${kind}`, `${mp4Path} absent`);
    const bytes = new Uint8Array(readFileSync(mp4Path));
    const magic = Buffer.from(bytes.subarray(4, 8)).toString("ascii");
    if (magic !== "ftyp") fail(`${kind}-magic`, `container magic ${magic}`);
    if (!(bytes.byteLength > 1000)) fail(`${kind}-size`, `byte size ${bytes.byteLength}`);
    const sha = sha256OfBytes(bytes);
    const claim = propagationOutputs.get(kind);
    if (claim === undefined) fail(`${kind}-claim`, "the propagation record holds no claim for this kind");
    if (claim.sha256 !== sha || claim.byteSize !== bytes.byteLength) {
      fail(`${kind}-crosscheck`, "the bytes on disk do not match the propagation record's claim — nothing laundered");
    }
    const probe = await tool.probe(mp4Path);
    const outDurationSeconds = probe.durationMs / 1000;
    if (Math.abs(outDurationSeconds - durationSeconds) > 0.75) {
      fail(`${kind}-duration`, `duration ${outDurationSeconds}s vs source ${durationSeconds}s`);
    }
    if (claim.durationSeconds !== undefined && Math.abs(claim.durationSeconds - outDurationSeconds) > 0.01) {
      fail(`${kind}-duration-crosscheck`, `the claim's duration ${claim.durationSeconds}s != the probed ${outDurationSeconds}s`);
    }
    outputs.push({
      kind,
      byteSize: bytes.byteLength,
      sha256: sha,
      integrityVerified: true,
      containerMagic: magic,
      transform:
        "temporally-coherent propagation of the re-re-verdict's generative outputs (nearest-anchor flow warp + source-space-error-driven blending + Lab color harmonization) + ffmpeg assembly",
      durationSeconds: outDurationSeconds,
      savedPath: mp4Path,
    });
    console.log(`  ${kind.padEnd(13)} ${String(bytes.byteLength).padStart(8)} B  sha ${sha.slice(0, 16)}…`);
  }
  record.outputs = outputs;

  // --- the manifest (the operator-viewing dir's own card) ---
  const manifest = {
    kind: "r606-visual-gate-reprep3",
    ts: record.ts as string,
    gate: {
      question:
        "Watch the four realities (the TEMPORALLY-COHERENT RE-PREP: the same REAL goal clip, the three " +
        "derived kinds now flow-guided propagations of the approved generative styles). Can you identify " +
        "the SAME match/event in each, and are the styles ACTUALLY their genres AND temporally coherent — " +
        "real anime with ONE ball, a tactical view that never flips, no pitch flashing?",
      criteria: [
        "the same match/event identifiable across all four (the same REAL goal play by construction — PASS since the re-verdict, not contested by the re-re-verdict)",
        "the styles actual to their genres AND temporally coherent (the re-re-verdict's refusal ground: the ball duplicating from the 7th second, the tactical flipping, the pitch flashing — the fix this re-prep carries)",
      ],
      verdict: "THE OPERATOR'S — never a worker's (R606, the human visual gate's RE-RE-RE-VERDICT)",
      context:
        "the re-re-verdict approved the anime's static style but refused the videos' TEMPORAL CONSISTENCY " +
        "(the measured flicker: tactical 34.03 vs the original's 1.41 luminance-jump units); this re-prep " +
        "propagates those approved styles coherently — the source's own optical flow transports them, the " +
        "measured design gate: flicker after 4.75/4.30/2.01, the strict ball-count MAX: 1 across the " +
        "reported window, the tactical CONSISTENT, the five-question overall check all YES",
    },
    provenance: {
      note:
        "The same real goal event in all four BY CONSTRUCTION; the style fidelity inherited from the " +
        "re-re-verdict's own approved generative frames; the temporal coherence by the flow-guided " +
        "propagation (the reported-to-work class, copied and adapted) with the design gate's measured " +
        "verdicts. The GATE itself is the operator's eyes.",
      source: { title: SOURCE_TITLE, url: SOURCE_URL, license: SOURCE_LICENSE },
      designGateFlicker: { before: before, after: after },
      designGateBallCheck: gate?.ballCheck,
      designGateTacticalConsistency: gate?.tacticalConsistency,
      designGateOverall: gate?.overallVerdict,
    },
    outputs,
  };
  await writeFile(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));

  // --- the record ---
  await writeFile(recordPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  console.log(`\nThe R606 TEMPORALLY-COHERENT RE-PREP is PERFORMABLE: the four realities exported to ${outDir}`);
  console.log(`The record: ${recordPath}`);
}

await main();
