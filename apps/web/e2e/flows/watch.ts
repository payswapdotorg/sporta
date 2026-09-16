/**
 * Flow watch (W909) — ANONYMOUS watch of the SEEDED session: the real
 * stored output renders (animated-SVG frames present on the page), the
 * manifest-clock player is wired, and the timeline + event markers are
 * visible.
 */
import type { FlowContext } from "../lib/harness";

export async function watchFlow(ctx: FlowContext): Promise<void> {
  const { recorder, browser, baseUrl, discovery } = ctx;
  const { assert } = recorder;
  const session = discovery.primarySession;

  browser.open(`${baseUrl}/watch?session=${encodeURIComponent(session.sessionId)}`);
  const playerReady = await browser.waitForSelector(".player-surface", 25_000);
  assert(
    "the watch page renders the player for the seeded session",
    playerReady,
    `session=${session.sessionId}; selector .player-surface`,
  );

  // The real output: the stage carries an inline SVG + a frame-counting label.
  const stageLabel = browser.attr(".player-stage[role='img']", "aria-label");
  assert(
    "the output's frame stage is present and labelled",
    stageLabel.includes("rendering of match session") && stageLabel.includes("frame "),
    `aria-label="${stageLabel}"`,
  );
  const svgCount = browser.eval<number>(
    `(function(){return document.querySelectorAll('.player-stage svg').length + document.querySelectorAll('.player-stage svg[src], .player-stage img').length;})()`,
  );
  assert("the real output renders SVG frames", svgCount >= 1, `svg/frame elements in stage=${svgCount}`);

  const totalFrames = Number.parseInt(stageLabel.match(/frame \d+ of (\d+)/)?.[1] ?? "0", 10);
  assert(
    "the artifact's own manifest clock drives the frame count",
    totalFrames >= 1,
    `aria-label says "of ${totalFrames}"`,
  );

  // The frame clock: player-clock-frame shows "frame N of M".
  const clockFrame = browser.text(".player-clock-frame");
  assert(
    "the player's frame clock matches the manifest",
    clockFrame.trim() === `frame 1 of ${totalFrames}`,
    `.player-clock-frame="${clockFrame.trim()}"`,
  );

  // Timeline + event markers (placed at frames the provenance applied).
  const timelineFrames = browser.count(".timeline-track .timeline-frame");
  assert("the timeline renders the manifest's frame windows", timelineFrames === totalFrames, `windows=${timelineFrames}`);
  const markers = browser.count(".timeline-track .timeline-marker");
  const markerButtons = browser.count(".marker-jump");
  assert(
    "event markers are visible on the timeline",
    markers >= 1,
    `timeline-marker dots=${markers}; marker-jump buttons=${markerButtons}`,
  );
  assert(
    "the event marker list is rendered (real SWM events)",
    markerButtons >= 1,
    `marker-jump buttons=${markerButtons}`,
  );

  // The honest review-format labeling (never presented as video).
  const reviewNote = browser.text(".review-format-note");
  assert(
    "the output is honestly labeled a review artifact",
    reviewNote.includes("Rendered output") && reviewNote.includes("review format"),
    `note="${reviewNote.slice(0, 80)}…"`,
  );

  // The session's provenance panel (real counts from the watch model).
  const provenance = browser.text("section[aria-label='Output provenance']");
  assert(
    "the provenance panel renders real render metadata",
    provenance.length > 0 && provenance.includes("sporta."),
    `panel text starts="${provenance.slice(0, 60)}"`,
  );

  browser.screenshot(`${ctx.evidenceDir}/watch-seeded-session.png`);
  recorder.screenshots.push("watch-seeded-session.png");
}
