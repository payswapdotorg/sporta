/**
 * `serveViewer` (W702 + W705) — hosts the viewer shell for a REAL browser
 * session: a `Bun.serve` on its own port that
 *
 * - serves the static shell (`web/index.html`) and the browser ES-module
 *   graph (`web/` + `src/`) with TypeScript transpiled ON THE FLY via
 *   `Bun.Transpiler` (no bundler, no new dependencies; the transpiled graph
 *   contains no bare `@sporta/*` imports — the browser-reachable modules
 *   use `import type` only, which the transpiler erases);
 * - proxies `/control/*` to the control API server SAME-ORIGIN (the W701
 *   server has no CORS by design; the proxy keeps the shell single-origin).
 *   This includes the REAL W504 playback routes
 *   `/control/v1/sessions/:id/renders/:renderId/outputs[/:segmentId]` —
 *   the browser bootstrap's playback provider talks through this proxy
 *   (W705);
 * - serves `GET /output/:sessionId/:renderId` — the W702 STAND-IN output
 *   route, kept for its own tests (the capture-store seam; the DEFAULT
 *   viewer path is the real playback provider since W705);
 * - serves the W706 TELEMETRY routes — `POST /telemetry` (one JSON event;
 *   validated through the closed event vocabulary, then recorded + flushed
 *   into the real JSONL file sink under the declared `telemetryPath`),
 *   `POST /telemetry/flush` (the explicit flush), and `GET /telemetry`
 *   (a dev-grade status document: path + line counters, NO event contents).
 *   The browser bootstrap wires `createHttpTelemetrySink` against this
 *   route (dev-grade, honestly labeled — see `./telemetry-http-sink.ts`).
 *   Default path: `<tmpdir>/sporta-viewer-telemetry/viewer-telemetry.jsonl`
 *   (outside the repo, appended across runs — dev-grade accumulation);
 *   `telemetryPath: null` disables the routes (typed 501 answers).
 *
 * By default the helper is SELF-CONTAINED on the REAL chain (W705): it
 * creates the control server itself with the REAL output pipeline wired in
 * (`renderOutputStore: pipeline`) and the REAL anime prototype renderer
 * registered through the ENCODING wrapper (`createEncodingRenderer` — every
 * successful render is encoded + stored through the pipeline host-side, so
 * the real playback routes answer immediately) composed with the W702
 * capturing wrapper (the stand-in route keeps working). Deterministic
 * clock. Pass `controlBaseUrl` to target an external control server instead
 * (then no pipeline/capture store is wired and the stand-in output route
 * answers `unsupported-output` honestly — 501; the REAL playback routes
 * still work through the proxy against the external server).
 *
 * Serve smoke only: tests verify boot + routes + the real data path; NO
 * real-browser execution is claimed (paint-level E2E remains OPEN — W706 as
 * scoped delivers viewer TELEMETRY, not browser automation; the headless
 * data path is `test/playback-e2e.test.ts`, the telemetry chain is
 * `test/telemetry-e2e.test.ts`).
 *
 * KNOWN LIMITATIONS (dev-grade, deliberate): the stand-in `/output` route
 * does NOT re-derive rights at read time (the W701 playback gate lives on
 * the control plane's `getRender`/`listRenders`, which the viewer core
 * always calls BEFORE `loadOutput`; documented). The REAL playback routes
 * ARE rights-gated fail-closed by the control plane. The on-the-fly
 * transpilation has no bundling, no minification, and no cache
 * invalidation — it exists so the shell runs with zero build tooling. The
 * proxy forwards only `content-type`/`x-request-id` (the shell needs no
 * more).
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve as resolvePath } from "node:path";
import { tmpdir } from "node:os";
import { createControlServer } from "@sporta/control-api";
import type { ControlServer } from "@sporta/control-api";
import { createAnimePrototypeRenderer } from "@sporta/renderer-anime";
import { RendererRegistry } from "@sporta/renderer-contract";
import { createAnimeOutputPipeline } from "@sporta/output-pipeline";
import type { AnimeOutputPipeline } from "@sporta/output-pipeline";
import { TEST_EPOCH_MS } from "@sporta/testing";
import { createEncodingRenderer } from "./encoding-renderer.ts";
import { createCapturingRenderer, createRenderOutputCaptureStore } from "./render-output-store.ts";
import type { RenderOutputCaptureStore } from "./render-output-store.ts";
import { createJsonlTelemetryFileSink } from "./telemetry-file-sink.ts";
import type { JsonlTelemetryFileSink } from "./telemetry-file-sink.ts";
import { parseTelemetryEvent } from "./telemetry-events.ts";

/** Options for {@link serveViewer}. */
export interface ServeViewerOptions {
  /** Viewer (shell) listen port. `0` (default) asks the OS for an ephemeral port. */
  port?: number;
  /**
   * Creates a self-hosted control server on this port (default `0` =
   * ephemeral). Ignored when `controlBaseUrl` is given.
   */
  controlPort?: number;
  /**
   * Target an EXTERNAL control server (e.g. `"http://127.0.0.1:3111"`)
   * instead of self-hosting one. No capture store is wired in that mode:
   * the output route answers `unsupported-output` (501) honestly.
   */
  controlBaseUrl?: string;
  /**
   * Clock for the self-hosted control app (default: deterministic
   * `TEST_EPOCH_MS + ticks` — production deployments MUST inject a wall
   * clock; see the W701 app docs).
   */
  nowMs?: () => number;
  /**
   * Declared path of the W706 telemetry JSONL file the `/telemetry` routes
   * write through the REAL file sink. `undefined` (default) = the dev-grade
   * default `<tmpdir>/sporta-viewer-telemetry/viewer-telemetry.jsonl`
   * (outside the repo; appended across runs — dev-grade accumulation).
   * `null` = telemetry routes DISABLED (typed 501 answers).
   */
  telemetryPath?: string | null;
}

/** The running viewer server (plus the self-hosted control server, if any). */
export interface ViewerServer {
  /** The bound viewer port (the shell URL is `http://127.0.0.1:<port>`). */
  port: number;
  /** The shell URL. */
  url: string;
  /** The self-hosted control server (null in external mode). */
  control: { server: ControlServer; port: number; url: string } | null;
  /** The capture store wired into the control registry (null in external mode). */
  captureStore: RenderOutputCaptureStore | null;
  /** The REAL output pipeline wired as the control plane's playback store (null in external mode). */
  pipeline: AnimeOutputPipeline | null;
  /** The REAL W706 telemetry file sink behind the `/telemetry` routes (null when disabled). */
  telemetry: JsonlTelemetryFileSink | null;
  /** Stops the viewer server (and the self-hosted control server). */
  stop(): void;
}

/** Package root: `import.meta.dir` is `<pkg>/src`, so one `dirname` up. */
const PACKAGE_ROOT = dirname(import.meta.dir);

/** Content types for the served static files. */
const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".ts": "text/javascript; charset=utf-8",
};

/** One entry of the on-the-fly module cache (path → transpiled body). */
interface ModuleEntry {
  body: string;
  contentType: string;
}

/** Deterministic default clock for the self-hosted control app. */
function createDeterministicClock(): () => number {
  let ticks = 0;
  return (): number => TEST_EPOCH_MS + (ticks += 1);
}

/** The dev-grade default telemetry path (outside the repo; see the options). */
const DEFAULT_TELEMETRY_PATH = join(tmpdir(), "sporta-viewer-telemetry", "viewer-telemetry.jsonl");

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function errorResponse(status: number, failureClass: string, message: string): Response {
  return jsonResponse(status, { error: { failureClass, message } });
}

/**
 * Serves the viewer shell. See the module docs for the composition, the
 * proxy, and the two output routes (real playback + stand-in).
 */
export function serveViewer(options: ServeViewerOptions = {}): ViewerServer {
  const nowMs = options.nowMs ?? createDeterministicClock();

  // --- control plane (self-hosted by default, REAL chain since W705) -----
  let controlServer: ControlServer | null = null;
  let controlBaseUrl: string;
  let captureStore: RenderOutputCaptureStore | null = null;
  let pipeline: AnimeOutputPipeline | null = null;
  if (options.controlBaseUrl !== undefined) {
    controlBaseUrl = options.controlBaseUrl.replace(/\/+$/, "");
  } else {
    // The REAL W504 chain: the output pipeline is the control plane's
    // playback store (the playback routes serve from it), and every
    // successful render is encoded + stored HOST-side by the encoding
    // wrapper (the dev host runs the W504 host step synchronously — the
    // production host may decouple it; the viewer's outputs-pending state
    // covers that honestly). The W702 capturing wrapper composes outside
    // so the stand-in route keeps its own data (its tests).
    captureStore = createRenderOutputCaptureStore();
    pipeline = createAnimeOutputPipeline();
    const registry = new RendererRegistry();
    registry.register(
      createCapturingRenderer(
        createEncodingRenderer(createAnimePrototypeRenderer(), { pipeline }),
        captureStore,
      ),
    );
    controlServer = createControlServer({
      port: options.controlPort ?? 0,
      rendererRegistry: registry,
      nowMs,
      renderOutputStore: pipeline,
    });
    const boundPort = controlServer.port ?? 0;
    controlBaseUrl = `http://127.0.0.1:${boundPort}`;
  }

  // --- W706 telemetry (the real JSONL file sink behind the routes) --------
  const telemetrySink =
    options.telemetryPath === null
      ? null
      : createJsonlTelemetryFileSink({ path: options.telemetryPath ?? DEFAULT_TELEMETRY_PATH });

  // --- static serving (with on-the-fly TS transpilation) ------------------
  const transpiler = new Bun.Transpiler({ loader: "ts" });
  const moduleCache = new Map<string, ModuleEntry>();

  /** Reads + (for .ts) transpiles one allowlisted file. Throws on violation. */
  function readStatic(urlPath: string): ModuleEntry {
    const clean = urlPath.split("?")[0] ?? urlPath;
    if (clean.includes("..")) throw new Error("path traversal rejected");
    const absolute = resolvePath(join(PACKAGE_ROOT, clean));
    if (!absolute.startsWith(PACKAGE_ROOT)) throw new Error("path outside the package rejected");
    const cached = moduleCache.get(absolute);
    if (cached !== undefined) return cached;
    const extension = clean.slice(clean.lastIndexOf("."));
    const contentType = CONTENT_TYPES[extension];
    if (contentType === undefined) throw new Error(`unsupported file type: ${extension}`);
    const source = readFileSync(absolute, "utf8");
    const body = extension === ".ts" ? transpiler.transformSync(source) : source;
    const entry: ModuleEntry = { body, contentType };
    moduleCache.set(absolute, entry);
    return entry;
  }

  /** Same-origin proxy to the control API (forwards method/body/ids). */
  async function proxyControl(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const suffix = url.pathname.replace(/^\/control/, "");
    const target = `${controlBaseUrl}${suffix}${url.search}`;
    const headers = new Headers();
    for (const name of ["content-type", "x-request-id"]) {
      const value = request.headers.get(name);
      if (value !== null) headers.set(name, value);
    }
    const hasBody = request.method !== "GET" && request.method !== "HEAD";
    const body = hasBody ? await request.arrayBuffer() : undefined;
    let upstream: Response;
    try {
      upstream = await fetch(target, {
        method: request.method,
        headers,
        ...(body !== undefined ? { body } : {}),
      });
    } catch (err) {
      return errorResponse(
        502,
        "internal",
        `control server unreachable: ${err instanceof Error ? err.message : "fetch failed"}`,
      );
    }
    const outHeaders = new Headers();
    for (const name of ["content-type", "x-request-id"]) {
      const value = upstream.headers.get(name);
      if (value !== null) outHeaders.set(name, value);
    }
    return new Response(await upstream.arrayBuffer(), {
      status: upstream.status,
      headers: outHeaders,
    });
  }

  /** The stand-in stored-output route (see the module docs). */
  function renderOutputRoute(segments: string[]): Response {
    if (captureStore === null) {
      return errorResponse(
        501,
        "unsupported-output",
        "this viewer server targets an external control server and has no render-output capture store; stored-output retrieval behind the control plane arrives with W504",
      );
    }
    // `segments` is the FULL path split (no empty parts): for
    // `/output/:sessionId/:renderId` that is ["output", sessionId, renderId].
    const sessionId = segments[1];
    const renderId = segments[2];
    if (sessionId === undefined || renderId === undefined || segments.length !== 3) {
      return errorResponse(404, "unknown-route", "expected /output/:sessionId/:renderId");
    }
    const record = captureStore.resolve(renderId);
    if (record === undefined || record.sessionId !== sessionId) {
      return errorResponse(
        404,
        "unsupported-output",
        `no captured render output for render '${renderId}' under session '${sessionId}' (stored-output retrieval behind the control plane arrives with W504)`,
      );
    }
    return jsonResponse(200, record.output);
  }

  /** The W706 telemetry routes (see the module docs; disabled answers 501). */
  async function telemetryRoute(request: Request, sub: string): Promise<Response> {
    if (telemetrySink === null) {
      return errorResponse(
        501,
        "unsupported-output",
        "telemetry is not configured on this viewer server (pass telemetryPath; null disables the routes)",
      );
    }
    if (request.method === "GET" && sub === "") {
      // Dev-grade introspection: counters + path only — never event contents.
      return jsonResponse(200, { enabled: true, ...telemetrySink.status() });
    }
    if (request.method === "POST" && sub === "flush") {
      const { linesWritten } = telemetrySink.flush();
      return jsonResponse(200, { flushed: linesWritten });
    }
    if (request.method === "POST" && sub === "") {
      let parsed: unknown;
      try {
        parsed = await request.json();
      } catch {
        return errorResponse(400, "validation", "telemetry request body was not valid JSON");
      }
      const event = parseTelemetryEvent(parsed);
      if (!event.ok) {
        // The closed vocabulary is the privacy boundary: out-of-schema
        // events (unknown fields, wrong types) are refused, never stored.
        return errorResponse(400, "validation", `telemetry event rejected: ${event.reason}`);
      }
      try {
        telemetrySink.record(event.event);
      } catch (err) {
        return errorResponse(
          400,
          "validation",
          `telemetry event rejected: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      // Dev-grade immediate durability: each accepted event lands on disk
      // with its own flush (explicit; no timers).
      const { linesWritten } = telemetrySink.flush();
      return jsonResponse(200, { accepted: true, flushed: linesWritten });
    }
    return errorResponse(
      405,
      "method-not-allowed",
      `no /telemetry route for ${request.method} and sub-path '${sub}' (the routes are GET /telemetry, POST /telemetry, POST /telemetry/flush)`,
    );
  }

  const viewerServer = Bun.serve({
    port: options.port ?? 0,
    fetch: (request: Request): Response | Promise<Response> => {
      const url = new URL(request.url);
      const segments = url.pathname.split("/").filter((part) => part.length > 0);
      const first = segments[0];

      // Static shell + module graph.
      if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
        try {
          const entry = readStatic("/web/index.html");
          return new Response(entry.body, {
            headers: { "content-type": entry.contentType },
          });
        } catch {
          return errorResponse(404, "unknown-route", "viewer shell index not found");
        }
      }
      if (
        request.method === "GET" &&
        (first === "web" || first === "src") &&
        segments.length >= 2
      ) {
        try {
          const entry = readStatic(url.pathname);
          return new Response(entry.body, {
            headers: { "content-type": entry.contentType },
          });
        } catch (err) {
          return errorResponse(
            404,
            "unknown-route",
            `no viewer asset for ${url.pathname} (${err instanceof Error ? err.message : "unreadable"})`,
          );
        }
      }

      // Control proxy (any method).
      if (first === "control") {
        return proxyControl(request);
      }

      // W706 telemetry routes (the viewer server's own — not proxied).
      if (first === "telemetry") {
        const sub = segments.slice(1).join("/");
        return telemetryRoute(request, sub);
      }

      // Stand-in stored-output route.
      if (first === "output") {
        if (request.method !== "GET") {
          return errorResponse(405, "method-not-allowed", "use GET for the output route");
        }
        return renderOutputRoute(segments);
      }

      return errorResponse(404, "unknown-route", `no route for ${request.method} ${url.pathname}`);
    },
  });

  const viewerPort = viewerServer.port ?? 0;
  return {
    port: viewerPort,
    url: `http://127.0.0.1:${viewerPort}`,
    control:
      controlServer === null
        ? null
        : { server: controlServer, port: controlServer.port ?? 0, url: controlBaseUrl },
    captureStore,
    pipeline,
    telemetry: telemetrySink,
    stop(): void {
      viewerServer.stop(true);
      controlServer?.stop(true);
      // W706: closing the telemetry sink flushes any still-buffered lines
      // (programmatic `server.telemetry.record()` users — the ROUTES always
      // flushed per event) and seals it. Idempotent, never throws.
      telemetrySink?.close();
    },
  };
}
