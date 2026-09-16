/**
 * THE W909 BROWSER E2E RUNNER — the on-demand harness that:
 *
 *   (a) builds the production app (next build; SKIPPABLE via --skip-build
 *       when .next is already current);
 *   (b) starts the PRODUCTION server on a NON-3000 port
 *       (`bun --bun run start`, PORT + -p) with a CLEAN environment (the
 *       stray-shell DATABASE_URL hazard is refused, not worked around) and
 *       the demo account's password consciously set for the role-switch
 *       flow (SPORTA_DEMO_ACCOUNT_PASSWORD — the operator provisioning
 *       path, never self-registration);
 *   (c) drives a REAL headless browser (agent-browser) through the W909
 *       acceptance flows;
 *   (d) asserts REAL outcomes (every assertion recorded with its evidence);
 *   (e) kills the server and closes the browser, then exits 0 only when
 *       every flow passed.
 *
 * Run it from apps/web:   bun run e2e
 * (NOT part of the root `bun test` default — see e2e/README.md.)
 */
import { copyFileSync, mkdirSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  flowSpecOf,
  isE2EFlowId,
  recommendedFlowOrder,
  unknownInventoryRoutes,
  type E2EFlowId,
} from "./lib/inventory";
import { BrowserDriver } from "./lib/browser-driver";
import { FlowRecorder, summarizeRun, type FlowContext, type FlowOutcome, type Discovery } from "./lib/harness";
import { a11ySmokeFlow } from "./flows/a11y-smoke";
import { signInFlow } from "./flows/sign-in";
import { rightsDenialFlow } from "./flows/rights-denial";
import { watchFlow } from "./flows/watch";
import { realitySwitchFlow } from "./flows/reality-switch";
import { outputPlaybackFlow } from "./flows/output-playback";
import { renderFlow } from "./flows/render";
import { roleSwitchFlow } from "./flows/role-switch";

// ------------------------------------------------------------------ options

const args = process.argv.slice(2);
const skipBuild = args.includes("--skip-build");
const onlyIndex = args.indexOf("--only");
const onlyArg = onlyIndex !== -1 ? args[onlyIndex + 1] : undefined;
if (onlyArg !== undefined && !isE2EFlowId(onlyArg)) {
  console.error(`--only expects one of: ${recommendedFlowOrder().join(", ")}`);
  process.exit(2);
}
const onlyFlow: E2EFlowId | undefined =
  onlyArg !== undefined && isE2EFlowId(onlyArg) ? onlyArg : undefined;

const PORT = Number.parseInt(process.env.E2E_PORT ?? "3909", 10);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const APP_DIR = import.meta.dir.replace(/\/e2e$/, "");
const EVIDENCE_ROOT = join(import.meta.dir, "evidence");
const DEMO_PASSWORD = process.env.SPORTA_DEMO_ACCOUNT_PASSWORD ?? "e2e-demo-account";
const runId = `${Date.now().toString(36)}`;
const evidenceDir = join(EVIDENCE_ROOT, `run-${runId}`);
mkdirSync(evidenceDir, { recursive: true });

/** The clean child environment (the stray DATABASE_URL hazard is refused). */
function cleanChildEnv(): Record<string, string> {
  if (process.env.DATABASE_URL !== undefined) {
    console.error(
      "REFUSING to run with DATABASE_URL in the harness environment (the known stray-DSN hazard). Run with: env -u DATABASE_URL bun run e2e",
    );
    process.exit(2);
  }
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== "DATABASE_URL") env[key] = value;
  }
  return env;
}

// ------------------------------------------------------- the inventory gate

const unknownRoutes = unknownInventoryRoutes();
if (unknownRoutes.length > 0) {
  console.error(`E2E inventory references unknown shell routes: ${unknownRoutes.join(", ")}`);
  process.exit(2);
}

// -------------------------------------------------------------------- build

async function buildApp(): Promise<void> {
  console.log("[e2e] building the production app (next build)…");
  const build = Bun.spawnSync({
    cmd: ["bun", "run", "build"],
    cwd: APP_DIR,
    env: cleanChildEnv(),
    stdout: "inherit",
    stderr: "inherit",
  });
  if (build.exitCode !== 0) {
    console.error(`[e2e] build failed (exit ${build.exitCode})`);
    process.exit(1);
  }
  console.log("[e2e] build green.");
}

// ------------------------------------------------------------------- server

interface RunningServer {
  pid: number;
  kill(): Promise<void>;
}

async function startServer(): Promise<RunningServer> {
  console.log(`[e2e] starting the production server on port ${PORT} (bun --bun run start)…`);
  const env = cleanChildEnv();
  env.PORT = String(PORT);
  env.SPORTA_DEMO_ACCOUNT_PASSWORD = DEMO_PASSWORD;
  const logFile = join(evidenceDir, "server.log");
  const log = Bun.file(logFile).writer();
  const proc = Bun.spawn({
    cmd: ["bun", "--bun", "run", "start", "--", "-p", String(PORT)],
    cwd: APP_DIR,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  // Stream the server's stdout/stderr into the evidence log file.
  void (async () => {
    const streams = [proc.stdout, proc.stderr] as unknown as AsyncIterable<Uint8Array>[];
    for (const stream of streams) {
      try {
        for await (const chunk of stream) await log.write(chunk);
      } catch {
        // the server dying closes the pipe — its exit code is checked below
      }
    }
  })();

  const deadline = Date.now() + 90_000;
  let ready = false;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) {
      await log.end();
      console.error(`[e2e] server exited early (code ${proc.exitCode}) — see ${logFile}`);
      process.exit(1);
    }
    try {
      const response = await fetch(`${BASE_URL}/api/platform/health`);
      if (response.status === 200) {
        ready = true;
        break;
      }
    } catch {
      // not listening yet
    }
    await Bun.sleep(500);
  }
  if (!ready) {
    await log.end();
    console.error(`[e2e] server did not become ready on ${BASE_URL} — see ${logFile}`);
    proc.kill();
    process.exit(1);
  }
  console.log(`[e2e] server ready on ${BASE_URL} (pid ${proc.pid}).`);
  return {
    pid: proc.pid,
    kill: async () => {
      proc.kill();
      const killDeadline = Date.now() + 10_000;
      while (proc.exitCode === null && Date.now() < killDeadline) await Bun.sleep(200);
      if (proc.exitCode === null) proc.kill(9);
      await log.end();
      console.log(`[e2e] server (pid ${proc.pid}) stopped.`);
    },
  };
}

// ---------------------------------------------------------------- discovery

interface CatalogCard {
  sessionId: string;
  realities: { rendererId: string }[] | null;
  story: { storyKey: string } | null;
}

interface WatchModel {
  renders:
    | { renderId: string; rendererId: string; outputs: { segmentId: string }[] }[]
    | null;
}

async function discoverSeededContent(): Promise<Discovery> {
  const catalogResponse = await fetch(`${BASE_URL}/api/catalog/sessions`);
  if (!catalogResponse.ok) throw new Error(`catalog answered ${catalogResponse.status}`);
  const catalog = (await catalogResponse.json()) as { sessions: CatalogCard[] };
  const ranked = [...catalog.sessions].sort(
    (a, b) => (b.realities?.length ?? 0) - (a.realities?.length ?? 0),
  );
  const primary = ranked[0];
  if (primary === undefined) throw new Error("no seeded sessions in the catalog");

  const watchResponse = await fetch(
    `${BASE_URL}/api/watch/${encodeURIComponent(primary.sessionId)}`,
  );
  if (!watchResponse.ok) throw new Error(`watch model answered ${watchResponse.status}`);
  const watch = (await watchResponse.json()) as WatchModel;
  const storedRenders = (watch.renders ?? [])
    .filter((render) => render.outputs.length > 0)
    .map((render) => ({
      renderId: render.renderId,
      rendererId: render.rendererId,
      segmentIds: render.outputs.map((output) => output.segmentId),
    }));

  return {
    primarySession: {
      sessionId: primary.sessionId,
      label: primary.sessionId,
      storyKey: primary.story?.storyKey ?? "unknown",
      storedRenders,
    },
    allSessionIds: catalog.sessions.map((session) => session.sessionId),
  };
}

// -------------------------------------------------------------------- report

function writeReport(outcomes: readonly FlowOutcome[]): void {
  const summary = summarizeRun(outcomes);
  const report = {
    runId,
    baseUrl: BASE_URL,
    startedAtIso: new Date(Number.parseInt(runId, 36)).toISOString(),
    flows: outcomes,
    summary,
  };
  writeFileSync(
    join(evidenceDir, "e2e-report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );

  const lines: string[] = [
    `# W909 browser E2E — run ${runId}`,
    "",
    `Target: ${BASE_URL} (production build, port ${PORT})`,
    "",
    `**${summary.passed} passed / ${summary.failed} failed** — ${summary.assertions.pass} assertions passed, ${summary.assertions.fail} failed.`,
    "",
    "| Flow | Outcome | Assertions | Evidence |",
    "| --- | --- | --- | --- |",
  ];
  for (const outcome of outcomes) {
    const pass = outcome.assertions.filter((a) => a.pass).length;
    const fail = outcome.assertions.filter((a) => !a.pass).length;
    lines.push(
      `| ${outcome.title} | ${outcome.status === "passed" ? "✅ passed" : "❌ failed"} | ${pass}/${pass + fail} | ${outcome.screenshots.join(", ") || "—"} |`,
    );
  }
  lines.push("");
  for (const outcome of outcomes) {
    lines.push(`## ${outcome.title}`, "");
    for (const assertion of outcome.assertions) {
      lines.push(
        `- ${assertion.pass ? "✅" : "❌"} **${assertion.name}** — ${assertion.evidence}`,
      );
    }
    for (const note of outcome.notes) lines.push(`- 📝 ${note}`);
    lines.push("");
  }
  writeFileSync(join(evidenceDir, "e2e-report.md"), `${lines.join("\n")}\n`);

  // The committed acceptance evidence is the latest run's report + shots.
  writeFileSync(join(EVIDENCE_ROOT, "e2e-report.md"), `${lines.join("\n")}\n`);
  writeFileSync(
    join(EVIDENCE_ROOT, "e2e-report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  for (const file of readdirSync(evidenceDir)) {
    if (file.endsWith(".png")) copyFileSync(join(evidenceDir, file), join(EVIDENCE_ROOT, file));
  }
}

// ---------------------------------------------------------------------- main

async function main(): Promise<number> {
  console.log(`[e2e] W909 browser E2E — evidence in ${evidenceDir}`);
  if (!skipBuild) await buildApp();

  const server = await startServer();
  const browser = new BrowserDriver("sporta-w909-e2e");
  const outcomes: FlowOutcome[] = [];
  let discovery: Discovery;
  try {
    discovery = await discoverSeededContent();
    console.log(
      `[e2e] seeded content: ${discovery.allSessionIds.length} sessions; primary=${discovery.primarySession.sessionId} (${discovery.primarySession.storedRenders.map((r) => r.rendererId).join(", ")})`,
    );

    const flows: readonly { id: E2EFlowId; run: (ctx: FlowContext) => Promise<void> }[] = [
      { id: "a11y-smoke", run: a11ySmokeFlow },
      { id: "sign-in", run: signInFlow },
      { id: "rights-denial", run: rightsDenialFlow },
      { id: "watch", run: watchFlow },
      { id: "reality-switch", run: realitySwitchFlow },
      { id: "output-playback", run: outputPlaybackFlow },
      { id: "render", run: renderFlow },
      { id: "role-switch", run: roleSwitchFlow },
    ];
    const order = onlyFlow !== undefined ? [onlyFlow] : recommendedFlowOrder();

    for (const id of order) {
      const spec = flowSpecOf(id);
      const flow = flows.find((entry) => entry.id === id)!;
      const recorder = new FlowRecorder(id, spec.title);
      console.log(`[e2e] flow ${id} — ${spec.title}`);
      const ctx: FlowContext = {
        baseUrl: BASE_URL,
        discovery,
        browser,
        recorder,
        evidenceDir,
        runId,
        demoPassword: DEMO_PASSWORD,
        api: (path, init) => fetch(`${BASE_URL}${path}`, init),
      };
      const startedAt = Date.now();
      try {
        await flow.run(ctx);
        outcomes.push(recorder.outcome());
        console.log(
          `[e2e]   ${recorder.outcome().status} (${recorder.assertions.length} assertions, ${Date.now() - startedAt}ms)`,
        );
      } catch (err) {
        const failure = err instanceof Error ? err.message : String(err);
        recorder.note(`FLOW ABORTED: ${failure}`);
        browser.screenshot(`${evidenceDir}/${id}-failure.png`);
        recorder.screenshots.push(`${id}-failure.png`);
        outcomes.push(recorder.outcome());
        console.error(`[e2e]   FAILED: ${failure}`);
      }
    }
  } finally {
    writeReport(outcomes);
    browser.close();
    await server.kill();
  }

  const summary = summarizeRun(outcomes);
  console.log(
    `[e2e] DONE: ${summary.passed} passed / ${summary.failed} failed — ${summary.assertions.pass}+/${summary.assertions.fail}- assertions. Report: ${join(evidenceDir, "e2e-report.md")}`,
  );
  return summary.exitCode;
}

process.exit(await main());
