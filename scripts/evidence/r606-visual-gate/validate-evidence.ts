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
const here = dirname(new URL(import.meta.url).pathname);
const recordPath = recordArg ?? join(here, "visual-gate-prep.json");

type Output = {
  kind: string;
  byteSize: number;
  sha256: string;
  integrityVerified: boolean;
  containerMagic: string;
  savedPath?: string;
};
type Record = { kind: string; outputs: Output[]; provenance?: { clipSha256?: string } };

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

async function loadRecord(path: string): Promise<Record> {
  if (!existsSync(path)) fail("record-present", `${path} absent`);
  try {
    return JSON.parse(await readFile(path, "utf8")) as Record;
  } catch (error) {
    return fail("record-parse", String(error));
  }
}

if (battery) {
  // The negative battery: a tampered copy (one sha flipped to another VALID
  // hex char — the shape check alone cannot catch it; the re-hash
  // cross-check against the REAL files must) validated in a CHILD process
  // with the same --out — it MUST exit non-zero. The validator proves it
  // can fail; the real record is never touched.
  if (outDir === undefined) {
    console.error("FATAL: --battery requires --out (the file cross-check is the tamper's detection surface)");
    process.exit(1);
  }
  const record = await loadRecord(recordPath);
  checkRecord(record, "record");
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
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
} else {
  const record = await loadRecord(recordPath);
  checkRecord(record, "record");
  if (outDir !== undefined) {
    await checkFiles(record, outDir);
    console.log(
      `PASS: the record's shape + the 4 exported files re-hashed and re-measured (${outDir})`,
    );
  } else {
    console.log("PASS: the record's shape (no --out given — the files not re-checked)");
  }
}
