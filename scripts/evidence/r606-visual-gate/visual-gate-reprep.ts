/**
 * r606-visual-gate-reprep — the R606 HUMAN VISUAL GATE's RE-PREP driver.
 *
 * The first prep's verdict (scripts/evidence/r606-visual-gate/verdict.json):
 * criterion 1 FAIL — "I can't identify the same match/event in each" — the
 * first prep's fixture class (the 2 s SYNTHETIC pitch scene) could not carry
 * event identity, and the procedural renderers never consume the source clip
 * anyway ("the anime prototype itself needs no source" — its own render.ts).
 * The operator's directive: "instead of building the complete solution from
 * scratch, try looking for solutions that have been reported to work and
 * just copy and adapt them."
 *
 * This driver implements the RESEARCH's design
 * (proven-solutions-research.md — the copy-and-adapt path):
 *   - the source: a REAL football clip (Mixkit 43499 "Goal play in a
 *     semi-professional soccer game" — free license, no attribution; the
 *     CDN's direct URL, no key/auth) — the same REAL goal event in every
 *     output, BY CONSTRUCTION;
 *   - the ORIGINAL: the real clip's own bytes, as-is;
 *   - the three DERIVED kinds: the SAME clip through three DOCUMENTED ffmpeg
 *     filter chains (the research's reported-to-work recipes — ffmpeg.org's
 *     edgedetect "paint/cartoon effect" mix; the palette quantization; the
 *     duotone/eq class) — the chains were FRAME-LEVEL VLM-CHECKED during the
 *     research flight (same scene identifiable + meaningful style
 *     differences, the verdict quoted in the record).
 *
 * The honest scope: this is the VIDEO-STYLIZATION path — the copy-and-adapt
 * the operator directed — NOT the state-driven reality engine's own
 * real-footage path (the product-scale CAP lane). The GATE's substance (the
 * same real event + meaningful stylistic differences) is what this path
 * demonstrates.
 *
 * The integrity discipline unchanged from the first prep: every output
 * sha-256 re-verified at the receiving boundary + the `ftyp` container magic
 * + the byte-length claim; exports OUTSIDE the repo (the no-committed-media
 * doctrine); every unexpected state → exit 1, typed, nothing laundered.
 *
 * Modes:
 *   --out <dir>       REQUIRED — the output dir (OUTSIDE the repo; the four
 *                     MP4s + manifest.json land there; no dead default).
 *   --source <file>   OPTIONAL — a pre-downloaded source clip (the driver
 *                     verifies its shape); when absent the driver downloads
 *                     the researched clip LIVE from the CDN (fail-closed on
 *                     any refusal).
 *
 * Run (from the REPO ROOT):
 *   bun run scripts/evidence/r606-visual-gate/visual-gate-reprep.ts \
 *     --out /home/z/my-project/public/r606-reprep
 */
import { writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { FfmpegTool, sha256OfBytes } from "../../../packages/media-platform/src/index";

// ---------------------------------------------------------------------------
// CLI (dev-time: argparse by hand, no deps)
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
function argValue(flag: string): string | undefined {
  const at = argv.indexOf(flag);
  return at === -1 ? undefined : argv[at + 1];
}
const outArg = argValue("--out");
if (outArg === undefined) {
  console.error("FATAL: --out <dir> is required (the operator-viewing output dir — outside the repo)");
  process.exit(1);
}
const outDir = resolve(outArg);
const sourceArg = argValue("--source");
const here = dirname(new URL(import.meta.url).pathname);
const recordPath = join(here, "visual-gate-reprep.json");

function fail(step: string, detail: string): never {
  console.error(`FATAL [${step}]: ${detail}`);
  process.exit(1);
}

const KINDS = ["original", "tactical", "three-d-game", "anime-npr"] as const;

// The researched source (proven-solutions-research.json: the pick + its
// live-measured CDN probe). The license: the Mixkit License — free, no
// attribution required (the page's own JSON-LD: copyrightNotice "Free",
// isAccessibleForFree true).
const SOURCE_URL = "https://assets.mixkit.co/videos/43499/43499-720.mp4";
const SOURCE_LICENSE = "Mixkit License (free, no attribution; https://mixkit.co/license/#videoFree)";
const SOURCE_TITLE = "Goal play in a semi-professional soccer game (Mixkit 43499)";
const SOURCE_DESCRIPTION =
  "Skillful team play that ends in a goal, in a semi-professional soccer game, " +
  "in a shot from inside the field (the provider's own description)";

// The three chains — FROZEN from the research flight's frame-level
// prototyping (the /tmp frame extracts) + the VLM frame check (the verdict
// quoted in the record). Each chain is a composition of DOCUMENTED ffmpeg
// filters (the research's reported-to-work recipes):
const CHAINS: Record<"tactical" | "three-d-game" | "anime-npr", readonly string[]> = {
  // The tactical-board look: desaturated, contrast-forward duotone (the
  // analysis-board character).
  tactical: [
    "-vf",
    "eq=saturation=0.55:contrast=1.2," +
      "colorchannelmixer=rr=0.15:rg=0.75:rb=0.10:gr=0.15:gg=0.85:gb=0.00:br=0.10:bg=0.60:bb=0.30," +
      "format=yuv420p",
  ],
  // The 3D-game look: saturation boost + palette quantization (the
  // flat-shaded, low-color game-render character — the classic two-pass
  // palettegen/paletteuse pipeline, temporally stable via the single global
  // palette).
  "three-d-game": [
    "-vf",
    "eq=saturation=1.5:contrast=1.1," +
      "split[a][b];[a]palettegen=max_colors=28[p];[b][p]paletteuse=dither=bayer:bayer_scale=4," +
      "format=yuv420p",
  ],
  // The anime-NPR look: ffmpeg.org's own documented "paint/cartoon effect"
  // (edgedetect mode=colormix) + a saturation lift — the cel-shaded, outlined
  // character.
  "anime-npr": [
    "-vf",
    "edgedetect=mode=colormix:low=0.1:high=0.14,eq=saturation=1.25,format=yuv420p",
  ],
};

// The frame-level VLM check's verdict (the research flight's own design
// gate — the chains were checked BEFORE freezing: same scene identifiable
// across all four + meaningful differences + none failing; the check ran
// through the TL station's z-ai vision lane on the four frame extracts).
const VLM_FRAME_CHECK_VERDICT =
  "A) Yes, the same scene/event is identifiable across all four frames (same players, " +
  "same pitch, same moment). B) Yes, the visual styles are meaningfully different: Original — " +
  "realistic, full-color video footage; Tactical — desaturated, high-contrast (like a tactical " +
  "analysis board); 3D Game — smooth, low-texture, computer-generated aesthetic (resembling a " +
  "sports video game); Anime — high-contrast, cel-shaded with dark outlines and stylized colors. " +
  "C) None of the four fail; all preserve the recognizable scene and exhibit a meaningfully " +
  "distinct visual style from the original.";

// ---------------------------------------------------------------------------
// The walk
// ---------------------------------------------------------------------------
const record: Record<string, unknown> = {
  schemaVersion: 1,
  kind: "r606-visual-gate-reprep",
  ts: new Date().toISOString(),
  context: {
    firstVerdict: "scripts/evidence/r606-visual-gate/verdict.json (criterion 1 FAIL — the gate REFUSED)",
    directive:
      "instead of building the complete solution from scratch, try looking for solutions that " +
      "have been reported to work and just copy and adapt them (the operator's, typed verbatim in the verdict record)",
    research: "scripts/evidence/r606-visual-gate/proven-solutions-research.md (the copy-and-adapt design)",
    path: "the VIDEO-STYLIZATION path (the operator's copy-and-adapt) — NOT the state-driven reality engine's own real-footage path (the product-scale CAP lane)",
  },
  provenance: {
    note:
      "The R606 re-prep: the SAME real goal clip as the original + the three derived kinds as " +
      "DOCUMENTED ffmpeg filter chains over the SAME bytes — the same-event identity holds BY " +
      "CONSTRUCTION, the differences are the chains' own documented effects. The GATE itself is " +
      "the operator's eyes; this record is the re-prep's own honest state.",
    source: {
      title: SOURCE_TITLE,
      description: SOURCE_DESCRIPTION,
      url: SOURCE_URL,
      license: SOURCE_LICENSE,
      acquired: sourceArg !== undefined ? `--source ${resolve(sourceArg)}` : "live download (fetch, the CDN's direct URL)",
    },
    chains: {
      frozen: CHAINS,
      frameCheck: {
        method:
          "the research flight's frame-level VLM check (the TL station's z-ai vision lane, " +
          "four frame extracts: the original + one frame per chain)",
        verdict: VLM_FRAME_CHECK_VERDICT,
      },
    },
  },
  outputs: [] as unknown[],
};

/** Runs one ffmpeg subprocess to completion; fail-closed on non-zero. */
async function runFfmpeg(
  ffmpegPath: string,
  args: readonly string[],
  label: string,
): Promise<void> {
  const proc = Bun.spawn([ffmpegPath, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    fail(`encode-${label}`, `ffmpeg exit ${exitCode}: ${stderr.trim().split("\n").slice(-4).join(" | ")}`);
  }
}

async function main(): Promise<void> {
  const { mkdir } = await import("node:fs/promises");
  await mkdir(outDir, { recursive: true });

  // --- the toolchain (measured, never assumed) ---
  const tool = new FfmpegTool();
  if (!(await tool.available())) {
    fail("toolchain", `ffmpeg is not available at '${tool.ffmpegPath}' — the re-prep never fakes it`);
  }
  const version = await tool.version();
  (record.provenance as Record<string, unknown>).toolchain = {
    ffmpegPath: tool.ffmpegPath,
    version: version ?? "unknown (the version probe returned null — refused below)",
  };
  if (version === null) fail("toolchain", "the ffmpeg version probe returned null");
  console.log(`toolchain: ${version}`);

  // --- acquire the source (download or --source) ---
  let sourceBytes: Uint8Array;
  if (sourceArg !== undefined) {
    const file = Bun.file(resolve(sourceArg));
    if (!(await file.exists())) fail("source", `--source ${resolve(sourceArg)} does not exist`);
    sourceBytes = new Uint8Array(await file.arrayBuffer());
    console.log(`source: --source ${resolve(sourceArg)} (${sourceBytes.byteLength} B)`);
  } else {
    console.log(`source: downloading ${SOURCE_URL} …`);
    const response = await fetch(SOURCE_URL, {
      headers: { "user-agent": "sporta-evidence-r606-reprep/1.0 (the R606 visual gate's re-prep driver)" },
    });
    if (response.status !== 200) {
      fail("source-download", `HTTP ${response.status} from the CDN (the researched URL)`);
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("video/mp4")) {
      fail("source-download", `content-type ${contentType} (expected video/mp4)`);
    }
    sourceBytes = new Uint8Array(await response.arrayBuffer());
    console.log(`source: downloaded ${sourceBytes.byteLength} B (${contentType})`);
  }
  const sourceMagic = Buffer.from(sourceBytes.subarray(4, 8)).toString("ascii");
  if (sourceMagic !== "ftyp") fail("source-magic", `container magic ${sourceMagic} (expected ftyp)`);
  const sourceSha = sha256OfBytes(sourceBytes);
  const sourcePath = join(outDir, "source.mp4");
  await Bun.write(sourcePath, sourceBytes);

  // --- the source's measured manifest (probe, never caller-declared) ---
  const probe = await tool.probe(sourcePath);
  const videoStream = probe.videoStreams[0];
  if (videoStream === undefined) fail("source-probe", "the source holds no video stream");
  const durationSeconds = probe.durationMs / 1000;
  if (!(durationSeconds >= 1)) {
    fail("source-probe", `duration ${durationSeconds}s (expected a real multi-second event)`);
  }
  (record.provenance as Record<string, unknown>).sourceMeasured = {
    byteSize: sourceBytes.byteLength,
    sha256: sourceSha,
    durationSeconds,
    width: videoStream.width,
    height: videoStream.height,
    codec: videoStream.codec_name,
    hasAudio: probe.audioStreams.length > 0,
  };
  console.log(
    `source measured: ${videoStream.width}x${videoStream.height} ${videoStream.codec_name}, ` +
      `${durationSeconds.toFixed(2)}s, sha ${sourceSha.slice(0, 16)}…, ` +
      `audio ${probe.audioStreams.length > 0 ? "present" : "absent"}`,
  );

  // --- the ORIGINAL: the real clip's own bytes, as-is ---
  const outputs: Record<string, unknown>[] = [];
  {
    const savedPath = join(outDir, "original.mp4");
    await Bun.write(savedPath, sourceBytes);
    const readBack = new Uint8Array(await Bun.file(savedPath).arrayBuffer());
    const readSha = sha256OfBytes(readBack);
    if (readSha !== sourceSha || readBack.byteLength !== sourceBytes.byteLength) {
      fail("original-write", "the original's write-back re-hash mismatch");
    }
    outputs.push({
      kind: "original",
      byteSize: readBack.byteLength,
      sha256: readSha,
      integrityVerified: true,
      containerMagic: Buffer.from(readBack.subarray(4, 8)).toString("ascii"),
      transform: "none (the real clip's own bytes, as-is)",
      savedPath,
    });
    console.log(`  ${"original".padEnd(13)} ${String(readBack.byteLength).padStart(8)} B  sha ${readSha.slice(0, 16)}…  → ${savedPath}`);
  }

  // --- the three DERIVED kinds: the same bytes through the frozen chains ---
  for (const kind of ["tactical", "three-d-game", "anime-npr"] as const) {
    const chain = CHAINS[kind];
    const savedPath = join(outDir, `${kind}.mp4`);
    const args: string[] = ["-v", "error", "-y", "-i", sourcePath, ...chain];
    // The source carries no audio (measured); the stylized outputs are the
    // visual planes — video-only, the transform's own honest scope.
    args.push("-an", "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-movflags", "+faststart", savedPath);
    await runFfmpeg(tool.ffmpegPath, args, kind);
    const bytes = new Uint8Array(await Bun.file(savedPath).arrayBuffer());
    const magic = Buffer.from(bytes.subarray(4, 8)).toString("ascii");
    if (magic !== "ftyp") fail(`encode-${kind}`, `container magic ${magic}`);
    if (!(bytes.byteLength > 1000)) {
      fail(`encode-${kind}`, `byte size ${bytes.byteLength} (a stylized render must carry real bytes)`);
    }
    const outProbe = await tool.probe(savedPath);
    const outDurationSeconds = outProbe.durationMs / 1000;
    if (Math.abs(outDurationSeconds - durationSeconds) > 0.75) {
      fail(`encode-${kind}`, `duration ${outDurationSeconds}s vs source ${durationSeconds}s`);
    }
    const outSha = sha256OfBytes(bytes);
    outputs.push({
      kind,
      byteSize: bytes.byteLength,
      sha256: outSha,
      integrityVerified: true,
      containerMagic: magic,
      transform: chain[1] ?? "(the frozen chain)",
      durationSeconds: outDurationSeconds,
      savedPath,
    });
    console.log(`  ${kind.padEnd(13)} ${String(bytes.byteLength).padStart(8)} B  sha ${outSha.slice(0, 16)}…  → ${savedPath}`);
  }
  record.outputs = outputs;

  // --- the manifest (the operator-viewing dir's own card) ---
  const manifest = {
    kind: "r606-visual-gate-reprep",
    ts: record.ts as string,
    gate: {
      question:
        "Watch the four realities (the RE-PREP: the same REAL goal clip in all four). " +
        "Can you identify the SAME match/event in each, and do you see MEANINGFUL " +
        "stylistic differences between them?",
      criteria: [
        "the same match/event identifiable across all four (now: the SAME real goal play by construction)",
        "meaningful stylistic differences (Tactical / 3D Game / Anime-NPR vs the Original)",
      ],
      verdict: "THE OPERATOR'S — never a worker's (R606, the human visual gate's RE-VERDICT)",
      context:
        "the first verdict REFUSED criterion 1 (the synthetic fixture could not carry event " +
        "identity); this is the copy-and-adapt re-prep the operator directed — the same real " +
        "footage through documented ffmpeg chains (proven-solutions-research.md)",
    },
    provenance: {
      ...record.provenance,
      firstPrep: "the first prep's own manifest (public/r606/manifest.json) stays for the record",
    },
    outputs,
  };
  await Bun.write(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));

  // --- the record ---
  await writeFile(recordPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  console.log(`\nThe R606 RE-PREP is PERFORMABLE: the four realities (the same real goal event) exported to ${outDir}`);
  console.log(`The record: ${recordPath}`);
}

await main();
