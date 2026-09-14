/**
 * The viewer-shell default clock (W702).
 *
 * The deterministic default time source for {@link createViewerCore} when no
 * `nowMs` is injected: a per-core `EPOCH + ticks` counter, so unseeded runs
 * are reproducible (docs/testing/HARNESS.md). Production/browser callers
 * MUST inject a real clock (the bootstrap injects `performance.now()`).
 *
 * Why this module exists (and why the constant is LOCAL rather than imported
 * from `@sporta/testing`): `viewer-core.ts` is part of the browser ES-module
 * graph served by `serveViewer` (see `./serve.ts`), and that graph must
 * contain ZERO bare `@sporta/*` specifiers — only `import type` (erased by
 * the on-the-fly transpiler) and relative module imports. A value import of
 * `TEST_EPOCH_MS` would ship a bare specifier the browser cannot resolve.
 * The constant therefore mirrors `@sporta/testing`'s `TEST_EPOCH_MS` locally;
 * a test pins the two equal so the mirror can never drift.
 */

/**
 * The default epoch — the same instant as `@sporta/testing`'s `TEST_EPOCH_MS`
 * (`Date.parse("2025-01-06T12:00:00.000Z")`). Pinned equal by test.
 */
export const VIEWER_DEFAULT_EPOCH_MS = 1_736_164_800_000;

/** Deterministic default clock: `VIEWER_DEFAULT_EPOCH_MS + ticks`. */
export function createViewerDefaultClock(): () => number {
  let ticks = 0;
  return (): number => VIEWER_DEFAULT_EPOCH_MS + (ticks += 1);
}
