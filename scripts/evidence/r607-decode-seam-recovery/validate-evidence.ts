/**
 * R607 DECODE-SEAM RECOVERY — THE EVIDENCE VALIDATOR (DEVELOPMENT-TIME
 * FAIL-CLOSED GATE, not a test): machine-checks this evidence pack's honest
 * claims against the recorded artifacts — never against claims about what
 * the files "should" say.
 *
 * Checks (each REFUSES exit 1 with the failing check named):
 *   1. sandbox-record.json — the sandbox identity, the pinned sha = the
 *      DECODE-SEAM MERGE (the constant below — the orchestration fails
 *      closed on any other HEAD), the FOUR advertised operations
 *      [probe, normalize, decode-probe, decode-frames] (the seam profile),
 *      both workers' health 200, the boot log's RESOLVED line, the >= 1h
 *      keep-alive;
 *   2. decode-seam-live.json — the live decode-seam proof: the same pinned
 *      sha, the W102 probe document (container mp4 + a video track), the
 *      frame batch (count > 0, the measured bytes within the budget, the
 *      invariants, the 64-hex source sha), the TYPED budget refusal
 *      (ResourceLimitError), the accounting identities (the usage drain
 *      === the dispatched count; the stage deltas as recorded);
 *   3. deploy-record.json — the LANDED deployment (this flight's outcome
 *      the 65-j flight could not reach): a real dpl_-shaped id, the three
 *      env PATCHes 200, the URL wiring consistency (MEDIA_TOOLCHAIN_URL ===
 *      the sandbox record's worker publicUrl; COMPUTE_WORKER_URL === the
 *      compute worker's), the production health 200 + the seam marker;
 *      WHEN VERCEL_TOKEN IS PRESENT the deploymentId is cross-checked
 *      LIVE at the provider (READY + production + the recorded URL) — a
 *      laundered/fabricated id is refused;
 *   4. hosted-golden-path.json — THE CLOSURE: the hosted runtime's own
 *      dispatch through the seam — boot marker, register/login 200, the
 *      upload 201 + uploadState stored + checksumVerified + the perception
 *      frame count, the media job TERMINAL succeeded + progress 1, the
 *      verdict PASS; a claimed PASS without the terminal job is refused;
 *   5. THE TOKEN SCAN — no `e2b_`/`vcp_` token-shaped string anywhere in
 *      the evidence tree (the documented prefix MENTIONS in the discipline
 *      notes are not token-shaped and do not trip the scan; the negative
 *      tests build their fake token at runtime, so the committed sources
 *      stay clean).
 *
 * Run (from the REPO ROOT):
 *   bun run scripts/evidence/r607-decode-seam-recovery/validate-evidence.ts
 *   # against a (negative-test) variant tree:
 *   bun run scripts/evidence/r607-decode-seam-recovery/validate-evidence.ts --dir /tmp/<variant>
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
const PINNED_SHA = "920c556c18ba984d22d4bea50895b6a173b0a4bd";
const EXPECTED_OPS = ["decode-frames", "decode-probe", "normalize", "probe"];

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
const DPL_ID = /^dpl_[A-Za-z0-9]{20,}$/;

// --- 1. the sandbox record -------------------------------------------------
const sandbox = readJson("sandbox-record.json");
const provider = (sandbox["provider"] ?? {}) as Record<string, unknown>;
const sandboxInfo = (provider["sandbox"] ?? {}) as Record<string, unknown>;
const pinnedRevision = (provider["pinnedRevision"] ?? {}) as Record<string, unknown>;
const sandboxId = String(sandboxInfo["sandboxId"] ?? "");
requireCheck("sandbox-record: sandboxId shape", /^[a-z0-9]{15,}$/.test(sandboxId), sandboxId);
requireCheck(
  "sandbox-record: the pinned sha is the decode-seam merge",
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
  "sandbox-record: the descriptor advertises the seam's FOUR operations",
  JSON.stringify(workerDescriptor["operationsAdvertised"] ?? []) === JSON.stringify(EXPECTED_OPS),
  JSON.stringify(workerDescriptor["operationsAdvertised"] ?? []),
);
const bootLog = ((worker["bootLog"] ?? []) as string[]).join("\n");
requireCheck("sandbox-record: the boot log's RESOLVED toolchain line", bootLog.includes("RESOLVED"));
const computeWorker = (sandbox["computeWorkerCompanion"] ?? {}) as Record<string, unknown>;
const computeHealth = (computeWorker["health"] ?? {}) as Record<string, unknown>;
requireCheck(
  "sandbox-record: the compute worker's health 200 (the fix-forward leg)",
  Number(computeHealth["httpStatusCode"] ?? 0) === 200,
);
const mediaPublicUrl = String(worker["publicUrl"] ?? "");
const computePublicUrl = String(computeWorker["publicUrl"] ?? "");
requireCheck("sandbox-record: the public URLs present", mediaPublicUrl.startsWith("https://") && computePublicUrl.startsWith("https://"));

// --- 2. the live decode-seam record ---------------------------------------
const live = readJson("decode-seam-live.json");
const liveIdentity = (live["workerIdentity"] ?? {}) as Record<string, unknown>;
requireCheck(
  "decode-seam-live: the same pinned sha",
  String(liveIdentity["pinnedSha"] ?? "") === PINNED_SHA,
  String(liveIdentity["pinnedSha"] ?? ""),
);
const liveDescriptor = (live["descriptor"] ?? {}) as Record<string, unknown>;
requireCheck(
  "decode-seam-live: the four operations verified",
  JSON.stringify(liveDescriptor["operationsAdvertised"] ?? []) === JSON.stringify(EXPECTED_OPS),
);
const stages = (live["stages"] ?? {}) as Record<string, Record<string, unknown>>;
const probeStage = stages["probe"] ?? {};
const probeDoc = (probeStage["probe"] ?? {}) as Record<string, unknown>;
const probeTracks = ((probeDoc["tracks"] ?? []) as { kind?: string }[]).map((t) => t.kind ?? "?");
requireCheck(
  "decode-seam-live: the W102 probe document (mp4 + a video track)",
  probeDoc["container"] === "mp4" && probeTracks.includes("video"),
  `${probeDoc["container"]} [${probeTracks.join(",")}]`,
);
requireCheck(
  "decode-seam-live: the selected video stream index is a number",
  typeof probeStage["selectedVideoStreamIndex"] === "number",
);
const framesStage = stages["decodeFrames"] ?? {};
requireCheck(
  "decode-seam-live: the frame batch has frames",
  Number(framesStage["frameCount"] ?? 0) > 0,
  String(framesStage["frameCount"] ?? 0),
);
requireCheck(
  "decode-seam-live: the measured bytes within the budget",
  Number(framesStage["measuredTotalBytes"] ?? 0) <= Number(framesStage["budgetBytes"] ?? 0),
);
const framesInvariants = (framesStage["invariants"] ?? {}) as Record<string, unknown>;
requireCheck(
  "decode-seam-live: the frame invariants (monotonic, window, dims)",
  framesInvariants["monotonic"] === true &&
    framesInvariants["windowRespected"] === true &&
    framesInvariants["dimsConsistent"] === true,
);
const firstFrame = (framesStage["firstFrame"] ?? {}) as Record<string, unknown>;
requireCheck(
  "decode-seam-live: the first frame is 320x240 rgb24",
  firstFrame["width"] === 320 && firstFrame["height"] === 240 && firstFrame["pixelFormat"] === "rgb24",
);
const negativeStage = stages["budgetRefusalNegative"] ?? {};
requireCheck(
  "decode-seam-live: the typed budget refusal (ResourceLimitError)",
  negativeStage["refused"] === true && negativeStage["typedErrorClass"] === "ResourceLimitError",
);
const liveAccounting = (live["accounting"] ?? {}) as Record<string, unknown>;
const liveStats = (liveAccounting["stats"] ?? {}) as Record<string, unknown>;
requireCheck(
  "decode-seam-live: the accounting identities (drain === dispatched)",
  Number(liveAccounting["usageDrainCount"] ?? -1) === Number(liveStats["jobsDispatched"] ?? -2),
);

// --- 3. the deploy record ---------------------------------------------------
const deployRecord = readJson("deploy-record.json");
const deploy = (deployRecord["deploy"] ?? {}) as Record<string, unknown>;
const deploymentId = String(deploy["deploymentId"] ?? "");
requireCheck(
  "deploy-record: a REAL dpl_-shaped deployment id (this flight LANDED the deploy)",
  DPL_ID.test(deploymentId),
  deploymentId,
);
const envWiring = (deployRecord["envWiring"] ?? {}) as Record<string, unknown>;
const patches = (envWiring["patches"] ?? []) as { name?: string; value?: string; httpStatusCode?: number }[];
requireCheck("deploy-record: the three env PATCHes all 200", patches.length === 3 && patches.every((p) => p.httpStatusCode === 200));
const mediaUrlPatch = patches.find((p) => p.name === "MEDIA_TOOLCHAIN_URL");
const computeUrlPatch = patches.find((p) => p.name === "COMPUTE_WORKER_URL");
requireCheck(
  "deploy-record: MEDIA_TOOLCHAIN_URL === the sandbox record's worker URL",
  mediaUrlPatch?.value === mediaPublicUrl,
  `${mediaUrlPatch?.value} vs ${mediaPublicUrl}`,
);
requireCheck(
  "deploy-record: COMPUTE_WORKER_URL === the compute worker's URL",
  computeUrlPatch?.value === computePublicUrl,
  `${computeUrlPatch?.value} vs ${computePublicUrl}`,
);
const productionMeasured = (deployRecord["productionMeasured"] ?? {}) as Record<string, unknown>;
const apiHealth = (productionMeasured["apiPlatformHealth"] ?? {}) as Record<string, unknown>;
const deploymentMarker = String(
  (envWiring["patches"] as { name?: string; value?: string }[] | undefined)?.find(
    (p) => p.name === "SPORTA_DEPLOY_MARKER",
  )?.value ?? "",
);
requireCheck(
  "deploy-record: the production health 200 + the seam marker (the deploy record's own)",
  Number(apiHealth["httpStatusCode"] ?? 0) === 200 && apiHealth["deployMarker"] === deploymentMarker,
  `${String(apiHealth["deployMarker"] ?? null)} vs ${deploymentMarker}`,
);
requireCheck(
  "deploy-record: the marker is the seam-deployment family",
  /^r607-decode-seam-rerun-[0-9]+$/.test(deploymentMarker),
  deploymentMarker,
);
const deploymentUrl = String(deploy["deploymentUrl"] ?? "");
requireCheck("deploy-record: the deployment URL recorded", deploymentUrl.endsWith(".vercel.app"));

// The LIVE provider cross-check (fail-closed whenever the token is present —
// the dev-sandbox gate AND the negative-test variants: a laundered
// deployment id does not resolve at the provider and is refused).
const vercelToken = process.env.VERCEL_TOKEN;
if (vercelToken !== undefined && vercelToken !== "") {
  try {
    const response = await fetch(
      `https://api.vercel.com/v13/deployments/${deploymentId}?teamId=ekonplacidegmailcoms-projects`,
      { headers: { Authorization: `Bearer ${vercelToken}` }, signal: AbortSignal.timeout(30_000) },
    );
    requireCheck("deploy-record: the deploymentId resolves at the provider", response.ok);
    const body = (await response.json()) as { ready?: unknown; url?: string; target?: string };
    requireCheck(
      "deploy-record: the deployment is READY + production + the recorded URL",
      body.ready !== null &&
        body.ready !== undefined &&
        body.target === "production" &&
        body.url === deploymentUrl,
      `${String(body.ready)} ${String(body.target)} ${String(body.url)}`,
    );
  } catch (error) {
    requireCheck("deploy-record: the live provider cross-check executed", false, String(error));
  }
}

// --- 4. the hosted golden-path record (THE CLOSURE) -----------------------
const hosted = readJson("hosted-golden-path.json");
const hostedSteps = (hosted["steps"] ?? {}) as Record<string, Record<string, unknown>>;
const bootStep = hostedSteps["boot"] ?? {};
requireCheck(
  "hosted-golden-path: the boot marker AGREES with the deploy record (the same seam deployment)",
  bootStep["deployMarker"] === deploymentMarker && Number(bootStep["httpStatusCode"] ?? 0) === 200,
  `${String(bootStep["deployMarker"] ?? null)} vs ${deploymentMarker}`,
);
requireCheck("hosted-golden-path: register 200", Number((hostedSteps["register"] ?? {})["httpStatusCode"] ?? 0) === 200);
const loginStep = hostedSteps["login"] ?? {};
requireCheck(
  "hosted-golden-path: login 200 + the session cookie",
  Number(loginStep["httpStatusCode"] ?? 0) === 200 && loginStep["sessionCookieIssued"] === true,
);
const uploadStep = hostedSteps["upload"] ?? {};
const uploadBody = (uploadStep["body"] ?? {}) as {
  source?: { asset?: { uploadState?: string; checksumVerified?: boolean; container?: string } };
  perception?: { frameCount?: number };
};
requireCheck(
  "hosted-golden-path: THE UPLOAD ADMISSION 201 + stored + checksum verified",
  Number(uploadStep["httpStatusCode"] ?? 0) === 201 &&
    uploadBody.source?.asset?.uploadState === "stored" &&
    uploadBody.source?.asset?.checksumVerified === true,
);
requireCheck(
  "hosted-golden-path: the R207 perception ran on decoded frames",
  Number(uploadBody.perception?.frameCount ?? 0) > 0,
  String(uploadBody.perception?.frameCount ?? 0),
);
requireCheck(
  "hosted-golden-path: the source sha is full 64-hex",
  HEX64.test(String(uploadStep["sourceSha256"] ?? "")),
);
const mediaJobStep = hostedSteps["mediaJob"] ?? {};
const mediaJobTerminal = (mediaJobStep["terminal"] ?? {}) as { state?: string; progress?: number };
requireCheck(
  "hosted-golden-path: the media job TERMINAL succeeded + progress 1 (the Original leg)",
  mediaJobTerminal.state === "succeeded" && mediaJobTerminal.progress === 1,
  JSON.stringify(mediaJobStep["terminal"] ?? null),
);
// The watch leg: the catalog + the Original playback integrity-verified on
// the LIVE plane (the R504/R508-R510 class — G12's playback criterion).
const watchStep = hostedSteps["watch"] ?? {};
const watchFull = (watchStep["full"] ?? {}) as {
  integrityVerified?: boolean;
  servedSha256?: string;
  ftypMagic?: boolean;
};
requireCheck(
  "hosted-golden-path: the watch leg — the catalog 200 + the Original playback INTEGRITY-VERIFIED (sha + bytes + ftyp)",
  Number(watchStep["catalogHttpStatusCode"] ?? 0) === 200 &&
    watchFull.integrityVerified === true &&
    HEX64.test(String(watchFull.servedSha256 ?? "")) &&
    watchFull.ftypMagic === true,
);
const watchRange = (watchStep["range"] ?? {}) as { httpStatusCode?: number; sliceMatches?: boolean };
requireCheck(
  "hosted-golden-path: the watch leg's Range fetch (206 + the slice matches)",
  watchRange.httpStatusCode === 206 && watchRange.sliceMatches === true,
);
// The J004 one-submission: the honest derived-reality state — the ORIGINAL
// ready + played integrity-verified; the derived kinds' typed refusals
// recorded verbatim (the R306 encode seam — the derived plane's local-ffmpeg
// dependency — is the NEXT measured gap, never laundered as success).
const oneShotStep = hostedSteps["oneSubmissionFourRealities"] ?? {};
const oneShotPlayback = (oneShotStep["playback"] ?? {}) as Record<
  string,
  { integrityVerified?: boolean; availability?: string; played?: boolean }
>;
requireCheck(
  "hosted-golden-path: the J004 Original played back integrity-verified",
  oneShotPlayback["original"]?.integrityVerified === true,
);
requireCheck(
  "hosted-golden-path: the J004 derived kinds recorded their honest availability states (never fabricated)",
  ["tactical", "three-d-game", "anime-npr"].every((kind) => {
    const entry = oneShotPlayback[kind];
    return entry !== undefined && entry.integrityVerified !== true;
  }),
  JSON.stringify(oneShotPlayback),
);
requireCheck(
  "hosted-golden-path: the verdict is PASS",
  String(hosted["verdict"] ?? "").startsWith("PASS"),
);

// --- 5. the token scan ------------------------------------------------------
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
  "✓ PASS — the r607-decode-seam-recovery evidence pack is machine-consistent:",
  "the pinned seam merge, the four-operation profile, the live decode-seam measurements (probe + frames + the typed refusal + the accounting), the LANDED deploy (provider-verified when the token is present), the hosted golden-path CLOSURE (upload 201 stored + the terminal succeeded media job), and the clean token scan",
);
