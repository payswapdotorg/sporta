/**
 * THE LAZY SERVER RUNTIME (W904) — the build-safe seam for route handlers.
 *
 * The composition root's module graph reaches `@sporta/control-api` →
 * `@sporta/session` and `@sporta/output-pipeline`, both of which import
 * `bun:sqlite` at module scope (they are Bun-native packages). Next.js
 * evaluates route modules at BUILD time ("collect page data") in a Node
 * worker where `bun:sqlite` cannot resolve — so the composition may only be
 * loaded when a REQUEST actually arrives (always under the Bun server).
 * Route handlers therefore import THIS module statically and receive the
 * singleton lazily; `composition.ts` remains the single source of truth.
 */
import type { SportaServer } from "./composition";

/** The singleton getter (route handlers' only entry into the server). */
export function getSportaServer(): Promise<SportaServer> {
  return import("./composition").then((mod) => mod.getSportaServer());
}
