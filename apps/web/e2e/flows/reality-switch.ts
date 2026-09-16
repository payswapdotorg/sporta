/**
 * Flow reality-switch (W909) — the Reality Switcher on the watch page:
 * the option list mirrors the REAL renderer availabilities (stored outputs
 * → ready; everything else → an honest state + reason), and switching swaps
 * the player surface WITHOUT a page reload (Simulation G: the match session
 * is held constant — proven by a window marker that survives the switch).
 */
import type { FlowContext } from "../lib/harness";

interface SwitcherOption {
  rendererId: string;
  state: string;
  reason: string;
  disabled: boolean;
}

export async function realitySwitchFlow(ctx: FlowContext): Promise<void> {
  const { recorder, browser, discovery } = ctx;
  const { assert } = recorder;
  const session = discovery.primarySession;

  // The watch flow left the page on the seeded session's player.
  assert(
    "the watch page is still open on the seeded session",
    (await browser.waitForSelector(".reality-switcher", 10_000)) &&
      browser.url().includes(encodeURIComponent(session.sessionId).replace(/%2F/g, "/")),
    `url=${browser.url()}`,
  );

  // ------------------------------------------- the real availability list
  const options = browser.eval<SwitcherOption[]>(`(function(){
    return [...document.querySelectorAll('.switcher-option')].map((b) => ({
      rendererId: (b.querySelector('.switcher-name') || {textContent:''}).textContent.trim(),
      state: (b.querySelector('.switcher-state') || {textContent:''}).textContent.trim(),
      reason: (b.querySelector('.switcher-reason') || {textContent:''}).textContent.trim(),
      disabled: b.disabled,
    }));
  })()`);
  recorder.note(
    `switcher options: ${options.map((o) => `${o.rendererId}=${o.state}${o.disabled ? " (disabled)" : ""}`).join(", ")}`,
  );
  assert(
    "the switcher lists renderer options",
    options.length >= 2,
    `${options.length} options`,
  );

  const storedRendererIds = session.storedRenders.map((r) => r.rendererId);
  for (const rendererId of storedRendererIds) {
    const option = options.find((o) => o.rendererId === rendererId);
    assert(
      `a stored-output renderer (${rendererId}) is offered ready`,
      option !== undefined && option.state === "ready" && !option.disabled,
      option === undefined ? "option missing" : `state=${option.state} disabled=${option.disabled}`,
    );
  }
  const notReady = options.filter((o) => o.state !== "ready");
  assert(
    "non-ready options carry an honest reason (never a fake 'coming soon')",
    notReady.every((o) => o.reason.length > 0 && o.disabled),
    `${notReady.length} non-ready options, all disabled with reasons`,
  );

  // ----------------------------------------- switch WITHOUT a page reload
  const currentRenderer = browser.attr(".player-surface", "data-renderer");
  assert("the current player surface names its renderer", currentRenderer.length > 0, `data-renderer=${currentRenderer}`);

  const target = storedRendererIds.find((id) => id !== currentRenderer) ?? storedRendererIds[0] ?? "";
  assert(
    "a switch target with a stored output exists",
    target.length > 0,
    `target=${target || "none"}`,
  );

  // A window marker proves the PAGE never reloaded across the switch.
  const marker = `e2e-alive-${ctx.runId}`;
  browser.eval(`window.__sportaE2eMarker = ${JSON.stringify(marker)}; 'set'`);
  const switchNoticeBefore = browser.count(".switcher-notice");

  browser.clickText(target);
  const switched = await browser.waitForSelector(
    `.player-surface[data-renderer='${target}']`,
    20_000,
  );
  assert(
    "switching updates the player surface to the target renderer",
    switched,
    `data-renderer now=${browser.attr(".player-surface", "data-renderer")}`,
  );

  const markerAfter = browser.eval<string>(
    `(function(){return window.__sportaE2eMarker || 'GONE';})()`,
  );
  assert(
    "the switch did NOT reload the page (window marker survives)",
    markerAfter === marker,
    `marker="${markerAfter}"`,
  );
  const urlAfter = browser.url();
  assert(
    "the match session is held constant (same watch URL)",
    urlAfter.includes("/watch") && urlAfter.includes(session.sessionId),
    `url=${urlAfter}`,
  );

  // The switched surface renders its own real output.
  const newStageLabel = browser.attr(".player-stage[role='img']", "aria-label");
  assert(
    "the switched surface renders the target renderer's output",
    newStageLabel.includes(`The ${target} rendering`),
    `aria-label="${newStageLabel}"`,
  );
  const svgAfter = browser.eval<number>(
    `(function(){return document.querySelectorAll('.player-stage svg').length;})()`,
  );
  assert("the switched surface carries SVG frames", svgAfter >= 1, `svg elements=${svgAfter}`);
  assert(
    "the switch reported itself (aria-live notice)",
    browser.count(".switcher-notice") > switchNoticeBefore || browser.text(".switcher-notice").length > 0,
    `notice="${browser.text(".switcher-notice").slice(0, 90)}"`,
  );

  browser.screenshot(`${ctx.evidenceDir}/reality-switch-after.png`);
  recorder.screenshots.push("reality-switch-after.png");
}
