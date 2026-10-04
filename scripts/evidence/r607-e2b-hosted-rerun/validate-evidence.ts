/**
 * R607 65-j — the E2B HOSTED RE-RUN EVIDENCE VALIDATOR (DEVELOPMENT-TIME
 * FAIL-CLOSED GATE, not a test): machine-checks this evidence pack's honest
 * claims against the recorded artifacts — never against claims about what
 * the files "should" say.
 *
 * Checks (each REFUSES exit 1 with the failing check named):
 *   1. sandbox-record.json — the sandbox identity (id shape, the pinned sha
 *      = the sha the orchestration pins), the PUBLIC worker health 200 +
 *      ok, the live descriptor's resolved toolchain, the boot log's RESOLVED
 *      line, the >= 1h keep-alive, the companion compute worker's health;
 *   2. golden-path-seam.json — THE ADMISSION-PASS PROOF: uploadState
 *      "stored" + checksumVerified + the worker job's "succeeded" status,
 *      AND the ledger cross-check (the admission's workerJobId must appear
 *      in the usage drain + the worker's own stats must match the record's
 *      accounting block) — a FABRICATED admission-PASS without the executed
 *      run is refused here;
 *      the hash chain (source → asset → manifest → artifact → stored
 *      bytes, all full 64-hex), playability, the accounting identities;
 *   3. worker-stats.json — the /v1/media/stats read equals the golden-path
 *      record's accounting.stats (two independent reads agreeing);
 *   4. determinism.json — the two runs' artifact shas identical AND equal
 *      to the committed record's artifact sha;
 *   5. deploy-record.json — the HONEST REFUSAL shape: deploymentId null,
 *      every attempt typed REFUSED, the measured production-down state
 *      (health 500 + signup 500), the env patches 200 + the URL wiring
 *      consistency (MEDIA_TOOLCHAIN_URL == the sandbox record's worker URL);
 *      a laundered/fabricated deployment id is refused;
 *   6. hosted-golden-path.json — the honest blocked state + the honest
 *      seam-level-PASS cross-reference;
 *   7. THE TOKEN SCAN — no `e2b_`/`vcp_` token-shaped string anywhere in
 *      the evidence tree (the real key shapes: 20+ chars after the prefix;
 *      the documented prefix MENTIONS in the discipline notes are not
 *      token-shaped and do not trip the scan; .sh scripts are scanned too
 *      — the negative tests build their fake token at runtime, so the
 *      committed sources stay clean).
 *
 * Run (from the REPO ROOT):
 *   bun run scripts/evidence/r607-e2b-hosted-rerun/validate-evidence.ts
 *   # against a (negative-test) variant tree:
 *   bun run scripts/evidence/r607-e2b-hosted-rerun/validate-evidence.ts --dir /tmp/<variant>
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const argv = process.argv.slice(2);
function argValue(flag: string): string | undefined {
  const at = argv.indexOf(flag);
  return at === -1 ? undefined : argv[at + 1];
}
const dir = argValue("--dir") ?? resolve(import.meta.dirname, ".");

/** The pinned sha the orchestration checks out in-sandbox (must match both records). */
const PINNED_SHA = "300c035b4cf0a0e89a4a08c465d9d0104a9b3efd";

const failures: string[] = [];
function requireCheck(name: string, ok: boolean, detail?: string): void {
  if (!ok) failures.push(detail === undefined ? name : `${name} (${detail})`);
}

function readJson(name: string): Record<string, unknown> {
  const path = join(dir, name);
  requireCheck(`${name} exists`, statSync(path, { throwIfNoEntry: false }) !== undefined);
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

const HEX64 = /^[0-9a-f]{64}$/;

// --- 1. the sandbox record -------------------------------------------------
const sandbox = readJson("sandbox-record.json");
const sandboxId = String(
  ((sandbox["provider"] as Record<string, unknown>)?.["sandbox"] as Record<string, unknown>)?.[
    "sandboxId"
  ] ?? "",
);
requireCheck("sandbox-record: sandboxId shape", /^[a-z0-9]{15,}$/.test(sandboxId), sandboxId);
const pinned = String(
  ((sandbox["provider"] as Record<string, unknown>)?.["pinnedRevision"] as Record<string, unknown>)
    ?.["sha"] ?? "",
);
requireCheck("sandbox-record: the pinned sha", pinned === PINNED_SHA, pinned);
const worker = sandbox["worker"] as Record<string, unknown> | undefined;
requireCheck("sandbox-record: worker present", worker !== undefined);
if (worker !== undefined) {
  const health = worker["health"] as Record<string, unknown>;
  requireCheck(
    "sandbox-record: worker health 200 + ok",
    health["httpStatusCode"] === 200 && health["body"] !== undefined &&
      ((health["body"] as Record<string, unknown>)["ok"] === true),
  );
  const descriptor = worker["descriptor"] as Record<string, unknown>;
  const toolchain = (descriptor["body"] as Record<string, unknown>)["toolchain"] as Record<
    string,
    unknown
  >;
  requireCheck(
    "sandbox-record: the live descriptor's toolchain resolved",
    toolchain["resolved"] === true,
    String(toolchain["resolved"]),
  );
  const bootLog = (worker["bootLog"] as string[]) ?? [];
  requireCheck(
    "sandbox-record: the boot log's RESOLVED line",
    bootLog.some((l) => l.includes("toolchain: RESOLVED")),
  );
  const keepAlive = Number(
    ((sandbox["provider"] as Record<string, unknown>)["sandbox"] as Record<string, unknown>)[
      "keepAliveMs"
    ],
  );
  requireCheck("sandbox-record: keep-alive >= 1h", keepAlive >= 3_600_000, String(keepAlive));
  const workerUrl = String(worker["publicUrl"]);
  requireCheck(
    "sandbox-record: the public URL is the sandbox's",
    workerUrl === `https://3971-${sandboxId}.e2b.app`,
    workerUrl,
  );
  const companion = sandbox["computeWorkerCompanion"] as Record<string, unknown> | undefined;
  requireCheck("sandbox-record: the companion compute worker recorded", companion !== undefined);
  if (companion !== undefined) {
    requireCheck(
      "sandbox-record: companion health 200",
      (companion["health"] as Record<string, unknown>)["httpStatusCode"] === 200,
    );
  }
}

// --- 2. the seam golden path (THE ADMISSION-PASS PROOF) --------------------
const golden = readJson("golden-path-seam.json");
requireCheck(
  "golden-path-seam: kind",
  golden["kind"] === "r607-e2b-hosted-rerun-golden-path",
  String(golden["kind"]),
);
requireCheck(
  "golden-path-seam: mode (the public wire)",
  golden["mode"] === "e2b-external-worker-public-wire",
  String(golden["mode"]),
);
requireCheck(
  "golden-path-seam: the worker URL is the sandbox's",
  String(golden["workerUrl"]) === `https://3971-${sandboxId}.e2b.app`,
  String(golden["workerUrl"]),
);
const identity = golden["workerIdentity"] as Record<string, unknown>;
requireCheck(
  "golden-path-seam: the worker runs the pinned sha",
  identity["pinnedSha"] === PINNED_SHA,
  String(identity["pinnedSha"]),
);
requireCheck(
  "golden-path-seam: the client-honesty field present",
  typeof identity["clientHonesty"] === "string" && String(identity["clientHonesty"]).length > 20,
);
const stages = golden["stages"] as Record<string, unknown>;
const admission = stages["admission"] as Record<string, unknown>;
requireCheck(
  "golden-path-seam: THE ADMISSION PASSED (uploadState stored)",
  admission["uploadState"] === "stored",
  String(admission["uploadState"]),
);
requireCheck(
  "golden-path-seam: the admission checksum verified",
  admission["checksumVerified"] === true,
);
const workerJob = admission["workerJob"] as Record<string, unknown>;
requireCheck(
  "golden-path-seam: the worker job's status succeeded",
  ((workerJob["result"] as Record<string, unknown>)["status"] === "succeeded") ||
    ((workerJob["result"] as Record<string, unknown>)["status"] === undefined &&
      workerJob["state"] === "succeeded"),
  String((workerJob["result"] as Record<string, unknown>)["status"] ?? workerJob["state"]),
);
const admissionJobId = String(admission["workerJobId"]);
const accounting = golden["accounting"] as Record<string, unknown>;
const usageRecords = (accounting["usageRecords"] as Record<string, unknown>[]) ?? [];
requireCheck(
  "golden-path-seam: THE LEDGER CROSS-CHECK (the admission job is in the usage drain — a fabricated PASS without the executed run is refused)",
  usageRecords.some((u) => String(u["jobId"]) === admissionJobId),
  admissionJobId,
);
const chain = golden["hashChain"] as Record<string, unknown>;
const artifact = golden["artifact"] as Record<string, unknown>;
const manifest = golden["manifest"] as Record<string, unknown>;
const source = golden["source"] as Record<string, unknown>;
requireCheck(
  "golden-path-seam: source sha is full 64-hex",
  HEX64.test(String(source["sha256"])),
  String(source["sha256"]),
);
requireCheck(
  "golden-path-seam: hash chain source→asset",
  source["sha256"] === chain["sourceHashMeasured"] &&
    source["sha256"] === chain["assetContentHash"],
);
requireCheck(
  "golden-path-seam: hash chain manifest→artifact→stored",
  manifest["contentHash"] === chain["manifestContentHash"] &&
    artifact["contentHash"] === chain["artifactContentHash"] &&
    artifact["contentHash"] === chain["storedBytesHashMeasured"] &&
    HEX64.test(String(artifact["contentHash"])),
);
requireCheck(
  "golden-path-seam: the artifact byte size agrees",
  artifact["byteSize"] === chain["storedByteSize"] && Number(artifact["byteSize"]) > 0,
);
const playability = golden["playability"] as Record<string, unknown>;
requireCheck(
  "golden-path-seam: the artifact is playable (moov before mdat)",
  playability["playable"] === true && playability["moovBeforeMdat"] === true,
);
const stats = accounting["stats"] as Record<string, unknown>;
requireCheck(
  "golden-path-seam: the accounting identities",
  stats["jobsDispatched"] ===
    (stats["succeeded"] as number) + (stats["failed"] as number) + (stats["inFlight"] as number) &&
    stats["usageRecords"] === (stats["succeeded"] as number) + (stats["failed"] as number),
);
requireCheck(
  "golden-path-seam: the usage drain count agrees",
  usageRecords.length === Number(accounting["usageDrainCount"]) &&
    usageRecords.length === Number(stats["usageRecords"]),
);
requireCheck(
  "golden-path-seam: the honest boundary record present",
  typeof golden["boundaryRecord"] === "object" && golden["boundaryRecord"] !== null,
);

// --- 3. the worker's own stats read ----------------------------------------
const workerStats = readJson("worker-stats.json");
for (const key of [
  "jobsDispatched",
  "succeeded",
  "failed",
  "inFlight",
  "usageRecords",
  "probeRuns",
  "transcodeRuns",
  "inputBytes",
  "outputBytes",
  "totalExecutionMs",
]) {
  requireCheck(
    `worker-stats: ${key} equals the golden-path accounting read`,
    JSON.stringify(workerStats[key]) === JSON.stringify(stats[key]),
    `${String(workerStats[key])} vs ${String(stats[key])}`,
  );
}

// --- 4. the determinism record ----------------------------------------------
const determinism = readJson("determinism.json");
const detVerdict = determinism["verdict"] as Record<string, unknown>;
requireCheck(
  "determinism: the two runs are byte-identical",
  detVerdict["sourceByteIdentical"] === true && detVerdict["artifactByteIdentical"] === true,
);
const detRuns = determinism["runs"] as Record<string, Record<string, unknown>>;
requireCheck(
  "determinism: run shas agree across runs",
  detRuns["run1"]?.["artifactSha256"] === detRuns["run2"]?.["artifactSha256"] &&
    HEX64.test(String(detRuns["run1"]?.["artifactSha256"])),
);
requireCheck(
  "determinism: the runs' artifact sha IS the committed record's",
  detRuns["run2"]?.["artifactSha256"] === artifact["contentHash"],
);

// --- 5. the deploy record (the honest refusal shape) ------------------------
const deploy = readJson("deploy-record.json");
const deployOutcome = deploy["deployOutcome"] as Record<string, unknown>;
requireCheck(
  "deploy-record: NO fabricated deployment id (the honest null)",
  deployOutcome["deploymentId"] === null,
  String(deployOutcome["deploymentId"]),
);
const attempts = (deploy["deployAttempts"] as Record<string, unknown>[]) ?? [];
requireCheck(
  "deploy-record: every deploy attempt is the typed refusal",
  attempts.length >= 2 &&
    attempts.every(
      (a) => String(a["result"]).startsWith("REFUSED") && typeof a["errorCode"] === "string",
    ),
);
const currentProd = deploy["currentProductionStateMeasured"] as Record<string, unknown>;
requireCheck(
  "deploy-record: the measured production-down state",
  (currentProd["apiPlatformHealth"] as Record<string, unknown>)["httpStatusCode"] === 500 &&
  (currentProd["signupAttempt"] as Record<string, unknown>)["httpStatusCode"] === 500,
);
const patches = ((deploy["envWiring"] as Record<string, unknown>)["patches"] as Record<
  string,
  unknown
>[]) ?? [];
requireCheck(
  "deploy-record: all env patches answered 200",
  patches.length === 5 && patches.every((p) => p["httpStatusCode"] === 200),
);
const mediaUrlPatch = patches.find((p) => p["name"] === "MEDIA_TOOLCHAIN_URL");
requireCheck(
  "deploy-record: the env wiring points at THIS sandbox's worker",
  mediaUrlPatch !== undefined &&
    mediaUrlPatch["value"] === `https://3971-${sandboxId}.e2b.app`,
  String(mediaUrlPatch?.["value"]),
);

// --- 6. the hosted golden path (the honest blocked state) --------------------
const hosted = readJson("hosted-golden-path.json");
requireCheck(
  "hosted-golden-path: the honest blocked state",
  hosted["state"] === "blocked-deploy-quota-refused",
  String(hosted["state"]),
);
const seamPass = (
  (hosted["whatThisFlightDidExecute"] as Record<string, unknown>)[
    "seamLevelAdmissionPass"
  ] as Record<string, unknown>
);
requireCheck(
  "hosted-golden-path: the seam-level PASS cross-references the real record",
  seamPass["record"] === "golden-path-seam.json" && String(seamPass["verdict"]).startsWith("PASS"),
);

// --- 7. THE TOKEN SCAN -------------------------------------------------------
const tokenShape = /(e2b_|vcp_)[A-Za-z0-9-]{20,}/;
const scanned: string[] = [];
function walk(path: string): void {
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) {
      walk(child);
    } else if (/\.(json|md|ts|log|txt|sh)$/.test(entry.name)) {
      const text = readFileSync(child, "utf8");
      const match = tokenShape.exec(text);
      if (match !== null) {
        requireCheck(
          `token scan: ${child} carries a token-shaped string`,
          false,
          `${match[0].slice(0, 8)}…`,
        );
      }
      scanned.push(child);
    }
  }
}
walk(dir);
requireCheck("token scan: scanned files exist", scanned.length >= 8, String(scanned.length));

// --- the verdict --------------------------------------------------------------
if (failures.length > 0) {
  console.error("=== R607 E2B HOSTED RE-RUN EVIDENCE: REFUSED ===");
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exit(1);
}
console.log("=== R607 E2B HOSTED RE-RUN EVIDENCE: OK (fail-closed) ===");
console.log(`  sandbox:            ${sandboxId} (pinned ${pinned.slice(0, 12)}…)`);
console.log(`  worker:             https://3971-${sandboxId}.e2b.app (health 200, toolchain resolved)`);
console.log(`  admission (seam):   PASS — uploadState 'stored', ledger cross-checked (${admissionJobId})`);
console.log(`  artifact:           ${String(artifact["contentHash"]).slice(0, 16)}… (${String(artifact["byteSize"])} B, chain 7/7, playable)`);
console.log(`  determinism:        run1 == run2 (byte-identical within the provider)`);
console.log(`  deploy:             REFUSED (typed quota) — deploymentId honestly null; production measured DOWN (the dead 62-c URL)`);
console.log(`  hosted golden path: blocked-deploy-quota-refused (honest)`);
console.log(`  token scan:         clean (${scanned.length} files scanned)`);
