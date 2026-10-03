/**
 * R607 62-c — the E2B PROVIDER PROVISIONING script (DEVELOPMENT-TIME
 * EVIDENCE, not a test): stands up the ffmpeg-capable compute provider
 * the operator designated for the hosted media failover — ONE E2B
 * sandbox running the repo's OWN adapter-tree workers on the public
 * interface:
 *
 *   port 3971 — the media-toolchain worker
 *               (`packages/compute-adapter-hosted/scripts/r607-media-toolchain-worker.ts`
 *               bundled with `bun build --target=bun`): the W914 http
 *               compute-adapter seam's worker counterpart the hosted
 *               control plane's `MEDIA_TOOLCHAIN=http + MEDIA_TOOLCHAIN_URL`
 *               configuration dispatches to (admission probe + Original
 *               normalization — REAL ffmpeg/ffprobe in the sandbox);
 *
 *   port 3973 — the full-plane compute worker
 *               (`packages/compute-adapter-hosted/scripts/r607-e2b-compute-worker.ts`):
 *               the SAME renderer registry + derived-reality plane the web
 *               app composes in-process, serving `POST /v1/jobs/execute`
 *               (the `COMPUTE_PROVIDER=http + COMPUTE_WORKER_URL` seam) —
 *               the design-support measurement for the recorded
 *               derived-reality ADMISSION gap (see the evidence pack's
 *               README §the measured gap).
 *
 * ZERO product-code involvement: the workers are the repo's own
 * production applications (`createMediaToolchainServer` /
 * `createComputeWorkerServer` over Bun.serve); only the HOSTING is new
 * (the E2B sandbox — the provider-class failover the operator's
 * infrastructure rule names: "when a blocker is provider-class, move to
 * the next compatible provider through the EXISTING adapter contract,
 * record the provider used").
 *
 * The PROVIDER RECORD (provider-record.json) captures the measurable
 * provider identity: sandbox id, template, the E2B sandbox metadata, the
 * public URLs, the MEASURED ffmpeg identity in the sandbox, and the LIVE
 * capability manifests (both workers' descriptors, fetched over the
 * public wire — never invented). Credentials NEVER appear in the record
 * (E2B_API_KEY is env-only).
 *
 * Run (from the REPO ROOT):
 *   E2B_API_KEY=e2b_… bun run scripts/evidence/r607-e2b-media-failover/provision-e2b.ts
 *   # re-record against an ALREADY-RUNNING sandbox (re-verify + re-extend
 *   # the keep-alive; no re-provisioning):
 *   E2B_API_KEY=e2b_… bun run scripts/evidence/r607-e2b-media-failover/provision-e2b.ts \
 *     --sandbox-id <id>
 *   # optional: --keep-down to leave the sandbox up after a failed probe
 */
import { Sandbox } from "e2b";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const HERE = dirname(new URL(import.meta.url).pathname);
const REPO_ROOT = resolve(HERE, "../../..");
const OUT_DIR = HERE;
const BUNDLE_DIR = resolve(REPO_ROOT, ".e2b-worker-bundles");

const MEDIA_PORT = 3971;
const COMPUTE_PORT = 3973;
const KEEP_ALIVE_MS = 3 * 60 * 60 * 1000; // 3h — the acceptance window (deploy → golden path → redeploy → recovery)

const argv = process.argv.slice(2);
const keepDown = argv.includes("--keep-down");
const reuseSandboxId = (() => {
  const at = argv.indexOf("--sandbox-id");
  return at === -1 ? undefined : argv[at + 1];
})();

const apiKey = process.env.E2B_API_KEY;
if (apiKey === undefined || apiKey === "") {
  console.error("FATAL: E2B_API_KEY is required (env-only; never recorded)");
  process.exit(1);
}

/** Runs a command, fail-loud. */
function run(command: string, cwd?: string): string {
  const result = spawnSync(command, { shell: true, cwd, encoding: "utf8" });
  if (result.status !== 0) {
    console.error(`FATAL: command failed (${command}): ${result.stderr ?? result.stdout}`);
    process.exit(1);
  }
  return (result.stdout ?? "").trim();
}

function log(label: string, value: string): void {
  console.log(`[provision] ${label}: ${value}`);
}

// ---------------------------------------------------------------------------
// 1. Bundle the repo's own workers (single-file bun bundles — the sandbox
//    needs only bun + ffmpeg; no repo checkout, no npm install in-sandbox).
//    (Skipped in reuse mode: the bundles already run in the live sandbox.)
// ---------------------------------------------------------------------------
const t0 = Date.now();
if (reuseSandboxId === undefined) {
  run(
    `bun build --target=bun ${quote(
      resolve(REPO_ROOT, "packages/compute-adapter-hosted/scripts/r607-media-toolchain-worker.ts"),
    )} --outdir ${quote(BUNDLE_DIR)}`,
    REPO_ROOT,
  );
  run(
    `bun build --target=bun ${quote(
      resolve(REPO_ROOT, "packages/compute-adapter-hosted/scripts/r607-e2b-compute-worker.ts"),
    )} --outdir ${quote(BUNDLE_DIR)}`,
    REPO_ROOT,
  );
}
const mediaBundle = readFileSync(resolve(BUNDLE_DIR, "r607-media-toolchain-worker.js"));
const computeBundle = readFileSync(resolve(BUNDLE_DIR, "r607-e2b-compute-worker.js"));
log("bundles", `media ${mediaBundle.byteLength}B / compute ${computeBundle.byteLength}B`);

// ---------------------------------------------------------------------------
// 2. Create the sandbox (E2B `base` — Debian 12; ffmpeg + bun installed in),
//    or REUSE the already-running one (re-verify + re-extend the keep-alive).
// ---------------------------------------------------------------------------
const sandbox =
  reuseSandboxId !== undefined
    ? await (Sandbox as unknown as { connect: (id: string) => Promise<Sandbox> }).connect(
        reuseSandboxId,
      )
    : await Sandbox.create("base", { apiKey });
log("sandbox", sandbox.sandboxId + (reuseSandboxId !== undefined ? " (REUSED)" : " (fresh)"));

const tInfo = await (sandbox as unknown as { getInfo: () => Promise<unknown> }).getInfo();
const info = tInfo as Record<string, unknown>;

// 3. Provision the toolchain: apt ffmpeg (Debian bookworm's 7:5.1.x with
//    libx264) + the bun runtime (bun.sh installer). (Re-measured in reuse
//    mode — the identity in the record is always freshly measured.)
const apt = await sandbox.commands.run(
  reuseSandboxId === undefined
    ? "sudo apt-get update -qq && sudo apt-get install -y -qq ffmpeg 2>&1 | tail -1; ffmpeg -version | head -1; which ffmpeg ffprobe; ffmpeg -hide_banner -encoders 2>/dev/null | grep -c libx264 || true"
    : "ffmpeg -version | head -1; which ffmpeg ffprobe; ffmpeg -hide_banner -encoders 2>/dev/null | grep -c libx264 || true",
  { timeoutMs: 300_000 },
);
log("ffmpeg", apt.stdout.trim().replace(/\n/g, " | "));
if (apt.exitCode !== 0) {
  console.error(`FATAL: ffmpeg install failed: ${apt.stderr}`);
  if (!keepDown) await sandbox.kill();
  process.exit(1);
}

const bunInstall = await sandbox.commands.run(
  reuseSandboxId === undefined
    ? "curl -fsSL https://bun.sh/install | bash > /tmp/bun-install.log 2>&1; ~/.bun/bin/bun --version"
    : "~/.bun/bin/bun --version",
  { timeoutMs: 240_000 },
);
log("bun", bunInstall.stdout.trim());
if (!bunInstall.stdout.trim().startsWith("1.")) {
  console.error(`FATAL: bun install failed: ${bunInstall.stderr}`);
  if (!keepDown) await sandbox.kill();
  process.exit(1);
}

// The measured in-sandbox toolchain identity (the provider record's core).
const ffmpegVersionInSandbox = apt.stdout
  .split("\n")
  .find((line) => line.startsWith("ffmpeg version"))
  ?.trim();

// ---------------------------------------------------------------------------
// 4. Upload the bundles + start both workers on the public interface
//    (skipped in reuse mode — the workers already run; only verified).
// ---------------------------------------------------------------------------
if (reuseSandboxId === undefined) {
  await sandbox.files.write("/sporta/media-worker.js", mediaBundle);
  await sandbox.files.write("/sporta/compute-worker.js", computeBundle);

  const startMedia = await sandbox.commands.run(
    "HOSTNAME=0.0.0.0 PORT=3971 nohup ~/.bun/bin/bun /sporta/media-worker.js > /sporta/media-worker.log 2>&1 & echo MEDIA_PID $!",
    { timeoutMs: 20_000 },
  );
  const startCompute = await sandbox.commands.run(
    "HOSTNAME=0.0.0.0 PORT=3973 nohup ~/.bun/bin/bun /sporta/compute-worker.js > /sporta/compute-worker.log 2>&1 & echo COMPUTE_PID $!",
    { timeoutMs: 20_000 },
  );
  log("workers", `${startMedia.stdout.trim()} / ${startCompute.stdout.trim()}`);
}

// Wait for both health endpoints (bounded).
let mediaHealthy = false;
let computeHealthy = false;
for (let attempt = 0; attempt < 30 && !(mediaHealthy && computeHealthy); attempt += 1) {
  await new Promise((r) => setTimeout(r, 1000));
  const check = await sandbox.commands.run(
    "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3971/health; echo; curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3973/health",
    { timeoutMs: 15_000 },
  );
  const codes = check.stdout.trim().split("\n");
  mediaHealthy = codes[0] === "200";
  computeHealthy = codes[1] === "200";
}
if (!(mediaHealthy && computeHealthy)) {
  const logs = await sandbox.commands.run("cat /sporta/media-worker.log /sporta/compute-worker.log", {
    timeoutMs: 10_000,
  });
  console.error(`FATAL: workers did not become healthy:\n${logs.stdout}`);
  if (!keepDown) await sandbox.kill();
  process.exit(1);
}
const bootLogs = await sandbox.commands.run("cat /sporta/media-worker.log /sporta/compute-worker.log", {
  timeoutMs: 10_000,
});
log("boot logs", "\n" + bootLogs.stdout);
const startLogs = { media: "(reused)", compute: "(reused)" };

// ---------------------------------------------------------------------------
// 5. The PUBLIC URLs (the E2B port proxy: https://{port}-{sandboxId}.e2b.app)
//    + the LIVE capability manifests over the public wire.
// ---------------------------------------------------------------------------
const getHost = (sandbox as unknown as { getHost: (port: number) => string }).getHost.bind(sandbox);
const mediaPublicUrl = `https://${getHost(MEDIA_PORT)}`;
const computePublicUrl = `https://${getHost(COMPUTE_PORT)}`;
log("public urls", `media ${mediaPublicUrl} / compute ${computePublicUrl}`);

const mediaDescriptorResponse = await fetch(`${mediaPublicUrl}/v1/media/adapter`, {
  signal: AbortSignal.timeout(30_000),
});
const computeDescriptorResponse = await fetch(`${computePublicUrl}/v1/adapter`, {
  signal: AbortSignal.timeout(30_000),
});
const mediaDescriptor = await mediaDescriptorResponse.json();
const computeDescriptor = await computeDescriptorResponse.json();
const mediaHealthPublic = await (await fetch(`${mediaPublicUrl}/health`)).json();
const computeHealthPublic = await (await fetch(`${computePublicUrl}/health`)).json();
log(
  "descriptors",
  `media HTTP ${mediaDescriptorResponse.status} (ops ${(mediaDescriptor as { operations?: string[] }).operations?.join(",")}) / compute HTTP ${computeDescriptorResponse.status} (${(computeDescriptor as { supportedRenderers?: { rendererId: string }[] }).supportedRenderers?.map((r) => r.rendererId).join(",")})`,
);

// Region evidence: whatever the public wire exposes (headers + DNS).
const regionHeaders: Record<string, string> = {};
for (const [name, value] of mediaDescriptorResponse.headers) {
  if (/region|zone|server|via|x-|cf-|location/i.test(name)) regionHeaders[name] = value;
}
let dnsCname = "unresolved";
try {
  const resolved = run(`getent hosts ${getHost(MEDIA_PORT)}`);
  dnsCname = resolved.split(/\s+/).pop() ?? "unresolved";
} catch {
  dnsCname = "unresolved";
}

// ---------------------------------------------------------------------------
// 6. The sandbox lifetime: extended for the acceptance window.
// ---------------------------------------------------------------------------
await sandbox.setTimeout(KEEP_ALIVE_MS);
log("sandbox timeout", `${KEEP_ALIVE_MS / 60000} minutes`);

// ---------------------------------------------------------------------------
// 7. The provider record (the infrastructure-directive requirement:
//    RECORD THE PROVIDER USED — name, template, the capability manifest).
// ---------------------------------------------------------------------------
const record = {
  schemaVersion: "1.0",
  kind: "r607-e2b-media-failover-provider-record",
  provider: {
    name: "E2B",
    product: "E2B Sandboxes (api.e2b.dev)",
    template: { id: String(info.templateId ?? "unknown"), name: String(info.name ?? "base") },
    sandbox: {
      sandboxId: sandbox.sandboxId,
      envdVersion: String(info.envdVersion ?? "unknown"),
      cpuCount: info.cpuCount,
      memoryMB: info.memoryMB,
      startedAtIso: info.startedAt,
      lifecycleOnTimeout: String((info.lifecycle as { onTimeout?: string })?.onTimeout ?? "kill"),
      keepAliveMs: KEEP_ALIVE_MS,
    },
    region: {
      note: "E2B-managed placement (the SDK exposes no region selector on this plan); the measurable evidence recorded verbatim",
      publicResponseHeaders: regionHeaders,
      dnsResolution: dnsCname,
    },
    toolchain: {
      ffmpegVersion: ffmpegVersionInSandbox ?? null,
      installPath: "sudo apt-get install -y ffmpeg (Debian bookworm ffmpeg 7:5.1.x + libx264)",
      bunVersion: bunInstall.stdout.trim(),
    },
  },
  workers: {
    media: {
      entry: "packages/compute-adapter-hosted/scripts/r607-media-toolchain-worker.ts",
      port: MEDIA_PORT,
      publicUrl: mediaPublicUrl,
      health: mediaHealthPublic,
      descriptor: mediaDescriptor,
      descriptorHttpStatusCode: mediaDescriptorResponse.status,
      adapterSeam:
        "MEDIA_TOOLCHAIN=http + MEDIA_TOOLCHAIN_URL (packages/media-platform/src/toolchain-env.ts — the W914 http compute-adapter seam)",
    },
    compute: {
      entry: "packages/compute-adapter-hosted/scripts/r607-e2b-compute-worker.ts",
      port: COMPUTE_PORT,
      publicUrl: computePublicUrl,
      health: computeHealthPublic,
      descriptor: computeDescriptor,
      descriptorHttpStatusCode: computeDescriptorResponse.status,
      adapterSeam:
        "COMPUTE_PROVIDER=http + COMPUTE_WORKER_URL (packages/compute-adapter-hosted/src/env.ts — the W914 http compute-adapter seam)",
      note: "the design-support worker for the recorded derived-reality ADMISSION gap (the hosted composition's derived plane is local-toolchain-gated; this worker demonstrates the remote execution plane — see the evidence pack README)",
    },
  },
  provisioning: {
    mode: reuseSandboxId !== undefined ? "reused-live-sandbox" : "fresh-provision",
    totalMs: Date.now() - t0,
    bundleBuild: `bun build --target=bun (single-file, ${mediaBundle.byteLength}B + ${computeBundle.byteLength}B)`,
    workerStart: startLogs,
    bootLogs: bootLogs.stdout.split("\n").filter((l) => l.length > 0),
  },
  credentialsDiscipline:
    "E2B_API_KEY env-only (never echoed, never committed; the record contains no secrets — scan target: the 'e2b_' prefix)",
};

mkdirSync(OUT_DIR, { recursive: true });
const outPath = resolve(OUT_DIR, "provider-record.json");
writeFileSync(outPath, JSON.stringify(record, null, 2) + "\n");

console.log("=== E2B provider provisioned (measured) ===");
console.log(`sandbox:          ${sandbox.sandboxId} (template ${info.templateId}, ${info.cpuCount} vCPU / ${info.memoryMB}MB)`);
console.log(`toolchain:        ${ffmpegVersionInSandbox}`);
console.log(`media worker:     ${mediaPublicUrl} (HTTP ${mediaDescriptorResponse.status}, operations ${(mediaDescriptor as { operations?: string[] }).operations?.join(",")})`);
console.log(
  `compute worker:   ${computePublicUrl} (HTTP ${computeDescriptorResponse.status}, renderers ${(computeDescriptor as { supportedRenderers?: { rendererId: string }[] }).supportedRenderers?.map((r) => r.rendererId).join(",")})`,
);
console.log(`keep-alive:       ${KEEP_ALIVE_MS / 60000} minutes`);
console.log(`provision time:   ${Date.now() - t0}ms`);
console.log(`record:           ${outPath}`);

/** Quotes a path for shell interpolation. */
function quote(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}
