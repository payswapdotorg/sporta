/**
 * r606-visual-gate-reprep2 — the R606 HUMAN VISUAL GATE's GENERATIVE RE-PREP
 * driver (the style-fidelity fix).
 *
 * The re-verdict (scripts/evidence/r606-visual-gate/verdict-reprep.json):
 * criterion 1 PASS ("I can identify the same match" — the real-clip event
 * carrier worked) but criterion 2 FAIL on STYLE FIDELITY ("the anime style
 * for instance is not actual anime, same for the tactical and 3d styles") —
 * the frozen ffmpeg chains were COLOR GRADING, not genre restyling.
 *
 * This flight implements the verdict record's nextFlight legs:
 *   - the GENERATIVE lane (outside the repo, the TL station's z-ai image-edit
 *     lane — the platform's documented image-edit capability, backend-only):
 *     the design gate FIRST (one keyframe per genre → the STRICT VLM genre
 *     check — all four questions YES, the verdict carried in the generation
 *     record), then EVERY sampled frame of the SAME real goal clip (Mixkit
 *     43499, the verified bytes) restyled with the FROZEN genre prompts, in
 *     per-call isolated child processes (the SDK's orphan-rejection quirk
 *     typed in the lane's own header), reassembled with real ffmpeg;
 *   - THIS driver: the fail-closed VERIFIER + MANIFEST + RECORD — it never
 *     generates, it MEASURES: the four MP4s re-hashed at the receiving
 *     boundary (sha-256 + the ftyp container magic + the byte-length claim),
 *     the ORIGINAL verified byte-identical to the researched source, every
 *     derived kind re-probed (duration within 0.75 s of the source), and the
 *     generation record's own claims cross-checked against the bytes on disk
 *     (nothing laundered between the generation lane and the record).
 *
 * The integrity discipline unchanged: exports OUTSIDE the repo (the
 * no-committed-media doctrine); every unexpected state → exit 1, typed.
 *
 * Modes:
 *   --out <dir>   REQUIRED — the generative lane's output dir (the four MP4s
 *                 + generation.json must be there; the manifest.json lands
 *                 there; the record lands in THIS dir).
 *
 * Run (from the REPO ROOT, AFTER the generation lane has completed):
 *   bun run scripts/evidence/r606-visual-gate/visual-gate-reprep2.ts \
 *     --out /home/z/my-project/public/r606-reprep2
 */
import { writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { FfmpegTool, sha256OfBytes } from "../../../packages/media-platform/src/index";

const argv = process.argv.slice(2);
function argValue(flag: string): string | undefined {
  const at = argv.indexOf(flag);
  return at === -1 ? undefined : argv[at + 1];
}
const outArg = argValue("--out");
if (outArg === undefined) {
  console.error("FATAL: --out <dir> is required (the generative lane's output dir — outside the repo)");
  process.exit(1);
}
const outDir = resolve(outArg);
const here = dirname(new URL(import.meta.url).pathname);
const recordPath = join(here, "visual-gate-reprep2.json");

function fail(step: string, detail: string): never {
  console.error(`FATAL [${step}]: ${detail}`);
  process.exit(1);
}

// The researched source (proven-solutions-research.json — the same pick the
// first re-prep used; the ORIGINAL must be byte-identical to these bytes).
const SOURCE_URL = "https://assets.mixkit.co/videos/43499/43499-720.mp4";
const SOURCE_SHA_EXPECTED = "d53f611eb3688c52e1f44ac69721e11b1bd2bb52efb4f705c4b745afba15915d";
const SOURCE_LICENSE = "Mixkit License (free, no attribution; https://mixkit.co/license/#videoFree)";
const SOURCE_TITLE = "Goal play in a semi-professional soccer game (Mixkit 43499)";
const KINDS = ["tactical", "three-d-game", "anime-npr"] as const;

type GenerationRecord = {
  kind?: string;
  ts?: string;
  lane?: string;
  source?: { sha256?: string; url?: string };
  designGate?: { method?: string; verdict?: string };
  prompts?: { frozen?: Record<string, string> };
  sampling?: { fps?: number; sourceFrames?: number; editSize?: string; assembledSize?: string };
  outputs?: { kind?: string; byteSize?: number; frameCount?: number; sha256?: string }[];
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
  kind: "r606-visual-gate-reprep2",
  ts: new Date().toISOString(),
  context: {
    reVerdict: "scripts/evidence/r606-visual-gate/verdict-reprep.json (criterion 1 PASS / criterion 2 FAIL on style fidelity — the gate REFUSED again)",
    directive:
      "instead of building the complete solution from scratch, try looking for solutions that " +
      "have been reported to work and just copy and adapt them (the operator's, carried verbatim since verdict 1)",
    lane:
      "the GENERATIVE restyling lane — the platform's documented image-edit capability (z-ai, " +
      "backend-only) in per-call isolated child processes, design-gated BEFORE freezing",
    path: "the VIDEO-STYLIZATION path (the operator's copy-and-adapt) — NOT the state-driven reality engine's own real-footage path (the product-scale CAP lane)",
  },
  provenance: {
    note:
      "The R606 generative re-prep: the SAME real goal clip as the original + the three derived " +
      "kinds as PER-FRAME GENERATIVE genre restyles (actual anime / actual tactical board / " +
      "actual 3D-game render, each with the same-event preservation clause) — the same-event " +
      "identity holds BY CONSTRUCTION, the style fidelity by the design gate's strict VLM genre " +
      "check. The GATE itself is the operator's eyes; this record is the re-prep's own honest state.",
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

  // --- the generation record (the lane's own claims — shape-checked) ---
  const generationPath = join(outDir, "generation.json");
  const generation = loadJson<GenerationRecord>(generationPath, "generation");
  if (generation.kind !== "r606-generative-generation") {
    fail("generation-kind", `${generation.kind}`);
  }
  if (typeof generation.lane !== "string" || generation.lane.length < 40) {
    fail("generation-lane", "the lane's identity must be recorded");
  }
  if (generation.source?.sha256 !== SOURCE_SHA_EXPECTED) {
    fail("generation-source", `${generation.source?.sha256} != the researched source's sha`);
  }
  const designVerdict = generation.designGate?.verdict ?? "";
  if (designVerdict.length < 50 || !designVerdict.includes("YES")) {
    fail("generation-design-gate", "the strict VLM genre check's verdict must be carried (with its YES findings)");
  }
  const prompts = generation.prompts?.frozen ?? {};
  for (const kind of KINDS) {
    const prompt = prompts[kind];
    if (typeof prompt !== "string" || prompt.length < 100) {
      fail("generation-prompts", `the ${kind} prompt must be the frozen genre prompt (≥100 chars)`);
    }
  }
  const sampling = generation.sampling;
  if (!((sampling?.fps ?? 0) >= 1) || !((sampling?.sourceFrames ?? 0) >= 8) || !sampling?.editSize || !sampling?.assembledSize) {
    fail("generation-sampling", "the sampling facts (fps, frame count, sizes) must be recorded");
  }
  // the VIDEO-LEVEL spot check (stronger than the design gate's keyframe
  // check): three frames per genre across the video — early / middle / late —
  // through the same strict VLM genre questions. Optional in the out dir
  // (video-check.txt); when present it is embedded, never re-derived.
  let videoLevelCheck: { method: string; verdict: string } | undefined;
  const videoCheckPath = join(outDir, "video-check.txt");
  if (existsSync(videoCheckPath)) {
    const verdict = readFileSync(videoCheckPath, "utf8").trim();
    if (verdict.length < 50 || !verdict.includes("YES")) {
      fail("video-check", "the out dir carries a video-check.txt whose verdict is not a YES-verdict — refuse");
    }
    videoLevelCheck = {
      method:
        "three sampled frames per genre (early/middle/late) + the original frame — ten images, " +
        "one strict VLM call: same-scene in all ten + every genre frame actual to its genre",
      verdict,
    };
  }
  (record.provenance as Record<string, unknown>).generative = {
    lane: generation.lane,
    designGate: { method: generation.designGate?.method, verdict: designVerdict },
    videoLevelCheck: videoLevelCheck,
    prompts: { frozen: prompts },
    sampling,
    generationRecord: "the lane's own generation.json (carried in the out dir)",
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

  // --- the three DERIVED kinds: measured against the generation record's own claims ---
  const generationOutputs = new Map((generation.outputs ?? []).map((o) => [o.kind, o]));
  for (const kind of KINDS) {
    const mp4Path = join(outDir, `${kind}.mp4`);
    if (!existsSync(mp4Path)) fail(`${kind}`, `${mp4Path} absent`);
    const bytes = new Uint8Array(readFileSync(mp4Path));
    const magic = Buffer.from(bytes.subarray(4, 8)).toString("ascii");
    if (magic !== "ftyp") fail(`${kind}-magic`, `container magic ${magic}`);
    if (!(bytes.byteLength > 1000)) fail(`${kind}-size`, `byte size ${bytes.byteLength}`);
    const sha = sha256OfBytes(bytes);
    const claim = generationOutputs.get(kind);
    if (claim === undefined) fail(`${kind}-claim`, "the generation record holds no claim for this kind");
    if (claim.sha256 !== sha || claim.byteSize !== bytes.byteLength) {
      fail(`${kind}-crosscheck`, "the bytes on disk do not match the generation record's claim — nothing laundered");
    }
    const probe = await tool.probe(mp4Path);
    const outDurationSeconds = probe.durationMs / 1000;
    if (Math.abs(outDurationSeconds - durationSeconds) > 0.75) {
      fail(`${kind}-duration`, `duration ${outDurationSeconds}s vs source ${durationSeconds}s`);
    }
    if (claim.frameCount !== sampling?.sourceFrames) {
      fail(`${kind}-frames`, `the generation record's frame count ${claim.frameCount} != the sampling's ${sampling?.sourceFrames}`);
    }
    outputs.push({
      kind,
      byteSize: bytes.byteLength,
      sha256: sha,
      integrityVerified: true,
      containerMagic: magic,
      transform: "per-frame generative genre restyle (the frozen prompt, carried in the record) + ffmpeg assembly",
      durationSeconds: outDurationSeconds,
      frameCount: claim.frameCount,
      savedPath: mp4Path,
    });
    console.log(`  ${kind.padEnd(13)} ${String(bytes.byteLength).padStart(8)} B  sha ${sha.slice(0, 16)}…  ${claim.frameCount} frames`);
  }
  record.outputs = outputs;

  // --- the manifest (the operator-viewing dir's own card) ---
  const manifest = {
    kind: "r606-visual-gate-reprep2",
    ts: record.ts as string,
    gate: {
      question:
        "Watch the four realities (the GENERATIVE RE-PREP: the same REAL goal clip, the three " +
        "derived kinds per-frame generatively restyled). Can you identify the SAME match/event " +
        "in each, and are the styles ACTUALLY their genres now — real anime, a real tactical " +
        "analysis view, a real 3D-game render?",
      criteria: [
        "the same match/event identifiable across all four (the SAME real goal play by construction — this PASSED the re-verdict)",
        "the styles ACTUAL to their genres (the re-verdict's refusal ground: 'not actual anime / tactical / 3D' — the fix this re-prep carries)",
      ],
      verdict: "THE OPERATOR'S — never a worker's (R606, the human visual gate's RE-RE-VERDICT)",
      context:
        "the re-verdict REFUSED on style fidelity (the ffmpeg chains were color grading, not " +
        "genre restyling); this is the generative fix — every frame restyled by the image-edit " +
        "lane with design-gated genre prompts (the strict VLM genre check: all four questions YES)",
    },
    provenance: {
      note:
        "The same real goal event in all four BY CONSTRUCTION; the style fidelity by the " +
        "per-frame generative restyle (the frozen prompts + the design gate's strict VLM genre " +
        "check, both carried in the record). The GATE itself is the operator's eyes.",
      source: { title: SOURCE_TITLE, url: SOURCE_URL, license: SOURCE_LICENSE },
      designGateVerdict: designVerdict,
      videoLevelCheck: videoLevelCheck?.verdict,
      sampling,
    },
    outputs,
  };
  await writeFile(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));

  // --- the record ---
  await writeFile(recordPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  console.log(`\nThe R606 GENERATIVE RE-PREP is PERFORMABLE: the four realities exported to ${outDir}`);
  console.log(`The record: ${recordPath}`);
}

await main();
