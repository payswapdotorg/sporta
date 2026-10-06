/**
 * r606-visual-gate validate-evidence — the record's fail-closed validator.
 *
 * Checks:
 *   1. the record's shape: the kind, four outputs, the closed kinds set,
 *      every output integrity-verified with a 64-hex sha + a positive byte
 *      size + the ftyp magic recorded;
 *   2. when the exported files are present (--out, or the record's own
 *      savedPath): every file re-hashed + re-measured against the record
 *      (sha-256 + byte length — nothing laundered between the run and the
 *      check);
 *   3. the negative battery (--battery): a tampered record copy (one sha
 *      flipped) MUST be refused exit 1 — the validator proves it can fail.
 *   4. the VERDICT record (verdict.json, when present in this dir): its own
 *      shape — the kind, the two criteria (criterion 1 FAIL + criterion 2
 *      PASS — the operator's typed words, never a worker's judgment), the
 *      verbatim quotes (≥2 non-empty), the gateOutcome REFUSED, the
 *      operatorDirective, the nextFlight plan. The verdict is NEVER
 *      re-derived — only its shape is checked (the words are the
 *      operator's, the validator has no opinion on the visuals).
 *   5. the RE-VERDICT record (verdict-reprep.json, when present in this
 *      dir): its own shape — the kind, the two criteria (criterion 1 PASS
 *      + criterion 2 FAIL — the operator's re-verdict on the re-prep:
 *      the same match identifiable, the applied styles not accurate),
 *      the verbatim quotes, the gateOutcome REFUSED, the directive, the
 *      nextFlight plan. Never re-derived — the shape only.
 *   6. the GENERATIVE RE-PREP record (visual-gate-reprep2.json, when present
 *      in this dir): its own shape — the kind, the re-verdict context, four
 *      outputs (the ORIGINAL byte-identical to the researched source —
 *      hard-checked), the generative provenance (the design gate's strict
 *      VLM verdict, the three frozen prompts, the sampling facts), the
 *      toolchain; with --reprep2-out the four exported files re-hashed.
 *
 * Modes:
 *   --out <dir>      the exported outputs' dir (optional — when absent only
 *                    the record's shape is checked).
 *   --record <path>  the record to validate (default: this dir's own
 *                    visual-gate-prep.json — the battery points this at a
 *                    tampered copy).
 *   --battery        run the negative battery: a tampered record copy (one
 *                    sha flipped to another VALID hex char) validated in a
 *                    CHILD process with the SAME --out — the re-hash
 *                    cross-check must refuse it non-zero; the validator
 *                    proves it can fail; the real record is never touched.
 *                    A SECOND tampered VERDICT copy (criterion 1's FAIL
 *                    flipped to PASS — a laundered verdict is the worst
 *                    lie this tree could hold) must ALSO be refused.
 *                    A THIRD tampered RE-VERDICT copy (criterion 2's FAIL
 *                    flipped to PASS — the style-fidelity failure
 *                    laundered into a pass) must ALSO be refused. A FOURTH
 *                    tampered RE-PREP2 copy (one sha flipped), with
 *                    --reprep2-out given, must ALSO be refused.
 */
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

const argv = process.argv.slice(2);
function argValue(flag: string): string | undefined {
  const at = argv.indexOf(flag);
  return at === -1 ? undefined : argv[at + 1];
}
const outDir = argValue("--out");
const battery = argv.includes("--battery");
const recordArg = argValue("--record");
const verdictArg = argValue("--verdict");
const reprepArg = argValue("--reprep");
const reprepOutArg = argValue("--reprep-out");
const reverdictArg = argValue("--reverdict");
const rereverdictArg = argValue("--rereverdict");
const rerereverdictArg = argValue("--rerereverdict");
const reprep2Arg = argValue("--reprep2");
const reprep2OutArg = argValue("--reprep2-out");
const reprep3Arg = argValue("--reprep3");
const reprep3OutArg = argValue("--reprep3-out");
const here = dirname(new URL(import.meta.url).pathname);
const recordPath = recordArg ?? join(here, "visual-gate-prep.json");
const verdictPath = verdictArg ?? join(here, "verdict.json");
const reverdictPath = reverdictArg ?? join(here, "verdict-reprep.json");
const rereverdictPath = rereverdictArg ?? join(here, "verdict-reprep2.json");
const rerereverdictPath = rerereverdictArg ?? join(here, "verdict-reprep3.json");
const reprepPath = reprepArg ?? join(here, "visual-gate-reprep.json");
const reprep2Path = reprep2Arg ?? join(here, "visual-gate-reprep2.json");
const reprep3Path = reprep3Arg ?? join(here, "visual-gate-reprep3.json");
const SOURCE_SHA_EXPECTED = "d53f611eb3688c52e1f44ac69721e11b1bd2bb52efb4f705c4b745afba15915d";

type Output = {
  kind: string;
  byteSize: number;
  sha256: string;
  integrityVerified: boolean;
  containerMagic: string;
  savedPath?: string;
};
type Record = { kind: string; outputs: Output[]; provenance?: { clipSha256?: string } };
type VerdictRecord = {
  kind: string;
  operatorVerbatim?: string[];
  criteria?: { [criterion: string]: { verdict?: string } | undefined };
  gateOutcome?: string;
  operatorDirective?: { text?: string };
  nextFlight?: { [leg: string]: string };
};

function fail(check: string, detail: string): never {
  console.error(`REFUSED [${check}]: ${detail}`);
  process.exit(1);
}

function sha256OfBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function checkRecord(record: Record, label: string): void {
  if (record.kind !== "r606-visual-gate-prep") {
    fail("kind", `${label}: ${record.kind}`);
  }
  if (!Array.isArray(record.outputs) || record.outputs.length !== 4) {
    fail("outputs", `${label}: ${record.outputs?.length ?? 0} outputs (expected 4)`);
  }
  const kinds = new Set(record.outputs.map((output) => output.kind));
  const expected = new Set(["original", "tactical", "three-d-game", "anime-npr"]);
  if (kinds.size !== 4 || [...kinds].some((kind) => !expected.has(kind))) {
    fail("kinds", `${label}: ${[...kinds].join(", ")}`);
  }
  for (const output of record.outputs) {
    if (output.integrityVerified !== true) {
      fail("integrity", `${label}: ${output.kind} not integrity-verified`);
    }
    if (!/^[0-9a-f]{64}$/.test(output.sha256)) {
      fail("sha-shape", `${label}: ${output.kind} sha not 64-hex`);
    }
    if (!(output.byteSize > 0)) {
      fail("byte-size", `${label}: ${output.kind} ${output.byteSize}`);
    }
    if (output.containerMagic !== "ftyp") {
      fail("magic", `${label}: ${output.kind} ${output.containerMagic}`);
    }
  }
}

async function checkFiles(record: Record, dir: string): Promise<void> {
  for (const output of record.outputs) {
    const path = join(dir, `${output.kind}.mp4`);
    if (!existsSync(path)) {
      fail("file-present", `${output.kind}: ${path} absent`);
    }
    const bytes = new Uint8Array(await readFile(path));
    if (bytes.byteLength !== output.byteSize) {
      fail("file-size", `${output.kind}: ${bytes.byteLength} != ${output.byteSize}`);
    }
    const reHashed = sha256OfBytes(bytes);
    if (reHashed !== output.sha256) {
      fail("file-sha", `${output.kind}: ${reHashed.slice(0, 16)}… != ${output.sha256.slice(0, 16)}…`);
    }
    const magic = Buffer.from(bytes.subarray(4, 8)).toString("ascii");
    if (magic !== "ftyp") {
      fail("file-magic", `${output.kind}: ${magic}`);
    }
  }
}

function checkVerdict(verdict: VerdictRecord, label: string): void {
  if (verdict.kind !== "r606-visual-gate-verdict") {
    fail("verdict-kind", `${label}: ${verdict.kind}`);
  }
  const quotes = verdict.operatorVerbatim;
  if (!Array.isArray(quotes) || quotes.length < 2 || quotes.some((q) => typeof q !== "string" || q.length < 10)) {
    fail("verdict-verbatim", `${label}: the operator's own words must be present (≥2, typed verbatim)`);
  }
  const criteria = verdict.criteria;
  if (
    !criteria ||
    criteria["same-match-event-identifiable-across-all-four"]?.verdict !== "FAIL" ||
    criteria["meaningful-stylistic-differences"]?.verdict !== "PASS"
  ) {
    fail(
      "verdict-criteria",
      `${label}: criterion 1 must be FAIL and criterion 2 PASS — the OPERATOR's measured verdict (a worker NEVER re-derives these)`,
    );
  }
  if (typeof verdict.gateOutcome !== "string" || !verdict.gateOutcome.startsWith("REFUSED")) {
    fail("verdict-outcome", `${label}: ${verdict.gateOutcome}`);
  }
  if (typeof verdict.operatorDirective?.text !== "string" || verdict.operatorDirective.text.length < 20) {
    fail("verdict-directive", `${label}: the operator's directive must be carried verbatim`);
  }
  if (!verdict.nextFlight || Object.keys(verdict.nextFlight).length < 3) {
    fail("verdict-next-flight", `${label}: the next-flight plan (≥3 legs) must be present`);
  }
}

function checkVerdictReprep(verdict: VerdictRecord, label: string): void {
  if (verdict.kind !== "r606-visual-gate-reprep-verdict") {
    fail("reverdict-kind", `${label}: ${verdict.kind}`);
  }
  const quotes = verdict.operatorVerbatim;
  if (!Array.isArray(quotes) || quotes.length < 2 || quotes.some((q) => typeof q !== "string" || q.length < 10)) {
    fail("reverdict-verbatim", `${label}: the operator's own words must be present (≥2, typed verbatim)`);
  }
  const criteria = verdict.criteria;
  if (
    !criteria ||
    criteria["same-match-event-identifiable-across-all-four"]?.verdict !== "PASS" ||
    criteria["meaningful-stylistic-differences"]?.verdict !== "FAIL"
  ) {
    fail(
      "reverdict-criteria",
      `${label}: criterion 1 must be PASS and criterion 2 FAIL — the OPERATOR's measured re-verdict (a worker NEVER re-derives these)`,
    );
  }
  if (typeof verdict.gateOutcome !== "string" || !verdict.gateOutcome.startsWith("REFUSED")) {
    fail("reverdict-outcome", `${label}: ${verdict.gateOutcome}`);
  }
  if (typeof verdict.operatorDirective?.text !== "string" || verdict.operatorDirective.text.length < 20) {
    fail("reverdict-directive", `${label}: the operator's directive must be carried verbatim`);
  }
  if (!verdict.nextFlight || Object.keys(verdict.nextFlight).length < 3) {
    fail("reverdict-next-flight", `${label}: the next-flight plan (≥3 legs) must be present`);
  }
}

async function loadRecord(path: string): Promise<Record> {
  if (!existsSync(path)) fail("record-present", `${path} absent`);
  try {
    return JSON.parse(await readFile(path, "utf8")) as Record;
  } catch (error) {
    return fail("record-parse", String(error));
  }
}

function checkVerdictReprep2(verdict: VerdictRecord, label: string): void {
  if (verdict.kind !== "r606-visual-gate-reprep2-verdict") {
    fail("rereverdict-kind", `${label}: ${verdict.kind}`);
  }
  const quotes = verdict.operatorVerbatim;
  if (!Array.isArray(quotes) || quotes.length < 3 || quotes.some((q) => typeof q !== "string" || q.length < 10)) {
    fail("rereverdict-verbatim", `${label}: the operator's three observations must be present (≥3, typed verbatim)`);
  }
  const criteria = verdict.criteria;
  if (
    !criteria ||
    criteria["same-match-event-identifiable-across-all-four"]?.verdict !== "PASS" ||
    criteria["meaningful-stylistic-differences"]?.verdict !== "FAIL"
  ) {
    fail(
      "rereverdict-criteria",
      `${label}: criterion 1 must be PASS (not contested) and criterion 2 FAIL (temporal consistency) — the OPERATOR's measured re-re-verdict (a worker NEVER re-derives these)`,
    );
  }
  if (typeof verdict.gateOutcome !== "string" || !verdict.gateOutcome.startsWith("REFUSED")) {
    fail("rereverdict-outcome", `${label}: ${verdict.gateOutcome}`);
  }
  const diagnosis = verdict.diagnosis as { measuredBeforeFix?: { flickerMetric?: string; ballCheck?: string } } | undefined;
  if (
    !diagnosis?.measuredBeforeFix?.flickerMetric ||
    !diagnosis.measuredBeforeFix.flickerMetric.includes("34.03") ||
    !diagnosis.measuredBeforeFix.ballCheck
  ) {
    fail(
      "rereverdict-measured-diagnosis",
      `${label}: the re-re-verdict's diagnosis must carry the MEASURED flicker metrics (the tactical 34.03 jump/frame) + the VLM ball check — the diagnosis is measured, never asserted`,
    );
  }
  if (typeof verdict.operatorDirective?.text !== "string" || verdict.operatorDirective.text.length < 20) {
    fail("rereverdict-directive", `${label}: the operator's directive must be carried verbatim`);
  }
  if (!verdict.nextFlight || Object.keys(verdict.nextFlight).length < 3) {
    fail("rereverdict-next-flight", `${label}: the next-flight plan (≥3 legs) must be present`);
  }
}

// The RE-RE-RE-VERDICT (verdict-reprep3.json — the operator's verdict on the
// TEMPORALLY-COHERENT re-prep: the temporal ground retired, the genre-
// composition + clarity + ball-trajectory grounds raised).
function checkVerdictReprep3(verdict: VerdictRecord, label: string): void {
  if (verdict.kind !== "r606-visual-gate-reprep3-verdict") {
    fail("rerereverdict-kind", `${label}: ${verdict.kind}`);
  }
  const quotes = verdict.operatorVerbatim;
  if (!Array.isArray(quotes) || quotes.length < 3 || quotes.some((q) => typeof q !== "string" || q.length < 10)) {
    fail("rerereverdict-verbatim", `${label}: the operator's three observations must be present (≥3, typed verbatim)`);
  }
  const criteria = verdict.criteria;
  if (
    !criteria ||
    criteria["same-match-event-identifiable-across-all-four"]?.verdict !== "PASS" ||
    criteria["meaningful-stylistic-differences"]?.verdict !== "FAIL"
  ) {
    fail(
      "rerereverdict-criteria",
      `${label}: criterion 1 must be PASS (not contested) and criterion 2 FAIL (genre-composition + clarity + ball-trajectory) — the OPERATOR's measured re-re-re-verdict (a worker NEVER re-derives these)`,
    );
  }
  if (typeof verdict.gateOutcome !== "string" || !verdict.gateOutcome.startsWith("REFUSED")) {
    fail("rerereverdict-outcome", `${label}: ${verdict.gateOutcome}`);
  }
  const diagnosis = verdict.diagnosis as
    | { theRetiredGround?: string; theNewGrounds?: { tacticalGenreComposition?: string; clarity?: string; animeBallTrajectory?: string } }
    | undefined;
  if (
    !diagnosis?.theRetiredGround ||
    !/retired/i.test(diagnosis.theRetiredGround) ||
    !diagnosis.theNewGrounds?.tacticalGenreComposition ||
    !diagnosis.theNewGrounds?.clarity ||
    !diagnosis.theNewGrounds?.animeBallTrajectory
  ) {
    fail(
      "rerereverdict-diagnosis",
      `${label}: the re-re-re-verdict's diagnosis must carry the retired temporal ground + the three new measured grounds (the tactical genre-composition, the clarity, the anime ball-trajectory) — honestly typed, never laundered`,
    );
  }
  if (typeof verdict.operatorDirective?.text !== "string" || verdict.operatorDirective.text.length < 20) {
    fail("rerereverdict-directive", `${label}: the operator's directive must be carried verbatim`);
  }
  if (!verdict.nextFlight || Object.keys(verdict.nextFlight).length < 3) {
    fail("rerereverdict-next-flight", `${label}: the next-flight plan (≥3 legs) must be present`);
  }
}

async function loadVerdictIfPresent(path: string): Promise<VerdictRecord | null> {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(await readFile(path, "utf8")) as VerdictRecord;
  } catch (error) {
    return fail("verdict-parse", String(error));
  }
}

// ---------------------------------------------------------------------------
// The RE-PREP record (visual-gate-reprep.json — the copy-and-adapt flight)
// ---------------------------------------------------------------------------
type ReprepOutput = {
  kind?: string;
  byteSize?: number;
  sha256?: string;
  integrityVerified?: boolean;
  containerMagic?: string;
  transform?: string;
  savedPath?: string;
};
type ReprepRecord = {
  kind?: string;
  context?: Record<string, string>;
  provenance?: {
    source?: { url?: string; license?: string; title?: string };
    sourceMeasured?: { sha256?: string; durationSeconds?: number };
    chains?: { frozen?: Record<string, readonly string[]>; frameCheck?: { verdict?: string } };
    toolchain?: { version?: string };
  };
  outputs?: ReprepOutput[];
};

function checkReprep(reprep: ReprepRecord, label: string): void {
  if (reprep.kind !== "r606-visual-gate-reprep") {
    fail("reprep-kind", `${label}: ${reprep.kind}`);
  }
  if (
    !reprep.context?.firstVerdict ||
    !reprep.context.directive ||
    !reprep.context.research ||
    !reprep.context.path
  ) {
    fail("reprep-context", `${label}: the first verdict + directive + research + path must be carried`);
  }
  const outputs = reprep.outputs;
  if (!Array.isArray(outputs) || outputs.length !== 4) {
    fail("reprep-outputs", `${label}: ${outputs?.length ?? 0} outputs (expected 4)`);
  }
  const kinds = new Set(outputs.map((output) => output.kind));
  const expected = new Set(["original", "tactical", "three-d-game", "anime-npr"]);
  if (kinds.size !== 4 || [...kinds].some((kind) => !expected.has(kind ?? ""))) {
    fail("reprep-kinds", `${label}: ${[...kinds].join(", ")}`);
  }
  for (const output of outputs) {
    if (output.integrityVerified !== true) {
      fail("reprep-integrity", `${label}: ${output.kind} not integrity-verified`);
    }
    if (!/^[0-9a-f]{64}$/.test(output.sha256 ?? "")) {
      fail("reprep-sha-shape", `${label}: ${output.kind} sha not 64-hex`);
    }
    if (!(output.byteSize > 0)) {
      fail("reprep-byte-size", `${label}: ${output.kind} ${output.byteSize}`);
    }
    if (output.containerMagic !== "ftyp") {
      fail("reprep-magic", `${label}: ${output.kind} ${output.containerMagic}`);
    }
  }
  const source = reprep.provenance?.source;
  if (!source?.url?.startsWith("https://") || !source.license || !source.title) {
    fail("reprep-source", `${label}: the researched source's url + license + title must be recorded`);
  }
  const measured = reprep.provenance?.sourceMeasured;
  if (!/^[0-9a-f]{64}$/.test(measured?.sha256 ?? "") || !((measured?.durationSeconds ?? 0) >= 1)) {
    fail("reprep-source-measured", `${label}: the source's own sha + duration must be measured`);
  }
  const frozen = reprep.provenance?.chains?.frozen;
  if (
    !frozen?.tactical?.[1] ||
    !frozen?.["three-d-game"]?.[1] ||
    !frozen?.["anime-npr"]?.[1]
  ) {
    fail("reprep-chains", `${label}: the three frozen chains must be recorded`);
  }
  if (!reprep.provenance?.chains?.frameCheck?.verdict || reprep.provenance.chains.frameCheck.verdict.length < 50) {
    fail("reprep-frame-check", `${label}: the research flight's frame-level VLM check verdict must be carried`);
  }
  if (!reprep.provenance?.toolchain?.version) {
    fail("reprep-toolchain", `${label}: the ffmpeg toolchain version must be measured`);
  }
}

async function checkReprepFiles(reprep: ReprepRecord, dir: string): Promise<void> {
  for (const output of reprep.outputs ?? []) {
    const path = join(dir, `${output.kind}.mp4`);
    if (!existsSync(path)) {
      fail("reprep-file-present", `${output.kind}: ${path} absent`);
    }
    const bytes = new Uint8Array(await readFile(path));
    if (bytes.byteLength !== output.byteSize) {
      fail("reprep-file-size", `${output.kind}: ${bytes.byteLength} != ${output.byteSize}`);
    }
    const reHashed = sha256OfBytes(bytes);
    if (reHashed !== output.sha256) {
      fail("reprep-file-sha", `${output.kind}: ${reHashed.slice(0, 16)}… != ${output.sha256?.slice(0, 16)}…`);
    }
  }
}

// ---------------------------------------------------------------------------
// The GENERATIVE RE-PREP record (visual-gate-reprep2.json — the style-
// fidelity fix flight)
// ---------------------------------------------------------------------------
type Reprep2Output = {
  kind?: string;
  byteSize?: number;
  sha256?: string;
  integrityVerified?: boolean;
  containerMagic?: string;
  frameCount?: number;
  savedPath?: string;
};
type Reprep2Record = {
  kind?: string;
  context?: Record<string, string>;
  provenance?: {
    source?: { sha256?: string };
    generative?: {
      designGate?: { verdict?: string };
      prompts?: { frozen?: Record<string, string> };
      sampling?: { fps?: number; sourceFrames?: number };
    };
    toolchain?: { version?: string };
  };
  outputs?: Reprep2Output[];
};

function checkReprep2(reprep2: Reprep2Record, label: string): void {
  if (reprep2.kind !== "r606-visual-gate-reprep2") {
    fail("reprep2-kind", `${label}: ${reprep2.kind}`);
  }
  if (
    !reprep2.context?.reVerdict ||
    !reprep2.context.directive ||
    !reprep2.context.lane ||
    !reprep2.context.path
  ) {
    fail("reprep2-context", `${label}: the re-verdict + directive + lane + path must be carried`);
  }
  const outputs = reprep2.outputs;
  if (!Array.isArray(outputs) || outputs.length !== 4) {
    fail("reprep2-outputs", `${label}: ${outputs?.length ?? 0} outputs (expected 4)`);
  }
  const kinds = new Set(outputs.map((output) => output.kind));
  const expected = new Set(["original", "tactical", "three-d-game", "anime-npr"]);
  if (kinds.size !== 4 || [...kinds].some((kind) => !expected.has(kind ?? ""))) {
    fail("reprep2-kinds", `${label}: ${[...kinds].join(", ")}`);
  }
  for (const output of outputs) {
    if (output.integrityVerified !== true) {
      fail("reprep2-integrity", `${label}: ${output.kind} not integrity-verified`);
    }
    if (!/^[0-9a-f]{64}$/.test(output.sha256 ?? "")) {
      fail("reprep2-sha-shape", `${label}: ${output.kind} sha not 64-hex`);
    }
    if (!(output.byteSize! > 0)) {
      fail("reprep2-byte-size", `${label}: ${output.kind} ${output.byteSize}`);
    }
    if (output.containerMagic !== "ftyp") {
      fail("reprep2-magic", `${label}: ${output.kind} ${output.containerMagic}`);
    }
  }
  // the ORIGINAL: byte-identical to the researched source (hard check)
  const original = outputs.find((output) => output.kind === "original");
  if (original?.sha256 !== SOURCE_SHA_EXPECTED) {
    fail(
      "reprep2-original-source",
      `${label}: the original must be byte-identical to the researched source (${original?.sha256?.slice(0, 16)}…)`,
    );
  }
  if (reprep2.provenance?.source?.sha256 !== SOURCE_SHA_EXPECTED) {
    fail("reprep2-source-sha", `${label}: the provenance source sha must be the researched source's`);
  }
  const generative = reprep2.provenance?.generative;
  const designVerdict = generative?.designGate?.verdict ?? "";
  if (designVerdict.length < 50 || !designVerdict.includes("YES")) {
    fail("reprep2-design-gate", `${label}: the strict VLM genre check's verdict must be carried (with its YES findings)`);
  }
  const frozen = generative?.prompts?.frozen ?? {};
  for (const kind of ["tactical", "three-d-game", "anime-npr"]) {
    if (typeof frozen[kind] !== "string" || frozen[kind]!.length < 100) {
      fail("reprep2-prompts", `${label}: the ${kind} frozen genre prompt must be carried (≥100 chars)`);
    }
  }
  if (!((generative?.sampling?.fps ?? 0) >= 1) || !((generative?.sampling?.sourceFrames ?? 0) >= 8)) {
    fail("reprep2-sampling", `${label}: the sampling facts (fps, frame count) must be recorded`);
  }
  if (!reprep2.provenance?.toolchain?.version) {
    fail("reprep2-toolchain", `${label}: the ffmpeg toolchain version must be measured`);
  }
}

async function checkReprep2Files(reprep2: Reprep2Record, dir: string): Promise<void> {
  for (const output of reprep2.outputs ?? []) {
    const path = join(dir, `${output.kind}.mp4`);
    if (!existsSync(path)) {
      fail("reprep2-file-present", `${output.kind}: ${path} absent`);
    }
    const bytes = new Uint8Array(await readFile(path));
    if (bytes.byteLength !== output.byteSize) {
      fail("reprep2-file-size", `${output.kind}: ${bytes.byteLength} != ${output.byteSize}`);
    }
    const reHashed = sha256OfBytes(bytes);
    if (reHashed !== output.sha256) {
      fail("reprep2-file-sha", `${output.kind}: ${reHashed.slice(0, 16)}… != ${output.sha256?.slice(0, 16)}…`);
    }
  }
}

// ---------------------------------------------------------------------------
// The TEMPORALLY-COHERENT RE-PREP record (visual-gate-reprep3.json — the
// temporal-consistency fix flight)
// ---------------------------------------------------------------------------
type Reprep3Output = {
  kind?: string;
  byteSize?: number;
  sha256?: string;
  integrityVerified?: boolean;
  containerMagic?: string;
  savedPath?: string;
};
type Reprep3Record = {
  kind?: string;
  context?: Record<string, string>;
  provenance?: {
    source?: { sha256?: string };
    propagation?: {
      citations?: string[];
      implementation?: string;
      designGate?: {
        flickerBefore?: Record<string, number>;
        flickerAfter?: Record<string, number>;
        ballCheck?: string;
        tacticalConsistency?: string;
        overallVerdict?: string;
      };
    };
    toolchain?: { version?: string };
  };
  outputs?: Reprep3Output[];
};

function checkReprep3(reprep3: Reprep3Record, label: string): void {
  if (reprep3.kind !== "r606-visual-gate-reprep3") {
    fail("reprep3-kind", `${label}: ${reprep3.kind}`);
  }
  if (
    !reprep3.context?.reReVerdict ||
    !reprep3.context.directive ||
    !reprep3.context.lane ||
    !reprep3.context.path
  ) {
    fail("reprep3-context", `${label}: the re-re-verdict + directive + lane + path must be carried`);
  }
  const outputs = reprep3.outputs;
  if (!Array.isArray(outputs) || outputs.length !== 4) {
    fail("reprep3-outputs", `${label}: ${outputs?.length ?? 0} outputs (expected 4)`);
  }
  const kinds = new Set(outputs.map((output) => output.kind));
  const expected = new Set(["original", "tactical", "three-d-game", "anime-npr"]);
  if (kinds.size !== 4 || [...kinds].some((kind) => !expected.has(kind ?? ""))) {
    fail("reprep3-kinds", `${label}: ${[...kinds].join(", ")}`);
  }
  for (const output of outputs) {
    if (output.integrityVerified !== true) {
      fail("reprep3-integrity", `${label}: ${output.kind} not integrity-verified`);
    }
    if (!/^[0-9a-f]{64}$/.test(output.sha256 ?? "")) {
      fail("reprep3-sha-shape", `${label}: ${output.kind} sha not 64-hex`);
    }
    if (!(output.byteSize! > 0)) {
      fail("reprep3-byte-size", `${label}: ${output.kind} ${output.byteSize}`);
    }
    if (output.containerMagic !== "ftyp") {
      fail("reprep3-magic", `${label}: ${output.kind} ${output.containerMagic}`);
    }
  }
  // the ORIGINAL: byte-identical to the researched source (hard check)
  const original = outputs.find((output) => output.kind === "original");
  if (original?.sha256 !== SOURCE_SHA_EXPECTED) {
    fail(
      "reprep3-original-source",
      `${label}: the original must be byte-identical to the researched source (${original?.sha256?.slice(0, 16)}…)`,
    );
  }
  if (reprep3.provenance?.source?.sha256 !== SOURCE_SHA_EXPECTED) {
    fail("reprep3-source-sha", `${label}: the provenance source sha must be the researched source's`);
  }
  const propagation = reprep3.provenance?.propagation;
  if (!Array.isArray(propagation?.citations) || propagation!.citations!.length < 3) {
    fail("reprep3-citations", `${label}: the copied-and-adapted reported-to-work sources must be cited (≥3)`);
  }
  if (typeof propagation?.implementation !== "string" || propagation.implementation.length < 100) {
    fail("reprep3-implementation", `${label}: the propagation implementation record must be carried`);
  }
  const designGate = propagation?.designGate;
  const before = designGate?.flickerBefore ?? {};
  const after = designGate?.flickerAfter ?? {};
  for (const kind of ["tactical", "three-d-game", "anime-npr"]) {
    if (!((before[kind] ?? 0) > 0) || !((after[kind] ?? 0) >= 0)) {
      fail("reprep3-flicker", `${label}: the ${kind} flicker before/after must both be carried`);
    }
    if (after[kind]! > before[kind]! / 2) {
      fail(
        "reprep3-flicker-improved",
        `${label}: the ${kind} flicker after (${after[kind]}) must be less than HALF the before (${before[kind]}) — the fix's own measured bar`,
      );
    }
  }
  if (!designGate?.ballCheck?.includes("MAX: 1")) {
    fail("reprep3-ball-check", `${label}: the strict VLM ball-count verdict must be carried (MAX: 1)`);
  }
  if (!designGate?.tacticalConsistency?.includes("CONSISTENT: yes")) {
    fail("reprep3-tactical-consistency", `${label}: the tactical consistency verdict must be carried (CONSISTENT: yes)`);
  }
  const overall = designGate?.overallVerdict ?? "";
  for (const marker of ["A) YES", "B) YES", "C) YES", "D) YES", "E) YES"]) {
    if (!overall.includes(marker)) {
      fail("reprep3-overall", `${label}: the five-question verdict must be carried (${marker} missing)`);
    }
  }
  if (!reprep3.provenance?.toolchain?.version) {
    fail("reprep3-toolchain", `${label}: the ffmpeg toolchain version must be measured`);
  }
}

async function checkReprep3Files(reprep3: Reprep3Record, dir: string): Promise<void> {
  for (const output of reprep3.outputs ?? []) {
    const path = join(dir, `${output.kind}.mp4`);
    if (!existsSync(path)) {
      fail("reprep3-file-present", `${output.kind}: ${path} absent`);
    }
    const bytes = new Uint8Array(await readFile(path));
    if (bytes.byteLength !== output.byteSize) {
      fail("reprep3-file-size", `${output.kind}: ${bytes.byteLength} != ${output.byteSize}`);
    }
    const reHashed = sha256OfBytes(bytes);
    if (reHashed !== output.sha256) {
      fail("reprep3-file-sha", `${output.kind}: ${reHashed.slice(0, 16)}… != ${output.sha256?.slice(0, 16)}…`);
    }
  }
}

if (battery) {
  // The negative battery: a tampered copy (one sha flipped to another VALID
  // hex char — the shape check alone cannot catch it; the re-hash
  // cross-check against the REAL files must) validated in a CHILD process
  // with the same --out — it MUST exit non-zero. The validator proves it
  // can fail; the real record is never touched. A SECOND battery: a
  // tampered VERDICT copy (criterion 1's FAIL flipped to PASS — a laundered
  // verdict is the worst lie this tree could hold) validated in a CHILD
  // process against the REAL prep record — it must ALSO exit non-zero.
  if (outDir === undefined) {
    console.error("FATAL: --battery requires --out (the file cross-check is the tamper's detection surface)");
    process.exit(1);
  }
  const record = await loadRecord(recordPath);
  checkRecord(record, "record");
  const realVerdict = await loadVerdictIfPresent(verdictPath);
  const realReVerdict = await loadVerdictIfPresent(reverdictPath);
  const realReReVerdict = await loadVerdictIfPresent(rereverdictPath);
  const realReReReVerdict = await loadVerdictIfPresent(rerereverdictPath);
  const scratch = await mkdtemp(join(tmpdir(), "r606-battery-"));
  try {
    const tampered: Record = JSON.parse(JSON.stringify(record));
    const sha = tampered.outputs[0]!.sha256;
    const flipped = sha.startsWith("0") ? `1${sha.slice(1)}` : `0${sha.slice(1)}`;
    tampered.outputs[0]!.sha256 = flipped;
    const tamperedPath = join(scratch, "tampered.json");
    await writeFile(tamperedPath, JSON.stringify(tampered), "utf8");
    const child = spawnSync(
      process.execPath,
      [join(here, "validate-evidence.ts"), "--record", tamperedPath, "--out", outDir],
      { encoding: "utf8", timeout: 30000 },
    );
    if (child.status === null || child.status === 0) {
      console.error(
        `REFUSED [battery]: the tampered record was ACCEPTED (child exit ${child.status}) — the validator is broken`,
      );
      process.exit(1);
    }
    console.log(
      "battery: the tampered record REFUSED (child exit 1) — the validator can fail",
    );
    if (realVerdict) {
      const launderedVerdict: VerdictRecord = JSON.parse(JSON.stringify(realVerdict));
      launderedVerdict.criteria!["same-match-event-identifiable-across-all-four"]!.verdict = "PASS";
      const launderedPath = join(scratch, "laundered-verdict.json");
      await writeFile(launderedPath, JSON.stringify(launderedVerdict), "utf8");
      const verdictChild = spawnSync(
        process.execPath,
        [
          join(here, "validate-evidence.ts"),
          "--record",
          recordPath,
          "--out",
          outDir,
          "--verdict",
          launderedPath,
        ],
        { encoding: "utf8", timeout: 30000 },
      );
      if (verdictChild.status === null || verdictChild.status === 0) {
        console.error(
          `REFUSED [battery-verdict]: the LAUNDERED verdict (FAIL flipped to PASS) was ACCEPTED (child exit ${verdictChild.status}) — the validator is broken`,
        );
        process.exit(1);
      }
      console.log(
        "battery: the LAUNDERED verdict REFUSED (child exit 1) — a flipped FAIL can never pass",
      );
    }
    if (realReVerdict) {
      const launderedReVerdict: VerdictRecord = JSON.parse(JSON.stringify(realReVerdict));
      launderedReVerdict.criteria!["meaningful-stylistic-differences"]!.verdict = "PASS";
      const launderedRePath = join(scratch, "laundered-reverdict.json");
      await writeFile(launderedRePath, JSON.stringify(launderedReVerdict), "utf8");
      const reVerdictChild = spawnSync(
        process.execPath,
        [
          join(here, "validate-evidence.ts"),
          "--record",
          recordPath,
          "--out",
          outDir,
          "--reverdict",
          launderedRePath,
        ],
        { encoding: "utf8", timeout: 30000 },
      );
      if (reVerdictChild.status === null || reVerdictChild.status === 0) {
        console.error(
          `REFUSED [battery-reverdict]: the LAUNDERED re-verdict (criterion 2's FAIL flipped to PASS — the style-fidelity failure laundered into a pass) was ACCEPTED (child exit ${reVerdictChild.status}) — the validator is broken`,
        );
        process.exit(1);
      }
      console.log(
        "battery: the LAUNDERED re-verdict REFUSED (child exit 1) — a flipped style-fidelity FAIL can never pass",
      );
    }
    if (realReReVerdict) {
      const launderedReReVerdict: VerdictRecord = JSON.parse(JSON.stringify(realReReVerdict));
      launderedReReVerdict.criteria!["meaningful-stylistic-differences"]!.verdict = "PASS";
      const launderedReRePath = join(scratch, "laundered-rereverdict.json");
      await writeFile(launderedReRePath, JSON.stringify(launderedReReVerdict), "utf8");
      const reReVerdictChild = spawnSync(
        process.execPath,
        [
          join(here, "validate-evidence.ts"),
          "--record",
          recordPath,
          "--out",
          outDir,
          "--rereverdict",
          launderedReRePath,
        ],
        { encoding: "utf8", timeout: 30000 },
      );
      if (reReVerdictChild.status === null || reReVerdictChild.status === 0) {
        console.error(
          `REFUSED [battery-rereverdict]: the LAUNDERED re-re-verdict (criterion 2's temporal-consistency FAIL flipped to PASS — the flicker/duplication failure laundered into a pass) was ACCEPTED (child exit ${reReVerdictChild.status}) — the validator is broken`,
        );
        process.exit(1);
      }
      console.log(
        "battery: the LAUNDERED re-re-verdict REFUSED (child exit 1) — a flipped temporal-consistency FAIL can never pass",
      );
    }
    if (realReReReVerdict) {
      const launderedReReReVerdict: VerdictRecord = JSON.parse(JSON.stringify(realReReReVerdict));
      launderedReReReVerdict.criteria!["meaningful-stylistic-differences"]!.verdict = "PASS";
      const launderedReReRePath = join(scratch, "laundered-rerereverdict.json");
      await writeFile(launderedReReRePath, JSON.stringify(launderedReReReVerdict), "utf8");
      const reReReVerdictChild = spawnSync(
        process.execPath,
        [
          join(here, "validate-evidence.ts"),
          "--record",
          recordPath,
          "--out",
          outDir,
          "--rerereverdict",
          launderedReReRePath,
        ],
        { encoding: "utf8", timeout: 30000 },
      );
      if (reReReVerdictChild.status === null || reReReVerdictChild.status === 0) {
        console.error(
          `REFUSED [battery-rerereverdict]: the LAUNDERED re-re-re-verdict (criterion 2's genre-composition/clarity/ball-trajectory FAIL flipped to PASS) was ACCEPTED (child exit ${reReReVerdictChild.status}) — the validator is broken`,
        );
        process.exit(1);
      }
      console.log(
        "battery: the LAUNDERED re-re-re-verdict REFUSED (child exit 1) — a flipped genre-composition/clarity/trajectory FAIL can never pass",
      );
    }
    if (existsSync(reprep2Path) && reprep2OutArg !== undefined) {
      const realReprep2 = JSON.parse(await readFile(reprep2Path, "utf8")) as Reprep2Record;
      const tamperedReprep2: Reprep2Record = JSON.parse(JSON.stringify(realReprep2));
      const sha = tamperedReprep2.outputs?.[1]?.sha256 ?? "";
      tamperedReprep2.outputs![1]!.sha256 = sha.startsWith("0") ? `1${sha.slice(1)}` : `0${sha.slice(1)}`;
      const tamperedReprep2Path = join(scratch, "tampered-reprep2.json");
      await writeFile(tamperedReprep2Path, JSON.stringify(tamperedReprep2), "utf8");
      const reprep2Child = spawnSync(
        process.execPath,
        [
          join(here, "validate-evidence.ts"),
          "--record",
          recordPath,
          "--out",
          outDir,
          "--reprep2",
          tamperedReprep2Path,
          "--reprep2-out",
          reprep2OutArg,
        ],
        { encoding: "utf8", timeout: 30000 },
      );
      if (reprep2Child.status === null || reprep2Child.status === 0) {
        console.error(
          `REFUSED [battery-reprep2]: the tampered GENERATIVE re-prep record was ACCEPTED (child exit ${reprep2Child.status}) — the validator is broken`,
        );
        process.exit(1);
      }
      console.log(
        "battery: the tampered GENERATIVE re-prep record REFUSED (child exit 1) — the re-hash cross-check catches it",
      );
    }
    if (existsSync(reprep3Path) && reprep3OutArg !== undefined) {
      const realReprep3 = JSON.parse(await readFile(reprep3Path, "utf8")) as Reprep3Record;
      const tamperedReprep3: Reprep3Record = JSON.parse(JSON.stringify(realReprep3));
      const gate = tamperedReprep3.provenance?.propagation?.designGate;
      if (gate?.flickerAfter && gate.flickerAfter.tactical !== undefined) {
        // the laundering: the after-flicker inflated ABOVE half the before — a
        // failed fix dressed as a passing one
        gate.flickerAfter.tactical = (gate.flickerBefore?.tactical ?? 34.03) + 1;
      }
      const tamperedReprep3Path = join(scratch, "tampered-reprep3.json");
      await writeFile(tamperedReprep3Path, JSON.stringify(tamperedReprep3), "utf8");
      const reprep3Child = spawnSync(
        process.execPath,
        [
          join(here, "validate-evidence.ts"),
          "--record",
          recordPath,
          "--out",
          outDir,
          "--reprep3",
          tamperedReprep3Path,
          "--reprep3-out",
          reprep3OutArg,
        ],
        { encoding: "utf8", timeout: 30000 },
      );
      if (reprep3Child.status === null || reprep3Child.status === 0) {
        console.error(
          `REFUSED [battery-reprep3]: the LAUNDERED temporal-coherence record (the after-flicker inflated above half the before — a failed fix dressed as passing) was ACCEPTED (child exit ${reprep3Child.status}) — the validator is broken`,
        );
        process.exit(1);
      }
      console.log(
        "battery: the LAUNDERED temporal-coherence record REFUSED (child exit 1) — a failed fix can never pass as passing",
      );
    }
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
} else {
  const record = await loadRecord(recordPath);
  checkRecord(record, "record");
  const verdict = await loadVerdictIfPresent(verdictPath);
  if (verdict) checkVerdict(verdict, "verdict");
  const reverdict = await loadVerdictIfPresent(reverdictPath);
  if (reverdict) checkVerdictReprep(reverdict, "reverdict");
  const rereverdict = await loadVerdictIfPresent(rereverdictPath);
  if (rereverdict) checkVerdictReprep2(rereverdict, "rereverdict");
  const rerereverdict = await loadVerdictIfPresent(rerereverdictPath);
  if (rerereverdict) checkVerdictReprep3(rerereverdict, "rerereverdict");
  let reprep2Note = "";
  if (existsSync(reprep2Path)) {
    let reprep2: Reprep2Record;
    try {
      reprep2 = JSON.parse(await readFile(reprep2Path, "utf8")) as Reprep2Record;
    } catch (error) {
      fail("reprep2-parse", String(error));
    }
    checkReprep2(reprep2, "reprep2");
    if (reprep2OutArg !== undefined) {
      await checkReprep2Files(reprep2, reprep2OutArg);
      reprep2Note = " + the GENERATIVE re-prep's shape + its 4 exported files re-hashed";
    } else {
      reprep2Note = " + the GENERATIVE re-prep's shape (no --reprep2-out given — its files not re-checked)";
    }
  }
  let reprep3Note = "";
  if (existsSync(reprep3Path)) {
    let reprep3: Reprep3Record;
    try {
      reprep3 = JSON.parse(await readFile(reprep3Path, "utf8")) as Reprep3Record;
    } catch (error) {
      fail("reprep3-parse", String(error));
    }
    checkReprep3(reprep3, "reprep3");
    if (reprep3OutArg !== undefined) {
      await checkReprep3Files(reprep3, reprep3OutArg);
      reprep3Note = " + the TEMPORALLY-COHERENT re-prep's shape + its 4 exported files re-hashed";
    } else {
      reprep3Note = " + the TEMPORALLY-COHERENT re-prep's shape (no --reprep3-out given — its files not re-checked)";
    }
  }
  let reprepNote = "";
  if (existsSync(reprepPath)) {
    let reprep: ReprepRecord;
    try {
      reprep = JSON.parse(await readFile(reprepPath, "utf8")) as ReprepRecord;
    } catch (error) {
      fail("reprep-parse", String(error));
    }
    checkReprep(reprep, "reprep");
    if (reprepOutArg !== undefined) {
      await checkReprepFiles(reprep, reprepOutArg);
      reprepNote = " + the re-prep's shape + its 4 exported files re-hashed";
    } else {
      reprepNote = " + the re-prep's shape (no --reprep-out given — its files not re-checked)";
    }
  }
  if (outDir !== undefined) {
    await checkFiles(record, outDir);
    console.log(
      `PASS: the record's shape + the 4 exported files re-hashed and re-measured (${outDir})${verdict ? " + the verdict record's shape" : ""}${reverdict ? " + the re-verdict record's shape" : ""}${rereverdict ? " + the re-re-verdict record's shape" : ""}${rerereverdict ? " + the re-re-re-verdict record's shape" : ""}${reprepNote}${reprep2Note}${reprep3Note}`,
    );
  } else {
    console.log(
      `PASS: the record's shape (no --out given — the files not re-checked)${verdict ? " + the verdict record's shape" : ""}${reverdict ? " + the re-verdict record's shape" : ""}${rereverdict ? " + the re-re-verdict record's shape" : ""}${rerereverdict ? " + the re-re-re-verdict record's shape" : ""}${reprepNote}${reprep2Note}${reprep3Note}`,
    );
  }
}
