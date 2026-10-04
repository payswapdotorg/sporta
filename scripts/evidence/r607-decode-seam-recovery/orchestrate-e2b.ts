/**
 * R607 DECODE-SEAM RECOVERY — THE E2B ORCHESTRATION (DEVELOPMENT-TIME
 * EVIDENCE, not a test; re-runnable): stands up the external media-toolchain
 * worker AT THE DECODE-SEAM MERGE — the pinned revision whose worker profile
 * advertises the ADDITIVE `decode-probe`/`decode-frames` pair (the R607 gap
 * flight A closure) — exactly the shape commands.md (§6 of the 65-j flight's
 * recovery path) records:
 *
 *   1. create ONE E2B sandbox (template `base`, Debian 12) with a LONG
 *      timeout (the hosted re-run must execute while it lives);
 *   2. in-sandbox: install ffmpeg (apt) + bun (bun.sh installer);
 *   3. git-clone the sporta repo AT THE PINNED DECODE-SEAM MERGE SHA (the
 *      worker code the hosted runtime talks to is exactly the recorded
 *      revision — the seam's decode operations included) + `bun install`
 *      the workspace;
 *   4. start `packages/compute-adapter-hosted/scripts/r607-media-toolchain-worker.ts`
 *      bound to HOSTNAME=0.0.0.0 PORT=3971 AND the companion
 *      `r607-e2b-compute-worker.ts` on PORT=3973 (the inherited
 *      COMPUTE_PROVIDER=http project posture requires a live compute worker
 *      at the composition's fail-loud boot — the 65-j orchestration left it
 *      un-started on fresh provision; this flight fix-forwards: BOTH workers
 *      start, BOTH are measured);
 *   5. verify the PUBLIC health + capability-descriptor URLs from the
 *      ORCHESTRATING host (the same network position the Vercel runtime
 *      holds) — the descriptor MUST advertise the four operations
 *      [probe, normalize, decode-probe, decode-frames];
 *   6. write `sandbox-record.json` (sandboxId, pinned sha, the MEASURED
 *      toolchain identity, the live descriptor, the lifetime) — the honest
 *      infrastructure record.
 *
 * Credentials discipline: E2B_API_KEY is env-only (never echoed, never
 * recorded; the committed tree is scanned for the `e2b_` prefix).
 *
 * Run (from the REPO ROOT):
 *   E2B_API_KEY=e2b_… bun run scripts/evidence/r607-decode-seam-recovery/orchestrate-e2b.ts
 *   # re-verify/re-extend the keep-alive of an ALREADY-RUNNING sandbox:
 *   E2B_API_KEY=e2b_… bun run scripts/evidence/r607-decode-seam-recovery/orchestrate-e2b.ts \
 *     --sandbox-id <id>
 *   # optional: --keep-down to leave the sandbox up after a failed probe.
 */
import { Sandbox } from "e2b";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const HERE = dirname(new URL(import.meta.url).pathname);
const OUT_DIR = HERE;

/** The pinned revision this flight's worker runs (recorded in sandbox-record.json). */
const PINNED_SHA = "920c556c18ba984d22d4bea50895b6a173b0a4bd";
const REPO_URL = "https://github.com/payswapdotorg/sporta.git";
/** The in-sandbox paths (the command shell runs as the unprivileged `user`). */
const REPO_DIR = "/home/user/sporta-repo";
const MEDIA_WORKER_LOG = "/home/user/media-worker.log";
const COMPUTE_WORKER_LOG = "/home/user/compute-worker.log";
const MEDIA_PORT = 3971;
const COMPUTE_PORT = 3973;
/** The acceptance window: sandbox must outlive deploy + golden path + records. */
const KEEP_ALIVE_MS = 2 * 60 * 60 * 1000; // 2h

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

function log(label: string, value: string): void {
  console.log(`[orchestrate] ${label}: ${value}`);
}

// ---------------------------------------------------------------------------
// 1. Create the sandbox (or reuse the already-running one).
// ---------------------------------------------------------------------------
const t0 = Date.now();
const sandbox =
  reuseSandboxId !== undefined
    ? await (Sandbox as unknown as { connect: (id: string) => Promise<Sandbox> }).connect(
        reuseSandboxId,
      )
    : await Sandbox.create("base", { apiKey });
log("sandbox", sandbox.sandboxId + (reuseSandboxId !== undefined ? " (REUSED)" : " (fresh)"));

const info = (await (sandbox as unknown as { getInfo: () => Promise<unknown> }).getInfo()) as Record<
  string,
  unknown
>;

// ---------------------------------------------------------------------------
// 2. The toolchain: apt ffmpeg + bun (skip when reusing a live sandbox —
//    the identity is RE-MEASURED either way, from the live binaries).
// ---------------------------------------------------------------------------
const apt = await sandbox.commands.run(
  reuseSandboxId === undefined
    ? "sudo apt-get update -qq && sudo apt-get install -y -qq ffmpeg > /tmp/apt-ffmpeg.log 2>&1; " +
        "ffmpeg -version | head -1; which ffmpeg ffprobe; " +
        "ffmpeg -hide_banner -encoders 2>/dev/null | grep -c libx264 || true"
    : "ffmpeg -version | head -1; which ffmpeg ffprobe; " +
        "ffmpeg -hide_banner -encoders 2>/dev/null | grep -c libx264 || true",
  { timeoutMs: 300_000 },
);
log("ffmpeg", apt.stdout.trim().replace(/\n/g, " | "));
if (apt.exitCode !== 0 || !apt.stdout.includes("ffmpeg version")) {
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

// ---------------------------------------------------------------------------
// 3. Clone the repo AT THE PINNED SHA + bun install (the worker runs from
//    the checked-out revision — never a hand-moved bundle).
// ---------------------------------------------------------------------------
const clone = await sandbox.commands.run(
  reuseSandboxId === undefined
    ? `rm -rf ${REPO_DIR} && git clone --quiet ${REPO_URL} ${REPO_DIR} 2>/tmp/clone.log && ` +
        `cd ${REPO_DIR} && git checkout --quiet ${PINNED_SHA} && git rev-parse HEAD && ` +
        "git status --short | wc -l"
    : `cd ${REPO_DIR} && git rev-parse HEAD && git status --short | wc -l`,
  { timeoutMs: 420_000 },
);
const cloneSha = clone.stdout.split("\n")[0]?.trim() ?? "";
log("clone", cloneSha);
if (cloneSha !== PINNED_SHA) {
  const why = await sandbox.commands.run("cat /tmp/clone.log 2>/dev/null | head -5", {
    timeoutMs: 15_000,
  });
  console.error(`FATAL: the in-sandbox checkout is not at the pinned sha (${cloneSha})\n${why.stdout}`);
  if (!keepDown) await sandbox.kill();
  process.exit(1);
}

const install = await sandbox.commands.run(
  reuseSandboxId === undefined
    ? `cd ${REPO_DIR} && ~/.bun/bin/bun install --frozen-lockfile > /tmp/bun-install-repo.log 2>&1; ` +
        "tail -2 /tmp/bun-install-repo.log"
    : "echo '(reused)'",
  { timeoutMs: 600_000 },
);
log("bun install (repo)", install.stdout.trim().replace(/\n/g, " | "));
if (install.exitCode !== 0) {
  const err = await sandbox.commands.run("tail -20 /tmp/bun-install-repo.log", { timeoutMs: 15_000 });
  console.error(`FATAL: bun install in-sandbox failed:\n${err.stdout}`);
  if (!keepDown) await sandbox.kill();
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 4. Start the media-toolchain worker AND the companion compute worker on
//    the public interface (BOTH — the fix-forward: the fresh provision must
//    leave the inherited COMPUTE_PROVIDER=http posture bootable).
// ---------------------------------------------------------------------------
if (reuseSandboxId === undefined) {
  const startMedia = await sandbox.commands.run(
    `cd ${REPO_DIR}/packages/compute-adapter-hosted && ` +
      `HOSTNAME=0.0.0.0 PORT=${MEDIA_PORT} nohup ~/.bun/bin/bun run scripts/r607-media-toolchain-worker.ts ` +
      `> ${MEDIA_WORKER_LOG} 2>&1 < /dev/null & echo MEDIA_PID $!`,
    { timeoutMs: 30_000 },
  );
  log("media worker start", startMedia.stdout.trim());
  const startCompute = await sandbox.commands.run(
    `cd ${REPO_DIR}/packages/compute-adapter-hosted && ` +
      `HOSTNAME=0.0.0.0 PORT=${COMPUTE_PORT} nohup ~/.bun/bin/bun run scripts/r607-e2b-compute-worker.ts ` +
      `> ${COMPUTE_WORKER_LOG} 2>&1 < /dev/null & echo COMPUTE_PID $!`,
    { timeoutMs: 30_000 },
  );
  log("compute worker start", startCompute.stdout.trim());
}

// Wait for the local health endpoints (bounded).
async function waitHealthy(port: number, label: string): Promise<boolean> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await new Promise((r) => setTimeout(r, 1500));
    const check = await sandbox.commands.run(
      `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:${port}/health`,
      { timeoutMs: 15_000 },
    );
    if (check.stdout.trim() === "200") return true;
  }
  console.error(`FATAL: ${label} did not become healthy on :${port}`);
  return false;
}
const mediaHealthy = await waitHealthy(MEDIA_PORT, "media worker");
if (!mediaHealthy) {
  const logs = await sandbox.commands.run(`cat ${MEDIA_WORKER_LOG}`, { timeoutMs: 10_000 });
  console.error(`FATAL: media worker did not become healthy:\n${logs.stdout}`);
  if (!keepDown) await sandbox.kill();
  process.exit(1);
}
const computeHealthy = await waitHealthy(COMPUTE_PORT, "compute worker");
if (!computeHealthy) {
  const logs = await sandbox.commands.run(`cat ${COMPUTE_WORKER_LOG}`, { timeoutMs: 10_000 });
  console.error(`FATAL: compute worker did not become healthy:\n${logs.stdout}`);
  if (!keepDown) await sandbox.kill();
  process.exit(1);
}
const mediaBootLog = await sandbox.commands.run(`cat ${MEDIA_WORKER_LOG}`, { timeoutMs: 10_000 });
const computeBootLog = await sandbox.commands.run(`cat ${COMPUTE_WORKER_LOG}`, { timeoutMs: 10_000 });
log("media boot log", "\n" + mediaBootLog.stdout);
log("compute boot log", "\n" + computeBootLog.stdout);

// ---------------------------------------------------------------------------
// 5. The PUBLIC URLS (the E2B port proxy) — verified from THIS orchestrating
//    host (the same network position the Vercel runtime holds). The media
//    descriptor MUST advertise the four operations (the seam's profile).
// ---------------------------------------------------------------------------
const getHost = (sandbox as unknown as { getHost: (port: number) => string }).getHost.bind(sandbox);
const mediaPublicUrl = `https://${getHost(MEDIA_PORT)}`;
const computePublicUrl = `https://${getHost(COMPUTE_PORT)}`;
log("public url", mediaPublicUrl);

const healthResponse = await fetch(`${mediaPublicUrl}/health`, { signal: AbortSignal.timeout(30_000) });
const health = (await healthResponse.json()) as Record<string, unknown>;
const descriptorResponse = await fetch(`${mediaPublicUrl}/v1/media/adapter`, {
  signal: AbortSignal.timeout(30_000),
});
const descriptor = (await descriptorResponse.json()) as Record<string, unknown>;
const advertisedOps = ((descriptor["operations"] as string[] | undefined) ?? []).slice().sort();
const expectedOps = ["decode-frames", "decode-probe", "normalize", "probe"];
log(
  "public verification",
  `health HTTP ${healthResponse.status} (ok=${String(health["ok"])}) / descriptor HTTP ${descriptorResponse.status} (resolved=${String((descriptor["toolchain"] as Record<string, unknown> | undefined)?.["resolved"])}, operations=[${advertisedOps.join(", ")}])`,
);
if (advertisedOps.join(",") !== expectedOps.join(",")) {
  console.error(
    `FATAL: the pinned-revision worker does not advertise the decode seam's four operations (got [${advertisedOps.join(", ")}], expected [${expectedOps.join(", ")}])`,
  );
  if (!keepDown) await sandbox.kill();
  process.exit(1);
}

const computeHealthResponse = await fetch(`${computePublicUrl}/health`, {
  signal: AbortSignal.timeout(30_000),
});
const computeHealth = (await computeHealthResponse.json()) as Record<string, unknown>;
log("compute worker (companion)", `${computePublicUrl} (health HTTP ${computeHealthResponse.status})`);

// ---------------------------------------------------------------------------
// 6. The sandbox lifetime (extended for the acceptance window).
// ---------------------------------------------------------------------------
await sandbox.setTimeout(KEEP_ALIVE_MS);
log("sandbox timeout", `${KEEP_ALIVE_MS / 60000} minutes`);

// ---------------------------------------------------------------------------
// 7. The honest sandbox record.
// ---------------------------------------------------------------------------
const record = {
  schemaVersion: "1.0",
  kind: "r607-decode-seam-recovery-sandbox-record",
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
      note: "EPHEMERAL BY DESIGN — the sandbox dies at the timeout; the public worker URL is ephemeral evidence (see the ephemerality doctrine in the 65-j flight's README.md)",
    },
    pinnedRevision: {
      sha: PINNED_SHA,
      subject:
        "Merge work/r607-decode-seam: the TL delivers R607 gap flight A — the R207 decode seam (the 62-c Gap 1 closure: the injected decode-port, the http decode executor, the ADDITIVE decode-probe/decode-frames wire pair; the non-degradation law held)",
      note: "the in-sandbox `git clone` checks out EXACTLY this sha (orchestrate-e2b.ts fails closed on any other HEAD); the worker the hosted runtime dispatches to runs this revision — the decode seam's decode-probe/decode-frames profile INCLUDED",
    },
    toolchain: {
      ffmpegVersion: apt.stdout.split("\n").find((l) => l.startsWith("ffmpeg version"))?.trim() ?? null,
      bunVersion: bunInstall.stdout.trim(),
      libx264Encoders: apt.stdout.trim().split("\n").pop()?.trim() ?? null,
    },
  },
  worker: {
    entry: "packages/compute-adapter-hosted/scripts/r607-media-toolchain-worker.ts",
    startCommand:
      `cd /home/user/sporta-repo/packages/compute-adapter-hosted && HOSTNAME=0.0.0.0 PORT=${MEDIA_PORT} nohup ~/.bun/bin/bun run scripts/r607-media-toolchain-worker.ts`,
    port: MEDIA_PORT,
    publicUrl: mediaPublicUrl,
    health: { httpStatusCode: healthResponse.status, body: health },
    descriptor: {
      httpStatusCode: descriptorResponse.status,
      body: descriptor,
      operationsAdvertised: advertisedOps,
      operationsExpected: expectedOps,
    },
    bootLog: mediaBootLog.stdout.split("\n").filter((l) => l.length > 0),
  },
  computeWorkerCompanion: {
    entry: "packages/compute-adapter-hosted/scripts/r607-e2b-compute-worker.ts",
    startCommand:
      `cd /home/user/sporta-repo/packages/compute-adapter-hosted && HOSTNAME=0.0.0.0 PORT=${COMPUTE_PORT} nohup ~/.bun/bin/bun run scripts/r607-e2b-compute-worker.ts`,
    port: COMPUTE_PORT,
    publicUrl: computePublicUrl,
    health: { httpStatusCode: computeHealthResponse.status, body: computeHealth },
    bootLog: computeBootLog.stdout.split("\n").filter((l) => l.length > 0),
    role: "the inherited 62-c project env sets COMPUTE_PROVIDER=http (the composition's boot-time live descriptor fetch is fail-loud) — this flight STARTS and measures the compute worker on fresh provision (the 65-j orchestration gap, fix-forwarded) so the production posture stays bootable through the deploy leg",
  },
  provisioning: {
    mode: reuseSandboxId !== undefined ? "reused-live-sandbox" : "fresh-provision",
    totalMs: Date.now() - t0,
    cloneCheckout: `git clone ${REPO_URL} + git checkout ${PINNED_SHA} (at ${REPO_DIR})`,
    notes: [
      "ffmpeg via `sudo apt-get install -y ffmpeg` (Debian bookworm 7:5.1.x + libx264)",
      "bun via `curl -fsSL https://bun.sh/install | bash`",
      "the repo workspace installed in-sandbox with `bun install --frozen-lockfile`",
      "the worker runs from the checked-out pinned revision — never a hand-moved bundle",
      "BOTH workers (media 3971 + compute 3973) started and measured on fresh provision",
    ],
  },
  credentialsDiscipline:
    "E2B_API_KEY env-only (never echoed, never committed; the record carries no secrets — scan target: the 'e2b_' prefix)",
};

mkdirSync(OUT_DIR, { recursive: true });
const outPath = resolve(OUT_DIR, "sandbox-record.json");
writeFileSync(outPath, JSON.stringify(record, null, 2) + "\n");

console.log("=== E2B decode-seam worker UP (measured) ===");
console.log(`sandbox:        ${sandbox.sandboxId}`);
console.log(`pinned sha:     ${PINNED_SHA}`);
console.log(`public url:     ${mediaPublicUrl} (health HTTP ${healthResponse.status})`);
console.log(`operations:     [${advertisedOps.join(", ")}]`);
console.log(`ffmpeg:         ${record.provider.toolchain.ffmpegVersion}`);
console.log(`keep-alive:     ${KEEP_ALIVE_MS / 60000} minutes`);
console.log(`provision time: ${Date.now() - t0}ms`);
console.log(`record:         ${outPath}`);
