/**
 * Flow live-journey (L016) — the LIVE TRACKING → SWM → TACTICAL JOURNEY,
 * walking the work item's exact sequence through the product's own
 * surfaces, every step asserted with evidence:
 *
 *   fresh browser → enter live match → see live tactical state →
 *   inspect player/ball state → tolerate update interruption → recover →
 *   continue → end live window → open replay.
 *
 * The interruption leg is the L002 RECONNECT scenario session (a
 * deterministic dropout window with explicit gap accounting) selected
 * through the product's own live picker; the "end live window" leg is the
 * L014 FINITE live-window session (it ends honestly with
 * `live-window-complete`, and the SAME views continue into the replay of
 * the recorded session state).
 */
import type { FlowContext } from "../lib/harness";
import { ensureSignedOut, liveSourcesOf, registerLiveViewer } from "./live-shared";
import {
  openLiveWithProbe,
  pickEntity,
  readInspectorFacts,
  readLiveProbe,
  readTacticalFacts,
  requireFiniteSource,
  requireScenarioSource,
  selectLiveSource,
  tacticalCanvasLabel,
  waitForLivePhase,
} from "../lib/live-gates";
import { determinismFingerprint, findRecoveryAccounting } from "../lib/live-instrument";
import type { CapturedWorldFrame } from "../lib/live-instrument";

export async function liveJourneyFlow(ctx: FlowContext): Promise<void> {
  const { recorder, browser, baseUrl } = ctx;
  const { assert } = recorder;

  const sources = await liveSourcesOf(ctx);
  const reconnect = requireScenarioSource(sources, "reconnect");
  const finite = requireFiniteSource(sources);

  // -------------------------------------------- fresh browser → the live entry
  // A FRESH state: signed out (the role-switch flow may have left the demo
  // account in the browser), landed on the home page, then the product's
  // own Live nav entry.
  await ensureSignedOut(browser);
  browser.open(`${baseUrl}/`);
  assert(
    "the journey starts from a fresh (anonymous) browser on the home page",
    (await browser.waitForSelector("main#main-content", 15_000)) &&
      browser.count(".account-button") === 0,
    `title="${browser.title()}"; account chip absent (anonymous)`,
  );
  const navClicked = browser.eval<string>(
    `(function(){ var links = Array.prototype.slice.call(document.querySelectorAll("nav a[href='/live']"));
  if (links.length === 0) return 'no-live-link';
  links[0].click();
  return 'clicked'; })()`,
  );
  assert(
    "the Live entry is reachable through the product's own primary navigation",
    navClicked === "clicked" && (await browser.waitForUrl("/live", 10_000)),
    `nav click="${navClicked}"; url=${browser.url()}`,
  );

  // --------------------------------- enter live match (the honest anonymous gate)
  // The transport lists the live sources to an anonymous visitor, but the
  // STREAM itself is fail-closed on identity — the real 401 path, never an
  // anonymous live picture.
  assert(
    "the live page lists the real sources (the transport's own listing)",
    (await browser.waitForSelector("[data-surface='live-source-picker']", 15_000)) &&
      browser.count("input[name='live-source']") >= 5,
    `picker options=${browser.count("input[name='live-source']")}`,
  );
  const anonymousRefused = await waitForLivePhase(browser, "failed", 30_000);
  assert(
    "an anonymous browser is honestly REFUSED the live stream (fail-closed, never a silent anonymous live picture)",
    anonymousRefused,
    `data-live-phase=${browser.eval<string>(
      `(function(){ var el = document.querySelector(".player-surface[data-surface='live-tactical']"); return el === null ? '(absent)' : el.getAttribute('data-live-phase'); })()`,
    )}; the real 401 path (auth-required) surfaced as the view's own failure state`,
  );

  // The real user's answer: a real account through the real register form.
  await registerLiveViewer(ctx, "l016");
  browser.open(`${baseUrl}/live`);

  // ---------------------------------------- see live tactical state (signed in)
  const probe = await openLiveWithProbe(browser, baseUrl, 8);
  const normal = requireScenarioSource(sources, "normal");
  const normalFrames = probe.frames.filter((f) => f.sessionId === normal.sessionId);
  assert(
    "entering the live match shows LIVE tactical state (frames really arriving)",
    (await waitForLivePhase(browser, "live", 5_000)) && normalFrames.length >= 8,
    `data-live-phase=live; captured frames=${normalFrames.length}; canvas label="${tacticalCanvasLabel(browser).slice(0, 90)}"`,
  );
  browser.screenshot(`${ctx.evidenceDir}/live-journey-live-state.png`);
  recorder.screenshots.push("live-journey-live-state.png");

  // -------------------------------------- inspect a player AND the ball state
  const options = browser.eval<string[]>(
    `(function(){ var s = document.getElementById('live-entity-picker'); return s === null ? [] : Array.prototype.slice.call(s.options).map(function (o) { return o.value; }); })()`,
  );
  const playerRef = options.find((value) => /^p-(home|away)-\d+$/.test(value)) ?? "";
  assert(
    "the entity inspector offers the live entities (players and the ball)",
    playerRef.length > 0 && options.includes("ball-1"),
    `picker options=${options.length} (player example=${playerRef || "none"}, ball=ball-1)`,
  );
  const playerPinned = pickEntity(browser, playerRef);
  await Bun.sleep(500);
  const playerFirst = readInspectorFacts(browser);
  await Bun.sleep(1_600);
  const playerSecond = readInspectorFacts(browser);
  assert(
    "inspecting a PLAYER shows its identity + live state, updating while pinned",
    playerPinned === "pinned" &&
      (playerFirst["Pinned entity"] ?? "").includes(playerRef) &&
      (playerFirst["Pinned entity"] ?? "").includes("PLAYER") &&
      (playerFirst["Position (canonical m)"] ?? "") !==
        (playerSecond["Position (canonical m)"] ?? ""),
    `pinned="${playerFirst["Pinned entity"] ?? "?"}"; position ${playerFirst["Position (canonical m)"] ?? "?"} → ${playerSecond["Position (canonical m)"] ?? "?"}; confidence=${playerSecond["Confidence"] ?? "?"}`,
  );
  const ballPinned = pickEntity(browser, "ball-1");
  await Bun.sleep(500);
  const ballFirst = readInspectorFacts(browser);
  await Bun.sleep(1_600);
  const ballSecond = readInspectorFacts(browser);
  assert(
    "inspecting the BALL shows its identity + live state, updating while pinned",
    ballPinned === "pinned" &&
      (ballFirst["Pinned entity"] ?? "").includes("ball-1") &&
      (ballFirst["Pinned entity"] ?? "").includes("BALL") &&
      (ballFirst["Position (canonical m)"] ?? "") !== (ballSecond["Position (canonical m)"] ?? ""),
    `pinned="${ballFirst["Pinned entity"] ?? "?"}"; position ${ballFirst["Position (canonical m)"] ?? "?"} → ${ballSecond["Position (canonical m)"] ?? "?"}; detection=${ballSecond["Detection"] ?? "?"}`,
  );
  browser.screenshot(`${ctx.evidenceDir}/live-journey-inspect-ball.png`);
  recorder.screenshots.push("live-journey-inspect-ball.png");

  // ------------------------ tolerate the interruption → recover → continue
  // The L002 reconnect scenario (selected through the product's own
  // picker): a real dropout window in the stream's delivery, surfaced
  // explicitly (the gap is accounted, never smoothed over), then recovery.
  const switched = selectLiveSource(browser, "reconnect");
  assert(
    "the interruption source (the L002 reconnect scenario) is selected through the product's picker",
    switched === "selected",
    `picker answer="${switched}"`,
  );
  let reconnectFrames: CapturedWorldFrame[] = [];
  let recovery = null as ReturnType<typeof findRecoveryAccounting>;
  const recoveryDeadline = Date.now() + 45_000;
  while (Date.now() < recoveryDeadline) {
    const current = readLiveProbe(browser);
    reconnectFrames = current.frames.filter((f) => f.sessionId === reconnect.sessionId);
    recovery = findRecoveryAccounting(reconnectFrames);
    if (recovery !== null) break;
    await Bun.sleep(700);
  }
  assert(
    "the interruption is EXPLICIT (the stream's own gap accounting, counted — never silent)",
    recovery !== null && reconnectFrames.length > 8,
    `recovery event: missedUpdates=${recovery?.missedUpdates ?? "?"}, gapDurationMs=${recovery?.gapDurationMs ?? "?"}; captured frames=${reconnectFrames.length}`,
  );
  const tickerDeadline = Date.now() + 8_000;
  let tickerRow = "";
  while (Date.now() < tickerDeadline) {
    const rows = browser.eval<string[]>(
      `(function(){ return Array.prototype.slice.call(document.querySelectorAll('.live-event-list .live-event-phrase')).map(function (el) { return el.textContent.trim(); }); })()`,
    );
    const found = rows.find((row) => row.includes("source reconnect") && row.includes("accounted"));
    if (found !== undefined) {
      tickerRow = found;
      break;
    }
    await Bun.sleep(500);
  }
  assert(
    "the interrupted state is VISIBLE to the user (the honest event ticker carries the accounted gap)",
    tickerRow.length > 0,
    `ticker row="${tickerRow}"`,
  );
  browser.screenshot(`${ctx.evidenceDir}/live-journey-interruption.png`);
  recorder.screenshots.push("live-journey-interruption.png");

  // Recovery + continuation: the world keeps advancing past the recovery
  // frame (updates continue after the interruption).
  const continueDeadline = Date.now() + 15_000;
  const versionAtRecovery =
    recovery !== null ? reconnectFrames[recovery.frameIndex]!.worldVersion : 0;
  let latestVersion = reconnectFrames[reconnectFrames.length - 1]?.worldVersion ?? 0;
  while (Date.now() < continueDeadline && latestVersion <= versionAtRecovery + 2) {
    await Bun.sleep(800);
    const current = readLiveProbe(browser);
    reconnectFrames = current.frames.filter((f) => f.sessionId === reconnect.sessionId);
    latestVersion = reconnectFrames[reconnectFrames.length - 1]?.worldVersion ?? 0;
  }
  assert(
    "the journey CONTINUES after the recovery (updates keep arriving past the interruption)",
    latestVersion > versionAtRecovery + 2,
    `world version at recovery=v${versionAtRecovery}; latest=v${latestVersion} (${reconnectFrames.length} frames captured)`,
  );

  // -------------------------------------- end the live window → open the replay
  // The finite live-window session: the scripted window runs ONCE, ends
  // honestly (`live-window-complete`), and the SAME surface continues into
  // the REPLAY of the recorded session state.
  const finiteSwitched = selectLiveSource(browser, "finite window");
  assert(
    "the finite live-window session is selected through the product's picker",
    finiteSwitched === "selected",
    `picker answer="${finiteSwitched}"; label="${finite.label}"`,
  );
  assert(
    "the finite live window streams live state first (the window is live before it ends)",
    await waitForLivePhase(browser, "live", 15_000),
    `data-live-phase=${browser.eval<string>(
      `(function(){ var el = document.querySelector(".player-surface[data-surface='live-tactical']"); return el === null ? '(absent)' : el.getAttribute('data-live-phase'); })()`,
    )}`,
  );
  const replayReady = await waitForLivePhase(browser, "replay", 40_000);
  assert(
    "the live window ENDS honestly and the SAME surface opens the replay of the recorded session",
    replayReady && (await browser.waitForSelector("[data-surface='live-replay-controls']", 10_000)),
    `data-live-phase=replay; replay controls present; legend="${browser
      .text("[data-surface='live-replay-controls'] legend")
      .slice(0, 120)}"`,
  );
  const replayFacts = readTacticalFacts(browser);
  assert(
    "the replay carries the recorded session state through the SAME views (world versions + frame accounting visible)",
    (replayFacts["World version"] ?? "").includes("recorded") &&
      (replayFacts["Frames"] ?? "").includes("recorded"),
    `world version fact="${replayFacts["World version"] ?? "—"}"; frames fact="${replayFacts["Frames"] ?? "—"}"`,
  );
  // Step the replay: the recorded frames re-render (the world version
  // advances within the recorded span — a replay the user controls).
  const stepButtons = browser.clickWhere(
    ".live-replay-buttons button",
    `this.textContent.indexOf('step forward') !== -1`,
  );
  const stepped =
    stepButtons === 1 &&
    (await browser.waitForJs(
      `(function(){ var el = document.querySelector("[data-surface='live-replay-controls'] .live-replay-scrub span"); return el !== null && el.textContent.indexOf('frame 2 /') !== -1; })()`,
      4_000,
    ));
  assert(
    "the opened replay is user-drivable (a step advances the recorded frame)",
    stepped,
    `scrub label="${browser.eval<string>(
      `(function(){ var el = document.querySelector("[data-surface='live-replay-controls'] .live-replay-scrub span"); return el === null ? '(absent)' : el.textContent.trim(); })()`,
    )}"`,
  );
  browser.screenshot(`${ctx.evidenceDir}/live-journey-replay.png`);
  recorder.screenshots.push("live-journey-replay.png");
  recorder.note(
    `determinism fingerprint (the journey's normal-session window, first 8 captured frames): ${determinismFingerprint(probe.frames.filter((f) => f.sessionId === normal.sessionId).slice(0, 8))}`,
  );
}
