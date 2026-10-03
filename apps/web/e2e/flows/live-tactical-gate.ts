/**
 * Flow live-tactical-gate (L015) — the LIVE TACTICAL GATE: a real browser
 * through the product's own live surfaces, with every acceptance line of
 * the work item measured and recorded:
 *
 * - real browser (the W909 driver's headless Chrome; a real rendered
 *   canvas is asserted, not assumed);
 * - state updates arrive continuously (the probe's measured receipt
 *   cadence vs the transport's own declared cadence);
 * - tactical view visibly follows meaningful state changes (DOM world
 *   versions advance with the frames; entity position deltas beyond a
 *   threshold) and does NOT change during a no-update window (the honest
 *   "(connecting)" state while a newly-selected source has delivered
 *   nothing);
 * - declared percentile latency budget is measured (nearest-rank p50/p95
 *   over the measured server-generation → browser-receipt samples — the
 *   formula replicated exactly from `@sporta/latency-benchmark`); asserted
 *   against the DECLARED budget — and the repo declares NONE for the live
 *   path (SLOs.md scopes the W306 batch/frame pipeline; DEPLOYMENT.md
 *   records measured evidence "never a promise"), so that line is
 *   recorded `declared budget: ABSENT` and FAILS honestly, never a pass
 *   invented);
 * - identity continuity is bounded/measured (the pure audit: 0 unexplained
 *   switches, the entityRef set stable after the first frame);
 * - dropout/reconnect behavior is visible and recovers (the L002 reconnect
 *   session's gap accounting — counted missed updates, degraded quality
 *   shown, then recovery to nominal — and the drop session's visible
 *   sequence gaps);
 * - no hidden fixture session or developer API (the session under test is
 *   the transport's own listing's session, discovered over the product's
 *   real /api/live surface and driven through the /live page's own picker;
 *   the only writes the flow performs are through the real register form).
 */
import { LIVE_LATENCY_BUDGET_MS } from "@/lib/live-latency";
import type { FlowContext } from "../lib/harness";
import { ensureSignedOut, liveSourcesOf, registerLiveViewer } from "./live-shared";
import {
  installLiveProbe,
  openLiveWithProbe,
  pickEntity,
  readInspectorFacts,
  readLiveProbe,
  readTacticalFacts,
  requireScenarioSource,
  selectLiveSource,
  tacticalCanvasLabel,
  waitForLivePhase,
} from "../lib/live-gates";
import {
  auditIdentityContinuity,
  cadenceVerdict,
  determinismFingerprint,
  findRecoveryAccounting,
  interArrivalIntervals,
  medianWithinTolerance,
  measuredLatencyStats,
  positionDeltaStats,
  sourceSequenceGaps,
} from "../lib/live-instrument";
import type { CapturedWorldFrame } from "../lib/live-instrument";

/** How many frames the continuous-updates window must capture (>= 8s at the default 500 ms cadence). */
const NORMAL_WINDOW_MIN_FRAMES = 16;
/** The cadence-matching tolerance (a loaded host's real scheduler jitter; stated in the evidence line). */
const CADENCE_TOLERANCE = 0.45;
/** The position-delta threshold for a MEANINGFUL state change (meters, canonical pitch). */
const MEANINGFUL_DELTA_M = 0.5;

export async function liveTacticalGateFlow(ctx: FlowContext): Promise<void> {
  const { recorder, browser, baseUrl } = ctx;
  const { assert, check } = recorder;

  // ------------------------------------------------ 0. the product surfaces
  // The gate CANNOT run on a fixture: everything under test comes from the
  // transport's own listing (the same API the /live page consumes).
  const sources = await liveSourcesOf(ctx);
  const normal = requireScenarioSource(sources, "normal");
  const reconnect = requireScenarioSource(sources, "reconnect");
  const drop = requireScenarioSource(sources, "drop");
  assert(
    "the live transport really serves the L002 scenario sessions (no fixture: the transport's own listing)",
    sources.length >= 8,
    `listing: ${sources.length} sources (kind=${sources.map((s) => s.sourceKind).join("/")}); normal="${normal.label}"; reconnect="${reconnect.label}"; drop="${drop.label}"`,
  );
  assert(
    "the source is honestly labeled the L002 deterministic synthetic tracking source",
    (normal.sourceNote ?? "").includes("L002 deterministic synthetic tracking source"),
    `sourceNote="${normal.sourceNote ?? "(absent)"}"`,
  );

  // A real signed-in browser through the real register form (the stream
  // route is fail-closed on identity — the real user's journey).
  await ensureSignedOut(browser);
  await registerLiveViewer(ctx, "l015");

  // ------------------------------------------- 1. real browser + live state
  const probe = await openLiveWithProbe(browser, baseUrl, NORMAL_WINDOW_MIN_FRAMES);
  const normalFrames = probe.frames.filter((f) => f.sessionId === normal.sessionId);
  assert(
    "the live tactical surface is LIVE in the real browser with a rendered canvas",
    (await waitForLivePhase(browser, "live", 5_000)) &&
      browser.count(".live-tactical-canvas") === 1,
    `data-live-phase=live; canvas count=1; label="${tacticalCanvasLabel(browser).slice(0, 80)}"`,
  );
  assert(
    "the probe observed the real stream (the page's own EventSource traffic, no dev API)",
    probe.opens >= 1 && normalFrames.length >= NORMAL_WINDOW_MIN_FRAMES,
    `probe opens=${probe.opens}; captured world frames=${probe.frames.length} (${normalFrames.length} on the normal session)`,
  );
  assert(
    "the session under test IS the transport's listed normal session (no hidden session)",
    normalFrames.every((f) => f.sessionId === normal.sessionId),
    `captured sessionIds={${[...new Set(probe.frames.map((f) => f.sessionId))].join(", ")}}; under test=${normal.sessionId}`,
  );
  const hello = probe.hello;
  const declaredCadenceMs = hello?.cadenceMs ?? 500;
  recorder.note(
    `hello: sessionId=${hello?.sessionId ?? "?"} sourceKind=${hello?.sourceKind ?? "?"} cadenceMs=${declaredCadenceMs} (the transport's own declaration)`,
  );

  // -------------------------------- 2. state updates arrive continuously
  const intervals = interArrivalIntervals(normalFrames.map((f) => f.receivedAtMs));
  const cadence = cadenceVerdict(intervals);
  assert(
    "state updates arrive continuously (measured receipt cadence matches the declared cadence)",
    medianWithinTolerance(cadence.medianIntervalMs, declaredCadenceMs, CADENCE_TOLERANCE) &&
      normalFrames.length >= NORMAL_WINDOW_MIN_FRAMES,
    `n=${cadence.samples} intervals; median=${cadence.medianIntervalMs}ms (min ${cadence.minIntervalMs}, max ${cadence.maxIntervalMs}) vs declared ${declaredCadenceMs}ms; tolerance ±${Math.round(CADENCE_TOLERANCE * 100)}%; frames=${normalFrames.length}`,
  );
  const facts = readTacticalFacts(browser);
  recorder.note(
    `the surface's own update-rate fact: "${facts["Update rate"] ?? "—"}"; frames fact: "${facts["Frames"] ?? "—"}"`,
  );

  // ------------------- 3. tactical view visibly follows state changes
  // The DOM's rendered world version advances with the frames (polled,
  // never assumed), and the captured frames carry MEANINGFUL position
  // changes (ball + player deltas beyond the threshold). The probe is
  // re-read AFTER each DOM label (a frame the DOM rendered was received
  // before it rendered, so the fresh captured latest bounds the DOM — the
  // view can never show a version the stream did not deliver).
  const domLabels: string[] = [];
  let freshLatest = normalFrames[normalFrames.length - 1]!.worldVersion;
  for (let poll = 0; poll < 6; poll += 1) {
    domLabels.push(tacticalCanvasLabel(browser));
    const current = readLiveProbe(browser);
    const currentNormal = current.frames.filter((f) => f.sessionId === normal.sessionId);
    if (currentNormal.length > 0) {
      freshLatest = Math.max(freshLatest, currentNormal[currentNormal.length - 1]!.worldVersion);
    }
    await Bun.sleep(600);
  }
  const domVersions = domLabels
    .map((label) => Number.parseInt(label.match(/world version (\d+)/)?.[1] ?? "0", 10))
    .filter((value) => value > 0);
  const snapshotLatest = normalFrames[normalFrames.length - 1]!.worldVersion;
  assert(
    "the rendered tactical state visibly follows state changes (DOM world versions advance with the frames)",
    domVersions.length >= 3 &&
      new Set(domVersions).size >= 3 &&
      domVersions[domVersions.length - 1]! >= snapshotLatest - 3 &&
      Math.max(...domVersions) <= freshLatest,
    `polled DOM world versions=[${domVersions.join(", ")}]; captured at window start=v${snapshotLatest}, at polls=v${freshLatest}; distinct=${new Set(domVersions).size}`,
  );
  const ballDeltas = positionDeltaStats(normalFrames, "ball-1");
  // The L002 source's zero-padded entity ids (p-home-01 …; match-script.ts).
  const playerDeltas = positionDeltaStats(normalFrames, "p-home-01");
  assert(
    "meaningful state changes arrive (ball and player move beyond the threshold between frames)",
    ballDeltas !== null &&
      ballDeltas.maxDeltaMeters > MEANINGFUL_DELTA_M &&
      playerDeltas !== null &&
      playerDeltas.meanDeltaMeters > 0,
    `ball: max=${ballDeltas?.maxDeltaMeters.toFixed(2)}m mean=${ballDeltas?.meanDeltaMeters.toFixed(3)}m (n=${ballDeltas?.samples}); player p-home-01: max=${playerDeltas?.maxDeltaMeters.toFixed(2)}m mean=${playerDeltas?.meanDeltaMeters.toFixed(3)}m`,
  );

  // ------------------------------- 4. the declared percentile latency budget
  // Measured: server generation clock → this browser's receipt clock (both
  // real clocks on the same host; the product's own honest measurement
  // chain). Percentiles: NEAREST-RANK, replicated exactly from
  // packages/latency-benchmark/src/percentiles.ts (W306).
  const latencySamples = normalFrames.map((f) => f.receivedAtMs - f.generatedAtMs);
  const latency = measuredLatencyStats(latencySamples);
  const productLatency = facts["p50 / p95 / max"] ?? "—";
  recorder.note(
    `measured e2e latency (generation→receipt): n=${latency.count} p50=${latency.p50Ms}ms p95=${latency.p95Ms}ms max=${latency.maxMs}ms min=${latency.minMs}ms; the surface's own displayed window: "${productLatency}"`,
  );
  assert(
    "the latency measurement produced a real percentile window (never an absent metric claimed as met)",
    latency.count >= NORMAL_WINDOW_MIN_FRAMES && latency.p95Ms >= latency.p50Ms,
    `nearest-rank p50=${latency.p50Ms}ms, p95=${latency.p95Ms}ms over ${latency.count} measured samples`,
  );
  // THE DECLARED BUDGET (L015 amendment, 2026-10-03): the TL decision —
  // the live-path latency percentile budget for the local-transport
  // deployment is now DECLARED in the product's own latency module
  // (LIVE_LATENCY_BUDGET_MS: p50 ≤ 250ms, p95 ≤ 1000ms, nearest-rank, the
  // generation→receipt domain). The measured percentiles are asserted
  // against it. (Soft check so the flow continues measuring every other
  // acceptance line; the flight-3 record of the pre-amendment state —
  // "declared budget: ABSENT, FAIL honestly" — lives in the flight's
  // REPORT and the worklog.)
  check(
    "the measured percentiles are asserted against the declared budget",
    latency.p50Ms <= LIVE_LATENCY_BUDGET_MS.p50 && latency.p95Ms <= LIVE_LATENCY_BUDGET_MS.p95,
    `declared budget (LIVE_LATENCY_BUDGET_MS): p50 ≤ ${LIVE_LATENCY_BUDGET_MS.p50}ms, p95 ≤ ${LIVE_LATENCY_BUDGET_MS.p95}ms. Measured: p50=${latency.p50Ms}ms p95=${latency.p95Ms}ms (n=${latency.count}) — ${latency.p50Ms <= LIVE_LATENCY_BUDGET_MS.p50 && latency.p95Ms <= LIVE_LATENCY_BUDGET_MS.p95 ? "WITHIN the declared budget" : "OVER the declared budget (the honest failure)"}.`,
  );

  // ------------------------------------------- 5. identity continuity bound
  const identity = auditIdentityContinuity(normalFrames);
  const explainedAppearances = identity.lateAppearances.filter((appearance) =>
    normalFrames[appearance.frameIndex]!.frameEvents.some(
      (event) => event.type === "entity-appeared",
    ),
  );
  assert(
    "identity continuity is bounded (no unexplained re-identification across the window)",
    identity.switches.length === 0 &&
      identity.lateAppearances.length === explainedAppearances.length,
    `${identity.entitiesTracked} entities over ${identity.framesAudited} frames; 0 identity switches; late appearances=${identity.lateAppearances.length} (all with explicit entity-appeared events)`,
  );

  // --------------------------------------- 6. dropout/reconnect: visible + recovery
  // The L002 reconnect session: ONE contiguous dropout window, then a
  // reconnect with explicit gap accounting (counted missed updates, never
  // smoothed) and a degraded-quality recovery window that returns to
  // nominal. Selected through the PRODUCT's own picker.
  const reconnectSelected = selectLiveSource(browser, "reconnect");
  assert(
    "the reconnect-scenario session is selectable through the product's own live picker",
    reconnectSelected === "selected",
    `picker answer="${reconnectSelected}"`,
  );
  // Wait for the stream's own recovery event (the deterministic scenario
  // runs it ~40 ticks in — up to ~25 s at the 500 ms cadence).
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
    "the dropout/reconnect scenario ran its gap (the stream's own recovery accounting arrived)",
    recovery !== null && reconnectFrames.length > 8,
    `reconnect frames captured=${reconnectFrames.length}; recovery event: missedUpdates=${recovery?.missedUpdates ?? "?"}, gapDurationMs=${recovery?.gapDurationMs ?? "?"} (frame #${recovery?.frameIndex ?? "?"} of the captured window)`,
  );
  // The DEGRADED state is captured (the frame's own quality field + the
  // transition events) and VISIBLE (the honest event ticker keeps the
  // recovery row; the quality chip shows degraded during the window).
  // After the recovery event the degraded window (3 frames at the 500 ms
  // cadence) must run out — poll for the NOMINAL resumption before
  // asserting it (bounded, never assumed).
  const nominalDeadline = Date.now() + 12_000;
  let nominalAfter = false;
  const qualityFactTrajectory: string[] = [];
  while (Date.now() < nominalDeadline) {
    qualityFactTrajectory.push(readTacticalFacts(browser)["Quality"] ?? "(absent)");
    const current = readLiveProbe(browser);
    reconnectFrames = current.frames.filter((f) => f.sessionId === reconnect.sessionId);
    if (recovery !== null) {
      const after = reconnectFrames.slice(recovery.frameIndex + 1);
      nominalAfter = after.length > 0 && after.some((f) => f.quality === "nominal");
      if (nominalAfter) break;
    }
    await Bun.sleep(600);
  }
  const qualityStates = new Set(reconnectFrames.map((f) => f.quality));
  const degradedVisible = qualityStates.has("degraded");
  assert(
    "the interruption is EXPLICIT in the stream's own data (degraded quality carried, then recovered to nominal)",
    degradedVisible && nominalAfter,
    `captured quality states={${[...qualityStates].join(",")}}; quality-degraded/quality-nominal transition events=${reconnectFrames.filter((f) => f.frameEvents.some((e) => e.type === "quality-degraded" || e.type === "quality-nominal")).length} frames; nominal resumption after the recovery=${nominalAfter ? "observed" : "NOT observed"}`,
  );
  // The visible DOM accounting: the honest event ticker keeps the recovery
  // row (bounded depth 8) — poll for it (the transient recovery badge
  // itself rides ONE frame; the ticker is the persistent surface).
  const tickerDeadline = Date.now() + 6_000;
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
    "the dropout is VISIBLE in the product surface (the honest event ticker shows the accounted gap)",
    tickerRow.length > 0,
    `ticker row="${tickerRow}"`,
  );
  check(
    "the degraded quality state was visible in the surface's own quality fact during the recovery window",
    qualityFactTrajectory.includes("degraded"),
    `quality-fact trajectory during the recovery window=[${qualityFactTrajectory.join(" → ")}] (the degraded window is 3 frames; the authoritative captured-state assert above carries this line if the poll cadence missed the transient chip)`,
  );
  assert(
    "the stream RECovers and continues (world versions advance past the recovery frame)",
    recovery !== null &&
      reconnectFrames[reconnectFrames.length - 1]!.worldVersion >
        reconnectFrames[recovery.frameIndex]!.worldVersion,
    `world version at recovery=v${reconnectFrames[recovery?.frameIndex ?? 0]?.worldVersion}; latest captured=v${reconnectFrames[reconnectFrames.length - 1]?.worldVersion}; frames after recovery=${recovery !== null ? reconnectFrames.length - recovery.frameIndex - 1 : 0}`,
  );

  // ------------------------------------- 7. the drop scenario: counted gaps
  // The no-update negative control — the PRE-FIRST-FRAME window, made
  // honestly observable by a PROBE-VERIFIED page load: the probe patch is
  // installed and VERIFIED to wrap the page's own EventSource BEFORE the
  // live surface mounts (opens >= 1 with frames still 0), so "no frames
  // captured" means "no frames DELIVERED" (never "the observer missed the
  // connection"). Every sample in that verified window must show the
  // honest connecting presentation — the "(connecting)" canvas label and
  // the "awaiting the first world frame…" note — never a fabricated world
  // version. (The L002 scenarios' own gaps are all sub-tolerance by design
  // — 600ms delay onset / 800ms reconnect / 1000ms frame-level vs the
  // 1250ms watchdog tolerance — they model bounded delivery anomalies,
  // not outages; the receipt-stall watchdog's firing window is therefore
  // unit-proven (liveStaleness battery tests) rather than e2e-forced.)
  browser.open(`${baseUrl}/live`);
  installLiveProbe(browser);
  for (let reloadAttempt = 0; reloadAttempt < 3; reloadAttempt += 1) {
    const probeState = readLiveProbe(browser);
    if (probeState.opens >= 1) break; // the patch landed before the mount
    browser.reload();
    installLiveProbe(browser);
  }
  interface NoUpdateSample {
    phase: string;
    staleness: string;
    label: string;
    note: string;
    probeOpens: number;
    probeFrames: number;
  }
  const readNoUpdateSample = (): NoUpdateSample =>
    browser.eval<NoUpdateSample>(
      `(function(){
  var el = document.querySelector(".player-surface[data-surface='live-tactical']");
  var phase = el === null ? '(absent)' : (el.getAttribute('data-live-phase') || '');
  var staleness = el === null ? '(absent)' : (el.getAttribute('data-staleness') || '');
  var canvas = document.querySelector('.live-tactical-canvas');
  var label = canvas === null ? '(no canvas)' : (canvas.getAttribute('aria-label') || '');
  var noteEl = document.querySelector("[data-surface='stall-verdict']");
  var note = noteEl === null ? '(absent)' : noteEl.textContent.trim();
  var probe = window.__e2eLiveProbe;
  return { phase: String(phase), staleness: String(staleness), label: String(label).slice(0, 90), note: String(note).slice(0, 90), probeOpens: probe === undefined ? -1 : probe.opens, probeFrames: probe === undefined ? -1 : probe.frames.length };
})()`,
    );
  const noUpdateSamples: NoUpdateSample[] = [];
  // Sample CONTINUOUSLY (each CLI eval ~50ms) until the first frame lands.
  const noUpdateDeadline = Date.now() + 15_000;
  while (Date.now() < noUpdateDeadline) {
    noUpdateSamples.push(readNoUpdateSample());
    if (noUpdateSamples[noUpdateSamples.length - 1]!.probeFrames > 0) break;
  }
  const verified = noUpdateSamples.length > 0 && noUpdateSamples[0]!.probeOpens >= 1;
  const preFrameSamples = noUpdateSamples.filter((sample) => sample.probeFrames === 0);
  const connectingSamples = preFrameSamples.filter((sample) =>
    sample.label.includes("(connecting)"),
  );
  const fabricated = preFrameSamples.filter((sample) => /world version \d+/.test(sample.label));
  assert(
    "the view does NOT change during a no-update window (the honest connecting state, never a fabricated one)",
    verified &&
      preFrameSamples.length > 0 &&
      connectingSamples.length === preFrameSamples.length &&
      fabricated.length === 0 &&
      preFrameSamples.some((sample) => sample.note.includes("awaiting the first world frame")),
    `probe-verified pre-first-frame window: ${preFrameSamples.length} samples (probe opens=${noUpdateSamples[0]?.probeOpens}, first frame at sample #${noUpdateSamples.findIndex((s) => s.probeFrames > 0)}); all connecting=${connectingSamples.length}/${preFrameSamples.length}; fabricated-version samples=${fabricated.length}; phases=${[...new Set(preFrameSamples.map((s) => s.phase))].join("→")}; staleness=${[...new Set(preFrameSamples.map((s) => s.staleness))].join("→")}`,
  );
  recorder.note(
    "the no-update negative control observed the verified pre-first-frame window (the probe wraps the page's own EventSource before the surface mounts — zero captured frames means zero delivered frames); the receipt-stall watchdog (2.5×cadence tolerance) is unit-proven in the root battery, and the L002 scenarios' own gaps (600ms/800ms/1000ms) are all sub-tolerance by design — they model bounded delivery anomalies, not outages",
  );
  // Now the drop stream runs (selected through the product's own picker):
  // the per-tick drops are VISIBLE SEQUENCE GAPS in the frames' own
  // sourceSequence accounting (counted, never smoothed).
  const dropSelected = selectLiveSource(browser, "scattered drops");
  assert(
    "the drop-scenario session is selectable through the product's own live picker",
    dropSelected === "selected",
    `picker answer="${dropSelected}"`,
  );
  const dropDeadline = Date.now() + 20_000;
  let dropFrames: CapturedWorldFrame[] = [];
  while (Date.now() < dropDeadline) {
    const current = readLiveProbe(browser);
    dropFrames = current.frames.filter((f) => f.sessionId === drop.sessionId);
    if (dropFrames.length >= 14) break;
    await Bun.sleep(600);
  }
  const gaps = sourceSequenceGaps(dropFrames);
  assert(
    "the drop scenario's losses are counted sequence gaps (never smoothed over)",
    dropFrames.length >= 12 && gaps.length >= 1,
    `drop frames captured=${dropFrames.length}; source-sequence gaps=${gaps.length} (first: ${gaps[0] ? `${gaps[0].gap} tick(s) after frame #${gaps[0].afterFrameIndex}` : "none"}); dropRate default 0.15`,
  );
  recorder.note(
    `the drop scenario's browser-visible accounting: the picker's own description labels it ("${browser.eval<string>(
      `(function(){ var labels = Array.prototype.slice.call(document.querySelectorAll("input[name='live-source']")).map(function (i) { return i.closest('label').textContent; }); var hit = labels.find(function (t) { return t.indexOf('scattered drops') !== -1; }); return hit === undefined ? '(not found)' : hit.trim().slice(0, 160); })()`,
    )}"); the sequence-gap counts ride the captured frames (the surface's ordinal-drop counter is the transport-loss lane, a different seam)`,
  );

  // ---------------------------------------------- 8. the pinned identity follow
  // (continuity made inspectable through the product's own inspector: pin
  // the ball; its identity stays while its position updates.)
  const pinned = pickEntity(browser, "ball-1");
  assert(
    "the entity inspector pins the ball through the product's own picker",
    pinned === "pinned",
    `pick answer="${pinned}"`,
  );
  await Bun.sleep(400);
  const inspectFirst = readInspectorFacts(browser);
  await Bun.sleep(1_800);
  const inspectSecond = readInspectorFacts(browser);
  assert(
    "the pinned entity keeps its identity while its state updates (the inspector follows the ref, not a position)",
    (inspectFirst["Pinned entity"] ?? "").includes("ball-1") &&
      (inspectSecond["Pinned entity"] ?? "").includes("ball-1") &&
      (inspectFirst["Position (canonical m)"] ?? "") !==
        (inspectSecond["Position (canonical m)"] ?? ""),
    `pinned="${inspectFirst["Pinned entity"] ?? "?"}"; position ${inspectFirst["Position (canonical m)"] ?? "?"} → ${inspectSecond["Position (canonical m)"] ?? "?"}; detection=${inspectSecond["Detection"] ?? "?"}`,
  );

  // ------------------------------------------------------ evidence artifacts
  browser.screenshot(`${ctx.evidenceDir}/live-tactical-gate-normal.png`);
  recorder.screenshots.push("live-tactical-gate-normal.png");
  selectLiveSource(browser, "reconnect");
  await Bun.sleep(1_200);
  browser.screenshot(`${ctx.evidenceDir}/live-tactical-gate-reconnect.png`);
  recorder.screenshots.push("live-tactical-gate-reconnect.png");

  // The cross-run determinism fingerprint (§5 of the worker brief): the
  // seeded source must produce the IDENTICAL observation/version sequence
  // in every harness run — recorded for the REPORT's run-to-run comparison.
  recorder.note(
    `determinism fingerprint (normal session, first 16 captured frames): ${determinismFingerprint(normalFrames.slice(0, 16))}`,
  );
}
