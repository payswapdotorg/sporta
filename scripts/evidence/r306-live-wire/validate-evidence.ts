/**
 * R306 LIVE PUBLIC-WIRE LEG — THE EVIDENCE VALIDATOR (DEVELOPMENT-TIME
 * FAIL-CLOSED GATE, not a test): machine-checks this evidence pack's honest
 * claims against the recorded artifacts — never against claims about what
 * the files "should" say. A laundered record is refused.
 *
 * Checks (each REFUSES exit 1 with the failing check named):
 *   1. sandbox-record.json — the sandbox identity, the pinned sha = the
 *      R306 ENCODE-SEAM MERGE (the constant below — the orchestration fails
 *      closed on any other HEAD), the FIVE advertised operations
 *      [probe, normalize, decode-probe, decode-frames, encode-frames] (the
 *      encode seam's profile), the public health 200, the boot log's
 *      RESOLVED line, the >= 1h keep-alive;
 *   2. encode-seam-live.json — the live encode-seam proof: the same pinned
 *      sha, the five operations, the pair's cached-probe signature (the
 *      first probe pays the public wire; the subsequent probes spawn no
 *      child), the R306 FrameEncoderPort encode (byteSize > 0, the 64-hex
 *      contentHash, the ftyp magic, the CLIENT-SIDE re-measure verified,
 *      the PRODUCER's identity), the R301 TacticalVideoCodec encode, THE
 *      BYTE-DRIFT LAW (the receiving-boundary re-hash MUST hold; the
 *      local-vs-wire verdict must be CONSISTENT with its own recorded
 *      hashes — either outcome is honest, a laundered one is refused), the
 *      ONE-OPERATION accounting (the stage deltas + the ledger identities +
 *      the usage drain === dispatched), the TYPED REFUSALS (the worker-side
 *      duration-over-limit through the real pair; the unreachable →
 *      encoder-unavailable; the dead-sandbox 502 ephemerality passthrough;
 *      the live worker's honest 404/400 non-2xx envelopes);
 *   3. worker-stats.json — the final public stats snapshot, cross-checked
 *      against the live record's own final accounting;
 *   4. THE TOKEN SCAN — no `e2b_`/`vcp_` token-shaped string anywhere in
 *      the evidence tree (the documented prefix MENTIONS in the discipline
 *      notes are not token-shaped and do not trip the scan).
 *
 * Run (from the REPO ROOT):
 *   bun run scripts/evidence/r306-live-wire/validate-evidence.ts
 *   # against a (negative-test) variant tree:
 *   bun run scripts/evidence/r306-live-wire/validate-evidence.ts --dir /tmp/<variant>
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
const PINNED_SHA = "dc2ed8fc9c7b9c91253a80378e31006965cc1e9a";
const EXPECTED_OPS = ["decode-frames", "decode-probe", "encode-frames", "normalize", "probe"];

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
const provider = (sandbox["provider"] ?? {}) as Record<string, unknown>;
const sandboxInfo = (provider["sandbox"] ?? {}) as Record<string, unknown>;
const pinnedRevision = (provider["pinnedRevision"] ?? {}) as Record<string, unknown>;
const sandboxId = String(sandboxInfo["sandboxId"] ?? "");
requireCheck("sandbox-record: sandboxId shape", /^[a-z0-9]{15,}$/.test(sandboxId), sandboxId);
requireCheck(
  "sandbox-record: the pinned sha is the R306 encode-seam merge",
  String(pinnedRevision["sha"] ?? "") === PINNED_SHA,
  String(pinnedRevision["sha"] ?? ""),
);
requireCheck("sandbox-record: keep-alive >= 1h", Number(sandboxInfo["keepAliveMs"] ?? 0) >= 3_600_000);
const worker = (sandbox["worker"] ?? {}) as Record<string, unknown>;
const workerHealth = (worker["health"] ?? {}) as Record<string, unknown>;
requireCheck(
  "sandbox-record: the media worker's public health 200",
  Number(workerHealth["httpStatusCode"] ?? 0) === 200,
);
const workerDescriptor = (worker["descriptor"] ?? {}) as Record<string, unknown>;
requireCheck(
  "sandbox-record: the descriptor advertises the encode seam's FIVE operations",
  JSON.stringify(workerDescriptor["operationsAdvertised"] ?? []) === JSON.stringify(EXPECTED_OPS),
  JSON.stringify(workerDescriptor["operationsAdvertised"] ?? []),
);
const bootLog = ((worker["bootLog"] ?? []) as string[]).join("\n");
requireCheck("sandbox-record: the boot log's RESOLVED toolchain line", bootLog.includes("RESOLVED"));
const mediaPublicUrl = String(worker["publicUrl"] ?? "");
requireCheck("sandbox-record: the public URL present", mediaPublicUrl.startsWith("https://"));

// --- 2. the live encode-seam record ---------------------------------------
const live = readJson("encode-seam-live.json");
const liveIdentity = (live["workerIdentity"] ?? {}) as Record<string, unknown>;
requireCheck(
  "encode-seam-live: the same pinned sha",
  String(liveIdentity["pinnedSha"] ?? "") === PINNED_SHA,
  String(liveIdentity["pinnedSha"] ?? ""),
);
requireCheck(
  "encode-seam-live: the worker identity agrees with the sandbox record",
  String(liveIdentity["sandboxId"] ?? "") === sandboxId,
  `${String(liveIdentity["sandboxId"] ?? "")} vs ${sandboxId}`,
);
const liveDescriptor = (live["descriptor"] ?? {}) as Record<string, unknown>;
requireCheck(
  "encode-seam-live: the five operations verified",
  JSON.stringify(liveDescriptor["operationsAdvertised"] ?? []) === JSON.stringify(EXPECTED_OPS),
);
const liveToolchain = (liveDescriptor["toolchain"] ?? {}) as Record<string, unknown>;
requireCheck("encode-seam-live: the worker's toolchain resolved", liveToolchain["resolved"] === true);

const stages = (live["stages"] ?? {}) as Record<string, Record<string, unknown>>;
const pairProbe = stages["pairProbe"] ?? {};
const subsequentWalls = ((pairProbe["subsequentProbeWallsMs"] ?? []) as number[]).map((w) => Number(w));
requireCheck(
  "encode-seam-live: the cached probe serves both surfaces (the subsequent probes spawn no child)",
  subsequentWalls.length === 3 && subsequentWalls.every((w) => w < 25) && Number(pairProbe["firstProbeWallMs"] ?? 0) > Math.max(0, ...subsequentWalls),
  `first=${String(pairProbe["firstProbeWallMs"])} subsequent=[${subsequentWalls.join(", ")}]`,
);
requireCheck("encode-seam-live: the pair is available", pairProbe["available"] === true);

const frameStage = stages["frameEncoder"] ?? {};
requireCheck(
  "encode-seam-live: the R306 encode delivered bytes",
  Number(frameStage["byteSize"] ?? 0) > 0 && HEX64.test(String(frameStage["contentHash"] ?? "")),
  `${String(frameStage["byteSize"])} / ${String(frameStage["contentHash"])}`,
);
requireCheck("encode-seam-live: the MP4 ftyp magic", frameStage["ftyp"] === true);
const reMeasured = (frameStage["reMeasured"] ?? {}) as Record<string, unknown>;
requireCheck(
  "encode-seam-live: the CLIENT-SIDE re-measure verified (the receiving-boundary law)",
  reMeasured["hashVerified"] === true && reMeasured["byteLengthVerified"] === true,
);
requireCheck(
  "encode-seam-live: the PRODUCER's identity rides the result",
  frameStage["encoderKind"] === "ffmpeg-libx264",
);
requireCheck(
  "encode-seam-live: the geometry claims match the dispatched spec (16x16 @ 12.5, 2 frames)",
  frameStage["frameCount"] === 2 && frameStage["geometry"] === "16x16 @ 12.5fps rgb24",
);
const frameDelta = ((frameStage["accounting"] ?? {}) as Record<string, unknown>)["delta"] as
  | Record<string, number>
  | undefined;
requireCheck(
  "encode-seam-live: the frameEncoder stage's accounting delta (+1/+1/+0)",
  frameDelta?.dispatched === 1 && frameDelta?.succeeded === 1 && frameDelta?.failed === 0,
);

const codecStage = stages["tacticalCodec"] ?? {};
requireCheck(
  "encode-seam-live: the R301 tactical codec delivered bytes",
  Number(codecStage["byteLength"] ?? 0) > 0 && codecStage["ftyp"] === true,
);
const codecDelta = ((codecStage["accounting"] ?? {}) as Record<string, unknown>)["delta"] as
  | Record<string, number>
  | undefined;
requireCheck(
  "encode-seam-live: the tacticalCodec stage's accounting delta (+1/+1/+0)",
  codecDelta?.dispatched === 1 && codecDelta?.succeeded === 1 && codecDelta?.failed === 0,
);

// THE BYTE-DRIFT LAW: the receiving-boundary law MUST hold; the local-vs-wire
// verdict must be CONSISTENT with its own recorded hashes (either outcome is
// an honest measurement — a laundered verdict is refused).
const drift = (live["byteDriftLaw"] ?? {}) as Record<string, unknown>;
const receiving = (drift["receivingBoundary"] ?? {}) as Record<string, unknown>;
requireCheck(
  "encode-seam-live: the byte-drift law's receiving boundary (re-hash + re-measure)",
  receiving["hashVerified"] === true && receiving["byteLengthVerified"] === true,
);
requireCheck(
  "encode-seam-live: the receiving-boundary record is SELF-CONSISTENT (measuredHash === claimedHash, both 64-hex — a fabricated re-hash is refused)",
  String(receiving["measuredHash"] ?? "") === String(receiving["claimedHash"] ?? "") &&
    HEX64.test(String(receiving["measuredHash"] ?? "")),
  `${String(receiving["measuredHash"])?.slice(0, 12)} vs ${String(receiving["claimedHash"])?.slice(0, 12)}`,
);
requireCheck(
  "encode-seam-live: the stage's envelope hash === the drift record's claimed hash (cross-field consistency)",
  String(frameStage["contentHash"] ?? "") === String(receiving["claimedHash"] ?? ""),
);
const localVsWire = (drift["localVsWire"] ?? {}) as Record<string, unknown>;
if (localVsWire["measurable"] !== true) {
  requireCheck(
    "encode-seam-live: the local adapter leg is honestly resolved (never silently skipped)",
    false,
    "the local-vs-wire comparison is not marked measurable",
  );
} else {
  const localHash = String(localVsWire["localContentHash"] ?? "");
  const wireHash = String(localVsWire["wireContentHash"] ?? "");
  const localSize = Number(localVsWire["localByteSize"] ?? -1);
  const wireSize = Number(localVsWire["wireByteSize"] ?? -2);
  requireCheck(
    "encode-seam-live: both drift hashes are full 64-hex",
    HEX64.test(localHash) && HEX64.test(wireHash),
  );
  requireCheck(
    "encode-seam-live: the wire drift hash === the stage's envelope hash (cross-field consistency)",
    wireHash === String(frameStage["contentHash"] ?? ""),
  );
  const implied = localHash === wireHash && localSize === wireSize;
  requireCheck(
    "encode-seam-live: the byte-identical verdict is CONSISTENT with its own recorded hashes (never laundered)",
    localVsWire["byteIdentical"] === implied,
    `claimed=${String(localVsWire["byteIdentical"])} implied=${String(implied)}`,
  );
  requireCheck(
    "encode-seam-live: the drift record carries BOTH toolchain builds (the honest comparison frame)",
    typeof localVsWire["localFfmpegVersion"] === "string" && typeof localVsWire["workerFfmpegVersion"] === "string",
  );
}

// THE TYPED REFUSALS (each class measured over the public wire, verbatim).
const refusals = (live["typedRefusals"] ?? {}) as Record<string, Record<string, unknown>>;
const workerSide = (refusals["workerSideClassified"] ?? {})["refusal"] as Record<string, unknown> | undefined;
requireCheck(
  "encode-seam-live: the worker-side 1ms-policy refusal is TYPED media-invalid/frames-invalid (duration-over-limit)",
  workerSide?.refused === true &&
    workerSide?.failureClass === "media-invalid" &&
    workerSide?.kind === "frames-invalid" &&
    workerSide?.errorClass === "duration-over-limit",
  JSON.stringify(workerSide ?? null),
);
const unreachable = (refusals["unreachable"] ?? {}) as Record<string, unknown>;
const dnsDead = (unreachable["dnsDead"] ?? {}) as Record<string, unknown>;
const dnsDeadRefusal = (dnsDead["refusal"] ?? {}) as Record<string, unknown>;
requireCheck(
  "encode-seam-live: the DNS-dead unreachable worker URL is the TYPED encoder-unavailable",
  dnsDeadRefusal.refused === true && dnsDeadRefusal.kind === "encoder-unavailable",
  JSON.stringify(dnsDeadRefusal),
);
const ephemerality = (refusals["ephemerality"] ?? {}) as Record<string, unknown>;
const deadPassthrough = (ephemerality["transportPassthrough"] ?? {}) as Record<string, unknown>;
requireCheck(
  "encode-seam-live: the dead-sandbox ephemerality class (the E2B proxy's 502 'The sandbox was not found')",
  deadPassthrough.status === 502 && String(deadPassthrough.body ?? "").includes("The sandbox was not found"),
  JSON.stringify(deadPassthrough),
);
const deadRefusal = (ephemerality["pairEncodeRefusal"] ?? {}) as Record<string, unknown>;
requireCheck(
  "encode-seam-live: the dead-sandbox encode REFUSED typed (never a faked artifact)",
  deadRefusal.refused === true && typeof deadRefusal.failureClass === "string",
  JSON.stringify(deadRefusal),
);
const non2xx = (refusals["non2xxPassthrough"] ?? {}) as Record<string, unknown>;
const liveWorkerRefusals = (non2xx["liveWorker"] ?? {}) as Record<string, unknown>;
const unknownRoute = (liveWorkerRefusals["unknownRoute"] ?? {}) as Record<string, unknown>;
requireCheck(
  "encode-seam-live: the live worker's 404 unknown-route passes through the STATUS line",
  unknownRoute.status === 404 && unknownRoute.errorClass === "unknown-route",
  JSON.stringify(unknownRoute),
);
const invalidBody = (liveWorkerRefusals["invalidDispatchBody"] ?? {}) as Record<string, unknown>;
requireCheck(
  "encode-seam-live: the malformed dispatch POST is refused 400 invalid-body",
  invalidBody.status === 400 && invalidBody.errorClass === "invalid-body",
  JSON.stringify(invalidBody),
);
const throughPair = (non2xx["throughThePair"] ?? {}) as Record<string, unknown>;
const bogusRefusal = (throughPair["refusal"] ?? {}) as Record<string, unknown>;
requireCheck(
  "encode-seam-live: the pair's non-2xx passthrough is the typed encode-failed carrying unknown-route",
  bogusRefusal.refused === true &&
    bogusRefusal.failureClass === "internal" &&
    bogusRefusal.kind === "encode-failed" &&
    bogusRefusal.errorClass === "unknown-route",
  JSON.stringify(bogusRefusal),
);

// THE ACCOUNTING identities (the live record's own numbers, machine-checked).
const accounting = (live["accounting"] ?? {}) as Record<string, unknown>;
const startingLedger = (accounting["startingLedger"] ?? {}) as Record<string, unknown>;
const finalStats = (accounting["stats"] ?? {}) as Record<string, unknown>;
const dDispatched = Number(finalStats["jobsDispatched"] ?? 0) - Number(startingLedger["dispatched"] ?? 0);
const dSucceeded = Number(finalStats["succeeded"] ?? 0) - Number(startingLedger["succeeded"] ?? 0);
const dFailed = Number(finalStats["failed"] ?? 0) - Number(startingLedger["failed"] ?? 0);
requireCheck(
  "encode-seam-live: the stage deltas (+3 dispatched / +2 succeeded / +1 failed — 2 encodes + the refusal)",
  dDispatched === 3 && dSucceeded === 2 && dFailed === 1,
  `Δ ${dDispatched}/${dSucceeded}/${dFailed}`,
);
requireCheck(
  "encode-seam-live: the ledger identities (dispatched === succeeded + failed + inFlight; usageRecords === terminal)",
  Number(finalStats["jobsDispatched"]) === Number(finalStats["succeeded"]) + Number(finalStats["failed"]) + Number(finalStats["inFlight"]) &&
    Number(finalStats["usageRecords"]) === Number(finalStats["succeeded"]) + Number(finalStats["failed"]),
  JSON.stringify(finalStats),
);
requireCheck(
  "encode-seam-live: the usage drain === the dispatched count (two independent reads)",
  Number(accounting["usageDrainCount"] ?? -1) === Number(finalStats["jobsDispatched"] ?? -2),
);
requireCheck(
  "encode-seam-live: three usage records this run (one per terminal dispatch)",
  ((accounting["usageRecordsThisRun"] ?? []) as unknown[]).length === 3,
);

// --- 3. the worker-stats snapshot ------------------------------------------
const workerStats = JSON.parse(readFileSync(join(dir, "worker-stats.json"), "utf8")) as Record<
  string,
  number
>;
requireCheck("worker-stats: the snapshot's dispatched count matches the live record", workerStats.jobsDispatched === Number(finalStats["jobsDispatched"] ?? -1), `${String(workerStats.jobsDispatched)} vs ${String(finalStats["jobsDispatched"])}`);
requireCheck(
  "worker-stats: the snapshot carries the same terminal split",
  workerStats.succeeded === Number(finalStats["succeeded"] ?? -1) && workerStats.failed === Number(finalStats["failed"] ?? -1),
);

// --- 4. the token scan ------------------------------------------------------
function scanForTokens(path: string): void {
  const entries = readdirSync(path, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(path, entry.name);
    if (entry.isDirectory()) {
      scanForTokens(full);
      continue;
    }
    const text = readFileSync(full, "utf8");
    for (const match of text.matchAll(/(e2b_|vcp_)[A-Za-z0-9]{20,}/g)) {
      requireCheck(`token-scan: clean (${entry.name})`, false, match[0]?.slice(0, 12) ?? "match");
    }
  }
}
scanForTokens(dir);

// --- the verdict ------------------------------------------------------------
if (failures.length > 0) {
  console.error("✗ REFUSED — the evidence pack fails the fail-closed checks:");
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exit(1);
}
console.log(
  "✓ PASS — the r306-live-wire evidence pack is machine-consistent:",
  "the pinned encode-seam merge, the five-operation profile, the live encode measurements (BOTH surfaces over the public wire + the client-side re-measure + the byte-drift verdict consistent with its own hashes), the one-operation accounting (2 execute POSTs + the cached probe signature + the ledger identities + the drain), the typed refusals (the worker-side duration-over-limit, the unreachable encoder-unavailable, the dead-sandbox 502 ephemerality, the live worker's honest 404/400), and the clean token scan",
);
