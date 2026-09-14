/**
 * Default-clock tests (W702): the LOCAL epoch mirror cannot drift from
 * `@sporta/testing`'s `TEST_EPOCH_MS` (the mirror exists so the browser
 * module graph stays free of bare `@sporta/*` specifiers), the default clock
 * is deterministic, and `createViewerCore` without an injected `nowMs`
 * actually uses it.
 */
import { describe, expect, test } from "bun:test";
import { TEST_EPOCH_MS } from "@sporta/testing";
import { VIEWER_DEFAULT_EPOCH_MS, createViewerDefaultClock } from "../src/default-clock.ts";
import { createViewerCore } from "../src/viewer-core.ts";
import { res, rej, scriptClient, scriptOutput, sessionSummary, viewerFailure } from "./helpers.ts";

describe("default clock — the local epoch mirror", () => {
  test("VIEWER_DEFAULT_EPOCH_MS equals @sporta/testing TEST_EPOCH_MS (no drift)", () => {
    expect(VIEWER_DEFAULT_EPOCH_MS).toBe(TEST_EPOCH_MS);
  });

  test("createViewerDefaultClock ticks deterministically: epoch + 1, +2, +3", () => {
    const clock = createViewerDefaultClock();
    expect(clock()).toBe(TEST_EPOCH_MS + 1);
    expect(clock()).toBe(TEST_EPOCH_MS + 2);
    expect(clock()).toBe(TEST_EPOCH_MS + 3);
  });

  test("two clocks tick independently but identically (per-instance state)", () => {
    const a = createViewerDefaultClock();
    const b = createViewerDefaultClock();
    a();
    a();
    expect(b()).toBe(TEST_EPOCH_MS + 1);
    expect(a()).toBe(TEST_EPOCH_MS + 3);
  });
});

describe("createViewerCore without nowMs — the deterministic default is used", () => {
  test("connect stamps connectedAtMs from the default clock (epoch + 1)", async () => {
    const client = scriptClient({ listSessions: [res({ sessions: [sessionSummary("sess-1")] })] });
    const output = scriptOutput({ loadOutput: [] });
    const core = createViewerCore({ client, output });
    core.dispatch({ type: "connect" });
    await settle();
    const view = core.view();
    expect(view.status).toBe("browsing-sessions");
    expect(view.connectedAtMs).toBe(TEST_EPOCH_MS + 1);
  });

  test("a default-clock run is reproducible (deep-equal views across two cores)", async () => {
    async function run(): Promise<string> {
      const client = scriptClient({
        listSessions: [
          res({ sessions: [sessionSummary("sess-1")] }),
          rej(viewerFailure("network", "unreachable")),
        ],
      });
      const core = createViewerCore({ client, output: scriptOutput({ loadOutput: [] }) });
      core.dispatch({ type: "connect" });
      await settle();
      core.dispatch({ type: "refreshSessions" });
      await settle();
      return JSON.stringify(core.view());
    }
    expect(await run()).toEqual(await run());
  });
});

/** Flushes the microtask queue (scripted promises resolve immediately). */
async function settle(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}
