/**
 * R306 DEPLOY LEG — THE COMPANION COMPUTE-WORKER BOOT (DEVELOPMENT-TIME
 * EVIDENCE, not a test; re-runnable): boots the full-plane compute worker
 * (r607-e2b-compute-worker.ts) in the SAME live E2B sandbox the live-wire
 * flight provisioned (`scripts/evidence/r306-live-wire/sandbox-record.json`)
 * — the r607 lesson mirrored: the inherited `COMPUTE_PROVIDER=http` project
 * posture requires a LIVE compute worker at the composition's fail-loud boot
 * (the 62-c production-500 incident class: a dead `COMPUTE_WORKER_URL` kills
 * the boot-time `/v1/adapter` descriptor fetch, the composition dies, every
 * API route 500s). This flight's deploy must bake a LIVE compute-worker URL
 * exactly as it bakes the live media-worker URL.
 *
 * Legs (mirroring the r607 two-worker orchestration's compute half, against
 * the REUSED sandbox — the media worker is already up and verified by the
 * live-wire flight):
 *
 *   1. connect to the running sandbox (`--sandbox-id`, required here — this
 *      script never provisions; the live-wire orchestrator owns provision);
 *   2. idempotent health-check-first start of
 *      `packages/compute-adapter-hosted/scripts/r607-e2b-compute-worker.ts`
 *      on HOSTNAME=0.0.0.0 PORT=3973 (the in-sandbox clone at the pinned
 *      R306 encode-seam merge — the same revision the media worker runs);
 *   3. bounded local health wait (the honest arbiter — the start command's
 *      RPC response can be lost to an SDK deadline while the worker boots);
 *   4. verify BOTH public URLs (3971 media + 3973 compute) from THIS
 *      orchestrating machine (the same network position the Vercel runtime
 *      holds): the media descriptor MUST still advertise the encode seam's
 *      FIVE operations; the compute worker's `/health` must answer 200 and
 *      its `/v1/adapter` descriptor must resolve (the boot-time fetch the
 *      composition performs — verified over the exact URL the deploy bakes);
 *   5. re-extend the sandbox keep-alive (2h from THIS invocation) so the
 *      deploy + verification legs execute inside the acceptance window;
 *   6. write `compute-worker-record.json` (the honest infrastructure record).
 *
 * Credentials discipline: E2B_API_KEY is env-only (never echoed, never
 * recorded; the committed tree is scanned for the `e2b_` prefix).
 *
 * Run (from the REPO ROOT):
 *   E2B_API_KEY=e2b_… bun run scripts/evidence/r306-deploy/boot-compute-worker.ts \
 *     --sandbox-id <id>
 */
import { Sandbox } from "e2b";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const HERE = dirname(new URL(import.meta.url).pathname);
const OUT_DIR = HERE;

/**
 * The pinned revision the in-sandbox clone checks out (the live-wire flight's
 * pinned sha — the R306 ENCODE-SEAM MERGE; re-measured fail-closed here).
 */
const PINNED_SHA = "dc2ed8fc9c7b9c91253a80378e31006965cc1e9a";
/** The in-sandbox paths (the command shell runs as the unprivileged `user`). */
const REPO_DIR = "/home/user/sporta-repo";
const COMPUTE_WORKER_LOG = "/home/user/compute-worker.log";
const MEDIA_PORT = 3971;
const COMPUTE_PORT = 3973;
/** The acceptance window: sandbox must outlive deploy + verification + records. */
const KEEP_ALIVE_MS = 2 * 60 * 60 * 1000; // 2h

const argv = process.argv.slice(2);
const reuseSandboxId = (() => {
  const at = argv.indexOf("--sandbox-id");
  return at === -1 ? undefined : argv[at + 1];
})();
if (reuseSandboxId === undefined) {
  console.error("FATAL: --sandbox-id <id> is required (this flight reuses the live-wire sandbox)");
  process.exit(1);
}

const apiKey = process.env.E2B_API_KEY;
if (apiKey === undefined || apiKey === "") {
  console.error("FATAL: E2B_API_KEY is required (env-only; never recorded)");
  process.exit(1);
}

function log(label: string, value: string): void {
  console.log(`[boot-compute] ${label}: ${value}`);
}

// ---------------------------------------------------------------------------
// 1. Connect to the running sandbox (fail-closed on the pinned revision).
// ---------------------------------------------------------------------------
const t0 = Date.now();
const sandbox = await (Sandbox as unknown as { connect: (id: string) => Promise<Sandbox> }).connect(
  reuseSandboxId,
);
log("sandbox", sandbox.sandboxId + " (REUSED — the live-wire flight's sandbox)");
const info = (await (sandbox as unknown as { getInfo: () => Promise<unknown> }).getInfo()) as Record<
  string,
  unknown
>;

const head = await sandbox.commands.run(`cd ${REPO_DIR} && git rev-parse HEAD`, { timeoutMs: 30_000 });
const headSha = head.stdout.trim();
log("in-sandbox HEAD", headSha);
if (headSha !== PINNED_SHA) {
  console.error(`FATAL: the in-sandbox checkout is not at the pinned sha (${headSha})`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 2. The idempotent compute-worker start (health-check-first, start-if-down).
// ---------------------------------------------------------------------------
const pre = await sandbox.commands.run(
  `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:${COMPUTE_PORT}/health || true`,
  { timeoutMs: 15_000 },
);
if (pre.stdout.trim() === "200") {
  log("compute start", `(already healthy on :${COMPUTE_PORT} — idempotent skip)`);
} else {
  log("compute start", `(not healthy on :${COMPUTE_PORT} — starting)`);
  try {
    const start = await sandbox.commands.run(
      `cd ${REPO_DIR}/packages/compute-adapter-hosted && ` +
        `HOSTNAME=0.0.0.0 PORT=${COMPUTE_PORT} nohup ~/.bun/bin/bun run scripts/r607-e2b-compute-worker.ts ` +
        `> ${COMPUTE_WORKER_LOG} 2>&1 < /dev/null & echo COMPUTE_PID $!`,
      { timeoutMs: 60_000 },
    );
    log("compute start", start.stdout.trim());
  } catch (error) {
    // The empirically observed SDK behavior (measured by the r607 + live-wire
    // flights): the `nohup … &` start EXECUTES in-sandbox (the worker boots)
    // but its RPC response is lost to a deadline_exceeded — the bounded
    // health wait below is the honest arbiter, never the start's response.
    log(
      "compute start",
      `(start command's RPC response lost: ${String(error).slice(0, 80)} — the health wait arbitrates)`,
    );
  }
}

// The bounded local health wait.
let computeHealthy = false;
for (let attempt = 0; attempt < 40; attempt += 1) {
  await new Promise((r) => setTimeout(r, 1500));
  const check = await sandbox.commands.run(
    `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:${COMPUTE_PORT}/health`,
    { timeoutMs: 15_000 },
  );
  if (check.stdout.trim() === "200") {
    computeHealthy = true;
    break;
  }
}
if (!computeHealthy) {
  const logs = await sandbox.commands.run(`cat ${COMPUTE_WORKER_LOG}`, { timeoutMs: 10_000 });
  console.error(`FATAL: compute worker did not become healthy on :${COMPUTE_PORT}:\n${logs.stdout}`);
  process.exit(1);
}
log("compute health", "local 200 (bounded wait passed)");

// The boot log is read BASE64-WRAPPED and decoded client-side (the live-wire
// flight's measured display artifact: a bare `[m` sequence is eaten by this
// sandbox's terminal DISPLAY channel; the base64 round trip carries the TRUE
// bytes regardless of what any terminal shows).
const bootLogB64 = await sandbox.commands.run(`base64 -w 0 ${COMPUTE_WORKER_LOG}`, {
  timeoutMs: 15_000,
});
const bootLogText = Buffer.from(bootLogB64.stdout.trim(), "base64").toString("utf8");
log("compute boot log", "\n" + bootLogText);

// ---------------------------------------------------------------------------
// 3. BOTH public URLs verified from THIS machine (the orchestrating host —
//    the same network position the Vercel runtime holds).
// ---------------------------------------------------------------------------
const getHost = (sandbox as unknown as { getHost: (port: number) => string }).getHost.bind(sandbox);
const mediaPublicUrl = `https://${getHost(MEDIA_PORT)}`;
const computePublicUrl = `https://${getHost(COMPUTE_PORT)}`;
log("public urls", `media ${mediaPublicUrl} / compute ${computePublicUrl}`);

const mediaHealthResponse = await fetch(`${mediaPublicUrl}/health`, {
  signal: AbortSignal.timeout(30_000),
});
const mediaHealth = (await mediaHealthResponse.json()) as Record<string, unknown>;
const mediaDescriptorResponse = await fetch(`${mediaPublicUrl}/v1/media/adapter`, {
  signal: AbortSignal.timeout(30_000),
});
const mediaDescriptor = (await mediaDescriptorResponse.json()) as Record<string, unknown>;
const mediaOps = ((mediaDescriptor["operations"] as string[] | undefined) ?? []).slice().sort();
const expectedMediaOps = ["decode-frames", "decode-probe", "encode-frames", "normalize", "probe"];

const computeHealthResponse = await fetch(`${computePublicUrl}/health`, {
  signal: AbortSignal.timeout(30_000),
});
const computeHealth = (await computeHealthResponse.json()) as Record<string, unknown>;
// THE BOOT-TIME FETCH the composition performs (compute-adapter-hosted/src/env.ts:
// GET {COMPUTE_WORKER_URL}/v1/adapter, fail-loud) — measured over the exact
// URL the deploy will bake.
const computeDescriptorResponse = await fetch(`${computePublicUrl}/v1/adapter`, {
  signal: AbortSignal.timeout(30_000),
});
const computeDescriptor = (await computeDescriptorResponse.json()) as Record<string, unknown>;
const computeRenderers = ((computeDescriptor["supportedRenderers"] as { rendererId: string }[] | undefined) ?? [])
  .map((r) => r.rendererId)
  .slice()
  .sort();

log(
  "public verification",
  `media health HTTP ${mediaHealthResponse.status} / media descriptor HTTP ${mediaDescriptorResponse.status} (operations=[${mediaOps.join(", ")}]) / ` +
    `compute health HTTP ${computeHealthResponse.status} / compute descriptor HTTP ${computeDescriptorResponse.status} (renderers=[${computeRenderers.join(", ")}])`,
);

const failures: string[] = [];
if (mediaHealthResponse.status !== 200) failures.push(`media health HTTP ${mediaHealthResponse.status}`);
if (mediaDescriptorResponse.status !== 200) failures.push(`media descriptor HTTP ${mediaDescriptorResponse.status}`);
if (mediaOps.join(",") !== expectedMediaOps.join(",")) {
  failures.push(`media operations [${mediaOps.join(", ")}] (expected [${expectedMediaOps.join(", ")}])`);
}
if (computeHealthResponse.status !== 200) failures.push(`compute health HTTP ${computeHealthResponse.status}`);
if (computeDescriptorResponse.status !== 200) {
  failures.push(`compute descriptor HTTP ${computeDescriptorResponse.status}`);
}
if (failures.length > 0) {
  console.error(`FATAL: the public verification refused:\n  ${failures.join("\n  ")}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 4. The sandbox lifetime (re-extended for the deploy acceptance window).
// ---------------------------------------------------------------------------
await sandbox.setTimeout(KEEP_ALIVE_MS);
log("sandbox timeout", `${KEEP_ALIVE_MS / 60000} minutes (re-extended from THIS invocation)`);

// ---------------------------------------------------------------------------
// 5. The honest compute-worker record.
// ---------------------------------------------------------------------------
const record = {
  schemaVersion: "1.0",
  kind: "r306-deploy-compute-worker-record",
  provider: {
    name: "E2B",
    sandbox: {
      sandboxId: sandbox.sandboxId,
      envdVersion: String(info.envdVersion ?? "unknown"),
      startedAtIso: info.startedAt,
      keepAliveMs: KEEP_ALIVE_MS,
      keepAliveReExtendedAtIso: new Date().toISOString(),
      lifecycleOnTimeout: String((info.lifecycle as { onTimeout?: string })?.onTimeout ?? "kill"),
      note: "EPHEMERAL BY DESIGN — the sandbox dies at the timeout; both public worker URLs are ephemeral evidence (the ephemerality doctrine in deploy-record.json)",
    },
    pinnedRevision: {
      sha: PINNED_SHA,
      note: "the in-sandbox clone's HEAD re-measured fail-closed (the same pinned revision the live-wire flight provisioned — the R306 encode-seam merge; the compute worker runs from the checked-out revision, never a hand-moved bundle)",
    },
  },
  computeWorker: {
    entry: "packages/compute-adapter-hosted/scripts/r607-e2b-compute-worker.ts",
    startCommand: `cd ${REPO_DIR}/packages/compute-adapter-hosted && HOSTNAME=0.0.0.0 PORT=${COMPUTE_PORT} nohup ~/.bun/bin/bun run scripts/r607-e2b-compute-worker.ts`,
    port: COMPUTE_PORT,
    publicUrl: computePublicUrl,
    health: { httpStatusCode: computeHealthResponse.status, body: computeHealth },
    descriptor: {
      httpStatusCode: computeDescriptorResponse.status,
      body: computeDescriptor,
      renderersAdvertised: computeRenderers,
      note: "THE BOOT-TIME FETCH MEASURED: GET {COMPUTE_WORKER_URL}/v1/adapter over the exact URL the deploy bakes — the fetch the composition performs fail-loud at boot (compute-adapter-hosted/src/env.ts); HTTP 200 here is the leg whose failure is the 62-c production-500 incident class",
    },
    bootLog: bootLogText.split("\n").filter((l) => l.length > 0),
    bootLogRead: "base64-wrapped (`base64 -w 0 <log>` decoded client-side — the live-wire flight's measured display artifact: a bare `[m` sequence is eaten by this sandbox's terminal DISPLAY channel; the round trip carries the TRUE bytes)",
    role: "the inherited COMPUTE_PROVIDER=http posture requires a live compute worker at the composition's fail-loud boot — the r607 two-worker lesson mirrored at the R306 arc's deploy flight",
  },
  mediaWorker: {
    publicUrl: mediaPublicUrl,
    health: { httpStatusCode: mediaHealthResponse.status, body: mediaHealth },
    descriptor: {
      httpStatusCode: mediaDescriptorResponse.status,
      operationsAdvertised: mediaOps,
      operationsExpected: expectedMediaOps,
    },
    note: "the live-wire flight's worker (still up — re-verified from THIS machine at the compute boot: the five-operation profile incl. encode-frames, the R306 arc's seam)",
  },
  provisioning: {
    mode: "reused-live-sandbox (the live-wire flight's)",
    totalMs: Date.now() - t0,
    notes: [
      "the media worker was NOT restarted (health-check-first idempotent skip — it was already healthy)",
      "the compute worker started idempotently on :3973 (health-check-first, start-if-down)",
      "the keep-alive re-extended to 2h from THIS invocation (the deploy + verification window)",
    ],
  },
  credentialsDiscipline:
    "E2B_API_KEY env-only (never echoed, never committed; the record carries no secrets — scan target: the 'e2b_' prefix)",
};

mkdirSync(OUT_DIR, { recursive: true });
const outPath = resolve(OUT_DIR, "compute-worker-record.json");
writeFileSync(outPath, JSON.stringify(record, null, 2) + "\n");

console.log("=== THE COMPANION COMPUTE WORKER UP (measured) ===");
console.log(`sandbox:          ${sandbox.sandboxId}`);
console.log(`in-sandbox HEAD:  ${PINNED_SHA}`);
console.log(`compute public:   ${computePublicUrl} (health HTTP ${computeHealthResponse.status}, descriptor HTTP ${computeDescriptorResponse.status})`);
console.log(`compute renderers [${computeRenderers.join(", ")}]`);
console.log(`media public:     ${mediaPublicUrl} (health HTTP ${mediaHealthResponse.status}, ops [${mediaOps.join(", ")}])`);
console.log(`keep-alive:       ${KEEP_ALIVE_MS / 60000} minutes (re-extended)`);
console.log(`elapsed:          ${Date.now() - t0}ms`);
console.log(`record:           ${outPath}`);
