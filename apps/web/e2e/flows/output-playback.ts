/**
 * Flow output-playback (W909) — the REAL output document loads and its
 * frames render:
 *
 * - the playback-gate URL (the same one the player consumes) answers 200
 *   JSON with the real segment document + the artifact-source header —
 *   fetched FROM THE BROWSER PAGE (the cookie'd, CORS-identical path);
 * - the player steps through the artifact's own frames (an event-marker
 *   jump snaps the playhead to the nearest real frame) and the transport
 *   actually plays (the toggle flips to Pause).
 */
import type { FlowContext } from "../lib/harness";

export async function outputPlaybackFlow(ctx: FlowContext): Promise<void> {
  const { recorder, browser, baseUrl, discovery } = ctx;
  const { assert } = recorder;
  const session = discovery.primarySession;
  const render = session.storedRenders[0]!;
  const segmentId = render.segmentIds[0]!;
  const outputUrl = `${baseUrl}/api/watch/${session.sessionId}/renders/${render.renderId}/outputs/${segmentId}`;

  // The watch page is still open on this session (reality-switch flow) —
  // wait for its READY stage: the marker buttons and the transport below
  // exist only once the artifact loaded (the loading surface has neither).
  assert(
    "the watch page is open for the playback checks",
    (await browser.waitForSelector(".player-stage[role='img']", 20_000)) !== false,
    "selector .player-stage[role='img']",
  );

  // ------------------- the real output document, fetched by the BROWSER
  const doc = await browser.eval<{
    ok: boolean;
    status: number;
    contentType: string;
    artifactSource: string;
    frameCount: number;
    firstFrameIndex: number | null;
    bodyIsJson: boolean;
  }>(`(async function () {
    const response = await fetch(${JSON.stringify(outputUrl)}, { headers: { accept: 'application/json' } });
    const text = await response.text();
    let body = null;
    try { body = JSON.parse(text); } catch (e) { body = null; }
    return {
      ok: response.ok,
      status: response.status,
      contentType: response.headers.get('content-type') || '',
      artifactSource: response.headers.get('x-sporta-artifact-source') || '',
      frameCount: body && body.manifest ? body.manifest.frameCount : 0,
      firstFrameIndex: body && body.manifest && body.manifest.frames && body.manifest.frames[0] ? body.manifest.frames[0].frameIndex : null,
      bodyIsJson: body !== null,
    };
  })()`);
  recorder.note(
    `output document ${outputUrl.replace(baseUrl, "")} → ${doc.status} ${doc.contentType} (source=${doc.artifactSource}, frames=${doc.frameCount})`,
  );
  assert(
    "the real output document loads (200 JSON segment document)",
    doc.ok && doc.status === 200 && doc.bodyIsJson && doc.contentType.includes("json"),
    `status=${doc.status} content-type=${doc.contentType}`,
  );
  assert(
    "the output document carries its artifact-source header",
    doc.artifactSource.length > 0,
    `x-sporta-artifact-source=${doc.artifactSource}`,
  );
  assert(
    "the output document's manifest counts real frames",
    doc.frameCount >= 1,
    `manifest.frameCount=${doc.frameCount}`,
  );

  // --------------------------- frame stepping (the player's own clock)
  const before = browser.attr(".player-stage[role='img']", "aria-label");
  const beforeSeek = browser.attr("#player-seek", "aria-valuetext");
  const markerCount = browser.count(".marker-jump");
  assert("event markers offer frame jumps", markerCount >= 1, `marker-jump count=${markerCount}`);
  // Jump to a marker that targets a DIFFERENT frame than the playhead's —
  // the first marker may well sit on the current frame (both frame 1).
  const currentFrame = Number.parseInt(beforeSeek.match(/frame (\d+) of/)?.[1] ?? "0", 10);
  const jumped = browser.clickWhere(
    ".marker-jump",
    `!this.textContent.includes(${JSON.stringify(`frame ${currentFrame} ·`)})`,
  );
  assert(
    "a marker targeting a different frame exists to jump to",
    jumped >= 1,
    `markers off frame ${currentFrame}: ${jumped}`,
  );
  const moved = await browser.waitForJs(
    `(function(){const el=document.querySelector('#player-seek');const stage=document.querySelector('.player-stage[role=img]');return el !== null && stage !== null && el.getAttribute('aria-valuetext') !== ${JSON.stringify(beforeSeek)} && stage.getAttribute('aria-label') !== ${JSON.stringify(before)};})()`,
    10_000,
  );
  const afterSeek = browser.attr("#player-seek", "aria-valuetext");
  assert(
    "an event-marker jump moves the playhead (snaps to a real frame)",
    moved,
    `seek: "${beforeSeek}" → "${afterSeek}"`,
  );

  // ------------------------------------------- the transport really plays
  // (clickForOutcome: the marker jump above scrolled the page, and a click
  // dispatched at off-viewport coordinates hits nothing — the flight-2
  // "Play → Play" failure; the driver scrolls the target into view and
  // verifies the outcome, re-clicking like a user would.)
  const toggleBefore = browser.text(".player-toggle");
  const started = await browser.clickForOutcome(
    ".player-toggle",
    `(function(){const el=document.querySelector('.player-toggle');return el !== null && el.textContent.trim() === 'Pause';})()`,
  );
  const toggleAfter = browser.text(".player-toggle");
  assert(
    "the play transport starts playback (Play → Pause)",
    started && toggleBefore.trim() !== toggleAfter.trim() && toggleAfter.trim() === "Pause",
    `toggle: "${toggleBefore.trim()}" → "${toggleAfter.trim()}"`,
  );
  browser.click(".player-toggle"); // pause again
  browser.screenshot(`${ctx.evidenceDir}/output-playback.png`);
  recorder.screenshots.push("output-playback.png");
}
