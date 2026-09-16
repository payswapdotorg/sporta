/**
 * SERVER BOOTSTRAP ENTRY (Next.js file convention).
 *
 * `register()` runs ONCE per server process before route modules are
 * evaluated — on BOTH the Node and Edge runtimes (Next calls it wherever it
 * boots). The Bun-compatibility shim is Node-only (it installs `node:crypto`
 * -backed globals), so it lives in `./instrumentation-node` and is loaded
 * and RUN only when `NEXT_RUNTIME === "nodejs"` (every route of this app
 * declares the Node runtime; the Edge build must never import `node:crypto`).
 */
export async function register(): Promise<void> {
  if (process.env["NEXT_RUNTIME"] === "nodejs") {
    const instrumentationNode = await import("./instrumentation-node");
    await instrumentationNode.register();
  }
}
