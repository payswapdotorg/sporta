/**
 * @sporta/renderer-contract — the runtime renderer plugin contract (W501).
 *
 * Everything a host needs to run renderers as plugins behind the stable
 * interface of `docs/contracts/renderer.md` (architecture-lock §5: renderer
 * dependencies live behind the adapter/package boundary; the core domain
 * never imports renderer-specific frameworks):
 *
 * - `types`: `RenderInput`, `RequestValidation`, `MaybePromise`,
 *   `RendererContext` (structural observability seam)
 * - `errors`: `RendererContractError` — contract violations with a terminal
 *   failure class and structured details
 * - `plugin`: `RendererPlugin` — THE interface, with the enforced contract
 *   rules R1–R8 documented in the module docblock
 * - `registry`: `RendererRegistry` — versioned, immutable plugin registry
 *   with numeric-aware version resolution (`0.10.0 > 0.2.0`)
 * - `conformance`: `runConformance` — the fail-soft harness that proves any
 *   plugin honors the contract (13 stable checks)
 * - `reference/test-card`: `createTestCardRenderer` — the deterministic
 *   reference renderer proving the interface is implementable against
 *   `@sporta/contracts` types only (no SWM-core modification, no
 *   graphics/ML frameworks — those arrive with W502+)
 */
export type {
  MaybePromise,
  Metrics,
  RenderInput,
  RequestAcceptance,
  RequestRejection,
  RequestValidation,
  RendererContext,
} from "./types";
export { RendererContractError } from "./errors";
export type { RendererPlugin } from "./plugin";
export { RendererRegistry, compareRendererVersions } from "./registry";
export { runConformance } from "./conformance";
export type { ConformanceCheck, ConformanceOptions, ConformanceReport } from "./conformance";
export { TESTCARD_OUTPUT_PROFILE, createTestCardRenderer } from "./reference/test-card";
export type { TestCardRenderer } from "./reference/test-card";
