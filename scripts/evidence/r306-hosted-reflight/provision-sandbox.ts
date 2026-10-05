/**
 * R306 HOSTED RE-FLIGHT — THE E2B PROVISIONING (DEVELOPMENT-TIME EVIDENCE,
 * not a test; re-runnable): stands up a FRESH external sandbox (media
 * toolchain worker first) AT THE PINNED ARTIFACT-INGEST-SEAM MERGE — origin/main
 * @ 5424a84e, the flight-68 tip whose app-side ingest LANDS the hosted plane's
 * two-runtime inline deliveries (the seam the 4/4 closure measure tests) —
 * the same provisioning shape the r306-live-wire flight flew
 * (`scripts/evidence/r306-live-wire/orchestrate-e2b.ts`), with this flight's
 * own deltas:
 *
 *   1. create ONE E2B sandbox (template `base`, Debian 12) with a LONG
 *      timeout (the whole re-flight chain must execute while it lives);
 *   2. in-sandbox: install ffmpeg (apt) + bun (bun.sh installer);
 *   3. git-clone the sporta repo AT THE PINNED R306 ARTIFACT-INGEST MERGE SHA
 *      (fail-closed on any other HEAD) + `bun install --frozen-lockfile`;
 *   4. start `packages/compute-adapter-hosted/scripts/r607-media-toolchain-worker.ts`
 *      bound to HOSTNAME=0.0.0.0 PORT=3971 — the worker's composition
 *      resolves the REAL `FfmpegFrameEncoder`
 *      (`createMediaToolchainWorker`'s R306 default), so its descriptor
 *      advertises the FIVE operations
 *      [probe, normalize, decode-probe, decode-frames, encode-frames];
 *      the start is IDEMPOTENT (health-check-first, start-if-down — the
 *      r607 lesson: the nohup start command's RPC response can be lost to
 *      an SDK deadline while the worker still boots; the bounded health
 *      wait is the arbiter);
 *   5. verify the PUBLIC health + capability-descriptor URLs from the
 *      ORCHESTRATING host (the same network position the hosted Vercel
 *      runtime holds) — the descriptor MUST advertise the five operations;
 *   6. write `sandbox-record.json` (sandboxId, pinned sha, the MEASURED
 *      toolchain identity, the live descriptor, the lifetime) — the honest
 *      infrastructure record.
 *
 * ONE worker here, not two: this provisioning is the re-flight's first leg
 * (provision → boot-compute-worker → deploy → THE WALK); the compute-worker
 * companion (:3973) is booted by the next leg's driver
 * (`boot-compute-worker.ts` in THIS dir).
 *
 * Credentials discipline: E2B_API_KEY is env-only (never echoed, never
 * recorded; the committed tree is scanned for the `e2b_` prefix).
 *
 * Run (from the REPO ROOT):
 *   E2B_API_KEY=e2b_… bun run scripts/evidence/r306-hosted-reflight/provision-sandbox.ts
 *   # re-verify/re-extend the keep-alive of an ALREADY-RUNNING sandbox:
 *   E2B_API_KEY=e2b_… bun run scripts/evidence/r306-hosted-reflight/provision-sandbox.ts \
 *     --sandbox-id <id>
 *   # optional: --keep-down to leave the sandbox up after a failed probe.
 */
import { Sandbox } from "e2b";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const HERE = dirname(new URL(import.meta.url).pathname);
const OUT_DIR = HERE;

/** The pinned revision this flight's workers run (recorded in sandbox-record.json). */
const PINNED_SHA = "5424a84e089db3b96b5f489b3e11f2ed66a56dec";
const PINNED_SUBJECT =
  "Merge work/r306-artifact-ingest: the R306 arc's flight 5 — THE ARTIFACT-DELIVERY/INGEST SEAM closed at the app-side ingest (the hosted plane's two-runtime split now LANDS the delivery: every existing fail-closed check BEFORE any put, the store's own cross-verified registration, the read-back under the registration's RETURNED artifactId)";
const REPO_URL = "https://github.com/payswapdotorg/sporta.git";
/** The in-sandbox paths (the command shell runs as the unprivileged `user`). */
const REPO_DIR = "/home/user/sporta-repo";
const MEDIA_WORKER_LOG = "/home/user/media-worker.log";
const MEDIA_PORT = 3971;
/** The acceptance window: sandbox must outlive the live-wire driver + records. */
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
// 4. Start the media-toolchain worker on the public interface. The start is
//    IDEMPOTENT (health-check-first, start-if-down) — a re-run after an SDK
//    deadline retries cleanly instead of double-starting.
// ---------------------------------------------------------------------------
async function ensureWorker(port: number, label: string, entry: string, logFile: string): Promise<void> {
  const pre = await sandbox.commands.run(
    `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:${port}/health || true`,
    { timeoutMs: 15_000 },
  );
  if (pre.stdout.trim() === "200") {
    log(`${label} start`, `(already healthy on :${port} — idempotent skip)`);
    return;
  }
  try {
    const start = await sandbox.commands.run(
      `cd ${REPO_DIR}/packages/compute-adapter-hosted && ` +
        `HOSTNAME=0.0.0.0 PORT=${port} nohup ~/.bun/bin/bun run scripts/${entry} ` +
        `> ${logFile} 2>&1 < /dev/null & echo ${label.toUpperCase()}_PID $!`,
      { timeoutMs: 60_000 },
    );
    log(`${label} start`, start.stdout.trim());
  } catch (error) {
    // The EMPIRICALLY OBSERVED SDK behavior (the r607 lesson): the `nohup … &`
    // start command EXECUTES in-sandbox (the worker boots) but its RPC
    // response is lost to a deadline_exceeded. The start is therefore NOT
    // treated as fatal: the bounded health wait below is the honest arbiter.
    log(
      `${label} start`,
      `(start command's RPC response lost: ${String(error).slice(0, 80)} — the health wait arbitrates)`,
    );
  }
}
await ensureWorker(MEDIA_PORT, "media", "r607-media-toolchain-worker.ts", MEDIA_WORKER_LOG);

// Wait for the local health endpoint (bounded).
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
// The boot log is read BASE64-WRAPPED and decoded client-side: the raw
// bytes' fidelity is PROVABLE end-to-end (the in-sandbox `od -c` shows
// `[media-toolchain-worker]`; the base64 round trip and the written JSON
// both carry the true bytes — verified with a byte-exact reader). The
// MEASURED artifact is on the DISPLAY channel: a bare `[m` sequence is
// eaten by this sandbox's terminal rendering (the 66-b2 flight's own
// finding — `cat`, a sed-prefixed `cat`, and `console.log` all DISPLAY the
// line as `edia-toolchain-worker]`); the base64 wrap keeps the read
// verifiable regardless of what any terminal shows.
const mediaBootLogB64 = await sandbox.commands.run(`base64 -w 0 ${MEDIA_WORKER_LOG}`, {
  timeoutMs: 15_000,
});
const mediaBootLogText = Buffer.from(mediaBootLogB64.stdout.trim(), "base64").toString("utf8");
log("media boot log", "\n" + mediaBootLogText);

// ---------------------------------------------------------------------------
// 5. The PUBLIC URL (the E2B port proxy) — verified from THIS orchestrating
//    host (the same network position the Vercel runtime holds). The media
//    descriptor MUST advertise the encode seam's FIVE operations.
// ---------------------------------------------------------------------------
const getHost = (sandbox as unknown as { getHost: (port: number) => string }).getHost.bind(sandbox);
const mediaPublicUrl = `https://${getHost(MEDIA_PORT)}`;
log("public url", mediaPublicUrl);

const healthResponse = await fetch(`${mediaPublicUrl}/health`, { signal: AbortSignal.timeout(30_000) });
const health = (await healthResponse.json()) as Record<string, unknown>;
const descriptorResponse = await fetch(`${mediaPublicUrl}/v1/media/adapter`, {
  signal: AbortSignal.timeout(30_000),
});
const descriptor = (await descriptorResponse.json()) as Record<string, unknown>;
const advertisedOps = ((descriptor["operations"] as string[] | undefined) ?? []).slice().sort();
const expectedOps = ["decode-frames", "decode-probe", "encode-frames", "normalize", "probe"];
log(
  "public verification",
  `health HTTP ${healthResponse.status} (ok=${String(health["ok"])}) / descriptor HTTP ${descriptorResponse.status} (resolved=${String((descriptor["toolchain"] as Record<string, unknown> | undefined)?.["resolved"])}, operations=[${advertisedOps.join(", ")}])`,
);
if (advertisedOps.join(",") !== expectedOps.join(",")) {
  console.error(
    `FATAL: the pinned-revision worker does not advertise the encode seam's five operations (got [${advertisedOps.join(", ")}], expected [${expectedOps.join(", ")}])`,
  );
  if (!keepDown) await sandbox.kill();
  process.exit(1);
}

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
  kind: "r306-hosted-reflight-sandbox-record",
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
      note: "EPHEMERAL BY DESIGN — the sandbox dies at the timeout; the public worker URL is ephemeral evidence (the ephemerality doctrine measured live twice by the r607 flight: a dead sandbox's public URL answers the proxy's 502 'The sandbox was not found')",
    },
    pinnedRevision: {
      sha: PINNED_SHA,
      subject: PINNED_SUBJECT,
      note: "the in-sandbox `git clone` checks out EXACTLY this sha (provision-sandbox.ts fails closed on any other HEAD); the workers the re-flight chain runs execute this revision — the artifact-ingest seam INCLUDED (the app-side ingest the 4/4 closure measure tests; the worker's composition resolves the REAL FfmpegFrameEncoder, the createMediaToolchainWorker R306 default)",
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
    bootLog: mediaBootLogText.split("\n").filter((l) => l.length > 0),
    bootLogRead: "base64-wrapped (`base64 -w 0 <log>` decoded client-side) so the read is verifiable regardless of terminal rendering — the MEASURED artifact is on the DISPLAY channel, not the wire: a bare `[m` sequence is eaten by this sandbox's terminal display (the 66-b2 flight's own finding; `cat` and `console.log` DISPLAY `edia-toolchain-worker]`), while the in-sandbox `od -c`, the base64 round trip, and the byte-exact read of this JSON all carry the file's TRUE `[media-toolchain-worker]` bytes",
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
      "ONE worker (media :3971) in this provisioning leg — the compute-worker companion (:3973) is the next leg (boot-compute-worker.ts in THIS dir; the hosted re-flight's own chain)",
      ...(reuseSandboxId !== undefined
        ? [
            "THIS record was written by an idempotent re-verification invocation (--sandbox-id): every identity re-measured from the live binaries (HEAD, toolchain, public health + descriptor, keep-alive extension); the fresh provision was the first invocation (the chain as executed in commands.md)",
          ]
        : []),
    ],
  },
  credentialsDiscipline:
    "E2B_API_KEY env-only (never echoed, never committed; the record carries no secrets — scan target: the 'e2b_' prefix)",
};

mkdirSync(OUT_DIR, { recursive: true });
const outPath = resolve(OUT_DIR, "sandbox-record.json");
writeFileSync(outPath, JSON.stringify(record, null, 2) + "\n");

console.log("=== THE HOSTED RE-FLIGHT'S SANDBOX + MEDIA WORKER UP (measured) ===");
console.log(`sandbox:        ${sandbox.sandboxId}`);
console.log(`pinned sha:     ${PINNED_SHA}`);
console.log(`public url:     ${mediaPublicUrl} (health HTTP ${healthResponse.status})`);
console.log(`operations:     [${advertisedOps.join(", ")}]`);
console.log(`ffmpeg:         ${record.provider.toolchain.ffmpegVersion}`);
console.log(`keep-alive:     ${KEEP_ALIVE_MS / 60000} minutes`);
console.log(`provision time: ${Date.now() - t0}ms`);
console.log(`record:         ${outPath}`);
