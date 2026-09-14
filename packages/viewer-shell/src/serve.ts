/**
 * `serveViewer` (W702) — hosts the viewer shell for a REAL browser session:
 * a `Bun.serve` on its own port that
 *
 * - serves the static shell (`web/index.html`) and the browser ES-module
 *   graph (`web/` + `src/`) with TypeScript transpiled ON THE FLY via
 *   `Bun.Transpiler` (no bundler, no new dependencies; the transpiled graph
 *   contains no bare `@sporta/*` imports — the browser-reachable modules
 *   use `import type` only, which the transpiler erases);
 * - proxies `/control/*` to the control API server SAME-ORIGIN (the W701
 *   server has no CORS by design; the proxy keeps the shell single-origin);
 * - serves `GET /output/:sessionId/:renderId` — the W504-pending stand-in
 *   for stored-output retrieval, backed by the
 *   {@link RenderOutputCaptureStore} (see `./render-output-store.ts`).
 *
 * By default the helper is SELF-CONTAINED: it creates the control server
 * itself (registry pre-registered with the anime prototype renderer wrapped
 * in the capturing adapter, deterministic clock) on an ephemeral port. Pass
 * `controlBaseUrl` to target an external control server instead (then no
 * capture store is wired and the output route answers `unsupported-output`
 * honestly — 501).
 *
 * Serve smoke only: tests verify boot + routes + the real data path; NO
 * real-browser execution is claimed (that arrives with W705/W706).
 *
 * KNOWN LIMITATIONS (dev-grade, deliberate): the output route does NOT
 * re-derive rights at read time (the W701 playback gate lives on the control
 * plane's `getRender`/`listRenders`, which the viewer core always calls
 * BEFORE `loadOutput`; the shell's `unsupported-output` seam and the real
 * rights-checked stored-output API are W504/W705 territory). The on-the-fly
 * transpilation has no bundling, no minification, and no cache
 * invalidation — it exists so the shell runs with zero build tooling. The
 * proxy forwards only `content-type`/`x-request-id` (the shell needs no
 * more).
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve as resolvePath } from "node:path";
import { createControlServer } from "@sporta/control-api";
import type { ControlServer } from "@sporta/control-api";
import { createAnimePrototypeRenderer } from "@sporta/renderer-anime";
import { RendererRegistry } from "@sporta/renderer-contract";
import { TEST_EPOCH_MS } from "@sporta/testing";
import { createCapturingRenderer, createRenderOutputCaptureStore } from "./render-output-store.ts";
import type { RenderOutputCaptureStore } from "./render-output-store.ts";

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
 * proxy, and the W504-pending output route.
 */
export function serveViewer(options: ServeViewerOptions = {}): ViewerServer {
  const nowMs = options.nowMs ?? createDeterministicClock();

  // --- control plane (self-hosted by default) -----------------------------
  let controlServer: ControlServer | null = null;
  let controlBaseUrl: string;
  let captureStore: RenderOutputCaptureStore | null = null;
  if (options.controlBaseUrl !== undefined) {
    controlBaseUrl = options.controlBaseUrl.replace(/\/+$/, "");
  } else {
    captureStore = createRenderOutputCaptureStore();
    const registry = new RendererRegistry();
    registry.register(createCapturingRenderer(createAnimePrototypeRenderer(), captureStore));
    controlServer = createControlServer({
      port: options.controlPort ?? 0,
      rendererRegistry: registry,
      nowMs,
    });
    const boundPort = controlServer.port ?? 0;
    controlBaseUrl = `http://127.0.0.1:${boundPort}`;
  }

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
    stop(): void {
      viewerServer.stop(true);
      controlServer?.stop(true);
    },
  };
}
