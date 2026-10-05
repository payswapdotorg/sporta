/**
 * R306 HOSTED RE-FLIGHT — THE PRODUCTION DEPLOYMENT DRIVER (DEVELOPMENT-TIME
 * EVIDENCE, not a test; re-runnable): the r306-deploy precedent
 * (`scripts/evidence/r306-deploy/deploy.ts`) mirrored at the re-flight's own
 * tip — the env re-point (PATCH, production target) + the production
 * deployment baking the LIVE re-flight sandbox worker URLs + the fail-closed
 * verification. Writes `deploy-record.json` (the honest record; a refusal is
 * recorded as a refusal — never fabricated around).
 *
 * Legs:
 *
 *   0. PRECONDITIONS (fail-closed — never PATCH or bake a dead URL):
 *      - VERCEL_TOKEN present (env-only; never echoed, never committed);
 *      - origin/main === the flight-6 record merge (312d2cb — the ADD-only
 *        landing whose whole delta is scripts/-evidence-only, so its upload
 *        set is byte-identical to the flight-5 ingest-seam merge's) and the
 *        repo HEAD is EITHER that merge OR a flight branch whose every changed
 *        path vs it is .vercelignore'd evidence (the deployed source stays
 *        exactly the pinned tree's upload set) with the tracked tree clean
 *        outside the .vercelignore'd `scripts/` evidence paths;
 *      - BOTH sandbox worker URLs LIVE RIGHT NOW from THIS machine (the
 *        media worker's five-operation descriptor + the compute worker's
 *        health AND its `/v1/adapter` descriptor — the boot-time fetch the
 *        composition performs);
 *      - the PRE-DEPLOY PRODUCTION BASELINE measured (the r306-deploy
 *        flight's deployment with its long-dead baked worker URLs — the 62-c
 *        production-500 incident class expected LIVE at this flight's open);
 *      - the CURRENT wiring re-read decrypted (verify, do not assume:
 *        MEDIA_TOOLCHAIN + COMPUTE_PROVIDER must already be `http` — the
 *        65-j PATCHes; this flight does NOT re-PATCH those).
 *
 *   1. THE ENV WIRING — PATCH v10/projects/sporta/env/{id} (production
 *      target, encrypted) for the THREE variables (the env var ids are
 *      DISCOVERED live from the project's env list, never assumed):
 *        MEDIA_TOOLCHAIN_URL → https://3971-<sandbox>.e2b.app
 *        COMPUTE_WORKER_URL  → https://3973-<sandbox>.e2b.app
 *        SPORTA_DEPLOY_MARKER → r306-hosted-reflight-1
 *
 *   2. THE DEPLOYMENT — `bunx vercel deploy --prod --yes --project sporta
 *      --scope ekonplacidegmailcoms-projects` from the repo root (the token
 *      rides the process env — never argv, never echoed). A quota/refusal
 *      is TYPED and recorded, never fabricated around.
 *
 *   3. THE VERIFICATION (fail-closed, measured — the two surfaces):
 *      - the production alias (https://sporta-flame.vercel.app): root 200 +
 *        /api/platform/health 200 WITH the marker (fetches REDIRECT-MANUAL —
 *        a redirect is never laundered into a "200 health"; the SSO-302
 *        null-marker refusal class is on the record and NOT reproduced);
 *      - the deployment's OWN unique URL: the public fetch shape (Vercel
 *        Authentication — a 302 to vercel.com/sso-api, recorded as the shape
 *        it is) + the AUTHENTICATED probe (`bunx vercel curl …/health`, the
 *        token through the process env) exiting 0 with the same marker.
 *
 *   4. THE RECORD — deploy-record.json (the env wiring incl. every PATCH
 *      status + decrypted re-read, the baseline, the deployment, the
 *      verification, the ephemerality doctrine) — exit 0 only on a fully
 *      verified deployment.
 *
 * RE-VERIFICATION MODE: `--reverify` re-runs ONLY the observation + record
 * legs (the PATCHes and the deployment are NOT re-fired). The prior record
 * (this flight's own deploy-record.json) is the history; the deployment id
 * may be passed `--deployment-id <id>` and is cross-checked against the
 * API's latest.
 *
 * Run (from the REPO ROOT):
 *   VERCEL_TOKEN=vcp_… E2B_API_KEY=e2b_… \
 *     bun run scripts/evidence/r306-hosted-reflight/incarnation-4/deploy.ts --sandbox-id <id>
 *   # re-verify only (PATCHes/deploy NOT re-fired):
 *   VERCEL_TOKEN=vcp_… E2B_API_KEY=e2b_… \
 *     bun run scripts/evidence/r306-hosted-reflight/incarnation-4/deploy.ts --reverify \
 *       --deployment-id <id> [--sandbox-id <id>]
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const HERE = dirname(new URL(import.meta.url).pathname);
const OUT_DIR = HERE;
// incarnation-4/ sits one level deeper than the pack root — four levels up
// reach the repo root (the re-runnable location is HERE, same as incarnation-3).
const REPO_ROOT = resolve(HERE, "../../../..");
const RECORD_PATH = resolve(OUT_DIR, "deploy-record.json");

/** The re-flight's tip this flight deploys (origin/main == HEAD or a flight branch with an upload-invisible-only delta, verified). */
const DEPLOY_SHA = "312d2cbecb383053f999b3b4dcd51116ee7932ef";
const PROJECT = "sporta";
const SCOPE = "ekonplacidegmailcoms-projects";
const PRODUCTION_ALIAS = "https://sporta-flame.vercel.app";
const DEPLOY_MARKER = "r306-hosted-reflight-1";
/** The r306-deploy flight's deployment (superseded by this re-flight — the honest lineage). */
const R306_DEPLOYMENT_ID = "dpl_Dgtf629qRgTWEZv6i1DmwCdQmrkt";

const API = "https://api.vercel.com";
const KEEP_ALIVE_MS = 2 * 60 * 60 * 1000;

const argv = process.argv.slice(2);
const reverify = argv.includes("--reverify");
/** In reverify mode: the landed deployment's id (cross-checked against the API's latest). */
const reverifyDeploymentId = (() => {
  const at = argv.indexOf("--deployment-id");
  return at === -1 ? undefined : argv[at + 1];
})();
/** The re-flight sandbox's id (required — the worker URLs are derived from it; never baked dead). */
const sandboxId = (() => {
  const at = argv.indexOf("--sandbox-id");
  return at === -1 ? undefined : argv[at + 1];
})();
if (sandboxId === undefined) {
  console.error("FATAL: --sandbox-id <id> is required (the fresh re-flight sandbox owning both workers)");
  process.exit(1);
}
const MEDIA_PUBLIC_URL = `https://3971-${sandboxId}.e2b.app`;
const COMPUTE_PUBLIC_URL = `https://3973-${sandboxId}.e2b.app`;

const token = process.env.VERCEL_TOKEN;
if (token === undefined || token === "") {
  console.error("FATAL: VERCEL_TOKEN is required (env-only; never echoed, never recorded)");
  process.exit(1);
}
const authHeaders = { Authorization: `Bearer ${token}` };

function log(label: string, value: string): void {
  console.log(`[deploy] ${label}: ${value}`);
}

/** An honest typed refusal: the record is WRITTEN, then the flight STOPS. */
interface TypedRefusal {
  refusalClass: string;
  detail: string;
  verbatimOutputTail?: string;
}
let recordedRefusal: TypedRefusal | undefined;

async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${API}${path}`, {
    ...init,
    headers: { ...authHeaders, ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(60_000),
  });
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

function git(args: string): string {
  const result = spawnSync("git", args.split(" "), { cwd: REPO_ROOT });
  return result.stdout.toString().trim();
}

// ---------------------------------------------------------------------------
// 0. Preconditions — the repo state (+, on a first run: the live worker URLs,
//    the pre-deploy baseline, and the current wiring re-read decrypted).
// ---------------------------------------------------------------------------
const head = git("rev-parse HEAD");
const originMain = git("rev-parse origin/main");
// NOTE: no `.trim()` on the whole output — porcelain's ` M` two-char status
// prefix is positionally meaningful (a leading trim would eat the first
// line's leading space and shift the path column).
const porcelain = spawnSync("git", ["status", "--porcelain"], { cwd: REPO_ROOT })
  .stdout.toString()
  .split("\n")
  .filter((l) => l.length > 0);
log("repo", `HEAD ${head.slice(0, 12)} / origin/main ${originMain.slice(0, 12)}`);
if (originMain !== DEPLOY_SHA) {
  console.error(
    `FATAL: origin/main is not the flight-6 record merge (${originMain} — expected ${DEPLOY_SHA})`,
  );
  process.exit(1);
}
if (head !== DEPLOY_SHA) {
  // HEAD may sit on a flight branch whose commits touch ONLY paths the upload
  // never carries (the .vercelignore'd evidence dirs) — the upload set is
  // enumerated from DEPLOY_SHA's OWN tree, so a branch like that deploys
  // byte-identically. Any upload-visible delta vs the pinned tree stays FATAL.
  const changedVsMain = git(`diff --name-only ${DEPLOY_SHA} ${head}`).split("\n").filter(Boolean);
  const uploadVisible = changedVsMain.filter(
    (p) => !p.startsWith("scripts/") && !p.startsWith("docs/") && !p.startsWith("tests/"),
  );
  if (uploadVisible.length > 0 || changedVsMain.length === 0) {
    console.error(
      `FATAL: HEAD ${head} is not the flight-6 record merge and carries upload-visible changes vs ${DEPLOY_SHA} (${uploadVisible.slice(0, 5).join(", ")})`,
    );
    process.exit(1);
  }
  log(
    "repo",
    `HEAD ${head.slice(0, 12)} is a flight branch (evidence-only changes vs ${DEPLOY_SHA.slice(0, 8)} — the upload set is the pinned tree's, byte-identical)`,
  );
}
// The tracked tree must be clean OUTSIDE the .vercelignore'd scripts/ paths
// (the deployed source is exactly the tracked tree at DEPLOY_SHA — scripts/,
// docs/, tests/ are all excluded by .vercelignore).
const treeOutsideIgnoredPaths = porcelain.filter((l) => {
  const path = l.slice(3).trim();
  return !path.startsWith("scripts/") && !path.startsWith("docs/") && !path.startsWith("tests/");
});
if (treeOutsideIgnoredPaths.length > 0) {
  console.error(
    `FATAL: the tracked tree is dirty outside the ignored evidence paths:\n${treeOutsideIgnoredPaths.join("\n")}`,
  );
  process.exit(1);
}
log(
  "repo",
  `tracked tree clean outside .vercelignore'd paths (${porcelain.length} evidence-only entries under scripts/)`,
);

interface HealthObservation {
  httpStatusCode: number;
  location: string | null;
  deployMarker: string | null;
  fieldsCarried: string[];
  body: Record<string, unknown> | null;
  wallMs: number;
  attempts: number;
}
/**
 * Observes /api/platform/health on a base URL — REDIRECT-MANUAL (a redirect
 * is recorded as the redirect it is: the SSO protection shape on the unique
 * deployment URL, never laundered into a "200 health"). Retries while the
 * expected marker has not shown (the alias needs its flip window; a fresh
 * deployment needs its warmup). The LAST observation is always returned —
 * an honest failing observation, never a fabricated success.
 */
async function observeHealth(
  baseUrl: string,
  attempts: number,
  expectMarker: string,
): Promise<HealthObservation> {
  let last: HealthObservation = {
    httpStatusCode: 0,
    location: null,
    deployMarker: null,
    fieldsCarried: [],
    body: null,
    wallMs: 0,
    attempts: 0,
  };
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const t = Date.now();
    try {
      const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/api/platform/health`, {
        redirect: "manual",
        signal: AbortSignal.timeout(30_000),
      });
      let body: Record<string, unknown> | null = null;
      let marker: string | null = null;
      let fields: string[] = [];
      const location = response.headers.get("location");
      if (response.status === 200) {
        try {
          body = (await response.json()) as Record<string, unknown>;
          marker = typeof body["deployMarker"] === "string" ? body["deployMarker"] : null;
          fields = Object.keys(body).sort();
        } catch {
          body = null;
        }
      }
      last = {
        httpStatusCode: response.status,
        location,
        deployMarker: marker,
        fieldsCarried: fields,
        body,
        wallMs: Date.now() - t,
        attempts: attempt,
      };
      if (response.status === 200 && marker === expectMarker) return last;
    } catch {
      // connection-level refusal — retry (bounded)
    }
    if (attempt < attempts) await new Promise((r) => setTimeout(r, 4000));
  }
  return last;
}

// The authenticated probe of the deployment's OWN surface (`vercel curl` —
// the CLI's documented way past the deployment URL's Vercel Authentication).
interface AuthenticatedProbe {
  command: string;
  exitCode: number | null;
  deployMarker: string | null;
  fieldsCarried: string[];
  body: Record<string, unknown> | null;
  wallMs: number;
}
async function authenticatedHealthProbe(deploymentUrl: string): Promise<AuthenticatedProbe> {
  const t = Date.now();
  const child = spawn("bunx", ["vercel", "curl", `${deploymentUrl.replace(/\/+$/, "")}/api/platform/health`], {
    cwd: REPO_ROOT,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  let err = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    out += chunk.toString("utf8");
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    err += chunk.toString("utf8");
  });
  const exitCode = await new Promise<number | null>((resolveExit) => {
    const killer = setTimeout(() => {
      child.kill("SIGKILL");
      resolveExit(null);
    }, 180_000);
    child.on("exit", (code) => {
      clearTimeout(killer);
      resolveExit(code);
    });
  });
  void err;
  // The CLI's stdout ends with the response body (after curl's progress
  // lines); the LAST JSON-parseable line carrying the document wins.
  let body: Record<string, unknown> | null = null;
  for (const line of out.split("\n").reverse()) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      if ("deployMarker" in parsed || "providers" in parsed) {
        body = parsed;
        break;
      }
    } catch {
      // not the body line — keep scanning
    }
  }
  const marker = typeof body?.["deployMarker"] === "string" ? body["deployMarker"] : null;
  return {
    command: `bunx vercel curl <deployment-url>/api/platform/health (the token through the process env — never argv, never echoed)`,
    exitCode,
    deployMarker: marker,
    fieldsCarried: body === null ? [] : Object.keys(body).sort(),
    body,
    wallMs: Date.now() - t,
  };
}

// The prior record (re-verification mode: its PATCHes + baseline are the
// honest history — re-measured, never re-fired).
interface PriorPatch {
  envVarId: string;
  name: string;
  value: string;
  httpStatusCode: number;
  reReadValue: string | undefined;
}
const priorRecord = existsSync(RECORD_PATH)
  ? (JSON.parse(readFileSync(RECORD_PATH, "utf8")) as {
      envWiring?: { patches?: PriorPatch[]; prePatchVerified?: { values?: Record<string, string | undefined> } };
      baselineMeasured?: Record<string, unknown>;
      deploy?: { deploymentId?: string; deploymentUrl?: string; createdAtMs?: number };
    })
  : undefined;

// The LIVE worker URLs (fail-closed on a FIRST run — never bake a dead URL).
const liveMediaHealth = await fetch(`${MEDIA_PUBLIC_URL}/health`, { signal: AbortSignal.timeout(30_000) });
const liveMediaDescriptor = await fetch(`${MEDIA_PUBLIC_URL}/v1/media/adapter`, {
  signal: AbortSignal.timeout(30_000),
});
const liveMediaDescriptorBody = (await readJson(liveMediaDescriptor)) as Record<string, unknown>;
const liveMediaOps = ((liveMediaDescriptorBody["operations"] as string[] | undefined) ?? [])
  .slice()
  .sort();
const liveComputeHealth = await fetch(`${COMPUTE_PUBLIC_URL}/health`, {
  signal: AbortSignal.timeout(30_000),
});
// THE BOOT-TIME FETCH (compute-adapter-hosted/src/env.ts): GET
// {COMPUTE_WORKER_URL}/v1/adapter over the exact URL the deploy bakes.
const liveComputeDescriptor = await fetch(`${COMPUTE_PUBLIC_URL}/v1/adapter`, {
  signal: AbortSignal.timeout(30_000),
});
log(
  "live workers",
  `media health ${liveMediaHealth.status} + descriptor ${liveMediaDescriptor.status} ([${liveMediaOps.join(", ")}]) / compute health ${liveComputeHealth.status} + descriptor ${liveComputeDescriptor.status}`,
);
if (
  liveMediaHealth.status !== 200 ||
  liveMediaDescriptor.status !== 200 ||
  liveComputeHealth.status !== 200 ||
  liveComputeDescriptor.status !== 200
) {
  console.error("FATAL: a worker URL is not live — refusing to PATCH/deploy a dead URL");
  process.exit(1);
}

// The current wiring, re-read decrypted (verify, do not assume).
const envListResponse = await apiFetch(`/v9/projects/${PROJECT}/env`);
const envList = (await readJson(envListResponse)) as { envs?: { id?: string; key?: string }[] };
const envIdOf = new Map<string, string>();
for (const entry of envList.envs ?? []) {
  if (typeof entry.id === "string" && typeof entry.key === "string") envIdOf.set(entry.key, entry.id);
}
async function readEnvValue(name: string): Promise<string | undefined> {
  const id = envIdOf.get(name);
  if (id === undefined) return undefined;
  const response = await apiFetch(`/v9/projects/${PROJECT}/env/${id}?decrypt=true`);
  if (!response.ok) return undefined;
  const body = (await readJson(response)) as { value?: string };
  return body.value;
}

let patches: PriorPatch[] = priorRecord?.envWiring?.patches ?? [];
const prePatchValues: Record<string, string | undefined> =
  priorRecord?.envWiring?.prePatchVerified?.values ?? {};
let baselineMeasured: Record<string, unknown> = priorRecord?.baselineMeasured ?? {};

if (!reverify) {
  // The pre-deploy production baseline (the r306-deploy flight's deployment
  // with its dead baked worker URLs — the sandbox i5lvv9q3… is long dead).
  const baselineRootResponse = await fetch(`${PRODUCTION_ALIAS}/`, {
    redirect: "manual",
    signal: AbortSignal.timeout(30_000),
  });
  const baselineHealthResponse = await fetch(`${PRODUCTION_ALIAS}/api/platform/health`, {
    redirect: "manual",
    signal: AbortSignal.timeout(30_000),
  });
  const baselineHealthBody = await baselineHealthResponse.text();
  log(
    "baseline (pre-deploy production)",
    `root ${baselineRootResponse.status} / health ${baselineHealthResponse.status} (${baselineHealthBody.length}B body)`,
  );
  baselineMeasured = {
    when: "pre-deploy, from THIS machine (the first invocation)",
    productionAlias: PRODUCTION_ALIAS,
    rootHttpStatusCode: baselineRootResponse.status,
    apiPlatformHealthHttpStatusCode: baselineHealthResponse.status,
    apiPlatformHealthBody: baselineHealthBody,
    note: "the production alias serving the r306-deploy flight's deployment dpl_Dgtf629q with the env's worker URLs dead (the currently-env'd sandbox iuspg21vqeg… long dead at its keep-alive) — the composition's fail-loud boot-time compute-worker descriptor fetch failing → the health route 500 with an empty body (the documented 62-c incident class); THIS is the incident class this re-flight's deployment closes for the closure measure",
  };

  for (const name of [
    "MEDIA_TOOLCHAIN",
    "MEDIA_TOOLCHAIN_URL",
    "COMPUTE_PROVIDER",
    "COMPUTE_WORKER_URL",
    "SPORTA_DEPLOY_MARKER",
  ]) {
    prePatchValues[name] = await readEnvValue(name);
  }
  log(
    "pre-PATCH wiring (decrypted)",
    `MEDIA_TOOLCHAIN=${prePatchValues["MEDIA_TOOLCHAIN"]} COMPUTE_PROVIDER=${prePatchValues["COMPUTE_PROVIDER"]} MARKER=${prePatchValues["SPORTA_DEPLOY_MARKER"]}`,
  );
  if (prePatchValues["MEDIA_TOOLCHAIN"] !== "http" || prePatchValues["COMPUTE_PROVIDER"] !== "http") {
    console.error(
      "FATAL: the http posture is NOT set (MEDIA_TOOLCHAIN/COMPUTE_PROVIDER) — the r306-deploy record said it was; refusing to deploy on an unverified posture",
    );
    process.exit(1);
  }

  // -------------------------------------------------------------------------
  // 1. The env wiring — the three PATCHes (production target, encrypted).
  // -------------------------------------------------------------------------
  const patchTargets: { name: string; value: string }[] = [
    { name: "MEDIA_TOOLCHAIN_URL", value: MEDIA_PUBLIC_URL },
    { name: "COMPUTE_WORKER_URL", value: COMPUTE_PUBLIC_URL },
    { name: "SPORTA_DEPLOY_MARKER", value: DEPLOY_MARKER },
  ];
  patches = [];
  for (const target of patchTargets) {
    const envVarId = envIdOf.get(target.name);
    if (envVarId === undefined) {
      console.error(`FATAL: no env var id discovered for ${target.name}`);
      process.exit(1);
    }
    const response = await apiFetch(`/v10/projects/${PROJECT}/env/${envVarId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: target.value, type: "encrypted", target: ["production"] }),
    });
    const reReadValue = await readEnvValue(target.name);
    log(
      `PATCH ${target.name}`,
      `HTTP ${response.status} (re-read: ${reReadValue === target.value ? "matches" : `MISMATCH: ${String(reReadValue)}`})`,
    );
    patches.push({ envVarId, name: target.name, value: target.value, httpStatusCode: response.status, reReadValue });
  }
  if (patches.some((p) => p.httpStatusCode !== 200 || p.reReadValue !== p.value)) {
    console.error("FATAL: an env PATCH refused (status or re-read mismatch above) — NOT deploying");
    process.exit(1);
  }

  // -------------------------------------------------------------------------
  // 2. The deployment (the CLI; the token rides the process env).
  // -------------------------------------------------------------------------
  const tDeploy = Date.now();
  const deployChild = spawn(
    "bunx",
    ["vercel", "deploy", "--prod", "--yes", "--project", PROJECT, "--scope", SCOPE],
    { cwd: REPO_ROOT, env: process.env, stdio: ["ignore", "pipe", "pipe"] },
  );
  let deployStdout = "";
  let deployStderr = "";
  deployChild.stdout?.on("data", (chunk: Buffer) => {
    deployStdout += chunk.toString("utf8");
  });
  deployChild.stderr?.on("data", (chunk: Buffer) => {
    deployStderr += chunk.toString("utf8");
  });
  const deployExit = await new Promise<number | null>((resolveExit) => {
    const killer = setTimeout(() => {
      deployChild.kill("SIGKILL");
      resolveExit(null);
    }, 900_000);
    deployChild.on("exit", (code) => {
      clearTimeout(killer);
      resolveExit(code);
    });
  });
  const deployOutput = `${deployStdout}\n${deployStderr}`;
  log("deploy exit", `code ${String(deployExit)} in ${Date.now() - tDeploy}ms`);

  // The refusal classification (the 65-j quota class and friends — TYPED honestly).
  const refusalMatch = deployOutput.match(
    /(free-per-day|daily deployment limit|deployment quota|exceeded.{0,40}limit|limit.{0,40}exceeded|You have reached your plan)/i,
  );
  if (deployExit !== 0) {
    const refusalToken = refusalMatch?.[1];
    recordedRefusal = {
      refusalClass:
        refusalToken !== undefined
          ? `api-deployments-${refusalToken.toLowerCase().replace(/[^a-z-]/g, "-").replace(/-+/g, "-")}`
          : "vercel-deploy-cli-non-zero-exit",
      detail: `the deploy CLI exited ${String(deployExit)} after ${Date.now() - tDeploy}ms`,
      verbatimOutputTail: deployOutput.trim().split("\n").slice(-20).join("\n"),
    };
    log("DEPLOY REFUSED", recordedRefusal.refusalClass);
  }
}

// ---------------------------------------------------------------------------
// 3. The deployment observation (the API is the arbiter).
// ---------------------------------------------------------------------------
interface DeploymentObservation {
  deploymentId: string;
  deploymentUrl: string;
  state: string;
  target: string | null;
  createdAtMs: number;
  readyAtMs: number | null;
}
async function fetchDeployment(): Promise<DeploymentObservation | undefined> {
  const projectResponse = await apiFetch(`/v9/projects/${PROJECT}`);
  const project = (await readJson(projectResponse)) as {
    latestDeployments?: {
      id?: string;
      url?: string;
      readyState?: string;
      target?: string | null;
      createdAt?: number;
      readyAt?: number;
    }[];
  };
  const latest = project.latestDeployments?.[0];
  if (latest === undefined || typeof latest.id !== "string" || typeof latest.url !== "string") {
    return undefined;
  }
  return {
    deploymentId: latest.id,
    deploymentUrl: latest.url.startsWith("http") ? latest.url : `https://${latest.url}`,
    state: String(latest.readyState ?? "unknown"),
    target: latest.target ?? null,
    createdAtMs: Number(latest.createdAt ?? 0),
    readyAtMs: latest.readyAt ?? null,
  };
}
let deployment: DeploymentObservation | undefined;
if (recordedRefusal === undefined) {
  const observed = await fetchDeployment();
  const expectedId = priorRecord?.deploy?.deploymentId ?? reverifyDeploymentId;
  if (
    observed !== undefined &&
    (reverify
      ? observed.deploymentId === expectedId
      : observed.createdAtMs > (priorRecord?.deploy?.createdAtMs ?? 0))
  ) {
    deployment = observed;
    log(
      "deployment (API)",
      `${deployment.deploymentId} → ${deployment.deploymentUrl} state=${deployment.state} target=${String(deployment.target)} created=${deployment.createdAtMs}`,
    );
  } else if (reverify) {
    console.error(
      `FATAL: --reverify expected deployment ${String(expectedId)} but production's latest is ${observed?.deploymentId}`,
    );
    process.exit(1);
  } else {
    recordedRefusal = {
      refusalClass: "deployment-not-observable-via-api",
      detail: "GET /v9/projects/sporta latestDeployments carried no new readable deployment after a zero-exit deploy",
    };
  }
}

// The verification (fail-closed, measured — the two surfaces).
let aliasHealth: HealthObservation | null = null;
let deploymentUrlShape: HealthObservation | null = null;
let deploymentProbe: AuthenticatedProbe | null = null;
let aliasRootStatusCode: number | null = null;
if (deployment !== undefined) {
  aliasRootStatusCode = await fetch(`${PRODUCTION_ALIAS}/`, {
    redirect: "manual",
    signal: AbortSignal.timeout(30_000),
  }).then((r) => r.status);
  // The PUBLIC surface: the production alias (bounded retries through the
  // alias flip window).
  aliasHealth = await observeHealth(PRODUCTION_ALIAS, 20, DEPLOY_MARKER);
  // The DEPLOYMENT'S OWN URL: informational (the protection shape), a few
  // attempts only — a 302 to vercel.com/sso-api is the expected honest shape.
  deploymentUrlShape = await observeHealth(deployment.deploymentUrl, 2, DEPLOY_MARKER);
  // The AUTHENTICATED probe of the deployment's own surface.
  deploymentProbe = await authenticatedHealthProbe(deployment.deploymentUrl);
  log(
    "verification",
    `alias root ${String(aliasRootStatusCode)} / alias health ${aliasHealth.httpStatusCode} (marker ${String(aliasHealth.deployMarker)}, attempt ${aliasHealth.attempts}) / deployment-url public shape ${deploymentUrlShape.httpStatusCode} / authenticated probe exit ${String(deploymentProbe.exitCode)} (marker ${String(deploymentProbe.deployMarker)})`,
  );
}

const verificationFailures: string[] = [];
if (recordedRefusal === undefined && deployment !== undefined) {
  if (deployment.state !== "READY") {
    verificationFailures.push(`deployment state ${deployment.state} (expected READY)`);
  }
  if (deployment.target !== "production") {
    verificationFailures.push(`deployment target ${String(deployment.target)} (expected production)`);
  }
  if (aliasRootStatusCode !== 200) {
    verificationFailures.push(`production alias root HTTP ${String(aliasRootStatusCode)}`);
  }
  if (aliasHealth?.httpStatusCode !== 200 || aliasHealth?.deployMarker !== DEPLOY_MARKER) {
    verificationFailures.push(
      `production alias health ${String(aliasHealth?.httpStatusCode)}/${String(aliasHealth?.deployMarker)} (expected 200/${DEPLOY_MARKER})`,
    );
  }
  if (deploymentProbe?.exitCode !== 0 || deploymentProbe?.deployMarker !== DEPLOY_MARKER) {
    verificationFailures.push(
      `authenticated deployment probe exit ${String(deploymentProbe?.exitCode)}/marker ${String(deploymentProbe?.deployMarker)} (expected 0/${DEPLOY_MARKER})`,
    );
  }
}
if (verificationFailures.length > 0) {
  console.error(`FATAL: the verification refused:\n  ${verificationFailures.join("\n  ")}`);
  if (recordedRefusal === undefined) {
    recordedRefusal = {
      refusalClass: "verification-failed",
      detail: verificationFailures.join("; "),
    };
  }
}

// The sandbox lifetime state at record-write (the ephemerality doctrine's leg).
// GUARDED (the incarnation-4 delta): the boot-compute record may legitimately
// not exist yet (this driver's first run can precede the boot-compute leg —
// the sandbox record from the orchestrator is the fallback source; a missing
// record is recorded as the honest null, never a crash).
const computeWorkerRecordPath = resolve(HERE, "compute-worker-record.json");
const sandboxRecord = existsSync(computeWorkerRecordPath)
  ? (JSON.parse(readFileSync(computeWorkerRecordPath, "utf8")) as {
      provider?: { sandbox?: { sandboxId?: string; startedAtIso?: string; keepAliveReExtendedAtIso?: string } };
    })
  : existsSync(resolve(HERE, "sandbox-record.json"))
    ? (JSON.parse(readFileSync(resolve(HERE, "sandbox-record.json"), "utf8")) as {
        provider?: { sandbox?: { sandboxId?: string; startedAtIso?: string; keepAliveReExtendedAtIso?: string } };
      })
    : {};
const mediaWorkerUrlLiveAtWrite = (await fetch(`${MEDIA_PUBLIC_URL}/health`, {
  signal: AbortSignal.timeout(30_000),
})
  .then((r) => r.status)
  .catch(() => "error")) as number | string;
const computeWorkerUrlLiveAtWrite = (await fetch(`${COMPUTE_PUBLIC_URL}/health`, {
  signal: AbortSignal.timeout(30_000),
})
  .then((r) => r.status)
  .catch(() => "error")) as number | string;
log(
  "sandbox at record-write",
  `media ${String(mediaWorkerUrlLiveAtWrite)} / compute ${String(computeWorkerUrlLiveAtWrite)}`,
);

// ---------------------------------------------------------------------------
// 4. The honest record.
// ---------------------------------------------------------------------------
const record = {
  schemaVersion: "1.1",
  kind: "r306-hosted-reflight-deploy-record",
  note: reverify
    ? "the R306 hosted re-flight (flight 6 — the 4/4 closure measure) — the deploy leg (the r306-deploy precedent mirrored at the re-flight tip: the env re-point + the production deployment baking the LIVE re-flight sandbox worker URLs + the fail-closed verification). THIS record was FINALIZED by a --reverify invocation: the PATCHes and the deployment were NOT re-fired; the observation legs re-measured everything below"
    : "the R306 hosted re-flight (flight 6 — the 4/4 closure measure) — the deploy leg (the r306-deploy precedent mirrored at the re-flight tip: the env re-point + the production deployment baking the LIVE re-flight sandbox worker URLs + the fail-closed verification)",
  envWiring: {
    method:
      "PATCH v10/projects/sporta/env/{id} (production target, encrypted) — BEFORE the deploy so the new deployment bakes the live re-flight sandbox URLs (the env var ids DISCOVERED live from GET /v9/projects/sporta/env, never assumed)",
    prePatchVerified: {
      note: "every value re-read DECRYPTED before any PATCH (verify, do not assume)",
      values: prePatchValues,
      posture: "MEDIA_TOOLCHAIN=http + COMPUTE_PROVIDER=http confirmed live (the 65-j PATCHes — still correct; NOT re-PATCHed this flight)",
      deadUrlMeasured:
        "the pre-PATCH MEDIA_TOOLCHAIN_URL/COMPUTE_WORKER_URL pointed at the r306-deploy flight's sandbox (3971/3973-i5lvv9q3jrumm914o1rca) — DEAD since that sandbox's timeout; the pre-deploy production baseline below measures the incident class that posture was serving",
    },
    patches,
    unpatched: [
      "MEDIA_TOOLCHAIN=http (the 65-j PATCH — re-verified decrypted, still correct)",
      "COMPUTE_PROVIDER=http (the 65-j PATCH — re-verified decrypted, still correct)",
    ],
  },
  deploy:
    recordedRefusal !== undefined || deployment === undefined
      ? {
          command:
            "bunx vercel deploy --prod --yes --project sporta --scope ekonplacidegmailcoms-projects (from the repo root; the token through the process env — never argv, never echoed)",
          repoState: {
            HEAD: head,
            originMain: originMain,
            note: "the deployed source is exactly the tracked tree at the re-flight tip (.vercelignore excludes scripts/ docs/ tests/ — the evidence dirs ride outside the upload)",
          },
          outcome: "REFUSED",
          refusal: recordedRefusal,
        }
      : {
          command:
            "bunx vercel deploy --prod --yes --project sporta --scope ekonplacidegmailcoms-projects (from the repo root; the token through the process env — never argv, never echoed)",
          repoState: {
            HEAD: head,
            originMain: originMain,
            note: "the deployed source is exactly the tracked tree at the re-flight tip (.vercelignore excludes scripts/ docs/ tests/ — the evidence dirs ride outside the upload)",
          },
          outcome: "DEPLOYED",
          deploymentId: deployment.deploymentId,
          deploymentUrl: deployment.deploymentUrl,
          state: deployment.state,
          target: deployment.target,
          createdAtMs: deployment.createdAtMs,
          readyAtMs: deployment.readyAtMs,
          productionAlias: PRODUCTION_ALIAS,
          deployMarker: DEPLOY_MARKER,
          priorDeploymentSuperseded: {
            deploymentId: R306_DEPLOYMENT_ID,
            note: "the r306-deploy flight's deployment (marker r306-encode-seam-deploy-1) whose BAKED worker URLs were the dead i5lvv9q3… sandbox — the 62-c production-500 incident class LIVE at this flight's open (the pre-deploy baseline measured below); superseded by this re-flight's deployment baking LIVE worker URLs",
          },
        },
  baselineMeasured,
  productionMeasured:
    deployment === undefined
      ? null
      : {
          deploymentUrl: deployment.deploymentUrl,
          thePublicSurface: {
            productionAlias: PRODUCTION_ALIAS,
            rootHttpStatusCode: aliasRootStatusCode,
            apiPlatformHealth: {
              httpStatusCode: aliasHealth?.httpStatusCode ?? null,
              deployMarker: aliasHealth?.deployMarker ?? null,
              fieldsCarried: aliasHealth?.fieldsCarried ?? [],
              body: aliasHealth?.body ?? null,
              wallMs: aliasHealth?.wallMs ?? null,
              attempts: aliasHealth?.attempts ?? null,
              note: "the production alias flipped to this deployment and serves the marker (fetches REDIRECT-MANUAL — a redirect is never laundered into a 200)",
            },
          },
          theDeploymentsOwnSurface: {
            deploymentUrl: deployment.deploymentUrl,
            publicFetchShape: {
              httpStatusCode: deploymentUrlShape?.httpStatusCode ?? null,
              location: deploymentUrlShape?.location ?? null,
              note: "Vercel Authentication (Standard Protection) — the unique deployment URL answers 302 → vercel.com/sso-api to the public fetch; recorded as the SHAPE it is, never as health",
            },
            authenticatedProbe: {
              command: deploymentProbe?.command ?? null,
              exitCode: deploymentProbe?.exitCode ?? null,
              deployMarker: deploymentProbe?.deployMarker ?? null,
              fieldsCarried: deploymentProbe?.fieldsCarried ?? [],
              body: deploymentProbe?.body ?? null,
              wallMs: deploymentProbe?.wallMs ?? null,
              note: "`vercel curl` — the CLI's authenticated probe past the deployment protection (the token through the process env); the deployment's OWN runtime answered the health document with the marker",
            },
          },
          bootTimeComputeDescriptorFetch:
            "SUCCEEDED — evidenced by the health route answering 200 AT ALL (both surfaces above): the composition's fail-loud boot fetches GET {COMPUTE_WORKER_URL}/v1/adapter (compute-adapter-hosted/src/env.ts); its failure kills the composition and every API route answers 500 with an empty body (the 62-c incident class — measured live as this flight's pre-deploy baseline on the superseded r306-deploy deployment)",
          mediaDescriptorReachability: {
            fromTheDeployedRuntime: {
              measurable: false,
              honestNote:
                "the health answer carries NO media-toolchain fields (its own field list recorded above — env/deployMarker/providers/renderQueue/usageGuardrails); the media seam is composition-lazy (resolveMediaToolchainFromEnv constructs the http executor + decode port + encode pair WITHOUT a boot-time descriptor fetch — only the COMPUTE worker's descriptor is fail-loud at boot); the deployed runtime's OWN media-descriptor fetch is therefore not separately observable from the health answer — the re-flight walk measures the deployed runtime's media leg end-to-end",
            },
            fromThisMachine: {
              url: MEDIA_PUBLIC_URL,
              healthHttpStatusCode: liveMediaHealth.status,
              descriptorHttpStatusCode: liveMediaDescriptor.status,
              operationsAdvertised: liveMediaOps,
              note: "measured from THIS machine over the exact URL the deployment baked (the orchestrating host's network position — the same position the re-flight orchestrator measured from)",
            },
          },
        },
  ephemeralityDoctrine: {
    measuredLive:
      "the baked URLs are EPHEMERAL: the sandbox dies at its timeout and the incident class (a baked ephemeral URL) re-manifests on its death — the r607 flight measured it twice, and THIS flight measured the current manifestation as its pre-deploy baseline (the r306-deploy deployment 500ing on production with its dead baked URLs)",
    sandbox: {
      sandboxId: String(sandboxRecord.provider?.sandbox?.sandboxId ?? sandboxId),
      startedAtIso: sandboxRecord.provider?.sandbox?.startedAtIso ?? null,
      keepAliveMs: KEEP_ALIVE_MS,
      lastReExtendedAtIso: sandboxRecord.provider?.sandbox?.keepAliveReExtendedAtIso ?? null,
      lifecycleOnTimeout: "kill",
      mediaWorkerUrlLiveAtRecordWrite: mediaWorkerUrlLiveAtWrite,
      computeWorkerUrlLiveAtRecordWrite: computeWorkerUrlLiveAtWrite,
      note: "the keep-alive is 2 h from the LAST orchestration/boot invocation; at the timeout the sandbox dies, both public worker URLs answer the E2B proxy's 502 'The sandbox was not found', and the boot-time compute descriptor fetch fails → the 500 class returns to whatever deployment still bakes this URL",
    },
    theHonestPosture:
      "every record in this tree states which sandbox/deployment it measured; a dead worker URL is a typed refusal at the composition, never a laundered availability; the re-runnable procedure (commands.md) re-executes the whole chain against a fresh sandbox in ~30 minutes",
    theOperatorDecision:
      "a PERSISTENT worker host (a long-lived deployment) is the production posture's closure — named in the status row, never improvised by a worker",
  },
  credentialsDiscipline:
    "VERCEL_TOKEN + E2B_API_KEY env-only (never echoed in full, never committed; the record carries no secrets; the tree is scanned for the vcp_/e2b_ prefixes)",
};

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(RECORD_PATH, JSON.stringify(record, null, 2) + "\n");
log("record", RECORD_PATH);

if (recordedRefusal !== undefined) {
  console.error(`=== THE R306 HOSTED RE-FLIGHT DEPLOY LEG: REFUSED (${recordedRefusal.refusalClass}) — recorded honestly ===`);
  process.exit(1);
}

console.log("=== THE R306 HOSTED RE-FLIGHT DEPLOY LEG: DEPLOYED + VERIFIED (measured) ===");
console.log(`deployment:  ${deployment?.deploymentId} (${deployment?.state}, ${String(deployment?.target)})`);
console.log(`url:         ${deployment?.deploymentUrl}`);
console.log(
  `alias:       ${PRODUCTION_ALIAS} (root ${String(aliasRootStatusCode)}, health ${String(aliasHealth?.httpStatusCode)}, marker ${String(aliasHealth?.deployMarker)})`,
);
console.log(`patches:     ${patches.map((p) => `${p.name} ${p.httpStatusCode}`).join(" / ")}`);
console.log(
  `probe:       vercel curl exit ${String(deploymentProbe?.exitCode)}, marker ${String(deploymentProbe?.deployMarker)} (deployment URL public shape ${String(deploymentUrlShape?.httpStatusCode)} — Vercel Authentication)`,
);
console.log(`record:      ${RECORD_PATH}`);
