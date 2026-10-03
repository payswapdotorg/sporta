/**
 * Flow live-to-replay (L017) — the LIVE-TO-REPLAY RECOVERY GATE: the same
 * match/session identity, world versions and timebase must survive the
 * live-to-replay transition, and a reload must not create a second
 * canonical state or lose already persisted replayable state.
 *
 * Executed legs (every one through the product's own surfaces):
 *
 * 1. the finite live window is watched LIVE to its honest end (the
 *    captured frames carry the window's own world versions/timecodes);
 * 2. the SAME surface continues into the REPLAY of the recorded session —
 *    the continuity facts (version span, event-time span, final
 *    watermark, frame accounting) must match the live window's own last
 *    state (no reset, no re-stamping);
 * 3. the page is RELOADED and the replay re-opened — the record must be
 *    the SAME single record (identical facts, no second live window, no
 *    second canonical version), and the replayable state must be intact
 *    (the durable sqlite replay store wrote the window).
 *
 * The REDEPLOY leg (a process restart) is honestly bounded: the durable
 * replay store + the recovery decorator exist and are root-battery-tested
 * (test/l014-platform-persistence.test.ts), but this harness's server is
 * owned by the runner for the whole run — a mid-run restart is runner
 * surgery beyond this flow's scope, and the local composition's control
 * plane is instance-local (the honest W921 boundary the e2e README
 * documents). Recorded in the gate REPORT as DELIVERED-UNEXECUTED.
 */
import { statSync } from "node:fs";
import { join } from "node:path";
import type { FlowContext } from "../lib/harness";
import type { BrowserDriver } from "../lib/browser-driver";
import { ensureSignedOut, liveSourcesOf, registerLiveViewer } from "./live-shared";
import {
  installLiveProbe,
  readLiveProbe,
  readTacticalFacts,
  requireFiniteSource,
  selectLiveSource,
  waitForLivePhase,
} from "../lib/live-gates";
import type { CapturedWorldFrame } from "../lib/live-instrument";

/** The replay continuity facts the surface renders (parsed from the DOM). */
interface ReplayFacts {
  phase: string;
  frameCount: number;
  worldVersionFirst: number;
  worldVersionLast: number;
  eventTimeFirstMs: number;
  eventTimeLastMs: number;
  watermarkFinalSequence: number;
  verdict: string;
}

/** Reads the replay presentation's own visible continuity facts. */
function readReplayFacts(browser: BrowserDriver): ReplayFacts {
  // The replay panel's OWN facts (the fieldset is a sibling of the
  // player-surface — the tactical-surface fact reader does not reach it).
  const facts: Record<string, string> = browser.eval<Record<string, string>>(
    `(function(){
  var out = {};
  var panel = document.querySelector("[data-surface='live-replay-controls']");
  if (panel === null) return out;
  var facts = panel.querySelectorAll('.session-card-facts .fact');
  for (var i = 0; i < facts.length; i += 1) {
    var dt = facts[i].querySelector('dt');
    var dd = facts[i].querySelector('dd');
    if (dt !== null && dd !== null) out[dt.textContent.trim()] = dd.textContent.trim();
  }
  return out; })()`,
  );
  const versions = facts["World versions"] ?? "";
  const span = facts["Event-time span"] ?? "";
  const legend = browser.count("[data-surface='live-replay-controls'] legend")
    ? browser.text("[data-surface='live-replay-controls'] legend")
    : "";
  const frameCount = Number.parseInt(legend.match(/(\d+) world frames/)?.[1] ?? "0", 10);
  const versionMatch = versions.match(/(\d+) → (\d+)/);
  const spanMatch = span.match(/([\d.]+)s → ([\d.]+)s · final watermark (\d+)/);
  return {
    phase: browser.eval<string>(
      `(function(){ var el = document.querySelector(".player-surface[data-surface='live-tactical']"); return el === null ? '(absent)' : el.getAttribute('data-live-phase'); })()`,
    ),
    frameCount,
    worldVersionFirst: Number.parseInt(versionMatch?.[1] ?? "0", 10),
    worldVersionLast: Number.parseInt(versionMatch?.[2] ?? "0", 10),
    eventTimeFirstMs: Math.round(Number.parseFloat(spanMatch?.[1] ?? "0") * 1000),
    eventTimeLastMs: Math.round(Number.parseFloat(spanMatch?.[2] ?? "0") * 1000),
    watermarkFinalSequence: Number.parseInt(spanMatch?.[3] ?? "0", 10),
    verdict: browser.count("[data-surface='live-replay-controls'] .fact dd")
      ? browser.eval<string>(
          `(function(){ var chips = document.querySelectorAll("[data-surface='live-replay-controls'] .fact dd"); for (var i = 0; i < chips.length; i += 1) { if (chips[i].textContent.indexOf('aligned') !== -1 || chips[i].textContent.indexOf('MISALIGNED') !== -1) return chips[i].textContent.trim(); } return '(no verdict chip)'; })()`,
        )
      : "(no verdict chip)",
  };
}

export async function liveToReplayFlow(ctx: FlowContext): Promise<void> {
  const { recorder, browser, baseUrl } = ctx;
  const { assert } = recorder;

  const sources = await liveSourcesOf(ctx);
  const finite = requireFiniteSource(sources);

  await ensureSignedOut(browser);
  await registerLiveViewer(ctx, "l017");

  // ------------------------------- 1. watch the finite live window to its end
  browser.open(`${baseUrl}/live`);
  installLiveProbe(browser);
  const selected = selectLiveSource(browser, "finite window");
  assert(
    "the finite live-window session is selected through the product's own picker",
    selected === "selected",
    `picker answer="${selected}"; label="${finite.label}"; note="${finite.sourceNote ?? ""}"`,
  );
  assert(
    "the finite session streams LIVE before its window ends",
    (await waitForLivePhase(browser, "live", 25_000)) &&
      (await browser.waitForSelector(".live-tactical-canvas", 10_000)),
    `data-live-phase=live; label="${browser.attr(".live-tactical-canvas", "aria-label").slice(0, 90)}"`,
  );
  let liveFrames: CapturedWorldFrame[] = [];
  const windowDeadline = Date.now() + 60_000;
  let phaseNow = "live";
  while (Date.now() < windowDeadline) {
    liveFrames = readLiveProbe(browser).frames.filter((f) => f.sessionId === finite.sessionId);
    phaseNow = browser.eval<string>(
      `(function(){ var el = document.querySelector(".player-surface[data-surface='live-tactical']"); return el === null ? '(absent)' : el.getAttribute('data-live-phase'); })()`,
    );
    if (phaseNow === "replay" || phaseNow === "closed") break;
    await Bun.sleep(800);
  }
  assert(
    "the live window ran to its honest end (frames captured, then the window completed)",
    liveFrames.length >= 20 && (phaseNow === "replay" || phaseNow === "closed"),
    `captured live frames=${liveFrames.length}; last live worldVersion=v${liveFrames[liveFrames.length - 1]?.worldVersion ?? "?"} @ eventTime ${liveFrames[liveFrames.length - 1]?.eventTimeMs ?? "?"}ms; phase at end=${phaseNow}`,
  );
  const lastLiveFrame = liveFrames[liveFrames.length - 1]!;
  browser.screenshot(`${ctx.evidenceDir}/live-to-replay-window-end.png`);
  recorder.screenshots.push("live-to-replay-window-end.png");

  // ---------------------------- 2. the transition: the SAME views, verbatim
  assert(
    "the completed window continues into the REPLAY presentation through the SAME surface",
    (await waitForLivePhase(browser, "replay", 20_000)) &&
      (await browser.waitForSelector("[data-surface='live-replay-controls']", 10_000)),
    `data-live-phase=replay; replay controls present`,
  );
  const replay = readReplayFacts(browser);
  const selectedLabel = browser.eval<string>(
    `(function(){ var checked = document.querySelector("input[name='live-source']:checked"); return checked === null ? '(none)' : (checked.closest('label').textContent.match(/Synthetic live tracking — [^·]+/) || ['(unparsed)'])[0]; })()`,
  );
  assert(
    "the replay carries the SAME session identity (the finite-window session stays selected — one session, not a second one)",
    selectedLabel.includes("finite window"),
    `selected source label="${selectedLabel.trim()}"; session=${finite.sessionId}`,
  );
  assert(
    "the world version lineage SURVIVES the transition (no reset: the replay's last version is the live window's own last)",
    replay.worldVersionLast === lastLiveFrame.worldVersion &&
      replay.worldVersionFirst === liveFrames[0]!.worldVersion,
    `replay world versions ${replay.worldVersionFirst} → ${replay.worldVersionLast}; the live window's own first/last = ${liveFrames[0]!.worldVersion}/${lastLiveFrame.worldVersion}`,
  );
  assert(
    "the timebase SURVIVES the transition (the replay's event-time span matches the live window's own timecodes)",
    replay.eventTimeLastMs === lastLiveFrame.eventTimeMs &&
      replay.eventTimeFirstMs === liveFrames[0]!.eventTimeMs,
    `replay event-time span ${replay.eventTimeFirstMs}ms → ${replay.eventTimeLastMs}ms; the live window's own first/last = ${liveFrames[0]!.eventTimeMs}/${lastLiveFrame.eventTimeMs}ms`,
  );
  assert(
    "the replayed frame count is the live window's own delivered count (no lost frames, no extra fabricated ones)",
    replay.frameCount === liveFrames.length,
    `replay frames=${replay.frameCount}; live frames captured=${liveFrames.length}`,
  );
  assert(
    "the continuity verdict is the product's own ALIGNED verdict (versions/timecodes advance monotonically)",
    replay.verdict.includes("aligned"),
    `verdict chip="${replay.verdict}"`,
  );
  const watermarkFact = readTacticalFacts(browser)["Event time / watermark"] ?? "";
  recorder.note(
    `transition facts: frames=${replay.frameCount}, versions ${replay.worldVersionFirst}→${replay.worldVersionLast}, eventTime ${replay.eventTimeFirstMs}→${replay.eventTimeLastMs}ms, final watermark seq=${replay.watermarkFinalSequence}; surface watermark fact="${watermarkFact.slice(0, 70)}"`,
  );

  // ------------------------------------ 3. the RELOAD: one record, no second state
  browser.reload();
  installLiveProbe(browser);
  assert(
    "the page reloads and the live surface re-renders",
    await browser.waitForSelector("[data-surface='live-source-picker']", 25_000),
    `picker options=${browser.count("input[name='live-source']")}`,
  );
  // Re-open the replay of the SAME session through the product's picker.
  const reselected = selectLiveSource(browser, "finite window");
  assert(
    "the same session's replay is re-opened through the product's picker after the reload",
    reselected === "selected" && (await waitForLivePhase(browser, "replay", 25_000)),
    `picker answer="${reselected}"; data-live-phase=${browser.eval<string>(
      `(function(){ var el = document.querySelector(".player-surface[data-surface='live-tactical']"); return el === null ? '(absent)' : el.getAttribute('data-live-phase'); })()`,
    )}`,
  );
  const afterReload = readReplayFacts(browser);
  assert(
    "the reload does NOT create a second canonical state (the SAME single record: identical continuity facts)",
    afterReload.frameCount === replay.frameCount &&
      afterReload.worldVersionFirst === replay.worldVersionFirst &&
      afterReload.worldVersionLast === replay.worldVersionLast &&
      afterReload.eventTimeFirstMs === replay.eventTimeFirstMs &&
      afterReload.eventTimeLastMs === replay.eventTimeLastMs &&
      afterReload.watermarkFinalSequence === replay.watermarkFinalSequence,
    `after reload: frames=${afterReload.frameCount}, versions ${afterReload.worldVersionFirst}→${afterReload.worldVersionLast}, eventTime ${afterReload.eventTimeFirstMs}→${afterReload.eventTimeLastMs}ms, watermark seq=${afterReload.watermarkFinalSequence} (before reload: frames=${replay.frameCount}, versions ${replay.worldVersionFirst}→${replay.worldVersionLast}, eventTime ${replay.eventTimeFirstMs}→${replay.eventTimeLastMs}ms)`,
  );
  assert(
    "the reload did NOT re-open a second live window (the presentation is the replay of the recorded state, never a re-run)",
    afterReload.phase === "replay",
    `data-live-phase=${afterReload.phase} (a re-opened live window would show 'live')`,
  );
  // No new world frames for the finite session after the reload: the
  // stream is terminal (the honest live-window-complete posture) — the
  // replay presentation is the continuation, not a second canonical feed.
  await Bun.sleep(2_500);
  const postReloadFrames = readLiveProbe(browser).frames.filter(
    (f) => f.sessionId === finite.sessionId,
  );
  assert(
    "no second live stream opened for the completed window (0 new world frames after the reload)",
    postReloadFrames.length === 0,
    `new world frames for the finite session after reload=${postReloadFrames.length} (the replay mode keeps the stream dormant — the window is over)`,
  );
  assert(
    "the persisted replayable state is intact after the reload (the record still serves its frames through the same views)",
    afterReload.frameCount >= 20 && afterReload.verdict.includes("aligned"),
    `frames=${afterReload.frameCount}; verdict="${afterReload.verdict}"`,
  );

  // The durable replay store's own file (supporting evidence, a NOTE not an
  // assert — the product-surface assertions above are the gate): the
  // composition's sqlite store under the real Bun runtime. The harness
  // process runs from apps/web (the e2e script's cwd), and the server was
  // spawned with the same cwd — `db/live-replay.db` resolves there.
  try {
    const dbPath = join(process.cwd(), "db/live-replay.db");
    const stats = statSync(dbPath);
    recorder.note(
      `the durable replay store's file exists after the completed window: ${dbPath} (${stats.size} bytes, mtime ${new Date(stats.mtimeMs).toISOString()}) — the platform-side L014 seam wrote the window`,
    );
  } catch {
    recorder.note(
      "the durable replay store's file was not found from the harness cwd (a NOTE — the surface-level persistence assertions above are the gate's evidence)",
    );
  }

  // ------------------------------- 4. the replayed state is still drivable
  const scrubLabel = browser.eval<string>(
    `(function(){ var el = document.querySelector("[data-surface='live-replay-controls'] .live-replay-scrub span"); return el === null ? '(absent)' : el.textContent.trim(); })()`,
  );
  const stepped = browser.clickWhere(
    ".live-replay-buttons button",
    `this.textContent.indexOf('step forward') !== -1`,
  );
  const steppedLabel = browser.eval<string>(
    `(function(){ var el = document.querySelector("[data-surface='live-replay-controls'] .live-replay-scrub span"); return el === null ? '(absent)' : el.textContent.trim(); })()`,
  );
  assert(
    "the re-opened replay is live-drivable (one step advances within the recorded span)",
    stepped === 1 && scrubLabel !== steppedLabel && steppedLabel.includes("frame 2 /"),
    `scrub label "${scrubLabel}" → "${steppedLabel}" (recorded frames=${afterReload.frameCount})`,
  );
  browser.screenshot(`${ctx.evidenceDir}/live-to-replay-after-reload.png`);
  recorder.screenshots.push("live-to-replay-after-reload.png");
}
