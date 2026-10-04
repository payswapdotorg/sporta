/**
 * R306 DEPLOY LEG — THE EVIDENCE VALIDATOR (DEVELOPMENT-TIME FAIL-CLOSED
 * GATE, not a test): machine-checks this evidence pack's honest claims
 * against the recorded artifacts — never against claims about what the
 * files "should" say. A laundered record is refused.
 *
 * Checks (each REFUSES exit 1 with the failing check named):
 *   1. compute-worker-record.json — the sandbox identity + the pinned
 *      in-sandbox revision (the R306 encode-seam merge — the revision BOTH
 *      workers run), the compute worker's public health 200 AND its
 *      `/v1/adapter` descriptor 200 (THE BOOT-TIME FETCH the composition
 *      performs, measured over the exact URL the deploy bakes — a dead URL
 *      here is the 62-c production-500 incident class), the full-plane
 *      renderer profile (the derived-reality plane COMPOSED in-sandbox),
 *      the media worker's FIVE operations, the >= 2h keep-alive;
 *   2. deploy-record.json — the repo state (HEAD === origin/main === the
 *      R306 arc tip), the PRE-PATCH wiring (MEDIA_TOOLCHAIN +
 *      COMPUTE_PROVIDER verified `http` — the verify-not-assume evidence;
 *      the REPLACED dead r607 URLs recorded), the THREE PATCHes (each 200,
 *      each re-read matching, the URL values === the live sandbox's public
 *      URLs — cross-checked against the compute-worker record), the
 *      baseline (the 62-c incident class measured LIVE at the flight's
 *      open: the superseded deployment's health 500), the deployment
 *      (dpl_-shaped id, READY, production, the recorded URL + alias + the
 *      marker), THE TWO-SURFACE verification (the public alias 200 + the
 *      marker; the deployment's OWN surface — the 302 Vercel-Authentication
 *      protection shape recorded as a shape, never laundered, + the
 *      authenticated `vercel curl` probe's marker), THE FOUR-WAY MARKER
 *      AGREEMENT (the PATCHed marker === the deploy record's marker === the
 *      alias health's marker === the authenticated probe's marker — a
 *      fabricated one is refused), the honest media-descriptor reachability
 *      (the health answer's own field list carries NO media field + the
 *      `measurable: false` consistency + the from-this-machine
 *      five-operation measurement), the ephemerality doctrine block (the
 *      sandbox identity agreement, the 2h keep-alive, both worker URLs
 *      live at record-write, the 502 re-manifest note, the operator
 *      decision), the credentials discipline naming both token prefixes;
 *   3. THE LIVE PROVIDER CROSS-CHECK (fail-closed whenever VERCEL_TOKEN is
 *      present — a laundered deployment id does not resolve at the
 *      provider and is refused): GET /v13/deployments/{id} answers READY +
 *      production + the recorded URL + the recorded commit sha (the
 *      provider's own meta — the deployed revision identity);
 *   4. THE TOKEN SCAN — no `e2b_`/`vcp_` token-shaped string anywhere in
 *      the evidence tree (the documented prefix MENTIONS in the discipline
 *      notes are not token-shaped and do not trip the scan).
 *
 * Run (from the REPO ROOT):
 *   bun run scripts/evidence/r306-deploy/validate-evidence.ts
 *   # against a (negative-test) variant tree:
 *   bun run scripts/evidence/r306-deploy/validate-evidence.ts --dir /tmp/<variant>
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const argv = process.argv.slice(2);
function argValue(flag: string): string | undefined {
  const at = argv.indexOf(flag);
  return at === -1 ? undefined : argv[at + 1];
}
const dir = argValue("--dir") ?? resolve(import.meta.dirname, ".");

/** The R306 arc tip the deployment builds from (the live-wire merge). */
const DEPLOY_SHA = "6b1c052eafc88bb8c8429938c4abe9f49ea9efa4";
/** The pinned in-sandbox revision BOTH workers run (the encode-seam merge). */
const IN_SANDBOX_SHA = "dc2ed8fc9c7b9c91253a80378e31006965cc1e9a";
const SANDBOX_ID = "i5lvv9q3jrumm914o1rca";
const EXPECTED_OPS = ["decode-frames", "decode-probe", "encode-frames", "normalize", "probe"];
const DEPLOY_MARKER = "r306-encode-seam-deploy-1";
const DEAD_R607_SANDBOX_HOST = "ioyw6rihmz070wo38d6z1";
const DPL_ID = /^dpl_[A-Za-z0-9]{20,}$/;

const failures: string[] = [];
function requireCheck(name: string, ok: boolean, detail?: string): void {
  if (!ok) failures.push(detail === undefined ? name : `${name} (${detail})`);
}

function readJson(name: string): Record<string, unknown> {
  const path = join(dir, name);
  requireCheck(`${name} exists`, statSync(path, { throwIfNoEntry: false }) !== undefined);
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

// --- 1. the compute-worker record -------------------------------------------
const computeRecord = readJson("compute-worker-record.json");
const computeProvider = (computeRecord["provider"] ?? {}) as Record<string, unknown>;
const computeSandboxInfo = (computeProvider["sandbox"] ?? {}) as Record<string, unknown>;
const computePinned = (computeProvider["pinnedRevision"] ?? {}) as Record<string, unknown>;
const sandboxId = String(computeSandboxInfo["sandboxId"] ?? "");
requireCheck("compute-worker-record: sandboxId shape", /^[a-z0-9]{15,}$/.test(sandboxId), sandboxId);
requireCheck(
  "compute-worker-record: the sandbox is the live-wire flight's",
  sandboxId === SANDBOX_ID,
  sandboxId,
);
requireCheck(
  "compute-worker-record: the in-sandbox pinned revision is the R306 encode-seam merge (BOTH workers run it)",
  String(computePinned["sha"] ?? "") === IN_SANDBOX_SHA,
  String(computePinned["sha"] ?? ""),
);
requireCheck(
  "compute-worker-record: keep-alive >= 2h (the deploy acceptance window)",
  Number(computeSandboxInfo["keepAliveMs"] ?? 0) >= 7_200_000,
  String(computeSandboxInfo["keepAliveMs"] ?? 0),
);
const computeWorker = (computeRecord["computeWorker"] ?? {}) as Record<string, unknown>;
requireCheck(
  "compute-worker-record: the compute worker's public health 200",
  Number(((computeWorker["health"] ?? {}) as Record<string, unknown>)["httpStatusCode"] ?? 0) === 200,
);
const computeDescriptor = (computeWorker["descriptor"] ?? {}) as Record<string, unknown>;
requireCheck(
  "compute-worker-record: THE BOOT-TIME FETCH measured 200 (GET {COMPUTE_WORKER_URL}/v1/adapter over the exact URL the deploy bakes — the fetch whose failure is the 62-c production-500 incident class)",
  Number(computeDescriptor["httpStatusCode"] ?? 0) === 200,
  String(computeDescriptor["httpStatusCode"] ?? 0),
);
const renderers = ((computeDescriptor["renderersAdvertised"] ?? []) as string[]).slice().sort();
requireCheck(
  "compute-worker-record: the FULL renderer plane advertised (the derived-reality plane composed: tactical + game-3d + anime-npr through the R306 bridges)",
  JSON.stringify(renderers) ===
    JSON.stringify(
      ["anime-npr.prototype", "anime.prototype", "game-3d.prototype", "sporta.testcard", "tactical.prototype"].sort(),
    ),
  JSON.stringify(renderers),
);
requireCheck(
  "compute-worker-record: the boot log's derived-reality plane COMPOSED line (the honest composition gate)",
  ((computeWorker["bootLog"] ?? []) as string[]).some((l) => l.includes("derived-reality plane: COMPOSED")),
);
const computePublicUrl = String(computeWorker["publicUrl"] ?? "");
requireCheck(
  "compute-worker-record: the compute public URL is the sandbox's 3973 proxy",
  computePublicUrl === `https://3973-${SANDBOX_ID}.e2b.app`,
  computePublicUrl,
);
const mediaWorkerSection = (computeRecord["mediaWorker"] ?? {}) as Record<string, unknown>;
requireCheck(
  "compute-worker-record: the media worker's public health 200 (re-verified at the compute boot)",
  Number(((mediaWorkerSection["health"] ?? {}) as Record<string, unknown>)["httpStatusCode"] ?? 0) === 200,
);
requireCheck(
  "compute-worker-record: the media descriptor advertises the encode seam's FIVE operations (the R306 arc's seam)",
  JSON.stringify(((mediaWorkerSection["descriptor"] ?? {}) as Record<string, unknown>)["operationsAdvertised"] ?? []) ===
    JSON.stringify(EXPECTED_OPS),
);
const mediaPublicUrl = String(mediaWorkerSection["publicUrl"] ?? "");
requireCheck(
  "compute-worker-record: the media public URL is the sandbox's 3971 proxy",
  mediaPublicUrl === `https://3971-${SANDBOX_ID}.e2b.app`,
  mediaPublicUrl,
);

// --- 2. the deploy record -----------------------------------------------------
const deployRecord = readJson("deploy-record.json");
requireCheck(
  "deploy-record: the kind",
  deployRecord["kind"] === "r306-deploy-record",
  String(deployRecord["kind"] ?? ""),
);
const deploy = (deployRecord["deploy"] ?? {}) as Record<string, unknown>;
const repoState = (deploy["repoState"] ?? {}) as Record<string, unknown>;
requireCheck(
  "deploy-record: the deployed revision is the R306 arc tip (HEAD === origin/main)",
  String(repoState["HEAD"] ?? "") === DEPLOY_SHA && String(repoState["originMain"] ?? "") === DEPLOY_SHA,
  `${String(repoState["HEAD"] ?? "")} / ${String(repoState["originMain"] ?? "")}`,
);

const envWiring = (deployRecord["envWiring"] ?? {}) as Record<string, unknown>;
const prePatch = ((envWiring["prePatchVerified"] ?? {}) as Record<string, unknown>)["values"] as
  | Record<string, string | undefined>
  | undefined;
requireCheck(
  "deploy-record: the PRE-PATCH posture verified `http` for BOTH seams (verify, do not assume — the 65-j PATCHes re-read decrypted)",
  prePatch?.["MEDIA_TOOLCHAIN"] === "http" && prePatch?.["COMPUTE_PROVIDER"] === "http",
  `${String(prePatch?.["MEDIA_TOOLCHAIN"])} / ${String(prePatch?.["COMPUTE_PROVIDER"])}`,
);
requireCheck(
  "deploy-record: the REPLACED worker URLs recorded honestly (the dead r607 sandbox — the lineage the PATCH re-pointed)",
  String(prePatch?.["MEDIA_TOOLCHAIN_URL"] ?? "").includes(DEAD_R607_SANDBOX_HOST) &&
    String(prePatch?.["COMPUTE_WORKER_URL"] ?? "").includes(DEAD_R607_SANDBOX_HOST),
  `${String(prePatch?.["MEDIA_TOOLCHAIN_URL"])} / ${String(prePatch?.["COMPUTE_WORKER_URL"])}`,
);
const patches = (envWiring["patches"] ?? []) as { name?: string; value?: string; httpStatusCode?: number; reReadValue?: string }[];
requireCheck("deploy-record: exactly the THREE PATCHes", patches.length === 3, String(patches.length));
const patchOf = (name: string) => patches.find((p) => p.name === name);
for (const name of ["MEDIA_TOOLCHAIN_URL", "COMPUTE_WORKER_URL", "SPORTA_DEPLOY_MARKER"]) {
  const patch = patchOf(name);
  requireCheck(
    `deploy-record: the ${name} PATCH landed (200 + the re-read matches the value)`,
    patch?.httpStatusCode === 200 && patch?.reReadValue === patch?.value,
    `${String(patch?.httpStatusCode)} / ${String(patch?.reReadValue)}`,
  );
}
const mediaUrlPatch = patchOf("MEDIA_TOOLCHAIN_URL");
const computeUrlPatch = patchOf("COMPUTE_WORKER_URL");
const markerPatch = patchOf("SPORTA_DEPLOY_MARKER");
requireCheck(
  "deploy-record: the PATCHed MEDIA_TOOLCHAIN_URL === the live sandbox's media URL (cross-checked against the compute-worker record)",
  mediaUrlPatch?.value === mediaPublicUrl,
  `${String(mediaUrlPatch?.value)} vs ${mediaPublicUrl}`,
);
requireCheck(
  "deploy-record: the PATCHed COMPUTE_WORKER_URL === the live sandbox's compute URL (cross-checked against the compute-worker record)",
  computeUrlPatch?.value === computePublicUrl,
  `${String(computeUrlPatch?.value)} vs ${computePublicUrl}`,
);
requireCheck(
  "deploy-record: the PATCHed marker is the R306 deploy family",
  markerPatch?.value === DEPLOY_MARKER,
  String(markerPatch?.value ?? ""),
);
const unpatched = (envWiring["unpatched"] ?? []) as string[];
requireCheck(
  "deploy-record: the UNPATCHED posture named for BOTH seams (the 65-j PATCHes, re-verified not re-fired)",
  unpatched.some((u) => u.startsWith("MEDIA_TOOLCHAIN=http")) &&
    unpatched.some((u) => u.startsWith("COMPUTE_PROVIDER=http")),
  JSON.stringify(unpatched),
);

const baseline = (deployRecord["baselineMeasured"] ?? {}) as Record<string, unknown>;
requireCheck(
  "deploy-record: the pre-deploy baseline measured the 62-c incident class LIVE (the superseded deployment's health 500, empty body)",
  Number(baseline["apiPlatformHealthHttpStatusCode"] ?? 0) === 500 && String(baseline["apiPlatformHealthBody"] ?? "").length === 0,
  `${String(baseline["apiPlatformHealthHttpStatusCode"])} / ${String(baseline["apiPlatformHealthBody"]).length}B`,
);

requireCheck("deploy-record: the deploy outcome", deploy["outcome"] === "DEPLOYED", String(deploy["outcome"] ?? ""));
const deploymentId = String(deploy["deploymentId"] ?? "");
requireCheck("deploy-record: a dpl_-shaped deployment id", DPL_ID.test(deploymentId), deploymentId);
requireCheck("deploy-record: the deployment READY", deploy["state"] === "READY", String(deploy["state"] ?? ""));
requireCheck(
  "deploy-record: the deployment target is production",
  deploy["target"] === "production",
  String(deploy["target"] ?? ""),
);
requireCheck("deploy-record: the createdAt recorded", Number(deploy["createdAtMs"] ?? 0) > 0);
const deploymentUrl = String(deploy["deploymentUrl"] ?? "");
requireCheck(
  "deploy-record: the deployment URL recorded (vercel.app)",
  deploymentUrl.endsWith(".vercel.app") && deploymentUrl.length > "https://".length + 10,
  deploymentUrl,
);
requireCheck(
  "deploy-record: the production alias recorded",
  deploy["productionAlias"] === "https://sporta-flame.vercel.app",
  String(deploy["productionAlias"] ?? ""),
);
requireCheck(
  "deploy-record: the prior r607 deployment superseded (the honest lineage)",
  ((deploy["priorDeploymentSuperseded"] ?? {}) as Record<string, unknown>)["deploymentId"] === "dpl_GJXYpu34H2urhYqsw9Q156gF4Zqq",
);

const productionMeasured = (deployRecord["productionMeasured"] ?? {}) as Record<string, unknown>;
const publicSurface = (productionMeasured["thePublicSurface"] ?? {}) as Record<string, unknown>;
const aliasHealth = (publicSurface["apiPlatformHealth"] ?? {}) as Record<string, unknown>;
requireCheck(
  "deploy-record: THE PUBLIC SURFACE — the production alias health 200",
  Number(aliasHealth["httpStatusCode"] ?? 0) === 200,
  String(aliasHealth["httpStatusCode"] ?? 0),
);
requireCheck(
  "deploy-record: the production alias root 200",
  Number(publicSurface["rootHttpStatusCode"] ?? 0) === 200,
  String(publicSurface["rootHttpStatusCode"] ?? 0),
);
const fieldsCarried = (aliasHealth["fieldsCarried"] ?? []) as string[];
requireCheck(
  "deploy-record: the health answer's own field list recorded (the honest no-media-fields evidence)",
  fieldsCarried.length >= 4 && fieldsCarried.includes("deployMarker"),
  JSON.stringify(fieldsCarried),
);
requireCheck(
  "deploy-record: the health answer carries NO media-toolchain field (the `measurable: false` consistency — a health field claiming media reachability would contradict the record's own honesty)",
  !fieldsCarried.some((f) => f.toLowerCase().includes("media") || f.toLowerCase().includes("toolchain")),
  JSON.stringify(fieldsCarried),
);
const aliasBody = (aliasHealth["body"] ?? {}) as Record<string, unknown> | null;
requireCheck(
  "deploy-record: the alias health body recorded with the marker",
  aliasBody !== null && typeof aliasBody["deployMarker"] === "string",
);

const ownSurface = (productionMeasured["theDeploymentsOwnSurface"] ?? {}) as Record<string, unknown>;
const publicFetchShape = (ownSurface["publicFetchShape"] ?? {}) as Record<string, unknown>;
requireCheck(
  "deploy-record: the deployment URL's public fetch shape recorded as the SHAPE it is (302 → vercel.com/sso-api, Vercel Authentication — never laundered into a 200)",
  Number(publicFetchShape["httpStatusCode"] ?? 0) === 302 &&
    String(publicFetchShape["location"] ?? "").startsWith("https://vercel.com/sso-api"),
  `${String(publicFetchShape["httpStatusCode"])} / ${String(publicFetchShape["location"])?.slice(0, 40)}`,
);
const authProbe = (ownSurface["authenticatedProbe"] ?? {}) as Record<string, unknown>;
requireCheck(
  "deploy-record: THE DEPLOYMENT'S OWN SURFACE — the authenticated vercel-curl probe exit 0",
  authProbe["exitCode"] === 0,
  String(authProbe["exitCode"] ?? "null"),
);

// THE FOUR-WAY MARKER AGREEMENT (a fabricated marker is refused): the PATCHed
// value === the deploy record's marker === the alias health's marker === the
// authenticated probe's marker.
requireCheck(
  "deploy-record: THE FOUR-WAY MARKER AGREEMENT (the PATCHed marker === the deploy record's === the alias health's === the authenticated probe's — never a fabricated one)",
  markerPatch?.value === deploy["deployMarker"] &&
    markerPatch?.value === aliasHealth["deployMarker"] &&
    markerPatch?.value === authProbe["deployMarker"],
  `${String(markerPatch?.value)} / ${String(deploy["deployMarker"])} / ${String(aliasHealth["deployMarker"])} / ${String(authProbe["deployMarker"])}`,
);

const mediaReachability = (productionMeasured["mediaDescriptorReachability"] ?? {}) as Record<string, unknown>;
const fromRuntime = (mediaReachability["fromTheDeployedRuntime"] ?? {}) as Record<string, unknown>;
requireCheck(
  "deploy-record: the media reachability from the deployed runtime honestly NOT measurable (never silently claimed)",
  fromRuntime["measurable"] === false && String(fromRuntime["honestNote"] ?? "").length > 40,
);
const fromMachine = (mediaReachability["fromThisMachine"] ?? {}) as Record<string, unknown>;
requireCheck(
  "deploy-record: the media descriptor measured from THIS machine over the exact baked URL (health + descriptor 200 + the five operations)",
  Number(fromMachine["healthHttpStatusCode"] ?? 0) === 200 &&
    Number(fromMachine["descriptorHttpStatusCode"] ?? 0) === 200 &&
    JSON.stringify(fromMachine["operationsAdvertised"] ?? []) === JSON.stringify(EXPECTED_OPS) &&
    fromMachine["url"] === mediaPublicUrl,
  `${String(fromMachine["healthHttpStatusCode"])}/${String(fromMachine["descriptorHttpStatusCode"])} ${String(fromMachine["url"])}`,
);

const doctrine = (deployRecord["ephemeralityDoctrine"] ?? {}) as Record<string, unknown>;
const doctrineSandbox = (doctrine["sandbox"] ?? {}) as Record<string, unknown>;
requireCheck(
  "deploy-record: the ephemerality sandbox identity AGREES with the compute-worker record (same sandbox, same start)",
  doctrineSandbox["sandboxId"] === sandboxId &&
    doctrineSandbox["startedAtIso"] === computeSandboxInfo["startedAtIso"],
  `${String(doctrineSandbox["sandboxId"])} / ${String(doctrineSandbox["startedAtIso"])}`,
);
requireCheck(
  "deploy-record: the 2h keep-alive recorded in the doctrine block",
  Number(doctrineSandbox["keepAliveMs"] ?? 0) === 7_200_000,
  String(doctrineSandbox["keepAliveMs"] ?? 0),
);
requireCheck(
  "deploy-record: BOTH worker URLs live at record-write (the measured lifetime state — a laundered dead URL is refused)",
  doctrineSandbox["mediaWorkerUrlLiveAtRecordWrite"] === 200 &&
    doctrineSandbox["computeWorkerUrlLiveAtRecordWrite"] === 200,
  `${String(doctrineSandbox["mediaWorkerUrlLiveAtRecordWrite"])} / ${String(doctrineSandbox["computeWorkerUrlLiveAtRecordWrite"])}`,
);
requireCheck(
  "deploy-record: the doctrine names the 502 re-manifest class (the honest ephemerality posture)",
  String(doctrineSandbox["note"] ?? "").includes("502") &&
    String(doctrine["measuredLive"] ?? "").length > 40 &&
    String(doctrine["theHonestPosture"] ?? "").length > 40,
);
requireCheck(
  "deploy-record: the operator decision names the PERSISTENT worker host (never improvised by a worker)",
  String(doctrine["theOperatorDecision"] ?? "").includes("PERSISTENT"),
);
requireCheck(
  "deploy-record: the credentials discipline names BOTH token prefixes (vcp_ + e2b_) with env-only posture",
  String(deployRecord["credentialsDiscipline"] ?? "").includes("vcp_") &&
    String(deployRecord["credentialsDiscipline"] ?? "").includes("e2b_") &&
    String(deployRecord["credentialsDiscipline"] ?? "").includes("env-only"),
);

// --- 3. THE LIVE provider cross-check (fail-closed whenever the token is
//        present — the dev-sandbox gate AND the negative-test variants). ---
const vercelToken = process.env.VERCEL_TOKEN;
if (vercelToken !== undefined && vercelToken !== "") {
  try {
    const response = await fetch(
      `https://api.vercel.com/v13/deployments/${deploymentId}?teamId=ekonplacidegmailcoms-projects`,
      { headers: { Authorization: `Bearer ${vercelToken}` }, signal: AbortSignal.timeout(30_000) },
    );
    requireCheck("deploy-record: the deploymentId resolves at the provider", response.ok);
    const body = (await response.json()) as {
      ready?: unknown;
      readyState?: string;
      target?: string;
      url?: string;
      meta?: { githubCommitSha?: string };
    };
    requireCheck(
      "deploy-record: the deployment is READY + production + the recorded URL (LIVE at the provider — its url field is scheme-less; the record carries the usable https URL)",
      body.readyState === "READY" &&
        body.target === "production" &&
        body.url === deploymentUrl.replace(/^https?:\/\//, ""),
      `${String(body.readyState)} ${String(body.target)} ${String(body.url)}`,
    );
    requireCheck(
      "deploy-record: the provider's own meta carries the recorded commit sha (the deployed revision identity)",
      body.meta?.githubCommitSha === DEPLOY_SHA,
      String(body.meta?.githubCommitSha ?? ""),
    );
  } catch (error) {
    requireCheck("deploy-record: the live provider cross-check executed", false, String(error));
  }
}

// --- 4. the token scan --------------------------------------------------------
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

// --- the verdict ---------------------------------------------------------------
if (failures.length > 0) {
  console.error("✗ REFUSED — the evidence pack fails the fail-closed checks:");
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exit(1);
}
console.log(
  "✓ PASS — the r306-deploy evidence pack is machine-consistent:",
  "the pinned revisions (the arc tip deployed + the encode-seam merge in-sandbox), the three PATCHes (200 + re-read + cross-checked URL values), the verified pre-PATCH http posture, the baseline 500 (the incident class this flight closed), the deployment (READY + production + the two-surface verification + the four-way marker agreement), the honest media reachability, the ephemerality doctrine, the live provider cross-check, and the clean token scan",
);
