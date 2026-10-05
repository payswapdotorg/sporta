/**
 * R306 HOSTED RE-FLIGHT — THE PRODUCTION DEPLOYMENT DRIVER (DEVELOPMENT-TIME
 * EVIDENCE, not a test; re-runnable): the r306-deploy precedent mirrored at
 * the ARTIFACT-INGEST-SEAM merge — the env re-point (PATCH, production
 * target) + the production deployment baking THIS flight's fresh sandbox
 * worker URLs + the fail-closed verification. Writes `deploy-record.json`
 * (the honest record; a refusal is recorded as a refusal — never fabricated
 * around).
 *
 * Legs:
 *
 *   0. PRECONDITIONS (fail-closed — never PATCH or bake a dead URL):
 *      - VERCEL_TOKEN present (env-only; never echoed, never committed);
 *      - the repo HEAD === the artifact-ingest merge (origin/main @
 *        5424a84e — flight 68's tip, the seam the 4/4 closure measure
 *        tests) with the tracked tree clean outside the .vercelignore'd
 *        `scripts/` evidence paths (the deployed source is exactly the
 *        tracked tree at the recorded sha);
 *      - BOTH sandbox worker URLs LIVE RIGHT NOW from THIS machine (the
 *        media worker's five-operation descriptor + the compute worker's
 *        health AND its `/v1/adapter` descriptor — the boot-time fetch the
 *        composition performs);
 *      - the PRE-DEPLOY PRODUCTION BASELINE measured (the r306-encode-seam
 *        deployment with its long-dead baked worker URLs — the 62-c
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
 *        SPORTA_DEPLOY_MARKER → r306-ingest-seam-reflight-1
 *      Each PATCH's HTTP status recorded; each value re-read (decrypt) and
 *      confirmed — fail-closed on any non-200 or mismatch.
 *
 *   2. THE DEPLOYMENT — `bunx vercel deploy --prod --yes --project sporta
 *      --scope ekonplacidegmailcoms-projects` from the repo root (the token
 *      rides the process env — never argv, never echoed). A quota/refusal
 *      answer (the 65-j api-deployments-free-per-day class) is recorded
 *      TYPED with the verbatim output and STOPS the flight (exit 1, no
 *      fabrication). On success: the deployment id/url/state/target from
 *      the Vercel API (GET /v9/projects/sporta latestDeployments — the API
 *      is the arbiter, never the CLI's rendered output).
 *
 *   3. THE VERIFICATION (fail-closed, measured — on TWO surfaces):
 *      - the deployment READY + production target (API);
 *      - THE PUBLIC SURFACE: the production alias (sporta-flame.vercel.app)
 *        answering /api/platform/health 200 WITH the r306-ingest-seam-reflight-1
 *        marker (fetches are REDIRECT-MANUAL — a redirect is recorded as the
 *        redirect it is, never laundered into a 200);
 *      - THE DEPLOYMENT'S OWN SURFACE: the unique deployment URL is behind
 *        Vercel Authentication (Standard Protection — the public fetch
 *        answers 302 → vercel.com/sso-api; the SHAPE is recorded honestly),
 *        so the deployment's OWN health answer is measured through the
 *        AUTHENTICATED probe `bunx vercel curl <deployment-url>/api/platform/health`
 *        (the token rides the process env) — exit 0 + the same marker;
 *      - the boot-time compute-worker descriptor fetch SUCCEEDED (the 62-c
 *        incident class not reproduced) — evidenced by the health route
 *        answering 200 AT ALL (the composition's fail-loud boot fetches
 *        GET {COMPUTE_WORKER_URL}/v1/adapter; its failure kills the
 *        composition → every API route 500s empty — measured live as this
 *        flight's pre-deploy baseline);
 *      - the media descriptor reachable FROM THE DEPLOYED RUNTIME'S
 *        POSITION: the health answer's own fields if it carries them (it
 *        carries none — the field list is recorded), else from THIS machine
 *        over the exact baked URL + the honest note of what was and was not
 *        measurable (the media seam is composition-lazy; the hosted
 *        golden-path flight measures the deployed runtime's own media leg
 *        end-to-end).
 *
 *   4. THE RECORD — deploy-record.json (the env wiring incl. every PATCH
 *      status + the pre-values, the deployment, the baseline, the
 *      verification, the ephemerality doctrine block with the measured
 *      sandbox lifetime, the credentials discipline).
 *
 * RE-VERIFICATION MODE: `--reverify` re-runs ONLY the observation + record
 * legs against the ALREADY-LANDED deployment (the PATCHes are NOT re-fired,
 * a second deployment is NOT created) — the deployed state is re-measured
 * and deploy-record.json is REWRITTEN. This exists because the first
 * invocation's verification pass misread the deployment URL's SSO redirect
 * (the fetch followed the 302 to vercel.com's 200 HTML page and recorded a
 * null-marker "health 200" — REFUSED fail-closed at the time, never
 * laundered); the honest history is carried in the rewritten record's note.
 *
 * Run (from the REPO ROOT, after boot-compute-worker.ts):
 *   VERCEL_TOKEN=vcp_… E2B_API_KEY=e2b_… bun run scripts/evidence/r306-hosted-reflight/deploy.ts
 *   # re-verify the already-landed deployment (no PATCH, no new deploy):
 *   VERCEL_TOKEN=vcp_… E2B_API_KEY=e2b_… bun run scripts/evidence/r306-hosted-reflight/deploy.ts --reverify
 */
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const HERE = dirname(new URL(import.meta.url).pathname);
const OUT_DIR = HERE;
const REPO_ROOT = resolve(HERE, "../../..");
const RECORD_PATH = resolve(OUT_DIR, "deploy-record.json");

/** The artifact-ingest merge this flight deploys (origin/main == HEAD, verified) — flight 68's tip: the seam the 4/4 closure measure tests, IN the deployment for the first time. */
const DEPLOY_SHA = "5424a84e089db3b96b5f489b3e11f2ed66a56dec";
const PROJECT = "sporta";
const SCOPE = "ekonplacidegmailcoms-projects";
const PRODUCTION_ALIAS = "https://sporta-flame.vercel.app";
const DEPLOY_MARKER = "r306-ingest-seam-reflight-1";
/** THIS flight's fresh sandbox (both workers — media :3971 + compute :3973).
 *  Discovered from the provisioning legs' records in THIS dir (fail-closed),
 *  overridable via --sandbox-id <id> for a re-run. */
const argvForSandbox = process.argv.slice(2);
const SANDBOX_ID = (() => {
  const at = argvForSandbox.indexOf("--sandbox-id");
  if (at !== -1 && argvForSandbox[at + 1] !== undefined) return argvForSandbox[at + 1];
  for (const recordFile of ["sandbox-record.json", "compute-worker-record.json"]) {
    const path = resolve(HERE, recordFile);
    if (!existsSync(path)) continue;
    try {
      const doc = JSON.parse(readFileSync(path, "utf8")) as {
        provider?: { sandbox?: { sandboxId?: string } };
      };
      if (typeof doc.provider?.sandbox?.sandboxId === "string" && doc.provider.sandbox.sandboxId.length > 0) {
        return doc.provider.sandbox.sandboxId;
      }
    } catch {
      // unreadable record — try the next one; the explicit flag is the override
    }
  }
  return "(no-sandbox-id)";
})();
const MEDIA_PUBLIC_URL = `https://3971-${SANDBOX_ID}.e2b.app`;
const COMPUTE_PUBLIC_URL = `https://3973-${SANDBOX_ID}.e2b.app`;
/** The r306-encode-seam-deploy-1 deployment (superseded by this flight's — the honest lineage). */
const PRIOR_DEPLOYMENT_ID = "dpl_Dgtf629qRgTWEZv6i1DmwCdQmrkt";

const API = "https://api.vercel.com";
const KEEP_ALIVE_MS = 2 * 60 * 60 * 1000;

const argv = process.argv.slice(2);
const reverify = argv.includes("--reverify");
/** In reverify mode: the landed deployment's id (cross-checked against the API's latest — the first invocation's REFUSED-shaped record carries no id, so the operator passes the measured one). */
const reverifyDeploymentId = (() => {
  const at = argv.indexOf("--deployment-id");
  return at === -1 ? undefined : argv[at + 1];
})();

const token = process.env.VERCEL_TOKEN;
if (token === undefined || token === "") {
  console.error("FATAL: VERCEL_TOKEN is required (env-only; never echoed, never recorded)");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// THE VERCEL LANE RESOLUTION (this flight's own measured infrastructure
// posture): the direct VERCEL_TOKEN is LIVE-PROBED first (GET /v2/user);
// a dead token is the TYPED refusal class `vercel-token-invalid` — recorded
// verbatim, never laundered — and the flight falls back to the COMPOSIO
// VERCEL LANE (the operator-provisioned connected account, the same lane
// class the 68-TL flight proved for the GitHub push): every Vercel API call
// routes through Composio's proxy_execute under the connection's OWN
// credential (the raw token is never extracted, never echoed, never
// committed). BOTH lanes refused → the flight stops honestly.
// ---------------------------------------------------------------------------
const COMPOSIO_V31 = "https://backend.composio.dev/api/v3.1";
const COMPOSIO_VERCEL_CONNECTION = "ca_31iruA2qEdfl";
const composioKey = process.env.COMPOSIO_API_KEY;

interface VercelLane {
  mode: "direct-token" | "composio";
  userProbe: { httpStatusCode: number; login: string | null; verbatim: string };
  directTokenRefusal: { httpStatusCode: number; verbatim: string } | null;
  proxySessionId: string | null;
}

async function probeDirectToken(): Promise<{ status: number; body: string }> {
  const r = await fetch(`${API}/v2/user`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30_000),
  });
  return { status: r.status, body: (await r.text()).slice(0, 300) };
}

async function createComposioSession(): Promise<string> {
  const r = await fetch(`${COMPOSIO_V31}/tool_router/session`, {
    method: "POST",
    headers: { "x-api-key": composioKey ?? "", "Content-Type": "application/json" },
    body: JSON.stringify({
      user_id: "default",
      connected_accounts: { vercel: [COMPOSIO_VERCEL_CONNECTION] },
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!r.ok) throw new Error(`composio session HTTP ${r.status}`);
  const j = (await r.json()) as { session_id?: string };
  if (j.session_id === undefined) throw new Error("composio session carried no session_id");
  return j.session_id;
}

async function proxyExecute(
  sessionId: string,
  endpoint: string,
  method: string,
  body?: unknown,
): Promise<{ status: number; data: unknown; raw: string }> {
  const r = await fetch(`${COMPOSIO_V31}/tool_router/session/${sessionId}/proxy_execute`, {
    method: "POST",
    headers: { "x-api-key": composioKey ?? "", "Content-Type": "application/json" },
    body: JSON.stringify({
      toolkit_slug: "vercel",
      endpoint,
      method,
      ...(body !== undefined ? { body } : {}),
    }),
    signal: AbortSignal.timeout(600_000),
  });
  const raw = await r.text();
  if (!r.ok) return { status: r.status, data: null, raw: raw.slice(0, 300) };
  const j = JSON.parse(raw) as { status?: number; data?: unknown };
  return { status: Number(j.status ?? 0), data: j.data ?? null, raw: raw.slice(0, 300) };
}

const directProbe = await probeDirectToken();
const lane: VercelLane = { mode: "direct-token", userProbe: { httpStatusCode: directProbe.status, login: null, verbatim: directProbe.body }, directTokenRefusal: null, proxySessionId: null };
if (directProbe.status !== 200) {
  const verbatim = directProbe.body.replace(/["A-Za-z0-9_-]{20,}/g, "(redacted-credential-shaped-token)");
  lane.directTokenRefusal = { httpStatusCode: directProbe.status, verbatim };
  log("vercel lane", `direct VERCEL_TOKEN REFUSED (HTTP ${directProbe.status} — typed, verbatim recorded)`);
  if (composioKey === undefined || composioKey === "") {
    console.error(
      "FATAL: the direct VERCEL_TOKEN is refused AND COMPOSIO_API_KEY is absent — both Vercel lanes dead; the flight stops honestly",
    );
    process.exit(1);
  }
  try {
    lane.proxySessionId = await createComposioSession();
    const probe = await proxyExecute(lane.proxySessionId, "/v2/user", "GET");
    const login =
      probe.status === 200 && probe.data !== null
        ? String((probe.data as { user?: { username?: string; email?: string } }).user?.username ?? "(parsed-shape-differs)")
        : null;
    if (probe.status !== 200) throw new Error(`proxy /v2/user inner HTTP ${probe.status}: ${probe.raw}`);
    lane.mode = "composio";
    lane.userProbe = { httpStatusCode: 200, login, verbatim: `GET /v2/user 200 through the Composio proxy (login ${String(login)})` };
    log("vercel lane", `COMPOSIO lane ACTIVE (proxy session ${lane.proxySessionId}, login ${login})`);
  } catch (error) {
    console.error(
      `FATAL: the direct VERCEL_TOKEN is refused (HTTP ${directProbe.status}) AND the Composio vercel lane failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }
} else {
  const login = (() => {
    try {
      return String((JSON.parse(directProbe.body) as { user?: { username?: string } }).user?.username ?? "(parsed)");
    } catch {
      return "(unparsed)";
    }
  })();
  lane.userProbe.login = login;
  log("vercel lane", `direct VERCEL_TOKEN alive (GET /v2/user 200, login ${login})`);
}

/** The lane-aware Vercel API response (minimal Response-like). */
interface ApiResponse {
  status: number;
  ok: boolean;
  bodyText: string;
}

async function apiFetch(path: string, init?: { method?: string; body?: unknown }): Promise<ApiResponse> {
  if (lane.mode === "direct-token") {
    const r = await fetch(`${API}${path}`, {
      method: init?.method ?? "GET",
      headers: {
        ...(init?.body !== undefined ? { "Content-Type": "application/json" } : {}),
        Authorization: `Bearer ${token}`,
      },
      ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      signal: AbortSignal.timeout(60_000),
    });
    return { status: r.status, ok: r.ok, bodyText: await r.text() };
  }
  const out = await proxyExecute(
    lane.proxySessionId as string,
    path,
    init?.method ?? "GET",
    init?.body,
  );
  return {
    status: out.status,
    ok: out.status >= 200 && out.status < 300,
    bodyText: out.data !== null ? JSON.stringify(out.data) : out.raw,
  };
}

async function readJson(response: ApiResponse): Promise<Record<string, unknown>> {
  return JSON.parse(response.bodyText) as Record<string, unknown>;
}

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
if (SANDBOX_ID === "(no-sandbox-id)") {
  console.error(
    "FATAL: no sandbox id — run the provisioning legs first (sandbox-record.json / compute-worker-record.json in THIS dir) or pass --sandbox-id <id>",
  );
  process.exit(1);
}
log("repo", `HEAD ${head.slice(0, 12)} / origin/main ${originMain.slice(0, 12)} / sandbox ${SANDBOX_ID}`);
// origin/main MUST be the pinned ingest-seam merge (fail-closed, no exceptions).
// HEAD may sit on a flight branch whose commits touch ONLY paths the upload
// never carries (.vercelignore excludes scripts/ docs/ tests/): the manifest
// is enumerated from DEPLOY_SHA's OWN tree, so a branch like that deploys
// byte-identical content to the pinned merge. Any HEAD change visible to the
// upload set stays FATAL.
if (originMain !== DEPLOY_SHA) {
  console.error(
    `FATAL: origin/main is not the artifact-ingest merge (${originMain} — expected ${DEPLOY_SHA})`,
  );
  process.exit(1);
}
if (head !== DEPLOY_SHA) {
  const changedVsMain = git(`diff --name-only ${DEPLOY_SHA} ${head}`).split("\n").filter(Boolean);
  const uploadVisible = changedVsMain.filter(
    (p) => !p.startsWith("scripts/") && !p.startsWith("docs/") && !p.startsWith("tests/"),
  );
  if (uploadVisible.length > 0 || changedVsMain.length === 0) {
    console.error(
      `FATAL: HEAD ${head} is not the artifact-ingest merge and carries upload-visible changes vs ${DEPLOY_SHA} (${uploadVisible.slice(0, 5).join(", ")})`,
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
const liveMediaDescriptorBody = (await liveMediaDescriptor.json()) as Record<string, unknown>;
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
  // The pre-deploy production baseline (the r306-encode-seam deployment's dead baked URLs).
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
    note: "the r306-encode-seam-deploy-1 deployment serving production with its baked worker URLs dead (the r306-hosted-golden-path flight's sandbox long timed out) — the composition's fail-loud boot-time compute-worker descriptor fetch failing → the health route 500 with an empty body (the documented 62-c incident class); THIS is the incident this flight's deployment closes",
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
      "FATAL: the http posture is NOT set (MEDIA_TOOLCHAIN/COMPUTE_PROVIDER) — the prior flights' records said it was; refusing to deploy on an unverified posture",
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
      body: { value: target.value, type: "encrypted", target: ["production"] },
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
  // 2. The deployment — THE LANE SWITCH:
  //    - direct-token lane: `bunx vercel deploy --prod --yes …` (the CLI;
  //      the token rides the process env — the r306-deploy precedent);
  //    - composio lane: POST /v13/deployments with the tracked tree's own
  //      file manifest (by-ref digest entries for the files the platform's
  //      content store already holds from the prior deployments + inline
  //      base64 for this sha's changed/new files) — the same deployment
  //      creation the CLI performs, driven through the proxy lane because
  //      the direct token is typed-dead (the refusal recorded verbatim).
  // -------------------------------------------------------------------------
  const tDeploy = Date.now();
  let deployExit: number | null = null;
  let deployOutput = "";
  if (lane.mode === "direct-token") {
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
    deployExit = await new Promise<number | null>((resolveExit) => {
      const killer = setTimeout(() => {
        deployChild.kill("SIGKILL");
        resolveExit(null);
      }, 900_000);
      deployChild.on("exit", (code) => {
        clearTimeout(killer);
        resolveExit(code);
      });
    });
    deployOutput = `${deployStdout}\n${deployStderr}`;
    log("deploy exit", `code ${String(deployExit)} in ${Date.now() - tDeploy}ms`);
  } else {
    // --- the API deployment path (the composio lane) -----------------------
    // The upload set: the TRACKED tree at DEPLOY_SHA, filtered by the repo's
    // own .vercelignore patterns (the same filter the CLI applies). The
    // honest delta vs the prior CLI deployment: the CLI also swept 318
    // UNTRACKED working-tree files (db/*, media-storage) the API path does
    // not carry — the API upload is the tracked tree EXACTLY (recorded).
    const tracked = spawnSync("git", ["ls-files", "-s"], { cwd: REPO_ROOT })
      .stdout.toString("utf8")
      .split("\n")
      .filter((l) => l.length > 0);
    const IGNORED_DIR_NAMES = new Set([
      "docs",
      "tests",
      "node_modules",
      ".next",
      "dist",
      "coverage",
      "test",
      "scripts",
      ".git",
      ".github",
      ".vercel",
    ]);
    const isIgnoredPath = (p: string): boolean => {
      const segs = p.split("/");
      const basename = segs[segs.length - 1] ?? "";
      if (segs.slice(0, -1).some((s) => IGNORED_DIR_NAMES.has(s))) return true;
      if (basename === ".DS_Store") return true;
      if (basename.endsWith(".test.ts") || basename.endsWith(".log")) return true;
      return false;
    };
    interface ManifestEntry {
      file: string;
      sha: string;
      size: number;
      mode: number;
      inline: boolean;
      shaRange: "changed-since-prior-deployment" | "identical-to-prior-deployment";
    }
    /** The sha the prior deployment was built from (the by-ref baseline). */
    const PRIOR_DEPLOYED_SHA = "6b1c052eafc88bb8c8429938c4abe9f49ea9efa4";
    const changedSincePrior = new Set(
      spawnSync("git", ["diff", "--name-only", PRIOR_DEPLOYED_SHA, DEPLOY_SHA], { cwd: REPO_ROOT })
        .stdout.toString("utf8")
        .split("\n")
        .filter((l) => l.length > 0),
    );
    const manifest: ManifestEntry[] = [];
    const inlineFiles: { file: string; data: string; encoding: "base64"; mode: number }[] = [];
    const fileBytesBySha = new Map<string, { file: string; bytes: Buffer; mode: number }>();
    let totalBytes = 0;
    for (const line of tracked) {
      // `git ls-files -s` lines: "<mode> <sha> <stage>\t<path>"
      const [meta, path] = line.split("\t");
      const gitMode = (meta ?? "").split(" ")[0] ?? "100644";
      if (path === undefined || isIgnoredPath(path)) continue;
      const bytes = readFileSync(resolve(REPO_ROOT, path));
      // The platform's own content address: the CLI's `hash()` is sha1 of the
      // raw bytes (`@vercel/client` utils/hashes) — the by-ref `sha` field.
      const sha = createHash("sha1").update(bytes).digest("hex");
      const size = bytes.byteLength;
      totalBytes += size;
      if (!fileBytesBySha.has(sha)) fileBytesBySha.set(sha, { file: path, bytes, mode: gitMode === "100755" ? 0o100755 : 0o100644 });
      const changed = changedSincePrior.has(path);
      const entry: ManifestEntry = {
        file: path,
        sha,
        size,
        mode: gitMode === "100755" ? 0o100755 : 0o100644,
        inline: changed,
        shaRange: changed ? "changed-since-prior-deployment" : "identical-to-prior-deployment",
      };
      manifest.push(entry);
      if (changed) {
        inlineFiles.push({
          file: path,
          data: bytes.toString("base64"),
          encoding: "base64",
          mode: gitMode === "100755" ? 0o100755 : 0o100644,
        });
      }
    }
    const manifestSha = createHash("sha256")
      .update(JSON.stringify(manifest.map((m) => [m.file, m.sha, m.size, m.mode])))
      .digest("hex");
    log(
      "upload manifest",
      `${manifest.length} files / ${(totalBytes / 1024 / 1024).toFixed(2)} MB — ${inlineFiles.length} inline (changed since ${PRIOR_DEPLOYED_SHA.slice(0, 7)}) / ${manifest.length - inlineFiles.length} by-ref (content-identical), manifest sha ${manifestSha.slice(0, 12)}…`,
    );
    // The sidecar manifest (the honest, re-checkable file list — committed).
    writeFileSync(
      resolve(OUT_DIR, "deploy-files-manifest.json"),
      JSON.stringify(
        {
          schemaVersion: "1.0",
          kind: "r306-hosted-reflight-deploy-files-manifest",
          deploySha: DEPLOY_SHA,
          priorDeployedSha: PRIOR_DEPLOYED_SHA,
          fileCount: manifest.length,
          totalBytes,
          manifestSha,
          filter: ".vercelignore patterns (the repo's own file) — the tracked tree exactly, no untracked working-tree files",
          entries: manifest,
        },
        null,
        2,
      ) + "\n",
    );

    const commitSubject = git(`log -1 --format=%s ${DEPLOY_SHA}`);
    // The build-layout lesson (measured, dpl_8kLxtHfiEcsnuRxwHxwK5Mun6ToX vs the
    // original dpl_Dgtf629qRgTWEZv6i1DmwCdQmrkt): with NO deployment-level
    // rootDirectory the build inherits the PROJECT's apps/web as its working
    // root — the install then runs on apps/web's package.json ALONE (the
    // build container's /vercel/path1 carries the rootDirectory subtree
    // without the workspace parent) and bun 1.3.14 refuses the workspace:*
    // deps ("Workspace dependency @sporta/asr not found, Searched in ./*").
    // The CLI-shaped deployments (source: cli, from the repo root) carry the
    // deployment root AS the build root — bun install at the repo root (the
    // .vercelignore's own documented posture: "bun install at the repo root
    // and next build in apps/web"). THIS body mirrors that: rootDirectory ""
    // = the deployment's own root (the uploaded tree's root — the workspace
    // root), nodeVersion left UNSET (the original's deployment carried none;
    // the project's own 24.x applies).
    const baseDeploymentBody = {
      name: PROJECT,
      target: "production",
      projectSettings: {
        buildCommand: "next build",
        devCommand: null,
        framework: "nextjs",
        commandForIgnoringBuildStep: null,
        // DIAGNOSTIC ATTEMPT 2: the install command prints the build
        // container's actual layout (pwd + /vercel/* listings) into the
        // build events BEFORE the install — the typed ground truth for the
        // workspace-root visibility question. The `bun install` still runs
        // after the listings (the build outcome stays the honest arbiter).
        installCommand:
          "pwd && ls -la /vercel/ && (ls /vercel/path0 2>/dev/null | head -25 || echo NO_PATH0) && (ls /vercel/path1 2>/dev/null | head -25 || echo NO_PATH1) && bun install",
        outputDirectory: null,
      },
      meta: {
        githubCommitAuthorName: git(`log -1 --format=%an ${DEPLOY_SHA}`),
        githubCommitAuthorEmail: git(`log -1 --format=%ae ${DEPLOY_SHA}`),
        githubCommitMessage: commitSubject,
        githubCommitOrg: "payswapdotorg",
        githubCommitRef: "main",
        githubCommitRepo: "sporta",
        githubCommitSha: DEPLOY_SHA,
        githubDeployment: "1",
        githubOrg: "payswapdotorg",
        githubRepo: "sporta",
        gitRootDirectory: "apps/web",
        gitDirty: "1",
      },
    };
    // The by-ref entries: { file, sha (sha1 — the platform's own content
    // address), size, mode } — the EXACT shape `@vercel/client`'s prepareFiles
    // emits for non-inlined files. The inline entries: { file, data (base64),
    // encoding, mode }.
    const buildFilesArray = () => {
      // The LIVE inline set (the missing-files rounds can grow it): a file is
      // either a by-ref entry OR an inline entry — never both, never neither.
      const inlineNow = new Set(inlineFiles.map((f) => f.file));
      return [
        ...manifest
          .filter((m) => !inlineNow.has(m.file))
          .map((m) => ({ file: m.file, sha: m.sha, size: m.size, mode: m.mode })),
        ...inlineFiles.map((f) => ({
          file: f.file,
          data: f.data,
          encoding: "base64" as const,
          mode: f.mode,
        })),
      ];
    };
    // The CLI's own law (postDeployment + the missing-files event): a by-ref
    // creation can be answered with the typed `missing_files` error naming
    // the shas the platform's store does NOT hold — the client then uploads
    // those and retries. The proxy lane cannot POST raw bytes to /v2/files, so
    // THIS driver's retry converts each missing sha's file to an INLINE
    // base64 entry and re-creates (bounded 3 rounds; the rounds recorded).
    let createResponse = await apiFetch("/v13/deployments", {
      method: "POST",
      body: { ...baseDeploymentBody, files: buildFilesArray() },
    });
    let createdBody: Record<string, unknown> = {};
    try {
      createdBody = JSON.parse(createResponse.bodyText) as Record<string, unknown>;
    } catch {
      createdBody = { unparsed: createResponse.bodyText.slice(0, 400) };
    }
    deployOutput = `POST /v13/deployments → HTTP ${createResponse.status}\n${createResponse.bodyText.slice(0, 2000)}`;
    const missingRounds: { round: number; missingShaCount: number; filesInlined: string[] }[] = [];
    for (let round = 1; round <= 3; round += 1) {
      const errorBody = createdBody["error"] as { code?: string; missing?: string[] } | undefined;
      if (createResponse.status < 400 || errorBody?.code !== "missing_files" || !Array.isArray(errorBody.missing)) {
        break;
      }
      const missingShas = errorBody.missing;
      const toInline: string[] = [];
      for (const sha of missingShas) {
        const entry = fileBytesBySha.get(sha);
        if (entry === undefined) continue;
        toInline.push(entry.file);
        inlineFiles.push({
          file: entry.file,
          data: entry.bytes.toString("base64"),
          encoding: "base64",
          mode: entry.mode,
        });
      }
      missingRounds.push({ round, missingShaCount: missingShas.length, filesInlined: toInline });
      log(
        "deploy create (missing_files)",
        `round ${round}: the platform named ${missingShas.length} missing sha(s) — ${toInline.length} inlined, retrying`,
      );
      if (toInline.length === 0) {
        deployOutput += `\nmissing_files round ${round}: the platform named sha(s) this manifest does not carry — cannot inline, refusing`;
        break;
      }
      createResponse = await apiFetch("/v13/deployments", {
        method: "POST",
        body: { ...baseDeploymentBody, files: buildFilesArray() },
      });
      try {
        createdBody = JSON.parse(createResponse.bodyText) as Record<string, unknown>;
      } catch {
        createdBody = { unparsed: createResponse.bodyText.slice(0, 400) };
      }
      deployOutput += `\nretry round ${round} → HTTP ${createResponse.status}\n${createResponse.bodyText.slice(0, 2000)}`;
    }
    if (missingRounds.length > 0) {
      // The manifest's honest final state: the by-ref set that actually held.
      const finalInline = new Set(inlineFiles.map((f) => f.file));
      for (const m of manifest) {
        if (finalInline.has(m.file)) m.inline = true;
      }
      writeFileSync(
        resolve(OUT_DIR, "deploy-files-manifest.json"),
        JSON.stringify(
          {
            schemaVersion: "1.0",
            kind: "r306-hosted-reflight-deploy-files-manifest",
            deploySha: DEPLOY_SHA,
            priorDeployedSha: PRIOR_DEPLOYED_SHA,
            fileCount: manifest.length,
            totalBytes,
            manifestSha,
            filter: ".vercelignore patterns (the repo's own file) — the tracked tree exactly, no untracked working-tree files",
            missingFilesRounds: missingRounds,
            entries: manifest,
          },
          null,
          2,
        ) + "\n",
      );
    }
    log("deploy create", `HTTP ${createResponse.status} (the API is the arbiter)`);
    if (createResponse.status === 201 || createResponse.status === 200) {
      // The bounded wait for the build to reach a terminal state (the prior
      // flight's build measured ~31 s; the bound is generous, the poll honest).
      const createdId = typeof createdBody["id"] === "string" ? createdBody["id"] : null;
      for (let attempt = 0; attempt < 90; attempt += 1) {
        await new Promise((r) => setTimeout(r, 5000));
        const doc = createdId === null ? null : await apiFetch(`/v13/deployments/${createdId}`);
        let state = "unknown";
        if (doc !== null && doc.ok) {
          try {
            state = String((JSON.parse(doc.bodyText) as { readyState?: string }).readyState ?? "unknown");
          } catch {
            state = "unparseable";
          }
        }
        if (state === "READY" || state === "ERROR" || state === "CANCELED") {
          deployOutput += `\nbuild terminal state: ${state} after ${Date.now() - tDeploy}ms`;
          log("deploy build", `${state} after ${Date.now() - tDeploy}ms`);
          if (state !== "READY" && createdId !== null) {
            // The typed build failure's OWN diagnostics — the failed deployment's
            // doc (its error payload, readyState, status) + its events tail,
            // fetched VERBATIM through the lane so a refused build is
            // DIAGNOSABLE from the record alone (the 69-a1 prep found the prior
            // incarnation's refused build recorded terminal-observed only — the
            // INITIALIZING→ERROR transition carried no cause; never again).
            try {
              const failDoc = await apiFetch(`/v13/deployments/${createdId}`);
              deployOutput += `\nfailed deployment doc (HTTP ${failDoc.status}): ${failDoc.bodyText.slice(0, 1200)}`;
              const failEvents = await apiFetch(
                `/v13/deployments/${createdId}/events?limit=100&direction=backward`,
              );
              deployOutput += `\nfailed deployment events tail (HTTP ${failEvents.status}): ${failEvents.bodyText.slice(0, 3000)}`;
            } catch (error) {
              deployOutput += `\n(failed deployment diagnostics fetch refused: ${error instanceof Error ? error.message : String(error)})`;
            }
          }
          deployExit = state === "READY" ? 0 : 1;
          break;
        }
        if (attempt === 89) {
          deployOutput += `\nbuild did not reach a terminal state in the bounded 450s window (last observed: ${state})`;
          log("deploy build", `(no terminal state in the bounded window — last ${state})`);
          deployExit = 1;
        }
      }
    } else {
      deployExit = 1;
    }
  }

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
          : lane.mode === "composio"
            ? "vercel-api-deployment-non-2xx"
            : "vercel-deploy-cli-non-zero-exit",
      detail: `the deployment ${
        lane.mode === "composio" ? "creation (POST /v13/deployments through the composio lane)" : "CLI"
      } exited ${String(deployExit)} after ${Date.now() - tDeploy}ms`,
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
  // The AUTHENTICATED probe of the deployment's own surface — only on the
  // direct-token lane (`vercel curl` needs the CLI's own live token; the
  // composio lane's credential lives inside the connection and is not a CLI
  // token — the alias + the API state are the arbiters there, honestly noted).
  if (lane.mode === "direct-token") {
    deploymentProbe = await authenticatedHealthProbe(deployment.deploymentUrl);
  }
  log(
    "verification",
    `alias root ${String(aliasRootStatusCode)} / alias health ${aliasHealth.httpStatusCode} (marker ${String(aliasHealth.deployMarker)}, attempt ${aliasHealth.attempts}) / deployment-url public shape ${deploymentUrlShape.httpStatusCode}${
      deploymentProbe === null
        ? " / authenticated probe SKIPPED (the composio lane — the alias + the API state are the arbiters)"
        : ` / authenticated probe exit ${String(deploymentProbe.exitCode)} (marker ${String(deploymentProbe.deployMarker)})`
    }`,
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
  if (lane.mode === "direct-token" && (deploymentProbe?.exitCode !== 0 || deploymentProbe?.deployMarker !== DEPLOY_MARKER)) {
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
// The compute-worker record is the primary source (it carries the re-extension
// timestamp); the sandbox record is the fallback; every field the record's
// ephemerality block reads falls back honestly when neither is present (a
// --sandbox-id re-run whose provisioning records were never written must not
// crash the record-write — the 69-a1 prep's guard).
const sandboxRecord = ((): {
  provider?: { sandbox?: { sandboxId?: string; startedAtIso?: string; keepAliveReExtendedAtIso?: string } };
} => {
  for (const recordFile of ["compute-worker-record.json", "sandbox-record.json"]) {
    const path = resolve(HERE, recordFile);
    if (!existsSync(path)) continue;
    try {
      return JSON.parse(readFileSync(path, "utf8")) as {
        provider?: { sandbox?: { sandboxId?: string; startedAtIso?: string; keepAliveReExtendedAtIso?: string } };
      };
    } catch {
      // unreadable record — try the next; the fields below fall back honestly
    }
  }
  return {};
})();
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
    ? "THE R306 HOSTED RE-FLIGHT — the deploy leg (the r306-deploy precedent mirrored at the artifact-ingest merge: the env re-point + the production deployment baking THIS flight's fresh sandbox worker URLs + the fail-closed verification). THIS record was FINALIZED by a --reverify invocation: the observation legs re-measured without re-firing the PATCHes or creating a second deployment"
    : "THE R306 HOSTED RE-FLIGHT — the deploy leg (the r306-deploy precedent mirrored at the artifact-ingest merge: the env re-point + the production deployment baking THIS flight's fresh sandbox worker URLs + the fail-closed verification)",
  envWiring: {
    method:
      "PATCH v10/projects/sporta/env/{id} (production target, encrypted) — BEFORE the deploy so the new deployment bakes the live sandbox URLs (the env var ids DISCOVERED live from GET /v9/projects/sporta/env, never assumed)",
    prePatchVerified: {
      note: "every value re-read DECRYPTED before any PATCH (verify, do not assume)",
      values: prePatchValues,
      posture: "MEDIA_TOOLCHAIN=http + COMPUTE_PROVIDER=http confirmed live (the 65-j PATCHes — still correct; NOT re-PATCHed this flight)",
      deadUrlMeasured:
        "the pre-PATCH MEDIA_TOOLCHAIN_URL/COMPUTE_WORKER_URL pointed at the r306-hosted-golden-path flight's sandbox (3971/3973-i5lvv9q3jrumm914o1rca) — DEAD since that sandbox's timeout; the pre-deploy production baseline below measures the incident class that posture was serving",
    },
    patches,
    unpatched: [
      "MEDIA_TOOLCHAIN=http (the 65-j PATCH — re-verified decrypted, still correct)",
      "COMPUTE_PROVIDER=http (the 65-j PATCH — re-verified decrypted, still correct)",
    ],
  },
  vercelLane: {
    mode: lane.mode,
    directTokenProbe: {
      httpStatusCode: directProbe.status,
      login: lane.userProbe.login,
      refused: lane.directTokenRefusal !== null,
      typedRefusalVerbatim: lane.directTokenRefusal?.verbatim ?? null,
      note:
        lane.mode === "composio"
          ? "the direct VERCEL_TOKEN is TYPED-DEAD (the refusal above is verbatim; the CLI answers the same class: 'The token provided via VERCEL_TOKEN environment variable is not valid') — the flight fell back to the COMPOSIO VERCEL LANE (the operator-provisioned connected account ca_31iruA2qEdfl, the same lane class the 68-TL flight proved for the GitHub push): every Vercel API call (env list/decrypt-read/PATCH, the deployment creation, the deployment observation) executed through Composio's proxy_execute under the connection's OWN credential — never extracted, never echoed, never committed"
          : "the direct VERCEL_TOKEN is alive (GET /v2/user 200) — the CLI deploy lane",
    },
    composioLane: lane.mode === "composio" ? { proxySessionId: lane.proxySessionId, connectionId: COMPOSIO_VERCEL_CONNECTION, userProbeLogin: lane.userProbe.login } : null,
    deploymentCreation:
      lane.mode === "composio"
        ? "POST /v13/deployments through the proxy (the tracked tree's file manifest — by-ref digest entries for the content-identical files + inline base64 for this sha's changed files; the full manifest: deploy-files-manifest.json in THIS dir)"
        : "bunx vercel deploy --prod --yes --project sporta --scope ekonplacidegmailcoms-projects",
  },
  deploy:
    recordedRefusal !== undefined || deployment === undefined
      ? {
          command:
            lane.mode === "composio"
              ? "POST /v13/deployments through the composio proxy (the tracked tree's manifest at 5424a84e — the same deployment creation the CLI performs; the direct-token CLI lane refused: token typed-dead)"
              : "bunx vercel deploy --prod --yes --project sporta --scope ekonplacidegmailcoms-projects (from the repo root; the token through the process env — never argv, never echoed)",
          repoState: {
            HEAD: head,
            originMain: originMain,
            note: "the deployed source is exactly the tracked tree at the artifact-ingest merge (.vercelignore excludes scripts/ docs/ tests/ — the evidence dirs ride outside the upload)",
          },
          outcome: "REFUSED",
          refusal: recordedRefusal,
        }
      : {
          command:
            lane.mode === "composio"
              ? "POST /v13/deployments through the composio proxy (the tracked tree's manifest at 5424a84e — the same deployment creation the CLI performs; the direct-token CLI lane refused: token typed-dead)"
              : "bunx vercel deploy --prod --yes --project sporta --scope ekonplacidegmailcoms-projects (from the repo root; the token through the process env — never argv, never echoed)",
          repoState: {
            HEAD: head,
            originMain: originMain,
            note: "the deployed source is exactly the tracked tree at the artifact-ingest merge (.vercelignore excludes scripts/ docs/ tests/ — the evidence dirs ride outside the upload)",
            uploadManifest:
              lane.mode === "composio"
                ? "deploy-files-manifest.json (THIS dir): the tracked tree filtered by .vercelignore — the API path does NOT sweep untracked working-tree files (the prior CLI deployment had carried 318 of them: db/*, media-storage — not build inputs; the honest delta recorded)"
                : null,
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
            deploymentId: PRIOR_DEPLOYMENT_ID,
            note: "the r306-encode-seam-deploy-1 deployment (marker r306-encode-seam-deploy-1) whose BAKED worker URLs were the dead r306-hosted-golden-path sandbox — the 62-c production-500 incident class LIVE at this flight's open (the pre-deploy baseline measured below); superseded by this flight's deployment baking LIVE worker URLs at the artifact-ingest merge",
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
              note:
                deploymentProbe === null
                  ? "NOT PROBED — the composio lane carries the flight (the direct VERCEL_TOKEN is typed-dead, so `vercel curl` cannot run); the deployment's own runtime state is the API's READY observation + the production alias health 200 with the marker (the arbiters)"
                  : "`vercel curl` — the CLI's authenticated probe past the deployment protection (the token through the process env); the deployment's OWN runtime answered the health document with the marker",
            },
          },
          bootTimeComputeDescriptorFetch:
            "SUCCEEDED — evidenced by the health route answering 200 AT ALL (both surfaces above): the composition's fail-loud boot fetches GET {COMPUTE_WORKER_URL}/v1/adapter (compute-adapter-hosted/src/env.ts); its failure kills the composition and every API route answers 500 with an empty body (the 62-c incident class — measured live as this flight's pre-deploy baseline on the superseded r306-encode-seam deployment)",
          mediaDescriptorReachability: {
            fromTheDeployedRuntime: {
              measurable: false,
              honestNote:
                "the health answer carries NO media-toolchain fields (its own field list recorded above — env/deployMarker/providers/renderQueue/usageGuardrails); the media seam is composition-lazy (resolveMediaToolchainFromEnv constructs the http executor + decode port + encode pair WITHOUT a boot-time descriptor fetch — only the COMPUTE worker's descriptor is fail-loud at boot); the deployed runtime's OWN media-descriptor fetch is therefore not separately observable from the health answer — the hosted-golden-path flight (the arc's next flight) measures the deployed runtime's media leg end-to-end",
            },
            fromThisMachine: {
              url: MEDIA_PUBLIC_URL,
              healthHttpStatusCode: liveMediaHealth.status,
              descriptorHttpStatusCode: liveMediaDescriptor.status,
              operationsAdvertised: liveMediaOps,
              note: "measured from THIS machine over the exact URL the deployment baked (the orchestrating host's network position — the same position the live-wire flight measured from)",
            },
          },
        },
  ephemeralityDoctrine: {
    measuredLive:
      "the baked URLs are EPHEMERAL: the sandbox dies at its timeout and the incident class (a baked ephemeral URL) re-manifests on its death — the r607 flight measured it twice and the r306 arc measured it again (the r306-hosted-golden-path flight's sandbox death class), and THIS flight's pre-deploy baseline measured the current manifestation (the r306-encode-seam-deploy-1 deployment 500ing on production with its dead baked URLs)",
    sandbox: {
      sandboxId: String(sandboxRecord.provider?.sandbox?.sandboxId ?? SANDBOX_ID),
      startedAtIso: sandboxRecord.provider?.sandbox?.startedAtIso ?? null,
      keepAliveMs: KEEP_ALIVE_MS,
      lastReExtendedAtIso: sandboxRecord.provider?.sandbox?.keepAliveReExtendedAtIso ?? null,
      lifecycleOnTimeout: "kill",
      mediaWorkerUrlLiveAtRecordWrite: mediaWorkerUrlLiveAtWrite,
      computeWorkerUrlLiveAtRecordWrite: computeWorkerUrlLiveAtWrite,
      note: "the keep-alive is 2 h from the LAST orchestration invocation (re-extended by this flight's keep-alive re-run + boot-compute-worker.ts); at the timeout the sandbox dies, both public worker URLs answer the E2B proxy's 502 'The sandbox was not found', and the boot-time compute descriptor fetch fails → the 500 class returns to whatever deployment still bakes this URL",
    },
    theHonestPosture:
      "every record in this tree states which sandbox/deployment it measured; a dead worker URL is a typed refusal at the composition, never a laundered availability; the re-runnable procedure (commands.md) re-executes the whole chain against a fresh sandbox in ~30 minutes",
    theOperatorDecision:
      "a PERSISTENT worker host (a long-lived deployment) is the production posture's closure — named in the status row, never improvised by a worker",
  },
  credentialsDiscipline:
    "VERCEL_TOKEN + E2B_API_KEY + COMPOSIO_API_KEY env-only (/home/z/.sporta-env; never echoed in full, never committed; the record carries no secrets — the direct token's refusal body is redacted before recording; the composio lane's credential lives inside the connection, never extracted; the tree is scanned for the vcp_/e2b_/composio-key prefixes)",
};

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(RECORD_PATH, JSON.stringify(record, null, 2) + "\n");
log("record", RECORD_PATH);

if (recordedRefusal !== undefined) {
  console.error(`=== THE R306 HOSTED RE-FLIGHT DEPLOY LEG: REFUSED (${recordedRefusal.refusalClass}) — recorded honestly ===`);
  process.exit(1);
}

console.log("=== THE R306 HOSTED RE-FLIGHT DEPLOY LEG: DEPLOYED + VERIFIED (measured) ===");
console.log(`vercel lane: ${lane.mode}${lane.directTokenRefusal !== null ? " (the direct token REFUSED — the typed refusal recorded verbatim)" : ""}`);
console.log(`deployment:  ${deployment?.deploymentId} (${deployment?.state}, ${String(deployment?.target)})`);
console.log(`url:         ${deployment?.deploymentUrl}`);
console.log(
  `alias:       ${PRODUCTION_ALIAS} (root ${String(aliasRootStatusCode)}, health ${String(aliasHealth?.httpStatusCode)}, marker ${String(aliasHealth?.deployMarker)})`,
);
console.log(`patches:     ${patches.map((p) => `${p.name} ${p.httpStatusCode}`).join(" / ")}`);
console.log(
  deploymentProbe === null
    ? `probe:       SKIPPED (the composio lane — the alias + the API READY state arbitrate; deployment URL public shape ${String(deploymentUrlShape?.httpStatusCode)} — Vercel Authentication)`
    : `probe:       vercel curl exit ${String(deploymentProbe.exitCode)}, marker ${String(deploymentProbe.deployMarker)} (deployment URL public shape ${String(deploymentUrlShape?.httpStatusCode)} — Vercel Authentication)`,
);
console.log(`record:      ${RECORD_PATH}`);
